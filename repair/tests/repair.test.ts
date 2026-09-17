import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { operatorTemplates, rootCauseNodeId, templateForDefect } from "../src/catalog.js";
import { parseUnifiedDiff, rejectPathTraversal } from "../src/compiler/diff.js";
import { generatePatches } from "../src/compiler/compiler.js";
import { buildGraphs } from "../src/graph/builder.js";
import { buildFailureCones } from "../src/localization/cone.js";
import { summarizeLocalization } from "../src/localization/localizer.js";
import { assertRepairPilotDatabase } from "../src/storage/postgres.js";
import { allocateLocalPort, assertPilotRuntimeEnvironment, assertPortAvailable, redactRuntimeEnv } from "../src/runtime/safety.js";
import { assertRuntimePatchPaths } from "../src/runtime/runtime-runner.js";
import { applyPatchDiff } from "../src/sandbox/sandbox.js";
import { validatePatches } from "../src/validators/patch-validator.js";
import type { LocalizationResult } from "../src/schemas.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("repair schemas and deterministic templates", () => {
  it("covers every patch operator and every V2 selected defect family", () => {
    expect(Object.keys(operatorTemplates).sort()).toEqual([
      "AUTH_SCOPE_NARROW",
      "CONFIRMATION_INSERT",
      "IDEMPOTENCY_INSERT",
      "OUTPUT_SANITIZE",
      "SCHEMA_CORRECT",
      "SEMANTIC_RELABEL",
      "SESSION_RESTORE",
      "TYPED_RECOVERY",
      "UNTRUSTED_CONTENT_ISOLATE"
    ]);
    for (const defectId of [
      "SHOP-SESSION-001",
      "SHOP-AUTH-001",
      "SHOP-IDEMP-001",
      "SAAS-SESSION-001",
      "SAAS-RECOVERY-001",
      "SAAS-CONFIRM-001",
      "SAAS-SCHEMA-001",
      "SUPPORT-SESSION-001",
      "SUPPORT-AUTH-001",
      "SUPPORT-CONFIRM-001",
      "SUPPORT-INJECTION-001"
    ]) {
      expect(templateForDefect(defectId).operator).toBeTruthy();
    }
  });

  it("parses diffs and rejects path traversal or cross-replica source paths", () => {
    const parsed = parseUnifiedDiff([
      "diff --git a/replicas/shop-twin/api/src/repair/test.ts b/replicas/shop-twin/api/src/repair/test.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/replicas/shop-twin/api/src/repair/test.ts",
      "@@ -0,0 +1 @@",
      "+export const ok = true;"
    ].join("\n"));
    expect(parsed[0]?.addedLines).toContain("export const ok = true;");
    expect(() => rejectPathTraversal(repoRoot, "../secret.ts", ["replicas/shop-twin/"])).toThrow(/PATCH_PATH_REJECTED/);
    expect(() => rejectPathTraversal(repoRoot, "packages/api-kit/src/index.ts", ["replicas/shop-twin/"])).toThrow(/PATCH_PATH_OUTSIDE_REPLICA/);
  });
});

describe("localization and temporal cones", () => {
  it("summarizes exact first-predicate ordering", () => {
    const rows: LocalizationResult[] = [
      {
        journeyId: "SHOP-J2",
        runId: "run-1",
        replica: "shop",
        seed: 1,
        defectId: "SHOP-AUTH-001",
        firstViolatedPredicate: "cross-account order access blocked",
        lastVerifiedCheckpoint: "deterministic_seed",
        failureCategory: "authorization_failure",
        evidenceEventIds: ["step-1"],
        confidence: 0.95
      }
    ];
    expect(
      summarizeLocalization(rows, [
        { journeyId: "SHOP-J2", defectId: "SHOP-AUTH-001", expected: "cross-account order access blocked" }
      ])[0]?.exact_match
    ).toBe(true);
  });

  it("contains planted roots in temporal cones", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "repair-cone-"));
    const previous = process.env.REPAIR_RESULT_DIR;
    process.env.REPAIR_RESULT_DIR = temp;
    try {
      await buildGraphs(repoRoot);
      const cones = await buildFailureCones(repoRoot, [
        {
          journeyId: "SHOP-J2",
          runId: "run-1",
          replica: "shop",
          seed: 1,
          defectId: "SHOP-AUTH-001",
          firstViolatedPredicate: "cross-account order access blocked",
          lastVerifiedCheckpoint: "deterministic_seed",
          failureCategory: "authorization_failure",
          evidenceEventIds: [],
          confidence: 0.95
        }
      ]);
      expect(cones[0]?.rootCauseContained).toBe(true);
      expect(cones[0]?.candidateRepairTargets).toContain(rootCauseNodeId({ replica: "shop", defectId: "SHOP-AUTH-001" }));
    } finally {
      if (previous === undefined) delete process.env.REPAIR_RESULT_DIR;
      else process.env.REPAIR_RESULT_DIR = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });
});

describe("patch validation and storage guards", () => {
  it("generates statically validated template patches", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "repair-patch-"));
    const previous = process.env.REPAIR_RESULT_DIR;
    process.env.REPAIR_RESULT_DIR = temp;
    try {
      const patches = await generatePatches(repoRoot, []);
      const validations = await validatePatches(repoRoot, patches);
      expect(patches).toHaveLength(11);
      expect(validations.every((row) => row.schemaValidation === "pass" && row.rollbackTest === "pass")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.REPAIR_RESULT_DIR;
      else process.env.REPAIR_RESULT_DIR = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("guards repair storage to local pilot databases", () => {
    expect(assertRepairPilotDatabase("postgresql://user:secret@localhost:5432/patchwork_agents_pilot").database).toBe("patchwork_agents_pilot");
    expect(() => assertRepairPilotDatabase("postgresql://user@db.example.com:5432/patchwork_agents_pilot")).toThrow(/host must be local/);
    expect(() => assertRepairPilotDatabase("postgresql://user@localhost:5432/patchwork_agents")).toThrow(/must end with _pilot/);
  });
});

describe("runtime sandbox safety", () => {
  it("requires explicit reset opt-in and pilot-local database names", () => {
    const previous = process.env.PILOT_ALLOW_RESET;
    delete process.env.PILOT_ALLOW_RESET;
    try {
      expect(() =>
        assertPilotRuntimeEnvironment({
          SHOP_DATABASE_URL: "postgresql://user:secret@localhost:5432/patchwork_shop_pilot",
          SAAS_DATABASE_URL: "postgresql://user:secret@localhost:5432/patchwork_saas_pilot",
          SUPPORT_DATABASE_URL: "postgresql://user:secret@localhost:5432/patchwork_support_pilot",
          AGENTS_DATABASE_URL: "postgresql://user:secret@localhost:5432/patchwork_agents_pilot",
          RESEARCH_PILOT_DATABASES: "1"
        })
      ).toThrow(/PILOT_RESET_REJECTED/);
      process.env.PILOT_ALLOW_RESET = "true";
      expect(
        assertPilotRuntimeEnvironment({
          SHOP_DATABASE_URL: "postgresql://user:secret@localhost:5432/patchwork_shop_pilot",
          SAAS_DATABASE_URL: "postgresql://user:secret@localhost:5432/patchwork_saas_pilot",
          SUPPORT_DATABASE_URL: "postgresql://user:secret@localhost:5432/patchwork_support_pilot",
          AGENTS_DATABASE_URL: "postgresql://user:secret@localhost:5432/patchwork_agents_pilot",
          RESEARCH_PILOT_DATABASES: "1"
        }).map((item) => item.database)
      ).toEqual(["patchwork_shop_pilot", "patchwork_saas_pilot", "patchwork_support_pilot", "patchwork_agents_pilot"]);
      expect(() =>
        assertPilotRuntimeEnvironment({
          SHOP_DATABASE_URL: "postgresql://user@localhost:5432/patchwork_shop",
          SAAS_DATABASE_URL: "postgresql://user@localhost:5432/patchwork_saas_pilot",
          SUPPORT_DATABASE_URL: "postgresql://user@localhost:5432/patchwork_support_pilot",
          AGENTS_DATABASE_URL: "postgresql://user@localhost:5432/patchwork_agents_pilot",
          RESEARCH_PILOT_DATABASES: "1"
        })
      ).toThrow(/must end with _pilot/);
      expect(() =>
        assertPilotRuntimeEnvironment({
          SHOP_DATABASE_URL: "postgresql://user@db.example.com:5432/patchwork_shop_pilot",
          SAAS_DATABASE_URL: "postgresql://user@localhost:5432/patchwork_saas_pilot",
          SUPPORT_DATABASE_URL: "postgresql://user@localhost:5432/patchwork_support_pilot",
          AGENTS_DATABASE_URL: "postgresql://user@localhost:5432/patchwork_agents_pilot",
          RESEARCH_PILOT_DATABASES: "1"
        })
      ).toThrow(/host must be local/);
    } finally {
      if (previous === undefined) delete process.env.PILOT_ALLOW_RESET;
      else process.env.PILOT_ALLOW_RESET = previous;
    }
  });

  it("rejects occupied runtime ports", async () => {
    let port = 0;
    try {
      port = await allocateLocalPort();
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("EPERM");
      return;
    }
    const server = net.createServer();
    const listening = await new Promise<boolean>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EPERM") resolve(false);
        else reject(error);
      });
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (!listening) return;
    try {
      await expect(assertPortAvailable(port)).rejects.toThrow(/PORT_OCCUPIED/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps runtime patch application inside the selected replica and rolls back", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "repair-runtime-apply-"));
    const previous = process.env.REPAIR_RESULT_DIR;
    process.env.REPAIR_RESULT_DIR = temp;
    try {
      const [patch] = await generatePatches(repoRoot, []);
      expect(patch).toBeTruthy();
      assertRuntimePatchPaths(repoRoot, patch!);
      const sandboxRepo = path.join(temp, "repo");
      const indexFile = path.join(sandboxRepo, "replicas/shop-twin/api/src/index.ts");
      await mkdir(path.dirname(indexFile), { recursive: true });
      await writeFile(
        indexFile,
        [
          "import { databaseUrlFor, startServer } from \"@patchwork/api-kit\";",
          "",
          "process.env.DATABASE_URL = databaseUrlFor(\"shop\");",
          "",
          "const { PrismaClient } = await import(\"./generated/prisma/index.js\");",
          "const prisma = new PrismaClient();",
          "",
          "startServer(\"shop\", prisma);",
          ""
        ].join("\n"),
        "utf8"
      );
      const applied = await applyPatchDiff(sandboxRepo, patch!);
      expect(applied.every((file) => file.startsWith("replicas/shop-twin/"))).toBe(true);
      expect(await readFile(indexFile, "utf8")).toContain("installRuntimeRepair");
      expect(existsSync(path.join(sandboxRepo, "replicas/shop-twin/api/src/repair/runtime-repair.ts"))).toBe(true);
      await applyPatchDiff(sandboxRepo, patch!, patch!.rollbackDiff);
      expect(await readFile(indexFile, "utf8")).not.toContain("installRuntimeRepair");
      expect(existsSync(path.join(sandboxRepo, "replicas/shop-twin/api/src/repair/runtime-repair.ts"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.REPAIR_RESULT_DIR;
      else process.env.REPAIR_RESULT_DIR = previous;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("redacts database passwords and secret-like environment values", () => {
    expect(
      redactRuntimeEnv({
        SHOP_DATABASE_URL: "postgresql://user:secret@localhost:5432/patchwork_shop_pilot",
        API_KEY: "sk-test-secret-value"
      })
    ).toEqual({
      SHOP_DATABASE_URL: "postgresql://user:%5BREDACTED%5D@localhost:5432/patchwork_shop_pilot",
      API_KEY: "[REDACTED]"
    });
  });
});
