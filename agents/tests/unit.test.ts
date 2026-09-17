import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AgentDecisionSchema, JourneyRunResultSchema, VerificationResultSchema } from "../src/core/schemas.js";
import { SafetyGuard } from "../src/core/safety-guard.js";
import { BudgetManager } from "../src/core/budget-manager.js";
import { LoopDetector } from "../src/core/loop-detector.js";
import { parseDefectFlags, redactSecrets } from "../src/core/utils.js";
import { ContractLoader } from "../src/contracts/contract-loader.js";
import { ResearchContractsFileSchema } from "../src/contracts/research-contract-schema.js";
import { SiteRegistry } from "../src/sites/site-registry.js";
import { DeterministicMockTextProvider, parseDecisionWithRetry } from "../src/providers/model-provider.js";
import { validateFinalStudyManifest } from "../src/core/manifest-validator.js";
import { loadResearchContracts } from "../src/research/contract-validator.js";
import { loadPilotManifest, type PilotJourney } from "../src/research/pilot-manifest.js";
import { parseNumberList, pilotRunKey, planPilotTasks } from "../src/research/pilot-runner.js";
import { exportPilotResults, readExistingPilotRecords, type PilotRunRecord } from "../src/research/result-exporter.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("agent action schemas", () => {
  it("validates accessibility and tool decisions", () => {
    expect(
      AgentDecisionSchema.parse({
        action: { type: "click_by_role", role: "button", name: "Login" },
        reason: "Click login",
        usage: { inputTokens: 1, outputTokens: 1 }
      }).action.type
    ).toBe("click_by_role");
    expect(
      AgentDecisionSchema.parse({
        action: {
          type: "call_tool",
          operationId: "shop_create_order",
          method: "POST",
          path: "/api/shop/checkout",
          headers: { "Idempotency-Key": "test" },
          pathParams: {},
          query: {},
          body: {}
        },
        reason: "Call checkout"
      }).action.type
    ).toBe("call_tool");
  });
});

describe("provider parsing", () => {
  it("parses deterministic mock JSON decisions", async () => {
    const provider = new DeterministicMockTextProvider();
    const parsed = await parseDecisionWithRetry(provider, {
      schemaName: "AgentDecision",
      temperature: 0,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      messages: [{ role: "user", content: "mock" }]
    });
    expect(parsed.decision.action.type).toBe("finish");
  });
});

describe("safety and redaction", () => {
  it("rejects external navigation", async () => {
    const site = await new SiteRegistry(repoRoot).get("shop");
    const guard = new SafetyGuard(site);
    expect(() => guard.assertAllowedUrl("http://localhost:3101/products")).not.toThrow();
    expect(() => guard.assertAllowedUrl("https://example.com")).toThrow(/SAFETY_EXTERNAL_NAVIGATION/);
  });

  it("validates viewport coordinates", async () => {
    const site = await new SiteRegistry(repoRoot).get("support");
    const guard = new SafetyGuard(site);
    expect(() => guard.assertViewportCoordinate(10, 10, 100, 100)).not.toThrow();
    expect(() => guard.assertViewportCoordinate(100, 10, 100, 100)).toThrow(/COORDINATE_OUT_OF_VIEWPORT/);
  });

  it("redacts secrets recursively", () => {
    expect(redactSecrets({ password: "x", nested: { cookie: "abc", value: "ok" } })).toEqual({
      password: "[REDACTED]",
      nested: { cookie: "[REDACTED]", value: "ok" }
    });
  });

  it("parses defect flags", () => {
    expect(parseDefectFlags("SHOP-IDEMP-001=true,SAAS-AUTH-001=0,SUPPORT-SCHEMA-001")).toEqual({
      "SHOP-IDEMP-001": true,
      "SAAS-AUTH-001": false,
      "SUPPORT-SCHEMA-001": true
    });
  });
});

describe("loop and budget", () => {
  it("detects repeated loops", () => {
    const detector = new LoopDetector(2);
    const item = { url: "http://localhost", observationHash: "abc", action: { type: "wait" } };
    expect(detector.check(item)).toBe(false);
    expect(detector.check(item)).toBe(true);
  });

  it("enforces step budgets", () => {
    const budget = new BudgetManager(1, 1000, 10);
    expect(() => budget.assertCanContinue(0)).not.toThrow();
    expect(() => budget.assertCanContinue(1)).toThrow(/max_steps/);
  });
});

describe("contracts and result schemas", () => {
  it("loads all site contracts", async () => {
    const registry = new SiteRegistry(repoRoot);
    const loader = new ContractLoader(repoRoot);
    expect((await loader.loadAll(await registry.get("shop"))).map((contract) => contract.id)).toContain("SHOP-J1");
    expect((await loader.loadAll(await registry.get("saas"))).map((contract) => contract.id)).toContain("SAAS-J4");
    expect((await loader.loadAll(await registry.get("support"))).map((contract) => contract.id)).toContain("SUPPORT-J4");
  });

  it("validates result schema", () => {
    expect(
      JourneyRunResultSchema.parse({
        runId: "run",
        site: "shop",
        journeyId: "SHOP-J1",
        agentId: "scripted",
        provider: "scripted",
        model: "none",
        promptVersion: "v",
        seed: 1,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        terminationReason: "verified_success",
        verifiedSuccess: true,
        violations: [],
        steps: 1,
        latencyMs: 1,
        inputTokens: 0,
        outputTokens: 0
      }).verifiedSuccess
    ).toBe(true);
  });

  it("parses all 11 strict research contracts", async () => {
    const contracts = await loadResearchContracts(repoRoot);
    expect(contracts.map((contract) => contract.journeyId).sort()).toEqual([
      "SAAS-J1",
      "SAAS-J2",
      "SAAS-J3",
      "SAAS-J4",
      "SHOP-J1",
      "SHOP-J2",
      "SHOP-J3",
      "SUPPORT-J1",
      "SUPPORT-J2",
      "SUPPORT-J3",
      "SUPPORT-J4"
    ]);
    expect(contracts.every((contract) => contract.contractVersion === "pilot-v1")).toBe(true);
  });

  it("rejects broken research contracts", () => {
    expect(() => ResearchContractsFileSchema.parse({ journeys: [{ journeyId: "BROKEN" }] })).toThrow();
  });

  it("validates verifier schema independently from agent claims", () => {
    expect(
      VerificationResultSchema.parse({
        journeyId: "SHOP-J1",
        verifiedSuccess: false,
        violations: ["order_missing"],
        predicates: [{ name: "order exists", expected: "present", actual: "absent", passed: false }],
        authoritativeState: { orders: 0 },
        defectConfiguration: {},
        evaluatedAt: new Date().toISOString()
      }).predicates[0]?.passed
    ).toBe(false);
  });
});

describe("pilot manifest and exports", () => {
  it("freezes the pilot configuration", async () => {
    const manifest = await loadPilotManifest(repoRoot);
    const journeyIds = Object.values(manifest.replicas).flatMap((replica) => replica.journeys.map((journey) => journey.id));
    expect(manifest.studyType).toBe("pilot");
    expect(manifest.seeds).toEqual([1, 2, 3]);
    expect(manifest.concurrency).toBe(1);
    expect(journeyIds).toHaveLength(11);
    expect(Object.values(manifest.replicas).every((replica) => replica.contractVersion === "pilot-v1")).toBe(true);
  });

  it("plans resumeable clean and defect tasks", async () => {
    const manifest = await loadPilotManifest(repoRoot);
    const tasks = planPilotTasks(manifest, { sites: ["shop"], journeys: ["SHOP-J1"], seeds: [1] });
    expect(tasks.map((task) => `${task.condition}:${task.defectId || "clean"}`)).toEqual(["clean:clean", "defect:SHOP-SESSION-001"]);
    const key = pilotRunKey({ experimentId: "pilot-x", site: "shop", journey: { id: "SHOP-J1" } as PilotJourney, seed: 1, condition: "clean", agentId: "scripted" });
    expect(key).toBe("pilot-x:shop:SHOP-J1:1:clean:scripted:clean");
    expect(parseNumberList("1,3-4", [])).toEqual([1, 3, 4]);
  });

  it("exports redacted pilot result files", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "patchwork-pilot-"));
    const manifest = await loadPilotManifest(repoRoot);
    const record: PilotRunRecord = {
      experimentId: "pilot-redaction",
      manifestVersion: manifest.manifestVersion,
      siteCommit: manifest.siteCommit,
      contractVersion: "pilot-v1",
      site: "shop",
      journeyId: "SHOP-J1",
      agentId: "scripted",
      provider: "scripted-playwright",
      model: "none",
      promptVersion: "scripted-2026-08-03",
      seed: 1,
      condition: "clean",
      verifiedSuccess: true,
      violations: [],
      firstFailedPredicate: "",
      terminationReason: "verified_success",
      steps: 1,
      latencyMs: 10,
      inputTokens: 0,
      outputTokens: 0,
      screenshots: [],
      accessibilitySnapshots: [],
      toolCalls: [],
      backendStateBefore: { password: "secret", nested: { apiKey: "sk-test-secret-value" } },
      backendStateAfter: { ok: true },
      resetResult: { cookie: "session=secret", ok: true }
    };
    try {
      await exportPilotResults(tempRoot, manifest, [record]);
      const jsonl = await readFile(path.join(tempRoot, "experiments/results/pilot-study-v1/runs.jsonl"), "utf8");
      const report = await readFile(path.join(tempRoot, "experiments/results/pilot-study-v1/pilot-report.md"), "utf8");
      const resetSummary = await readFile(path.join(tempRoot, "experiments/results/pilot-study-v1/reset-summary.csv"), "utf8");
      expect(jsonl).not.toContain("secret");
      expect(jsonl).toContain("[REDACTED]");
      expect(report).toContain("Runs: 1");
      expect(report).toContain("Mock-provider results validate orchestration");
      expect(resetSummary).toContain("pre_run_reset_ok");
      expect(resetSummary).not.toContain("secret");
      expect(await readExistingPilotRecords(tempRoot)).toHaveLength(1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("final-study validator", () => {
  it("rejects duplicate final model pairs", () => {
    expect(() =>
      validateFinalStudyManifest({
        mode: "final",
        agents: {
          accessibilityA: { provider: "same", model: "same" },
          accessibilityB: { provider: "same", model: "same" }
        }
      })
    ).toThrow(/FINAL_STUDY_MODEL_DUPLICATE/);
  });

  it("permits duplicate pilot model pairs with warning", () => {
    const result = validateFinalStudyManifest({
      mode: "pilot",
      agents: {
        accessibilityA: { provider: "same", model: "same" },
        accessibilityB: { provider: "same", model: "same" }
      }
    });
    expect(result.warnings.length).toBe(1);
  });
});
