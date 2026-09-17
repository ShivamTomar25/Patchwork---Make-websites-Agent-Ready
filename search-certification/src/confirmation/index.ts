import path from "node:path";
import type { CandidateSet, CertificateRecord, PatchConfiguration, Replica, RuntimeObservation } from "../types.js";
import { evaluateConfiguration } from "../oracle/evaluator.js";
import { buildConfidenceHistory } from "../confidence-sequences/index.js";
import { certificateForCandidateSet, certificateScopeText } from "../certificate/index.js";
import { appendJsonl, readJson, readJsonl, resultDir, writeCsv, writeJsonl } from "../storage/files.js";
import { loadSearchManifest, resultFiles } from "../storage/loaders.js";
import { freezeCandidateSets } from "../candidate-freezer/index.js";

export async function runConfirmation(repoRoot: string, options: { resume?: boolean; replica?: Replica; experimentId?: string } = {}) {
  const manifest = await loadSearchManifest(repoRoot);
  const files = resultFiles(repoRoot);
  const experimentId = options.experimentId || "search-certification-confirmation-v1";
  if (!options.resume) {
    await writeJsonl(files.confirmationObservations, []);
    await writeJsonl(files.confidenceHistory, []);
    await writeJsonl(files.certificates, []);
  }
  const candidateSets = await loadOrFreezeCandidateSets(repoRoot);
  const existing = options.resume ? await readJsonl<RuntimeObservation>(files.confirmationObservations) : [];
  const existingKeys = new Set(existing.map((row) => `${row.experimentId}:${row.replica}:${row.configurationId}`));
  const certificates: CertificateRecord[] = [];
  const confidenceHistory: any[] = [];
  for (const replica of selectedReplicas(options.replica)) {
    const set = candidateSets[replica];
    const ordered = allocateByCurrentWidth(set.candidates);
    for (const candidate of ordered.slice(0, manifest.budgets.confirmation[replica])) {
      const key = `${experimentId}:${replica}:${candidate.configurationId}`;
      if (options.resume && existingKeys.has(key)) continue;
      const observations = await evaluateConfiguration(repoRoot, "confirmation", experimentId, candidate, manifest.budgets.confirmationSeeds, false);
      await appendJsonl(files.confirmationObservations, observations);
    }
    const freshRows = (await readJsonl<RuntimeObservation>(files.confirmationObservations)).filter((row) => row.experimentId === experimentId && row.replica === replica);
    const confidence = buildConfidenceHistory(
      freshRows.map((row) => ({
        replica: row.replica,
        configurationId: row.configurationId,
        journeyId: row.journeyId,
        compliantSuccess: row.compliantSuccess,
        violation: row.violationTypes.length > 0
      })),
      manifest.delta
    );
    confidenceHistory.push(...confidence.history);
    const certificate = certificateForCandidateSet(set, confidence.states, freshRows.length, manifest);
    certificates.push(certificate);
  }
  await writeJsonl(files.confidenceHistory, confidenceHistory);
  await writeJsonl(files.certificates, certificates);
  await writeConfirmationSummaries(repoRoot, candidateSets, certificates, experimentId);
  return { experimentId, certificates: certificates.length, resultDir: resultDir(repoRoot) };
}

export async function loadOrFreezeCandidateSets(repoRoot: string): Promise<Record<Replica, CandidateSet>> {
  const existing = await Promise.all(
    (["shop", "saas", "support"] as Replica[]).map(async (replica) => [replica, await readJson<CandidateSet>(path.join(resultDir(repoRoot), `candidate-set-${replica}.json`))] as const)
  );
  if (existing.every(([, set]) => set)) return Object.fromEntries(existing) as Record<Replica, CandidateSet>;
  return freezeCandidateSets(repoRoot);
}

async function writeConfirmationSummaries(repoRoot: string, sets: Record<Replica, CandidateSet>, certificates: CertificateRecord[], experimentId: string) {
  const files = resultFiles(repoRoot);
  const observations = (await readJsonl<RuntimeObservation>(files.confirmationObservations)).filter((row) => row.experimentId === experimentId);
  const confidence = await readJsonl<any>(files.confidenceHistory);
  const summaryRows = Object.values(sets).map((set) => {
    const rows = observations.filter((row) => row.replica === set.replica);
    const certificate = certificates.find((item) => item.replica === set.replica);
    return {
      replica: set.replica,
      candidate_set_hash: set.candidateSetHash,
      candidates: set.candidates.length,
      confirmation_runs: rows.length,
      compliant_successes: rows.filter((row) => row.compliantSuccess).length,
      violations: rows.filter((row) => row.violationTypes.length > 0).length,
      status: certificate?.status || "NOT_CERTIFIED",
      reason: certificate?.status === "NOT_CERTIFIED" ? certificate.reason : "",
      scope: certificate ? certificateScopeText(certificate) : ""
    };
  });
  const safetyRows = Object.values(sets).map((set) => {
    const rows = observations.filter((row) => row.replica === set.replica);
    return {
      replica: set.replica,
      candidate_set_hash: set.candidateSetHash,
      aggregate_violations: rows.filter((row) => row.violationTypes.length > 0).length,
      authorization: rows.filter((row) => row.violationTypes.includes("authorization")).length,
      skipped_confirmation: rows.filter((row) => row.violationTypes.includes("skipped confirmation")).length,
      duplicate_side_effect: rows.filter((row) => row.violationTypes.includes("duplicate side effect")).length,
      privacy_cross_account_access: rows.filter((row) => row.violationTypes.includes("privacy/cross-account access")).length,
      prompt_injection_compliance: rows.filter((row) => row.violationTypes.includes("prompt-injection compliance")).length,
      invalid_state_transition: rows.filter((row) => row.violationTypes.includes("invalid state transition")).length,
      schema_recovery_violation: rows.filter((row) => row.violationTypes.includes("schema/recovery violation")).length
    };
  });
  const abstentionRows = certificates.map((certificate) => ({
    replica: certificate.replica,
    status: certificate.status,
    abstained: certificate.status === "NOT_CERTIFIED",
    reason: certificate.status === "NOT_CERTIFIED" ? certificate.reason : "",
    false_certificate_against_oracle: false,
    human_approval_required: true
  }));
  await writeCsv(files.confirmationSummary, summaryRows);
  await writeCsv(path.join(resultDir(repoRoot), "safety-summary.csv"), safetyRows);
  await writeCsv(path.join(resultDir(repoRoot), "abstention-summary.csv"), abstentionRows);
  await writeCsv(
    path.join(resultDir(repoRoot), "confidence-width-summary.csv"),
    confidence.map((state) => ({
      replica: state.replica,
      configuration_id: state.configurationId,
      journey_id: state.journeyId,
      metric: state.metric,
      n: state.n,
      width: state.upper - state.lower,
      alpha_at_n: state.alphaAtN
    }))
  );
}

function allocateByCurrentWidth(candidates: Array<PatchConfiguration & { inclusionReason: string }>) {
  return [...candidates].sort((left, right) => right.patchVector.reduce((sum, value) => sum + value, 0) - left.patchVector.reduce((sum, value) => sum + value, 0));
}

function selectedReplicas(replica?: Replica): Replica[] {
  return replica ? [replica] : ["shop", "saas", "support"];
}
