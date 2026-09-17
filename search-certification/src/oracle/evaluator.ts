import path from "node:path";
import { evaluateRuntimeConfiguration } from "../../../repair/src/runtime/runtime-runner.js";
import type { OracleRecord, PatchConfiguration, Replica, RuntimeObservation, SearchManifest } from "../types.js";
import { validateConfigurationSpaces } from "../configuration-space/index.js";
import { appendJsonl, readJsonl, resultDir, writeCsv, writeJsonl } from "../storage/files.js";
import { loadRepairManifest, loadSearchManifest, resultFiles } from "../storage/loaders.js";
import { summarizeObjective } from "./objective.js";

export type EvaluationStage = "oracle" | "search" | "confirmation";

export async function evaluateConfiguration(
  repoRoot: string,
  stage: EvaluationStage,
  experimentId: string,
  config: PatchConfiguration,
  seeds: number[],
  includeCleanRegression: boolean,
  onObservation?: (observation: RuntimeObservation) => Promise<void> | void
): Promise<RuntimeObservation[]> {
  const runtimeRows = await evaluateRuntimeConfiguration(repoRoot, {
    experimentId,
    phase: stage,
    replica: config.replica,
    configurationId: config.configurationId,
    patchIds: config.patchIds,
    seeds,
    includeCleanRegression,
    onObservation: async (row: Awaited<ReturnType<typeof evaluateRuntimeConfiguration>>[number]) => {
      await onObservation?.(runtimeObservation(experimentId, stage, row));
    }
  });
  return runtimeRows.map((row) => runtimeObservation(experimentId, stage, row));
}

function runtimeObservation(experimentId: string, stage: EvaluationStage, row: Awaited<ReturnType<typeof evaluateRuntimeConfiguration>>[number]): RuntimeObservation {
  return {
    experimentId,
    stage,
    replica: row.replica,
    configurationId: row.configurationId,
    patchIds: row.patchIds,
    seed: row.seed,
    journeyId: row.journeyId,
    cleanRegression: row.cleanRegression,
    compliantSuccess: row.compliantSuccess,
    verifiedSuccess: row.outcome.verifiedSuccess,
    violations: row.outcome.violations,
    violationTypes: row.violationTypes,
    latencyMs: row.latencyMs,
    steps: row.outcome.steps,
    inputTokens: row.outcome.inputTokens,
    outputTokens: row.outcome.outputTokens,
    resultPath: row.outcome.resultPath || "",
    outcome: row.outcome
  };
}

export async function runOracle(repoRoot: string, options: { resume?: boolean; replica?: Replica; experimentId?: string } = {}) {
  const spaces = await validateConfigurationSpaces(repoRoot);
  const manifest = await loadSearchManifest(repoRoot);
  const files = resultFiles(repoRoot);
  const experimentId = options.experimentId || "search-certification-oracle-v1";
  if (!options.resume) await writeJsonl(files.oracleResults, []);
  const existing = options.resume ? await readJsonl<OracleRecord>(files.oracleResults) : [];
  const existingKeys = new Set(existing.map((row) => `${row.experimentId}:${row.replica}:${row.configurationId}`));
  const rows: OracleRecord[] = [];
  for (const replica of selectedReplicas(options.replica)) {
    for (const config of spaces[replica].filter((item) => item.feasible)) {
      const key = `${experimentId}:${replica}:${config.configurationId}`;
      if (existingKeys.has(key)) continue;
      const observations = await evaluateConfiguration(repoRoot, "oracle", experimentId, config, manifest.budgets.oracleSeeds, true);
      const objective = summarizeObjective(config, observations, manifest);
      const oracleRows = observations.map((observation) => ({ ...observation, objectiveAfterConfiguration: objective }));
      await appendJsonl(files.oracleResults, oracleRows);
      rows.push(...oracleRows);
    }
  }
  const allRows = await readJsonl<OracleRecord>(files.oracleResults);
  await writeOracleSummary(repoRoot, spaces, allRows, manifest);
  return { experimentId, rows: allRows.length, resultDir: resultDir(repoRoot) };
}

export async function writeOracleSummary(repoRoot: string, spaces: Record<Replica, PatchConfiguration[]>, rows: OracleRecord[], manifest: SearchManifest) {
  const repairManifest = await loadRepairManifest(repoRoot);
  const csvRows = Object.entries(spaces).flatMap(([replica, configs]) =>
    configs
      .filter((config) => config.feasible)
      .map((config) => {
        const observations = rows.filter((row) => row.replica === replica && row.configurationId === config.configurationId);
        const objective = summarizeObjective(config, observations, manifest);
        return {
          replica,
          configuration_id: config.configurationId,
          patch_vector: config.patchVector.join(""),
          patch_ids: config.patchIds.join(";"),
          feasible: config.feasible,
          oracle_runs: observations.length,
          defect_runs: observations.filter((row) => !row.cleanRegression).length,
          clean_regression_runs: observations.filter((row) => row.cleanRegression).length,
          min_compliant_success: objective.minCompliantSuccess,
          violation_rate: objective.violationRate,
          safe: objective.safe,
          objective: objective.objective,
          median_latency_ms: objective.medianLatencyMs,
          engineering_minutes: config.engineeringMinutes,
          harness_version: repairManifest.harnessVersion || "repair-template-v1"
        };
      })
  );
  await writeCsv(path.join(resultDir(repoRoot), "oracle-summary.csv"), csvRows);
}

function selectedReplicas(replica?: Replica): Replica[] {
  return replica ? [replica] : ["shop", "saas", "support"];
}
