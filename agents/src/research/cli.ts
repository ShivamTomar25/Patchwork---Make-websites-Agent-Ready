import path from "node:path";
import type { SiteKey } from "../core/types.js";
import { validateContracts } from "./contract-validator.js";
import { runDefectAudit } from "./defect-audit.js";
import { loadPilotManifest } from "./pilot-manifest.js";
import { parseNumberList, ResearchPilotRunner, type PilotMode, type PilotRunnerOptions } from "./pilot-runner.js";

const repoRoot = path.basename(process.cwd()) === "agents" ? path.dirname(process.cwd()) : process.cwd();
const [, , command, ...rawArgs] = process.argv;
const args = parseArgs(rawArgs);

if (command === "validate-contracts") {
  const result = await validateContracts(repoRoot, { liveVerifier: args.live !== "false" });
  console.log(JSON.stringify({ ok: result.ok, contractCount: result.contractCount, issues: result.issues.length }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (command === "audit-defects") {
  const result = await runDefectAudit(repoRoot);
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        clean: `${result.cleanCount}/11`,
        defect: `${result.defectCount}/11`,
        recovery: `${result.recoveryCount}/11`,
        resultDirectory: result.resultDirectory
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (command === "pilot" || command === "resume") {
  const manifestPath = args.manifest || args["manifest-path"];
  const manifest = await loadPilotManifest(repoRoot, manifestPath);
  const mode = parseMode(args.mode);
  const runner = new ResearchPilotRunner(repoRoot);
  if (command === "resume" && !args["experiment-id"]) {
    throw new Error("RESUME_EXPERIMENT_ID_REQUIRED");
  }
  const sites = parseSites(args.sites);
  const journeys = parseCsv(args.journeys);
  const runOptions: PilotRunnerOptions = {
    mode,
    resume: command === "resume" || args.resume === "true",
    seeds: parseNumberList(args.seeds, manifest.seeds)
  };
  if (manifestPath) runOptions.manifestPath = manifestPath;
  if (args["result-directory"]) runOptions.resultDirectory = args["result-directory"];
  if (args["experiment-id"]) runOptions.experimentId = args["experiment-id"];
  if (sites) runOptions.sites = sites;
  if (journeys) runOptions.journeys = journeys;
  if (args.limit) runOptions.limit = Number(args.limit);
  const result = await runner.run(runOptions);
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        experimentId: result.experimentId,
        mode: result.mode,
        plannedRuns: result.plannedRuns,
        completedRuns: result.completedRuns,
        skippedRuns: result.skippedRuns,
        records: result.records.length,
        resultDirectory: result.resultDirectory
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (command === "report") {
  const reportOptions: Pick<PilotRunnerOptions, "manifestPath" | "resultDirectory" | "mode"> = { mode: parseMode(args.mode) };
  const manifestPath = args.manifest || args["manifest-path"];
  if (manifestPath) reportOptions.manifestPath = manifestPath;
  if (args["result-directory"]) reportOptions.resultDirectory = args["result-directory"];
  const result = await new ResearchPilotRunner(repoRoot).report(reportOptions);
  console.log(JSON.stringify({ ok: result.ok, records: result.records.length, resultDirectory: result.resultDirectory }, null, 2));
  process.exit(0);
}

console.error("Usage: validate-contracts | audit-defects | pilot [--mode mock|live] | resume --experiment-id <id> | report");
process.exit(1);

function parseArgs(values: string[]) {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value?.startsWith("--")) {
      const inline = value.match(/^--([^=]+)=(.*)$/);
      if (inline) {
        const key = inline[1];
        if (key) parsed[key] = inline[2] || "";
        continue;
      }
      const next = values[index + 1];
      parsed[value.slice(2)] = next && !next.startsWith("--") ? next : "true";
      if (next && !next.startsWith("--")) index += 1;
    }
  }
  return parsed;
}

function parseMode(value: string | undefined): PilotMode {
  if (value === "live") return "live";
  return "mock";
}

function parseCsv(value: string | undefined) {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSites(value: string | undefined): SiteKey[] | undefined {
  const parsed = parseCsv(value);
  if (!parsed) return undefined;
  const allowed = new Set(["shop", "saas", "support"]);
  for (const site of parsed) {
    if (!allowed.has(site)) throw new Error(`UNKNOWN_SITE: ${site}`);
  }
  return parsed as SiteKey[];
}
