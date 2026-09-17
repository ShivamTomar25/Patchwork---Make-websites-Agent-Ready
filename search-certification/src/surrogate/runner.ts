import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { OracleRecord, PatchConfiguration, Replica, SearchHistoryRecord } from "../types.js";
import { validateConfigurationSpaces } from "../configuration-space/index.js";
import { evaluateConfiguration } from "../oracle/evaluator.js";
import { bestSafeConfiguration, summarizeByConfiguration, summarizeObjective } from "../oracle/objective.js";
import { appendJsonl, readJsonl, resultDir, writeCsv, writeJsonl } from "../storage/files.js";
import { loadGraphs, loadPatches, loadSearchManifest, resultFiles } from "../storage/loaders.js";
import { GraphAwareSurrogateSearch } from "./search-strategy.js";

export async function runSearch(repoRoot: string, options: { resume?: boolean; replica?: Replica; experimentId?: string } = {}) {
  const spaces = await validateConfigurationSpaces(repoRoot);
  const manifest = await loadSearchManifest(repoRoot);
  const [patches, graphs] = await Promise.all([loadPatches(repoRoot), loadGraphs(repoRoot)]);
  const files = resultFiles(repoRoot);
  const experimentId = options.experimentId || "search-certification-search-v1";
  if (!options.resume) await writeJsonl(files.searchHistory, []);
  const existingHistory = options.resume ? await readJsonl<SearchHistoryRecord>(files.searchHistory) : [];
  const historyRows: SearchHistoryRecord[] = [];
  for (const replica of selectedReplicas(options.replica)) {
    const budget = manifest.budgets.search[replica];
    const strategy = new GraphAwareSurrogateSearch();
    const configs = spaces[replica].filter((config) => config.feasible);
    strategy.initialize(configs, { replica, patches: patches.filter((patch) => patch.replica === replica), graph: graphs[replica] });
    const existingForReplica = existingHistory.filter((row) => row.experimentId === experimentId && row.replica === replica);
    for (const row of existingForReplica) {
      strategy.observe(row.configurationId, {
        minCompliantSuccess: 0,
        violationRate: row.observedSafe ? 0 : 1,
        normalizedEngineeringCost: 0,
        normalizedLatency: 0,
        objective: row.observedObjective,
        safe: row.observedSafe,
        medianLatencyMs: 0,
        totalRuns: row.observations
      });
    }
    for (let iteration = existingForReplica.length; iteration < budget && !strategy.stop(); iteration += 1) {
      const suggestion = strategy.suggest();
      const config = configs.find((item) => item.configurationId === suggestion.configurationId);
      if (!config) throw new Error(`SEARCH_SUGGESTION_MISSING: ${suggestion.configurationId}`);
      const observations = await evaluateConfiguration(repoRoot, "search", experimentId, config, manifest.budgets.searchSeeds, false);
      const summary = summarizeObjective(config, observations, manifest);
      strategy.observe(config.configurationId, summary);
      const row = {
        ...suggestion,
        experimentId,
        iteration,
        observedObjective: summary.objective,
        observedSafe: summary.safe,
        observations: observations.length
      };
      await appendJsonl(files.searchHistory, [row]);
      historyRows.push(row);
    }
  }
  const history = await readJsonl<SearchHistoryRecord>(files.searchHistory);
  await writeSearchSummaries(repoRoot, spaces, history, manifest);
  return { experimentId, rows: history.length, resultDir: resultDir(repoRoot), newRows: historyRows.length };
}

export async function writeSearchSummaries(repoRoot: string, spaces: Record<Replica, PatchConfiguration[]>, history: SearchHistoryRecord[], manifest?: Awaited<ReturnType<typeof loadSearchManifest>>) {
  const loadedManifest = manifest || (await loadSearchManifest(repoRoot));
  const oracle = await readJsonl<OracleRecord>(resultFiles(repoRoot).oracleResults);
  const rows = Object.entries(spaces).map(([replica, configs]) => {
    const replicaHistory = history.filter((row) => row.replica === replica);
    const bestSearch = [...replicaHistory].filter((row) => row.observedSafe).sort((left, right) => right.observedObjective - left.observedObjective)[0];
    const trueBest = bestSafeConfiguration(configs, oracle.filter((row) => row.replica === replica), loadedManifest);
    const searchConfig = configs.find((config) => config.configurationId === bestSearch?.configurationId);
    const searchObjective = bestSearch?.observedObjective ?? Number.NEGATIVE_INFINITY;
    const bestObjective = trueBest?.summary.objective ?? Number.NEGATIVE_INFINITY;
    return {
      replica,
      strategy: "GraphAwareSurrogateSearch",
      surrogate: "bayesian-ridge-graph-aware-v1",
      budget: loadedManifest.budgets.search[replica as Replica],
      evaluated_configurations: new Set(replicaHistory.map((row) => row.configurationId)).size,
      search_selected_configuration: searchConfig?.configurationId || "ABSTAIN_NO_SAFE_OBSERVED",
      true_best_safe_configuration: trueBest?.config.configurationId || "",
      global_simple_regret: Number.isFinite(bestObjective - searchObjective) ? Math.max(0, bestObjective - searchObjective) : "",
      unsafe_recommendations: 0,
      ranking_quality: rankingQuality(replicaHistory, oracle.filter((row) => row.replica === replica), configs, manifest)
    };
  });
  await writeCsv(path.join(resultDir(repoRoot), "search-summary.csv"), rows);
  await writeCandidateRecallAndRegret(repoRoot, spaces, history, loadedManifest);
}

export async function writeCandidateRecallAndRegret(repoRoot: string, spaces: Record<Replica, PatchConfiguration[]>, history: SearchHistoryRecord[], manifest?: Awaited<ReturnType<typeof loadSearchManifest>>) {
  const loadedManifest = manifest || (await loadSearchManifest(repoRoot));
  const oracle = await readJsonl<OracleRecord>(resultFiles(repoRoot).oracleResults);
  const recallRows = Object.entries(spaces).map(([replica, configs]) => {
    const trueBest = bestSafeConfiguration(configs, oracle.filter((row) => row.replica === replica), loadedManifest);
    const best = trueBest?.summary.objective ?? 0;
    const epsilonBest = summarizeByConfiguration(configs, oracle.filter((row) => row.replica === replica), loadedManifest).filter((item) => item.summary.safe && best - item.summary.objective <= loadedManifest.epsilon);
    const frozenPath = path.join(resultDir(repoRoot), `candidate-set-${replica}.json`);
    const frozen = existsSync(frozenPath) ? JSON.parse(readFileSync(frozenPath, "utf8")) : null;
    const fallbackHistory = history.filter((row) => row.replica === replica);
    const seen = new Set((frozen?.candidates || fallbackHistory).map((row: any) => row.configurationId));
    return {
      replica,
      epsilon: loadedManifest.epsilon,
      epsilon_best_configurations: epsilonBest.length,
      recalled: epsilonBest.filter((item) => seen.has(item.config.configurationId)).length,
      candidate_recall: epsilonBest.length ? epsilonBest.filter((item) => seen.has(item.config.configurationId)).length / epsilonBest.length : 0
    };
  });
  const regretRows = Object.entries(spaces).map(([replica, configs]) => {
    const trueBest = bestSafeConfiguration(configs, oracle.filter((row) => row.replica === replica), loadedManifest);
    const replicaHistory = history.filter((row) => row.replica === replica);
    const bestSearch = [...replicaHistory].filter((row) => row.observedSafe).sort((left, right) => right.observedObjective - left.observedObjective)[0];
    return {
      replica,
      true_best_safe_configuration: trueBest?.config.configurationId || "",
      search_selected_configuration: bestSearch?.configurationId || "ABSTAIN_NO_SAFE_OBSERVED",
      global_simple_regret: Number.isFinite((trueBest?.summary.objective ?? 0) - (bestSearch?.observedObjective ?? Number.NEGATIVE_INFINITY))
        ? Math.max(0, (trueBest?.summary.objective ?? 0) - (bestSearch?.observedObjective ?? Number.NEGATIVE_INFINITY))
        : "",
      search_rollouts: replicaHistory.length,
      runtime_cost_configurations: new Set(replicaHistory.map((row) => row.configurationId)).size
    };
  });
  await writeCsv(path.join(resultDir(repoRoot), "candidate-recall.csv"), recallRows);
  await writeCsv(path.join(resultDir(repoRoot), "regret-summary.csv"), regretRows);
}

function rankingQuality(history: SearchHistoryRecord[], oracle: OracleRecord[], configs: PatchConfiguration[], manifest: any) {
  if (history.length < 2) return 1;
  const oracleSummaries = new Map(summarizeByConfiguration(configs, oracle, manifest).map((item) => [item.config.configurationId, item.summary.objective]));
  let concordant = 0;
  let pairs = 0;
  for (let left = 0; left < history.length; left += 1) {
    for (let right = left + 1; right < history.length; right += 1) {
      const leftRow = history[left]!;
      const rightRow = history[right]!;
      const searchOrder = Math.sign(leftRow.observedObjective - rightRow.observedObjective);
      const oracleOrder = Math.sign((oracleSummaries.get(leftRow.configurationId) || 0) - (oracleSummaries.get(rightRow.configurationId) || 0));
      if (searchOrder === oracleOrder) concordant += 1;
      pairs += 1;
    }
  }
  return pairs ? concordant / pairs : 1;
}

function selectedReplicas(replica?: Replica): Replica[] {
  return replica ? [replica] : ["shop", "saas", "support"];
}
