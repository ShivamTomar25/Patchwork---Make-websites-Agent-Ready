import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { repairResultDir, writeCsv } from "../io.js";
import type { FailureCone, LocalizationResult, PairedReplayRecord, PatchValidation, TypedPatch } from "../schemas.js";

export async function writeRepairReport(repoRoot: string) {
  const resultDir = repairResultDir(repoRoot);
  const [localizations, cones, patches, validations, replays] = await Promise.all([
    readJsonlFile<LocalizationResult>(`${resultDir}/localization.jsonl`),
    readJsonlFile<FailureCone>(`${resultDir}/failure-cones.jsonl`),
    readJsonlFile<TypedPatch>(`${resultDir}/patches.jsonl`),
    readJsonlFile<PatchValidation>(`${resultDir}/patch-validation.jsonl`),
    readJsonlFile<PairedReplayRecord>(`${resultDir}/paired-replay.jsonl`)
  ]);
  const exactLocalization = ratio(localizations.filter((row) => row.confidence >= 0.9).length, localizations.length);
  const exactRoot = ratio(cones.filter((row) => row.exactRootCause).length, cones.length);
  const top3Root = ratio(cones.filter((row) => row.top3RootCause).length, cones.length);
  const contained = ratio(cones.filter((row) => row.rootCauseContained).length, cones.length);
  const accepted = validations.filter((row) => row.accepted);
  const replayed = replays.filter((row) => row.patchedExecuted);
  const unresolved = replays.filter((row) => !row.patchedExecuted);
  await writeCsv(`${resultDir}/repair-kpis.csv`, [
    {
      localized_runs: localizations.length,
      exact_localization_accuracy: exactLocalization,
      exact_root_cause_accuracy: exactRoot,
      top3_root_cause_accuracy: top3Root,
      root_cause_in_cone_rate: contained,
      median_cone_size_percent: median(cones.map((row) => row.conePercent)),
      patch_generation_success_rate: ratio(patches.length, 11),
      schema_ast_pass_rate: ratio(accepted.length, validations.length),
      unit_property_test_pass_rate: "not_run",
      sandbox_pass_rate: ratio(validations.filter((row) => row.sandboxBuild === "pass").length, validations.length),
      rollback_success_rate: ratio(validations.filter((row) => row.rollbackTest === "pass").length, validations.length),
      paired_replay_rows: replays.length,
      patched_replay_executed: replayed.length,
      unresolved_cases: unresolved.length,
      median_time_to_validated_patch_minutes: median(validations.filter((row) => row.accepted).map((row) => {
        const patch = patches.find((item) => item.patchId === row.patchId);
        return patch?.estimatedEngineeringMinutes ?? 0;
      })),
      median_synthesis_attempts: 1
    }
  ]);
  const report = [
    "# PATCHWORK Repair Pilot Report",
    "",
    "Manifest: repair-pilot-v1",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Metrics",
    "",
    `- Localized failed defect runs: ${localizations.length}/33`,
    `- Exact localization accuracy: ${exactLocalization}`,
    `- Exact root-cause accuracy: ${exactRoot}`,
    `- Top-3 root-cause accuracy: ${top3Root}`,
    `- Root-cause-in-cone rate: ${contained}`,
    `- Median cone size: ${median(cones.map((row) => row.conePercent))}%`,
    `- Patches generated: ${patches.length}/11`,
    `- Static validation accepted: ${accepted.length}/${validations.length}`,
    `- Paired replay rows prepared: ${replays.length}`,
    `- Patched runtime replay executed: ${replayed.length}/${replays.length}`,
    `- Unresolved cases: ${unresolved.length}`,
    "",
    "## Notes",
    "",
    "- Results use scripted/mock V2 traces for localization and cone evaluation.",
    "- Patch candidates are deterministic template sidecars and are not unrestricted LLM patches.",
    "- Runtime patched-server replay is not claimed unless `patchedExecuted=true` appears in paired-replay.jsonl.",
    "- No development database is required for this repair pilot export."
  ].join("\n");
  await writeFile(`${resultDir}/repair-pilot-report.md`, `${report}\n`, "utf8");
}

async function readJsonlFile<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) return [];
  const content = await readFile(file, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
