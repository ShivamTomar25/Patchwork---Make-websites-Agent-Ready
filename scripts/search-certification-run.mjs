#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const outDir = path.join(repoRoot, "build/search-certification-runner");
const args = process.argv.slice(2);

const compile = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, "node_modules/typescript/bin/tsc"),
    "-p",
    path.join(repoRoot, "search-certification/tsconfig.json"),
    "--outDir",
    outDir,
    "--noEmit",
    "false",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext"
  ],
  { cwd: repoRoot, stdio: "inherit" }
);
if (compile.status !== 0) process.exit(compile.status || 1);

const cli = path.join(outDir, "search-certification/src/cli/index.js");
const run = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { cwd: repoRoot, stdio: "inherit", env: process.env });
process.exit(run.status || 0);
