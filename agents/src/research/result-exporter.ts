import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { redactSecrets } from "../core/utils.js";
import type { PilotManifest } from "./pilot-manifest.js";

export type PilotRunRecord = {
  experimentId: string;
  manifestVersion: string;
  siteCommit: string;
  contractVersion: string;
  site: string;
  journeyId: string;
  agentId: string;
  provider: string;
  model: string;
  promptVersion: string;
  seed: number;
  condition: "clean" | "defect";
  defectId?: string;
  verifiedSuccess: boolean;
  violations: string[];
  firstFailedPredicate: string;
  terminationReason: string;
  steps: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  screenshots: string[];
  accessibilitySnapshots: string[];
  toolCalls: string[];
  backendStateBefore: unknown;
  backendStateAfter: unknown;
  resetResult: unknown;
  resultPath?: string;
};

const DEFAULT_RESULT_DIRECTORY = "experiments/results/pilot-study-v1";

export async function exportPilotResults(
  repoRoot: string,
  manifest: PilotManifest,
  records: PilotRunRecord[],
  resultDirectory = DEFAULT_RESULT_DIRECTORY
) {
  const resultDir = path.join(repoRoot, resultDirectory);
  await mkdir(path.join(resultDir, "failed-runs"), { recursive: true });
  await writeFile(path.join(resultDir, "manifest.snapshot.yaml"), YAML.stringify(manifest));
  await writeFile(path.join(resultDir, "runs.jsonl"), records.map((record) => JSON.stringify(redactSecrets(record))).join("\n") + (records.length ? "\n" : ""));
  await writeFile(path.join(resultDir, "run-summary.csv"), csv(["experiment_id", "site", "journey_id", "agent_id", "seed", "condition", "defect_id", "verified_success", "termination_reason", "steps", "latency_ms", "input_tokens", "output_tokens"], records.map((record) => [
    record.experimentId,
    record.site,
    record.journeyId,
    record.agentId,
    record.seed,
    record.condition,
    record.defectId || "",
    String(record.verifiedSuccess),
    record.terminationReason,
    record.steps,
    record.latencyMs,
    record.inputTokens,
    record.outputTokens
  ])));
  await writeFile(path.join(resultDir, "journey-summary.csv"), groupedCsv(records, "journeyId"));
  await writeFile(path.join(resultDir, "agent-summary.csv"), groupedCsv(records, "agentId"));
  await writeFile(path.join(resultDir, "defect-summary.csv"), groupedCsv(records.filter((record) => record.condition === "defect"), "defectId"));
  await writeFile(path.join(resultDir, "violation-summary.csv"), frequencyCsv(records.map((record) => record.firstFailedPredicate || "none"), "first_failed_predicate"));
  await writeFile(path.join(resultDir, "termination-summary.csv"), frequencyCsv(records.map((record) => record.terminationReason), "termination_reason"));
  await writeFile(path.join(resultDir, "reset-summary.csv"), resetCsv(records));
  for (const record of records.filter((item) => !item.verifiedSuccess)) {
    const suffix = record.defectId || "clean";
    await writeFile(
      path.join(resultDir, "failed-runs", `${record.site}-${record.journeyId}-${record.agentId}-${record.seed}-${record.condition}-${suffix}.json`),
      `${JSON.stringify(redactSecrets(record), null, 2)}\n`
    );
  }
  await writeFile(path.join(resultDir, "pilot-report.md"), renderReport(manifest, records));
}

export async function readExistingPilotRecords(repoRoot: string, resultDirectory = DEFAULT_RESULT_DIRECTORY): Promise<PilotRunRecord[]> {
  const file = path.join(repoRoot, resultDirectory, "runs.jsonl");
  try {
    const content = await readFile(file, "utf8");
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as PilotRunRecord);
  } catch {
    return [];
  }
}

function groupedCsv(records: PilotRunRecord[], key: keyof PilotRunRecord) {
  const groups = new Map<string, PilotRunRecord[]>();
  for (const record of records) {
    const groupKey = String(record[key] || "none");
    groups.set(groupKey, [...(groups.get(groupKey) || []), record]);
  }
  return csv(["group", "runs", "verified_success_rate", "failure_rate", "violation_rate", "median_steps", "median_latency_ms", "input_tokens", "output_tokens"], [...groups.entries()].map(([group, items]) => [
    group,
    items.length,
    rate(items, (item) => item.verifiedSuccess),
    rate(items, (item) => !item.verifiedSuccess),
    rate(items, (item) => item.violations.length > 0),
    median(items.map((item) => item.steps)),
    median(items.map((item) => item.latencyMs)),
    sum(items.map((item) => item.inputTokens)),
    sum(items.map((item) => item.outputTokens))
  ]));
}

function frequencyCsv(values: string[], header: string) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return csv([header, "count"], [...counts.entries()]);
}

function renderReport(manifest: PilotManifest, records: PilotRunRecord[]) {
  const defectRecords = records.filter((record) => record.condition === "defect");
  const resetFailures = records.filter((record) => !resetSucceeded(record)).length;
  const safetyViolations = records.filter((record) => record.terminationReason === "safety_violation" || record.violations.some((violation) => /safety/i.test(violation))).length;
  return [
    "# PATCHWORK Pilot Report",
    "",
    `Manifest: ${manifest.manifestVersion}`,
    `Study type: ${manifest.studyType}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Metrics",
    "",
    `- Runs: ${records.length}`,
    `- Verified success rate: ${rate(records, (record) => record.verifiedSuccess)}%`,
    `- Compliant success rate: ${rate(records, (record) => record.verifiedSuccess && record.violations.length === 0)}%`,
    `- Violation rate: ${rate(records, (record) => record.violations.length > 0)}%`,
    `- Median steps: ${median(records.map((record) => record.steps))}`,
    `- Median latency: ${median(records.map((record) => record.latencyMs))} ms`,
    `- Input tokens: ${sum(records.map((record) => record.inputTokens))}`,
    `- Output tokens: ${sum(records.map((record) => record.outputTokens))}`,
    `- Expected-defect detection rate: ${rate(defectRecords, (record) => !record.verifiedSuccess || record.violations.length > 0)}%`,
    `- Reset failure rate: ${records.length ? Math.round((resetFailures / records.length) * 100) : 0}%`,
    `- Reset success rate: ${rate(records, resetSucceeded)}%`,
    `- Safety-violation rate: ${records.length ? Math.round((safetyViolations / records.length) * 100) : 0}%`,
    `- Failure rate by journey: ${summarizeRates(records, "journeyId")}`,
    `- Failure rate by replica: ${summarizeRates(records, "site")}`,
    `- Failure rate by agent: ${summarizeRates(records, "agentId")}`,
    `- First failed predicate frequency: ${summarizeFrequency(records.map((record) => record.firstFailedPredicate || "none"))}`,
    "",
    "## Notes",
    "",
    "- This is a pilot, not the final preregistered study.",
    "- Mock-provider results validate orchestration and verifier wiring; they are not live LLM performance results.",
    "- No fake results are generated; empty metrics mean the pilot has not been executed."
  ].join("\n") + "\n";
}

function resetCsv(records: PilotRunRecord[]) {
  return csv(
    [
      "experiment_id",
      "site",
      "journey_id",
      "seed",
      "condition",
      "defect_id",
      "pre_run_reset_ok",
      "post_run_reset_ok",
      "recovery_verified_success",
      "reset_success"
    ],
    records.map((record) => [
      record.experimentId,
      record.site,
      record.journeyId,
      record.seed,
      record.condition,
      record.defectId || "",
      nestedBoolean(record.resetResult, ["preRunReset", "ok"]),
      nestedBoolean(record.resetResult, ["cleanReset", "ok"]),
      nestedBoolean(record.resetResult, ["recoveryVerification", "verifiedSuccess"]),
      resetSucceeded(record)
    ])
  );
}

function resetSucceeded(record: PilotRunRecord) {
  if (JSON.stringify(record.resetResult).includes("error")) return false;
  const preRun = nestedBoolean(record.resetResult, ["preRunReset", "ok"]);
  const postRun = nestedBoolean(record.resetResult, ["cleanReset", "ok"]);
  const recovery = nestedBoolean(record.resetResult, ["recoveryVerification", "verifiedSuccess"]);
  return preRun !== false && postRun !== false && (record.condition === "clean" || recovery === true);
}

function nestedBoolean(value: unknown, path: string[]): boolean | "" {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) return "";
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "boolean" ? current : "";
}

function summarizeRates(records: PilotRunRecord[], key: keyof PilotRunRecord) {
  if (records.length === 0) return "none";
  const groups = new Map<string, PilotRunRecord[]>();
  for (const record of records) {
    const groupKey = String(record[key] || "none");
    groups.set(groupKey, [...(groups.get(groupKey) || []), record]);
  }
  return [...groups.entries()]
    .map(([group, items]) => `${group} ${rate(items, (item) => !item.verifiedSuccess)}%`)
    .join("; ");
}

function summarizeFrequency(values: string[]) {
  if (values.length === 0) return "none";
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].map(([value, count]) => `${value} ${count}`).join("; ");
}

function csv(header: string[], rows: unknown[][]) {
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n";
}

function cell(value: unknown) {
  const text = String(value ?? "");
  return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rate(records: PilotRunRecord[], predicate: (record: PilotRunRecord) => boolean) {
  if (records.length === 0) return 0;
  return Math.round((records.filter(predicate).length / records.length) * 100);
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
