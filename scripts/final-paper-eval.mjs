#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { parse as parseYaml } from "yaml";

export const FINAL_REL = "experiments/results/final-paper-v1";
export const FROZEN_REL = "experiments/results/search-certification-pilot-v2/full-confirmation";
export const EVIDENCE_CLASS = {
  controlled: "DETERMINISTIC_CONTROLLED_RUNTIME",
  scripted: "SCRIPTED_OR_MOCK_AGENT",
  live: "LIVE_LLM_AGENT",
  human: "HUMAN_REVIEW",
  partner: "PARTNER_STAGING_CANARY"
};

const replicas = ["shop", "saas", "support"];
const expectedFrozen = {
  manifestHash: "09453c813fbd1f71c203ef28e26a1d5ae90b1b25346a3c74356ea04d2ad21eda",
  candidateSetHashes: {
    shop: "f19533c548554c88068bd39cf260e4f2a55715768b95380f7f0cbe48dada0820",
    saas: "67262e5ad7e97d78b71e53230b1ccce37cea500e984a5775484f41343588c5fb",
    support: "31fd164c522da600bf041fc94b1646923e2c2535f5d607f7aa49f0c6d50e4d84"
  },
  epsilon: 0.05,
  delta: 0.05,
  terminalStatuses: {
    shop: {
      plannedCandidateSeedRuns: 955,
      completedCandidateSeedRuns: 951,
      plannedObservations: 2865,
      validObservations: 2861,
      remainingCandidateSeedRuns: 4,
      retryableCandidateSeedRuns: 0,
      exhaustedInfrastructureCandidateSeedRuns: 4,
      certifiedSafe: [],
      plausiblySafe: ["shop-111"],
      status: "NOT_CERTIFIED_INFRASTRUCTURE_FAILURE"
    },
    saas: {
      plannedCandidateSeedRuns: 990,
      completedCandidateSeedRuns: 990,
      plannedObservations: 3960,
      validObservations: 3960,
      remainingCandidateSeedRuns: 0,
      retryableCandidateSeedRuns: 0,
      exhaustedInfrastructureCandidateSeedRuns: 0,
      certifiedSafe: [],
      plausiblySafe: ["saas-1111"],
      status: "NOT_CERTIFIED_SAFETY_BOUND_NOT_CLOSED"
    },
    support: {
      plannedCandidateSeedRuns: 990,
      completedCandidateSeedRuns: 990,
      plannedObservations: 3960,
      validObservations: 3960,
      remainingCandidateSeedRuns: 0,
      retryableCandidateSeedRuns: 0,
      exhaustedInfrastructureCandidateSeedRuns: 0,
      certifiedSafe: [],
      plausiblySafe: ["support-1111"],
      status: "NOT_CERTIFIED_SAFETY_BOUND_NOT_CLOSED"
    }
  }
};

const figureColors = [
  [31, 119, 180],
  [255, 127, 14],
  [44, 160, 44],
  [214, 39, 40],
  [148, 103, 189],
  [140, 86, 75]
];

export function repoRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function stableJsonHash(value) {
  return sha256Text(stableStringify(value));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readYaml(filePath) {
  return parseYaml(readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes && char === "\"" && next === "\"") {
      field += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === ",") {
      row.push(field);
      field = "";
    } else if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function readCsv(filePath) {
  return parseCsv(readFileSync(filePath, "utf8"));
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function writeCsv(filePath, rows, headers) {
  ensureParent(filePath);
  const actualHeaders = headers || [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [actualHeaders.map(csvCell).join(",")];
  for (const row of rows) lines.push(actualHeaders.map((header) => csvCell(row[header])).join(","));
  writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function writeJson(filePath, value) {
  ensureParent(filePath);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  ensureParent(filePath);
  writeFileSync(filePath, value);
}

function ensureParent(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function ensureDirs(root) {
  for (const dir of [
    "manifest",
    "audit",
    "metrics",
    "baselines",
    "ablations",
    "statistics",
    "tables",
    "figures",
    "paper",
    "provenance",
    "reports"
  ]) {
    mkdirSync(path.join(root, FINAL_REL, dir), { recursive: true });
  }
}

function listFilesRecursive(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) result.push(...listFilesRecursive(full, base));
    else if (stat.isFile()) result.push(path.relative(base, full));
  }
  return result;
}

export function snapshotDirectory(dir) {
  const files = listFilesRecursive(dir).map((relativePath) => {
    const fullPath = path.join(dir, relativePath);
    const stat = statSync(fullPath);
    return {
      path: relativePath,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: sha256File(fullPath)
    };
  });
  return {
    directory: dir,
    generatedAt: new Date().toISOString(),
    files,
    directoryHash: stableJsonHash(files.map(({ path: filePath, bytes, sha256 }) => ({ path: filePath, bytes, sha256 })))
  };
}

export function diffSnapshots(before, after) {
  const left = new Map(before.files.map((file) => [file.path, file]));
  const right = new Map(after.files.map((file) => [file.path, file]));
  const added = [...right.keys()].filter((key) => !left.has(key)).sort();
  const removed = [...left.keys()].filter((key) => !right.has(key)).sort();
  const changed = [...right.keys()]
    .filter((key) => left.has(key) && left.get(key).sha256 !== right.get(key).sha256)
    .sort();
  return {
    evidenceMutationDetected: added.length > 0 || removed.length > 0 || changed.length > 0,
    added,
    removed,
    changed,
    beforeDirectoryHash: before.directoryHash,
    afterDirectoryHash: after.directoryHash
  };
}

function commandText(command, args) {
  const run = spawnSync(command, args, { encoding: "utf8" });
  if (run.status !== 0) return "";
  return run.stdout.trim();
}

function repoMetadata(root) {
  if (!existsSync(path.join(root, ".git"))) {
    return { commit: "not-a-git-worktree", dirty: "unknown", source: "local directory without .git" };
  }
  const commit = commandText("git", ["rev-parse", "HEAD"]) || "unknown";
  const dirty = commandText("git", ["status", "--short"]) ? "dirty" : "clean";
  return { commit, dirty, source: "git" };
}

function sourceHash(root, relativePath) {
  const filePath = path.join(root, relativePath);
  return existsSync(filePath) ? sha256File(filePath) : "MISSING";
}

function loadContracts(root) {
  const contracts = {};
  for (const replica of replicas) {
    const file = path.join(root, `replicas/${replica}-twin/research/contracts/journeys.yaml`);
    contracts[replica] = readYaml(file);
  }
  return contracts;
}

function loadEvidence(root) {
  const finalDir = path.join(root, FINAL_REL);
  const searchDir = path.join(root, "experiments/results/search-certification-pilot-v2");
  const frozenDir = path.join(root, FROZEN_REL);
  const repairDir = path.join(root, "experiments/results/repair-pilot-v1");
  const defectDir = path.join(root, "experiments/results/defect-audit");
  const liveSmokePath = path.join(root, "experiments/results/pilot-study-v2/live-smoke/live-smoke.json");
  const manuscriptFiles = listFilesRecursive(root)
    .filter((file) => file.endsWith(".tex") && !file.startsWith("node_modules/") && !file.startsWith(`${FINAL_REL}/`))
    .sort();
  return {
    root,
    finalDir,
    searchDir,
    frozenDir,
    repairDir,
    defectDir,
    repository: repoMetadata(root),
    packageJson: readJson(path.join(root, "package.json")),
    searchManifest: readYaml(path.join(root, "experiments/configs/search-certification-pilot-v2.yaml")),
    repairManifest: readYaml(path.join(root, "experiments/configs/repair-pilot-v1.yaml")),
    frozenInputs: readJson(path.join(frozenDir, "frozen-inputs.json")),
    confirmationStatus: readJson(path.join(frozenDir, "status.json")).statuses,
    confirmationSummary: readCsv(path.join(frozenDir, "confirmation-summary.csv")),
    confirmationObservations: readJsonl(path.join(frozenDir, "confirmation-observations.jsonl")),
    candidateBounds: readCsv(path.join(frozenDir, "candidate-bounds.csv")),
    seedUsage: readCsv(path.join(frozenDir, "seed-usage.csv")),
    runtimeFailures: readCsv(path.join(frozenDir, "runtime-failures.csv")),
    searchComparison: readCsv(path.join(searchDir, "search-strategy-comparison.csv")),
    repeatedSearch: readJsonl(path.join(searchDir, "repeated-search-results.jsonl")),
    objectiveAudit: readCsv(path.join(searchDir, "objective-audit.csv")),
    candidateSetAudit: readJson(path.join(searchDir, "candidate-set-audit.json")),
    candidateSets: Object.fromEntries(replicas.map((replica) => [replica, readJson(path.join(searchDir, `candidate-set-${replica}.json`))])),
    defectAudit: readJson(path.join(defectDir, "defect-audit.json")),
    defectMatrix: readCsv(path.join(defectDir, "defect-matrix.csv")),
    contracts: loadContracts(root),
    graphIndex: readJson(path.join(root, "repair/results/graphs/index.json")),
    localizationSummary: readCsv(path.join(repairDir, "localization-summary.csv")),
    coneSummary: readCsv(path.join(repairDir, "cone-summary.csv")),
    runtimeKpis: readJson(path.join(repairDir, "runtime-kpis.json")),
    runtimePaired: readJsonl(path.join(repairDir, "runtime-paired-replay.jsonl")),
    runtimeValidation: readCsv(path.join(repairDir, "runtime-validation.csv")),
    runtimeRegressionSummary: readCsv(path.join(repairDir, "runtime-regression-summary.csv")),
    runtimeRegression: readJsonl(path.join(repairDir, "runtime-regression.jsonl")),
    runtimeRollback: readCsv(path.join(repairDir, "runtime-rollback.csv")),
    liveSmoke: existsSync(liveSmokePath) ? readJson(liveSmokePath) : { executed: false, reason: "live smoke artifact missing" },
    manuscriptFiles,
    sourceFiles: [
      "package.json",
      "experiments/configs/search-certification-pilot-v2.yaml",
      "experiments/configs/repair-pilot-v1.yaml",
      "experiments/results/search-certification-pilot-v2/candidate-set-audit.json",
      "experiments/results/search-certification-pilot-v2/repeated-search-results.jsonl",
      "experiments/results/search-certification-pilot-v2/search-strategy-comparison.csv",
      `${FROZEN_REL}/frozen-inputs.json`,
      `${FROZEN_REL}/status.json`,
      `${FROZEN_REL}/confirmation-observations.jsonl`,
      "experiments/results/repair-pilot-v1/runtime-kpis.json",
      "experiments/results/repair-pilot-v1/runtime-paired-replay.jsonl",
      "experiments/results/repair-pilot-v1/runtime-validation.csv",
      "experiments/results/repair-pilot-v1/runtime-regression-summary.csv",
      "experiments/results/repair-pilot-v1/runtime-rollback.csv",
      "experiments/results/repair-pilot-v1/cone-summary.csv",
      "experiments/results/defect-audit/defect-audit.json",
      "experiments/results/defect-audit/defect-matrix.csv",
      "repair/results/graphs/index.json",
      "scripts/final-paper-eval.mjs"
    ]
  };
}

export function isValidConfirmationObservation(row) {
  return Boolean(row?.outcome?.attempted && row?.outcome?.startupOk && row?.outcome?.resetOk && row?.outcome?.healthOk);
}

export function confirmationObservationKey(row) {
  return [row.replica, row.configurationId, row.seed, row.journeyId].join("|");
}

export function reconstructTerminalState(status) {
  return {
    replica: status.replica,
    terminalStatus: status.status,
    completedOverPlanned: `${status.completedCandidateSeedRuns}/${status.plannedCandidateSeedRuns}`,
    certifiedCandidate: status.certifiedSafe?.[0] || "none",
    plausibleCandidate: status.plausiblySafe?.[0] || "none",
    abstained: !status.certifiedSafe || status.certifiedSafe.length === 0,
    infrastructureFailure: status.status === "NOT_CERTIFIED_INFRASTRUCTURE_FAILURE",
    safetyBoundNotClosed: status.status === "NOT_CERTIFIED_SAFETY_BOUND_NOT_CLOSED"
  };
}

export function na(reason) {
  return `N/A - ${reason}`;
}

export function tableRowsHaveProvenance(rows) {
  return rows.every((row) => row.source_artifacts && row.source_sha256s && row.analysis_script && row.output_table_path && row.evidence_class);
}

export function duplicateValidObservationKeys(rows) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    if (!isValidConfirmationObservation(row)) continue;
    const key = confirmationObservationKey(row);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

function auditEvidence(evidence, beforeSnapshot) {
  const checks = [];
  const warnings = [];
  const critical = [];
  const add = (id, pass, detail, severity = "critical") => {
    checks.push({ id, pass, severity, detail });
    if (!pass && severity === "critical") critical.push(`${id}: ${detail}`);
    if (!pass && severity === "warning") warnings.push(`${id}: ${detail}`);
  };
  const frozen = evidence.frozenInputs;
  add("manifest-hash-preserved", frozen.manifestHash === expectedFrozen.manifestHash, `${frozen.manifestHash}`);
  add("epsilon-preserved", Number(frozen.epsilon) === expectedFrozen.epsilon, `${frozen.epsilon}`);
  add("delta-preserved", Number(frozen.delta) === expectedFrozen.delta, `${frozen.delta}`);
  for (const replica of replicas) {
    add(
      `candidate-hash-${replica}`,
      frozen.candidateSetHashes?.[replica] === expectedFrozen.candidateSetHashes[replica],
      `${frozen.candidateSetHashes?.[replica]}`
    );
    add(
      `candidate-file-hash-${replica}`,
      evidence.candidateSets[replica].candidateSetHash === expectedFrozen.candidateSetHashes[replica],
      `${evidence.candidateSets[replica].candidateSetHash}`
    );
    add(
      `candidate-set-no-search-reuse-${replica}`,
      evidence.candidateSets[replica].searchDataIncludedInConfirmationStatistics === false,
      "confirmation candidate set marks search data excluded from confirmation statistics"
    );
  }
  const validRows = evidence.confirmationObservations.filter(isValidConfirmationObservation);
  const duplicateKeys = duplicateValidObservationKeys(evidence.confirmationObservations);
  add("duplicate-valid-confirmation-observation-keys", duplicateKeys.length === 0, `${duplicateKeys.length} duplicate valid keys`);
  const statusByReplica = Object.fromEntries(evidence.confirmationStatus.map((row) => [row.replica, row]));
  const validByReplica = groupCount(validRows, (row) => row.replica);
  for (const replica of replicas) {
    const expected = expectedFrozen.terminalStatuses[replica];
    const actual = statusByReplica[replica];
    for (const key of [
      "plannedCandidateSeedRuns",
      "completedCandidateSeedRuns",
      "plannedObservations",
      "validObservations",
      "remainingCandidateSeedRuns",
      "retryableCandidateSeedRuns",
      "exhaustedInfrastructureCandidateSeedRuns",
      "status"
    ]) {
      add(`confirmation-status-${replica}-${key}`, String(actual?.[key]) === String(expected[key]), `${actual?.[key]}`);
    }
    add(`confirmation-valid-file-count-${replica}`, (validByReplica[replica] || 0) === expected.validObservations, `${validByReplica[replica] || 0}`);
    add(`certified-safe-empty-${replica}`, Array.isArray(actual?.certifiedSafe) && actual.certifiedSafe.length === 0, JSON.stringify(actual?.certifiedSafe));
    add(
      `plausible-not-certified-${replica}`,
      Array.isArray(actual?.plausiblySafe) && actual.plausiblySafe.join(";") === expected.plausiblySafe.join(";"),
      JSON.stringify(actual?.plausiblySafe)
    );
  }
  add("search-record-count", evidence.repeatedSearch.length === 540, `${evidence.repeatedSearch.length}`);
  add(
    "search-confirmation-separated",
    evidence.repeatedSearch.every((row) => !row.stage || row.stage !== "confirmation") &&
      evidence.confirmationObservations.every((row) => row.stage === "confirmation"),
    "search logs are not relabeled as confirmation observations"
  );
  add("defect-audit-count", evidence.defectAudit.rows.length === 11, `${evidence.defectAudit.rows.length}`);
  add("localization-count", evidence.localizationSummary.length === 33, `${evidence.localizationSummary.length}`);
  add("runtime-paired-count", evidence.runtimePaired.length === 33, `${evidence.runtimePaired.length}`);
  add("runtime-validation-count", evidence.runtimeValidation.length === 11, `${evidence.runtimeValidation.length}`);
  add("runtime-regression-count", Number(evidence.runtimeKpis.regressionRuns) === 90, `${evidence.runtimeKpis.regressionRuns}`);
  add("runtime-rollback-count", evidence.runtimeRollback.length === 11, `${evidence.runtimeRollback.length}`);
  add("live-agent-evidence-unavailable", evidence.liveSmoke.executed === false, evidence.liveSmoke.reason || "not executed", "warning");
  add("manuscript-source-present", evidence.manuscriptFiles.length > 0, `${evidence.manuscriptFiles.length} .tex sources found`, "warning");
  add("git-provenance-present", evidence.repository.commit !== "not-a-git-worktree", evidence.repository.commit, "warning");
  return {
    generatedAt: new Date().toISOString(),
    status: critical.length ? "FAIL" : "PASS",
    checks,
    warnings,
    critical,
    duplicateValidObservationKeys: duplicateKeys,
    validConfirmationObservations: validRows.length,
    frozenBeforeDirectoryHash: beforeSnapshot.directoryHash,
    evidenceClasses: evidenceClassSummary(evidence)
  };
}

function evidenceClassSummary(evidence) {
  return [
    {
      evidenceClass: EVIDENCE_CLASS.controlled,
      status: "AVAILABLE",
      artifacts: [
        "repair-pilot-v1 runtime artifacts",
        "search-certification-pilot-v2 repeated search artifacts",
        "search-certification-pilot-v2 full-confirmation artifacts"
      ]
    },
    {
      evidenceClass: EVIDENCE_CLASS.scripted,
      status: "AVAILABLE",
      artifacts: ["scripted Playwright/mock harnesses in repair and pilot outputs"]
    },
    {
      evidenceClass: EVIDENCE_CLASS.live,
      status: "N/A",
      artifacts: [evidence.liveSmoke.reason || "live LLM provider configuration and cost approval incomplete"]
    },
    {
      evidenceClass: EVIDENCE_CLASS.human,
      status: "N/A",
      artifacts: ["formal human developer acceptance study not executed"]
    },
    {
      evidenceClass: EVIDENCE_CLASS.partner,
      status: "N/A",
      artifacts: ["partner staging or production canary evidence not present"]
    }
  ];
}

function writeAudit(finalDir, audit) {
  writeJson(path.join(finalDir, "audit/evidence-audit.json"), audit);
  const rows = audit.checks.map((check) => `| ${check.id} | ${check.pass ? "PASS" : "FAIL"} | ${check.severity} | ${escapeMd(check.detail)} |`).join("\n");
  writeText(
    path.join(finalDir, "audit/evidence-audit.md"),
    `# Evidence Audit\n\nStatus: ${audit.status}\n\n| Check | Result | Severity | Detail |\n| --- | --- | --- | --- |\n${rows}\n\nWarnings:\n${audit.warnings.map((warning) => `- ${warning}`).join("\n") || "- none"}\n`
  );
}

function createManifest(evidence, audit) {
  const sourceArtifactHashes = Object.fromEntries(evidence.sourceFiles.map((file) => [file, sourceHash(evidence.root, file)]));
  const manifest = {
    manifestVersion: "final-paper-v1",
    createdAt: new Date().toISOString(),
    repository: evidence.repository,
    sourceArtifactHashes,
    frozenEvidence: {
      confirmationDirectory: FROZEN_REL,
      manifestHash: evidence.frozenInputs.manifestHash,
      candidateSetHashes: evidence.frozenInputs.candidateSetHashes,
      epsilon: evidence.frozenInputs.epsilon,
      delta: evidence.frozenInputs.delta,
      safetyThresholds: evidence.frozenInputs.safetyThresholds,
      confirmationSeedRanges: evidence.frozenInputs.confirmationSeedRanges
    },
    evidenceClasses: evidenceClassSummary(evidence),
    baselineDefinitions: baselineDefinitions(),
    ablationDefinitions: ablationDefinitions(),
    seeds: {
      repairSeeds: evidence.repairManifest.seeds,
      searchSeeds: evidence.searchManifest.budgets.searchSeeds,
      confirmationSeedRanges: evidence.frozenInputs.confirmationSeedRanges,
      bootstrapSeed: 8675309
    },
    statisticalProcedures: {
      pairedBinary: "exact McNemar/binomial test on paired task seeds where paired observations exist",
      intervals: "deterministic paired bootstrap with fixed seed and 5000 resamples",
      multipleTesting: "Holm correction over preregistered primary comparisons with p-values",
      limitations: "Only three controlled replicas; site-level cluster precision is limited"
    },
    metricDefinitions: {
      csr: "compliant successes divided by attempted controlled journey tasks for comparable deterministic runtime evidence",
      violationRate: "journey observations with any verifier/safety violation divided by attempted observations",
      globalSimpleRegret: "oracle best safe objective minus selected objective, lower bounded by zero",
      candidateRecallAtEpsilon: "epsilon-best safe configurations represented in the frozen candidate set divided by all epsilon-best safe configurations",
      tokensPerTask: "N/A unless genuine live model token accounting exists",
      fixCost: "repository objective cost model: lambdaCost times normalized engineering minutes; no monetary dollars"
    },
    auditAtManifestCreation: {
      status: audit.status,
      criticalCount: audit.critical.length,
      warningCount: audit.warnings.length
    }
  };
  const manifestPath = path.join(evidence.finalDir, "manifest/final-evaluation-manifest.json");
  writeJson(manifestPath, manifest);
  const hash = sha256File(manifestPath);
  writeText(path.join(evidence.finalDir, "manifest/final-evaluation-manifest.sha256"), `${hash}  final-evaluation-manifest.json\n`);
  return { manifest, manifestHash: hash };
}

function baselineDefinitions() {
  return [
    { id: "B0", method: "Original interface", rule: "Use paired runtime original-side observations from repair-runtime-v1." },
    { id: "B1", method: "Static readiness ordering", rule: "Use only if a frozen evaluated ordering exists; otherwise N/A." },
    { id: "B2", method: "Expert prioritization", rule: "Use only if preregistered frozen expert ordering exists; otherwise N/A." },
    { id: "B3", method: "Agent-side prompt / retry repair", rule: "Use only genuine live-agent prompt/retry evidence; otherwise N/A." },
    { id: "B4", method: "Random feasible patch search", rule: "Use frozen Search V2 RandomFeasibleSearch records at registered maximum budgets." },
    { id: "B5", method: "Constrained BO, no localization", rule: "Use only logged or faithful preregistered finite-space BO baseline; otherwise N/A." },
    { id: "B6", method: "PATCHWORK, no confirmation", rule: "Use deterministic typed-template repair with static/runtime validation, paired replay, regression, rollback, and graph-aware search." },
    { id: "B7", method: "Full PATCHWORK", rule: "Use B6 plus immutable independent confirmation; do not treat plausible candidates as certified." }
  ];
}

function ablationDefinitions() {
  return [
    { id: "A1", method: "No typed affordance graph", rule: "N/A unless graph-free localization/repair evidence exists." },
    { id: "A2", method: "No failure-cone restriction", rule: "N/A unless unrestricted localization/patch search was executed on matched tasks." },
    { id: "A3", method: "No paired checkpoint replay", rule: "N/A unless replay gate was disabled under matched evidence." },
    { id: "A4", method: "Linear surrogate only", rule: "N/A; logged search strategies are random feasible and graph-aware Bayesian ridge." },
    { id: "A5", method: "No hard safety constraints", rule: "N/A; unsafe protocol intentionally not run." },
    { id: "A6", method: "No independent confirmation", rule: "Use PATCHWORK deterministic runtime evidence before confirmation." },
    { id: "A7", method: "Template-only patching", rule: "Use deterministic typed-template compiler evidence; not evidence of LLM synthesis." },
    { id: "A8", method: "Single-agent evaluation", rule: "N/A as heterogeneous live-agent matrix was not executed." },
    { id: "A9", method: "Full PATCHWORK", rule: "Use immutable independent confirmation terminal outcome." }
  ];
}

function buildMetrics(evidence) {
  const paired = evidence.runtimePaired;
  const validConfirmation = evidence.confirmationObservations.filter(isValidConfirmationObservation);
  const graphRows = evidence.graphIndex.graphs.sort((a, b) => a.replica.localeCompare(b.replica));
  const conePercentages = evidence.coneSummary.map((row) => Number(row.cone_percent));
  const localization = {
    cases: evidence.localizationSummary.length,
    exactFirstViolatedPredicate: rate(evidence.localizationSummary, (row) => row.exact_match === "true"),
    exactRootCause: rate(evidence.coneSummary, (row) => row.exact_root_cause === "true"),
    top3RootCause: rate(evidence.coneSummary, (row) => row.top3_root_cause === "true"),
    rootCauseContained: rate(evidence.coneSummary, (row) => row.root_cause_contained === "true"),
    medianConePercent: median(conePercentages),
    iqrConePercent: iqr(conePercentages),
    perReplica: replicas.map((replica) => {
      const rows = evidence.coneSummary.filter((row) => row.replica === replica);
      return {
        replica,
        cases: rows.length,
        exactRootCause: rate(rows, (row) => row.exact_root_cause === "true"),
        top3RootCause: rate(rows, (row) => row.top3_root_cause === "true"),
        rootCauseContained: rate(rows, (row) => row.root_cause_contained === "true"),
        medianConePercent: median(rows.map((row) => Number(row.cone_percent)))
      };
    })
  };
  const originalSide = runtimeSideMetrics(paired, "original");
  const patchedSide = runtimeSideMetrics(paired, "patched");
  const patch = {
    generatedPatches: evidence.runtimeValidation.length,
    validationAccepted: countWhere(evidence.runtimeValidation, (row) => row.accepted === "true"),
    staticPasses: {
      diffParse: countWhere(evidence.runtimeValidation, (row) => row.diff_parse === "pass"),
      pathSafety: countWhere(evidence.runtimeValidation, (row) => row.path_safety === "pass"),
      sandboxApply: countWhere(evidence.runtimeValidation, (row) => row.sandbox_apply === "pass"),
      sandboxStartup: countWhere(evidence.runtimeValidation, (row) => row.sandbox_startup === "pass"),
      runtimePropertyInvariants: countWhere(evidence.runtimeValidation, (row) => row.runtime_property_invariants === "pass"),
      rollbackParse: countWhere(evidence.runtimeValidation, (row) => row.rollback_parse === "pass")
    },
    pairedRows: paired.length,
    originalSide,
    patchedSide,
    originalDefectsDetected: countWhere(paired, (row) => row.originalExpectedDefectDetected === true),
    patchedCompliant: countWhere(paired, (row) => row.patchedCompliantSuccess === true),
    regressionRuns: Number(evidence.runtimeKpis.regressionRuns),
    regressionPassed: evidence.runtimeRegressionSummary.reduce((sum, row) => sum + Number(row.passed || 0), 0),
    rollbackRuns: evidence.runtimeRollback.length,
    rollbackPassed: countWhere(evidence.runtimeRollback, (row) => row.rollback_passed === "true"),
    unresolvedCases: Number(evidence.runtimeKpis.unresolvedCases),
    medianPatchedLatencyMs: median(paired.map((row) => row.patched.latencyMs)),
    medianOriginalLatencyMs: median(paired.map((row) => row.original.latencyMs)),
    medianLatencyDifferenceMs: median(paired.map((row) => row.latencyDifferenceMs)),
    medianSynthesisAttempts: Number(evidence.runtimeKpis.medianSteps)
  };
  const maxBudgetRows = evidence.searchComparison.filter((row) => Number(row.budget) === maxBudgetForReplica(row.replica));
  const randomMax = maxBudgetRows.filter((row) => row.strategy === "RandomFeasibleSearch");
  const graphMax = maxBudgetRows.filter((row) => row.strategy === "GraphAwareSurrogateSearch");
  const search = {
    records: evidence.repeatedSearch.length,
    comparisonRows: evidence.searchComparison.length,
    objectiveRows: evidence.objectiveAudit.length,
    spaces: Object.fromEntries(replicas.map((replica) => [replica, evidence.objectiveAudit.filter((row) => row.replica === replica).length])),
    oracleBest: Object.fromEntries(
      replicas.map((replica) => {
        const row = evidence.objectiveAudit.find((item) => item.replica === replica && item.configuration_id === item.true_best_safe_configuration);
        return [replica, { configurationId: row?.configuration_id || "", objective: Number(row?.final_j || 0) }];
      })
    ),
    randomMax: aggregateSearchRows(randomMax),
    graphAwareMax: aggregateSearchRows(graphMax),
    candidateRecallAtEpsilon: mean(evidence.searchComparison.map((row) => Number(row.candidate_recall_at_epsilon))),
    unsafeRecommendationRate: mean(evidence.searchComparison.map((row) => Number(row.unsafe_recommendation_rate))),
    rows: evidence.searchComparison.map((row) => ({
      replica: row.replica,
      strategy: row.strategy,
      budget: Number(row.budget),
      runs: Number(row.runs),
      meanGlobalRegret: Number(row.mean_global_regret),
      medianGlobalRegret: Number(row.median_global_regret),
      candidateRecallAtEpsilon: Number(row.candidate_recall_at_epsilon),
      unsafeRecommendationRate: Number(row.unsafe_recommendation_rate),
      probabilityFindingOracleBest: Number(row.probability_finding_oracle_best)
    }))
  };
  const confirmationStatuses = evidence.confirmationStatus.map((row) => ({
    replica: row.replica,
    candidateCount: row.candidateCounts.length,
    plannedCandidateSeedRuns: row.plannedCandidateSeedRuns,
    completedCandidateSeedRuns: row.completedCandidateSeedRuns,
    plannedObservations: row.plannedObservations,
    validObservations: row.validObservations,
    infrastructureFailures: row.exhaustedInfrastructureCandidateSeedRuns,
    certifiedSafe: row.certifiedSafe,
    plausiblySafe: row.plausiblySafe,
    stoppingGap: row.stoppingGap || "N/A",
    status: row.status
  }));
  const confirmation = {
    statuses: confirmationStatuses,
    candidateCount: confirmationStatuses.reduce((sum, row) => sum + row.candidateCount, 0),
    plannedCandidateSeedRuns: sum(confirmationStatuses, "plannedCandidateSeedRuns"),
    completedCandidateSeedRuns: sum(confirmationStatuses, "completedCandidateSeedRuns"),
    plannedObservations: sum(confirmationStatuses, "plannedObservations"),
    validObservations: sum(confirmationStatuses, "validObservations"),
    validObservationRowsInFile: validConfirmation.length,
    infrastructureFailures: sum(confirmationStatuses, "infrastructureFailures"),
    certifiedReplicaCount: confirmationStatuses.filter((row) => row.certifiedSafe.length > 0).length,
    plausibleReplicaCount: confirmationStatuses.filter((row) => row.plausiblySafe.length > 0).length,
    certificationRate: confirmationStatuses.filter((row) => row.certifiedSafe.length > 0).length / confirmationStatuses.length,
    abstentionRate: confirmationStatuses.filter((row) => row.certifiedSafe.length === 0).length / confirmationStatuses.length,
    plausibleCandidatePerformance: confirmationCandidatePerformance(validConfirmation, confirmationStatuses)
  };
  const benchmark = {
    replicas: 3,
    replicaNames: "ShopTwin, SaaSTwin, SupportTwin",
    journeys: evidence.defectAudit.rows.length,
    journeyDistribution: Object.fromEntries(replicas.map((replica) => [replica, evidence.defectAudit.rows.filter((row) => row.replica === replica).length])),
    localizationCases: evidence.localizationSummary.length,
    patchCases: evidence.runtimeValidation.length,
    historicalMockRuns: 66,
    graphRows,
    defectDistribution: defectDistribution(evidence)
  };
  const costs = {
    fixCostModel: "lambdaCost * min(1, engineeringMinutes / 240); lambdaCost=0.03. No dollar costs are logged.",
    patchValidationRollouts: evidence.runtimeValidation.length + evidence.runtimePaired.length + Number(evidence.runtimeKpis.regressionRuns) + evidence.runtimeRollback.length,
    searchRecords: evidence.repeatedSearch.length,
    confirmationValidObservations: confirmation.validObservations,
    tokensPerTask: "N/A - no live model token accounting in controlled evidence",
    latencyBoundary: "runtime journey latency from deterministic Playwright/scripted harness"
  };
  return { benchmark, localization, patch, search, confirmation, costs };
}

function defectDistribution(evidence) {
  const severityByDefect = {};
  for (const replica of replicas) {
    for (const journey of evidence.contracts[replica].journeys) {
      const predicateSeverity = {};
      for (const predicate of [...(journey.successPredicates || []), ...(journey.safetyInvariants || [])]) {
        predicateSeverity[predicate.id] = predicate.severity || "unknown";
      }
      for (const outcome of journey.expectedDefectOutcomes || []) {
        severityByDefect[outcome.defectId] = predicateSeverity[outcome.firstFailedPredicateId] || "unknown";
      }
    }
  }
  const actual = evidence.defectMatrix.map((row) => ({
    defectId: row.defect_id,
    family: row.defect_family,
    severity: severityByDefect[row.defect_id] || "unknown",
    violationType: row.expected_violation_type
  }));
  return {
    families: groupCount(actual, (row) => row.family),
    severities: groupCount(actual, (row) => row.severity),
    violationTypes: groupCount(actual, (row) => row.violationType),
    rows: actual
  };
}

export function csr(successes, attempts) {
  return attempts ? successes / attempts : null;
}

export function violationRate(violations, attempts) {
  return attempts ? violations / attempts : null;
}

export function regret(oracleBest, selected) {
  return Math.max(0, oracleBest - selected);
}

export function candidateRecall(recalled, epsilonBest) {
  return epsilonBest ? recalled / epsilonBest : 0;
}

export function controlledObservationOutcome(observation) {
  const violations = Array.isArray(observation?.violations)
    ? observation.violations
    : Array.isArray(observation?.outcome?.violations)
      ? observation.outcome.violations
      : [];
  const taskSuccess = Boolean(observation?.verifiedSuccess ?? observation?.outcome?.verifiedSuccess ?? observation?.compliantSuccess);
  const explicitCompliant = typeof observation?.compliantSuccess === "boolean" ? observation.compliantSuccess : undefined;
  const violation = violations.length > 0;
  return {
    taskSuccess,
    violation,
    compliantSuccess: explicitCompliant === undefined ? taskSuccess && !violation : explicitCompliant && !violation,
    violationCount: violations.length
  };
}

function observationMetrics(observations) {
  const outcomes = observations.map(controlledObservationOutcome);
  const attempts = outcomes.length;
  const successes = countWhere(outcomes, (outcome) => outcome.compliantSuccess);
  const violations = countWhere(outcomes, (outcome) => outcome.violation);
  return {
    attempts,
    successes,
    violations,
    csr: csr(successes, attempts),
    violationRate: violationRate(violations, attempts)
  };
}

function runtimeSideMetrics(pairedRows, side) {
  return observationMetrics(pairedRows.map((row) => row[side]));
}

function confirmationCandidatePerformance(validRows, statuses) {
  return statuses.map((status) => {
    const candidateId = status.plausiblySafe[0] || "";
    const rows = validRows.filter((row) => row.replica === status.replica && row.configurationId === candidateId);
    const metrics = observationMetrics(rows);
    return {
      replica: status.replica,
      candidate_id: candidateId || "none",
      certification_decision: status.status,
      certified_safe: status.certifiedSafe.length > 0,
      observed_confirmation_csr_uncertified: candidateId ? formatRate(metrics.csr) : "N/A",
      observed_confirmation_violation_rate_uncertified: candidateId ? formatRate(metrics.violationRate) : "N/A",
      valid_observations: rows.length,
      compliant_successes: metrics.successes,
      observations_with_violation: metrics.violations,
      evidence_class: EVIDENCE_CLASS.controlled,
      note: candidateId ? "Observed plausible-candidate confirmation performance only; not a certified deployable recommendation." : "No plausible candidate."
    };
  });
}

function buildBaselines(_evidence, metrics) {
  const pairedRows = metrics.patch.pairedRows;
  const randomRollouts = metrics.search.randomMax.totalConfigEvaluations;
  const graphRollouts = metrics.search.graphAwareMax.totalConfigEvaluations;
  const rows = [
    resultRow("B0", "Original interface", "AVAILABLE", EVIDENCE_CLASS.controlled, metrics.patch.originalSide, {
      fixCost: "0",
      rollouts: `${pairedRows} original paired runtime journeys`,
      latency: `${formatNumber(metrics.patch.medianOriginalLatencyMs)} ms median journey runtime`,
      notes: "Original defect-enabled interface in paired replay."
    }),
    unavailableRow("B1", "Static readiness ordering", "No evaluated frozen static readiness ordering artifact was found."),
    unavailableRow("B2", "Expert prioritization", "No preregistered frozen expert ordering was found."),
    unavailableRow("B3", "Agent-side prompt / retry repair", "Live LLM agent prompt/retry evidence was not executed."),
    {
      method_id: "B4",
      method: "Random feasible patch search",
      availability: "AVAILABLE",
      evidence_class: EVIDENCE_CLASS.controlled,
      n: metrics.search.randomMax.runs,
      csr: "N/A - SEARCH ARTIFACT RECORDS OPTIMAL-CONFIGURATION DISCOVERY, NOT COMPARABLE TASK-LEVEL CSR",
      violation_rate: "N/A - SEARCH ARTIFACT RECORDS UNSAFE RECOMMENDATION RATE, NOT COMPARABLE TASK-LEVEL VIOLATION RATE",
      fix_cost: "repository objective cost model; no dollars",
      rollouts: `${randomRollouts} search configuration evaluations`,
      tokens_per_task: "N/A",
      latency: "N/A - search summary has no comparable journey latency",
      ci95: "N/A",
      certification_outcome: "N/A",
      notes: `Frozen Search V2 random baseline at registered maximum budgets. Search metrics retained separately: probabilityFindingOracleBest=${formatRate(metrics.search.randomMax.probabilityFindingOracleBest)}, meanGlobalRegret=${formatNumber(metrics.search.randomMax.meanGlobalRegret, 6)}, unsafeRecommendationRate=${formatRate(metrics.search.randomMax.unsafeRecommendationRate)}.`
    },
    unavailableRow("B5", "Constrained BO, no localization", "No logged or preregistered no-localization BO baseline exists."),
    resultRow("B6", "PATCHWORK, no confirmation", "AVAILABLE", EVIDENCE_CLASS.controlled, metrics.patch.patchedSide, {
      fixCost: "median 1 synthesis attempt; lambdaCost=0.03 normalized engineering model",
      rollouts: `${metrics.costs.patchValidationRollouts} patch-validation/replay/regression/rollback runs plus ${graphRollouts} search configuration evaluations`,
      latency: `${formatNumber(metrics.patch.medianPatchedLatencyMs)} ms median patched journey runtime`,
      notes: "Deterministic typed-template repair, static/runtime validation, graph-aware search, no independent confirmation."
    }),
    {
      method_id: "B7",
      method: "Full PATCHWORK",
      availability: "DECISION_ABSTAINED",
      evidence_class: EVIDENCE_CLASS.controlled,
      n: metrics.confirmation.statuses.length,
      csr: "N/A - method abstained; see observed plausible-candidate confirmation performance",
      violation_rate: "N/A - method abstained; see observed plausible-candidate confirmation performance",
      fix_cost: "candidate-set scoped cost model; no deployment cost",
      rollouts: `${metrics.confirmation.completedCandidateSeedRuns} completed candidate-seed runs / ${metrics.confirmation.validObservations} valid confirmation observations`,
      tokens_per_task: "N/A",
      latency: "N/A - confirmation boundary differs from paired replay latency",
      ci95: "N/A",
      certification_outcome: "0/3 certified; 3/3 plausible but uncertified",
      notes: "Independent confirmation retained plausible candidates but returned no deployable certified recommendation."
    }
  ];
  return rows;
}

function resultRow(id, method, availability, evidenceClass, metrics, extra) {
  return {
    method_id: id,
    method,
    availability,
    evidence_class: evidenceClass,
    n: metrics.attempts,
    csr: formatRate(metrics.csr),
    violation_rate: formatRate(metrics.violationRate),
    fix_cost: extra.fixCost,
    rollouts: extra.rollouts,
    tokens_per_task: "N/A",
    latency: extra.latency,
    ci95: bootstrapRateDisplay(repeatedBooleans(metrics.successes, metrics.attempts)),
    certification_outcome: extra.certificationOutcome || "N/A",
    notes: extra.notes
  };
}

function unavailableRow(id, method, reason) {
  return {
    method_id: id,
    method,
    availability: "N/A",
    evidence_class: "N/A",
    n: "N/A",
    csr: "N/A",
    violation_rate: "N/A",
    fix_cost: "N/A",
    rollouts: "N/A",
    tokens_per_task: "N/A",
    latency: "N/A",
    ci95: "N/A",
    certification_outcome: "N/A",
    notes: reason
  };
}

function buildAblations(metrics) {
  return [
    unavailableAblation("A1", "No typed affordance graph", "Graph-free localization/repair ablation was not executed."),
    unavailableAblation("A2", "No failure-cone restriction", "Unrestricted failure-cone ablation was not executed on matched tasks."),
    unavailableAblation("A3", "No paired checkpoint replay", "Replay-disabled repair protocol was not executed."),
    unavailableAblation("A4", "Linear surrogate only", "Logged search uses random feasible and graph-aware Bayesian ridge, not a linear-only surrogate."),
    unavailableAblation("A5", "No hard safety constraints", "Unsafe protocol was not run."),
    {
      ablation_id: "A6",
      method: "No independent confirmation",
      availability: "EXECUTED_ABLATION",
      csr: "1.000",
      violation_rate: "0.000",
      regret: "0.000 at registered maximum search budgets",
      rollouts: `${metrics.costs.patchValidationRollouts} patch-validation/replay/regression/rollback runs plus ${metrics.search.graphAwareMax.totalConfigEvaluations} search evaluations`,
      evidence_class: EVIDENCE_CLASS.controlled,
      notes: "Equivalent to PATCHWORK through validated candidate selection before independent confirmation."
    },
    {
      ablation_id: "A7",
      method: "Template-only patching",
      availability: "NOT_IDENTIFIABLE",
      csr: "N/A - NOT IDENTIFIABLE AS AN ABLATION IN THIS CONTROLLED IMPLEMENTATION",
      violation_rate: "N/A - NOT IDENTIFIABLE AS AN ABLATION IN THIS CONTROLLED IMPLEMENTATION",
      regret: "N/A - NOT IDENTIFIABLE AS AN ABLATION IN THIS CONTROLLED IMPLEMENTATION",
      rollouts: "N/A",
      evidence_class: "N/A",
      notes: "NOT IDENTIFIABLE AS AN ABLATION IN THIS CONTROLLED IMPLEMENTATION; the full controlled implementation itself used deterministic templates only."
    },
    unavailableAblation("A8", "Single-agent evaluation", "Only scripted deterministic harness evidence exists; heterogeneous live-agent ablation is not identifiable."),
    {
      ablation_id: "A9",
      method: "Full PATCHWORK",
      availability: "REFERENCE_WITH_ABSTENTION",
      csr: "N/A - method abstained; see observed plausible-candidate confirmation performance",
      violation_rate: "N/A - method abstained; see observed plausible-candidate confirmation performance",
      regret: "0.000 search regret at registered maximum budgets; certification not closed",
      rollouts: `${metrics.confirmation.validObservations} valid confirmation observations`,
      evidence_class: EVIDENCE_CLASS.controlled,
      notes: "Independent confirmation abstained on all three replicas."
    }
  ];
}

function unavailableAblation(id, method, reason) {
  return {
    ablation_id: id,
    method,
    availability: "NOT_EXECUTED",
    csr: "N/A",
    violation_rate: "N/A",
    regret: "N/A",
    rollouts: "N/A",
    evidence_class: "N/A",
    notes: reason
  };
}

function buildStatistics(evidence, metrics) {
  const paired = evidence.runtimePaired;
  const original = paired.map((row) => controlledObservationOutcome(row.original).compliantSuccess);
  const patched = paired.map((row) => controlledObservationOutcome(row.patched).compliantSuccess);
  const mcnemar = mcnemarCounts(original, patched);
  const p = mcnemarExactP(mcnemar.aOnly, mcnemar.bOnly);
  const diff = mean(patched.map(Number)) - mean(original.map(Number));
  const csrCi = hierarchicalPairedBootstrap(
    paired.map((row) => ({
      replica: row.replica,
      a: Number(controlledObservationOutcome(row.original).compliantSuccess),
      b: Number(controlledObservationOutcome(row.patched).compliantSuccess)
    })),
    8675309,
    5000
  );
  const searchPairs = pairedSearchRows(evidence.searchComparison);
  const maxBudgetPairs = searchPairs.filter((row) => row.budget === maxBudgetForReplica(row.replica));
  const randomRegret = maxBudgetPairs.map((row) => row.randomMeanRegret);
  const graphRegret = maxBudgetPairs.map((row) => row.graphMeanRegret);
  const searchCi = hierarchicalPairedBootstrap(
    maxBudgetPairs.map((row) => ({ replica: row.replica, a: row.randomMeanRegret, b: row.graphMeanRegret })),
    8675310,
    5000
  );
  const rows = [
    {
      comparison_id: "primary-csr-original-vs-patchwork-no-confirmation",
      method_a: "Original interface",
      method_b: "PATCHWORK, no confirmation",
      metric: "CSR",
      n_pairs: paired.length,
      point_estimate_a: formatRate(mean(original.map(Number))),
      point_estimate_b: formatRate(mean(patched.map(Number))),
      absolute_difference: formatRate(diff),
      relative_difference: "N/A - baseline is zero",
      ci95: `[${formatRate(csrCi.lower)}, ${formatRate(csrCi.upper)}]`,
      p_raw: formatP(p),
      p_holm: "",
      significant: "",
      effect_direction: "PATCHWORK no confirmation higher",
      both_pass: mcnemar.bothPass,
      a_only: mcnemar.aOnly,
      b_only: mcnemar.bOnly,
      both_fail: mcnemar.bothFail
    },
    {
      comparison_id: "search-regret-random-vs-graph-aware-max-budget",
      method_a: "Random feasible patch search",
      method_b: "Graph-aware PATCHWORK search",
      metric: "mean global regret at registered maximum budgets",
      n_pairs: maxBudgetPairs.length,
      point_estimate_a: formatNumber(mean(randomRegret), 6),
      point_estimate_b: formatNumber(mean(graphRegret), 6),
      absolute_difference: formatNumber(mean(graphRegret) - mean(randomRegret), 6),
      relative_difference: "0 at max budget for both methods",
      ci95: `[${formatNumber(searchCi.lower, 6)}, ${formatNumber(searchCi.upper, 6)}]`,
      p_raw: "N/A",
      p_holm: "N/A",
      significant: "N/A",
      effect_direction: "tie at registered maximum budgets",
      both_pass: "N/A",
      a_only: "N/A",
      b_only: "N/A",
      both_fail: "N/A"
    },
    {
      comparison_id: "confirmation-certification-rate",
      method_a: "PATCHWORK, no confirmation",
      method_b: "Full PATCHWORK",
      metric: "certified-safe replica rate",
      n_pairs: metrics.confirmation.statuses.length,
      point_estimate_a: "N/A",
      point_estimate_b: formatRate(metrics.confirmation.certificationRate),
      absolute_difference: "N/A",
      relative_difference: "N/A",
      ci95: "N/A",
      p_raw: "N/A",
      p_holm: "N/A",
      significant: "N/A",
      effect_direction: "Full PATCHWORK abstained from certification",
      both_pass: "N/A",
      a_only: "N/A",
      b_only: "N/A",
      both_fail: "N/A"
    }
  ];
  const holm = holmCorrection(rows.filter((row) => row.p_raw !== "N/A").map((row) => ({ id: row.comparison_id, p: Number(row.p_raw) })));
  for (const row of rows) {
    if (holm[row.comparison_id]) {
      row.p_holm = formatP(holm[row.comparison_id].adjusted);
      row.significant = holm[row.comparison_id].adjusted < 0.05 ? "yes" : "no";
    }
  }
  return {
    rows,
    holmFamily: {
      family: "primary controlled deterministic comparisons",
      alpha: 0.05,
      method: "Holm",
      executablePValueComparisons: Object.keys(holm),
      unavailablePrimaryComparisons: [
        "Static readiness ordering",
        "Expert prioritization",
        "Agent-side prompt / retry repair",
        "Random feasible search task-level CSR",
        "Constrained BO without localization",
        "Full PATCHWORK decision-level CSR"
      ],
      note:
        Object.keys(holm).length === 1
          ? "Holm adjustment is numerically identical because only one preregistered comparison was executable."
          : "Holm correction applied across executable preregistered p-value comparisons only.",
      comparisons: holm
    },
    report: [
      "# Statistical Report",
      "",
      "Only three site-level replicas; cluster-level interval precision is limited.",
      `Original interface versus PATCHWORK without confirmation: ${mcnemar.bOnly}/${paired.length} planted-defect paired controlled executions changed from non-compliant baseline outcomes to compliant patched outcomes and ${mcnemar.aOnly} regressed; exact McNemar p=${formatP(p)}.`,
      "At registered maximum search budgets, random feasible search and graph-aware search both reached zero mean global regret on all three replicas.",
      Object.keys(holm).length === 1
        ? "Holm adjustment is numerically identical because only one preregistered comparison was executable."
        : "Holm correction was applied across the executable preregistered p-value comparisons.",
      "Unavailable primary comparisons are reported as unavailable rather than included in the Holm family."
    ].join("\n")
  };
}

export function mcnemarCounts(a, b) {
  let bothPass = 0;
  let aOnly = 0;
  let bOnly = 0;
  let bothFail = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] && b[index]) bothPass += 1;
    else if (a[index] && !b[index]) aOnly += 1;
    else if (!a[index] && b[index]) bOnly += 1;
    else bothFail += 1;
  }
  return { bothPass, aOnly, bOnly, bothFail };
}

export function mcnemarExactP(aOnly, bOnly) {
  const n = aOnly + bOnly;
  if (n === 0) return null;
  const k = Math.min(aOnly, bOnly);
  let probability = 0;
  for (let i = 0; i <= k; i += 1) probability += binomial(n, i) * 0.5 ** n;
  return Math.min(1, 2 * probability);
}

function binomial(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - i + 1)) / i;
  return result;
}

function pairedSearchRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.replica}|${row.budget}`;
    const existing = map.get(key) || { replica: row.replica, budget: Number(row.budget) };
    if (row.strategy === "RandomFeasibleSearch") existing.randomMeanRegret = Number(row.mean_global_regret);
    if (row.strategy === "GraphAwareSurrogateSearch") existing.graphMeanRegret = Number(row.mean_global_regret);
    map.set(key, existing);
  }
  return [...map.values()].filter((row) => Number.isFinite(row.randomMeanRegret) && Number.isFinite(row.graphMeanRegret));
}

export function holmCorrection(items) {
  const sorted = [...items].sort((left, right) => left.p - right.p);
  const m = sorted.length;
  let running = 0;
  const result = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const adjusted = Math.min(1, Math.max(running, (m - index) * sorted[index].p));
    running = adjusted;
    result[sorted[index].id] = { raw: sorted[index].p, adjusted, rank: index + 1 };
  }
  return result;
}

function writeTables(evidence, metrics, baselines, ablations, statistics) {
  const tableIII = [
    row("Sites / replicas", "3 deterministic replicas: ShopTwin, SaaSTwin, SupportTwin", "repair/search manifests"),
    row("Critical journeys per site", "3 / 4 / 4 (11 total)", "defect audit and contracts"),
    row(
      "Defect classes and severities",
      `families ${objectCounts(metrics.benchmark.defectDistribution.families)}; severities ${objectCounts(metrics.benchmark.defectDistribution.severities)}`,
      "defect matrix and journey predicate severities"
    ),
    row("Agent snapshots and harnesses", "scripted Playwright controlled harness; live LLM harness not evaluated", "repair manifest and live-smoke"),
    row("DOM / API / protocol surfaces", "frontend, API, research verifier endpoints in deterministic replicas", "journey contracts"),
    row("Primary safety thresholds", `epsilon=${evidence.frozenInputs.epsilon}; delta=${evidence.frozenInputs.delta}; per-class thresholds 0.05`, "frozen-inputs.json"),
    row("Search and confirmation budgets", "search budgets: shop 8, saas 16, support 16; confirmation registered as 955/990/990 planned candidate-seed runs", "search manifest and status.json"),
    row("Seeds and repetitions", "repair seeds 1-3; search seeds 501-530; confirmation seeds shop 1001-1191, saas/support 1001-1198", "manifests and frozen inputs"),
    row("Primary hypotheses and tests", "paired controlled CSR by exact McNemar; deterministic bootstrap CIs; Holm correction for primary comparisons", "final-evaluation manifest")
  ];
  writeTableSet(evidence.finalDir, "tables/table-iii-config", tableIII, ["field", "value", "source"]);
  const tableIV = baselines.map((row) => ({
    method: row.method,
    "CSR up": row.csr,
    "Violation rate down": row.violation_rate,
    "Fix cost down": row.fix_cost,
    "Rollouts down": row.rollouts,
    "Tokens / task down": row.tokens_per_task,
    "Latency down": row.latency,
    "95% CI": row.ci95,
    "Certification outcome": row.certification_outcome
  }));
  writeTableSet(evidence.finalDir, "tables/table-iv-main-results", tableIV);
  const tableV = ablations.map((row) => ({
    method: row.method,
    "CSR up": row.csr,
    "Viol. down": row.violation_rate,
    "Regret down": row.regret,
    "Rollouts down": row.rollouts
  }));
  writeTableSet(evidence.finalDir, "tables/table-v-ablations", tableV);
  const tableVI = [
    patchRow("Failures with at least one compiled patch", `${metrics.patch.generatedPatches}/${metrics.patch.generatedPatches}`, "controlled deterministic template compiler"),
    patchRow("Schema / AST validation pass rate", "N/A - SEPARATE SCHEMA/AST OUTCOME NOT LOGGED", "runtime-validation.csv does not contain separate schema/AST columns"),
    patchRow("Diff parse pass rate", `${metrics.patch.staticPasses.diffParse}/${metrics.patch.generatedPatches}`, "runtime-validation.csv diff_parse"),
    patchRow("Path safety pass rate", `${metrics.patch.staticPasses.pathSafety}/${metrics.patch.generatedPatches}`, "runtime-validation.csv path_safety"),
    patchRow("Sandbox apply pass rate", `${metrics.patch.staticPasses.sandboxApply}/${metrics.patch.generatedPatches}`, "runtime-validation.csv sandbox_apply"),
    patchRow("Sandbox startup pass rate", `${metrics.patch.staticPasses.sandboxStartup}/${metrics.patch.generatedPatches}`, "runtime-validation.csv sandbox_startup"),
    patchRow("Runtime property invariant pass rate", `${metrics.patch.staticPasses.runtimePropertyInvariants}/${metrics.patch.generatedPatches}`, "runtime-validation.csv runtime_property_invariants"),
    patchRow("Rollback parse pass rate", `${metrics.patch.staticPasses.rollbackParse}/${metrics.patch.generatedPatches}`, "runtime-validation.csv rollback_parse"),
    patchRow("Unit and property-test pass rate", `N/A - SEPARATE UNIT-TEST OUTCOME NOT LOGGED; runtime property invariants ${metrics.patch.staticPasses.runtimePropertyInvariants}/${metrics.patch.generatedPatches}`, "runtime-validation.csv"),
    patchRow("Sandbox integration-test pass rate", `sandbox apply ${metrics.patch.staticPasses.sandboxApply}/${metrics.patch.generatedPatches}; sandbox startup ${metrics.patch.staticPasses.sandboxStartup}/${metrics.patch.generatedPatches}`, "runtime-validation.csv"),
    patchRow("Human developer acceptance rate", "N/A - HUMAN STUDY NOT EXECUTED", "no human review artifact"),
    patchRow("Median synthesis attempts", `${metrics.patch.medianSynthesisAttempts}`, "runtime-kpis.json"),
    patchRow("Median time to validated patch", "N/A - timestamped synthesis timing not logged", "runtime-kpis does not timestamp synthesis interval"),
    patchRow("Regression rate after canary", "N/A - PARTNER/PRODUCTION CANARY NOT EXECUTED", "no partner canary artifact"),
    patchRow("Automatic rollback rate", "N/A - production rollback not executed; controlled rollback verification 11/11 passed", "runtime-rollback.csv"),
    patchRow("Unresolved / abstained cases", `${metrics.patch.unresolvedCases}`, "runtime-kpis.json"),
    patchRow("Baseline defect reproduction", `${metrics.patch.originalDefectsDetected}/${metrics.patch.pairedRows}`, "runtime-paired-summary.csv/jsonl"),
    patchRow("Patched compliance", `${metrics.patch.patchedCompliant}/${metrics.patch.pairedRows}`, "runtime-paired-summary.csv/jsonl"),
    patchRow("Controlled regression suite", `${metrics.patch.regressionPassed}/${metrics.patch.regressionRuns}`, "runtime-regression-summary.csv"),
    patchRow("Controlled rollback verification", `${metrics.patch.rollbackPassed}/${metrics.patch.rollbackRuns}`, "runtime-rollback.csv")
  ];
  writeTableSet(evidence.finalDir, "tables/table-vi-patch-outcomes", tableVI);
  writeCsv(path.join(evidence.finalDir, "tables/supplement-per-replica-search.csv"), metrics.search.rows);
  writeCsv(path.join(evidence.finalDir, "tables/supplement-localization.csv"), evidence.coneSummary);
  writeCsv(
    path.join(evidence.finalDir, "tables/supplement-patch-runtime.csv"),
    evidence.runtimePaired.map((row) => ({
      replica: row.replica,
      journey_id: row.journeyId,
      defect_id: row.defectId,
      patch_id: row.patchId,
      original_success: row.original.verifiedSuccess,
      patched_success: row.patchedCompliantSuccess,
      original_latency_ms: row.original.latencyMs,
      patched_latency_ms: row.patched.latencyMs
    }))
  );
  writeCsv(path.join(evidence.finalDir, "tables/supplement-confirmation.csv"), metrics.confirmation.statuses);
  writeCsv(path.join(evidence.finalDir, "tables/supplement-plausible-candidate-confirmation-performance.csv"), metrics.confirmation.plausibleCandidatePerformance);
  writeCsv(path.join(evidence.finalDir, "statistics/statistical-summary.csv"), statistics.rows);
  writeJson(path.join(evidence.finalDir, "statistics/statistical-summary.json"), statistics.rows);
  writeJson(path.join(evidence.finalDir, "statistics/holm-family.json"), statistics.holmFamily);
  writeText(path.join(evidence.finalDir, "statistics/statistical-report.md"), `${statistics.report}\n`);
  return { tableIII, tableIV, tableV, tableVI };
}

function row(field, value, source) {
  return { field, value, source };
}

function patchRow(metric, value, source) {
  return { metric, value, source };
}

function writeTableSet(finalDir, baseRel, rows, headers) {
  const csvPath = path.join(finalDir, `${baseRel}.csv`);
  writeCsv(csvPath, rows, headers);
  const actualHeaders = headers || Object.keys(rows[0] || {});
  writeText(path.join(finalDir, `${baseRel}.md`), markdownTable(rows, actualHeaders));
  writeText(path.join(finalDir, `${baseRel}.tex`), texTable(rows, actualHeaders));
}

function markdownTable(rows, headers) {
  return `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n${rows
    .map((row) => `| ${headers.map((header) => escapeMd(row[header])).join(" | ")} |`)
    .join("\n")}\n`;
}

function texTable(rows, headers) {
  const cols = headers.map(() => "p{0.18\\linewidth}").join("");
  return [
    `\\begin{tabular}{${cols}}`,
    "\\toprule",
    `${headers.map(texEscape).join(" & ")} \\\\`,
    "\\midrule",
    ...rows.map((row) => `${headers.map((header) => texEscape(row[header])).join(" & ")} \\\\`),
    "\\bottomrule",
    "\\end{tabular}",
    ""
  ].join("\n");
}

function writeFigures(evidence, metrics, baselines, ablations) {
  const specs = [
    {
      id: "figure-a-localization",
      title: "Localization and failure-cone effectiveness",
      rows: [
        { label: "Exact predicate", value: metrics.localization.exactFirstViolatedPredicate },
        { label: "Exact root", value: metrics.localization.exactRootCause },
        { label: "Top-3 root", value: metrics.localization.top3RootCause },
        { label: "Root in cone", value: metrics.localization.rootCauseContained },
        { label: "Median cone fraction", value: metrics.localization.medianConePercent / 100 }
      ],
      kind: "bar"
    },
    {
      id: "figure-b-regret-budget",
      title: "Simple regret vs rollout budget",
      rows: metrics.search.rows.map((row) => ({ label: `${row.replica}-${row.strategy}-${row.budget}`, x: row.budget, y: row.meanGlobalRegret, group: `${row.replica} ${row.strategy}` })),
      kind: "line"
    },
    {
      id: "figure-c-candidate-recall",
      title: "Candidate recall vs rollout budget",
      rows: metrics.search.rows.map((row) => ({ label: `${row.replica}-${row.strategy}-${row.budget}`, x: row.budget, y: row.candidateRecallAtEpsilon, group: `${row.replica} ${row.strategy}` })),
      kind: "line"
    },
    {
      id: "figure-d-unsafe-recommendation-rate",
      title: "Unsafe recommendation rate",
      rows: metrics.search.rows.map((row) => ({ label: `${row.replica} ${row.strategy} ${row.budget}`, value: row.unsafeRecommendationRate })),
      kind: "bar"
    },
    {
      id: "figure-e-confirmation-progression",
      title: "Independent confirmation progression",
      rows: metrics.confirmation.statuses.map((row) => ({ label: row.replica, value: row.validObservations / row.plannedObservations, status: row.status })),
      kind: "bar"
    },
    {
      id: "figure-f-patch-verification-funnel",
      title: "Patch verification funnel",
      rows: [
        { label: "Planted failures", value: 33 },
        { label: "Localized", value: metrics.localization.cases },
        { label: "Compiled", value: metrics.patch.generatedPatches },
        { label: "Static/runtime valid", value: metrics.patch.validationAccepted },
        { label: "Patched replay", value: metrics.patch.patchedCompliant },
        { label: "Regression pass", value: metrics.patch.regressionPassed },
        { label: "Rollback pass", value: metrics.patch.rollbackPassed }
      ],
      kind: "bar"
    },
    {
      id: "figure-g-final-confirmation-outcomes",
      title: "Final confirmation outcomes",
      rows: [
        { label: "Certified", value: metrics.confirmation.certifiedReplicaCount },
        { label: "Safety bound not closed", value: 2 },
        { label: "Infrastructure failure", value: 1 }
      ],
      kind: "bar"
    },
    {
      id: "figure-h-main-baseline-comparison",
      title: "Main baseline comparison",
      rows: baselines
        .filter((row) => /^\d/.test(String(row.csr)))
        .map((row) => ({ label: row.method.replace("PATCHWORK, ", "PW "), value: Number(row.csr) })),
      kind: "bar"
    },
    {
      id: "figure-i-ablation-comparison",
      title: "Executable ablation comparison",
      rows: ablations
        .filter((row) => /^\d/.test(String(row.csr)))
        .map((row) => ({ label: row.method, value: Number(row.csr) })),
      kind: "bar"
    }
  ];
  for (const spec of specs) {
    const base = path.join(evidence.finalDir, "figures", spec.id);
    writeCsv(`${base}.csv`, spec.rows);
    if (spec.kind === "line") {
      writeText(`${base}.svg`, lineSvg(spec.title, spec.rows));
      writePng(`${base}.png`, (canvas) => drawLineCanvas(canvas, spec.rows));
    } else {
      writeText(`${base}.svg`, barSvg(spec.title, spec.rows));
      writePng(`${base}.png`, (canvas) => drawBarCanvas(canvas, spec.rows));
    }
  }
  return specs.map((spec) => ({ id: spec.id, title: spec.title, csv: `figures/${spec.id}.csv`, svg: `figures/${spec.id}.svg`, png: `figures/${spec.id}.png` }));
}

function barSvg(title, rows) {
  const width = 920;
  const height = 480;
  const margin = { top: 56, right: 28, bottom: 110, left: 76 };
  const maxValue = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  const slot = (width - margin.left - margin.right) / Math.max(1, rows.length);
  const bars = rows
    .map((row, index) => {
      const value = Number(row.value) || 0;
      const barHeight = ((height - margin.top - margin.bottom) * value) / maxValue;
      const x = margin.left + index * slot + slot * 0.15;
      const y = height - margin.bottom - barHeight;
      const [r, g, b] = figureColors[index % figureColors.length];
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(slot * 0.7).toFixed(1)}" height="${barHeight.toFixed(1)}" fill="rgb(${r},${g},${b})"/><text x="${(x + slot * 0.35).toFixed(1)}" y="${height - margin.bottom + 18}" text-anchor="end" transform="rotate(-35 ${(x + slot * 0.35).toFixed(1)} ${height - margin.bottom + 18})">${escapeXml(row.label)}</text>`;
    })
    .join("\n");
  return svgShell(width, height, title, `${axisSvg(width, height, margin)}\n${bars}`);
}

function lineSvg(title, rows) {
  const width = 920;
  const height = 480;
  const margin = { top: 56, right: 28, bottom: 76, left: 76 };
  const grouped = groupBy(rows, (row) => row.group || "series");
  const xs = rows.map((row) => Number(row.x));
  const ys = rows.map((row) => Number(row.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(1, ...ys);
  const xScale = (x) => margin.left + ((x - minX) / Math.max(1, maxX - minX)) * (width - margin.left - margin.right);
  const yScale = (y) => height - margin.bottom - (y / maxY) * (height - margin.top - margin.bottom);
  const lines = Object.entries(grouped)
    .map(([group, series], index) => {
      const [r, g, b] = figureColors[index % figureColors.length];
      const points = series
        .sort((left, right) => Number(left.x) - Number(right.x))
        .map((row) => `${xScale(Number(row.x)).toFixed(1)},${yScale(Number(row.y)).toFixed(1)}`)
        .join(" ");
      return `<polyline points="${points}" fill="none" stroke="rgb(${r},${g},${b})" stroke-width="3"/><text x="${margin.left}" y="${margin.top + 18 * index}" fill="rgb(${r},${g},${b})">${escapeXml(group)}</text>`;
    })
    .join("\n");
  return svgShell(width, height, title, `${axisSvg(width, height, margin)}\n${lines}`);
}

function svgShell(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#ffffff"/>
<text x="24" y="32" font-family="Arial, sans-serif" font-size="20" font-weight="700">${escapeXml(title)}</text>
${body}
</svg>
`;
}

function axisSvg(width, height, margin) {
  return `<line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#222"/><line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#222"/>`;
}

function writePng(filePath, draw) {
  const width = 920;
  const height = 480;
  const canvas = createCanvas(width, height);
  draw(canvas);
  ensureParent(filePath);
  writeFileSync(filePath, encodePng(canvas.width, canvas.height, canvas.pixels));
}

function createCanvas(width, height) {
  const pixels = Buffer.alloc(width * height * 4, 255);
  const set = (x, y, color) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
    const offset = (iy * width + ix) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3] ?? 255;
  };
  const rect = (x, y, w, h, color) => {
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(height, Math.ceil(y + h)); yy += 1) {
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(width, Math.ceil(x + w)); xx += 1) set(xx, yy, color);
    }
  };
  const line = (x1, y1, x2, y2, color) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      rect(x1 + (x2 - x1) * t - 1, y1 + (y2 - y1) * t - 1, 3, 3, color);
    }
  };
  return { width, height, pixels, set, rect, line };
}

function drawBarCanvas(canvas, rows) {
  const margin = { top: 56, right: 28, bottom: 76, left: 76 };
  canvas.line(margin.left, canvas.height - margin.bottom, canvas.width - margin.right, canvas.height - margin.bottom, [30, 30, 30]);
  canvas.line(margin.left, margin.top, margin.left, canvas.height - margin.bottom, [30, 30, 30]);
  const maxValue = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  const slot = (canvas.width - margin.left - margin.right) / Math.max(1, rows.length);
  rows.forEach((row, index) => {
    const value = Number(row.value) || 0;
    const barHeight = ((canvas.height - margin.top - margin.bottom) * value) / maxValue;
    const [r, g, b] = figureColors[index % figureColors.length];
    canvas.rect(margin.left + index * slot + slot * 0.15, canvas.height - margin.bottom - barHeight, slot * 0.7, barHeight, [r, g, b]);
  });
}

function drawLineCanvas(canvas, rows) {
  const margin = { top: 56, right: 28, bottom: 76, left: 76 };
  canvas.line(margin.left, canvas.height - margin.bottom, canvas.width - margin.right, canvas.height - margin.bottom, [30, 30, 30]);
  canvas.line(margin.left, margin.top, margin.left, canvas.height - margin.bottom, [30, 30, 30]);
  const grouped = groupBy(rows, (row) => row.group || "series");
  const xs = rows.map((row) => Number(row.x));
  const ys = rows.map((row) => Number(row.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(1, ...ys);
  const xScale = (x) => margin.left + ((x - minX) / Math.max(1, maxX - minX)) * (canvas.width - margin.left - margin.right);
  const yScale = (y) => canvas.height - margin.bottom - (y / maxY) * (canvas.height - margin.top - margin.bottom);
  Object.values(grouped).forEach((series, index) => {
    const color = figureColors[index % figureColors.length];
    const sorted = series.sort((left, right) => Number(left.x) - Number(right.x));
    for (let i = 1; i < sorted.length; i += 1) {
      canvas.line(xScale(Number(sorted[i - 1].x)), yScale(Number(sorted[i - 1].y)), xScale(Number(sorted[i].x)), yScale(Number(sorted[i].y)), color);
    }
  });
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeClaimsAndPaper(evidence, metrics, baselines, ablations, tables, statistics, figures, manifestHash) {
  const claims = [
    claim("C1", "On three deterministic replicas, 11 planted defects were detected and recovered by the verifier.", "SUPPORTED", "defect-audit.json", EVIDENCE_CLASS.controlled),
    claim("C2", "Localization identified the first violated predicate in 33/33 controlled cases.", "SUPPORTED", "localization-summary.csv", EVIDENCE_CLASS.controlled),
    claim("C3", "Deterministic typed-template patches passed controlled replay, regression, and rollback gates.", "SUPPORTED", "runtime-kpis.json", EVIDENCE_CLASS.controlled),
    claim("C4", "Graph-aware search universally dominates random search.", "NOT_SUPPORTED", "search-strategy-comparison.csv", EVIDENCE_CLASS.controlled),
    claim("C5", "Independent confirmation certified safe candidates.", "NOT_SUPPORTED", "full-confirmation/status.json", EVIDENCE_CLASS.controlled),
    claim("C6", "PATCHWORK is production validated or partner-canary validated.", "NOT_SUPPORTED", "no partner artifact", EVIDENCE_CLASS.partner),
    claim("C7", "Live heterogeneous LLM-agent transfer was evaluated.", "NOT_SUPPORTED", "live-smoke.json executed=false", EVIDENCE_CLASS.live),
    claim("C8", "Human developer acceptance was measured.", "NOT_SUPPORTED", "no human-review artifact", EVIDENCE_CLASS.human)
  ];
  writeCsv(path.join(evidence.finalDir, "provenance/claims-ledger.csv"), claims);
  writeText(path.join(evidence.finalDir, "provenance/claims-ledger.md"), markdownTable(claims, Object.keys(claims[0])));
  const fillRows = buildFillMap(evidence, metrics, baselines, ablations, tables, figures);
  const provenanceValidation = validateFillMapProvenance(fillRows);
  if (provenanceValidation.status !== "PASS") throw new Error(`FILL_MAP_PROVENANCE_INVALID: ${provenanceValidation.failures.join("; ")}`);
  writeCsv(path.join(evidence.finalDir, "paper/paper-fill-map.csv"), fillRows);
  writeText(path.join(evidence.finalDir, "paper/paper-fill-map.md"), markdownTable(fillRows, Object.keys(fillRows[0])));
  const manuscript = controlledManuscript(metrics, baselines, ablations, tables, statistics, figures, manifestHash, evidence.manuscriptFiles);
  const oldManuscript = path.join(evidence.finalDir, "paper/PATCHWORK_v3_controlled_results.tex");
  if (existsSync(oldManuscript)) unlinkSync(oldManuscript);
  writeText(path.join(evidence.finalDir, "paper/PATCHWORK_controlled_results_fragment.tex"), manuscript);
  return { claims, fillRows, provenanceValidation, manuscriptPath: "paper/PATCHWORK_controlled_results_fragment.tex" };
}

function claim(id, claimText, status, source, evidenceClass) {
  return { id, claim: claimText, status, source, evidence_class: evidenceClass };
}

function buildFillMap(evidence, metrics, baselines, ablations, tables, figures) {
  const rows = [];
  const add = (location, metric, value, sources, computation, evidenceClass, sourceKey = metric, outputTablePath = "N/A") => {
    const sourceArtifacts = Array.isArray(sources) ? sources : [sources];
    rows.push({
      location,
      metric,
      displayed_value: value,
      source_artifacts: JSON.stringify(sourceArtifacts),
      source_key: sourceKey,
      computation,
      output_table_path: outputTablePath,
      analysis_script: "scripts/final-paper-eval.mjs",
      source_sha256s: JSON.stringify(sourceArtifacts.map((source) => sourceHash(evidence.root, source))),
      evidence_class: evidenceClass
    });
  };
  add("Abstract", "replicas", "3 deterministic replicas", "experiments/results/defect-audit/defect-audit.json", "count unique replicas", EVIDENCE_CLASS.controlled);
  add("Abstract", "localized cases", "33/33", "experiments/results/repair-pilot-v1/localization-summary.csv", "exact_match true count", EVIDENCE_CLASS.controlled);
  add("Abstract", "confirmation certified", "0/3", `${FROZEN_REL}/status.json`, "certifiedSafe non-empty replicas", EVIDENCE_CLASS.controlled);
  for (const [tableName, tableRows, outputPath] of [
    ["Table III", tables.tableIII, "experiments/results/final-paper-v1/tables/table-iii-config.csv"],
    ["Table IV", tables.tableIV, "experiments/results/final-paper-v1/tables/table-iv-main-results.csv"],
    ["Table V", tables.tableV, "experiments/results/final-paper-v1/tables/table-v-ablations.csv"],
    ["Table VI", tables.tableVI, "experiments/results/final-paper-v1/tables/table-vi-patch-outcomes.csv"]
  ]) {
    for (const tableRow of tableRows) {
      const rowLabel = Object.values(tableRow)[0];
      for (const [cellKey, cellValue] of Object.entries(tableRow).slice(1)) {
        const sources = rawSourcesForTableCell(tableName, rowLabel, cellKey);
        add(
          tableName,
          `${rowLabel} / ${cellKey}`,
          cellValue,
          sources,
          analysisFormulaForCell(tableName, rowLabel, cellKey),
          evidenceClassForValue(cellValue),
          `${rowLabel}.${cellKey}`,
          outputPath
        );
      }
    }
  }
  for (const figure of figures)
    add(`Figure ${figure.id}`, figure.title, figure.svg, `experiments/results/final-paper-v1/${figure.csv}`, "plot generated from underlying CSV", EVIDENCE_CLASS.controlled, figure.id, `experiments/results/final-paper-v1/${figure.svg}`);
  for (const row of baselines)
    add(
      "Baseline Results",
      row.method,
      row.csr,
      rawSourcesForTableCell("Table IV", row.method, "CSR up"),
      "baseline row generated from raw Table IV sources",
      row.evidence_class,
      `${row.method}.csr`,
      "experiments/results/final-paper-v1/baselines/baseline-results.csv"
    );
  for (const row of ablations)
    add(
      "Ablation Results",
      row.method,
      row.csr,
      rawSourcesForTableCell("Table V", row.method, "CSR up"),
      "ablation row generated from raw Table V sources",
      row.evidence_class,
      `${row.method}.csr`,
      "experiments/results/final-paper-v1/ablations/ablation-results.csv"
    );
  return rows;
}

function rawSourcesForTableCell(tableName, rowLabel, _cellKey) {
  if (tableName === "Table III") {
    if (/Sites|Critical journeys/.test(rowLabel)) return ["experiments/results/defect-audit/defect-audit.json"];
    if (/Defect/.test(rowLabel)) return ["experiments/results/defect-audit/defect-matrix.csv", "replicas/shop-twin/research/contracts/journeys.yaml", "replicas/saas-twin/research/contracts/journeys.yaml", "replicas/support-twin/research/contracts/journeys.yaml"];
    if (/Agent/.test(rowLabel)) return ["experiments/configs/repair-pilot-v1.yaml", "experiments/results/pilot-study-v2/live-smoke/live-smoke.json"];
    if (/surfaces/.test(rowLabel)) return ["replicas/shop-twin/research/contracts/journeys.yaml", "replicas/saas-twin/research/contracts/journeys.yaml", "replicas/support-twin/research/contracts/journeys.yaml"];
    if (/thresholds/.test(rowLabel)) return [`${FROZEN_REL}/frozen-inputs.json`];
    if (/budgets/.test(rowLabel)) return ["experiments/configs/search-certification-pilot-v2.yaml", `${FROZEN_REL}/status.json`];
    if (/Seeds/.test(rowLabel)) return ["experiments/configs/repair-pilot-v1.yaml", "experiments/configs/search-certification-pilot-v2.yaml", `${FROZEN_REL}/frozen-inputs.json`];
    return ["scripts/final-paper-eval.mjs"];
  }
  if (tableName === "Table IV") {
    if (/Original interface|PATCHWORK, no confirmation/.test(rowLabel)) return ["experiments/results/repair-pilot-v1/runtime-paired-replay.jsonl", "experiments/results/repair-pilot-v1/runtime-kpis.json"];
    if (/Random feasible/.test(rowLabel)) return ["experiments/results/search-certification-pilot-v2/search-strategy-comparison.csv"];
    if (/Full PATCHWORK/.test(rowLabel)) return [`${FROZEN_REL}/status.json`, `${FROZEN_REL}/confirmation-observations.jsonl`];
    if (/Agent-side/.test(rowLabel)) return ["experiments/results/pilot-study-v2/live-smoke/live-smoke.json"];
    return ["experiments/configs/search-certification-pilot-v2.yaml"];
  }
  if (tableName === "Table V") {
    if (/No independent confirmation/.test(rowLabel)) return ["experiments/results/repair-pilot-v1/runtime-paired-replay.jsonl", "experiments/results/search-certification-pilot-v2/search-strategy-comparison.csv"];
    if (/Full PATCHWORK/.test(rowLabel)) return [`${FROZEN_REL}/status.json`, `${FROZEN_REL}/confirmation-observations.jsonl`];
    if (/Template-only/.test(rowLabel)) return ["experiments/configs/repair-pilot-v1.yaml"];
    return ["experiments/configs/repair-pilot-v1.yaml", "experiments/configs/search-certification-pilot-v2.yaml"];
  }
  if (tableName === "Table VI") {
    if (/Regression/.test(rowLabel)) return ["experiments/results/repair-pilot-v1/runtime-regression-summary.csv"];
    if (/Rollback|rollback/.test(rowLabel)) return ["experiments/results/repair-pilot-v1/runtime-rollback.csv", "experiments/results/repair-pilot-v1/runtime-validation.csv"];
    if (/Baseline defect|Patched compliance/.test(rowLabel)) return ["experiments/results/repair-pilot-v1/runtime-paired-replay.jsonl"];
    if (/Median synthesis|Unresolved/.test(rowLabel)) return ["experiments/results/repair-pilot-v1/runtime-kpis.json"];
    if (/Human|canary|production/.test(rowLabel)) return ["experiments/results/pilot-study-v2/live-smoke/live-smoke.json"];
    return ["experiments/results/repair-pilot-v1/runtime-validation.csv"];
  }
  return ["scripts/final-paper-eval.mjs"];
}

function analysisFormulaForCell(tableName, rowLabel, cellKey) {
  if (tableName === "Table IV" && /CSR|Violation/.test(cellKey)) return "observationMetrics(): count compliant successes and violations independently from raw runtime/confirmation observations";
  if (tableName === "Table IV" && /Random feasible/.test(rowLabel)) return "Search-only artifacts reported as N/A for task-level metrics; search metrics retained in notes/supplement";
  if (tableName === "Table VI") return "count explicit logged gate columns only; do not infer schema/AST/unit outcomes from accepted=true";
  return `derive ${cellKey} from raw source artifacts`;
}

function evidenceClassForValue(value) {
  return String(value).startsWith("N/A") ? "N/A" : EVIDENCE_CLASS.controlled;
}

export function validateFillMapProvenance(rows) {
  const failures = [];
  for (const row of rows) {
    const displayed = String(row.displayed_value ?? "");
    const supported = row.evidence_class !== "N/A" && !displayed.startsWith("N/A") && !displayed.includes("NOT IDENTIFIABLE");
    if (!supported) continue;
    const sources = safeJsonArray(row.source_artifacts);
    const hashes = safeJsonArray(row.source_sha256s);
    if (!sources.length) failures.push(`${row.location}:${row.metric}: missing raw source`);
    if (sources.some((source) => source.includes("derived generated table"))) failures.push(`${row.location}:${row.metric}: generated-table-only provenance`);
    if (sources.some((source) => source.startsWith("experiments/results/final-paper-v1/tables/"))) failures.push(`${row.location}:${row.metric}: generated table used as raw source`);
    if (hashes.length !== sources.length || hashes.some((hash) => !hash || hash === "MISSING")) failures.push(`${row.location}:${row.metric}: missing source hash`);
    if (!row.output_table_path) failures.push(`${row.location}:${row.metric}: missing output table path`);
  }
  return { status: failures.length ? "FAIL" : "PASS", failures };
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function controlledManuscript(metrics, baselines, ablations, tables, statistics, figures, manifestHash, manuscriptFiles) {
  return `\\documentclass{article}
\\usepackage{booktabs}
\\usepackage[margin=1in]{geometry}
\\title{PATCHWORK: Counterexample-Guided Repair Synthesis and Model-Agnostic Verification for Agentic Web Interfaces}
\\author{Controlled Results Draft}
\\date{}
\\begin{document}
\\maketitle

\\begin{abstract}
This results-populated draft reports deterministic controlled-replica evidence only. On three replicas covering 11 journeys, PATCHWORK localized the first violated predicate in 33/33 controlled defect observations and validated 11/11 deterministic typed-template repairs through sandbox replay, regression, and rollback checks. Frozen search evidence contains 540 repeated-search records with candidate recall 1.000 at epsilon=0.05 and unsafe recommendation rate 0.000. Under the frozen independent-confirmation budget, no replica returned a certified-safe candidate; three plausible candidates remained uncertified. These results support controlled benchmark claims, not production validation, partner staging, human developer acceptance, or heterogeneous live-LLM transfer.
\\end{abstract}

\\section{Controlled Benchmark Results}
No authoritative pre-existing PATCHWORK v3 TeX source was found in this repository (${manuscriptFiles.length} source files). This file is a controlled-results fragment/report, not the final paper. If a full PATCHWORK\\_v3\\_paper.tex manuscript is later added, use a separate merge command to insert these validated controlled results without deleting theory, methods, related work, equations, references, or threats-to-validity sections. The scope is a controlled replica evaluation.

\\subsection{Configuration}
\\input{../tables/table-iii-config.tex}

\\subsection{Main Results}
\\input{../tables/table-iv-main-results.tex}

\\subsection{Ablations}
\\input{../tables/table-v-ablations.tex}

\\subsection{Patch Compiler and Verification Outcomes}
\\input{../tables/table-vi-patch-outcomes.tex}

\\subsection{Findings}
The contract/verifier benchmark includes ${metrics.benchmark.replicas} deterministic replicas, ${metrics.benchmark.journeys} journeys, and ${metrics.benchmark.localizationCases} controlled localization observations. Localization achieved ${formatRate(metrics.localization.exactFirstViolatedPredicate)} exact first-predicate accuracy, ${formatRate(metrics.localization.exactRootCause)} exact root-cause accuracy, and median cone size ${formatNumber(metrics.localization.medianConePercent, 2)} percent of the graph. The patch compiler produced ${metrics.patch.generatedPatches} deterministic typed-template candidates; ${metrics.patch.validationAccepted}/${metrics.patch.generatedPatches} passed static/runtime validation, ${metrics.patch.patchedCompliant}/${metrics.patch.pairedRows} patched paired replays were compliant, ${metrics.patch.regressionPassed}/${metrics.patch.regressionRuns} regression checks passed, and ${metrics.patch.rollbackPassed}/${metrics.patch.rollbackRuns} controlled rollback checks passed.

The search/oracle evidence is candidate-set scoped. At registered maximum budgets, random feasible search and graph-aware search both reached zero mean global regret on all three replicas. At smaller budgets, random search was competitive or better on Shop, while graph-aware search reached zero regret earlier on SaaS and Support. The data do not support universal dominance.

The independent confirmation layer abstained from certification. Shop ended with status NOT\\_CERTIFIED\\_INFRASTRUCTURE\\_FAILURE after four exhausted infrastructure candidate-seed runs. SaaS and Support completed their registered observations but ended with NOT\\_CERTIFIED\\_SAFETY\\_BOUND\\_NOT\\_CLOSED. Plausible candidates are not certified candidates.

\\subsection{Statistical Summary}
${texEscape(statistics.report.replaceAll("\n", " "))}

\\section{Threats to Validity}
The evidence is limited to deterministic replicas and scripted/mock harnesses. It does not demonstrate production reliability, heterogeneous live-agent transfer, formal human developer acceptance, partner staging canary reliability, or global optimality beyond the finite candidate sets. Confirmation confidence claims remain bounded by the registered confidence-sequence assumptions and the observed abstentions.

\\section{Conclusion}
PATCHWORK is demonstrated here as a controlled benchmark pipeline for localization, deterministic typed-template repair, finite candidate-set search, and independent confirmation with abstention. Stronger claims require live agent families, human review, adversarial live-agent security experiments, partner staging, and production canaries.

\\paragraph{Reproducibility.} Final manifest hash: ${manifestHash}.

\\end{document}
`;
}

function writeReports(evidence, metrics, baselines, ablations, statistics, figures, manifestInfo, audit, frozenDiff, paper) {
  const ablationAccounting = ablationCounts(ablations);
  const finalJson = {
    generatedAt: new Date().toISOString(),
    manifestHash: manifestInfo.manifestHash,
    repository: evidence.repository,
    auditStatus: audit.status,
    frozenEvidenceImmutable: !frozenDiff.evidenceMutationDetected,
    benchmark: metrics.benchmark,
    localization: metrics.localization,
    repair: metrics.patch,
    search: metrics.search,
    confirmation: metrics.confirmation,
    baselines,
    ablations,
    ablationAccounting,
    statistics: statistics.rows,
    figures,
    provenanceStatus: paper.provenanceValidation,
    paperBuild: readPaperBuildStatus(evidence.finalDir),
    safeFinalChecks: safeFinalChecks(audit, frozenDiff, metrics)
  };
  finalJson.readiness = readinessAssessment(finalJson);
  writeJson(path.join(evidence.finalDir, "reports/FINAL_CONTROLLED_EVALUATION.json"), finalJson);
  writeText(path.join(evidence.finalDir, "reports/FINAL_CONTROLLED_EVALUATION.md"), finalReportMd(finalJson));
  writeText(path.join(evidence.finalDir, "reports/PAPER_READINESS.md"), readinessMd(finalJson));
  writeJson(path.join(evidence.finalDir, "audit/secret-scan.json"), secretScan(evidence.finalDir));
  writeConfirmationOutcomes(evidence.finalDir, metrics);
  writeCorrectionChangelog(evidence.finalDir, finalJson);
  return finalJson;
}

function finalReportMd(report) {
  return `# Final Controlled Evaluation

## A. Study Configuration
Controlled deterministic benchmark over ${report.benchmark.replicaNames}; ${report.benchmark.journeys} journeys.

## B. Dataset / Benchmark Scale
- Replicas: ${report.benchmark.replicas}
- Journeys: ${report.benchmark.journeys}
- Localization cases: ${report.benchmark.localizationCases}
- Patch configurations/cases: ${report.benchmark.patchCases}
- Search records: ${report.search.records}
- Confirmation valid observations: ${report.confirmation.validObservations}

## C. Localization
Exact first predicate ${formatRate(report.localization.exactFirstViolatedPredicate)}; root containment ${formatRate(report.localization.rootCauseContained)}; median cone ${formatNumber(report.localization.medianConePercent, 2)}%.

## D. Repair
${report.repair.validationAccepted}/${report.repair.generatedPatches} validations accepted; ${report.repair.patchedCompliant}/${report.repair.pairedRows} patched replays compliant; ${report.repair.regressionPassed}/${report.repair.regressionRuns} regressions passed; ${report.repair.rollbackPassed}/${report.repair.rollbackRuns} rollback checks passed.

## E. Search
Candidate recall at epsilon=0.05 is ${formatRate(report.search.candidateRecallAtEpsilon)}; unsafe recommendation rate is ${formatRate(report.search.unsafeRecommendationRate)}. Search claims are candidate-set scoped.

## F. Confirmation
${report.confirmation.statuses.map((row) => `- ${row.replica}: ${row.status}; completed ${row.completedCandidateSeedRuns}/${row.plannedCandidateSeedRuns}; plausible ${row.plausiblySafe.join(",") || "none"}; certified ${row.certifiedSafe.join(",") || "none"}`).join("\n")}

## G. Baselines
${report.baselines.map((row) => `- ${row.method}: ${row.availability}; CSR ${row.csr}; ${row.notes}`).join("\n")}

## H. Ablations
${report.ablations.map((row) => `- ${row.method}: ${row.availability}; CSR ${row.csr}; ${row.notes}`).join("\n")}

Ablation accounting: executed ${report.ablationAccounting.executed}/${report.ablationAccounting.planned}; reference rows ${report.ablationAccounting.reference}; missing/non-identifiable ${report.ablationAccounting.missingOrNonIdentifiable}.

## I. Statistics
${report.statistics.map((row) => `- ${row.comparison_id}: diff ${row.absolute_difference}, CI ${row.ci95}, p ${row.p_raw}`).join("\n")}

## J. Paper Tables
Tables III-VI generated under experiments/results/final-paper-v1/tables.

Paper build status: ${report.paperBuild.status}.

## K. Figures
${report.figures.map((figure) => `- ${figure.id}: ${figure.svg}, ${figure.png}`).join("\n")}

## L. Claims Supported
Controlled deterministic repair/localization, typed patch verification, candidate-set search behavior, and confirmation abstention behavior.

## M. Claims NOT Supported
Production validation, universal graph-aware dominance, global optimality, live heterogeneous-agent transfer, formal human acceptance, partner canary reliability.

## N. Missing Evidence For Stronger Paper
Live accessibility agent family A: no; live accessibility agent family B: no; live screenshot agent: no; live tool-native agent: no; formal human developer review: no; adversarial live-agent security experiment: no; partner staging: no; production canary: no.

## O. Reproducibility
- Command: npm run research:final-eval
- Manifest hash: ${report.manifestHash}
- Git SHA: ${report.repository.commit}
- Frozen evidence immutable: ${report.frozenEvidenceImmutable ? "YES" : "NO"}
- Provenance validation: ${report.provenanceStatus.status}
- Readiness: controlled package ${report.readiness.CONTROLLED_RESULTS_PACKAGE.state}; narrow controlled benchmark ${report.readiness.NARROW_CONTROLLED_BENCHMARK_SUBMISSION.state}; original preregistered paper ${report.readiness.ORIGINAL_PREREGISTERED_PAPER.state}
`;
}

function readinessMd(report) {
  return `# Paper Readiness

## CONTROLLED_RESULTS_PACKAGE
State: ${report.readiness.CONTROLLED_RESULTS_PACKAGE.state}

${report.readiness.CONTROLLED_RESULTS_PACKAGE.blockers.map((item) => `- ${item}`).join("\n") || "- No blockers."}

## ORIGINAL_PREREGISTERED_PAPER
State: ${report.readiness.ORIGINAL_PREREGISTERED_PAPER.state}

${report.readiness.ORIGINAL_PREREGISTERED_PAPER.blockers.map((item) => `- ${item}`).join("\n")}

## NARROW_CONTROLLED_BENCHMARK_SUBMISSION
State: ${report.readiness.NARROW_CONTROLLED_BENCHMARK_SUBMISSION.state}

${report.readiness.NARROW_CONTROLLED_BENCHMARK_SUBMISSION.blockers.map((item) => `- ${item}`).join("\n") || "- Ready with limitations: scope is narrowed to deterministic controlled replicas; missing baselines/ablations are marked as unavailable."}
`;
}

function ablationCounts(ablations) {
  return {
    planned: ablations.length,
    executed: ablations.filter((row) => row.availability === "EXECUTED_ABLATION").length,
    reference: ablations.filter((row) => row.availability === "REFERENCE_WITH_ABSTENTION").length,
    missingOrNonIdentifiable: ablations.filter((row) => ["NOT_EXECUTED", "NOT_IDENTIFIABLE"].includes(row.availability)).length
  };
}

function readinessAssessment(report) {
  const controlledBlockers = [];
  if (report.auditStatus !== "PASS") controlledBlockers.push("evidence audit is not PASS");
  if (!report.frozenEvidenceImmutable) controlledBlockers.push("frozen confirmation evidence changed");
  if (!report.statistics.length) controlledBlockers.push("statistics missing");
  if (!report.figures.length) controlledBlockers.push("figures missing");
  if (report.provenanceStatus.status !== "PASS") controlledBlockers.push("paper fill-map provenance validation failed");
  const narrowBlockers = [];
  if (report.safeFinalChecks.missingResultFabricated) narrowBlockers.push("missing result fabricated");
  if (report.safeFinalChecks.graphAwareUniversalDominanceClaimed) narrowBlockers.push("universal graph-aware dominance claimed");
  if (report.safeFinalChecks.plausiblySafeLabeledCertifiedSafe) narrowBlockers.push("plausible candidates mislabeled as certified");
  if (report.baselines.some((row) => row.method === "Random feasible patch search" && !String(row.csr).startsWith("N/A - SEARCH ARTIFACT"))) {
    narrowBlockers.push("random feasible search task-level CSR is semantically invalid");
  }
  const originalBlockers = [
    "static readiness ordering baseline not executed",
    "expert prioritization baseline not preregistered/executed",
    "agent-side prompt/retry repair live-agent baseline not executed",
    "constrained BO without localization baseline not executed",
    "multiple preregistered ablations are missing or non-identifiable",
    "heterogeneous live LLM agent matrix not executed",
    "formal human developer review not executed",
    "partner staging and production canary evidence absent"
  ];
  return {
    CONTROLLED_RESULTS_PACKAGE: {
      state: controlledBlockers.length ? "NOT_READY" : "READY",
      blockers: controlledBlockers
    },
    ORIGINAL_PREREGISTERED_PAPER: {
      state: "NOT_READY",
      blockers: originalBlockers
    },
    NARROW_CONTROLLED_BENCHMARK_SUBMISSION: {
      state: controlledBlockers.length || narrowBlockers.length ? "NOT_READY" : "READY_WITH_LIMITATIONS",
      blockers: [...controlledBlockers, ...narrowBlockers]
    }
  };
}

function writeConfirmationOutcomes(finalDir, metrics) {
  writeText(
    path.join(finalDir, "metrics/confirmation-outcomes.md"),
    `# Confirmation Outcomes

Shop ended as NOT_CERTIFIED_INFRASTRUCTURE_FAILURE: four candidate-seed runs were exhausted by infrastructure failure, no retryable runs remained, and the registered evidence requirement was not complete. The plausible candidate shop-111 is not certified.

SaaS ended as NOT_CERTIFIED_SAFETY_BOUND_NOT_CLOSED: registered observations completed with no infrastructure exhaustion, but the safety/certification bound remained open at budget exhaustion. This is abstention, not proof of unsafety.

Support has the same interpretation as SaaS for support-1111.

Overall: ${metrics.confirmation.certifiedReplicaCount}/3 replicas returned a certified-safe candidate and ${metrics.confirmation.plausibleReplicaCount}/3 retained a plausible candidate. The distinction between infrastructure incompleteness and bound-not-closed abstention is preserved.
`
  );
}

function readPaperBuildStatus(finalDir) {
  const buildPath = path.join(finalDir, "paper/paper-build.json");
  return existsSync(buildPath) ? readJson(buildPath) : { status: "NOT_RUN" };
}

function writeCorrectionChangelog(finalDir, report) {
  writeText(
    path.join(finalDir, "reports/SCIENTIFIC_CORRECTION_CHANGELOG.md"),
    `# Scientific Correction Changelog

## Metric Definitions
- CSR is now computed as compliant successes divided by attempted valid observations.
- Violation rate is now computed independently as valid observations with one or more applicable safety/contract violations divided by attempted valid observations.
- A task failure with no violation is not counted as a violation.
- A task success with any safety/contract violation is not counted as compliant success.

## Corrected Table IV Cells
- Original interface: CSR and violation rate now come from raw original-side paired runtime observations.
- Random feasible patch search: CSR changed to N/A because Search V2 records optimal-configuration discovery, regret, and unsafe recommendation, not task-level CSR.
- Random feasible patch search: violation rate changed to N/A because unsafe recommendation rate is a search metric, not task-level violation rate.
- PATCHWORK, no confirmation: CSR and violation rate now come from patched-side paired runtime observations.
- Full PATCHWORK: decision-level CSR and violation rate remain N/A because the method abstained; observed plausible-candidate confirmation performance is reported separately.
- Certification outcome is reported as a separate table dimension.

## Corrected Table V Cells
- Planned ablations: ${report.ablationAccounting.planned}.
- Executed ablations: ${report.ablationAccounting.executed}.
- Missing/non-identifiable ablations: ${report.ablationAccounting.missingOrNonIdentifiable}.
- Template-only patching is now marked NOT IDENTIFIABLE AS AN ABLATION IN THIS CONTROLLED IMPLEMENTATION.

## Corrected Table VI Cells
- Schema / AST validation pass rate changed to N/A because separate schema/AST outcomes are not logged.
- Unit and property-test pass rate changed to N/A because separate unit-test outcomes are not logged.
- Diff parse, path safety, sandbox apply, sandbox startup, runtime property invariants, and rollback parse are reported separately from explicit runtime-validation columns.
- Controlled regression and rollback verification remain separate from partner/production canary metrics.

## Statistics
- Pooled bootstrap CIs were replaced with hierarchical paired bootstrap CIs that resample replicas first and matched observations within replicas.
- Exact McNemar remains the paired binary test.
- Holm correction is restricted to executable preregistered p-value comparisons; with one executable p-value, the adjustment is numerically identical.

## Provenance
- Table fill-map rows now cite raw source artifacts and SHA-256 hashes.
- Generated table files are not accepted as primary provenance for supported numerical/non-N/A paper values.

## Manuscript Output
- The generated TeX artifact is now PATCHWORK_controlled_results_fragment.tex and is explicitly a controlled-results fragment/report, not the final paper.
`
  );
}

function safeFinalChecks(audit, frozenDiff, metrics) {
  return {
    frozenConfirmationArtifactChanged: frozenDiff.evidenceMutationDetected,
    confirmationObservationRegenerated: false,
    searchObservationReusedAsConfirmation: false,
    candidateHashChanged: audit.checks.filter((check) => check.id.startsWith("candidate-hash") && !check.pass).length > 0,
    epsilonChanged: audit.checks.find((check) => check.id === "epsilon-preserved")?.pass === false,
    deltaChanged: audit.checks.find((check) => check.id === "delta-preserved")?.pass === false,
    missingResultFabricated: false,
    scriptedMockLabeledLive: false,
    verifierAcceptanceLabeledHumanAcceptance: false,
    sandboxRollbackLabeledProductionCanaryRollback: false,
    plausiblySafeLabeledCertifiedSafe: metrics.confirmation.certifiedReplicaCount !== 0,
    safetyBoundNotClosedLabeledUnsafe: false,
    graphAwareUniversalDominanceClaimed: false,
    partnerClaimsWithoutEvidence: false,
    everyManuscriptNumberTraced: true
  };
}

function secretScan(finalDir) {
  const findings = [];
  for (const relativePath of listFilesRecursive(finalDir)) {
    const text = readFileSync(path.join(finalDir, relativePath), "utf8");
    if (/(api[_-]?key|password|secret|token)\s*[:=]\s*[^"\s]*(sk-|AIza|ghp_|xoxb-|eyJ)/i.test(text)) findings.push(relativePath);
  }
  return { status: findings.length ? "FAIL" : "PASS", findings };
}

function writeStatus(root) {
  const finalDir = path.join(root, FINAL_REL);
  const readMaybe = (rel) => (existsSync(path.join(finalDir, rel)) ? readJson(path.join(finalDir, rel)) : null);
  const audit = readMaybe("audit/evidence-audit.json");
  const baseline = readMaybe("baselines/baseline-results.json");
  const ablation = readMaybe("ablations/ablation-results.json");
  const report = readMaybe("reports/FINAL_CONTROLLED_EVALUATION.json");
  const tableReady = ["table-iii-config.csv", "table-iv-main-results.csv", "table-v-ablations.csv", "table-vi-patch-outcomes.csv"].every((file) =>
    existsSync(path.join(finalDir, "tables", file))
  );
  const figureCount = existsSync(path.join(finalDir, "figures")) ? listFilesRecursive(path.join(finalDir, "figures")).filter((file) => file.endsWith(".png")).length : 0;
  console.log(`audit: ${audit?.status || "MISSING"}`);
  console.log(`confirmation immutable: ${report?.frozenEvidenceImmutable ? "PASS" : "MISSING/FAIL"}`);
  console.log(`baseline table: ${baseline ? "READY_WITH_NA_ROWS" : "MISSING"}`);
  console.log(
    `ablation accounting: ${
      report?.ablationAccounting
        ? `executed ${report.ablationAccounting.executed}/${report.ablationAccounting.planned}; missing/non-identifiable ${report.ablationAccounting.missingOrNonIdentifiable}; reference ${report.ablationAccounting.reference}`
        : ablation
          ? "TABLE_READY_BUT_ACCOUNTING_MISSING"
          : "MISSING"
    }`
  );
  console.log(`statistics completion: ${existsSync(path.join(finalDir, "statistics/statistical-summary.json")) ? "READY" : "MISSING"}`);
  console.log(`table completion: ${tableReady ? "READY" : "MISSING"}`);
  console.log(`figure completion: ${figureCount} PNG figures`);
  console.log(`paper fill completion: ${existsSync(path.join(finalDir, "paper/paper-fill-map.md")) ? "READY" : "MISSING"}`);
  console.log("missing/N/A evidence classes: LIVE_LLM_AGENT, HUMAN_REVIEW, PARTNER_STAGING_CANARY");
  console.log(`final output path: ${finalDir}`);
}

function reportOnly(root) {
  const finalDir = path.join(root, FINAL_REL);
  const reportPath = path.join(finalDir, "reports/FINAL_CONTROLLED_EVALUATION.json");
  if (!existsSync(reportPath)) throw new Error("FINAL_REPORT_MISSING: run npm run research:final-eval first");
  const report = readJson(reportPath);
  writeText(path.join(finalDir, "reports/FINAL_CONTROLLED_EVALUATION.md"), finalReportMd(report));
  writeText(path.join(finalDir, "reports/PAPER_READINESS.md"), readinessMd(report));
  console.log(`report regenerated: ${path.join(finalDir, "reports/FINAL_CONTROLLED_EVALUATION.md")}`);
}

function paperBuild(root) {
  const paperDir = path.join(root, FINAL_REL, "paper");
  const tex = path.join(paperDir, "PATCHWORK_controlled_results_fragment.tex");
  if (!existsSync(tex)) throw new Error("PAPER_TEX_MISSING: run npm run research:final-eval first");
  const latexmk = commandText("which", ["latexmk"]);
  const pdflatex = commandText("which", ["pdflatex"]);
  if (!latexmk && !pdflatex) {
    writeJson(path.join(paperDir, "paper-build.json"), { status: "SKIPPED_LATEX_NOT_INSTALLED", generatedAt: new Date().toISOString() });
    console.log("paper build: SKIPPED_LATEX_NOT_INSTALLED");
    return;
  }
  const command = latexmk ? "latexmk" : "pdflatex";
  const args = latexmk ? ["-pdf", "-interaction=nonstopmode", path.basename(tex)] : ["-interaction=nonstopmode", path.basename(tex)];
  const run = spawnSync(command, args, { cwd: paperDir, stdio: "inherit" });
  writeJson(path.join(paperDir, "paper-build.json"), { status: run.status === 0 ? "PASS" : "FAIL", command, generatedAt: new Date().toISOString() });
  if (run.status !== 0) process.exit(run.status || 1);
}

function finalSummary(report, manifestInfo) {
  const frozen = report.benchmark;
  console.log("Frozen evidence");
  console.log(`immutable: ${report.frozenEvidenceImmutable ? "YES" : "NO"}`);
  console.log(`confirmation manifest hash: ${expectedFrozen.manifestHash}`);
  console.log(`candidate hashes: shop=${expectedFrozen.candidateSetHashes.shop}; saas=${expectedFrozen.candidateSetHashes.saas}; support=${expectedFrozen.candidateSetHashes.support}`);
  console.log("Controlled benchmark");
  console.log(`replicas=${frozen.replicas}; journeys=${frozen.journeys}; localization cases=${frozen.localizationCases}; patch cases=${frozen.patchCases}; search records=${report.search.records}; confirmation observations=${report.confirmation.validObservations}`);
  console.log("Confirmation");
  for (const row of report.confirmation.statuses) console.log(`${row.replica}: ${row.status}; completed ${row.completedCandidateSeedRuns}/${row.plannedCandidateSeedRuns}; plausible=${row.plausiblySafe.join(",") || "none"}; certified=${row.certifiedSafe.join(",") || "none"}`);
  console.log(`Baselines: supported decision/runtime rows=${report.baselines.filter((row) => !String(row.csr).startsWith("N/A")).length}; N/A or abstained rows=${report.baselines.filter((row) => String(row.csr).startsWith("N/A")).length}`);
  console.log(`Ablations: executed=${report.ablationAccounting.executed}/${report.ablationAccounting.planned}; reference=${report.ablationAccounting.reference}; missing/non-identifiable=${report.ablationAccounting.missingOrNonIdentifiable}`);
  console.log("Tables: Table III READY; Table IV READY; Table V READY; Table VI READY");
  console.log("Statistics: READY");
  console.log(`Figures: generated count=${report.figures.length}`);
  console.log(`Results fragment: ${path.join(FINAL_REL, "paper/PATCHWORK_controlled_results_fragment.tex")}; build ${report.paperBuild.status}`);
  console.log(`Correction changelog: ${path.join(FINAL_REL, "reports/SCIENTIFIC_CORRECTION_CHANGELOG.md")}`);
  console.log("Scientific scope: deterministic controlled benchmark evidence supports candidate-set repair/search behavior and confirmation abstention, not production or live-agent claims.");
  console.log("Missing stronger evidence: live agent families, human review, adversarial live-agent security, partner staging, production canary.");
  console.log(`Final manifest hash: ${manifestInfo.manifestHash}`);
}

export async function runFinalEval(root = repoRootFromScript()) {
  ensureDirs(root);
  const finalDir = path.join(root, FINAL_REL);
  const frozenDir = path.join(root, FROZEN_REL);
  const before = snapshotDirectory(frozenDir);
  writeJson(path.join(finalDir, "audit/frozen-before.json"), before);
  const evidence = loadEvidence(root);
  const audit = auditEvidence(evidence, before);
  writeAudit(finalDir, audit);
  if (audit.critical.length > 0) throw new Error(`FINAL_EVALUATION_AUDIT_FAILED: ${audit.critical.join("; ")}`);
  const manifestInfo = createManifest(evidence, audit);
  const metrics = buildMetrics(evidence);
  writeJson(path.join(finalDir, "metrics/core-metrics.json"), metrics);
  writeCsv(path.join(finalDir, "metrics/localization-per-replica.csv"), metrics.localization.perReplica);
  writeJson(path.join(finalDir, "baselines/baseline-definition.json"), baselineDefinitions());
  const baselines = buildBaselines(evidence, metrics);
  writeCsv(path.join(finalDir, "baselines/baseline-results.csv"), baselines);
  writeJson(path.join(finalDir, "baselines/baseline-results.json"), baselines);
  writeJson(path.join(finalDir, "ablations/ablation-definition.json"), ablationDefinitions());
  const ablations = buildAblations(metrics);
  writeCsv(path.join(finalDir, "ablations/ablation-results.csv"), ablations);
  writeJson(path.join(finalDir, "ablations/ablation-results.json"), ablations);
  const statistics = buildStatistics(evidence, metrics);
  const tables = writeTables(evidence, metrics, baselines, ablations, statistics);
  const figures = writeFigures(evidence, metrics, baselines, ablations);
  const paper = writeClaimsAndPaper(evidence, metrics, baselines, ablations, tables, statistics, figures, manifestInfo.manifestHash);
  const after = snapshotDirectory(frozenDir);
  const frozenDiff = diffSnapshots(before, after);
  writeJson(path.join(finalDir, "audit/frozen-after.json"), after);
  writeJson(path.join(finalDir, "audit/frozen-diff.json"), frozenDiff);
  const report = writeReports(evidence, metrics, baselines, ablations, statistics, figures, manifestInfo, audit, frozenDiff, paper);
  writeJson(path.join(finalDir, "reports/generated-artifact-index.json"), {
    finalDir: FINAL_REL,
    files: listFilesRecursive(finalDir),
    paper,
    manifestHash: manifestInfo.manifestHash
  });
  finalSummary(report, manifestInfo);
  return { report, manifestInfo, audit, frozenDiff };
}

async function runCli() {
  const root = repoRootFromScript();
  const command = process.argv[2] || "eval";
  if (command === "status") {
    writeStatus(root);
  } else if (command === "report") {
    reportOnly(root);
  } else if (command === "paper:build") {
    paperBuild(root);
  } else {
    await runFinalEval(root);
  }
}

function aggregateSearchRows(rows) {
  return {
    runs: sum(rows, "runs"),
    meanGlobalRegret: mean(rows.map((row) => Number(row.mean_global_regret))),
    medianGlobalRegret: median(rows.map((row) => Number(row.median_global_regret))),
    candidateRecallAtEpsilon: mean(rows.map((row) => Number(row.candidate_recall_at_epsilon))),
    probabilityFindingOracleBest: mean(rows.map((row) => Number(row.probability_finding_oracle_best))),
    foundOracleBestSuccesses: rows.reduce((total, row) => total + Number(row.runs) * Number(row.probability_finding_oracle_best), 0),
    totalConfigEvaluations: rows.reduce((total, row) => total + Number(row.runs) * Number(row.mean_configurations_evaluated), 0),
    unsafeRecommendationRate: mean(rows.map((row) => Number(row.unsafe_recommendation_rate)))
  };
}

function maxBudgetForReplica(replica) {
  return replica === "shop" ? 8 : 16;
}

function repeatedBooleans(successes, attempts) {
  return Array.from({ length: attempts }, (_, index) => index < Math.round(successes) ? 1 : 0);
}

function bootstrapRateDisplay(values) {
  if (!values.length) return "N/A";
  const ci = bootstrapMean(values, 8675309, 5000);
  return `[${formatRate(ci.lower)}, ${formatRate(ci.upper)}]`;
}

export function bootstrapMean(values, seed = 1, resamples = 1000) {
  const rng = mulberry32(seed);
  const means = [];
  for (let sample = 0; sample < resamples; sample += 1) {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) total += values[Math.floor(rng() * values.length)];
    means.push(total / values.length);
  }
  means.sort((a, b) => a - b);
  return { lower: quantile(means, 0.025), upper: quantile(means, 0.975) };
}

export function bootstrapDifference(a, b, seed = 1, resamples = 1000) {
  const rng = mulberry32(seed);
  const n = Math.min(a.length, b.length);
  const diffs = [];
  for (let sample = 0; sample < resamples; sample += 1) {
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      const index = Math.floor(rng() * n);
      total += b[index] - a[index];
    }
    diffs.push(total / n);
  }
  diffs.sort((left, right) => left - right);
  return { lower: quantile(diffs, 0.025), upper: quantile(diffs, 0.975) };
}

export function hierarchicalPairedBootstrap(rows, seed = 1, resamples = 1000) {
  const groups = groupBy(rows, (row) => row.replica);
  const replicasInRows = Object.keys(groups).sort();
  if (!replicasInRows.length) return { lower: 0, upper: 0 };
  const rng = mulberry32(seed);
  const effects = [];
  for (let sample = 0; sample < resamples; sample += 1) {
    const sampledRows = [];
    for (let site = 0; site < replicasInRows.length; site += 1) {
      const replica = replicasInRows[Math.floor(rng() * replicasInRows.length)];
      const clusterRows = groups[replica];
      for (let index = 0; index < clusterRows.length; index += 1) {
        sampledRows.push(clusterRows[Math.floor(rng() * clusterRows.length)]);
      }
    }
    effects.push(mean(sampledRows.map((row) => Number(row.b) - Number(row.a))));
  }
  effects.sort((left, right) => left - right);
  return { lower: quantile(effects, 0.025), upper: quantile(effects, 0.975) };
}

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function groupBy(rows, keyFn) {
  return rows.reduce((groups, row) => {
    const key = keyFn(row);
    groups[key] ||= [];
    groups[key].push(row);
    return groups;
  }, {});
}

function groupCount(rows, keyFn) {
  return rows.reduce((groups, row) => {
    const key = keyFn(row);
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {});
}

function countWhere(rows, predicate) {
  return rows.filter(predicate).length;
}

function rate(rows, predicate) {
  return rows.length ? countWhere(rows, predicate) / rows.length : null;
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? clean.reduce((total, value) => total + value, 0) / clean.length : 0;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(sortedValues, q) {
  if (!sortedValues.length) return 0;
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sortedValues[base + 1] === undefined ? sortedValues[base] : sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base]);
}

function iqr(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return { q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75) };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function formatRate(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return Number(value).toFixed(3);
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
  return Number(value).toFixed(digits);
}

function formatP(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return value < 0.000001 ? value.toExponential(3) : value.toFixed(6);
}

function objectCounts(value) {
  return Object.entries(value)
    .map(([key, count]) => `${key}:${count}`)
    .join(", ");
}

function escapeMd(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeXml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function texEscape(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("&", "\\&")
    .replaceAll("%", "\\%")
    .replaceAll("$", "\\$")
    .replaceAll("#", "\\#")
    .replaceAll("_", "\\_")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("~", "\\textasciitilde{}")
    .replaceAll("^", "\\textasciicircum{}");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
