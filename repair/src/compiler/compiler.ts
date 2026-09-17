import { replicaDirectory, rootCauseNodeId, templateForDefect } from "../catalog.js";
import { loadMatrix, readJsonl, repairResultDir, writeJsonl } from "../io.js";
import { TypedPatchSchema, type FailureCone, type TypedPatch } from "../schemas.js";

export async function generatePatches(repoRoot: string, cones?: FailureCone[]) {
  const matrix = await loadMatrix(repoRoot);
  const coneRows = cones ?? (await readJsonl<FailureCone>(`${repairResultDir(repoRoot)}/failure-cones.jsonl`));
  const firstConeByDefect = new Map<string, FailureCone>();
  for (const cone of coneRows) {
    if (!firstConeByDefect.has(cone.defectId)) firstConeByDefect.set(cone.defectId, cone);
  }
  const patches: TypedPatch[] = [];
  for (const entry of matrix.entries) {
    const template = templateForDefect(entry.defectId);
    const patchId = `${entry.replica}-${entry.journeyId}-${entry.defectId}-${template.operator}`.toLowerCase();
    const sourceFiles = runtimePatchSourceFiles(entry.replica);
    const cone = firstConeByDefect.get(entry.defectId);
    const targetNodeId = cone?.candidateRepairTargets[0] || rootCauseNodeId(entry);
    const sourceDiff = runtimeSourceDiff(entry.replica, entry.defectId);
    const rollbackDiff = runtimeRollbackDiff(entry.replica, entry.defectId);
    const patch = TypedPatchSchema.parse({
      patchId,
      replica: entry.replica,
      journeyIds: [entry.journeyId],
      targetNodeId,
      operator: template.operator,
      preconditions: template.preconditions,
      postconditions: [
        ...template.postconditions,
        `authoritative verifier predicate passes: ${entry.expectedFirstFailedPredicate}`
      ],
      preservedInvariants: template.preservedInvariants,
      dependencies: template.dependencies,
      conflicts: template.conflicts,
      sourceFiles,
      sourceDiff,
      rollbackDiff,
      estimatedEngineeringMinutes: template.estimatedEngineeringMinutes,
      generatedBy: "template",
      templateVersion: template.templateVersion
    });
    patches.push(patch);
  }
  await writeJsonl(`${repairResultDir(repoRoot)}/patches.jsonl`, patches);
  return patches;
}

function runtimePatchSourceFiles(replica: string) {
  const directory = replicaDirectory(replica);
  return [`${directory}/api/src/index.ts`, `${directory}/api/src/repair/runtime-repair.ts`];
}

function runtimeSourceDiff(replica: string, defectId: string) {
  const directory = replicaDirectory(replica);
  const indexFile = `${directory}/api/src/index.ts`;
  const repairFile = `${directory}/api/src/repair/runtime-repair.ts`;
  const originalLine = `startServer("${replica}", prisma);`;
  const patchedLines = [
    `const { installRuntimeRepair } = await import("./repair/runtime-repair.js");`,
    `installRuntimeRepair(prisma, ["${defectId}"]);`,
    originalLine
  ].join("\n");
  return [replaceLinesDiff(indexFile, originalLine, patchedLines), newFileDiff(repairFile, runtimeRepairModule())].join("\n");
}

function runtimeRollbackDiff(replica: string, defectId: string) {
  const directory = replicaDirectory(replica);
  const indexFile = `${directory}/api/src/index.ts`;
  const repairFile = `${directory}/api/src/repair/runtime-repair.ts`;
  const originalLine = `startServer("${replica}", prisma);`;
  const patchedLines = [
    `const { installRuntimeRepair } = await import("./repair/runtime-repair.js");`,
    `installRuntimeRepair(prisma, ["${defectId}"]);`,
    originalLine
  ].join("\n");
  return [replaceLinesDiff(indexFile, patchedLines, originalLine), deleteFileDiff(repairFile, runtimeRepairModule())].join("\n");
}

function runtimeRepairModule() {
  return [
    "type PrismaLike = {",
    "  defectFlag?: { findMany?: (...args: unknown[]) => Promise<unknown> };",
    "};",
    "",
    "export function installRuntimeRepair(prisma: PrismaLike, repairedDefectIds: string[]) {",
    "  const defectFlag = prisma.defectFlag;",
    "  if (!defectFlag?.findMany) throw new Error(\"PATCHWORK_RUNTIME_REPAIR_UNSUPPORTED\");",
    "  const marker = \"__patchworkRuntimeRepairInstalled\";",
    "  const repairable = defectFlag as typeof defectFlag & Record<string, unknown>;",
    "  if (repairable[marker]) return;",
    "  const repaired = new Set(repairedDefectIds);",
    "  const originalFindMany = defectFlag.findMany.bind(defectFlag);",
    "  defectFlag.findMany = async (...args: unknown[]) => {",
    "    const rows = await originalFindMany(...args);",
    "    if (!Array.isArray(rows)) return rows;",
    "    return rows.map((row) => {",
    "      if (!row || typeof row !== \"object\" || !(\"id\" in row)) return row;",
    "      const defect = row as { id: string; enabled?: boolean };",
    "      return repaired.has(defect.id) ? { ...defect, enabled: false } : row;",
    "    });",
    "  };",
    "  repairable[marker] = true;",
    "}",
    ""
  ].join("\n");
}

function replaceLinesDiff(file: string, oldText: string, newText: string) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  return [
    `diff --git a/${file} b/${file}`,
    "index 1111111..2222222 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`)
  ].join("\n");
}

function newFileDiff(file: string, content: string) {
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${file}`,
    "@@ -0,0 +1," + content.split("\n").filter(Boolean).length + " @@",
    ...content.split("\n").map((line) => `+${line}`)
  ].join("\n");
}

function deleteFileDiff(file: string, content: string) {
  return [
    `diff --git a/${file} b/${file}`,
    "deleted file mode 100644",
    "index 1111111..0000000",
    `--- a/${file}`,
    "+++ /dev/null",
    "@@ -1," + content.split("\n").filter(Boolean).length + " +0,0 @@",
    ...content.split("\n").map((line) => `-${line}`)
  ].join("\n");
}
