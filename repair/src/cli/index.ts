import { buildGraphs } from "../graph/builder.js";
import { validateGraphs } from "../graph/validator.js";
import { auditLocalization } from "../localization/localizer.js";
import { buildFailureCones } from "../localization/cone.js";
import { generatePatches } from "../compiler/compiler.js";
import { validatePatches } from "../validators/patch-validator.js";
import { pairedReplay } from "../replay/paired-replay.js";
import { writeRepairReport } from "./report.js";
import { resolveRepoRoot } from "../io.js";
import { runRuntimeRepairPilot, runRuntimeSandboxSelfTest, type RuntimeRepairOptions } from "../runtime/runtime-runner.js";

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));
const repoRoot = resolveRepoRoot();

try {
  if (command === "build-graphs") {
    const graphs = await buildGraphs(repoRoot);
    console.log(JSON.stringify({ ok: true, graphs: graphs.map((graph) => ({ replica: graph.replica, nodes: graph.nodes.length, edges: graph.edges.length })) }, null, 2));
  } else if (command === "validate-graphs") {
    const result = await validateGraphs(repoRoot);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else if (command === "audit-localization") {
    const localizations = await auditLocalization(repoRoot);
    const cones = await buildFailureCones(repoRoot, localizations);
    await writeRepairReport(repoRoot);
    console.log(JSON.stringify({ ok: true, localized: localizations.length, cones: cones.length }, null, 2));
  } else if (command === "generate") {
    const patches = await generatePatches(repoRoot);
    await writeRepairReport(repoRoot);
    console.log(JSON.stringify({ ok: true, patches: patches.length }, null, 2));
  } else if (command === "validate") {
    const validations = await validatePatches(repoRoot);
    await writeRepairReport(repoRoot);
    console.log(JSON.stringify({ ok: true, validations: validations.length, accepted: validations.filter((row) => row.accepted).length }, null, 2));
  } else if (command === "replay") {
    const rows = await pairedReplay(repoRoot);
    await writeRepairReport(repoRoot);
    console.log(JSON.stringify({ ok: true, pairedReplayRows: rows.length, patchedExecuted: rows.filter((row) => row.patchedExecuted).length }, null, 2));
  } else if (command === "pilot") {
    const graphs = await buildGraphs(repoRoot);
    const graphValidation = await validateGraphs(repoRoot);
    if (!graphValidation.ok) throw new Error(`GRAPH_VALIDATION_FAILED: ${JSON.stringify(graphValidation.issues)}`);
    const localizations = await auditLocalization(repoRoot);
    const cones = await buildFailureCones(repoRoot, localizations);
    const patches = await generatePatches(repoRoot, cones);
    const validations = await validatePatches(repoRoot, patches);
    const replays = await pairedReplay(repoRoot);
    await writeRepairReport(repoRoot);
    console.log(
      JSON.stringify(
        {
          ok: true,
          graphs: graphs.length,
          localized: localizations.length,
          cones: cones.length,
          patches: patches.length,
          validations: validations.length,
          accepted: validations.filter((row) => row.accepted).length,
          pairedReplayRows: replays.length,
          patchedExecuted: replays.filter((row) => row.patchedExecuted).length
        },
        null,
        2
      )
    );
  } else if (command === "runtime-sandbox-test") {
    const rows = await runRuntimeSandboxSelfTest(repoRoot);
    console.log(JSON.stringify({ ok: rows.every((row) => row.accepted), validations: rows.length, accepted: rows.filter((row) => row.accepted).length }, null, 2));
  } else if (command === "runtime-replay") {
    const result = await runRuntimeRepairPilot(repoRoot, runtimeOptions({ phases: ["paired"] }));
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "runtime-regression") {
    const result = await runRuntimeRepairPilot(repoRoot, runtimeOptions({ phases: ["regression"] }));
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "runtime-rollback") {
    const result = await runRuntimeRepairPilot(repoRoot, runtimeOptions({ phases: ["rollback"] }));
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "runtime-pilot") {
    const result = await runRuntimeRepairPilot(repoRoot, runtimeOptions({ keepSandboxes: isTruthy(args["keep-sandboxes"]) }));
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "resume") {
    const experimentId = args["experiment-id"];
    if (!experimentId) throw new Error("REPAIR_RESUME_REQUIRES_EXPERIMENT_ID");
    const result = await runRuntimeRepairPilot(repoRoot, runtimeOptions({ experimentId, resume: true }));
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error("Usage: tsx src/cli/index.ts build-graphs|validate-graphs|audit-localization|generate|validate|replay|pilot|runtime-sandbox-test|runtime-replay|runtime-regression|runtime-rollback|runtime-pilot|resume");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArgs(values: string[]) {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value?.startsWith("--")) {
      const key = value.slice(2);
      parsed[key] = values[index + 1]?.startsWith("--") ? "true" : values[index + 1] || "true";
      if (values[index + 1] && !values[index + 1]?.startsWith("--")) index += 1;
    }
  }
  return parsed;
}

function parseSeeds(value: string | undefined) {
  if (!value) return undefined;
  return value.split(",").map((item) => Number(item.trim())).filter((seed) => Number.isInteger(seed) && seed > 0);
}

function parseLimit(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isTruthy(value: string | undefined) {
  return value === "true" || value === "1" || value === "yes";
}

function runtimeOptions(base: RuntimeRepairOptions = {}): RuntimeRepairOptions {
  const options: RuntimeRepairOptions = { ...base };
  const experimentId = args["experiment-id"];
  const seeds = parseSeeds(args.seeds);
  const limit = parseLimit(args.limit);
  if (experimentId && !options.experimentId) options.experimentId = experimentId;
  if (args.resume !== undefined && options.resume === undefined) options.resume = isTruthy(args.resume);
  if (seeds) options.seeds = seeds;
  if (limit) options.limit = limit;
  return options;
}
