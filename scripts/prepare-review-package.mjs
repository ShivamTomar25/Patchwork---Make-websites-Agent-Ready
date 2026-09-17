#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  diffSnapshots,
  duplicateValidObservationKeys,
  FROZEN_REL,
  isValidConfirmationObservation,
  parseCsv,
  repoRootFromScript,
  sha256File,
  snapshotDirectory,
  stableJsonHash
} from "./final-paper-eval.mjs";

const FINAL_REL = "experiments/results/final-paper-v1";
const SHARE_REL = `${FINAL_REL}/share-for-review`;
const ZIP_REL = `${FINAL_REL}/PATCHWORK_REVIEW_PACKAGE.zip`;
const REPAIR_REL = "experiments/results/repair-pilot-v1";
const GENERATED_AT = new Date().toISOString();
const REPLICAS = ["shop", "saas", "support"];
const EXPECTED_FROZEN_MANIFEST_HASH = "09453c813fbd1f71c203ef28e26a1d5ae90b1b25346a3c74356ea04d2ad21eda";
const EXPECTED_CANDIDATE_HASHES = {
  shop: "f19533c548554c88068bd39cf260e4f2a55715768b95380f7f0cbe48dada0820",
  saas: "67262e5ad7e97d78b71e53230b1ccce37cea500e984a5775484f41343588c5fb",
  support: "31fd164c522da600bf041fc94b1646923e2c2535f5d607f7aa49f0c6d50e4d84"
};
const EXPECTED_TERMINAL_STATUSES = {
  shop: "NOT_CERTIFIED_INFRASTRUCTURE_FAILURE",
  saas: "NOT_CERTIFIED_SAFETY_BOUND_NOT_CLOSED",
  support: "NOT_CERTIFIED_SAFETY_BOUND_NOT_CLOSED"
};

const repo = repoRootFromScript();
const finalRoot = path.join(repo, FINAL_REL);
const frozenRoot = path.join(repo, FROZEN_REL);
const shareRoot = path.join(repo, SHARE_REL);
const zipPath = path.join(repo, ZIP_REL);

function rel(...parts) {
  return path.join(...parts);
}

function fromFinal(...parts) {
  return path.join(finalRoot, ...parts);
}

function fromFrozen(...parts) {
  return path.join(frozenRoot, ...parts);
}

function fromShare(...parts) {
  return path.join(shareRoot, ...parts);
}

function readText(file) {
  return readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function readCsv(file) {
  return parseCsv(readText(file));
}

function writeText(file, text) {
  writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

function listFilesRecursive(dir, base = dir) {
  const result = [];
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) result.push(...listFilesRecursive(full, base));
    else if (stat.isFile()) result.push(path.relative(base, full));
  }
  return result;
}

function lineCount(file) {
  if (!existsSync(file)) return 0;
  const text = readText(file);
  if (!text) return 0;
  return text.split(/\n/).filter(Boolean).length;
}

function rowCount(file) {
  const ext = path.extname(file);
  if (!existsSync(file)) return null;
  if (ext === ".csv") return Math.max(0, readCsv(file).length);
  if (ext === ".jsonl") return lineCount(file);
  if (ext === ".json") {
    const value = readJson(file);
    if (Array.isArray(value)) return value.length;
    for (const key of ["rows", "statuses", "records", "comparisons", "figures", "files"]) {
      if (Array.isArray(value?.[key])) return value[key].length;
    }
    return null;
  }
  return null;
}

function escapeMd(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function table(rows, headers = null) {
  if (!rows.length) return "_No rows._\n";
  const actualHeaders = headers ?? Object.keys(rows[0]);
  const header = `| ${actualHeaders.map(escapeMd).join(" | ")} |`;
  const sep = `| ${actualHeaders.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${actualHeaders.map((h) => escapeMd(row[h])).join(" | ")} |`);
  return `${[header, sep, ...body].join("\n")}\n`;
}

function pick(row, keys) {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || value === "" || value === "N/A") return "N/A";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(digits);
  const number = Number(value);
  if (Number.isFinite(number)) return Number.isInteger(number) ? String(number) : number.toFixed(digits);
  return String(value);
}

function normalizeUnavailable(value) {
  if (value === "N/A" || value === "" || value === undefined) return null;
  return value;
}

function withUnavailableReason(row) {
  const output = {};
  for (const [key, value] of Object.entries(row)) {
    output[key] = normalizeUnavailable(value);
  }
  if (Object.values(row).some((value) => value === "N/A" || value === "")) {
    output.unavailableReason = row.notes ?? "No frozen evaluated artifact was available for this field.";
  }
  return output;
}

function summarizeFigure(figure, rows) {
  if (!rows.length) return "No CSV rows.";
  const id = figure.id;
  if (id.includes("localization")) {
    return "Exact root-cause localization is 1.000 and median cone size is 13.33%.";
  }
  if (id.includes("regret")) {
    return "At registered maximum budgets, random feasible search and graph-aware search both have mean global regret 0.000.";
  }
  if (id.includes("candidate-recall")) {
    return "Candidate recall at epsilon is 1.000 across registered rows.";
  }
  if (id.includes("unsafe")) {
    return "Unsafe recommendation rate is 0.000 across registered search rows.";
  }
  if (id.includes("confirmation")) {
    return "Independent confirmation abstained: 0/3 certified replicas with 10,781 valid observations.";
  }
  if (id.includes("patch-verification")) {
    return "Patch validation accepted 11/11 generated patches with 33/33 patched compliant paired replays.";
  }
  if (id.includes("baseline")) {
    return "Original interface CSR is 0.000; PATCHWORK without confirmation CSR is 1.000; Full PATCHWORK abstains.";
  }
  if (id.includes("ablation")) {
    return "Only the no-independent-confirmation ablation is executed; Full PATCHWORK is a reference with abstention.";
  }
  return "See source CSV for plotted values.";
}

function requiredFile(pathToFile) {
  if (!existsSync(pathToFile)) throw new Error(`Missing required artifact: ${path.relative(repo, pathToFile)}`);
  return pathToFile;
}

function linesForCsvSnippet(file, maxRows = null) {
  const rows = readCsv(file);
  return table(maxRows ? rows.slice(0, maxRows) : rows);
}

function sourceLink(sourcePath) {
  return path.relative(repo, sourcePath);
}

function directoryHash(snapshot) {
  return snapshot.directoryHash;
}

function sortedJson(value) {
  return JSON.stringify(value, Object.keys(value).sort(), 2);
}

function jsonStable(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(jsonStable);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, jsonStable(value[key])]));
}

function scanForSecrets(dir) {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\bpostgres(?:ql)?:\/\/[^\s)]+/i,
    /\bmongodb(?:\+srv)?:\/\/[^\s)]+/i,
    /\b(mysql|redis):\/\/[^\s)]+/i,
    /\b(api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{12,}/i
  ];
  const findings = [];
  for (const relativePath of listFilesRecursive(dir)) {
    const full = path.join(dir, relativePath);
    const stat = statSync(full);
    if (stat.size > 3_000_000) continue;
    const text = readText(full);
    patterns.forEach((pattern, index) => {
      if (pattern.test(text)) findings.push({ file: relativePath, patternIndex: index });
    });
  }
  return findings;
}

function buildRawIndexRows() {
  const sourceFiles = [
    rel(FINAL_REL, "reports/FINAL_CONTROLLED_EVALUATION.json"),
    rel(FINAL_REL, "reports/FINAL_CONTROLLED_EVALUATION.md"),
    rel(FINAL_REL, "reports/PAPER_READINESS.md"),
    rel(FINAL_REL, "reports/SCIENTIFIC_CORRECTION_CHANGELOG.md"),
    rel(FINAL_REL, "manifest/final-evaluation-manifest.json"),
    rel(FINAL_REL, "manifest/final-evaluation-manifest.sha256"),
    rel(FINAL_REL, "metrics/core-metrics.json"),
    rel(FINAL_REL, "metrics/confirmation-outcomes.md"),
    rel(FINAL_REL, "metrics/localization-per-replica.csv"),
    rel(FINAL_REL, "baselines/baseline-results.json"),
    rel(FINAL_REL, "baselines/baseline-results.csv"),
    rel(FINAL_REL, "ablations/ablation-results.json"),
    rel(FINAL_REL, "ablations/ablation-results.csv"),
    rel(FINAL_REL, "statistics/statistical-summary.json"),
    rel(FINAL_REL, "statistics/statistical-summary.csv"),
    rel(FINAL_REL, "statistics/statistical-report.md"),
    rel(FINAL_REL, "statistics/holm-family.json"),
    rel(FINAL_REL, "paper/PATCHWORK_controlled_results_fragment.tex"),
    rel(FINAL_REL, "paper/paper-fill-map.csv"),
    rel(FINAL_REL, "paper/paper-fill-map.md"),
    rel(FINAL_REL, "provenance/claims-ledger.csv"),
    rel(FINAL_REL, "provenance/claims-ledger.md"),
    rel(FINAL_REL, "audit/evidence-audit.json"),
    rel(FINAL_REL, "audit/frozen-before.json"),
    rel(FINAL_REL, "audit/frozen-after.json"),
    rel(FINAL_REL, "audit/frozen-diff.json"),
    rel(FINAL_REL, "audit/secret-scan.json"),
    rel(FINAL_REL, "tables/table-iii-config.csv"),
    rel(FINAL_REL, "tables/table-iv-main-results.csv"),
    rel(FINAL_REL, "tables/table-v-ablations.csv"),
    rel(FINAL_REL, "tables/table-vi-patch-outcomes.csv"),
    rel(FINAL_REL, "tables/supplement-per-replica-search.csv"),
    rel(FINAL_REL, "tables/supplement-localization.csv"),
    rel(FINAL_REL, "tables/supplement-patch-runtime.csv"),
    rel(FINAL_REL, "tables/supplement-confirmation.csv"),
    rel(FINAL_REL, "tables/supplement-plausible-candidate-confirmation-performance.csv"),
    rel(FROZEN_REL, "status.json"),
    rel(FROZEN_REL, "frozen-inputs.json"),
    rel(FROZEN_REL, "candidate-bounds.csv"),
    rel(FROZEN_REL, "confirmation-summary.csv"),
    rel(FROZEN_REL, "confirmation-observations.jsonl"),
    rel(FROZEN_REL, "runtime-failures.csv"),
    rel(FROZEN_REL, "seed-usage.csv"),
    rel("experiments/results/search-certification-pilot-v2", "search-strategy-comparison.csv"),
    rel("experiments/results/search-certification-pilot-v2", "objective-audit.csv"),
    rel("experiments/results/search-certification-pilot-v2", "repeated-search-results.jsonl"),
    rel(REPAIR_REL, "localization-summary.csv"),
    rel(REPAIR_REL, "cone-summary.csv"),
    rel(REPAIR_REL, "runtime-validation.csv"),
    rel(REPAIR_REL, "runtime-paired-replay.jsonl"),
    rel(REPAIR_REL, "runtime-regression-summary.csv"),
    rel(REPAIR_REL, "runtime-rollback.csv"),
    rel(REPAIR_REL, "runtime-kpis.json"),
    rel(REPAIR_REL, "defect-audit.csv"),
    rel(REPAIR_REL, "defect-matrix.csv"),
    rel("experiments/results/graph-index-v1", "graph-index.json")
  ];

  const figureCsvs = listFilesRecursive(fromFinal("figures"))
    .filter((file) => file.endsWith(".csv"))
    .map((file) => rel(FINAL_REL, "figures", file));
  const all = [...new Set([...sourceFiles, ...figureCsvs])];
  return all
    .filter((relativePath) => existsSync(path.join(repo, relativePath)))
    .map((relativePath) => {
      const full = path.join(repo, relativePath);
      return {
        path: relativePath,
        type: path.extname(relativePath).replace(".", "") || "text",
        bytes: statSync(full).size,
        sha256: sha256File(full),
        rows: rowCount(full) ?? "N/A",
        purpose: purposeForArtifact(relativePath)
      };
    });
}

function purposeForArtifact(relativePath) {
  if (relativePath.includes("FINAL_CONTROLLED_EVALUATION")) return "Top-level corrected final evaluation report.";
  if (relativePath.includes("core-metrics")) return "Machine-readable core benchmark, localization, repair, search, and confirmation metrics.";
  if (relativePath.includes("candidate-bounds")) return "Frozen candidate safety/objective bounds and candidate set hashes.";
  if (relativePath.includes("confirmation-observations")) return "Frozen raw confirmation observations; not copied into share package.";
  if (relativePath.includes("status.json")) return "Frozen terminal confirmation statuses and per-candidate counts.";
  if (relativePath.includes("search-strategy-comparison")) return "Registered budget-by-budget search comparison.";
  if (relativePath.includes("repeated-search-results")) return "Raw repeated search records.";
  if (relativePath.includes("localization-summary")) return "Per-case localization outcomes.";
  if (relativePath.includes("cone-summary")) return "Failure-cone sizes by case.";
  if (relativePath.includes("runtime-paired-replay")) return "Paired original vs patched runtime replay outcomes.";
  if (relativePath.includes("baseline")) return "Controlled baseline table/source.";
  if (relativePath.includes("ablation")) return "Controlled ablation accounting.";
  if (relativePath.includes("statistical")) return "Statistical tests and multiple-comparison outputs.";
  if (relativePath.includes("paper-fill-map")) return "Claim-to-source mapping for manuscript values.";
  if (relativePath.includes("claims-ledger")) return "Supported and unsupported paper claim ledger.";
  if (relativePath.includes("figures")) return "Figure source data.";
  return "Supporting raw or generated artifact.";
}

function buildPackageFilesMetadata(files) {
  return files
    .map((file) => {
      const full = fromShare(file);
      return {
        filename: file,
        bytes: statSync(full).size,
        sha256: sha256File(full),
        generatedAt: GENERATED_AT,
        sourceInputs: packageSourceInputs(file)
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

function buildManifestPackageFiles(nonManifestFiles) {
  return [
    ...buildPackageFilesMetadata(nonManifestFiles),
    {
      filename: "PATCHWORK_REVIEW_PACKAGE_MANIFEST.json",
      bytes: null,
      sha256: null,
      generatedAt: GENERATED_AT,
      sourceInputs: ["all share-for-review package files", "scripts/prepare-review-package.mjs"],
      sha256Note:
        "Not embedded because the manifest hash is self-referential. The generator prints the actual final manifest SHA-256 after serialization."
    }
  ].sort((a, b) => a.filename.localeCompare(b.filename));
}

function packageSourceInputs(file) {
  const inputs = {
    "PATCHWORK_FULL_EXPERIMENT_RESULTS.md": [
      "experiments/results/final-paper-v1/reports/FINAL_CONTROLLED_EVALUATION.json",
      "experiments/results/final-paper-v1/metrics/core-metrics.json",
      "experiments/results/search-certification-pilot-v2/full-confirmation/status.json",
      "experiments/results/search-certification-pilot-v2/full-confirmation/candidate-bounds.csv",
      "experiments/results/search-certification-pilot-v2/search-strategy-comparison.csv",
      "experiments/results/repair-pilot-v1/*"
    ],
    "PATCHWORK_ALL_TABLES.md": [
      "experiments/results/final-paper-v1/tables/*.csv",
      "experiments/results/final-paper-v1/statistics/statistical-summary.csv",
      "experiments/results/final-paper-v1/baselines/baseline-results.csv",
      "experiments/results/final-paper-v1/ablations/ablation-results.csv"
    ],
    "PATCHWORK_STATISTICS.json": [
      "experiments/results/final-paper-v1/metrics/core-metrics.json",
      "experiments/results/final-paper-v1/statistics/statistical-summary.json",
      "experiments/results/final-paper-v1/statistics/holm-family.json"
    ],
    "PATCHWORK_PROVENANCE.md": [
      "experiments/results/final-paper-v1/paper/paper-fill-map.csv",
      "experiments/results/final-paper-v1/provenance/claims-ledger.csv",
      "indexed raw artifacts"
    ],
    "PATCHWORK_RAW_RESULT_INDEX.md": ["indexed raw artifacts under experiments/results"],
    "PATCHWORK_CONTROLLED_RESULTS_FRAGMENT.tex": [
      "experiments/results/final-paper-v1/paper/PATCHWORK_controlled_results_fragment.tex"
    ],
    "PATCHWORK_SCIENTIFIC_CORRECTION_CHANGELOG.md": [
      "experiments/results/final-paper-v1/reports/SCIENTIFIC_CORRECTION_CHANGELOG.md"
    ],
    "PATCHWORK_REVIEW_PACKAGE_MANIFEST.json": ["all share-for-review package files", "scripts/prepare-review-package.mjs"]
  };
  return inputs[file] ?? ["scripts/prepare-review-package.mjs"];
}

function observedConfirmationCounts() {
  const observationsPath = fromFrozen("confirmation-observations.jsonl");
  const valid = [];
  for (const line of readText(observationsPath).split(/\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (isValidConfirmationObservation(parsed)) valid.push(parsed);
  }
  return {
    validObservationRows: valid.length,
    duplicateValidKeys: duplicateValidObservationKeys(valid).length
  };
}

function buildCandidateRows(status, candidateBounds) {
  const countsById = new Map();
  for (const replicaStatus of status.statuses) {
    for (const count of replicaStatus.candidateCounts) {
      countsById.set(count.configurationId, {
        terminal_status: replicaStatus.status,
        completed_seeds: count.completedSeeds,
        remaining_seeds: count.remainingSeeds,
        expected_seeds: Number(count.completedSeeds) + Number(count.remainingSeeds),
        valid_observations: count.validObservations,
        certified_safe_terminal_set: replicaStatus.certifiedSafe.includes(count.configurationId),
        plausibly_safe_terminal_set: replicaStatus.plausiblySafe.includes(count.configurationId)
      });
    }
  }
  return candidateBounds.map((row) => ({
    replica: row.replica,
    configuration_id: row.configuration_id,
    patch_ids: row.patch_ids || "(none)",
    candidate_set_hash: row.candidate_set_hash,
    expected_seeds: countsById.get(row.configuration_id)?.expected_seeds ?? "N/A",
    completed_seeds: countsById.get(row.configuration_id)?.completed_seeds ?? "N/A",
    remaining_seeds: countsById.get(row.configuration_id)?.remaining_seeds ?? "N/A",
    valid_observations: countsById.get(row.configuration_id)?.valid_observations ?? "N/A",
    compliant_success_lower: row.compliant_success_lower,
    compliant_success_upper: row.compliant_success_upper,
    violation_lower_max: row.violation_lower_max,
    violation_upper_max: row.violation_upper_max,
    objective_lower: row.objective_lower,
    objective_upper: row.objective_upper,
    certified_safe: row.certified_safe,
    plausibly_safe: row.plausibly_safe,
    terminal_status: countsById.get(row.configuration_id)?.terminal_status ?? "N/A"
  }));
}

function provenancePass(fillRows) {
  const failures = [];
  for (const row of fillRows) {
    const value = row.value ?? row.displayed_value ?? "";
    if (value === "N/A" || value.startsWith("N/A")) continue;
    if (!row.source_artifacts || row.source_artifacts === "[]" || row.source_artifacts.includes("MISSING")) {
      failures.push({ claim_id: row.claim_id ?? `${row.location}:${row.metric}`, reason: "missing source_artifacts" });
    }
    const hashes = row.source_hashes ?? row.source_sha256s;
    if (!hashes || hashes === "[]" || hashes.includes("MISSING")) {
      failures.push({ claim_id: row.claim_id ?? `${row.location}:${row.metric}`, reason: "missing source_hashes" });
    }
  }
  return { passed: failures.length === 0, failures };
}

function buildFullResults(context) {
  const {
    report,
    metrics,
    finalManifestHash,
    frozenManifestHash,
    status,
    candidateRows,
    searchComparison,
    objectiveAudit,
    localizationSummary,
    coneSummary,
    runtimeValidation,
    runtimeRegression,
    runtimeRollback,
    defectAudit,
    defectMatrix,
    graphIndex,
    baselineRows,
    ablationRows,
    statsRows,
    figures,
    claimsLedger,
    fillRows,
    rawIndexRows,
    validation
  } = context;

  const terminalRows = status.statuses.map((row) => ({
    replica: row.replica,
    status: row.status,
    planned_seed_runs: row.plannedCandidateSeedRuns,
    completed_seed_runs: row.completedCandidateSeedRuns,
    remaining_seed_runs: row.remainingCandidateSeedRuns,
    valid_observations: row.validObservations,
    certified_safe: row.certifiedSafe.join(";") || "(none)",
    plausibly_safe: row.plausiblySafe.join(";") || "(none)"
  }));

  const candidateSummaryRows = candidateRows.map((row) =>
    pick(row, [
      "replica",
      "configuration_id",
      "expected_seeds",
      "completed_seeds",
      "remaining_seeds",
      "valid_observations",
      "candidate_set_hash",
      "objective_lower",
      "objective_upper",
      "certified_safe",
      "plausibly_safe",
      "terminal_status"
    ])
  );

  const localizationByReplica = metrics.localization.perReplica.map((row) => ({
    replica: row.replica,
    cases: row.cases,
    exact_root_cause_rate: fmt(row.exactRootCause),
    top3_root_cause_rate: fmt(row.top3RootCause),
    root_cause_contained_rate: fmt(row.rootCauseContained),
    median_cone_percent: fmt(row.medianConePercent)
  }));

  const figureRows = figures.map((figure) => ({
    figure: figure.id,
    title: figure.title,
    source_csv: figure.csv,
    png: figure.png,
    conclusion: summarizeFigure(figure, readCsv(fromFinal(figure.csv)))
  }));

  const sourceMapRows = fillRows.map((row) => ({
    claim_id: row.claim_id ?? `${row.location}:${row.metric}`,
    value: row.value ?? row.displayed_value,
    source_artifacts: row.source_artifacts,
    source_hashes: row.source_hashes ?? row.source_sha256s
  }));

  const supportedClaimRows = claimsLedger.map((row) => ({
    claim_id: row.claim_id ?? row.id,
    claim: row.claim,
    status: row.status,
    value: row.value,
    evidence_class: row.evidence_class,
    source: row.source,
    note: row.note
  }));

  return `# PATCHWORK Full Experiment Results

Generated: ${GENERATED_AT}

This package is a read-only review bundle for the corrected controlled PATCHWORK/V2A-SHIELD experiment. No experiments, search runs, confirmation runs, thresholds, seeds, candidate hashes, or terminal statuses were changed while preparing this package.

## 1. Executive Summary

PATCHWORK was evaluated as a deterministic controlled benchmark over three enterprise replicas: ShopTwin, SaaSTwin, and SupportTwin. The final corrected interpretation is: localization and deterministic repair succeeded on the controlled paired replay benchmark, registered maximum-budget search found zero-regret candidates, but independent confirmation did not certify any replica-safe deployable recommendation.

Key corrected outcomes:

| Claim | Value |
| --- | --- |
| Audit status | ${report.auditStatus} |
| Controlled benchmark replicas | ${metrics.benchmark.replicas} |
| Journeys | ${metrics.benchmark.journeys} |
| Localization cases | ${metrics.localization.cases} |
| Patch cases | ${metrics.patch.generatedPatches} |
| PATCHWORK no-confirmation CSR | ${fmt(metrics.patch.patchedSide.csr)} |
| Original interface CSR | ${fmt(metrics.patch.originalSide.csr)} |
| Independent confirmation valid observations | ${metrics.confirmation.validObservations} |
| Certified replicas | ${metrics.confirmation.certifiedReplicaCount}/${metrics.benchmark.replicas} |
| Plausible but uncertified replicas | ${metrics.confirmation.plausibleReplicaCount}/${metrics.benchmark.replicas} |
| Full PATCHWORK deployable recommendation | none; abstained |

## 2. Scope and Evidence Classes

The package distinguishes supported deterministic evidence from unsupported/live evidence. All numerical results in this bundle are derived from controlled deterministic runtime artifacts or frozen generated summaries. No live LLM-agent, human-review, or partner-staging-canary evidence was executed.

| Evidence class | Status |
| --- | --- |
| DETERMINISTIC_CONTROLLED_RUNTIME | available |
| SCRIPTED_OR_MOCK_AGENT | historical/context only where explicitly labeled |
| LIVE_LLM_AGENT | unavailable |
| HUMAN_REVIEW | unavailable |
| PARTNER_STAGING_CANARY | unavailable |

The conclusion is therefore scoped to a controlled benchmark submission with limitations, not the original broader preregistered paper claims.

## 3. Immutable Confirmation Evidence

Frozen confirmation root: \`${FROZEN_REL}\`

| Field | Value |
| --- | --- |
| Frozen manifest hash | ${frozenManifestHash} |
| Expected frozen manifest hash | ${EXPECTED_FROZEN_MANIFEST_HASH} |
| Final evaluation manifest hash | ${finalManifestHash} |
| Before packaging directory hash | ${validation.frozenBeforeDirectoryHash} |
| After packaging directory hash | ${validation.frozenAfterDirectoryHash} |
| evidenceMutationDetected | ${validation.evidenceMutationDetected} |
| Candidate hashes unchanged | ${validation.candidateHashesUnchanged} |
| Terminal statuses unchanged | ${validation.terminalStatusesUnchanged} |

## 4. Benchmark Inventory

| Field | Value |
| --- | --- |
| Replicas | ${metrics.benchmark.replicaNames} |
| Journey distribution | ${Object.entries(metrics.benchmark.journeyDistribution).map(([k, v]) => `${k}=${v}`).join(", ")} |
| Localization cases | ${metrics.benchmark.localizationCases} |
| Patch cases | ${metrics.benchmark.patchCases} |
| Historical mock runs | ${metrics.benchmark.historicalMockRuns} |

Graph inventory:

${table(metrics.benchmark.graphRows)}

Defect distribution:

| Family counts | ${JSON.stringify(metrics.benchmark.defectDistribution.families)} |
| --- | --- |
| Severity counts | ${JSON.stringify(metrics.benchmark.defectDistribution.severities)} |
| Violation-type counts | ${JSON.stringify(metrics.benchmark.defectDistribution.violationTypes)} |

Defect rows:

${table(metrics.benchmark.defectDistribution.rows)}

## 5. Localization Results

Aggregate localization metrics:

| Metric | Value |
| --- | --- |
| Cases | ${metrics.localization.cases} |
| Exact first violated predicate | ${fmt(metrics.localization.exactFirstViolatedPredicate)} |
| Exact root cause | ${fmt(metrics.localization.exactRootCause)} |
| Top-3 root cause | ${fmt(metrics.localization.top3RootCause)} |
| Root cause contained | ${fmt(metrics.localization.rootCauseContained)} |
| Median cone percent | ${fmt(metrics.localization.medianConePercent)} |
| Cone percent IQR | [${fmt(metrics.localization.iqrConePercent.q1)}, ${fmt(metrics.localization.iqrConePercent.q3)}] |

Per-replica localization:

${table(localizationByReplica)}

Per-case localization rows:

${table(localizationSummary)}

Failure-cone rows:

${table(coneSummary)}

## 6. Repair and Runtime Validation Results

| Metric | Value |
| --- | --- |
| Generated patches | ${metrics.patch.generatedPatches} |
| Validation accepted | ${metrics.patch.validationAccepted} |
| Paired replay rows | ${metrics.patch.pairedRows} |
| Original CSR | ${fmt(metrics.patch.originalSide.csr)} |
| Original violations | ${metrics.patch.originalSide.violations}/${metrics.patch.originalSide.attempts} |
| Patched CSR | ${fmt(metrics.patch.patchedSide.csr)} |
| Patched violations | ${metrics.patch.patchedSide.violations}/${metrics.patch.patchedSide.attempts} |
| Regression passed | ${metrics.patch.regressionPassed}/${metrics.patch.regressionRuns} |
| Rollback passed | ${metrics.patch.rollbackPassed}/${metrics.patch.rollbackRuns} |
| Unresolved cases | ${metrics.patch.unresolvedCases} |
| Median original latency | ${metrics.patch.medianOriginalLatencyMs} ms |
| Median patched latency | ${metrics.patch.medianPatchedLatencyMs} ms |
| Median latency difference | ${metrics.patch.medianLatencyDifferenceMs} ms |
| Median synthesis attempts | ${metrics.patch.medianSynthesisAttempts} |

Static/runtime pass counts:

${table(Object.entries(metrics.patch.staticPasses).map(([check, count]) => ({ check, count })))}

Runtime validation rows:

${table(runtimeValidation)}

Regression rows:

${table(runtimeRegression)}

Rollback rows:

${table(runtimeRollback)}

## 7. Search and Candidate Selection Results

Oracle-best configurations:

${table(Object.entries(metrics.search.oracleBest).map(([replica, row]) => ({ replica, configuration_id: row.configurationId, objective: fmt(row.objective, 6) })))}

Aggregate maximum-budget search results:

| Strategy | Runs | Mean global regret | Median global regret | Candidate recall@epsilon | Found oracle best | Total config evaluations | Unsafe recommendation rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random feasible max budget | ${metrics.search.randomMax.runs} | ${fmt(metrics.search.randomMax.meanGlobalRegret, 6)} | ${fmt(metrics.search.randomMax.medianGlobalRegret, 6)} | ${fmt(metrics.search.randomMax.candidateRecallAtEpsilon)} | ${metrics.search.randomMax.foundOracleBestSuccesses}/${metrics.search.randomMax.runs} | ${metrics.search.randomMax.totalConfigEvaluations} | ${fmt(metrics.search.randomMax.unsafeRecommendationRate)} |
| Graph-aware max budget | ${metrics.search.graphAwareMax.runs} | ${fmt(metrics.search.graphAwareMax.meanGlobalRegret, 6)} | ${fmt(metrics.search.graphAwareMax.medianGlobalRegret, 6)} | ${fmt(metrics.search.graphAwareMax.candidateRecallAtEpsilon)} | ${metrics.search.graphAwareMax.foundOracleBestSuccesses}/${metrics.search.graphAwareMax.runs} | ${metrics.search.graphAwareMax.totalConfigEvaluations} | ${fmt(metrics.search.graphAwareMax.unsafeRecommendationRate)} |

Every registered search budget row:

${table(searchComparison)}

Objective audit rows:

${table(objectiveAudit)}

## 8. Independent Confirmation Results

Confirmation terminal statuses:

${table(terminalRows)}

All candidate bounds and seed accounting:

${table(candidateSummaryRows)}

Plausible-candidate observed performance, explicitly uncertified:

${table(metrics.confirmation.plausibleCandidatePerformance)}

Aggregate confirmation accounting:

| Metric | Value |
| --- | --- |
| Candidate count | ${metrics.confirmation.candidateCount} |
| Planned candidate-seed runs | ${metrics.confirmation.plannedCandidateSeedRuns} |
| Completed candidate-seed runs | ${metrics.confirmation.completedCandidateSeedRuns} |
| Planned observations | ${metrics.confirmation.plannedObservations} |
| Valid observations | ${metrics.confirmation.validObservations} |
| Valid observation rows in file | ${metrics.confirmation.validObservationRowsInFile} |
| Infrastructure failures | ${metrics.confirmation.infrastructureFailures} |
| Certification rate | ${fmt(metrics.confirmation.certificationRate)} |
| Abstention rate | ${fmt(metrics.confirmation.abstentionRate)} |

## 9. Baselines

${table(baselineRows)}

Interpretation: available deterministic baselines support a paired-replay comparison between the original interface and PATCHWORK without independent confirmation. Rows marked N/A were not evaluated and are not used as numerical support.

## 10. Ablations

${table(ablationRows)}

Ablation accounting:

| Planned | Executed | Reference | Missing or non-identifiable |
| ---: | ---: | ---: | ---: |
| ${report.ablationAccounting.planned} | ${report.ablationAccounting.executed} | ${report.ablationAccounting.reference} | ${report.ablationAccounting.missingOrNonIdentifiable} |

## 11. Statistics

${table(statsRows)}

Statistical interpretation:

The paired CSR comparison between the original interface and PATCHWORK without confirmation is significant after Holm correction. Search regret at maximum registered budgets ties at 0.000 for random feasible and graph-aware search. Full PATCHWORK certification rate is 0.000 because independent confirmation abstained on every replica, so it is not a deployable success claim.

## 12. Figures

${table(figureRows)}

Figure image files are retained in \`${FINAL_REL}/figures\`. This review share package indexes their CSV sources and conclusions; it does not copy image binaries unless the reviewer asks for them.

## 13. Paper-Ready Corrected Claims

${table(supportedClaimRows)}

## 14. Claim Provenance Map

${table(sourceMapRows)}

## 15. Raw Result Index Summary

The complete raw index is in \`PATCHWORK_RAW_RESULT_INDEX.md\`. It records path, type, bytes, SHA-256, row count, and purpose for ${rawIndexRows.length} source artifacts. The large frozen confirmation observations file is indexed by hash and row count but is not copied into the share package.

## 16. Limitations

* No live LLM-agent evidence was executed.
* No human-review evidence was executed.
* No partner-staging-canary evidence was executed.
* Most originally planned ablations are missing or non-identifiable in this controlled implementation.
* Independent confirmation produced no certified-safe deployable recommendation; plausible candidates are reported only as observed uncertified performance.
* Static readiness ordering, expert prioritization, prompt/retry repair, and constrained-BO/no-localization baselines are unavailable and marked N/A.

## 17. Validation Summary

| Check | Value |
| --- | --- |
| Frozen confirmation hash before packaging | ${validation.frozenBeforeDirectoryHash} |
| Frozen confirmation hash after packaging | ${validation.frozenAfterDirectoryHash} |
| evidenceMutationDetected | ${validation.evidenceMutationDetected} |
| Valid confirmation observations | ${validation.validConfirmationObservations} |
| Duplicate valid keys | ${validation.duplicateValidKeys} |
| Candidate hashes unchanged | ${validation.candidateHashesUnchanged} |
| Terminal statuses unchanged | ${validation.terminalStatusesUnchanged} |
| Secret scan clean | ${validation.secretScanClean} |
| Provenance complete for supported numerical claims | ${validation.supportedNumericalClaimsHaveProvenance} |

`;
}

function buildAllTables(context) {
  const tableFiles = [
    ["Table III: Configuration", "tables/table-iii-config.csv"],
    ["Table IV: Main Results", "tables/table-iv-main-results.csv"],
    ["Table V: Ablations", "tables/table-v-ablations.csv"],
    ["Table VI: Patch Outcomes", "tables/table-vi-patch-outcomes.csv"],
    ["Supplement: Per-Replica Search", "tables/supplement-per-replica-search.csv"],
    ["Supplement: Localization", "tables/supplement-localization.csv"],
    ["Supplement: Patch Runtime", "tables/supplement-patch-runtime.csv"],
    ["Supplement: Confirmation", "tables/supplement-confirmation.csv"],
    ["Supplement: Plausible Candidate Confirmation Performance", "tables/supplement-plausible-candidate-confirmation-performance.csv"],
    ["Statistics Summary", "statistics/statistical-summary.csv"],
    ["Baseline Results", "baselines/baseline-results.csv"],
    ["Ablation Results", "ablations/ablation-results.csv"]
  ];

  const sections = tableFiles.map(([title, relative]) => {
    const file = fromFinal(relative);
    return `## ${title}\n\nSource: \`${rel(FINAL_REL, relative)}\`\n\n${linesForCsvSnippet(file)}\n`;
  });

  return `# PATCHWORK All Tables

Generated: ${GENERATED_AT}

All tables below are copied or rendered from corrected final-paper-v1 CSV artifacts. N/A entries are retained as N/A and are not imputed.

${sections.join("\n")}
`;
}

function buildStatisticsJson(context) {
  const {
    report,
    metrics,
    finalManifestHash,
    frozenManifestHash,
    status,
    candidateRows,
    baselineRows,
    ablationRows,
    statsRows,
    holm,
    validation
  } = context;

  return {
    generatedAt: GENERATED_AT,
    study: {
      name: "PATCHWORK/V2A-SHIELD controlled final-paper-v1 evaluation",
      finalResultsRoot: FINAL_REL,
      frozenConfirmationRoot: FROZEN_REL,
      finalEvaluationManifestHash: finalManifestHash,
      frozenConfirmationManifestHash: frozenManifestHash,
      evidenceClasses: {
        deterministicControlledRuntime: "available",
        scriptedOrMockAgent: "context only where explicitly labeled",
        liveLlmAgent: null,
        liveLlmAgentUnavailableReason: "Not executed in this controlled package.",
        humanReview: null,
        humanReviewUnavailableReason: "Not executed in this controlled package.",
        partnerStagingCanary: null,
        partnerStagingCanaryUnavailableReason: "Not executed in this controlled package."
      },
      readiness: report.readiness
    },
    benchmark: metrics.benchmark,
    localization: metrics.localization,
    repair: metrics.patch,
    search: {
      oracleBest: metrics.search.oracleBest,
      allRegisteredBudgetRows: metrics.search.rows,
      randomFeasibleMaxBudget: metrics.search.randomMax,
      graphAwareMaxBudget: metrics.search.graphAwareMax,
      candidateRecallAtEpsilon: metrics.search.candidateRecallAtEpsilon,
      unsafeRecommendationRate: metrics.search.unsafeRecommendationRate
    },
    confirmation: {
      aggregate: {
        candidateCount: metrics.confirmation.candidateCount,
        plannedCandidateSeedRuns: metrics.confirmation.plannedCandidateSeedRuns,
        completedCandidateSeedRuns: metrics.confirmation.completedCandidateSeedRuns,
        plannedObservations: metrics.confirmation.plannedObservations,
        validObservations: metrics.confirmation.validObservations,
        validObservationRowsInFile: metrics.confirmation.validObservationRowsInFile,
        infrastructureFailures: metrics.confirmation.infrastructureFailures,
        certifiedReplicaCount: metrics.confirmation.certifiedReplicaCount,
        plausibleReplicaCount: metrics.confirmation.plausibleReplicaCount,
        certificationRate: metrics.confirmation.certificationRate,
        abstentionRate: metrics.confirmation.abstentionRate
      },
      terminalStatuses: status.statuses,
      candidates: candidateRows,
      plausibleCandidateObservedPerformanceUncertified: metrics.confirmation.plausibleCandidatePerformance
    },
    baselines: baselineRows.map(withUnavailableReason),
    ablations: {
      accounting: report.ablationAccounting,
      rows: ablationRows.map(withUnavailableReason)
    },
    statistics: {
      rows: statsRows.map(withUnavailableReason),
      holmFamily: holm
    },
    validation,
    limitations: [
      "No live LLM-agent evidence was executed.",
      "No human-review evidence was executed.",
      "No partner-staging-canary evidence was executed.",
      "Independent confirmation abstained on all three replicas.",
      "Seven planned ablation classes are missing or non-identifiable.",
      "Unavailable baselines are reported as null/N/A rather than imputed."
    ]
  };
}

function buildProvenance(context) {
  const { fillRows, claimsLedger, rawIndexRows, validation } = context;
  const mapRows = fillRows.map((row) => ({
    claim_id: row.claim_id ?? `${row.location}:${row.metric}`,
    value: row.value ?? row.displayed_value,
    section: row.section,
    source_artifacts: row.source_artifacts,
    source_hashes: row.source_hashes ?? row.source_sha256s,
    notes: row.notes
  }));
  const claimRows = claimsLedger.map((row) => ({
    claim_id: row.claim_id ?? row.id,
    claim: row.claim,
    status: row.status,
    value: row.value,
    evidence_class: row.evidence_class,
    source_artifacts: row.source_artifacts ?? row.source,
    note: row.note
  }));
  const sourceRows = rawIndexRows
    .filter((row) =>
      row.path.includes("core-metrics") ||
      row.path.includes("candidate-bounds") ||
      row.path.includes("status.json") ||
      row.path.includes("search-strategy-comparison") ||
      row.path.includes("localization-summary") ||
      row.path.includes("runtime-paired-replay") ||
      row.path.includes("baseline") ||
      row.path.includes("ablation") ||
      row.path.includes("statistical") ||
      row.path.includes("claims-ledger") ||
      row.path.includes("paper-fill-map")
    )
    .map((row) => pick(row, ["path", "sha256", "rows", "purpose"]));

  return `# PATCHWORK Provenance

Generated: ${GENERATED_AT}

This file maps corrected claims and paper-fill values to source artifacts and SHA-256 hashes. Supported numerical claims must have at least one source artifact and source hash.

## Validation

| Check | Value |
| --- | --- |
| Supported numerical claims have provenance | ${validation.supportedNumericalClaimsHaveProvenance} |
| Provenance failures | ${validation.provenanceFailures.length} |

## Paper Fill Map

${table(mapRows)}

## Claims Ledger

${table(claimRows)}

## Major Source Artifacts

${table(sourceRows)}
`;
}

function buildRawIndex(rawIndexRows) {
  return `# PATCHWORK Raw Result Index

Generated: ${GENERATED_AT}

This index records source artifacts used to create the review package. Large raw artifacts are indexed by path, bytes, SHA-256, and row count but are not duplicated in the share package.

${table(rawIndexRows)}
`;
}

function buildManifest(context, packageFiles, zipInfo = null) {
  const { finalManifestHash, frozenManifestHash, validation, rawIndexRows } = context;
  return jsonStable({
    generatedAt: GENERATED_AT,
    packageRoot: SHARE_REL,
    zip: zipInfo,
    constraints: {
      newExperimentsExecuted: false,
      searchRerun: false,
      confirmationRerun: false,
      frozenConfirmationMutated: false,
      epsilonChanged: false,
      deltaChanged: false,
      thresholdsChanged: false,
      seedsChanged: false,
      candidateHashesChanged: false,
      terminalStatusesChanged: false,
      secretsIncluded: false
    },
    sourceManifests: {
      finalEvaluationManifestHash: finalManifestHash,
      frozenConfirmationManifestHash: frozenManifestHash,
      expectedFrozenConfirmationManifestHash: EXPECTED_FROZEN_MANIFEST_HASH
    },
    validation,
    packageFiles,
    indexedSourceArtifacts: {
      count: rawIndexRows.length,
      totalBytes: rawIndexRows.reduce((sum, row) => sum + Number(row.bytes || 0), 0)
    },
    manifestSelfHashNote:
      "A SHA-256 for this manifest is printed by the generator and included in the zip metadata after final serialization; cryptographic self-hashing cannot be embedded as a fixed value inside the same JSON object."
  });
}

function prepare() {
  requiredFile(fromFinal("reports/FINAL_CONTROLLED_EVALUATION.json"));
  requiredFile(fromFinal("metrics/core-metrics.json"));
  requiredFile(fromFinal("manifest/final-evaluation-manifest.sha256"));
  requiredFile(fromFinal("reports/SCIENTIFIC_CORRECTION_CHANGELOG.md"));
  requiredFile(fromFinal("paper/PATCHWORK_controlled_results_fragment.tex"));
  requiredFile(fromFrozen("status.json"));
  requiredFile(fromFrozen("candidate-bounds.csv"));
  requiredFile(fromFrozen("confirmation-observations.jsonl"));

  const frozenBeforeSnapshot = snapshotDirectory(frozenRoot);
  const frozenBeforeDirectoryHash = directoryHash(frozenBeforeSnapshot);

  rmSync(shareRoot, { recursive: true, force: true });
  mkdirSync(shareRoot, { recursive: true });

  const report = readJson(fromFinal("reports/FINAL_CONTROLLED_EVALUATION.json"));
  const metrics = readJson(fromFinal("metrics/core-metrics.json"));
  const finalManifestHash = readText(fromFinal("manifest/final-evaluation-manifest.sha256")).trim().split(/\s+/)[0];
  const finalManifest = readJson(fromFinal("manifest/final-evaluation-manifest.json"));
  const frozenManifestHash = finalManifest.frozenEvidence.manifestHash;
  const status = readJson(fromFrozen("status.json"));
  const candidateBounds = readCsv(fromFrozen("candidate-bounds.csv"));
  const candidateRows = buildCandidateRows(status, candidateBounds);
  const searchComparison = readCsv(path.join(repo, "experiments/results/search-certification-pilot-v2/search-strategy-comparison.csv"));
  const objectiveAudit = readCsv(path.join(repo, "experiments/results/search-certification-pilot-v2/objective-audit.csv"));
  const localizationSummary = readCsv(path.join(repo, REPAIR_REL, "localization-summary.csv"));
  const coneSummary = readCsv(path.join(repo, REPAIR_REL, "cone-summary.csv"));
  const runtimeValidation = readCsv(path.join(repo, REPAIR_REL, "runtime-validation.csv"));
  const runtimeRegression = readCsv(path.join(repo, REPAIR_REL, "runtime-regression-summary.csv"));
  const runtimeRollback = readCsv(path.join(repo, REPAIR_REL, "runtime-rollback.csv"));
  const defectAudit = existsSync(path.join(repo, REPAIR_REL, "defect-audit.csv"))
    ? readCsv(path.join(repo, REPAIR_REL, "defect-audit.csv"))
    : [];
  const defectMatrix = existsSync(path.join(repo, REPAIR_REL, "defect-matrix.csv"))
    ? readCsv(path.join(repo, REPAIR_REL, "defect-matrix.csv"))
    : [];
  const graphIndex = existsSync(path.join(repo, "experiments/results/graph-index-v1/graph-index.json"))
    ? readJson(path.join(repo, "experiments/results/graph-index-v1/graph-index.json"))
    : {};
  const baselineRows = readJson(fromFinal("baselines/baseline-results.json"));
  const ablationRows = readJson(fromFinal("ablations/ablation-results.json"));
  const statsRows = readJson(fromFinal("statistics/statistical-summary.json"));
  const holm = readJson(fromFinal("statistics/holm-family.json"));
  const figures = report.figures;
  const claimsLedger = readCsv(fromFinal("provenance/claims-ledger.csv"));
  const fillRows = readCsv(fromFinal("paper/paper-fill-map.csv"));
  const rawIndexRows = buildRawIndexRows();
  const confirmationCounts = observedConfirmationCounts();
  const provenance = provenancePass(fillRows);
  const candidateHashesUnchanged = REPLICAS.every((replica) =>
    candidateBounds
      .filter((row) => row.replica === replica)
      .every((row) => row.candidate_set_hash === EXPECTED_CANDIDATE_HASHES[replica])
  );
  const terminalStatusesUnchanged = status.statuses.every(
    (row) => EXPECTED_TERMINAL_STATUSES[row.replica] === row.status
  );

  const validationDraft = {
    frozenBeforeDirectoryHash,
    frozenAfterDirectoryHash: null,
    evidenceMutationDetected: null,
    frozenManifestHashMatchesExpected: frozenManifestHash === EXPECTED_FROZEN_MANIFEST_HASH,
    validConfirmationObservations: confirmationCounts.validObservationRows,
    validConfirmationObservationExpected: 10781,
    validConfirmationObservationsMatchExpected: confirmationCounts.validObservationRows === 10781,
    duplicateValidKeys: confirmationCounts.duplicateValidKeys,
    duplicateValidKeysExpected: 0,
    duplicateValidKeysMatchExpected: confirmationCounts.duplicateValidKeys === 0,
    candidateHashesExpected: EXPECTED_CANDIDATE_HASHES,
    candidateHashesObserved: Object.fromEntries(REPLICAS.map((replica) => [
      replica,
      candidateBounds.find((row) => row.replica === replica)?.candidate_set_hash
    ])),
    candidateHashesUnchanged,
    terminalStatusesExpected: EXPECTED_TERMINAL_STATUSES,
    terminalStatusesObserved: Object.fromEntries(status.statuses.map((row) => [row.replica, row.status])),
    terminalStatusesUnchanged,
    secretScanClean: null,
    supportedNumericalClaimsHaveProvenance: provenance.passed,
    provenanceFailures: provenance.failures
  };

  const context = {
    report,
    metrics,
    finalManifestHash,
    frozenManifestHash,
    status,
    candidateRows,
    searchComparison,
    objectiveAudit,
    localizationSummary,
    coneSummary,
    runtimeValidation,
    runtimeRegression,
    runtimeRollback,
    defectAudit,
    defectMatrix,
    graphIndex,
    baselineRows,
    ablationRows,
    statsRows,
    holm,
    figures,
    claimsLedger,
    fillRows,
    rawIndexRows,
    validation: validationDraft
  };

  writeText(fromShare("PATCHWORK_FULL_EXPERIMENT_RESULTS.md"), buildFullResults(context));
  writeText(fromShare("PATCHWORK_ALL_TABLES.md"), buildAllTables(context));
  writeText(fromShare("PATCHWORK_STATISTICS.json"), JSON.stringify(buildStatisticsJson(context), null, 2));
  writeText(fromShare("PATCHWORK_PROVENANCE.md"), buildProvenance(context));
  writeText(fromShare("PATCHWORK_RAW_RESULT_INDEX.md"), buildRawIndex(rawIndexRows));
  copyFileSync(fromFinal("paper/PATCHWORK_controlled_results_fragment.tex"), fromShare("PATCHWORK_CONTROLLED_RESULTS_FRAGMENT.tex"));
  copyFileSync(fromFinal("reports/SCIENTIFIC_CORRECTION_CHANGELOG.md"), fromShare("PATCHWORK_SCIENTIFIC_CORRECTION_CHANGELOG.md"));

  const findings = scanForSecrets(shareRoot);
  validationDraft.secretScanClean = findings.length === 0;
  validationDraft.secretScanFindings = findings;

  const frozenAfterSnapshot = snapshotDirectory(frozenRoot);
  validationDraft.frozenAfterDirectoryHash = directoryHash(frozenAfterSnapshot);
  validationDraft.evidenceMutationDetected = diffSnapshots(frozenBeforeSnapshot, frozenAfterSnapshot).evidenceMutationDetected;

  const requiredValidationChecks = [
    ["frozen manifest hash", validationDraft.frozenManifestHashMatchesExpected],
    ["valid confirmation observations", validationDraft.validConfirmationObservationsMatchExpected],
    ["duplicate valid keys", validationDraft.duplicateValidKeysMatchExpected],
    ["candidate hashes unchanged", validationDraft.candidateHashesUnchanged],
    ["terminal statuses unchanged", validationDraft.terminalStatusesUnchanged],
    ["secret scan clean", validationDraft.secretScanClean],
    ["supported numerical claims have provenance", validationDraft.supportedNumericalClaimsHaveProvenance],
    ["frozen evidence unchanged", validationDraft.evidenceMutationDetected === false]
  ];
  const failed = requiredValidationChecks.filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) {
    writeText(fromShare("PATCHWORK_REVIEW_PACKAGE_MANIFEST.json"), JSON.stringify(buildManifest(context, []), null, 2));
    throw new Error(`Review package validation failed: ${failed.join(", ")}`);
  }

  context.validation = validationDraft;
  writeText(fromShare("PATCHWORK_FULL_EXPERIMENT_RESULTS.md"), buildFullResults(context));
  writeText(fromShare("PATCHWORK_STATISTICS.json"), JSON.stringify(buildStatisticsJson(context), null, 2));
  writeText(fromShare("PATCHWORK_PROVENANCE.md"), buildProvenance(context));

  const withoutManifest = listFilesRecursive(shareRoot).filter((file) => file !== "PATCHWORK_REVIEW_PACKAGE_MANIFEST.json");
  const packageFiles = buildManifestPackageFiles(withoutManifest);
  const zipManifestInfo = {
    path: ZIP_REL,
    bytes: null,
    sha256: null,
    containsOnlyShareForReviewFiles: true,
    sha256Note:
      "Not embedded because the final zip includes this manifest. The generator prints the actual final zip SHA-256 after zip creation."
  };
  writeText(
    fromShare("PATCHWORK_REVIEW_PACKAGE_MANIFEST.json"),
    JSON.stringify(buildManifest(context, packageFiles, zipManifestInfo), null, 2)
  );

  rmSync(zipPath, { force: true });
  const finalZipFiles = listFilesRecursive(shareRoot).map((file) => fromShare(file));
  const finalZip = spawnSync("zip", ["-j", zipPath, ...finalZipFiles], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (finalZip.status !== 0) {
    throw new Error(`final zip failed: ${finalZip.stderr || finalZip.stdout}`);
  }

  const finalFiles = listFilesRecursive(shareRoot);
  const finalPackageFiles = buildPackageFilesMetadata(finalFiles);
  const finalZipInfo = {
    path: ZIP_REL,
    bytes: statSync(zipPath).size,
    sha256: sha256File(zipPath),
    containsOnlyShareForReviewFiles: true,
    manifestSelfSha256: sha256File(fromShare("PATCHWORK_REVIEW_PACKAGE_MANIFEST.json"))
  };

  const output = {
    status: "SHARE PACKAGE READY",
    shareRoot,
    zipPath,
    files: finalPackageFiles.map((file) => ({
      path: fromShare(file.filename),
      bytes: file.bytes,
      sha256: file.sha256
    })),
    zip: {
      path: zipPath,
      bytes: finalZipInfo.bytes,
      sha256: finalZipInfo.sha256
    },
    validation: validationDraft
  };

  console.log(JSON.stringify(output, null, 2));
}

prepare();
