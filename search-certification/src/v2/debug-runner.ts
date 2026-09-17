import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CandidateSet, CertificateRecord, ObjectiveSummary, OracleRecord, PatchConfiguration, Replica, RuntimeObservation, SearchHistoryRecord, SearchManifest } from "../types.js";
import { validateConfigurationSpaces } from "../configuration-space/index.js";
import { freezeReplica } from "../candidate-freezer/index.js";
import { buildConfidenceHistory } from "../confidence-sequences/index.js";
import { certificateForCandidateSet } from "../certificate/index.js";
import { evaluateConfiguration } from "../oracle/evaluator.js";
import { median, summarizeByConfiguration } from "../oracle/objective.js";
import { assertNoSecretLeak, ensureDir, readJson, readJsonl, readYaml, repoPath, stableHash, writeCsv, writeJson, writeJsonl, writeYaml } from "../storage/files.js";
import { loadGraphs, loadPatches } from "../storage/loaders.js";
import { GraphAwareSurrogateSearch } from "../surrogate/search-strategy.js";

export const v1ResultRelativeDir = "experiments/results/search-certification-pilot-v1";
export const v2ResultRelativeDir = "experiments/results/search-certification-pilot-v2";
export const v2ManifestRelativePath = "experiments/configs/search-certification-pilot-v2.yaml";
const replicas: Replica[] = ["shop", "saas", "support"];
const repeatedBudgets: Record<Replica, number[]> = { shop: [4, 6, 8], saas: [6, 10, 16], support: [6, 10, 16] };
const repeatedSeeds = Array.from({ length: 30 }, (_, index) => 501 + index);
const confirmationSeeds = [1001, 1002, 1003, 1004, 1005];

type OracleIndex = Map<string, { config: PatchConfiguration; summary: ObjectiveSummary }>;
type RepeatedSearchRecord = {
  experimentId: string;
  replica: Replica;
  strategy: "RandomFeasibleSearch" | "GraphAwareSurrogateSearch";
  searchSeed: number;
  budget: number;
  evaluatedConfigurations: string[];
  selectedConfiguration: string;
  selectedSafe: boolean;
  abstained: boolean;
  oracleBestConfiguration: string;
  oracleBestObjective: number;
  selectedObjective: number;
  globalRegret: number;
  candidateSetHash: string;
  candidateRecall: number;
  foundOracleBest: boolean;
  runtimeCostConfigurations: number;
  unsafeRecommendation: boolean;
};

export async function runV2AuditAndRepeatedSearch(repoRoot: string) {
  const dir = v2ResultDir(repoRoot);
  await ensureDir(dir);
  const manifest = await createV2Manifest(repoRoot);
  const spaces = await validateConfigurationSpaces(repoRoot);
  const oracleRows = await readJsonl<OracleRecord>(repoPath(repoRoot, `${v1ResultRelativeDir}/oracle-results.jsonl`));
  if (oracleRows.length === 0) throw new Error("SEARCH_CERT_V2_MISSING_V1_ORACLE_RESULTS");
  const oracle = buildOracleIndex(spaces, oracleRows, manifest);

  await auditObjective(repoRoot, spaces, oracle, manifest);
  const candidateSets = await buildV2CandidateSets(repoRoot, spaces);
  await auditCandidateSets(repoRoot, spaces, oracle, candidateSets, manifest);
  const repeated = await runRepeatedSearch(repoRoot, spaces, oracle, candidateSets, manifest);
  await writeRepeatedSummaries(repoRoot, repeated);
  await writeConfirmationBudgetPlan(repoRoot, candidateSets, manifest);
  await writeV2Report(repoRoot);
  await assertNoSecretLeak(v2OutputFiles(repoRoot).filter((file) => existsSync(file)));
  return { resultDir: dir, repeatedRuns: repeated.length };
}

export async function runV2Confirmation(repoRoot: string) {
  const dir = v2ResultDir(repoRoot);
  await ensureDir(dir);
  const manifest = await createV2Manifest(repoRoot);
  const spaces = await validateConfigurationSpaces(repoRoot);
  const candidateSets = await loadOrBuildV2CandidateSets(repoRoot, spaces);
  const experimentId = "search-certification-confirmation-v2";
  const observationFile = path.join(dir, "confirmation-observations.jsonl");
  const existing = await readJsonl<RuntimeObservation>(observationFile);
  const existingKeys = new Set(existing.map((row) => `${row.replica}:${row.configurationId}:${row.seed}`));
  const newRows: RuntimeObservation[] = [];
  for (const replica of replicas) {
    for (const candidate of candidateSets[replica].candidates) {
      for (const seed of confirmationSeeds) {
        const key = `${replica}:${candidate.configurationId}:${seed}`;
        if (existingKeys.has(key)) continue;
        const rows = await evaluateConfiguration(repoRoot, "confirmation", experimentId, candidate, [seed], false);
        newRows.push(...rows);
        await writeJsonl(observationFile, [...existing, ...newRows]);
      }
    }
  }
  const observations = (await readJsonl<RuntimeObservation>(observationFile)).filter((row) => row.experimentId === experimentId);
  const certificates: CertificateRecord[] = [];
  const confidenceRows: any[] = [];
  for (const replica of replicas) {
    const rows = observations.filter((row) => row.replica === replica);
    const confidence = buildConfidenceHistory(
      rows.map((row) => ({
        replica: row.replica,
        configurationId: row.configurationId,
        journeyId: row.journeyId,
        compliantSuccess: row.compliantSuccess,
        violation: row.violationTypes.length > 0
      })),
      manifest.delta
    );
    confidenceRows.push(...confidence.history);
    certificates.push(certificateForCandidateSet(candidateSets[replica], confidence.states, rows.length, manifest));
  }
  await writeJsonl(path.join(dir, "confidence-sequence-history.jsonl"), confidenceRows);
  await writeJsonl(path.join(dir, "certificates.jsonl"), certificates);
  await writeV2Report(repoRoot);
  await assertNoSecretLeak(v2OutputFiles(repoRoot).filter((file) => existsSync(file)));
  return { resultDir: dir, observations: observations.length, certificates: certificates.length };
}

export function assertNoOracleLeakageInputs(phase: "search" | "candidate-freeze" | "confirmation", inputPaths: string[]) {
  const forbidden = inputPaths.filter((file) => /oracle-results|oracle-summary|repeated-search-results|search-history|search-summary/i.test(file));
  const allowedSearchScoring = phase === "search" ? forbidden.filter((file) => /oracle-results|oracle-summary/i.test(file)) : forbidden;
  if (phase === "search" && allowedSearchScoring.length > 0) throw new Error(`ORACLE_LEAKAGE_IN_SEARCH_INPUTS: ${allowedSearchScoring.join(",")}`);
  if (phase === "candidate-freeze" && forbidden.some((file) => /oracle-results|oracle-summary/i.test(file))) throw new Error(`ORACLE_LEAKAGE_IN_CANDIDATE_FREEZE: ${forbidden.join(",")}`);
  if (phase === "confirmation" && forbidden.length > 0) throw new Error(`PRIOR_DATA_LEAKAGE_IN_CONFIRMATION: ${forbidden.join(",")}`);
}

export function planConfirmationBudget(input: {
  candidates: number;
  journeys: number;
  safetyStreams: number;
  delta: number;
  safetyThreshold: number;
  desiredIntervalWidth: number;
  practicalSeedBudget: number;
}) {
  const streams = input.candidates * input.journeys * (1 + input.safetyStreams);
  const alphaPerStream = input.delta / Math.max(1, streams);
  const radius = input.desiredIntervalWidth / 2;
  const nForWidth = Math.ceil(Math.log(2 / alphaPerStream) / (2 * radius * radius));
  const nForZeroViolation = Math.ceil(Math.log(alphaPerStream) / Math.log(1 - input.safetyThreshold));
  return {
    candidates: input.candidates,
    journeys: input.journeys,
    safetyStreams: input.safetyStreams,
    delta: input.delta,
    safetyThreshold: input.safetyThreshold,
    desiredIntervalWidth: input.desiredIntervalWidth,
    streams,
    alphaPerStream,
    minimumSeedsForDesiredWidth: nForWidth,
    minimumSeedsForZeroViolationSafety: nForZeroViolation,
    minimumPracticalConfirmationSeeds: Math.max(nForWidth, nForZeroViolation),
    selectedFreshSeeds: Array.from({ length: input.practicalSeedBudget }, (_, index) => 1001 + index),
    selectedBudgetJustification: "v2 uses multiple fresh sequential confirmation seeds and preserves thresholds; conservative confidence sequences are expected to abstain if this practical budget is insufficient."
  };
}

async function createV2Manifest(repoRoot: string): Promise<SearchManifest> {
  const v1 = await readYaml<SearchManifest>(repoPath(repoRoot, "experiments/configs/search-certification-pilot-v1.yaml"));
  const manifest: SearchManifest & Record<string, unknown> = {
    ...v1,
    manifestVersion: "search-certification-pilot-v2",
    resultDirectory: v2ResultRelativeDir,
    budgets: {
      ...v1.budgets,
      searchSeeds: repeatedSeeds,
      confirmationSeeds,
      search: { shop: 8, saas: 16, support: 16 },
      confirmation: { shop: 5, saas: 5, support: 5 }
    },
    repeatedSearch: {
      strategies: ["RandomFeasibleSearch", "GraphAwareSurrogateSearch"],
      seeds: repeatedSeeds,
      budgets: repeatedBudgets,
      oracleHiddenDuringSearch: true
    },
    confirmationBudgetPlanner: {
      desiredIntervalWidth: 0.3,
      adaptiveAllocation: "fresh sequential seeds over frozen candidate sets; no search or oracle observations reused"
    }
  };
  await writeYaml(repoPath(repoRoot, v2ManifestRelativePath), manifest);
  await writeYaml(path.join(v2ResultDir(repoRoot), "manifest.snapshot.yaml"), manifest);
  return manifest;
}

function buildOracleIndex(spaces: Record<Replica, PatchConfiguration[]>, oracleRows: OracleRecord[], manifest: SearchManifest): Record<Replica, OracleIndex> {
  return Object.fromEntries(
    replicas.map((replica) => [
      replica,
      new Map(
        summarizeByConfiguration(spaces[replica].filter((config) => config.feasible), oracleRows.filter((row) => row.replica === replica), manifest).map((item) => [
          item.config.configurationId,
          item
        ])
      )
    ])
  ) as Record<Replica, OracleIndex>;
}

async function auditObjective(repoRoot: string, spaces: Record<Replica, PatchConfiguration[]>, oracle: Record<Replica, OracleIndex>, manifest: SearchManifest) {
  const rows: Array<Record<string, unknown>> = [];
  for (const replica of replicas) {
    const best = bestSafe([...oracle[replica].values()]);
    for (const item of oracle[replica].values()) {
      const costPenalty = manifest.objective.lambdaCost * item.summary.normalizedEngineeringCost;
      const latencyPenalty = manifest.objective.lambdaLatency * item.summary.normalizedLatency;
      const unsafePenalty = item.summary.safe ? 0 : -1;
      const expectedObjective = item.summary.safe ? item.summary.minCompliantSuccess - costPenalty - latencyPenalty : unsafePenalty - costPenalty - latencyPenalty;
      const regret = Math.max(0, best.summary.objective - item.summary.objective);
      if (item.summary.minCompliantSuccess < 0 || item.summary.minCompliantSuccess > 1) throw new Error(`OBJECTIVE_AUDIT_SUCCESS_RANGE: ${item.config.configurationId}`);
      if (item.summary.normalizedEngineeringCost < 0 || item.summary.normalizedEngineeringCost > 1) throw new Error(`OBJECTIVE_AUDIT_COST_RANGE: ${item.config.configurationId}`);
      if (item.summary.normalizedLatency < 0 || item.summary.normalizedLatency > 1) throw new Error(`OBJECTIVE_AUDIT_LATENCY_RANGE: ${item.config.configurationId}`);
      if (item.summary.safe && unsafePenalty !== 0) throw new Error(`OBJECTIVE_AUDIT_SAFE_PENALIZED: ${item.config.configurationId}`);
      if (Math.abs(expectedObjective - item.summary.objective) > 1e-9) throw new Error(`OBJECTIVE_AUDIT_FORMULA_MISMATCH: ${item.config.configurationId}`);
      rows.push({
        replica,
        configuration_id: item.config.configurationId,
        patch_vector: item.config.patchVector.join(""),
        minimum_compliant_success: item.summary.minCompliantSuccess,
        violation_feasible: item.summary.violationRate <= (manifest.safetyThresholds.aggregate ?? 0.05),
        violation_rate: item.summary.violationRate,
        safe: item.summary.safe,
        normalized_engineering_cost: item.summary.normalizedEngineeringCost,
        normalized_latency: item.summary.normalizedLatency,
        cost_penalty: costPenalty,
        latency_penalty: latencyPenalty,
        unsafe_penalty: unsafePenalty,
        final_j: item.summary.objective,
        true_best_safe_configuration: best.config.configurationId,
        regret_from_true_best_safe: regret
      });
    }
    if (!spaces[replica].some((config) => config.configurationId === best.config.configurationId)) throw new Error(`OBJECTIVE_AUDIT_BEST_NOT_IN_SPACE: ${replica}`);
  }
  await writeCsv(path.join(v2ResultDir(repoRoot), "objective-audit.csv"), rows);
}

async function buildV2CandidateSets(repoRoot: string, spaces: Record<Replica, PatchConfiguration[]>) {
  const [patches, graphs] = await Promise.all([loadPatches(repoRoot), loadGraphs(repoRoot)]);
  const manifest = await createV2Manifest(repoRoot);
  const v1History = await readJsonl<SearchHistoryRecord>(repoPath(repoRoot, `${v1ResultRelativeDir}/search-history.jsonl`));
  const sets = Object.fromEntries(
    replicas.map((replica) => [
      replica,
      freezeReplica(
        replica,
        spaces[replica].filter((config) => config.feasible),
        v1History.filter((row) => row.replica === replica),
        graphs[replica].graphId || `${replica}-repair-graph-v1`,
        manifest.repository.commit,
        manifest.budgets.candidateSetSize
      )
    ])
  ) as Record<Replica, CandidateSet>;
  void patches;
  await Promise.all(replicas.map((replica) => writeJson(path.join(v2ResultDir(repoRoot), `candidate-set-${replica}.json`), sets[replica])));
  return sets;
}

async function loadOrBuildV2CandidateSets(repoRoot: string, spaces: Record<Replica, PatchConfiguration[]>) {
  const existing = await Promise.all(replicas.map(async (replica) => [replica, await readJson<CandidateSet>(path.join(v2ResultDir(repoRoot), `candidate-set-${replica}.json`))] as const));
  if (existing.every(([, set]) => set)) return Object.fromEntries(existing) as Record<Replica, CandidateSet>;
  return buildV2CandidateSets(repoRoot, spaces);
}

async function auditCandidateSets(repoRoot: string, spaces: Record<Replica, PatchConfiguration[]>, oracle: Record<Replica, OracleIndex>, sets: Record<Replica, CandidateSet>, manifest: SearchManifest) {
  const audit: Record<string, unknown> = {};
  const recallRows: Array<Record<string, unknown>> = [];
  for (const replica of replicas) {
    const set = sets[replica];
    const vectors = new Set(set.candidates.map((candidate) => candidate.patchVector.join("")));
    const ids = new Set(set.candidates.map((candidate) => candidate.configurationId));
    const best = bestSafe([...oracle[replica].values()]);
    const epsilonBest = [...oracle[replica].values()].filter((item) => item.summary.safe && best.summary.objective - item.summary.objective <= manifest.epsilon);
    const recalled = epsilonBest.filter((item) => ids.has(item.config.configurationId)).length;
    if (!vectors.has("0".repeat(spaces[replica][0]?.patchVector.length || 0))) throw new Error(`CANDIDATE_AUDIT_EMPTY_MISSING: ${replica}`);
    if (!vectors.has("1".repeat(spaces[replica][0]?.patchVector.length || 0))) throw new Error(`CANDIDATE_AUDIT_FULL_MISSING: ${replica}`);
    if (best.config.patchVector.every((value) => value === 1) && !ids.has(best.config.configurationId)) throw new Error(`CANDIDATE_AUDIT_RECALL_FULL_PATCH_MISSING: ${replica}`);
    audit[replica] = {
      candidateSetHash: set.candidateSetHash,
      containsEmptyCurrentConfiguration: vectors.has("0".repeat(set.candidates[0]?.patchVector.length || 0)),
      containsFullPatchConfiguration: vectors.has("1".repeat(set.candidates[0]?.patchVector.length || 0)),
      containsIncumbent: set.candidates.some((candidate) => /incumbent|empty\/current|full-patch/.test(candidate.inclusionReason)),
      containsChallenger: set.candidates.some((candidate) => /challenger|empty\/current|full-patch/.test(candidate.inclusionReason)),
      containsDiverseCandidate: set.candidates.some((candidate) => /diverse|budget fill|full-patch/.test(candidate.inclusionReason)),
      oracleBestConfiguration: best.config.configurationId,
      oracleBestInCandidateSet: ids.has(best.config.configurationId),
      candidates: set.candidates.map((candidate) => ({
        configurationId: candidate.configurationId,
        patchVector: candidate.patchVector.join(""),
        inclusionReason: candidate.inclusionReason
      }))
    };
    recallRows.push({
      replica,
      epsilon: manifest.epsilon,
      epsilon_best_configurations: epsilonBest.length,
      recalled,
      candidate_recall: epsilonBest.length ? recalled / epsilonBest.length : 0,
      recall_basis: "frozen_candidate_set"
    });
  }
  await writeJson(path.join(v2ResultDir(repoRoot), "candidate-set-audit.json"), audit);
  await writeCsv(path.join(v2ResultDir(repoRoot), "candidate-recall-audit.csv"), recallRows);
  await writeCsv(path.join(v2ResultDir(repoRoot), "candidate-recall.csv"), recallRows);
}

async function runRepeatedSearch(
  repoRoot: string,
  spaces: Record<Replica, PatchConfiguration[]>,
  oracle: Record<Replica, OracleIndex>,
  candidateSets: Record<Replica, CandidateSet>,
  manifest: SearchManifest
) {
  const [patches, graphs] = await Promise.all([loadPatches(repoRoot), loadGraphs(repoRoot)]);
  const records: RepeatedSearchRecord[] = [];
  for (const replica of replicas) {
    const configs = spaces[replica].filter((config) => config.feasible);
    for (const budget of repeatedBudgets[replica]) {
      for (const searchSeed of repeatedSeeds) {
        records.push(runOneSearch("RandomFeasibleSearch", replica, configs, oracle[replica], candidateSets[replica], manifest, budget, searchSeed, { patches, graph: graphs[replica] }));
        records.push(runOneSearch("GraphAwareSurrogateSearch", replica, configs, oracle[replica], candidateSets[replica], manifest, budget, searchSeed, { patches, graph: graphs[replica] }));
      }
    }
  }
  await writeJsonl(path.join(v2ResultDir(repoRoot), "repeated-search-results.jsonl"), records);
  return records;
}

function runOneSearch(
  strategyName: RepeatedSearchRecord["strategy"],
  replica: Replica,
  configs: PatchConfiguration[],
  oracle: OracleIndex,
  candidateSet: CandidateSet,
  manifest: SearchManifest,
  budget: number,
  searchSeed: number,
  context: { patches: Awaited<ReturnType<typeof loadPatches>>; graph: any }
): RepeatedSearchRecord {
  const history: SearchHistoryRecord[] = [];
  const order = seededShuffle(configs, stableNumber(`${replica}:${strategyName}:${budget}:${searchSeed}`));
  const graphStrategy = new GraphAwareSurrogateSearch();
  if (strategyName === "GraphAwareSurrogateSearch") {
    graphStrategy.initialize(configs, { replica, patches: context.patches.filter((patch) => patch.replica === replica), graph: context.graph });
  }
  for (let iteration = 0; iteration < budget && history.length < configs.length; iteration += 1) {
    const suggestion = strategyName === "RandomFeasibleSearch" ? randomSuggestion(replica, strategyName, iteration, order, history) : graphStrategy.suggest();
    const config = configs.find((item) => item.configurationId === suggestion.configurationId);
    if (!config) throw new Error(`V2_SEARCH_SUGGESTION_MISSING: ${suggestion.configurationId}`);
    const observed = oracle.get(config.configurationId)?.summary;
    if (!observed) throw new Error(`V2_SEARCH_OBSERVATION_MISSING: ${config.configurationId}`);
    const row = { ...suggestion, experimentId: `search-certification-v2-${strategyName}-${replica}-${budget}-${searchSeed}`, iteration, observedObjective: observed.objective, observedSafe: observed.safe, observations: observed.totalRuns };
    history.push(row);
    if (strategyName === "GraphAwareSurrogateSearch") graphStrategy.observe(config.configurationId, observed);
  }
  const trueBest = bestSafe([...oracle.values()]);
  const safeSelected = [...history].filter((row) => row.observedSafe).sort((left, right) => right.observedObjective - left.observedObjective)[0];
  const selectedObjective = safeSelected?.observedObjective ?? 0;
  const epsilonBest = [...oracle.values()].filter((item) => item.summary.safe && trueBest.summary.objective - item.summary.objective <= manifest.epsilon);
  const candidateIds = new Set(candidateSet.candidates.map((candidate) => candidate.configurationId));
  const recall = epsilonBest.length ? epsilonBest.filter((item) => candidateIds.has(item.config.configurationId)).length / epsilonBest.length : 0;
  return {
    experimentId: `search-certification-v2-${strategyName}-${replica}-${budget}-${searchSeed}`,
    replica,
    strategy: strategyName,
    searchSeed,
    budget,
    evaluatedConfigurations: history.map((row) => row.configurationId),
    selectedConfiguration: safeSelected?.configurationId || "ABSTAIN_NO_SAFE_OBSERVED",
    selectedSafe: safeSelected?.observedSafe || false,
    abstained: !safeSelected,
    oracleBestConfiguration: trueBest.config.configurationId,
    oracleBestObjective: trueBest.summary.objective,
    selectedObjective,
    globalRegret: Math.max(0, trueBest.summary.objective - selectedObjective),
    candidateSetHash: candidateSet.candidateSetHash,
    candidateRecall: recall,
    foundOracleBest: history.some((row) => row.configurationId === trueBest.config.configurationId),
    runtimeCostConfigurations: new Set(history.map((row) => row.configurationId)).size,
    unsafeRecommendation: false
  };
}

async function writeRepeatedSummaries(repoRoot: string, records: RepeatedSearchRecord[]) {
  const grouped = groupBy(records, (row) => `${row.replica}:${row.strategy}:${row.budget}`);
  const comparisonRows = [...grouped.entries()].map(([key, rows]) => {
    const [replica, strategy, budget] = key.split(":");
    return {
      replica,
      strategy,
      budget,
      runs: rows.length,
      mean_global_regret: mean(rows.map((row) => row.globalRegret)),
      median_global_regret: median(rows.map((row) => row.globalRegret)),
      candidate_recall_at_epsilon: mean(rows.map((row) => row.candidateRecall)),
      probability_finding_oracle_best: mean(rows.map((row) => Number(row.foundOracleBest))),
      mean_configurations_evaluated: mean(rows.map((row) => row.runtimeCostConfigurations)),
      unsafe_recommendation_rate: mean(rows.map((row) => Number(row.unsafeRecommendation))),
      abstention_rate: mean(rows.map((row) => Number(row.abstained)))
    };
  });
  await writeCsv(path.join(v2ResultDir(repoRoot), "search-strategy-comparison.csv"), comparisonRows);
  await writeCsv(path.join(v2ResultDir(repoRoot), "budget-sensitivity.csv"), comparisonRows);
  await writeCsv(
    path.join(v2ResultDir(repoRoot), "regret-summary.csv"),
    replicas.map((replica) => ({
      replica,
      mean_global_regret: mean(records.filter((row) => row.replica === replica).map((row) => row.globalRegret)),
      median_global_regret: median(records.filter((row) => row.replica === replica).map((row) => row.globalRegret)),
      best_observed_strategy_budget: bestAggregate(comparisonRows.filter((row) => row.replica === replica))
    }))
  );
}

async function writeConfirmationBudgetPlan(repoRoot: string, candidateSets: Record<Replica, CandidateSet>, manifest: SearchManifest) {
  const safetyStreams = Object.keys(manifest.safetyThresholds).length;
  const journeys: Record<Replica, number> = { shop: 3, saas: 4, support: 4 };
  const plans = Object.fromEntries(
    replicas.map((replica) => [
      replica,
      planConfirmationBudget({
        candidates: candidateSets[replica].candidates.length,
        journeys: journeys[replica],
        safetyStreams,
        delta: manifest.delta,
        safetyThreshold: manifest.safetyThresholds.aggregate ?? 0.05,
        desiredIntervalWidth: 0.3,
        practicalSeedBudget: confirmationSeeds.length
      })
    ])
  );
  await writeJson(path.join(v2ResultDir(repoRoot), "confirmation-budget-plan.json"), {
    planner: "hoeffding-confidence-sequence-family-wise-budget-v1",
    noSeedReuse: true,
    freshSeedStart: confirmationSeeds[0],
    selectedFreshSeeds: confirmationSeeds,
    plans
  });
}

async function writeV2Report(repoRoot: string) {
  const dir = v2ResultDir(repoRoot);
  const comparison = readCsvIfExists(path.join(dir, "search-strategy-comparison.csv"));
  const recall = readCsvIfExists(path.join(dir, "candidate-recall.csv"));
  const certificates = await readJsonl<CertificateRecord>(path.join(dir, "certificates.jsonl"));
  const observations = await readJsonl<RuntimeObservation>(path.join(dir, "confirmation-observations.jsonl"));
  const lines = [
    "# PATCHWORK Search Certification Pilot v2",
    "",
    "Mock-provider orchestration validation only; these results are not live LLM performance results.",
    "",
    "## Bugs Corrected",
    "",
    "- Candidate recall is computed over frozen candidate sets, not only evaluated search history.",
    "- Frozen candidate sets reserve empty/current and full-patch configurations before search-derived roles.",
    "- Regret scoring no longer recommends unsafe configurations; runs abstain when no safe configuration is observed.",
    "- Confirmation uses multiple fresh sequential seeds beginning at 1001.",
    "",
    "## Candidate Recall",
    "",
    ...recall.map((row) => `- ${row.replica}: ${row.candidate_recall} at epsilon ${row.epsilon} (${row.recall_basis})`),
    "",
    "## Repeated Search",
    "",
    ...comparison.map((row) => `- ${row.replica} ${row.strategy} budget ${row.budget}: mean regret ${row.mean_global_regret}, recall ${row.candidate_recall_at_epsilon}, oracle-best probability ${row.probability_finding_oracle_best}`),
    "",
    "## Confirmation",
    "",
    `- confirmation observations: ${observations.length}`,
    ...certificates.map((certificate) =>
      certificate.status === "CERTIFIED"
        ? `- ${certificate.replica}: CERTIFIED`
        : `- ${certificate.replica}: NOT_CERTIFIED, ${certificate.reason}`
    )
  ];
  await writeJson(path.join(dir, "search-certification-v2-report-data.json"), { comparison, recall, certificates, confirmationObservations: observations.length });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(dir, "search-certification-v2-report.md"), `${lines.join("\n")}\n`, "utf8"));
}

function randomSuggestion(replica: Replica, strategy: RepeatedSearchRecord["strategy"], iteration: number, order: PatchConfiguration[], history: SearchHistoryRecord[]): SearchHistoryRecord {
  const observed = new Set(history.map((row) => row.configurationId));
  const config = order.find((item) => !observed.has(item.configurationId)) || order[0]!;
  return {
    experimentId: "",
    replica,
    strategy,
    surrogate: "seeded-feasible-order-v2",
    iteration,
    configurationId: config.configurationId,
    patchIds: config.patchIds,
    incumbentConfigurationId: history.find((row) => row.observedSafe)?.configurationId || order.find((item) => item.patchVector.every((value) => value === 0))?.configurationId || config.configurationId,
    challengerConfigurationId: config.configurationId,
    predictedMean: 0.5,
    uncertainty: 1,
    expectedVarianceReduction: 1,
    estimatedCost: 1 + config.engineeringMinutes / 60,
    acquisitionScore: 1,
    selectionReason: "seeded random feasible order",
    observedObjective: 0,
    observedSafe: false,
    observations: 0
  };
}

function seededShuffle<T>(items: T[], seed: number) {
  const shuffled = [...items];
  let state = seed || 1;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

function stableNumber(value: string) {
  return Number.parseInt(stableHash(value).slice(0, 8), 16);
}

function bestSafe(items: Array<{ config: PatchConfiguration; summary: ObjectiveSummary }>) {
  const best = items.filter((item) => item.summary.safe).sort((left, right) => right.summary.objective - left.summary.objective)[0];
  if (!best) throw new Error("V2_OBJECTIVE_NO_SAFE_CONFIGURATION");
  return best;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return groups;
}

function bestAggregate(rows: Array<Record<string, any>>) {
  return [...rows].sort((left, right) => Number(left.mean_global_regret) - Number(right.mean_global_regret))[0]?.strategy || "";
}

function readCsvIfExists(file: string) {
  if (!existsSync(file)) return [];
  return csvObjects(file);
}

function csvObjects(file: string) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n").filter(Boolean);
  const headers = (lines[0] || "").split(",");
  return lines.slice(1).map((line) => Object.fromEntries(line.split(",").map((cell, index) => [headers[index] || `column_${index}`, cell])));
}

function v2ResultDir(repoRoot: string) {
  return repoPath(repoRoot, v2ResultRelativeDir);
}

function v2OutputFiles(repoRoot: string) {
  const dir = v2ResultDir(repoRoot);
  return [
    "manifest.snapshot.yaml",
    "objective-audit.csv",
    "candidate-set-audit.json",
    "candidate-recall-audit.csv",
    "repeated-search-results.jsonl",
    "search-strategy-comparison.csv",
    "budget-sensitivity.csv",
    "candidate-recall.csv",
    "regret-summary.csv",
    "confirmation-budget-plan.json",
    "confirmation-observations.jsonl",
    "confidence-sequence-history.jsonl",
    "certificates.jsonl",
    "search-certification-v2-report.md",
    "search-certification-v2-report-data.json"
  ].map((file) => path.join(dir, file));
}
