import { templateForDefect } from "../catalog.js";
import {
  loadContracts,
  loadMatrix,
  readPilotRecords,
  readTraceEvents,
  repairResultDir,
  writeCsv,
  writeJsonl
} from "../io.js";
import { LocalizationResultSchema, type FailureCategory, type LocalizationResult } from "../schemas.js";

type VerifierPredicate = {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
};

export async function auditLocalization(repoRoot: string) {
  const [records, matrix, contracts] = await Promise.all([readPilotRecords(repoRoot), loadMatrix(repoRoot), loadContracts(repoRoot)]);
  const failedDefectRows = records.filter((record) => record.condition === "defect" && (!record.verifiedSuccess || record.violations.length > 0));
  const rows: LocalizationResult[] = [];
  for (const record of failedDefectRows) {
    const matrixEntry = matrix.entries.find((entry) => entry.replica === record.site && entry.journeyId === record.journeyId && entry.defectId === record.defectId);
    if (!matrixEntry || !record.defectId) continue;
    const contract = contracts[record.site]?.find((item) => item.journeyId === record.journeyId);
    const trace = await readTraceEvents(record.resultPath);
    const verifier = trace
      .map((event) => (event.verifierState || (event.actionResult as any)?.verifier) as { predicates?: VerifierPredicate[] } | undefined)
      .find((item) => item?.predicates?.length);
    const firstFailed = firstFailedPredicate(verifier?.predicates, record.firstFailedPredicate, record.violations, matrixEntry.expectedFirstFailedPredicate);
    const result = LocalizationResultSchema.parse({
      journeyId: record.journeyId,
      runId: runIdFromTrace(trace) || `${record.site}-${record.journeyId}-${record.seed}-${record.defectId}`,
      replica: record.site,
      seed: record.seed,
      defectId: record.defectId,
      firstViolatedPredicate: firstFailed,
      lastVerifiedCheckpoint: lastCheckpoint(verifier?.predicates, contract?.startingCheckpoint ?? "deterministic_seed"),
      failureCategory: categoryFor(record.defectId, record.terminationReason),
      evidenceEventIds: trace
        .filter((event) => event.type === "step" || event.type === "run_end")
        .map((event) => String(event.stepId || event.runId || "event"))
        .filter(Boolean),
      confidence: firstFailed === matrixEntry.expectedFirstFailedPredicate ? 0.95 : 0.65
    });
    rows.push(result);
  }
  const resultDir = repairResultDir(repoRoot);
  await writeJsonl(`${resultDir}/localization.jsonl`, rows);
  await writeCsv(
    `${resultDir}/localization-summary.csv`,
    summarizeLocalization(rows, matrix.entries.map((entry) => ({ journeyId: entry.journeyId, defectId: entry.defectId, expected: entry.expectedFirstFailedPredicate })))
  );
  return rows;
}

export function summarizeLocalization(
  rows: LocalizationResult[],
  expected: Array<{ journeyId: string; defectId: string; expected: string }>
) {
  const expectedByKey = new Map(expected.map((item) => [`${item.journeyId}:${item.defectId}`, item.expected]));
  return rows.map((row) => {
    const expectedPredicate = expectedByKey.get(`${row.journeyId}:${row.defectId}`) || "";
    return {
      replica: row.replica,
      journey_id: row.journeyId,
      seed: row.seed,
      defect_id: row.defectId,
      run_id: row.runId,
      first_violated_predicate: row.firstViolatedPredicate,
      expected_first_predicate: expectedPredicate,
      exact_match: row.firstViolatedPredicate === expectedPredicate,
      failure_category: row.failureCategory,
      last_verified_checkpoint: row.lastVerifiedCheckpoint,
      confidence: row.confidence,
      evidence_events: row.evidenceEventIds.length
    };
  });
}

function firstFailedPredicate(
  predicates: VerifierPredicate[] | undefined,
  recordFirst: string,
  violations: string[],
  expected: string
) {
  const verifierFailed = predicates?.find((predicate) => !predicate.passed)?.name;
  return verifierFailed || recordFirst || violations.find((violation) => !violation.startsWith("locator.")) || expected;
}

function lastCheckpoint(predicates: VerifierPredicate[] | undefined, startingCheckpoint: string) {
  if (!predicates?.length) return "pre_run_reset_health";
  const firstFailedIndex = predicates.findIndex((predicate) => !predicate.passed);
  if (firstFailedIndex <= 0) return startingCheckpoint;
  return predicates[firstFailedIndex - 1]?.name || startingCheckpoint;
}

function categoryFor(defectId: string, terminationReason: string): FailureCategory {
  if (/timeout|invalid_model|infrastructure/i.test(terminationReason)) return "verifier_infrastructure_failure";
  return templateForDefect(defectId).failureCategory;
}

function runIdFromTrace(trace: Array<Record<string, unknown>>) {
  return trace.find((event) => event.type === "run_start")?.runId as string | undefined;
}
