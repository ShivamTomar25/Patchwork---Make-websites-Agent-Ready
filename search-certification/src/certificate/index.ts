import type { CandidateSet, CertificateRecord, ConfidenceState, PatchConfiguration, SearchManifest } from "../types.js";
import { certifiedSafe, objectiveBounds, plausiblySafe } from "../confidence-sequences/index.js";

export function certificateForCandidateSet(
  candidateSet: CandidateSet,
  states: ConfidenceState[],
  observations: number,
  manifest: SearchManifest
): CertificateRecord {
  const threshold = manifest.safetyThresholds.aggregate ?? 0.05;
  const bounds = candidateSet.candidates.map((candidate) => ({
    candidate,
    certifiedSafe: certifiedSafe(states, candidate.configurationId, threshold),
    plausiblySafe: plausiblySafe(states, candidate.configurationId, threshold),
    objectiveBounds: objectiveBounds(states, candidate.configurationId, costPenalty(candidate, manifest), 0)
  }));
  const certified = bounds.filter((item) => item.certifiedSafe).sort((left, right) => right.objectiveBounds.lower - left.objectiveBounds.lower);
  if (certified.length === 0) {
    return {
      status: "NOT_CERTIFIED",
      replica: candidateSet.replica,
      reason: "confirmation budget exhausted before every required safety stream had upper violation bound below threshold",
      candidateSetHash: candidateSet.candidateSetHash,
      confirmationRuns: observations,
      deploymentAllowed: false,
      humanApprovalRequired: true
    };
  }
  const selected = certified[0]!;
  const plausible = bounds.filter((item) => item.plausiblySafe);
  const maximumChallengerUpperBound = plausible.length ? Math.max(...plausible.map((item) => item.objectiveBounds.upper)) : selected.objectiveBounds.upper;
  const gap = maximumChallengerUpperBound - selected.objectiveBounds.lower;
  if (gap > manifest.epsilon) {
    return {
      status: "NOT_CERTIFIED",
      replica: candidateSet.replica,
      reason: `confirmation stopping gap ${gap.toFixed(4)} exceeded epsilon ${manifest.epsilon}`,
      candidateSetHash: candidateSet.candidateSetHash,
      confirmationRuns: observations,
      deploymentAllowed: false,
      humanApprovalRequired: true
    };
  }
  return {
    status: "CERTIFIED",
    replica: candidateSet.replica,
    selectedConfiguration: selected.candidate.patchIds,
    candidateSetHash: candidateSet.candidateSetHash,
    candidateSetScope: true,
    epsilon: manifest.epsilon,
    delta: manifest.delta,
    safetyThresholdsSatisfied: true,
    objectiveLowerBound: selected.objectiveBounds.lower,
    maximumChallengerUpperBound,
    confirmationRuns: observations,
    searchDataReused: false,
    humanApprovalRequired: true
  };
}

export function certificateScopeText(record: CertificateRecord) {
  if (record.status === "CERTIFIED") return "Candidate-set scoped certificate only; this is not a global optimality claim.";
  return "No deployment certificate issued; abstention preserves the candidate-set scope.";
}

function costPenalty(candidate: PatchConfiguration, manifest: SearchManifest) {
  return manifest.objective.lambdaCost * Math.min(1, candidate.engineeringMinutes / 240);
}
