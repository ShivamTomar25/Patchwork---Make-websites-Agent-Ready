import { mkdtemp, rm, writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseUnifiedDiff, rejectPathTraversal } from "../compiler/diff.js";
import type { TypedPatch } from "../schemas.js";
import { repoPath } from "../io.js";

export type SandboxResult = {
  sandboxPath: string;
  appliedFiles: string[];
  rolledBack: boolean;
};

export async function applyPatchToIsolatedSandbox(repoRoot: string, patch: TypedPatch): Promise<SandboxResult> {
  const sandboxPath = await mkdtemp(path.join(tmpdir(), "patchwork-repair-"));
  const appliedFiles: string[] = [];
  const allowed = [`replicas/${patch.replica}-twin/`];
  try {
    for (const file of parseUnifiedDiff(patch.sourceDiff)) {
      const absolute = rejectPathTraversal(repoRoot, file.newPath, allowed);
      const relative = path.relative(repoRoot, absolute);
      const sandboxFile = path.join(sandboxPath, relative);
      await mkdir(path.dirname(sandboxFile), { recursive: true });
      await writeFile(sandboxFile, `${file.addedLines.join("\n")}\n`, "utf8");
      appliedFiles.push(relative);
    }
    return { sandboxPath, appliedFiles, rolledBack: true };
  } finally {
    await rm(sandboxPath, { recursive: true, force: true });
  }
}

export function assertSandboxPath(repoRoot: string, relativeFile: string, replica: string) {
  return rejectPathTraversal(repoPath(repoRoot, "."), relativeFile, [`replicas/${replica}-twin/`]);
}

export async function applyPatchDiff(repoRoot: string, patch: TypedPatch, diff = patch.sourceDiff): Promise<string[]> {
  const appliedFiles: string[] = [];
  const allowed = [`replicas/${patch.replica}-twin/`];
  for (const file of parseUnifiedDiff(diff)) {
    const targetPath = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
    const absolute = rejectPathTraversal(repoRoot, targetPath, allowed);
    const relative = path.relative(repoRoot, absolute);
    if (file.newPath === "/dev/null") {
      await unlink(absolute).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      appliedFiles.push(relative);
      continue;
    }
    await mkdir(path.dirname(absolute), { recursive: true });
    if (file.isNewFile || file.oldPath === "/dev/null") {
      await writeFile(absolute, `${file.addedLines.join("\n")}\n`, "utf8");
      appliedFiles.push(relative);
      continue;
    }
    const current = await readFile(absolute, "utf8");
    const before = file.deletedLines.join("\n");
    const after = file.addedLines.join("\n");
    if (!before) throw new Error(`PATCH_APPLY_REJECTED_EMPTY_DELETE: ${relative}`);
    if (!current.includes(before)) throw new Error(`PATCH_APPLY_CONTEXT_MISSING: ${relative}`);
    await writeFile(absolute, current.replace(before, after), "utf8");
    appliedFiles.push(relative);
  }
  return appliedFiles;
}
