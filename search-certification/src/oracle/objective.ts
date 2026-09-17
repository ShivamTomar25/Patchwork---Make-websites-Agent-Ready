import type { ObjectiveSummary, PatchConfiguration, RuntimeObservation, SearchManifest } from "../types.js";

export function summarizeObjective(config: PatchConfiguration, observations: RuntimeObservation[], manifest: SearchManifest): ObjectiveSummary {
  const defectRows = observations.filter((row) => !row.cleanRegression);
  const byJourney = groupBy(defectRows, (row) => row.journeyId);
  const journeyRates = [...byJourney.values()].map((rows) => rate(rows.filter((row) => row.compliantSuccess).length, rows.length));
  const minCompliantSuccess = journeyRates.length ? Math.min(...journeyRates) : 0;
  const violationRate = rate(defectRows.filter((row) => row.violationTypes.length > 0).length, defectRows.length);
  const cleanRegressionFailed = observations.some((row) => row.cleanRegression && !row.compliantSuccess);
  const normalizedEngineeringCost = Math.min(1, config.engineeringMinutes / 240);
  const medianLatencyMs = median(defectRows.map((row) => row.latencyMs));
  const normalizedLatency = Math.min(1, medianLatencyMs / 10_000);
  const safe = violationRate === 0 && !cleanRegressionFailed;
  const baseObjective = minCompliantSuccess - manifest.objective.lambdaCost * normalizedEngineeringCost - manifest.objective.lambdaLatency * normalizedLatency;
  return {
    minCompliantSuccess,
    violationRate,
    normalizedEngineeringCost,
    normalizedLatency,
    objective: safe ? baseObjective : -1 - manifest.objective.lambdaCost * normalizedEngineeringCost - manifest.objective.lambdaLatency * normalizedLatency,
    safe,
    medianLatencyMs,
    totalRuns: observations.length
  };
}

export function summarizeByConfiguration(configs: PatchConfiguration[], observations: RuntimeObservation[], manifest: SearchManifest) {
  return configs.map((config) => ({
    config,
    summary: summarizeObjective(
      config,
      observations.filter((row) => row.configurationId === config.configurationId),
      manifest
    )
  }));
}

export function bestSafeConfiguration(configs: PatchConfiguration[], observations: RuntimeObservation[], manifest: SearchManifest) {
  return summarizeByConfiguration(configs, observations, manifest)
    .filter((item) => item.summary.safe)
    .sort((left, right) => right.summary.objective - left.summary.objective)[0];
}

export function rate(count: number, total: number) {
  return total ? count / total : 0;
}

export function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return groups;
}
