import { loadMatrix, readJsonl, readPilotRecords, repairResultDir, writeCsv, writeJsonl } from "../io.js";
import { PairedReplayRecordSchema, type PairedReplayRecord, type PatchValidation, type TypedPatch } from "../schemas.js";

export async function pairedReplay(repoRoot: string) {
  const [records, patches, validations, matrix] = await Promise.all([
    readPilotRecords(repoRoot),
    readJsonl<TypedPatch>(`${repairResultDir(repoRoot)}/patches.jsonl`),
    readJsonl<PatchValidation>(`${repairResultDir(repoRoot)}/patch-validation.jsonl`),
    loadMatrix(repoRoot)
  ]);
  const validationByPatch = new Map(validations.map((row) => [row.patchId, row]));
  const rows: PairedReplayRecord[] = [];
  for (const entry of matrix.entries) {
    const patch = patches.find((item) => item.replica === entry.replica && item.journeyIds.includes(entry.journeyId));
    if (!patch) continue;
    const defectRows = records.filter(
      (record) => record.site === entry.replica && record.journeyId === entry.journeyId && record.condition === "defect" && record.defectId === entry.defectId
    );
    for (const baseline of defectRows) {
      const accepted = validationByPatch.get(patch.patchId)?.accepted ?? true;
      rows.push(
        PairedReplayRecordSchema.parse({
          journeyId: entry.journeyId,
          replica: entry.replica,
          seed: baseline.seed,
          defectId: entry.defectId,
          patchId: patch.patchId,
          executionOrder: baseline.seed % 2 === 0 ? ["patched", "baseline"] : ["baseline", "patched"],
          baselineRunId: `${baseline.site}-${baseline.journeyId}-seed${baseline.seed}-${entry.defectId}`,
          baselineVerifiedSuccess: baseline.verifiedSuccess,
          baselineViolations: baseline.violations,
          patchedExecuted: false,
          unresolvedReason: accepted
            ? "patched-server sandbox replay is not enabled; no patched outcome was fabricated"
            : "patch did not pass static validation"
        })
      );
    }
  }
  const resultDir = repairResultDir(repoRoot);
  await writeJsonl(`${resultDir}/paired-replay.jsonl`, rows);
  await writeCsv(
    `${resultDir}/paired-summary.csv`,
    rows.map((row) => ({
      replica: row.replica,
      journey_id: row.journeyId,
      seed: row.seed,
      defect_id: row.defectId,
      patch_id: row.patchId,
      execution_order: row.executionOrder.join(" then "),
      baseline_verified_success: row.baselineVerifiedSuccess,
      patched_executed: row.patchedExecuted,
      unresolved_reason: row.unresolvedReason
    }))
  );
  await writeCsv(
    `${resultDir}/regression-summary.csv`,
    rows.map((row) => ({
      replica: row.replica,
      journey_id: row.journeyId,
      seed: row.seed,
      unaffected_journey_regression_checked: false,
      rollback_checked: false,
      reason: row.unresolvedReason
    }))
  );
  await writeCsv(
    `${resultDir}/unresolved-cases.csv`,
    rows
      .filter((row) => !row.patchedExecuted)
      .map((row) => ({
        replica: row.replica,
        journey_id: row.journeyId,
        seed: row.seed,
        defect_id: row.defectId,
        patch_id: row.patchId,
        reason: row.unresolvedReason
      }))
  );
  return rows;
}
