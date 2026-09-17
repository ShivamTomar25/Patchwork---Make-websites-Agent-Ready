import type { ObjectiveSummary, PatchConfiguration, SearchHistoryRecord } from "../types.js";
import { scoreAcquisition } from "../acquisition/index.js";
import { graphAwareFeatures, type FeatureContext } from "./features.js";
import { BayesianRidgeSurrogate } from "./model.js";

export interface SearchStrategy {
  initialize(configurations: PatchConfiguration[], context: FeatureContext): void;
  suggest(): SearchHistoryRecord;
  observe(configurationId: string, summary: ObjectiveSummary): void;
  stop(): boolean;
  getShortlist(): PatchConfiguration[];
}

export class RandomFeasibleSearch implements SearchStrategy {
  private configurations: PatchConfiguration[] = [];
  private observed = new Set<string>();
  private iteration = 0;

  initialize(configurations: PatchConfiguration[]) {
    this.configurations = configurations.filter((config) => config.feasible);
  }

  suggest(): SearchHistoryRecord {
    const remaining = this.configurations.filter((config) => !this.observed.has(config.configurationId));
    const configuration = remaining[this.iteration % Math.max(1, remaining.length)] || this.configurations[0]!;
    return historyShell("RandomFeasibleSearch", "bayesian-ridge-graph-aware-v1", this.iteration, configuration, configuration, configuration, 0.5, 1, 1, 1, "deterministic random-feasible order");
  }

  observe(configurationId: string) {
    this.observed.add(configurationId);
    this.iteration += 1;
  }

  stop() {
    return this.observed.size >= this.configurations.length;
  }

  getShortlist() {
    return this.configurations.filter((config) => this.observed.has(config.configurationId)).slice(0, 5);
  }
}

export class GraphAwareSurrogateSearch implements SearchStrategy {
  private configurations: PatchConfiguration[] = [];
  private context!: FeatureContext;
  private observed = new Map<string, ObjectiveSummary>();
  private iteration = 0;
  private readonly surrogate = new BayesianRidgeSurrogate();
  private coldStart: PatchConfiguration[] = [];
  private lastSuggestion?: SearchHistoryRecord;

  initialize(configurations: PatchConfiguration[], context: FeatureContext) {
    this.configurations = configurations.filter((config) => config.feasible);
    this.context = context;
    this.coldStart = coldStartConfigurations(this.configurations);
  }

  suggest(): SearchHistoryRecord {
    const remaining = this.configurations.filter((config) => !this.observed.has(config.configurationId));
    const cold = this.coldStart.find((config) => !this.observed.has(config.configurationId));
    const observedRows = [...this.observed.entries()];
    this.surrogate.fit(
      observedRows.map(([configurationId]) => graphAwareFeatures(this.requireConfig(configurationId), this.context)),
      observedRows.map(([, summary]) => summary.objective)
    );
    const incumbent = this.incumbent();
    const challenger = this.challenger(remaining);
    if (cold) {
      const prediction = this.surrogate.predict(graphAwareFeatures(cold, this.context));
      this.lastSuggestion = historyShell("GraphAwareSurrogateSearch", this.surrogate.name, this.iteration, cold, incumbent, challenger, prediction.mean, prediction.uncertainty, prediction.uncertainty, 1 + cold.engineeringMinutes / 60, "cold-start coverage");
      return this.lastSuggestion;
    }
    const scored = remaining
      .map((config) => scoreAcquisition(config, this.surrogate.predict(graphAwareFeatures(config, this.context)), incumbent, challenger, this.iteration))
      .sort((left, right) => right.score - left.score)[0];
    const selected = scored || scoreAcquisition(remaining[0] || incumbent, this.surrogate.predict(graphAwareFeatures(remaining[0] || incumbent, this.context)), incumbent, challenger, this.iteration);
    this.lastSuggestion = historyShell(
      "GraphAwareSurrogateSearch",
      this.surrogate.name,
      this.iteration,
      selected.configuration,
      selected.incumbent,
      selected.challenger,
      selected.prediction.mean,
      selected.prediction.uncertainty,
      selected.expectedVarianceReduction,
      selected.estimatedCost,
      selected.reason,
      selected.score
    );
    return this.lastSuggestion;
  }

  observe(configurationId: string, summary: ObjectiveSummary) {
    this.observed.set(configurationId, summary);
    this.iteration += 1;
  }

  stop() {
    return this.observed.size >= this.configurations.length;
  }

  getShortlist() {
    return [...this.observed.entries()]
      .map(([configurationId, summary]) => ({ config: this.requireConfig(configurationId), summary }))
      .sort((left, right) => right.summary.objective - left.summary.objective)
      .map((item) => item.config)
      .slice(0, 5);
  }

  private incumbent() {
    const safe = [...this.observed.entries()]
      .filter(([, summary]) => summary.safe)
      .sort((left, right) => right[1].objective - left[1].objective)[0];
    return safe ? this.requireConfig(safe[0]) : this.configurations.find((config) => config.patchVector.every((value) => value === 0)) || this.configurations[0]!;
  }

  private challenger(remaining: PatchConfiguration[]) {
    return (
      remaining
        .map((config) => ({ config, prediction: this.surrogate.predict(graphAwareFeatures(config, this.context)) }))
        .sort((left, right) => right.prediction.mean + right.prediction.uncertainty - (left.prediction.mean + left.prediction.uncertainty))[0]?.config ||
      this.incumbent()
    );
  }

  private requireConfig(configurationId: string) {
    const config = this.configurations.find((item) => item.configurationId === configurationId);
    if (!config) throw new Error(`SEARCH_CONFIG_MISSING: ${configurationId}`);
    return config;
  }
}

export function coldStartConfigurations(configurations: PatchConfiguration[]) {
  const result: PatchConfiguration[] = [];
  const add = (config: PatchConfiguration | undefined) => {
    if (config && !result.some((item) => item.configurationId === config.configurationId)) result.push(config);
  };
  add(configurations.find((config) => config.patchVector.every((value) => value === 0)));
  for (let index = 0; index < (configurations[0]?.patchVector.length || 0); index += 1) {
    add(configurations.find((config) => config.patchVector[index] === 1 && config.patchVector.reduce((sum, value) => sum + value, 0) === 1));
  }
  for (let index = 0; index < (configurations[0]?.patchVector.length || 0) - 1; index += 1) {
    add(configurations.find((config) => config.patchVector[index] === 1 && config.patchVector[index + 1] === 1 && config.patchVector.reduce((sum, value) => sum + value, 0) === 2));
  }
  add(configurations.find((config) => config.patchVector.every((value) => value === 1)));
  add(maximinHamming(configurations, result));
  return result;
}

function maximinHamming(configurations: PatchConfiguration[], selected: PatchConfiguration[]) {
  return configurations
    .filter((config) => !selected.some((item) => item.configurationId === config.configurationId))
    .map((config) => ({ config, distance: Math.min(...selected.map((item) => hamming(config.patchVector, item.patchVector))) }))
    .sort((left, right) => right.distance - left.distance)[0]?.config;
}

function hamming(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + Number(value !== right[index]), 0);
}

function historyShell(
  strategy: SearchHistoryRecord["strategy"],
  surrogate: string,
  iteration: number,
  configuration: PatchConfiguration,
  incumbent: PatchConfiguration,
  challenger: PatchConfiguration,
  predictedMean: number,
  uncertainty: number,
  expectedVarianceReduction: number,
  estimatedCost: number,
  reason: string,
  acquisitionScore = expectedVarianceReduction / Math.max(0.001, estimatedCost)
): SearchHistoryRecord {
  return {
    experimentId: "",
    replica: configuration.replica,
    strategy,
    surrogate,
    iteration,
    configurationId: configuration.configurationId,
    patchIds: configuration.patchIds,
    incumbentConfigurationId: incumbent.configurationId,
    challengerConfigurationId: challenger.configurationId,
    predictedMean,
    uncertainty,
    expectedVarianceReduction,
    estimatedCost,
    acquisitionScore,
    selectionReason: reason,
    observedObjective: 0,
    observedSafe: false,
    observations: 0
  };
}
