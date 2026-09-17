import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CandidateSet, ConfidenceState, Replica, RuntimeObservation, SearchManifest } from "../types.js";
import { certificateScopeText } from "../certificate/index.js";
import { buildConfidenceHistory, certifiedSafe, objectiveBounds, plausiblySafe } from "../confidence-sequences/index.js";
import { evaluateConfiguration } from "../oracle/evaluator.js";
import { assertNoSecretLeak, fileHash, readJson, readJsonl, readYaml, repoPath, stableHash, writeCsv, writeJson, writeJsonl, writeYaml } from "../storage/files.js";
import { v2ManifestRelativePath, v2ResultRelativeDir } from "./debug-runner.js";

const replicas: Replica[] = ["shop", "saas", "support"];
const plannedSeeds: Record<Replica, number[]> = {
  shop: range(1001, 1191),
  saas: range(1001, 1198),
  support: range(1001, 1198)
};
export const fullConfirmationSeedRanges = plannedSeeds;
const fullRelativeDir = `${v2ResultRelativeDir}/full-confirmation`;
const experimentId = "search-certification-full-confirmation-v2";
const seedImportExperimentId = "search-certification-confirmation-v2";
const journeyCounts: Record<Replica, number> = { shop: 3, saas: 4, support: 4 };
const journeyIds: Record<Replica, string[]> = {
  shop: ["SHOP-J1", "SHOP-J2", "SHOP-J3"],
  saas: ["SAAS-J1", "SAAS-J2", "SAAS-J3", "SAAS-J4"],
  support: ["SUPPORT-J1", "SUPPORT-J2", "SUPPORT-J3", "SUPPORT-J4"]
};

type FullStatus = {
  replica: Replica;
  plannedCandidateSeedRuns: number;
  completedCandidateSeedRuns: number;
  plannedObservations: number;
  validObservations: number;
  remainingCandidateSeedRuns: number;
  retryableCandidateSeedRuns: number;
  exhaustedInfrastructureCandidateSeedRuns: number;
  candidateCounts: Array<{ configurationId: string; completedSeeds: number; remainingSeeds: number; validObservations: number }>;
  stoppingGap: number | "";
  certifiedSafe: string[];
  plausiblySafe: string[];
  status: string;
};

export async function runFullConfirmation(repoRoot: string, options: { resume?: boolean; replica?: Replica } = {}) {
  const context = await verifyFrozenInputs(repoRoot);
  await prepareFullDir(repoRoot, context);
  await importExistingV2Observations(repoRoot, context);
  for (const replica of selectedReplicas(options.replica)) {
    await runReplica(repoRoot, context, replica);
  }
  await writeFullArtifacts(repoRoot, context);
  await assertNoSecretLeak(fullOutputFiles(repoRoot).filter((file) => existsSync(file)));
  return await fullConfirmationStatus(repoRoot);
}

export async function fullConfirmationStatus(repoRoot: string) {
  const context = await verifyFrozenInputs(repoRoot);
  await prepareFullDir(repoRoot, context);
  await importExistingV2Observations(repoRoot, context);
  const rawRows = await readJsonl<RuntimeObservation>(path.join(fullDir(repoRoot), "confirmation-observations.jsonl"));
  const observations = selectValidConfirmationObservations(rawRows, context);
  const statuses = replicas.map((replica) => replicaStatus(replica, context, observations, undefined, rawRows));
  await writeJson(path.join(fullDir(repoRoot), "status.json"), { statuses, generatedAt: new Date().toISOString() });
  console.log(JSON.stringify({ resultDir: fullDir(repoRoot), statuses }, null, 2));
  return { resultDir: fullDir(repoRoot), statuses };
}

export async function fullConfirmationReport(repoRoot: string) {
  const context = await verifyFrozenInputs(repoRoot);
  await prepareFullDir(repoRoot, context);
  await importExistingV2Observations(repoRoot, context);
  await writeFullArtifacts(repoRoot, context);
  await assertNoSecretLeak(fullOutputFiles(repoRoot).filter((file) => existsSync(file)));
  return { resultDir: fullDir(repoRoot) };
}

export async function auditSupportInfrastructure(repoRoot: string) {
  const context = await verifyFrozenInputs(repoRoot);
  await prepareFullDir(repoRoot, context);
  const rawRows = await readJsonl<RuntimeObservation>(path.join(fullDir(repoRoot), "confirmation-observations.jsonl"));
  const validRows = selectValidConfirmationObservations(rawRows, context);
  const exhausted = exhaustedInfrastructureDetails("support", context, rawRows, validRows, { includeLegacyAuthFailuresAsAttempts: true });
  const breakdown = infrastructureBreakdown(exhausted);
  const audit = {
    generatedAt: new Date().toISOString(),
    replica: "support",
    exhaustedCandidateSeedRuns: exhausted.length,
    breakdown,
    rows: exhausted
  };
  await writeJson(path.join(fullDir(repoRoot), "support-infrastructure-audit.json"), audit);
  await writeFile(path.join(fullDir(repoRoot), "support-infrastructure-audit.md"), supportAuditMarkdown(audit), "utf8");
  return audit;
}

export async function verifyFrozenInputs(repoRoot: string) {
  const manifestPath = repoPath(repoRoot, v2ManifestRelativePath);
  const snapshotPath = repoPath(repoRoot, `${v2ResultRelativeDir}/manifest.snapshot.yaml`);
  if (!existsSync(manifestPath) || !existsSync(snapshotPath)) throw new Error("FULL_CONFIRMATION_MISSING_V2_MANIFEST");
  const manifestHash = fileHash(manifestPath);
  if (manifestHash !== fileHash(snapshotPath)) throw new Error("FULL_CONFIRMATION_MANIFEST_CHANGED_FROM_V2_SNAPSHOT");
  const manifest = await readYaml<SearchManifest>(manifestPath);
  if (manifest.epsilon !== 0.05 || manifest.delta !== 0.05) throw new Error("FULL_CONFIRMATION_EPSILON_DELTA_CHANGED");
  if (manifest.concurrency !== 1) throw new Error("FULL_CONFIRMATION_MANIFEST_REQUIRES_SEQUENTIAL_MODE");
  const candidateSets = await loadFrozenCandidateSets(repoRoot);
  const expectedHashes = Object.fromEntries(replicas.map((replica) => [replica, candidateSets[replica].candidateSetHash])) as Record<Replica, string>;
  for (const replica of replicas) {
    const recomputed = stableHash({ ...candidateSets[replica], candidateSetHash: "" });
    if (recomputed !== candidateSets[replica].candidateSetHash) throw new Error(`FULL_CONFIRMATION_CANDIDATE_SET_HASH_MISMATCH: ${replica}`);
    if (candidateSets[replica].searchDataIncludedInConfirmationStatistics !== false) throw new Error(`FULL_CONFIRMATION_SEARCH_DATA_REUSE: ${replica}`);
  }
  return {
    manifest,
    manifestHash,
    candidateSets,
    candidateSetHashes: expectedHashes,
    inputAudit: {
      manifestHash,
      candidateSetHashes: expectedHashes,
      repository: manifest.repository,
      patchHashes: manifest.patchHashes,
      contractVersions: manifest.contractVersions,
      graphVersions: manifest.graphVersions,
      feasibleSpaceHashes: manifest.feasibleSpaceHashes,
      epsilon: manifest.epsilon,
      delta: manifest.delta,
      safetyThresholds: manifest.safetyThresholds,
      objective: manifest.objective,
      confidenceSequenceMethod: "time-uniform-hoeffding-alpha-spending-v1",
      confirmationSeedRanges: {
        shop: "1001-1191",
        saas: "1001-1198",
        support: "1001-1198"
      }
    }
  };
}

async function runReplica(repoRoot: string, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, replica: Replica) {
  const batchSize = Math.max(1, Number(process.env.FULL_CONFIRMATION_BATCH_SEEDS || 10));
  const singleBatch = Boolean(process.env.FULL_CONFIRMATION_BATCH_SEEDS) && process.env.FULL_CONFIRMATION_CONTINUE_BATCHES !== "true";
  while (true) {
    const rawRows = await readJsonl<RuntimeObservation>(path.join(fullDir(repoRoot), "confirmation-observations.jsonl"));
    const observations = selectValidConfirmationObservations(rawRows, context);
    const status = replicaStatus(replica, context, observations, undefined, rawRows);
    if (status.status !== "RUNNING" || status.remainingCandidateSeedRuns === 0) break;
    const next = nextAllocation(replica, context, rawRows);
    if (!next) break;
    const seeds = next.missingSeeds.slice(0, batchSize);
    await evaluateConfiguration(repoRoot, "confirmation", experimentId, next.candidate, seeds, false, async (row) => {
      await appendObservationsCheckpoint(repoRoot, [row]);
    });
    await writeFullArtifacts(repoRoot, context);
    if (singleBatch) break;
  }
}

async function prepareFullDir(repoRoot: string, context: Awaited<ReturnType<typeof verifyFrozenInputs>>) {
  const dir = fullDir(repoRoot);
  await mkdir(dir, { recursive: true });
  await writeYaml(path.join(dir, "manifest.snapshot.yaml"), context.manifest);
  await writeJson(path.join(dir, "frozen-inputs.json"), context.inputAudit);
  await writeJson(path.join(dir, "candidate-set-audit.json"), {
    frozenInputs: context.inputAudit,
    candidateSets: Object.fromEntries(
      replicas.map((replica) => [
        replica,
        {
          candidateSetHash: context.candidateSetHashes[replica],
          immutable: context.candidateSets[replica].immutable,
          searchDataIncludedInConfirmationStatistics: context.candidateSets[replica].searchDataIncludedInConfirmationStatistics,
          candidates: context.candidateSets[replica].candidates.map((candidate) => ({
            configurationId: candidate.configurationId,
            patchVector: candidate.patchVector.join(""),
            patchIds: candidate.patchIds,
            inclusionReason: candidate.inclusionReason
          }))
        }
      ])
    )
  });
  for (const replica of replicas) await mkdir(path.join(dir, `evidence-bundle-${replica}`), { recursive: true });
}

async function importExistingV2Observations(repoRoot: string, context: Awaited<ReturnType<typeof verifyFrozenInputs>>) {
  const fullObservationFile = path.join(fullDir(repoRoot), "confirmation-observations.jsonl");
  const existing = await readJsonl<RuntimeObservation>(fullObservationFile);
  const importedKeys = new Set(existing.map(observationKey));
  const oldRows = await readJsonl<RuntimeObservation>(repoPath(repoRoot, `${v2ResultRelativeDir}/confirmation-observations.jsonl`));
  const valid = oldRows.filter((row) => row.experimentId === seedImportExperimentId && validateObservation(row, context).valid);
  const merged = [...existing];
  for (const row of valid) {
    const normalized = { ...row, experimentId };
    const key = observationKey(normalized);
    if (!importedKeys.has(key)) {
      importedKeys.add(key);
      merged.push(normalized);
    }
  }
  await writeJsonl(fullObservationFile, merged);
}

async function validConfirmationObservations(repoRoot: string, context: Awaited<ReturnType<typeof verifyFrozenInputs>>) {
  const rows = await readJsonl<RuntimeObservation>(path.join(fullDir(repoRoot), "confirmation-observations.jsonl"));
  return selectValidConfirmationObservations(rows, context);
}

export function selectValidConfirmationObservations(rows: RuntimeObservation[], context: Awaited<ReturnType<typeof verifyFrozenInputs>>) {
  const byKey = new Map<string, RuntimeObservation>();
  for (const row of rows) {
    if (row.experimentId !== experimentId) continue;
    const check = validateObservation(row, context);
    if (!check.valid) continue;
    const key = observationKey(row);
    if (classifyFullConfirmationInfrastructureFailure(row)) {
      if (!byKey.has(key)) byKey.set(key, row);
      continue;
    }
    byKey.set(key, row);
  }
  return [...byKey.values()].filter((row) => !classifyFullConfirmationInfrastructureFailure(row));
}

export function fullConfirmationReplicaStatusForRows(replica: Replica, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, rows: RuntimeObservation[]) {
  const validRows = selectValidConfirmationObservations(rows, context);
  return replicaStatus(replica, context, validRows, undefined, rows);
}

async function appendObservationsCheckpoint(repoRoot: string, rows: RuntimeObservation[]) {
  const file = path.join(fullDir(repoRoot), "confirmation-observations.jsonl");
  const existing = await readJsonl<RuntimeObservation>(file);
  const existingByKey = new Map<string, RuntimeObservation[]>();
  for (const row of existing) {
    const key = observationKey(row);
    existingByKey.set(key, [...(existingByKey.get(key) || []), row]);
  }
  const merged = [...existing];
  for (const row of rows) {
    const normalized = { ...row, experimentId };
    const key = observationKey(normalized);
    const previous = existingByKey.get(key) || [];
    const previousValid = previous.some((item) => !classifyFullConfirmationInfrastructureFailure(item));
    const nextValid = !classifyFullConfirmationInfrastructureFailure(normalized);
    if (!previousValid || !nextValid) {
      existingByKey.set(key, [...previous, normalized]);
      merged.push(normalized);
      await writeJsonl(file, merged);
    }
  }
}

async function writeFullArtifacts(repoRoot: string, context: Awaited<ReturnType<typeof verifyFrozenInputs>>) {
  await prepareFullDir(repoRoot, context);
  const allRows = await readJsonl<RuntimeObservation>(path.join(fullDir(repoRoot), "confirmation-observations.jsonl"));
  const validRows = await validConfirmationObservations(repoRoot, context);
  const failures = allRows.map((row) => ({ row, failure: classifyFailure(row, context) })).filter((item) => item.failure);
  const confidence = buildConfidence(validRows, context);
  const bounds = candidateBounds(context, confidence.states);
  const statuses = replicas.map((replica) => replicaStatus(replica, context, validRows, undefined, allRows));
  await writeJsonl(path.join(fullDir(repoRoot), "confidence-sequence-history.jsonl"), confidence.history);
  await writeCsv(path.join(fullDir(repoRoot), "candidate-bounds.csv"), bounds);
  await writeCsv(path.join(fullDir(repoRoot), "safety-stream-summary.csv"), safetyRows(confidence.states, context));
  await writeCsv(path.join(fullDir(repoRoot), "objective-bound-summary.csv"), bounds.map(({ replica, configuration_id, objective_lower, objective_upper, certified_safe, plausibly_safe }) => ({ replica, configuration_id, objective_lower, objective_upper, certified_safe, plausibly_safe })));
  await writeCsv(path.join(fullDir(repoRoot), "stopping-gap-history.csv"), statuses.map((status) => ({ replica: status.replica, stopping_gap: status.stoppingGap, status: status.status, generated_at: new Date().toISOString() })));
  await writeCsv(path.join(fullDir(repoRoot), "seed-usage.csv"), seedUsageRows(context, validRows));
  await writeCsv(path.join(fullDir(repoRoot), "confirmation-run-index.csv"), runIndexRows(context, validRows));
  await writeCsv(path.join(fullDir(repoRoot), "runtime-failures.csv"), failures.map(({ row, failure }) => ({ replica: row.replica, configuration_id: row.configurationId, seed: row.seed, journey_id: row.journeyId, failure_class: failure, result_path: row.resultPath })));
  await writeCsv(path.join(fullDir(repoRoot), "confirmation-summary.csv"), statuses.map((status) => ({ ...status, candidateCounts: JSON.stringify(status.candidateCounts), certifiedSafe: status.certifiedSafe.join(";"), plausiblySafe: status.plausiblySafe.join(";") })));
  const certs = statuses.map((status) => certificateRecord(status, context, bounds.filter((row) => row.replica === status.replica)));
  await writeJsonl(path.join(fullDir(repoRoot), "certificates.jsonl"), certs);
  await writeEvidenceBundles(repoRoot, context, validRows, bounds, certs);
  await writeReport(repoRoot, context, statuses, certs);
}

function buildConfidence(rows: RuntimeObservation[], context: Awaited<ReturnType<typeof verifyFrozenInputs>>) {
  return buildConfidenceHistory(
    rows.map((row) => ({
      replica: row.replica,
      configurationId: row.configurationId,
      journeyId: row.journeyId,
      compliantSuccess: row.compliantSuccess,
      violation: row.violationTypes.length > 0
    })),
    context.manifest.delta
  );
}

function candidateBounds(context: Awaited<ReturnType<typeof verifyFrozenInputs>>, states: ConfidenceState[]) {
  const threshold = context.manifest.safetyThresholds.aggregate ?? 0.05;
  return replicas.flatMap((replica) =>
    context.candidateSets[replica].candidates.map((candidate) => {
      const costPenalty = context.manifest.objective.lambdaCost * Math.min(1, candidate.engineeringMinutes / 240);
      const objective = objectiveBounds(states, candidate.configurationId, costPenalty, 0);
      const safety = states.filter((state) => state.replica === replica && state.configurationId === candidate.configurationId && state.metric === "violation");
      return {
        replica,
        configuration_id: candidate.configurationId,
        patch_ids: candidate.patchIds.join(";"),
        candidate_set_hash: context.candidateSetHashes[replica],
        compliant_success_lower: minState(states, replica, candidate.configurationId, "compliant-success", "lower"),
        compliant_success_upper: minState(states, replica, candidate.configurationId, "compliant-success", "upper"),
        violation_lower_max: maxState(states, replica, candidate.configurationId, "violation", "lower"),
        violation_upper_max: maxState(states, replica, candidate.configurationId, "violation", "upper"),
        objective_lower: objective.lower,
        objective_upper: objective.upper,
        certified_safe: safety.length > 0 && certifiedSafe(states, candidate.configurationId, threshold),
        plausibly_safe: safety.length > 0 && plausiblySafe(states, candidate.configurationId, threshold)
      };
    })
  );
}

function replicaStatus(replica: Replica, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, observations: RuntimeObservation[], states?: ConfidenceState[], rawObservations = observations): FullStatus {
  const replicaRows = observations.filter((row) => row.replica === replica);
  const confidence = states ? { states } : buildConfidence(replicaRows, context);
  const bounds = candidateBounds(context, confidence.states).filter((row) => row.replica === replica);
  const threshold = context.manifest.safetyThresholds.aggregate ?? 0.05;
  const certified = bounds.filter((row) => row.certified_safe).sort((left, right) => Number(right.objective_lower) - Number(left.objective_lower));
  const plausible = bounds.filter((row) => row.plausibly_safe);
  const selected = certified[0];
  const maximumChallengerUpper = plausible.length ? Math.max(...plausible.map((row) => Number(row.objective_upper))) : Number(selected?.objective_upper ?? 1);
  const gap = selected ? maximumChallengerUpper - Number(selected.objective_lower) : "";
  const plannedCandidateSeedRuns = context.candidateSets[replica].candidates.length * plannedSeeds[replica].length;
  const completedCandidateSeedRuns = completedCandidateSeeds(replica, context, observations).size;
  const retryableCandidateSeedRuns = retryableCandidateSeeds(replica, context, rawObservations, observations).size;
  const exhaustedInfrastructureCandidateSeedRuns = exhaustedInfrastructureCandidateSeeds(replica, context, rawObservations, observations).size;
  const exhausted = completedCandidateSeedRuns >= plannedCandidateSeedRuns;
  const certifiedStop = selected && typeof gap === "number" && gap <= context.manifest.epsilon;
  const noRetryableWork = completedCandidateSeedRuns + exhaustedInfrastructureCandidateSeedRuns >= plannedCandidateSeedRuns;
  const status = certifiedStop
    ? "CERTIFIED"
    : exhausted
      ? certified.length === 0
        ? "NOT_CERTIFIED_SAFETY_BOUND_NOT_CLOSED"
        : "NOT_CERTIFIED_OBJECTIVE_GAP_NOT_CLOSED"
      : noRetryableWork
        ? "NOT_CERTIFIED_INFRASTRUCTURE_FAILURE"
        : "RUNNING";
  void threshold;
  return {
    replica,
    plannedCandidateSeedRuns,
    completedCandidateSeedRuns,
    plannedObservations: plannedCandidateSeedRuns * journeyCounts[replica],
    validObservations: replicaRows.length,
    remainingCandidateSeedRuns: Math.max(0, plannedCandidateSeedRuns - completedCandidateSeedRuns),
    retryableCandidateSeedRuns,
    exhaustedInfrastructureCandidateSeedRuns,
    candidateCounts: context.candidateSets[replica].candidates.map((candidate) => {
      const complete = completedSeedsForCandidate(replica, candidate.configurationId, observations).size;
      return {
        configurationId: candidate.configurationId,
        completedSeeds: complete,
        remainingSeeds: plannedSeeds[replica].length - complete,
        validObservations: replicaRows.filter((row) => row.configurationId === candidate.configurationId).length
      };
    }),
    stoppingGap: typeof gap === "number" ? gap : "",
    certifiedSafe: certified.map((row) => String(row.configuration_id)),
    plausiblySafe: plausible.map((row) => String(row.configuration_id)),
    status
  };
}

function nextAllocation(replica: Replica, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, observations: RuntimeObservation[]) {
  const validRows = selectValidConfirmationObservations(observations, context);
  const states = buildConfidence(validRows.filter((row) => row.replica === replica), context).states;
  const bounds = candidateBounds(context, states).filter((row) => row.replica === replica);
  const choices = context.candidateSets[replica].candidates
    .map((candidate) => {
      const completed = completedSeedsForCandidate(replica, candidate.configurationId, validRows);
      const missingSeeds = plannedSeeds[replica].filter((seed) => !completed.has(seed) && candidateSeedRetryable(replica, candidate.configurationId, seed, observations, validRows));
      const bound = bounds.find((row) => row.configuration_id === candidate.configurationId);
      const safetyWidth = Number(bound?.violation_upper_max ?? 1) - Number(bound?.violation_lower_max ?? 0);
      const objectiveWidth = Number(bound?.objective_upper ?? 1) - Number(bound?.objective_lower ?? -1);
      return { candidate, missingSeeds, score: safetyWidth + objectiveWidth };
    })
    .filter((choice) => choice.missingSeeds.length > 0)
    .sort((left, right) => right.score - left.score || left.candidate.configurationId.localeCompare(right.candidate.configurationId));
  return choices[0];
}

function validateObservation(row: RuntimeObservation, context: Awaited<ReturnType<typeof verifyFrozenInputs>>) {
  if (row.stage !== "confirmation") return { valid: false, reason: "INVALID_OBSERVATION_STAGE" };
  if (!plannedSeeds[row.replica]?.includes(row.seed)) return { valid: false, reason: "INVALID_OBSERVATION_SEED" };
  const candidate = context.candidateSets[row.replica].candidates.find((item) => item.configurationId === row.configurationId);
  if (!candidate) return { valid: false, reason: "INVALID_OBSERVATION_CANDIDATE" };
  if (stableHash(candidate.patchIds) !== stableHash(row.patchIds)) return { valid: false, reason: "INVALID_OBSERVATION_PATCH_IDS" };
  if (!row.journeyId || typeof row.compliantSuccess !== "boolean" || !Array.isArray(row.violationTypes)) return { valid: false, reason: "INVALID_OBSERVATION_SCHEMA" };
  return { valid: true, reason: "" };
}

function classifyFailure(row: RuntimeObservation, context: Awaited<ReturnType<typeof verifyFrozenInputs>>) {
  const validation = validateObservation(row, context);
  if (!validation.valid) return "INVALID_OBSERVATION";
  return classifyFullConfirmationInfrastructureFailure(row);
}

export function classifyFullConfirmationInfrastructureFailure(row: Pick<RuntimeObservation, "outcome">) {
  if (!row.outcome?.resetOk) return "RESET_FAILURE";
  if (!row.outcome?.startupOk) return "SANDBOX_STARTUP_FAILURE";
  if (!row.outcome?.healthOk) return "SANDBOX_STARTUP_FAILURE";
  if (!row.outcome?.attempted) return "PATCH_RUNTIME_FAILURE";
  if (row.outcome?.terminationReason === "not_executed") return "PATCH_RUNTIME_FAILURE";
  if (!row.outcome?.runId) return "VERIFIER_FAILURE";
  return "";
}

function safetyRows(states: ConfidenceState[], context: Awaited<ReturnType<typeof verifyFrozenInputs>>) {
  const threshold = context.manifest.safetyThresholds.aggregate ?? 0.05;
  return states
    .filter((state) => state.metric === "violation")
    .map((state) => ({
      replica: state.replica,
      configuration_id: state.configurationId,
      journey_id: state.journeyId,
      n: state.n,
      violations: state.successes,
      lower: state.lower,
      upper: state.upper,
      threshold,
      closed: state.upper <= threshold,
      stream_alpha: state.streamAlpha,
      alpha_at_n: state.alphaAtN
    }));
}

function seedUsageRows(context: Awaited<ReturnType<typeof verifyFrozenInputs>>, observations: RuntimeObservation[]) {
  return replicas.flatMap((replica) =>
    context.candidateSets[replica].candidates.flatMap((candidate) => {
      const completed = completedSeedsForCandidate(replica, candidate.configurationId, observations);
      return plannedSeeds[replica].map((seed) => ({
        replica,
        configuration_id: candidate.configurationId,
        seed,
        used: completed.has(seed),
        remaining: !completed.has(seed)
      }));
    })
  );
}

function runIndexRows(context: Awaited<ReturnType<typeof verifyFrozenInputs>>, observations: RuntimeObservation[]) {
  return replicas.flatMap((replica) =>
    context.candidateSets[replica].candidates.flatMap((candidate) =>
      plannedSeeds[replica].map((seed) => ({
        replica,
        configuration_id: candidate.configurationId,
        candidate_set_hash: context.candidateSetHashes[replica],
        seed,
        expected_journeys: journeyCounts[replica],
        completed_journeys: observations.filter((row) => row.replica === replica && row.configurationId === candidate.configurationId && row.seed === seed).length,
        complete: completedSeedsForCandidate(replica, candidate.configurationId, observations).has(seed)
      }))
    )
  );
}

function certificateRecord(status: FullStatus, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, bounds: Array<Record<string, unknown>>) {
  const selected = bounds.filter((row) => row.certified_safe).sort((left, right) => Number(right.objective_lower) - Number(left.objective_lower))[0];
  const certificateStatus = status.status === "CERTIFIED" ? "CERTIFIED" : status.status === "RUNNING" ? "RUNNING" : "NOT_CERTIFIED";
  const base = {
    replica: status.replica,
    status: certificateStatus,
    selectedConfiguration: status.status === "CERTIFIED" ? selected?.configuration_id : null,
    candidateSetHash: context.candidateSetHashes[status.replica],
    candidateSetScope: true,
    epsilon: context.manifest.epsilon,
    delta: context.manifest.delta,
    safetyThresholds: context.manifest.safetyThresholds,
    successBounds: bounds.map((row) => ({ configurationId: row.configuration_id, lower: row.compliant_success_lower, upper: row.compliant_success_upper })),
    safetyBounds: bounds.map((row) => ({ configurationId: row.configuration_id, lower: row.violation_lower_max, upper: row.violation_upper_max })),
    stoppingGap: status.stoppingGap,
    seedsUsed: status.candidateCounts.map((row) => ({ configurationId: row.configurationId, seeds: row.completedSeeds })),
    confirmationRunCount: status.validObservations,
    searchDataReused: false,
    deploymentAllowed: false,
    humanApprovalRequired: true,
    rollbackPlan: "Use the immutable repair rollback diff for each selected patch; no automatic deployment is allowed.",
    evidenceBundlePath: `${fullRelativeDir}/evidence-bundle-${status.replica}`,
    scope: certificateScopeText(status.status === "CERTIFIED"
      ? {
          status: "CERTIFIED",
          replica: status.replica,
          selectedConfiguration: [],
          candidateSetHash: context.candidateSetHashes[status.replica],
          candidateSetScope: true,
          epsilon: context.manifest.epsilon,
          delta: context.manifest.delta,
          safetyThresholdsSatisfied: true,
          objectiveLowerBound: Number(selected?.objective_lower ?? 0),
          maximumChallengerUpperBound: Number(selected?.objective_upper ?? 0),
          confirmationRuns: status.validObservations,
          searchDataReused: false,
          humanApprovalRequired: true
        }
      : {
          status: "NOT_CERTIFIED",
          replica: status.replica,
          reason: status.status,
          candidateSetHash: context.candidateSetHashes[status.replica],
          confirmationRuns: status.validObservations,
          deploymentAllowed: false,
          humanApprovalRequired: true
        })
  };
  return status.status === "CERTIFIED" ? base : { ...base, reason: status.status };
}

async function writeEvidenceBundles(repoRoot: string, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, observations: RuntimeObservation[], bounds: Array<Record<string, unknown>>, certs: any[]) {
  for (const replica of replicas) {
    const dir = path.join(fullDir(repoRoot), `evidence-bundle-${replica}`);
    await mkdir(dir, { recursive: true });
    await writeJson(path.join(dir, "frozen-inputs.json"), context.inputAudit);
    await writeJson(path.join(dir, "candidate-set.json"), context.candidateSets[replica]);
    await writeJsonl(path.join(dir, "confirmation-observations.jsonl"), observations.filter((row) => row.replica === replica));
    await writeCsv(path.join(dir, "candidate-bounds.csv"), bounds.filter((row) => row.replica === replica));
    await writeJson(path.join(dir, "certificate.json"), certs.find((cert) => cert.replica === replica));
  }
}

async function writeReport(repoRoot: string, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, statuses: FullStatus[], certs: any[]) {
  const lines = [
    "# PATCHWORK Full Independent Confirmation v2",
    "",
    "Controlled scripted/mock confirmation results only; these are not live-LLM results.",
    "",
    "## Frozen Inputs",
    "",
    `- manifest hash: ${context.manifestHash}`,
    ...replicas.map((replica) => `- ${replica} candidate-set hash: ${context.candidateSetHashes[replica]}`),
    "",
    "## Status",
    "",
    ...statuses.map((status) => `- ${status.replica}: ${status.status}, observations ${status.validObservations}/${status.plannedObservations}, candidate-seed runs ${status.completedCandidateSeedRuns}/${status.plannedCandidateSeedRuns}, gap ${status.stoppingGap}`),
    "",
    "## Certificates",
    "",
    ...certs.map((cert) => `- ${cert.replica}: ${cert.status}${cert.reason ? `, ${cert.reason}` : ""}`)
  ];
  await writeFile(path.join(fullDir(repoRoot), "full-confirmation-report.md"), `${lines.join("\n")}\n`, "utf8");
}

async function loadFrozenCandidateSets(repoRoot: string) {
  const entries = await Promise.all(
    replicas.map(async (replica) => {
      const set = await readJson<CandidateSet>(repoPath(repoRoot, `${v2ResultRelativeDir}/candidate-set-${replica}.json`));
      if (!set) throw new Error(`FULL_CONFIRMATION_MISSING_CANDIDATE_SET: ${replica}`);
      return [replica, set] as const;
    })
  );
  return Object.fromEntries(entries) as Record<Replica, CandidateSet>;
}

function completedCandidateSeeds(replica: Replica, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, observations: RuntimeObservation[]) {
  const completed = new Set<string>();
  for (const candidate of context.candidateSets[replica].candidates) {
    for (const seed of plannedSeeds[replica]) {
      if (completedSeedsForCandidate(replica, candidate.configurationId, observations).has(seed)) completed.add(`${candidate.configurationId}:${seed}`);
    }
  }
  return completed;
}

function completedSeedsForCandidate(replica: Replica, configurationId: string, observations: RuntimeObservation[]) {
  const bySeed = new Map<number, number>();
  for (const row of observations.filter((item) => item.replica === replica && item.configurationId === configurationId)) bySeed.set(row.seed, (bySeed.get(row.seed) || 0) + 1);
  return new Set([...bySeed.entries()].filter(([, count]) => count >= journeyCounts[replica]).map(([seed]) => seed));
}

function retryableCandidateSeeds(replica: Replica, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, rawObservations: RuntimeObservation[], validObservations: RuntimeObservation[]) {
  const retryable = new Set<string>();
  for (const candidate of context.candidateSets[replica].candidates) {
    for (const seed of plannedSeeds[replica]) {
      if (candidateSeedRetryable(replica, candidate.configurationId, seed, rawObservations, validObservations)) retryable.add(`${candidate.configurationId}:${seed}`);
    }
  }
  return retryable;
}

function exhaustedInfrastructureCandidateSeeds(replica: Replica, context: Awaited<ReturnType<typeof verifyFrozenInputs>>, rawObservations: RuntimeObservation[], validObservations: RuntimeObservation[]) {
  const exhausted = new Set<string>();
  for (const candidate of context.candidateSets[replica].candidates) {
    for (const seed of plannedSeeds[replica]) {
      if (!completedSeedsForCandidate(replica, candidate.configurationId, validObservations).has(seed) && !candidateSeedRetryable(replica, candidate.configurationId, seed, rawObservations, validObservations)) {
        exhausted.add(`${candidate.configurationId}:${seed}`);
      }
    }
  }
  return exhausted;
}

function candidateSeedRetryable(replica: Replica, configurationId: string, seed: number, rawObservations: RuntimeObservation[], validObservations: RuntimeObservation[]) {
  if (completedSeedsForCandidate(replica, configurationId, validObservations).has(seed)) return false;
  const maxAttempts = maxInfrastructureAttempts();
  for (const journeyId of journeyIds[replica]) {
    const validJourney = validObservations.some((row) => row.replica === replica && row.configurationId === configurationId && row.seed === seed && row.journeyId === journeyId);
    if (validJourney) continue;
    const attempts = rawObservations.filter((row) => row.replica === replica && row.configurationId === configurationId && row.seed === seed && row.journeyId === journeyId && !legacySupportAdminAuthFailure(row)).length;
    if (attempts < maxAttempts) return true;
  }
  return false;
}

function exhaustedInfrastructureDetails(
  replica: Replica,
  context: Awaited<ReturnType<typeof verifyFrozenInputs>>,
  rawObservations: RuntimeObservation[],
  validObservations: RuntimeObservation[],
  options: { includeLegacyAuthFailuresAsAttempts?: boolean } = {}
) {
  const rows: Array<Record<string, unknown>> = [];
  for (const candidate of context.candidateSets[replica].candidates) {
    for (const seed of plannedSeeds[replica]) {
      if (completedSeedsForCandidate(replica, candidate.configurationId, validObservations).has(seed)) continue;
      const retryable = options.includeLegacyAuthFailuresAsAttempts
        ? candidateSeedRetryableCountingAllAttempts(replica, candidate.configurationId, seed, rawObservations, validObservations)
        : candidateSeedRetryable(replica, candidate.configurationId, seed, rawObservations, validObservations);
      if (retryable) continue;
      const byJourney = journeyIds[replica].map((journeyId) => rawObservations.filter((row) => row.replica === replica && row.configurationId === candidate.configurationId && row.seed === seed && row.journeyId === journeyId));
      const flat = byJourney.flat();
      const first = flat[0];
      const failureType = first ? classifyFullConfirmationInfrastructureFailure(first) : "NO_OBSERVATION";
      rows.push({
        candidateId: candidate.configurationId,
        seed,
        journeyId: journeyIds[replica].join(";"),
        attemptCount: flat.length,
        failureType,
        failureMessage: conciseFailureMessage(first),
        phase: failurePhase(first),
        firstFailureTimestamp: "",
        lastFailureTimestamp: "",
        retryExhausted: true,
        existingValidJourneyObservations: byJourney.filter((items) => items.some((row) => !classifyFullConfirmationInfrastructureFailure(row))).length,
        perJourney: Object.fromEntries(byJourney.map((items, index) => [journeyIds[replica][index], {
          attempts: items.length,
          failureTypes: frequency(items.map((row) => classifyFullConfirmationInfrastructureFailure(row) || "VALID")),
          messages: frequency(items.map(conciseFailureMessage).filter(Boolean)),
          phases: frequency(items.map(failurePhase).filter(Boolean))
        }]))
      });
    }
  }
  return rows;
}

function infrastructureBreakdown(rows: Array<Record<string, unknown>>) {
  return {
    byCandidate: frequency(rows.map((row) => String(row.candidateId))),
    byJourney: frequency(rows.flatMap((row) => String(row.journeyId).split(";"))),
    bySeed: frequency(rows.map((row) => String(row.seed))),
    byFailureType: frequency(rows.map((row) => String(row.failureType))),
    byFailureMessage: frequency(rows.map((row) => String(row.failureMessage))),
    byPhase: frequency(rows.map((row) => String(row.phase))),
    byCategory: frequency(rows.map((row) => failureCategory(String(row.failureType), String(row.phase), String(row.failureMessage))))
  };
}

function supportAuditMarkdown(audit: { generatedAt: string; exhaustedCandidateSeedRuns: number; breakdown: Record<string, Record<string, number>>; rows: Array<Record<string, unknown>> }) {
  const lines = [
    "# Support Infrastructure Audit",
    "",
    `Generated: ${audit.generatedAt}`,
    `Exhausted candidate-seed runs: ${audit.exhaustedCandidateSeedRuns}`,
    "",
    "## Breakdown",
    "",
    ...Object.entries(audit.breakdown).flatMap(([name, counts]) => [`### ${name}`, "", ...Object.entries(counts).map(([key, count]) => `- ${key}: ${count}`), ""]),
    "## Exhausted Runs",
    "",
    "| candidateId | seed | journeyId | attemptCount | failureType | failureMessage | phase | firstFailureTimestamp | lastFailureTimestamp | retryExhausted | existingValidJourneyObservations |",
    "| --- | ---: | --- | ---: | --- | --- | --- | --- | --- | --- | ---: |",
    ...audit.rows.map((row) =>
      `| ${row.candidateId} | ${row.seed} | ${row.journeyId} | ${row.attemptCount} | ${row.failureType} | ${escapeMarkdown(String(row.failureMessage || ""))} | ${row.phase} | ${row.firstFailureTimestamp} | ${row.lastFailureTimestamp} | ${row.retryExhausted} | ${row.existingValidJourneyObservations} |`
    )
  ];
  return `${lines.join("\n")}\n`;
}

function legacySupportAdminAuthFailure(row: RuntimeObservation) {
  const message = conciseFailureMessage(row);
  return row.replica === "support" && !row.resultPath && row.outcome?.steps === 0 && !("failurePhase" in (row.outcome || {})) && message.includes("AUTH_FAILED");
}

function candidateSeedRetryableCountingAllAttempts(replica: Replica, configurationId: string, seed: number, rawObservations: RuntimeObservation[], validObservations: RuntimeObservation[]) {
  if (completedSeedsForCandidate(replica, configurationId, validObservations).has(seed)) return false;
  const maxAttempts = maxInfrastructureAttempts();
  for (const journeyId of journeyIds[replica]) {
    const validJourney = validObservations.some((row) => row.replica === replica && row.configurationId === configurationId && row.seed === seed && row.journeyId === journeyId);
    if (validJourney) continue;
    const attempts = rawObservations.filter((row) => row.replica === replica && row.configurationId === configurationId && row.seed === seed && row.journeyId === journeyId).length;
    if (attempts < maxAttempts) return true;
  }
  return false;
}

function conciseFailureMessage(row: RuntimeObservation | undefined) {
  return String(row?.outcome?.error || row?.violations?.[0] || "").replace(/\s+/g, " ").slice(0, 500);
}

function failurePhase(row: RuntimeObservation | undefined) {
  return String((row?.outcome as RuntimeObservation["outcome"] & { failurePhase?: string } | undefined)?.failurePhase || (conciseFailureMessage(row).includes("AUTH_FAILED") ? "reset_auth" : ""));
}

function failureCategory(failureType: string, phase: string, message: string) {
  if (phase.includes("reset") || failureType.includes("RESET")) return message.includes("AUTH_FAILED") ? "reset/auth/database" : "reset/database";
  if (failureType.includes("STARTUP")) return "browser/API/startup";
  if (failureType.includes("VERIFIER")) return "verifier";
  return "runtime";
}

function escapeMarkdown(value: string) {
  return value.replaceAll("|", "\\|");
}

function frequency(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function maxInfrastructureAttempts() {
  return Math.max(1, Number(process.env.FULL_CONFIRMATION_MAX_INFRA_ATTEMPTS || 3));
}

function minState(states: ConfidenceState[], replica: Replica, configurationId: string, metric: ConfidenceState["metric"], key: "lower" | "upper") {
  const values = states.filter((state) => state.replica === replica && state.configurationId === configurationId && state.metric === metric).map((state) => state[key]);
  return values.length ? Math.min(...values) : key === "lower" ? 0 : 1;
}

function maxState(states: ConfidenceState[], replica: Replica, configurationId: string, metric: ConfidenceState["metric"], key: "lower" | "upper") {
  const values = states.filter((state) => state.replica === replica && state.configurationId === configurationId && state.metric === metric).map((state) => state[key]);
  return values.length ? Math.max(...values) : key === "lower" ? 0 : 1;
}

function observationKey(row: RuntimeObservation) {
  return `${row.replica}:${row.configurationId}:${row.seed}:${row.journeyId}`;
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function selectedReplicas(replica?: Replica) {
  return replica ? [replica] : replicas;
}

function fullDir(repoRoot: string) {
  return repoPath(repoRoot, fullRelativeDir);
}

function fullOutputFiles(repoRoot: string) {
  return [
    "manifest.snapshot.yaml",
    "candidate-set-audit.json",
    "confirmation-observations.jsonl",
    "confirmation-run-index.csv",
    "confidence-sequence-history.jsonl",
    "candidate-bounds.csv",
    "safety-stream-summary.csv",
    "objective-bound-summary.csv",
    "stopping-gap-history.csv",
    "seed-usage.csv",
    "runtime-failures.csv",
    "confirmation-summary.csv",
    "certificates.jsonl",
    "full-confirmation-report.md"
  ].map((file) => path.join(fullDir(repoRoot), file));
}
