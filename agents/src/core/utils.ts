import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SECRET_KEYS = /password|token|cookie|secret|api[_-]?key|authorization|jwt/i;

export function makeRunId(site: string, journeyId: string, agentId: string, seed: number): string {
  return `${site}-${journeyId}-${agentId}-seed${seed}-${randomUUID().slice(0, 8)}`;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

export function observationHash(value: unknown): string {
  return sha256(stableJson(value));
}

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item)) as T;
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : redactSecrets(item);
    }
    return redacted as T;
  }
  if (typeof value === "string" && looksSensitive(value)) return "[REDACTED]" as T;
  return value;
}

export function looksSensitive(value: string): boolean {
  return /Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]{12,}/.test(value);
}

export function compactText(value: string, max = 4000): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > max ? `${compacted.slice(0, max)}...` : compacted;
}

export async function writeJsonlLine(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(redactSecrets(value))}\n`, { flag: "a" });
}

export function parseRange(input: string | undefined, fallback: number[] = [1]): number[] {
  if (!input) return fallback;
  if (/^\d+$/.test(input)) return [Number(input)];
  const match = input.match(/^(\d+)-(\d+)$/);
  if (!match) return fallback;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const result: number[] = [];
  for (let value = start; value <= end; value += 1) result.push(value);
  return result;
}

export function parseDefectFlags(input: string | undefined): Record<string, boolean> {
  if (!input) return {};
  const result: Record<string, boolean> = {};
  for (const item of input.split(",")) {
    const [key, rawValue = "true"] = item.split("=");
    const id = key?.trim();
    if (!id) continue;
    const normalized = rawValue.trim().toLowerCase();
    result[id] = normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes";
  }
  return result;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortObject(item)])
    );
  }
  return value;
}
