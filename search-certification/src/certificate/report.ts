import path from "node:path";
import type { CertificateRecord, OracleRecord, SearchHistoryRecord } from "../types.js";
import { readCsvObjects, readJsonl, resultDir, writeCsv } from "../storage/files.js";
import { resultFiles } from "../storage/loaders.js";
import { writeFile } from "node:fs/promises";

export async function writeSearchCertificationReport(repoRoot: string) {
  const files = resultFiles(repoRoot);
  const oracle = await readJsonl<OracleRecord>(files.oracleResults);
  const search = await readJsonl<SearchHistoryRecord>(files.searchHistory);
  const certificates = await readJsonl<CertificateRecord>(files.certificates);
  const oracleSummary = readCsvObjects(files.oracleSummary);
  const searchSummary = readCsvObjects(files.searchSummary);
  const confirmationSummary = readCsvObjects(files.confirmationSummary);
  const recall = readCsvObjects(files.candidateRecall);
  const regret = readCsvObjects(files.regretSummary);
  await writeCsv(path.join(resultDir(repoRoot), "runtime-summary.csv"), [
    {
      oracle_runtime_rows: oracle.length,
      search_rollouts: search.length,
      confirmation_replicas: confirmationSummary.length,
      certificates: certificates.filter((item) => item.status === "CERTIFIED").length,
      abstentions: certificates.filter((item) => item.status === "NOT_CERTIFIED").length
    }
  ]);
  const lines = [
    "# PATCHWORK Search Certification Pilot v1",
    "",
    "Controlled scripted/mock pilot results validate search and certification orchestration only; they are not live LLM performance results.",
    "",
    "## Configuration Spaces",
    "",
    ...groupCounts(oracleSummary, "replica", "configuration_id").map((row) => `- ${row.key}: ${row.count} feasible configurations evaluated by oracle`),
    "",
    "## Search",
    "",
    ...searchSummary.map((row) => `- ${row.replica}: ${row.strategy}, ${row.evaluated_configurations} configurations, regret ${row.global_simple_regret}`),
    "",
    "## Candidate Recall",
    "",
    ...recall.map((row) => `- ${row.replica}: recall ${row.candidate_recall} at epsilon ${row.epsilon}`),
    "",
    "## Regret",
    "",
    ...regret.map((row) => `- ${row.replica}: true best ${row.true_best_safe_configuration}, selected ${row.search_selected_configuration}, regret ${row.global_simple_regret}`),
    "",
    "## Confirmation",
    "",
    ...confirmationSummary.map((row) => `- ${row.replica}: ${row.status}, runs ${row.confirmation_runs}, scope ${row.scope}`),
    "",
    "## Certificates",
    "",
    ...certificates.map((certificate) =>
      certificate.status === "CERTIFIED"
        ? `- ${certificate.replica}: CERTIFIED candidate-set scoped configuration ${certificate.selectedConfiguration.join(";")}`
        : `- ${certificate.replica}: NOT_CERTIFIED, ${certificate.reason}`
    ),
    "",
    "## Evidence Bundle",
    "",
    "- candidate-set-shop.json",
    "- candidate-set-saas.json",
    "- candidate-set-support.json",
    "- manifest.snapshot.yaml",
    "- oracle-results.jsonl",
    "- search-history.jsonl",
    "- confirmation-observations.jsonl",
    "- confidence-sequence-history.jsonl",
    "- certificates.jsonl",
    "",
    "No certificate in this bundle is a global optimality claim. Human approval remains required before any deployment."
  ];
  await writeFile(files.report, `${lines.join("\n")}\n`, "utf8");
}

function groupCounts(rows: Array<Record<string, string>>, key: string, _value: string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row[key] || "", (counts.get(row[key] || "") || 0) + 1);
  return [...counts.entries()].map(([itemKey, count]) => ({ key: itemKey, count }));
}
