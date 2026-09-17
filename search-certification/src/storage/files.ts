import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export const resultRelativeDir = "experiments/results/search-certification-pilot-v1";
export const manifestRelativePath = "experiments/configs/search-certification-pilot-v1.yaml";

export function resolveRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "experiments/configs/repair-pilot-v1.yaml")) && existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

export function repoPath(repoRoot: string, relativePath: string) {
  return path.join(repoRoot, relativePath);
}

export function resultDir(repoRoot: string) {
  return repoPath(repoRoot, resultRelativeDir);
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function readYaml<T>(file: string): Promise<T> {
  return YAML.parse(await readFile(file, "utf8")) as T;
}

export async function writeYaml(file: string, value: unknown) {
  await ensureParent(file);
  await writeFile(file, YAML.stringify(value), "utf8");
}

export async function readJsonl<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function appendJsonl(file: string, rows: unknown[]) {
  await ensureParent(file);
  const previous = existsSync(file) ? await readFile(file, "utf8") : "";
  const next = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(file, previous + (previous && next ? "\n" : "") + next + (next ? "\n" : ""), "utf8");
}

export async function writeJsonl(file: string, rows: unknown[]) {
  await ensureParent(file);
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

export async function readJson<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function writeJson(file: string, value: unknown) {
  await ensureParent(file);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeCsv(file: string, rows: Array<Record<string, unknown>>) {
  await ensureParent(file);
  if (rows.length === 0) {
    await writeFile(file, "", "utf8");
    return;
  }
  const headers = Object.keys(rows[0] ?? {});
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
}

export function readCsvObjects(file: string) {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const headers = parseCsvLine(lines[0] || "");
  return lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index] || `column_${index}`, value])));
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function fileHash(file: string) {
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "missing";
}

export function currentWorkspaceVersion(repoRoot: string) {
  const head = repoPath(repoRoot, ".git/HEAD");
  if (!existsSync(head)) return { commit: "not-a-git-worktree", dirty: "unknown" };
  return { commit: readFileSync(head, "utf8").trim(), dirty: "unknown" };
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /password|token|secret|key|authorization/i.test(key) ? "[REDACTED]" : redact(item)
    ])
  );
}

export async function assertNoSecretLeak(files: string[]) {
  const secretPattern = /sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+|password["']?\s*[:=]\s*["'][^"']+|refreshToken|accessToken/i;
  for (const file of files) {
    if (!existsSync(file)) continue;
    const content = await readFile(file, "utf8");
    if (secretPattern.test(content)) throw new Error(`SEARCH_CERT_SECRET_LEAK: ${file}`);
  }
}

async function ensureParent(file: string) {
  await mkdir(path.dirname(file), { recursive: true });
}

function csvCell(value: unknown) {
  const text = Array.isArray(value) || (typeof value === "object" && value !== null) ? JSON.stringify(value) : String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  return cells;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}
