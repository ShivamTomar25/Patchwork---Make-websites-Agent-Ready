import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

export const PilotJourneySchema = z.object({
  id: z.string(),
  cleanAgent: z.string(),
  defectAgent: z.string(),
  deterministicDefectId: z.string(),
  defectSurface: z.string().optional(),
  verifierMatrixId: z.string().optional(),
  maximumSteps: z.number().int().min(1),
  timeoutSeconds: z.number().int().min(1)
});

export const PilotManifestSchema = z.object({
  manifestVersion: z.string(),
  studyType: z.literal("pilot"),
  label: z.string(),
  frozenAt: z.string(),
  siteCommit: z.string(),
  harnessVersion: z.string(),
  liveAgentsEnabledWhenProviderKeysExist: z.boolean(),
  concurrency: z.literal(1),
  seeds: z.array(z.number().int().min(1)).min(1),
  surfaces: z.array(z.string()).min(1),
  modeDefaults: z.record(z.string(), z.unknown()).optional(),
  resultDirectories: z.object({
    mock: z.string(),
    liveSmoke: z.string().optional(),
    live: z.string()
  }).optional(),
  agents: z.array(z.object({
    id: z.string(),
    provider: z.string(),
    model: z.string(),
    promptVersion: z.string()
  })),
  replicas: z.record(z.enum(["shop", "saas", "support"]), z.object({
    name: z.string(),
    contractDirectory: z.string(),
    contractVersion: z.string(),
    journeys: z.array(PilotJourneySchema).min(1)
  })),
  conditions: z.record(z.string(), z.unknown()),
  notes: z.array(z.string())
});

export type PilotManifest = z.infer<typeof PilotManifestSchema>;
export type PilotJourney = z.infer<typeof PilotJourneySchema>;

export async function loadPilotManifest(repoRoot: string, manifestPath = "experiments/configs/pilot-study-v1.yaml") {
  const content = await readFile(path.join(repoRoot, manifestPath), "utf8");
  return PilotManifestSchema.parse(YAML.parse(content));
}
