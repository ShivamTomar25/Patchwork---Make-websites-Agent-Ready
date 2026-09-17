import path from "node:path";

export type ParsedDiffFile = {
  oldPath: string;
  newPath: string;
  addedLines: string[];
  deletedLines: string[];
  isNewFile: boolean;
};

export function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  const lines = diff.split("\n");
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | undefined;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      const [, , oldPathRaw, newPathRaw] = line.split(" ");
      current = {
        oldPath: stripPrefix(oldPathRaw || ""),
        newPath: stripPrefix(newPathRaw || ""),
        addedLines: [],
        deletedLines: [],
        isNewFile: false
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode")) current.isNewFile = true;
    if (line.startsWith("--- ")) current.oldPath = stripPrefix(line.slice(4).trim());
    if (line.startsWith("+++ ")) current.newPath = stripPrefix(line.slice(4).trim());
    if (line.startsWith("+") && !line.startsWith("+++")) current.addedLines.push(line.slice(1));
    if (line.startsWith("-") && !line.startsWith("---")) current.deletedLines.push(line.slice(1));
  }
  if (current) files.push(current);
  if (files.length === 0) throw new Error("DIFF_PARSE_FAILED: no diff files found");
  for (const file of files) {
    if ((!file.newPath || file.newPath === "/dev/null") && (!file.oldPath || file.oldPath === "/dev/null")) {
      throw new Error("DIFF_PARSE_FAILED: missing file path");
    }
  }
  return files;
}

export function rejectPathTraversal(repoRoot: string, relativeFile: string, allowedPrefixes: string[]) {
  const normalized = relativeFile.replaceAll("\\", "/");
  if (path.isAbsolute(normalized) || normalized.includes("..")) {
    throw new Error(`PATCH_PATH_REJECTED: ${relativeFile}`);
  }
  if (!allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`PATCH_PATH_OUTSIDE_REPLICA: ${relativeFile}`);
  }
  const absolute = path.resolve(repoRoot, normalized);
  const root = path.resolve(repoRoot);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`PATCH_PATH_REJECTED: ${relativeFile}`);
  return absolute;
}

function stripPrefix(value: string) {
  if (value === "/dev/null") return value;
  return value.replace(/^[ab]\//, "");
}
