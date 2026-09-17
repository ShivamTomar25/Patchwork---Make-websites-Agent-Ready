import type { RuntimeOutcome } from "../../repair/src/runtime/runtime-runner.js";

export type Replica = "shop" | "saas" | "support";

export type PatchMetadata = {
  patchId: string;
  replica: Replica;
  journeyIds: string[];
  targetNodeId: string;
  operator: string;
  dependencies: string[];
  conflicts: string[];
  sourceFiles: string[];
  sourceDiff: string;
  rollbackDiff: string;
  estimatedEngineeringMinutes: number;
  templateVersion: string;
};

export type PatchConfiguration = {
  configurationId: string;
  replica: Replica;
  patchVector: number[];
  patchIds: string[];
  dependencies: string[];
  conflicts: string[];
  engineeringMinutes: number;
  filesChanged: number;
  feasible: boolean;
  rejectionReasons: string[];
  hash: string;
};

export type SearchManifest = {
  manifestVersion: string;
  resultDirectory: string;
  repository: {
    commit: string;
    dirty: string;
  };
  graphVersions: Record<Replica, string>;
  contractVersions: Record<Replica, string>;
  patchVersion: string;
  patchHashes: Record<string, string>;
  feasibleSpaceHashes: Record<Replica, string>;
  objective: {
    lambdaCost: number;
    lambdaLatency: number;
  };
  safetyThresholds: Record<string, number>;
  epsilon: number;
  delta: number;
  budgets: {
    oracleSeeds: number[];
    searchSeeds: number[];
    confirmationSeeds: number[];
    search: Record<Replica, number>;
    confirmation: Record<Replica, number>;
    candidateSetSize: number;
    maximumRuntimeMinutes: number;
  };
  concurrency: 1;
  mode: "mock";
  liveModeEnabled: false;
};

export type ObjectiveSummary = {
  minCompliantSuccess: number;
  violationRate: number;
  normalizedEngineeringCost: number;
  normalizedLatency: number;
  objective: number;
  safe: boolean;
  medianLatencyMs: number;
  totalRuns: number;
};

export type RuntimeObservation = {
  experimentId: string;
  stage: "oracle" | "search" | "confirmation";
  replica: Replica;
  configurationId: string;
  patchIds: string[];
  seed: number;
  journeyId: string;
  cleanRegression: boolean;
  compliantSuccess: boolean;
  verifiedSuccess: boolean;
  violations: string[];
  violationTypes: string[];
  latencyMs: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  resultPath: string;
  outcome: RuntimeOutcome;
};

export type OracleRecord = RuntimeObservation & {
  objectiveAfterConfiguration?: ObjectiveSummary;
};

export type SearchHistoryRecord = {
  experimentId: string;
  replica: Replica;
  strategy: "GraphAwareSurrogateSearch" | "RandomFeasibleSearch";
  surrogate: string;
  iteration: number;
  configurationId: string;
  patchIds: string[];
  incumbentConfigurationId: string;
  challengerConfigurationId: string;
  predictedMean: number;
  uncertainty: number;
  expectedVarianceReduction: number;
  estimatedCost: number;
  acquisitionScore: number;
  selectionReason: string;
  observedObjective: number;
  observedSafe: boolean;
  observations: number;
};

export type CandidateSet = {
  replica: Replica;
  frozenAt: string;
  candidateSetHash: string;
  codeVersion: string;
  graphVersion: string;
  candidates: Array<PatchConfiguration & { inclusionReason: string }>;
  searchDataIncludedInConfirmationStatistics: false;
  immutable: true;
};

export type ConfidenceState = {
  streamId: string;
  replica: Replica;
  configurationId: string;
  journeyId: string;
  metric: "compliant-success" | "violation";
  n: number;
  successes: number;
  lower: number;
  upper: number;
  alphaAtN: number;
  streamAlpha: number;
};

export type CertificateRecord =
  | {
      status: "CERTIFIED";
      replica: Replica;
      selectedConfiguration: string[];
      candidateSetHash: string;
      candidateSetScope: true;
      epsilon: number;
      delta: number;
      safetyThresholdsSatisfied: true;
      objectiveLowerBound: number;
      maximumChallengerUpperBound: number;
      confirmationRuns: number;
      searchDataReused: false;
      humanApprovalRequired: true;
    }
  | {
      status: "NOT_CERTIFIED";
      replica: Replica;
      reason: string;
      candidateSetHash: string;
      confirmationRuns: number;
      deploymentAllowed: false;
      humanApprovalRequired: true;
    };
