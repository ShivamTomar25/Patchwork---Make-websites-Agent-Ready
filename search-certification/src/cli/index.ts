import { existsSync } from "node:fs";
import path from "node:path";
import { buildConfigurationSpaces, validateConfigurationSpaces } from "../configuration-space/index.js";
import { runOracle } from "../oracle/evaluator.js";
import { runSearch } from "../surrogate/runner.js";
import { freezeCandidateSets } from "../candidate-freezer/index.js";
import { runConfirmation } from "../confirmation/index.js";
import { writeSearchCertificationReport } from "../certificate/report.js";
import { assertNoSecretLeak, resultDir, resolveRepoRoot } from "../storage/files.js";
import { runV2AuditAndRepeatedSearch, runV2Confirmation } from "../v2/debug-runner.js";
import { auditSupportInfrastructure, fullConfirmationReport, fullConfirmationStatus, runFullConfirmation } from "../v2/full-confirmation.js";
import type { Replica } from "../types.js";

const repoRoot = resolveRepoRoot();
const [command, ...args] = process.argv.slice(2);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (command === "build-space") {
    const spaces = await buildConfigurationSpaces(repoRoot);
    console.log(JSON.stringify({ ok: true, sizes: sizesOf(spaces) }, null, 2));
    return;
  }
  if (command === "validate-space") {
    const spaces = await validateConfigurationSpaces(repoRoot);
    console.log(JSON.stringify({ ok: true, sizes: sizesOf(spaces) }, null, 2));
    return;
  }
  if (command === "oracle") {
    const result = await runOracle(repoRoot, commandOptions());
    await finish();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (command === "search") {
    const result = await runSearch(repoRoot, commandOptions());
    await freezeCandidateSets(repoRoot);
    await finish();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (command === "confirmation") {
    const result = await runConfirmation(repoRoot, commandOptions());
    await finish();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (command === "pilot") {
    await buildConfigurationSpaces(repoRoot);
    const oracle = await runOracle(repoRoot, { resume: hasFlag("--resume") });
    const search = await runSearch(repoRoot, { resume: hasFlag("--resume") });
    const candidates = await freezeCandidateSets(repoRoot);
    const confirmation = await runConfirmation(repoRoot, { resume: hasFlag("--resume") });
    await finish();
    console.log(JSON.stringify({ ok: true, oracle, search, candidates: Object.keys(candidates), confirmation }, null, 2));
    return;
  }
  if (command === "v2:audit-search") {
    const result = await runV2AuditAndRepeatedSearch(repoRoot);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (command === "v2:confirmation") {
    const result = await runV2Confirmation(repoRoot);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (command === "v2:pilot") {
    const auditSearch = await runV2AuditAndRepeatedSearch(repoRoot);
    const confirmation = await runV2Confirmation(repoRoot);
    console.log(JSON.stringify({ ok: true, auditSearch, confirmation }, null, 2));
    return;
  }
  if (command === "confirmation:v2:full") {
    const result = await runFullConfirmation(repoRoot, commandOptions());
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (command === "confirmation:v2:resume") {
    const result = await runFullConfirmation(repoRoot, { ...commandOptions(), resume: true });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (command === "confirmation:v2:status") {
    const result = await fullConfirmationStatus(repoRoot);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (command === "confirmation:v2:report") {
    const result = await fullConfirmationReport(repoRoot);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (command === "confirmation:v2:audit-support") {
    const result = await auditSupportInfrastructure(repoRoot);
    console.log(JSON.stringify({ ok: true, exhaustedCandidateSeedRuns: result.exhaustedCandidateSeedRuns, resultDir: path.join(repoRoot, "experiments/results/search-certification-pilot-v2/full-confirmation") }, null, 2));
    return;
  }
  throw new Error(`UNKNOWN_SEARCH_CERTIFICATION_COMMAND: ${command || ""}`);
}

async function finish() {
  await writeSearchCertificationReport(repoRoot).catch(() => undefined);
  const dir = resultDir(repoRoot);
  await assertNoSecretLeak(
    [
      "configuration-space.csv",
      "oracle-results.jsonl",
      "oracle-summary.csv",
      "search-history.jsonl",
      "search-summary.csv",
      "confirmation-observations.jsonl",
      "confidence-sequence-history.jsonl",
      "confirmation-summary.csv",
      "certificates.jsonl",
      "candidate-recall.csv",
      "regret-summary.csv",
      "safety-summary.csv",
      "abstention-summary.csv",
      "search-certification-report.md"
    ].map((file) => path.join(dir, file)).filter((file) => existsSync(file))
  );
}

function replicaArg(): Replica | undefined {
  const value = valueArg("--replica");
  if (!value) return undefined;
  if (value !== "shop" && value !== "saas" && value !== "support") throw new Error(`INVALID_REPLICA: ${value}`);
  return value;
}

function commandOptions() {
  const options: { resume?: boolean; replica?: Replica; experimentId?: string } = {};
  if (hasFlag("--resume")) options.resume = true;
  const replica = replicaArg();
  if (replica) options.replica = replica;
  const experimentId = valueArg("--experiment-id");
  if (experimentId) options.experimentId = experimentId;
  return options;
}

function valueArg(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name: string) {
  return args.includes(name);
}

function sizesOf(spaces: Record<Replica, unknown[]>) {
  return Object.fromEntries(Object.entries(spaces).map(([replica, rows]) => [replica, rows.length]));
}
