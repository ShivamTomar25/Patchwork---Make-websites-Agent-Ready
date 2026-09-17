import { describe, expect, it } from "vitest";
import path from "node:path";
import type { PatchConfiguration, PatchMetadata, SearchManifest } from "../src/types.js";
import { buildReplicaSpace } from "../src/configuration-space/index.js";
import { graphAwareFeatures } from "../src/surrogate/features.js";
import { BayesianRidgeSurrogate } from "../src/surrogate/model.js";
import { scoreAcquisition } from "../src/acquisition/index.js";
import { coldStartConfigurations } from "../src/surrogate/search-strategy.js";
import { freezeReplica } from "../src/candidate-freezer/index.js";
import { buildConfidenceHistory, certifiedSafe, hoeffdingBounds, objectiveBounds, plausiblySafe } from "../src/confidence-sequences/index.js";
import { certificateForCandidateSet, certificateScopeText } from "../src/certificate/index.js";
import { stableHash, redact } from "../src/storage/files.js";
import { assertPilotRuntimeEnvironment } from "../../repair/src/runtime/safety.js";
import { assertNoOracleLeakageInputs, planConfirmationBudget } from "../src/v2/debug-runner.js";
import {
  classifyFullConfirmationInfrastructureFailure,
  fullConfirmationReplicaStatusForRows,
  fullConfirmationSeedRanges,
  selectValidConfirmationObservations,
  verifyFrozenInputs
} from "../src/v2/full-confirmation.js";
import type { RuntimeObservation } from "../src/types.js";

const graph = {
  graphId: "test-graph",
  contractVersion: "pilot-v1",
  nodes: [
    { id: "test:auth", type: "AUTH_SCOPE", defectId: "D1" },
    { id: "test:api", type: "API_OPERATION", defectId: "D2", source: "/api/test" },
    { id: "test:db", type: "DATABASE_STATE", defectId: "D3", source: "orders" }
  ],
  edges: [{ source: "test:auth", target: "test:api" }]
};

describe("search certification", () => {
  it("builds finite feasible spaces and rejects direct conflicts", () => {
    const patches = [patch("p1", "D1", ["AUTH_SCOPE"], []), patch("p2", "D2", [], ["p1"]), patch("p3", "D3", [], [])];
    const space = buildReplicaSpace("shop", patches, graph);
    expect(space).toHaveLength(8);
    expect(space.some((config) => config.patchVector.join("") === "000")).toBe(true);
    expect(space.some((config) => config.patchVector.join("") === "111")).toBe(true);
    expect(space.find((config) => config.patchIds.includes("p1") && config.patchIds.includes("p2"))?.feasible).toBe(false);
  });

  it("constructs graph-aware features with interactions and cost", () => {
    const patches = [patch("p1", "D1", ["AUTH_SCOPE"], []), patch("p2", "D2", [], [])];
    const config = buildReplicaSpace("shop", patches, graph).find((item) => item.patchVector.join("") === "11")!;
    const features = graphAwareFeatures(config, { replica: "shop", patches, graph });
    expect(features[0]).toBe(1);
    expect(features.some((value) => value > 0)).toBe(true);
  });

  it("covers cold start patches and ranks acquisitions", () => {
    const patches = [patch("p1", "D1", ["AUTH_SCOPE"], []), patch("p2", "D2", [], []), patch("p3", "D3", [], [])];
    const space = buildReplicaSpace("shop", patches, graph).filter((config) => config.feasible);
    const cold = coldStartConfigurations(space);
    expect(new Set(cold.flatMap((config) => config.patchIds))).toEqual(new Set(["p1", "p2", "p3"]));
    const record = scoreAcquisition(space[1]!, { mean: 0.8, uncertainty: 0.4, covariance: [[0.16]], surrogate: "bayesian-ridge-graph-aware-v1" }, space[0]!, space[1]!, 1);
    expect(record.score).toBeGreaterThan(0);
  });

  it("returns probabilistic surrogate predictions", () => {
    const surrogate = new BayesianRidgeSurrogate();
    surrogate.fit(
      [
        [0, 0],
        [1, 0],
        [1, 1]
      ],
      [0, 0.5, 1]
    );
    const prediction = surrogate.predict([1, 1]);
    expect(prediction.surrogate).toBe("bayesian-ridge-graph-aware-v1");
    expect(prediction.uncertainty).toBeGreaterThan(0);
    expect(prediction.covariance[0]?.[0]).toBeGreaterThan(0);
  });

  it("freezes immutable candidate sets with stable hashes and scope wording", () => {
    const patches = [patch("p1", "D1", ["AUTH_SCOPE"], []), patch("p2", "D2", [], [])];
    const space = buildReplicaSpace("shop", patches, graph).filter((config) => config.feasible);
    const set = freezeReplica("shop", space, [{ ...history(space[3]!), observedObjective: 0.9, observedSafe: true }], "graph", "code", 5);
    expect(set.immutable).toBe(true);
    expect(set.searchDataIncludedInConfirmationStatistics).toBe(false);
    expect(set.candidateSetHash).toBe(stableHash({ ...set, candidateSetHash: "" }));
    expect(() => {
      const changed = { ...set, candidates: set.candidates.slice(1) };
      if (stableHash({ ...changed, candidateSetHash: "" }) === set.candidateSetHash) throw new Error("hash did not change");
    }).not.toThrow();
  });

  it("freezes empty and full-patch configurations before search-derived candidates", () => {
    const patches = [patch("p1", "D1", [], []), patch("p2", "D2", [], []), patch("p3", "D3", [], [])];
    const space = buildReplicaSpace("shop", patches, graph).filter((config) => config.feasible);
    const set = freezeReplica(
      "shop",
      space,
      space.slice(1, 6).map((config, index) => ({ ...history(config), iteration: index, observedObjective: 1 - index / 10, observedSafe: false })),
      "graph",
      "code",
      5
    );
    expect(set.candidates.some((candidate) => candidate.patchVector.every((value) => value === 0))).toBe(true);
    expect(set.candidates.some((candidate) => candidate.patchVector.every((value) => value === 1))).toBe(true);
  });

  it("keeps seed ranges disjoint and avoids search-data reuse", () => {
    const manifest = testManifest();
    expect(intersects(manifest.budgets.oracleSeeds, manifest.budgets.searchSeeds)).toBe(false);
    expect(intersects(manifest.budgets.searchSeeds, manifest.budgets.confirmationSeeds)).toBe(false);
    expect(intersects(manifest.budgets.oracleSeeds, manifest.budgets.confirmationSeeds)).toBe(false);
  });

  it("computes time-uniform confidence bounds and family-wise alpha accounting", () => {
    const observations = [
      { replica: "shop" as const, configurationId: "c1", journeyId: "J1", compliantSuccess: true, violation: false },
      { replica: "shop" as const, configurationId: "c1", journeyId: "J1", compliantSuccess: true, violation: false }
    ];
    const result = buildConfidenceHistory(observations, 0.05);
    expect(result.totalAllocatedAlpha).toBeLessThanOrEqual(0.05);
    expect(result.states.every((state) => state.lower >= 0 && state.upper <= 1)).toBe(true);
    const first = hoeffdingBounds(1, 1, 0.01);
    const second = hoeffdingBounds(2, 2, 0.01 / 6);
    expect(second.upper - second.lower).toBeLessThanOrEqual(first.upper - first.lower);
    expect(certifiedSafe(result.states, "c1", 0.05)).toBe(false);
    expect(plausiblySafe(result.states, "c1", 0.05)).toBe(true);
  });

  it("serializes NOT_CERTIFIED when budget exhausts before epsilon stopping", () => {
    const config = configuration("shop-1", "shop", [1], ["p1"]);
    const set = {
      replica: "shop" as const,
      frozenAt: "2026-08-04T00:00:00.000Z",
      candidateSetHash: "hash",
      codeVersion: "code",
      graphVersion: "graph",
      candidates: [{ ...config, inclusionReason: "full-patch configuration" }],
      searchDataIncludedInConfirmationStatistics: false as const,
      immutable: true as const
    };
    const confidence = buildConfidenceHistory([{ replica: "shop", configurationId: "shop-1", journeyId: "J1", compliantSuccess: true, violation: false }], 0.05);
    const certificate = certificateForCandidateSet(set, confidence.states, 1, testManifest());
    expect(certificate.status).toBe("NOT_CERTIFIED");
    expect(certificateScopeText(certificate)).toContain("scope");
    expect(objectiveBounds(confidence.states, "shop-1", 0, 0).upper).toBeGreaterThanOrEqual(0);
  });

  it("guards pilot databases and redacts secrets", () => {
    const previous = process.env.PILOT_ALLOW_RESET;
    process.env.PILOT_ALLOW_RESET = "true";
    expect(() =>
      assertPilotRuntimeEnvironment({
        SHOP_DATABASE_URL: "postgresql://user:pass@localhost:5432/patchwork_shop_pilot",
        SAAS_DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/patchwork_saas_pilot",
        SUPPORT_DATABASE_URL: "postgresql://user:pass@localhost:5432/patchwork_support_pilot",
        AGENTS_DATABASE_URL: "postgresql://user:pass@localhost:5432/patchwork_agents_pilot",
        RESEARCH_PILOT_DATABASES: "1"
      })
    ).not.toThrow();
    expect(() =>
      assertPilotRuntimeEnvironment({
        SHOP_DATABASE_URL: "postgresql://user:pass@db.example.com:5432/patchwork_shop_pilot",
        SAAS_DATABASE_URL: "postgresql://user:pass@localhost:5432/patchwork_saas_pilot",
        SUPPORT_DATABASE_URL: "postgresql://user:pass@localhost:5432/patchwork_support_pilot",
        AGENTS_DATABASE_URL: "postgresql://user:pass@localhost:5432/patchwork_agents_pilot",
        RESEARCH_PILOT_DATABASES: "1"
      })
    ).toThrow(/host must be local/);
    expect(redact({ password: "secret", nested: { accessToken: "token" } })).toEqual({ password: "[REDACTED]", nested: { accessToken: "[REDACTED]" } });
    if (previous === undefined) delete process.env.PILOT_ALLOW_RESET;
    else process.env.PILOT_ALLOW_RESET = previous;
  });

  it("rejects oracle/search leakage across v2 search, freezing, and confirmation phases", () => {
    expect(() => assertNoOracleLeakageInputs("search", ["experiments/results/search-certification-pilot-v1/oracle-results.jsonl"])).toThrow(/ORACLE_LEAKAGE/);
    expect(() => assertNoOracleLeakageInputs("candidate-freeze", ["oracle-summary.csv"])).toThrow(/ORACLE_LEAKAGE/);
    expect(() => assertNoOracleLeakageInputs("confirmation", ["search-history.jsonl"])).toThrow(/PRIOR_DATA_LEAKAGE/);
    expect(() => assertNoOracleLeakageInputs("confirmation", ["candidate-set-shop.json"])).not.toThrow();
  });

  it("plans confirmation with multiple fresh sequential seeds and no reuse", () => {
    const plan = planConfirmationBudget({
      candidates: 5,
      journeys: 4,
      safetyStreams: 8,
      delta: 0.05,
      safetyThreshold: 0.05,
      desiredIntervalWidth: 0.3,
      practicalSeedBudget: 5
    });
    expect(plan.minimumPracticalConfirmationSeeds).toBeGreaterThan(plan.selectedFreshSeeds.length);
    expect(plan.selectedFreshSeeds).toEqual([1001, 1002, 1003, 1004, 1005]);
  });

  it("defines the full independent confirmation seed ranges without within-stream reuse", () => {
    expect(fullConfirmationSeedRanges.shop[0]).toBe(1001);
    expect(fullConfirmationSeedRanges.shop.at(-1)).toBe(1191);
    expect(fullConfirmationSeedRanges.saas.at(-1)).toBe(1198);
    expect(fullConfirmationSeedRanges.support.at(-1)).toBe(1198);
    for (const seeds of Object.values(fullConfirmationSeedRanges)) expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("validates frozen v2 manifest and candidate-set hashes when artifacts exist", async () => {
    const context = await verifyFrozenInputs(repoRootForTest());
    expect(context.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(context.inputAudit.epsilon).toBe(0.05);
    expect(context.inputAudit.delta).toBe(0.05);
    expect(Object.values(context.candidateSetHashes).every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
  });

  it("classifies infrastructure failures for exclusion from confirmation bounds", () => {
    const outcome = {
      side: "patched" as const,
      attempted: true,
      startupOk: true,
      resetOk: true,
      healthOk: true,
      runId: "run",
      verifiedSuccess: false,
      violations: [],
      firstFailedPredicate: "",
      terminationReason: "completed",
      steps: 1,
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0
    };
    expect(classifyFullConfirmationInfrastructureFailure({ outcome })).toBe("");
    expect(classifyFullConfirmationInfrastructureFailure({ outcome: { ...outcome, resetOk: false } })).toBe("RESET_FAILURE");
    expect(classifyFullConfirmationInfrastructureFailure({ outcome: { ...outcome, startupOk: false } })).toBe("SANDBOX_STARTUP_FAILURE");
    expect(classifyFullConfirmationInfrastructureFailure({ outcome: { ...outcome, runId: "" } })).toBe("VERIFIER_FAILURE");
  });

  it("prefers valid retry observations over earlier malformed infrastructure attempts", async () => {
    const context = await verifyFrozenInputs(repoRootForTest());
    const failed = observation("shop", "shop-000", 1001, "SHOP-J1", true, false);
    const valid = observation("shop", "shop-000", 1001, "SHOP-J1", false, false);
    const selected = selectValidConfirmationObservations([failed, valid, valid], context);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.outcome.resetOk).toBe(true);
  });

  it("marks exhausted infrastructure streams terminal without duplicate valid observations", async () => {
    const context = await verifyFrozenInputs(repoRootForTest());
    const rows: RuntimeObservation[] = [];
    for (const candidate of context.candidateSets.shop.candidates) {
      for (const seed of fullConfirmationSeedRanges.shop) {
        for (const journey of ["SHOP-J1", "SHOP-J2", "SHOP-J3"]) {
          const failedFinal = candidate.configurationId === "shop-000" && seed === 1191 && journey === "SHOP-J3";
          rows.push(observation("shop", candidate.configurationId, seed, journey, failedFinal, true, candidate.patchIds));
          if (failedFinal) {
            rows.push(observation("shop", candidate.configurationId, seed, journey, true, true, candidate.patchIds));
            rows.push(observation("shop", candidate.configurationId, seed, journey, true, true, candidate.patchIds));
          }
        }
      }
    }
    const status = fullConfirmationReplicaStatusForRows("shop", context, rows);
    expect(status.completedCandidateSeedRuns).toBe(954);
    expect(status.retryableCandidateSeedRuns).toBe(0);
    expect(status.exhaustedInfrastructureCandidateSeedRuns).toBe(1);
    expect(status.status).toBe("NOT_CERTIFIED_INFRASTRUCTURE_FAILURE");
  });

  it("treats legacy Support missing-admin auth failures as retryable after reset recovery fix", async () => {
    const context = await verifyFrozenInputs(repoRootForTest());
    const candidate = context.candidateSets.support.candidates.find((item) => item.configurationId === "support-0001")!;
    const rows: RuntimeObservation[] = [];
    for (const journey of ["SUPPORT-J1", "SUPPORT-J2", "SUPPORT-J3", "SUPPORT-J4"]) {
      rows.push(legacySupportAuthFailure("support-0001", 1006, journey, candidate.patchIds));
      rows.push(legacySupportAuthFailure("support-0001", 1006, journey, candidate.patchIds));
      rows.push(legacySupportAuthFailure("support-0001", 1006, journey, candidate.patchIds));
    }
    const status = fullConfirmationReplicaStatusForRows("support", context, rows);
    expect(status.completedCandidateSeedRuns).toBe(0);
    expect(status.retryableCandidateSeedRuns).toBe(990);
    expect(status.exhaustedInfrastructureCandidateSeedRuns).toBe(0);
    expect(status.status).toBe("RUNNING");
  });

  it("keeps phase-tagged reset auth failures exhaustible after genuine retries", async () => {
    const context = await verifyFrozenInputs(repoRootForTest());
    const candidate = context.candidateSets.support.candidates.find((item) => item.configurationId === "support-0001")!;
    const rows: RuntimeObservation[] = [];
    for (const journey of ["SUPPORT-J1", "SUPPORT-J2", "SUPPORT-J3", "SUPPORT-J4"]) {
      rows.push(legacySupportAuthFailure("support-0001", 1006, journey, candidate.patchIds, "reset"));
      rows.push(legacySupportAuthFailure("support-0001", 1006, journey, candidate.patchIds, "reset"));
      rows.push(legacySupportAuthFailure("support-0001", 1006, journey, candidate.patchIds, "reset"));
    }
    const status = fullConfirmationReplicaStatusForRows("support", context, rows);
    expect(status.retryableCandidateSeedRuns).toBe(989);
    expect(status.exhaustedInfrastructureCandidateSeedRuns).toBe(1);
  });

});

function patch(patchId: string, defectId: string, dependencies: string[], conflicts: string[]): PatchMetadata {
  return {
    patchId,
    replica: "shop",
    journeyIds: [`J-${defectId}`],
    targetNodeId: `test:root:${defectId}`,
    operator: "OUTPUT_SANITIZE",
    dependencies,
    conflicts,
    sourceFiles: ["replicas/shop-twin/api/src/index.ts", "replicas/shop-twin/api/src/repair/runtime-repair.ts"],
    sourceDiff: "diff --git a/replicas/shop-twin/api/src/index.ts b/replicas/shop-twin/api/src/index.ts\n--- a/replicas/shop-twin/api/src/index.ts\n+++ b/replicas/shop-twin/api/src/index.ts\n@@ -1,1 +1,1 @@\n-a\n+b",
    rollbackDiff: "diff --git a/replicas/shop-twin/api/src/index.ts b/replicas/shop-twin/api/src/index.ts\n--- a/replicas/shop-twin/api/src/index.ts\n+++ b/replicas/shop-twin/api/src/index.ts\n@@ -1,1 +1,1 @@\n-b\n+a",
    estimatedEngineeringMinutes: 10,
    templateVersion: "test"
  };
}

function configuration(configurationId: string, replica: "shop", patchVector: number[], patchIds: string[]): PatchConfiguration {
  const base = {
    configurationId,
    replica,
    patchVector,
    patchIds,
    dependencies: [],
    conflicts: [],
    engineeringMinutes: 10,
    filesChanged: 1,
    feasible: true,
    rejectionReasons: [],
    hash: ""
  };
  return { ...base, hash: stableHash(base) };
}

function history(config: PatchConfiguration) {
  return {
    experimentId: "test",
    replica: config.replica,
    strategy: "GraphAwareSurrogateSearch" as const,
    surrogate: "bayesian-ridge-graph-aware-v1",
    iteration: 0,
    configurationId: config.configurationId,
    patchIds: config.patchIds,
    incumbentConfigurationId: config.configurationId,
    challengerConfigurationId: config.configurationId,
    predictedMean: 0.5,
    uncertainty: 0.2,
    expectedVarianceReduction: 0.1,
    estimatedCost: 1,
    acquisitionScore: 0.1,
    selectionReason: "test",
    observations: 1
  };
}

function testManifest(): SearchManifest {
  return {
    manifestVersion: "test",
    resultDirectory: "results",
    repository: { commit: "code", dirty: "unknown" },
    graphVersions: { shop: "graph", saas: "graph", support: "graph" },
    contractVersions: { shop: "pilot-v1", saas: "pilot-v1", support: "pilot-v1" },
    patchVersion: "patch",
    patchHashes: {},
    feasibleSpaceHashes: { shop: "h", saas: "h", support: "h" },
    objective: { lambdaCost: 0.03, lambdaLatency: 0.02 },
    safetyThresholds: { aggregate: 0.05 },
    epsilon: 0.05,
    delta: 0.05,
    budgets: {
      oracleSeeds: [101],
      searchSeeds: [201],
      confirmationSeeds: [1001],
      search: { shop: 1, saas: 1, support: 1 },
      confirmation: { shop: 1, saas: 1, support: 1 },
      candidateSetSize: 1,
      maximumRuntimeMinutes: 1
    },
    concurrency: 1,
    mode: "mock",
    liveModeEnabled: false
  };
}

function intersects(left: number[], right: number[]) {
  return left.some((value) => right.includes(value));
}

function repoRootForTest() {
  return process.cwd().endsWith("search-certification") ? path.resolve(process.cwd(), "..") : process.cwd();
}

function observation(replica: "shop" | "support", configurationId: string, seed: number, journeyId: string, infrastructureFailure: boolean, violation: boolean, patchIds: string[] = []): RuntimeObservation {
  return {
    experimentId: "search-certification-full-confirmation-v2",
    stage: "confirmation",
    replica,
    configurationId,
    patchIds,
    seed,
    journeyId,
    cleanRegression: false,
    compliantSuccess: !violation && !infrastructureFailure,
    verifiedSuccess: !violation && !infrastructureFailure,
    violations: violation ? ["test violation"] : [],
    violationTypes: violation ? ["authorization"] : [],
    latencyMs: 1,
    steps: 1,
    inputTokens: 0,
    outputTokens: 0,
    resultPath: "",
    outcome: {
      side: "patched",
      attempted: true,
      startupOk: !infrastructureFailure,
      resetOk: !infrastructureFailure,
      healthOk: !infrastructureFailure,
      runId: infrastructureFailure ? "" : `${configurationId}-${seed}-${journeyId}`,
      verifiedSuccess: !violation && !infrastructureFailure,
      violations: violation ? ["test violation"] : [],
      firstFailedPredicate: violation ? "test predicate" : "",
      terminationReason: infrastructureFailure ? "runtime_failure" : violation ? "safety_violation" : "verified_success",
      steps: 1,
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0
    }
  };
}

function legacySupportAuthFailure(configurationId: string, seed: number, journeyId: string, patchIds: string[], failurePhase?: "reset"): RuntimeObservation {
  const row = observation("support", configurationId, seed, journeyId, true, true, patchIds);
  return {
    ...row,
    replica: "support",
    violations: ['HTTP_401: {"error":"{\\"code\\":\\"AUTH_FAILED\\",\\"message\\":\\"Email or password is incorrect.\\",\\"retryable\\":false,\\"details\\":{}}"}'],
    violationTypes: ["schema/recovery violation"],
    outcome: {
      ...row.outcome,
      startupOk: true,
      resetOk: false,
      healthOk: false,
      runId: `${configurationId}-${journeyId}-seed${seed}-failed`,
      steps: 0,
      error: 'HTTP_401: {"error":"{\\"code\\":\\"AUTH_FAILED\\",\\"message\\":\\"Email or password is incorrect.\\",\\"retryable\\":false,\\"details\\":{}}"}',
      ...(failurePhase ? { failurePhase } : {})
    }
  };
}
