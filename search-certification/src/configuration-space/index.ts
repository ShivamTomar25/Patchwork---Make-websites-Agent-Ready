import path from "node:path";
import type { PatchConfiguration, PatchMetadata, Replica } from "../types.js";
import { loadGraphs, loadPatches, updateManifestSpaceHashes } from "../storage/loaders.js";
import { resultDir, stableHash, writeCsv, writeJson } from "../storage/files.js";

const replicas: Replica[] = ["shop", "saas", "support"];
const budgetMinutes: Record<Replica, number> = { shop: 200, saas: 240, support: 240 };
const maxConfigurations: Record<Replica, number> = { shop: 8, saas: 16, support: 16 };

export async function buildConfigurationSpaces(repoRoot: string) {
  const [patches, graphs] = await Promise.all([loadPatches(repoRoot), loadGraphs(repoRoot)]);
  const spaces = Object.fromEntries(
    replicas.map((replica) => {
      const replicaPatches = patches.filter((patch) => patch.replica === replica).sort((left, right) => left.patchId.localeCompare(right.patchId));
      return [replica, buildReplicaSpace(replica, replicaPatches, graphs[replica])] as const;
    })
  ) as Record<Replica, PatchConfiguration[]>;
  await updateManifestSpaceHashes(repoRoot, spaces);
  await exportConfigurationSpace(repoRoot, spaces);
  return spaces;
}

export async function validateConfigurationSpaces(repoRoot: string) {
  const spaces = await buildConfigurationSpaces(repoRoot);
  const problems: string[] = [];
  for (const replica of replicas) {
    const configs = spaces[replica];
    if (configs.length > maxConfigurations[replica]) problems.push(`${replica} has ${configs.length} configurations`);
    if (!configs.some((config) => config.patchVector.every((value) => value === 0))) problems.push(`${replica} missing empty configuration`);
    if (!configs.some((config) => config.patchVector.every((value) => value === 1))) problems.push(`${replica} missing full configuration`);
    if (!configs.every((config) => config.hash === stableHash({ ...config, hash: "" }))) problems.push(`${replica} contains unstable configuration hashes`);
  }
  if (problems.length > 0) throw new Error(`CONFIGURATION_SPACE_INVALID: ${problems.join("; ")}`);
  return spaces;
}

export function buildReplicaSpace(replica: Replica, patches: PatchMetadata[], graph: any): PatchConfiguration[] {
  const total = 2 ** patches.length;
  const configs: PatchConfiguration[] = [];
  for (let mask = 0; mask < total; mask += 1) {
    const vector = patches.map((_, index) => (mask & (1 << index) ? 1 : 0));
    const selected = patches.filter((_, index) => vector[index] === 1);
    configs.push(configurationFromSelection(replica, patches, selected, vector, graph, mask));
  }
  return configs;
}

function configurationFromSelection(replica: Replica, allPatches: PatchMetadata[], selected: PatchMetadata[], vector: number[], graph: any, mask: number): PatchConfiguration {
  const rejectionReasons: string[] = [];
  const dependencies = unique(selected.flatMap((patch) => patch.dependencies));
  const conflicts = unique(selected.flatMap((patch) => patch.conflicts));
  const graphNodeTypes = new Set<string>((graph?.nodes || []).map((node: any) => String(node.type)));
  for (const dependency of dependencies) {
    if (!dependencySatisfied(dependency, graphNodeTypes, allPatches)) {
      rejectionReasons.push(`unresolved dependency ${dependency}`);
    }
  }
  for (const left of selected) {
    for (const right of selected) {
      if (left.patchId === right.patchId) continue;
      if (left.conflicts.includes(right.patchId) || left.conflicts.includes(right.targetNodeId)) rejectionReasons.push(`declared conflict ${left.patchId} -> ${right.patchId}`);
    }
  }
  const sourceOverlap = modifiedSourceOverlap(selected);
  const runtimeCompatible = selected.every((patch) => patch.sourceFiles.some((file) => file.endsWith("/api/src/repair/runtime-repair.ts")));
  if (sourceOverlap > 0 && !runtimeCompatible) rejectionReasons.push("modified source overlap without combined runtime hook");
  const engineeringMinutes = selected.reduce((sum, patch) => sum + patch.estimatedEngineeringMinutes, 0);
  if (engineeringMinutes > budgetMinutes[replica]) rejectionReasons.push(`engineering budget exceeded ${engineeringMinutes}/${budgetMinutes[replica]}`);
  const filesChanged = unique(selected.flatMap((patch) => patch.sourceFiles)).length;
  const configuration = {
    configurationId: `${replica}-${mask.toString(2).padStart(allPatches.length, "0")}`,
    replica,
    patchVector: vector,
    patchIds: selected.map((patch) => patch.patchId),
    dependencies,
    conflicts,
    engineeringMinutes,
    filesChanged,
    feasible: rejectionReasons.length === 0,
    rejectionReasons,
    hash: ""
  };
  return { ...configuration, hash: stableHash(configuration) };
}

export async function exportConfigurationSpace(repoRoot: string, spaces: Record<Replica, PatchConfiguration[]>) {
  const rows = Object.values(spaces)
    .flat()
    .map((config) => ({
      configuration_id: config.configurationId,
      replica: config.replica,
      patch_vector: config.patchVector.join(""),
      patch_ids: config.patchIds.join(";"),
      dependencies: config.dependencies.join(";"),
      conflicts: config.conflicts.join(";"),
      engineering_minutes: config.engineeringMinutes,
      files_changed: config.filesChanged,
      feasible: config.feasible,
      rejection_reasons: config.rejectionReasons.join(";"),
      hash: config.hash
    }));
  await writeCsv(path.join(resultDir(repoRoot), "configuration-space.csv"), rows);
  await writeJson(path.join(resultDir(repoRoot), "configuration-space.json"), spaces);
}

function modifiedSourceOverlap(selected: PatchMetadata[]) {
  const counts = new Map<string, number>();
  for (const patch of selected) {
    for (const file of patch.sourceFiles) counts.set(file, (counts.get(file) || 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function dependencySatisfied(dependency: string, graphNodeTypes: Set<string>, patches: PatchMetadata[]) {
  const aliases: Record<string, string[]> = {
    FORM_FIELD: ["FORM_FIELD", "CONFIRMATION", "FRONTEND_STATE"],
    ERROR_CONTRACT: ["ERROR_CONTRACT", "API_OPERATION"],
    AUTH_SCOPE: ["AUTH_SCOPE"],
    DATABASE_STATE: ["DATABASE_STATE", "SIDE_EFFECT"],
    API_OPERATION: ["API_OPERATION"],
    FRONTEND_STATE: ["FRONTEND_STATE", "PAGE", "CONTROL"]
  };
  if ((aliases[dependency] || [dependency]).some((nodeType) => graphNodeTypes.has(nodeType))) return true;
  return patches.some((patch) => patch.patchId === dependency || patch.targetNodeId === dependency || patch.operator === dependency);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
