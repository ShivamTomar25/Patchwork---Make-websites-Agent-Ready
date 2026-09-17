import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export type MatrixEntry = {
  replica: "shop" | "saas" | "support";
  journeyId: string;
  defectId: string;
  defectFamily: string;
  activationMechanism: string;
  affectedRouteApiComponent: string;
  expectedFirstFailedPredicate: string;
  expectedAuthoritativeState: string;
  expectedViolationType: string;
  expectedAgentVisibleSymptom: string;
  verifierEndpoint: string;
  cleanExpectedOutcome: string;
  defectExpectedOutcome: string;
  recoveryExpectedOutcome: string;
};

export type ContractPredicate = {
  id: string;
  description: string;
  source: string;
  operator: string;
  expectedValue: unknown;
  severity: string;
};

export type JourneyContract = {
  contractVersion: string;
  journeyId: string;
  replica: string;
  instruction: string;
  startingCheckpoint: string;
  testAccountReference: string;
  permittedSurfaces: string[];
  maximumSteps: number;
  timeoutSeconds: number;
  states: Array<{ id: string; description: string; route: string }>;
  expectedTransitions: Array<{ id: string; from: string; to: string; action: string }>;
  successPredicates: ContractPredicate[];
  safetyInvariants: ContractPredicate[];
  authoritativeVerifierEndpoint: string;
  affectedDefectIds: string[];
  expectedCleanOutcome: Record<string, unknown>;
  expectedDefectOutcomes: Array<{
    defectId: string;
    expectedVerifiedSuccess: boolean;
    firstFailedPredicateId: string;
    expectedFailure: string;
  }>;
};

export type PilotRunRecord = {
  experimentId: string;
  manifestVersion: string;
  siteCommit: string;
  contractVersion: string;
  site: "shop" | "saas" | "support";
  journeyId: string;
  agentId: string;
  provider: string;
  model: string;
  promptVersion: string;
  seed: number;
  condition: "clean" | "defect";
  verifiedSuccess: boolean;
  violations: string[];
  firstFailedPredicate: string;
  terminationReason: string;
  steps: number;
  latencyMs: number;
  inputTokens: number | string;
  outputTokens: number | string;
  backendStateBefore?: unknown;
  backendStateAfter?: unknown;
  resetResult?: unknown;
  defectId?: string;
  resultPath?: string;
};

export function repoPath(repoRoot: string, relativePath: string) {
  return path.join(repoRoot, relativePath);
}

export function resolveRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "experiments/configs/pilot-study-v2.yaml")) && existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

export async function loadYamlFile<T = unknown>(filePath: string): Promise<T> {
  return YAML.parse(await readFile(filePath, "utf8")) as T;
}

export async function writeYamlFile(filePath: string, value: unknown) {
  await ensureParent(filePath);
  await writeFile(filePath, YAML.stringify(value), "utf8");
}

export async function loadMatrix(repoRoot: string) {
  const parsed = await loadYamlFile<{ version: string; generatedForManifest: string; entries: MatrixEntry[] }>(
    repoPath(repoRoot, "experiments/configs/defect-verifier-matrix.yaml")
  );
  return parsed;
}

export async function loadPilotManifest(repoRoot: string) {
  return loadYamlFile<any>(repoPath(repoRoot, "experiments/configs/pilot-study-v2.yaml"));
}

export async function loadRepairManifest(repoRoot: string) {
  return loadYamlFile<any>(repoPath(repoRoot, "experiments/configs/repair-pilot-v1.yaml"));
}

export async function loadContracts(repoRoot: string): Promise<Record<string, JourneyContract[]>> {
  const files = {
    shop: "replicas/shop-twin/research/contracts/journeys.yaml",
    saas: "replicas/saas-twin/research/contracts/journeys.yaml",
    support: "replicas/support-twin/research/contracts/journeys.yaml"
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([replica, file]) => {
      const parsed = await loadYamlFile<{ journeys: JourneyContract[] }>(repoPath(repoRoot, file));
      return [replica, parsed.journeys] as const;
    })
  );
  return Object.fromEntries(entries);
}

export async function readPilotRecords(repoRoot: string): Promise<PilotRunRecord[]> {
  const file = repoPath(repoRoot, "experiments/results/pilot-study-v2/mock/runs.jsonl");
  const content = await readFile(file, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PilotRunRecord);
}

export async function readTraceEvents(resultPath?: string) {
  if (!resultPath || !existsSync(resultPath)) return [];
  const content = await readFile(resultPath, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export async function ensureParent(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function ensureDir(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

export async function writeJson(filePath: string, value: unknown) {
  await ensureParent(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeJsonl(filePath: string, rows: unknown[]) {
  await ensureParent(filePath);
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function writeCsv(filePath: string, rows: Array<Record<string, unknown>>) {
  await ensureParent(filePath);
  if (rows.length === 0) {
    await writeFile(filePath, "", "utf8");
    return;
  }
  const headers = Object.keys(rows[0] ?? {});
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

export function repairResultDir(repoRoot: string) {
  const configured = process.env.REPAIR_RESULT_DIR || "experiments/results/repair-pilot-v1";
  return path.isAbsolute(configured) ? configured : repoPath(repoRoot, configured);
}

export function graphResultDir(repoRoot: string) {
  return repoPath(repoRoot, "repair/results/graphs");
}

export function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function csvCell(value: unknown) {
  const text = Array.isArray(value) || (typeof value === "object" && value !== null) ? JSON.stringify(value) : String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}
