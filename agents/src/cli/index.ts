import path from "node:path";
import { ExperimentRunner, type AgentId } from "../runner/experiment-runner.js";
import type { SiteKey } from "../core/types.js";
import { parseDefectFlags, parseRange } from "../core/utils.js";

const repoRoot = path.basename(process.cwd()) === "agents" ? path.dirname(process.cwd()) : process.cwd();
const [, , command, ...rawArgs] = process.argv;

const args = parseArgs(rawArgs);
const runner = new ExperimentRunner(repoRoot);

if (command === "smoke") {
  const report = await runner.smoke();
  console.log(JSON.stringify({
    ok: report.ok,
    health: report.health,
    results: report.results.map((result) => ({
      site: result.site,
      journeyId: result.journeyId,
      agentId: result.agentId,
      verifiedSuccess: result.verifiedSuccess,
      terminationReason: result.terminationReason
    }))
  }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (command === "run") {
  const site = requireArg("site") as SiteKey;
  const journeyId = requireArg("journey");
  const agentId = (args.agent || "scripted") as AgentId;
  const seed = Number(args.seed || "1");
  const mode = (args.mode || "mock") as "mock" | "live";
  const defectConfiguration = parseDefectFlags(args.defects);
  const result = await runner.run({
    site,
    journeyId,
    agentId,
    seed,
    mode,
    maxSteps: Number(args.maxSteps || "30"),
    timeoutMs: Number(args.timeoutMs || "120000"),
    tokenBudget: Number(args.tokenBudget || "20000"),
    authorizeResearchTools: false,
    defectConfiguration
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verifiedSuccess ? 0 : 1);
}

if (command === "matrix") {
  const mode = (args.mode || "mock") as "mock" | "live";
  const matrixOptions: {
    mode: "mock" | "live";
    sites?: SiteKey[];
    journeys?: string[];
    agents?: AgentId[];
    seeds: number[];
    concurrency?: number;
    defectConfiguration?: Record<string, boolean>;
    resume?: boolean;
  } = {
    mode,
    seeds: parseRange(args.seeds, [1])
  };
  if (args.sites) matrixOptions.sites = args.sites.split(",") as SiteKey[];
  if (args.journeys) matrixOptions.journeys = args.journeys.split(",");
  if (args.agents) matrixOptions.agents = args.agents.split(",") as AgentId[];
  if (args.concurrency) matrixOptions.concurrency = Number(args.concurrency);
  if (args.defects) matrixOptions.defectConfiguration = parseDefectFlags(args.defects);
  if (args.resume === "true" || args.resume === "1") matrixOptions.resume = true;
  const results = await runner.matrix(matrixOptions);
  const ok = results.every((result) => result.verifiedSuccess);
  console.log(JSON.stringify({
    ok,
    total: results.length,
    passed: results.filter((result) => result.verifiedSuccess).length,
    failed: results.filter((result) => !result.verifiedSuccess).length,
    results: results.map((result) => ({
      site: result.site,
      journeyId: result.journeyId,
      agentId: result.agentId,
      seed: result.seed,
      verifiedSuccess: result.verifiedSuccess,
      terminationReason: result.terminationReason
    }))
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

console.error("Usage: smoke | run -- --site shop --journey SHOP-J1 --agent scripted --seed 1 | matrix -- --mode mock");
process.exit(1);

function parseArgs(values: string[]) {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value?.startsWith("--")) {
      const key = value.slice(2);
      parsed[key] = values[index + 1] || "true";
      index += 1;
    }
  }
  return parsed;
}

function requireArg(name: string): string {
  const value = args[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}
