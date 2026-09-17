import path from "node:path";
import type { CandidateSet, PatchConfiguration, Replica, SearchHistoryRecord } from "../types.js";
import { validateConfigurationSpaces } from "../configuration-space/index.js";
import { resultDir, stableHash, writeJson } from "../storage/files.js";
import { loadGraphs, loadSearchManifest, resultFiles } from "../storage/loaders.js";
import { readJsonl } from "../storage/files.js";

export async function freezeCandidateSets(repoRoot: string) {
  const spaces = await validateConfigurationSpaces(repoRoot);
  const manifest = await loadSearchManifest(repoRoot);
  const graphs = await loadGraphs(repoRoot);
  const history = await readJsonl<SearchHistoryRecord>(resultFiles(repoRoot).searchHistory);
  const sets: Record<Replica, CandidateSet> = {
    shop: freezeReplica("shop", spaces.shop, history.filter((row) => row.replica === "shop"), graphs.shop.graphId, manifest.repository.commit, manifest.budgets.candidateSetSize),
    saas: freezeReplica("saas", spaces.saas, history.filter((row) => row.replica === "saas"), graphs.saas.graphId, manifest.repository.commit, manifest.budgets.candidateSetSize),
    support: freezeReplica("support", spaces.support, history.filter((row) => row.replica === "support"), graphs.support.graphId, manifest.repository.commit, manifest.budgets.candidateSetSize)
  };
  await Promise.all(
    Object.values(sets).map((set) => writeJson(path.join(resultDir(repoRoot), `candidate-set-${set.replica}.json`), set))
  );
  return sets;
}

export function freezeReplica(replica: Replica, configs: PatchConfiguration[], history: SearchHistoryRecord[], graphVersion: string, codeVersion: string, size: number): CandidateSet {
  const selected: Array<PatchConfiguration & { inclusionReason: string }> = [];
  const add = (config: PatchConfiguration | undefined, inclusionReason: string) => {
    if (!config || selected.some((item) => item.configurationId === config.configurationId)) return;
    selected.push({ ...config, inclusionReason });
  };
  add(configs.find((config) => config.patchVector.every((value) => value === 0)), "empty/current configuration");
  add(configs.find((config) => config.patchVector.every((value) => value === 1)), "full-patch configuration");
  const ranked = [...history].sort((left, right) => right.observedObjective - left.observedObjective);
  const conservative = ranked.find((row) => row.observedSafe) || ranked[0];
  add(configs.find((config) => config.configurationId === conservative?.configurationId), "conservative incumbent");
  const challenger = [...history].sort((left, right) => right.predictedMean + right.uncertainty - (left.predictedMean + left.uncertainty))[0];
  add(configs.find((config) => config.configurationId === challenger?.challengerConfigurationId || config.configurationId === challenger?.configurationId), "optimistic challenger");
  add(configs.find((config) => config.configurationId === ranked.find((row) => row.configurationId !== conservative?.configurationId)?.configurationId), "diverse high-value configuration");
  for (const config of configs) add(config, "budget fill");
  const candidates = selected.slice(0, size);
  const withoutHash = {
    replica,
    frozenAt: new Date().toISOString(),
    candidateSetHash: "",
    codeVersion,
    graphVersion,
    candidates,
    searchDataIncludedInConfirmationStatistics: false as const,
    immutable: true as const
  };
  return { ...withoutHash, candidateSetHash: stableHash(withoutHash) };
}
