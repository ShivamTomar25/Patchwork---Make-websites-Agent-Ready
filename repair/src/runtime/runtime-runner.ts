import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, stat, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { replicaDirectory } from "../catalog.js";
import { generatePatches } from "../compiler/compiler.js";
import { parseUnifiedDiff, rejectPathTraversal } from "../compiler/diff.js";
import { ensureDir, loadMatrix, loadRepairManifest, readJsonl, repairResultDir, repoPath, writeCsv, writeJsonl, writeYamlFile } from "../io.js";
import { applyPatchDiff } from "../sandbox/sandbox.js";
import type { TypedPatch } from "../schemas.js";
import {
  allocateLocalPort,
  assertPilotRuntimeEnvironment,
  assertPortAvailable,
  pilotEnvironment,
  printPilotRuntimeDatabases,
  redactRuntimeEnv
} from "./safety.js";

type SiteKey = "shop" | "saas" | "support";
type RuntimePhase = "paired" | "regression" | "rollback" | "sandbox";
type Side = "original" | "patched";

export type RuntimeRepairOptions = {
  experimentId?: string;
  resume?: boolean;
  phases?: RuntimePhase[];
  seeds?: number[];
  limit?: number;
  keepSandboxes?: boolean;
};

type RepairTask = {
  replica: SiteKey;
  journeyId: string;
  defectId: string;
  patch: TypedPatch;
  maximumSteps: number;
  timeoutMs: number;
  expectedFirstFailedPredicate: string;
};

type RuntimeSandbox = {
  id: string;
  root: string;
  replica: SiteKey;
  apiPort: number;
  webPort: number;
  apiUrl: string;
  frontendUrl: string;
  sitesConfigPath: string;
};

export type RuntimeOutcome = {
  side: Side | "regression" | "rollback-clean" | "rollback-defect";
  attempted: boolean;
  startupOk: boolean;
  resetOk: boolean;
  healthOk: boolean;
  runId: string;
  verifiedSuccess: boolean;
  violations: string[];
  firstFailedPredicate: string;
  terminationReason: string;
  steps: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  resultPath?: string;
  predicates?: Array<{ name: string; expected: string; actual: string; passed: boolean }>;
  error?: string;
  failurePhase?: "bootstrap_seed" | "startup" | "reset" | "health" | "agent_run" | "verify" | "cleanup_reset" | "cleanup_health";
};

type RuntimePairedRow = {
  experimentId: string;
  replica: SiteKey;
  journeyId: string;
  seed: number;
  defectId: string;
  patchId: string;
  sandboxId: string;
  apiPort: number;
  webPort: number;
  executionOrder: Side[];
  original: RuntimeOutcome;
  patched: RuntimeOutcome;
  originalExpectedDefectDetected: boolean;
  patchedCompliantSuccess: boolean;
  patchedExecuted: boolean;
  compliantSuccessDifference: number;
  violationDifference: number;
  latencyDifferenceMs: number;
  stepDifference: number;
  tokenDifference: number;
  unresolvedReason?: string;
};

type RuntimeValidationRow = {
  experiment_id: string;
  replica: SiteKey;
  journey_id: string;
  defect_id: string;
  patch_id: string;
  diff_parse: "pass" | "fail";
  path_safety: "pass" | "fail";
  sandbox_apply: "pass" | "fail";
  sandbox_startup: "pass" | "fail" | "not_run";
  runtime_property_invariants: "pass" | "fail" | "not_run";
  rollback_parse: "pass" | "fail";
  accepted: boolean;
  reason: string;
};

type RuntimeRegressionRow = {
  experimentId: string;
  patchId: string;
  replica: SiteKey;
  patchedJourneyId: string;
  regressionJourneyId: string;
  seed: number;
  sandboxId: string;
  outcome: RuntimeOutcome;
  passed: boolean;
};

type RuntimeRollbackRow = {
  experiment_id: string;
  patch_id: string;
  replica: SiteKey;
  journey_id: string;
  defect_id: string;
  sandbox_id: string;
  rollback_applied: boolean;
  original_defect_failure_restored: boolean;
  clean_success_restored: boolean;
  rollback_passed: boolean;
  defect_first_failed_predicate: string;
  clean_first_failed_predicate: string;
  reason: string;
};

type RuntimeResourceRow = {
  experiment_id: string;
  phase: string;
  patch_id: string;
  replica: SiteKey;
  journey_id: string;
  seed: number;
  sandbox_id: string;
  api_port: number;
  web_port: number;
  latency_ms: number;
  steps: number;
  input_tokens: number;
  output_tokens: number;
  result_path: string;
};

type RuntimeUnresolvedRow = {
  experiment_id: string;
  phase: string;
  replica: SiteKey;
  journey_id: string;
  seed: number;
  defect_id: string;
  patch_id: string;
  reason: string;
};

type RuntimeRunState = {
  validations: RuntimeValidationRow[];
  paired: RuntimePairedRow[];
  regressions: RuntimeRegressionRow[];
  rollbacks: RuntimeRollbackRow[];
  resources: RuntimeResourceRow[];
  unresolved: RuntimeUnresolvedRow[];
};

type RuntimeStack = {
  api: ChildProcess;
  web: ChildProcess;
  logs: string[];
};

export type RuntimeConfigurationEvaluationOptions = {
  experimentId: string;
  phase: string;
  replica: SiteKey;
  configurationId: string;
  patchIds: string[];
  seeds: number[];
  includeCleanRegression?: boolean;
  keepSandboxes?: boolean;
  onObservation?: (observation: RuntimeConfigurationObservation) => Promise<void> | void;
};

export type RuntimeConfigurationObservation = {
  experimentId: string;
  phase: string;
  replica: SiteKey;
  configurationId: string;
  patchIds: string[];
  repairedDefectIds: string[];
  journeyId: string;
  seed: number;
  defectProfile: Record<string, boolean>;
  cleanRegression: boolean;
  sandboxId: string;
  apiPort: number;
  webPort: number;
  outcome: RuntimeOutcome;
  compliantSuccess: boolean;
  violationTypes: string[];
  latencyMs: number;
  engineeringMinutes: number;
  filesChanged: number;
};

const allPhases: RuntimePhase[] = ["sandbox", "paired", "regression", "rollback"];
const credentials: Record<string, string> = {
  PATCHWORK_SHOP_ADMIN_EMAIL: "admin@patchwork.local",
  PATCHWORK_SHOP_ADMIN_PASSWORD: "Admin123!",
  PATCHWORK_SHOP_USER_EMAIL: "shopper@patchwork.local",
  PATCHWORK_SHOP_USER_PASSWORD: "Shopper123!",
  PATCHWORK_SAAS_ADMIN_EMAIL: "admin@patchwork.local",
  PATCHWORK_SAAS_ADMIN_PASSWORD: "Admin123!",
  PATCHWORK_SAAS_USER_EMAIL: "owner@patchwork.local",
  PATCHWORK_SAAS_USER_PASSWORD: "Owner123!",
  PATCHWORK_SAAS_MEMBER_EMAIL: "member@patchwork.local",
  PATCHWORK_SAAS_MEMBER_PASSWORD: "Member123!",
  PATCHWORK_SUPPORT_ADMIN_EMAIL: "admin@patchwork.local",
  PATCHWORK_SUPPORT_ADMIN_PASSWORD: "Admin123!",
  PATCHWORK_SUPPORT_USER_EMAIL: "customer@patchwork.local",
  PATCHWORK_SUPPORT_USER_PASSWORD: "Customer123!",
  PATCHWORK_SUPPORT_AGENT_EMAIL: "agent@patchwork.local",
  PATCHWORK_SUPPORT_AGENT_PASSWORD: "Agent123!"
};

export async function runRuntimeRepairPilot(repoRoot: string, options: RuntimeRepairOptions = {}) {
  applySyntheticCredentialDefaults();
  const pilotEnv = pilotEnvironment();
  const inspections = assertPilotRuntimeEnvironment(pilotEnv);
  printPilotRuntimeDatabases(inspections);
  const phases = options.phases || allPhases;
  const experimentId = options.experimentId || `repair-runtime-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const runtimeOptions: RuntimeRepairOptions = { ...options, experimentId };
  const resultDir = repairResultDir(repoRoot);
  await ensureDir(resultDir);
  await ensureDir(path.join(resultDir, "runtime-trajectories"));

  const [manifest, matrix] = await Promise.all([loadRepairManifest(repoRoot), loadMatrix(repoRoot)]);
  runtimeOptions.seeds ||= manifest.seeds || [1, 2, 3];
  await writeYamlFile(path.join(resultDir, "runtime-manifest.snapshot.yaml"), manifest);
  const patches = await ensureRuntimePatches(repoRoot);
  const tasks = planRepairTasks(manifest, matrix.entries, patches);
  const selectedTasks = typeof runtimeOptions.limit === "number" ? tasks.slice(0, runtimeOptions.limit) : tasks;
  const state = await loadRuntimeState(resultDir, runtimeOptions.resume === true, experimentId);

  if (phases.includes("sandbox")) {
    await runSandboxValidations(repoRoot, pilotEnv, selectedTasks, state, runtimeOptions);
    await persistRuntimeState(repoRoot, resultDir, state);
  }
  if (phases.includes("paired")) {
    await runPairedReplay(repoRoot, pilotEnv, selectedTasks, state, runtimeOptions);
    await persistRuntimeState(repoRoot, resultDir, state);
  }
  if (phases.includes("regression")) {
    await runRegressions(repoRoot, pilotEnv, selectedTasks, state, runtimeOptions);
    await persistRuntimeState(repoRoot, resultDir, state);
  }
  if (phases.includes("rollback")) {
    await runRollbacks(repoRoot, pilotEnv, selectedTasks, state, runtimeOptions);
    await persistRuntimeState(repoRoot, resultDir, state);
  }

  await persistRuntimeState(repoRoot, resultDir, state);
  await writeRuntimeReport(repoRoot, resultDir, state, experimentId);
  return {
    ok: state.unresolved.length === 0,
    experimentId,
    resultDir,
    validations: state.validations.length,
    pairedRows: state.paired.length,
    regressions: state.regressions.length,
    rollbacks: state.rollbacks.length,
    unresolved: state.unresolved.length
  };
}

export async function runRuntimeSandboxSelfTest(repoRoot: string) {
  const pilotEnv = pilotEnvironment();
  const inspections = assertPilotRuntimeEnvironment(pilotEnv);
  printPilotRuntimeDatabases(inspections);
  const patches = await ensureRuntimePatches(repoRoot);
  const rows: RuntimeValidationRow[] = [];
  for (const patch of patches) {
    const sandbox = await createRuntimeSandbox(repoRoot, patch.replica as SiteKey);
    try {
      parseUnifiedDiff(patch.sourceDiff);
      parseUnifiedDiff(patch.rollbackDiff);
      const applied = await applyPatchDiff(sandbox.root, patch);
      await applyPatchDiff(sandbox.root, patch, patch.rollbackDiff);
      rows.push({
        experiment_id: "sandbox-self-test",
        replica: patch.replica as SiteKey,
        journey_id: patch.journeyIds[0] || "unknown",
        defect_id: defectIdFromPatch(patch),
        patch_id: patch.patchId,
        diff_parse: "pass",
        path_safety: applied.every((file) => file.startsWith(`${replicaDirectory(patch.replica)}/`)) ? "pass" : "fail",
        sandbox_apply: "pass",
        sandbox_startup: "not_run",
        runtime_property_invariants: "not_run",
        rollback_parse: "pass",
        accepted: true,
        reason: "patch applied and rolled back inside isolated sandbox"
      });
    } catch (error) {
      rows.push({
        experiment_id: "sandbox-self-test",
        replica: patch.replica as SiteKey,
        journey_id: patch.journeyIds[0] || "unknown",
        defect_id: defectIdFromPatch(patch),
        patch_id: patch.patchId,
        diff_parse: "fail",
        path_safety: "fail",
        sandbox_apply: "fail",
        sandbox_startup: "not_run",
        runtime_property_invariants: "not_run",
        rollback_parse: "fail",
        accepted: false,
        reason: errorMessage(error)
      });
    } finally {
      await cleanupSandbox(sandbox, false);
    }
  }
  const resultDir = repairResultDir(repoRoot);
  await writeCsv(path.join(resultDir, "runtime-validation.csv"), rows);
  return rows;
}

export async function evaluateRuntimeConfiguration(repoRoot: string, options: RuntimeConfigurationEvaluationOptions): Promise<RuntimeConfigurationObservation[]> {
  applySyntheticCredentialDefaults();
  const pilotEnv = pilotEnvironment();
  const inspections = assertPilotRuntimeEnvironment(pilotEnv);
  printPilotRuntimeDatabases(inspections);
  const [manifest, matrix] = await Promise.all([loadRepairManifest(repoRoot), loadMatrix(repoRoot)]);
  const patches = await ensureRuntimePatches(repoRoot);
  const tasks = planRepairTasks(manifest, matrix.entries, patches).filter((task) => task.replica === options.replica);
  const selectedPatches = options.patchIds.map((patchId) => {
    const patch = patches.find((item) => item.patchId === patchId && item.replica === options.replica);
    if (!patch) throw new Error(`RUNTIME_CONFIGURATION_PATCH_MISSING: ${options.replica} ${patchId}`);
    return patch;
  });
  const repairedDefectIds = selectedPatches.map(defectIdFromPatch);
  const defectProfile = Object.fromEntries(tasks.map((task) => [task.defectId, true]));
  const sandbox = await createRuntimeSandbox(repoRoot, options.replica);
  const observations: RuntimeConfigurationObservation[] = [];
  try {
    if (selectedPatches.length > 0) {
      await applyPatchDiff(sandbox.root, combinedRuntimePatch(options.replica, selectedPatches));
    }
    for (const seed of options.seeds) {
      for (const task of tasks) {
        const outcome = await executeRuntimeJourney(repoRoot, sandbox, pilotEnv, task, seed, "patched", defectProfile);
        const observation = configurationObservation(options, task, seed, sandbox, outcome, defectProfile, false, repairedDefectIds, selectedPatches);
        observations.push(observation);
        await options.onObservation?.(observation);
      }
    }
    if (options.includeCleanRegression) {
      for (const seed of options.seeds) {
        for (const task of tasks) {
          const outcome = await executeRuntimeJourney(repoRoot, sandbox, pilotEnv, task, seed, "regression", {});
          const observation = configurationObservation(options, task, seed, sandbox, outcome, {}, true, repairedDefectIds, selectedPatches);
          observations.push(observation);
          await options.onObservation?.(observation);
        }
      }
    }
    return observations;
  } finally {
    await cleanupSandbox(sandbox, options.keepSandboxes === true);
  }
}

async function ensureRuntimePatches(repoRoot: string) {
  let patches = await readJsonl<TypedPatch>(path.join(repairResultDir(repoRoot), "patches.jsonl"));
  if (patches.length === 0 || patches.some((patch) => !patch.sourceFiles.some((file) => file.endsWith("/api/src/repair/runtime-repair.ts")))) {
    patches = await generatePatches(repoRoot);
  }
  return patches;
}

async function runSandboxValidations(
  repoRoot: string,
  pilotEnv: Record<string, string>,
  tasks: RepairTask[],
  state: RuntimeRunState,
  options: RuntimeRepairOptions
) {
  const existing = new Set(state.validations.map((row) => row.patch_id));
  for (const task of tasks) {
    if (options.resume && existing.has(task.patch.patchId)) continue;
    const sandbox = await createRuntimeSandbox(repoRoot, task.replica);
    let stack: RuntimeStack | undefined;
    try {
      parseUnifiedDiff(task.patch.sourceDiff);
      parseUnifiedDiff(task.patch.rollbackDiff);
      const applied = await applyPatchDiff(sandbox.root, task.patch);
      stack = await startRuntimeStack(sandbox, pilotEnv);
      const client = new RuntimeResearchClient(sandbox, task.replica);
      await client.reset({ [task.defectId]: true });
      const defects = await client.defects();
      const selected = (defects.defects || []).find((defect: any) => defect.id === task.defectId);
      state.validations.push({
        experiment_id: stateExperimentId(state, options),
        replica: task.replica,
        journey_id: task.journeyId,
        defect_id: task.defectId,
        patch_id: task.patch.patchId,
        diff_parse: "pass",
        path_safety: applied.every((file) => file.startsWith(`${replicaDirectory(task.replica)}/`)) ? "pass" : "fail",
        sandbox_apply: "pass",
        sandbox_startup: "pass",
        runtime_property_invariants: selected?.enabled === false ? "pass" : "fail",
        rollback_parse: "pass",
        accepted: selected?.enabled === false,
        reason: selected?.enabled === false ? "runtime repair hook neutralized selected defect flag in sandbox" : "selected defect remained active after patch"
      });
    } catch (error) {
      state.validations.push({
        experiment_id: stateExperimentId(state, options),
        replica: task.replica,
        journey_id: task.journeyId,
        defect_id: task.defectId,
        patch_id: task.patch.patchId,
        diff_parse: "fail",
        path_safety: "fail",
        sandbox_apply: "fail",
        sandbox_startup: stack ? "pass" : "fail",
        runtime_property_invariants: "fail",
        rollback_parse: "fail",
        accepted: false,
        reason: errorMessage(error)
      });
      state.unresolved.push(unresolvedRow(stateExperimentId(state, options), "sandbox", task, 0, errorMessage(error)));
    } finally {
      await stopRuntimeStack(stack);
      await cleanupSandbox(sandbox, options.keepSandboxes === true);
    }
  }
}

async function runPairedReplay(
  repoRoot: string,
  pilotEnv: Record<string, string>,
  tasks: RepairTask[],
  state: RuntimeRunState,
  options: RuntimeRepairOptions
) {
  const existing = new Set(state.paired.map((row) => pairedKey(row)));
  for (const task of tasks) {
    for (const seed of options.seeds || [1, 2, 3]) {
      const key = [task.replica, task.journeyId, seed, task.defectId, task.patch.patchId].join(":");
      if (options.resume && existing.has(key)) continue;
      const sandbox = await createRuntimeSandbox(repoRoot, task.replica);
      const executionOrder = seed % 2 === 0 ? (["patched", "original"] as Side[]) : (["original", "patched"] as Side[]);
      const outcomes = new Map<Side, RuntimeOutcome>();
      let patchedApplied = false;
      try {
        for (const side of executionOrder) {
          if (side === "patched" && !patchedApplied) {
            await applyPatchDiff(sandbox.root, task.patch);
            patchedApplied = true;
          }
          if (side === "original" && patchedApplied) {
            await applyPatchDiff(sandbox.root, task.patch, task.patch.rollbackDiff);
            patchedApplied = false;
          }
          const outcome = await executeRuntimeJourney(repoRoot, sandbox, pilotEnv, task, seed, side, { [task.defectId]: true });
          outcomes.set(side, outcome);
          appendResource(state, stateExperimentId(state, options), "paired", task, seed, sandbox, outcome);
        }
        const original = outcomes.get("original") || failedOutcome("original", "ORIGINAL_NOT_EXECUTED");
        const patched = outcomes.get("patched") || failedOutcome("patched", "PATCHED_NOT_EXECUTED");
        const row = makePairedRow(stateExperimentId(state, options), task, seed, sandbox, executionOrder, original, patched);
        state.paired.push(row);
        if (row.unresolvedReason) state.unresolved.push(unresolvedRow(stateExperimentId(state, options), "paired", task, seed, row.unresolvedReason));
      } catch (error) {
        const original = outcomes.get("original") || failedOutcome("original", errorMessage(error));
        const patched = outcomes.get("patched") || failedOutcome("patched", errorMessage(error));
        state.paired.push(makePairedRow(stateExperimentId(state, options), task, seed, sandbox, executionOrder, original, patched, errorMessage(error)));
        state.unresolved.push(unresolvedRow(stateExperimentId(state, options), "paired", task, seed, errorMessage(error)));
      } finally {
        await cleanupSandbox(sandbox, options.keepSandboxes === true);
      }
      await persistRuntimeState(repoRoot, repairResultDir(repoRoot), state);
    }
  }
}

async function runRegressions(
  repoRoot: string,
  pilotEnv: Record<string, string>,
  tasks: RepairTask[],
  state: RuntimeRunState,
  options: RuntimeRepairOptions
) {
  const existing = new Set(state.regressions.map((row) => regressionKey(row)));
  const journeysByReplica = groupJourneys(tasks);
  for (const task of tasks) {
    const unaffected = journeysByReplica[task.replica].filter((journey) => journey.journeyId !== task.journeyId);
    for (const regressionTask of unaffected) {
      for (const seed of options.seeds || [1, 2, 3]) {
        const key = [task.patch.patchId, regressionTask.journeyId, seed].join(":");
        if (options.resume && existing.has(key)) continue;
        const sandbox = await createRuntimeSandbox(repoRoot, task.replica);
        try {
          await applyPatchDiff(sandbox.root, task.patch);
          const outcome = await executeRuntimeJourney(repoRoot, sandbox, pilotEnv, regressionTask, seed, "regression", {});
          state.regressions.push({
            experimentId: stateExperimentId(state, options),
            patchId: task.patch.patchId,
            replica: task.replica,
            patchedJourneyId: task.journeyId,
            regressionJourneyId: regressionTask.journeyId,
            seed,
            sandboxId: sandbox.id,
            outcome,
            passed: outcome.verifiedSuccess && outcome.violations.length === 0
          });
          appendResource(state, stateExperimentId(state, options), "regression", regressionTask, seed, sandbox, outcome, task.patch.patchId);
          if (!outcome.verifiedSuccess || outcome.violations.length > 0) {
            state.unresolved.push(unresolvedRow(stateExperimentId(state, options), "regression", regressionTask, seed, outcome.firstFailedPredicate || outcome.violations[0] || "regression failed", task.patch.patchId));
          }
        } catch (error) {
          const outcome = failedOutcome("regression", errorMessage(error));
          state.regressions.push({
            experimentId: stateExperimentId(state, options),
            patchId: task.patch.patchId,
            replica: task.replica,
            patchedJourneyId: task.journeyId,
            regressionJourneyId: regressionTask.journeyId,
            seed,
            sandboxId: sandbox.id,
            outcome,
            passed: false
          });
          state.unresolved.push(unresolvedRow(stateExperimentId(state, options), "regression", regressionTask, seed, errorMessage(error), task.patch.patchId));
        } finally {
          await cleanupSandbox(sandbox, options.keepSandboxes === true);
        }
        await persistRuntimeState(repoRoot, repairResultDir(repoRoot), state);
      }
    }
  }
}

async function runRollbacks(
  repoRoot: string,
  pilotEnv: Record<string, string>,
  tasks: RepairTask[],
  state: RuntimeRunState,
  options: RuntimeRepairOptions
) {
  const existing = new Set(state.rollbacks.map((row) => row.patch_id));
  for (const task of tasks) {
    if (options.resume && existing.has(task.patch.patchId)) continue;
    const sandbox = await createRuntimeSandbox(repoRoot, task.replica);
    let rollbackApplied = false;
    try {
      await applyPatchDiff(sandbox.root, task.patch);
      await applyPatchDiff(sandbox.root, task.patch, task.patch.rollbackDiff);
      rollbackApplied = true;
      const defectOutcome = await executeRuntimeJourney(repoRoot, sandbox, pilotEnv, task, 1, "rollback-defect", { [task.defectId]: true });
      const cleanOutcome = await executeRuntimeJourney(repoRoot, sandbox, pilotEnv, task, 1, "rollback-clean", {});
      const originalFailureRestored = !defectOutcome.verifiedSuccess || defectOutcome.violations.length > 0;
      const cleanSuccessRestored = cleanOutcome.verifiedSuccess && cleanOutcome.violations.length === 0;
      state.rollbacks.push({
        experiment_id: stateExperimentId(state, options),
        patch_id: task.patch.patchId,
        replica: task.replica,
        journey_id: task.journeyId,
        defect_id: task.defectId,
        sandbox_id: sandbox.id,
        rollback_applied: rollbackApplied,
        original_defect_failure_restored: originalFailureRestored,
        clean_success_restored: cleanSuccessRestored,
        rollback_passed: originalFailureRestored && cleanSuccessRestored,
        defect_first_failed_predicate: defectOutcome.firstFailedPredicate,
        clean_first_failed_predicate: cleanOutcome.firstFailedPredicate,
        reason: originalFailureRestored && cleanSuccessRestored ? "rollback restored original failure mode and clean success" : "rollback verification failed"
      });
      appendResource(state, stateExperimentId(state, options), "rollback-defect", task, 1, sandbox, defectOutcome);
      appendResource(state, stateExperimentId(state, options), "rollback-clean", task, 1, sandbox, cleanOutcome);
      if (!originalFailureRestored || !cleanSuccessRestored) {
        state.unresolved.push(unresolvedRow(stateExperimentId(state, options), "rollback", task, 1, "rollback did not restore expected behavior"));
      }
    } catch (error) {
      state.rollbacks.push({
        experiment_id: stateExperimentId(state, options),
        patch_id: task.patch.patchId,
        replica: task.replica,
        journey_id: task.journeyId,
        defect_id: task.defectId,
        sandbox_id: sandbox.id,
        rollback_applied: rollbackApplied,
        original_defect_failure_restored: false,
        clean_success_restored: false,
        rollback_passed: false,
        defect_first_failed_predicate: "",
        clean_first_failed_predicate: "",
        reason: errorMessage(error)
      });
      state.unresolved.push(unresolvedRow(stateExperimentId(state, options), "rollback", task, 1, errorMessage(error)));
    } finally {
      await cleanupSandbox(sandbox, options.keepSandboxes === true);
    }
    await persistRuntimeState(repoRoot, repairResultDir(repoRoot), state);
  }
}

async function executeRuntimeJourney(
  repoRoot: string,
  sandbox: RuntimeSandbox,
  pilotEnv: Record<string, string>,
  task: RepairTask,
  seed: number,
  side: RuntimeOutcome["side"],
  defectConfiguration: Record<string, boolean>
): Promise<RuntimeOutcome> {
  let stack: RuntimeStack | undefined;
  const env = runtimeEnvForSandbox(sandbox, pilotEnv);
  const started = Date.now();
  let startupOk = false;
  let resetOk = false;
  let healthOk = false;
  let failurePhase: RuntimeOutcome["failurePhase"] = "bootstrap_seed";
  try {
    await seedRuntimeSandboxDatabase(sandbox, env);
    failurePhase = "startup";
    stack = await startRuntimeStack(sandbox, pilotEnv);
    startupOk = true;
    const client = new RuntimeResearchClient(sandbox, task.replica);
    failurePhase = "reset";
    const reset = await client.reset(defectConfiguration);
    resetOk = reset.ok === true;
    failurePhase = "health";
    const health = await client.health();
    healthOk = health.ok === true;
    const runner = await loadExperimentRunner(sandbox.root);
    failurePhase = "agent_run";
    const result = await withProcessEnv(env, () =>
      runner.run({
        site: task.replica,
        journeyId: task.journeyId,
        agentId: "scripted",
        mode: "mock",
        seed,
        maxSteps: task.maximumSteps,
        timeoutMs: task.timeoutMs,
        tokenBudget: 20000,
        authorizeResearchTools: false,
        defectConfiguration
      })
    );
    failurePhase = "verify";
    const verification = await client.verify(task.journeyId);
    const resultPath = await persistTrajectory(repoRoot, sandbox.root, result.resultPath, result.runId);
    failurePhase = "cleanup_reset";
    await client.reset({});
    failurePhase = "cleanup_health";
    await client.health();
    return {
      side,
      attempted: true,
      startupOk,
      resetOk,
      healthOk,
      runId: result.runId,
      verifiedSuccess: verification.verifiedSuccess,
      violations: unique([...(result.violations || []), ...(verification.violations || [])]),
      firstFailedPredicate: firstFailedPredicate(verification),
      terminationReason: result.terminationReason,
      steps: result.steps,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      predicates: verification.predicates,
      ...(resultPath ? { resultPath } : {})
    };
  } catch (error) {
    return {
      side,
      attempted: true,
      startupOk,
      resetOk,
      healthOk,
      runId: `${task.replica}-${task.journeyId}-${side}-seed${seed}-failed`,
      verifiedSuccess: false,
      violations: [errorMessage(error)],
      firstFailedPredicate: "runtime execution failed",
      terminationReason: "runtime_failure",
      steps: 0,
      latencyMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      failurePhase,
      error: errorMessage(error)
    };
  } finally {
    await stopRuntimeStack(stack);
  }
}

async function seedRuntimeSandboxDatabase(sandbox: RuntimeSandbox, env: Record<string, string | undefined>) {
  const seed = spawn(process.execPath, ["--import", "tsx", "src/seed.ts"], {
    cwd: path.join(sandbox.root, replicaDirectory(sandbox.replica), "api"),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs: string[] = [];
  captureChildLogs("seed", seed, logs);
  const status = await waitForProcess(seed, 60_000);
  if (status !== 0) throw new Error(`BOOTSTRAP_SEED_FAILED: ${status}; ${logs.slice(-8).join("\n")}`);
}

async function createRuntimeSandbox(repoRoot: string, replica: SiteKey): Promise<RuntimeSandbox> {
  const sandboxRoot = path.join(tmpdir(), `patchwork-repair-runtime-${randomUUID().slice(0, 8)}`);
  await mkdir(sandboxRoot, { recursive: true });
  await cp(repoRoot, sandboxRoot, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => shouldCopyIntoSandbox(repoRoot, source)
  });
  await symlink(path.join(repoRoot, "node_modules"), path.join(sandboxRoot, "node_modules"), "dir");
  const apiPort = await allocateLocalPort();
  const webPort = await allocateLocalPort();
  await assertPortAvailable(apiPort);
  await assertPortAvailable(webPort);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const frontendUrl = `http://127.0.0.1:${webPort}`;
  const sitesConfigPath = path.join(sandboxRoot, "agents/configs/sites.runtime.yaml");
  await writeRuntimeSitesConfig(repoRoot, sitesConfigPath, replica, apiUrl, frontendUrl);
  return {
    id: path.basename(sandboxRoot),
    root: sandboxRoot,
    replica,
    apiPort,
    webPort,
    apiUrl,
    frontendUrl,
    sitesConfigPath
  };
}

function shouldCopyIntoSandbox(repoRoot: string, source: string) {
  const relative = path.relative(repoRoot, source).replaceAll("\\", "/");
  if (!relative) return true;
  const blocked = [
    "node_modules",
    ".git",
    ".codex",
    ".agents",
    "agents/results",
    "repair/results",
    "experiments/results",
    "platform/api/node_modules",
    "platform/web/node_modules"
  ];
  return !blocked.some((entry) => relative === entry || relative.startsWith(`${entry}/`));
}

async function writeRuntimeSitesConfig(repoRoot: string, outputPath: string, replica: SiteKey, apiUrl: string, frontendUrl: string) {
  const source = YAML.parse(await readFile(repoPath(repoRoot, "agents/configs/sites.yaml"), "utf8")) as Record<string, any>;
  const target = source[replica];
  target.frontendUrl = frontendUrl;
  target.apiUrl = apiUrl;
  target.openapiUrl = `${apiUrl}/api/openapi.json`;
  target.allowedHosts = [new URL(frontendUrl).host, new URL(apiUrl).host, `localhost:${new URL(frontendUrl).port}`, `localhost:${new URL(apiUrl).port}`];
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, YAML.stringify(source), "utf8");
}

async function startRuntimeStack(sandbox: RuntimeSandbox, pilotEnv: Record<string, string>): Promise<RuntimeStack> {
  await assertPortAvailable(sandbox.apiPort);
  await assertPortAvailable(sandbox.webPort);
  const env = runtimeEnvForSandbox(sandbox, pilotEnv);
  const logs: string[] = [];
  const api = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(sandbox.root, replicaDirectory(sandbox.replica), "api"),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const web = spawn(binPath(sandbox.root, "vite"), ["--host", "127.0.0.1", "--port", String(sandbox.webPort), "--strictPort", "--force"], {
    cwd: path.join(sandbox.root, replicaDirectory(sandbox.replica), "web"),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  captureChildLogs("api", api, logs);
  captureChildLogs("web", web, logs);
  const stack = { api, web, logs };
  try {
    await waitForHttp(`${sandbox.apiUrl}/api/health`, stack);
    await waitForHttp(sandbox.frontendUrl, stack);
    return stack;
  } catch (error) {
    await stopRuntimeStack(stack);
    throw error;
  }
}

function runtimeEnvForSandbox(sandbox: RuntimeSandbox, pilotEnv: Record<string, string>) {
  return {
    ...process.env,
    ...pilotEnv,
    ...credentials,
    DATABASE_URL: pilotEnv.AGENTS_DATABASE_URL,
    PORT: String(sandbox.apiPort),
    HOST: "127.0.0.1",
    PILOT_ALLOW_RESET: "true",
    PATCHWORK_CLIENT_URL: sandbox.frontendUrl,
    PATCHWORK_PLAYWRIGHT_TIMEOUT_MS: "10000",
    PATCHWORK_SITES_CONFIG: sandbox.sitesConfigPath,
    PATCHWORK_RUNTIME_SANDBOX: sandbox.root
  };
}

async function stopRuntimeStack(stack: RuntimeStack | undefined) {
  if (!stack) return;
  await Promise.all([stopProcess(stack.api), stopProcess(stack.web)]);
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForProcess(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null) return child.exitCode;
  if (child.signalCode !== null) return 1;
  return await new Promise<number>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolve(124);
    }, timeoutMs);
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 0);
    });
  });
}

async function waitForHttp(url: string, stack: RuntimeStack) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 60_000) {
    if (stack.api.exitCode !== null) throw new Error(`API_PROCESS_EXITED: ${stack.api.exitCode}; ${stack.logs.slice(-8).join("\n")}`);
    if (stack.web.exitCode !== null) throw new Error(`WEB_PROCESS_EXITED: ${stack.web.exitCode}; ${stack.logs.slice(-8).join("\n")}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = errorMessage(error);
    }
    await sleep(500);
  }
  throw new Error(`HTTP_READY_TIMEOUT ${url}: ${lastError}; ${stack.logs.slice(-8).join("\n")}`);
}

function captureChildLogs(label: string, child: ChildProcess, logs: string[]) {
  const capture = (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) logs.push(`[${label}] ${text.slice(0, 1000)}`);
    while (logs.length > 80) logs.shift();
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
}

async function cleanupSandbox(sandbox: RuntimeSandbox, keep: boolean) {
  if (keep) {
    console.log(`PATCHWORK_RUNTIME_SANDBOX_KEPT=${sandbox.root}`);
    return;
  }
  await rm(sandbox.root, { recursive: true, force: true });
}

async function loadExperimentRunner(sandboxRoot: string) {
  const modulePath = pathToFileURL(path.join(sandboxRoot, "agents/src/runner/experiment-runner.ts")).href;
  const imported = (await import(modulePath)) as { ExperimentRunner: new (repoRoot: string) => { run(input: unknown): Promise<any> } };
  return new imported.ExperimentRunner(sandboxRoot);
}

async function withProcessEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

class RuntimeResearchClient {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly sandbox: RuntimeSandbox,
    private readonly site: SiteKey
  ) {}

  async health() {
    return this.request("/api/health");
  }

  async reset(defectConfiguration: Record<string, boolean>) {
    await this.login("admin");
    const reset = await this.request("/api/research/reset", { method: "POST" });
    if (Object.keys(defectConfiguration).length > 0) {
      await this.request("/api/research/defects", { method: "PUT", bodyJson: { defects: defectConfiguration } });
    }
    return reset;
  }

  async defects() {
    await this.login("admin");
    return this.request("/api/research/defects");
  }

  async verify(journeyId: string) {
    await this.login("admin");
    return this.request(`/api/research/verify/${encodeURIComponent(journeyId)}`, { method: "POST" });
  }

  private async login(role: "admin") {
    const prefix = this.site.toUpperCase();
    return this.request("/api/auth/login", {
      method: "POST",
      bodyJson: {
        email: process.env[`PATCHWORK_${prefix}_${role.toUpperCase()}_EMAIL`] || credentials[`PATCHWORK_${prefix}_${role.toUpperCase()}_EMAIL`],
        password: process.env[`PATCHWORK_${prefix}_${role.toUpperCase()}_PASSWORD`] || credentials[`PATCHWORK_${prefix}_${role.toUpperCase()}_PASSWORD`]
      }
    });
  }

  private async request(pathOrUrl: string, init: RequestInit & { bodyJson?: unknown } = {}) {
    const headers = new Headers(init.headers);
    if (init.bodyJson !== undefined) headers.set("content-type", "application/json");
    const cookie = this.cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    const request: RequestInit = { headers };
    if (init.method) request.method = init.method;
    if (init.bodyJson !== undefined) request.body = JSON.stringify(init.bodyJson);
    const response = await fetch(new URL(pathOrUrl, this.sandbox.apiUrl), request);
    this.storeCookies(response.headers.getSetCookie?.() || parseSingleSetCookie(response.headers.get("set-cookie")));
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}: ${redactedJson(data)}`);
    }
    return data;
  }

  private cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  private storeCookies(values: string[]) {
    for (const value of values) {
      const first = value.split(";")[0];
      if (!first) continue;
      const index = first.indexOf("=");
      if (index > 0) this.cookies.set(first.slice(0, index), first.slice(index + 1));
    }
  }
}

function planRepairTasks(manifest: any, matrix: any[], patches: TypedPatch[]): RepairTask[] {
  const tasks: RepairTask[] = [];
  for (const [replica, config] of Object.entries(manifest.replicas || {}) as Array<[SiteKey, any]>) {
    for (const journey of config.journeys || []) {
      const patch = patches.find((item) => item.replica === replica && item.journeyIds.includes(journey.id));
      if (!patch) throw new Error(`RUNTIME_PATCH_MISSING: ${replica} ${journey.id}`);
      const matrixEntry = matrix.find((entry) => entry.replica === replica && entry.journeyId === journey.id && entry.defectId === journey.deterministicDefectId);
      tasks.push({
        replica,
        journeyId: journey.id,
        defectId: journey.deterministicDefectId,
        patch,
        maximumSteps: journey.maximumSteps || 30,
        timeoutMs: (journey.timeoutSeconds || 120) * 1000,
        expectedFirstFailedPredicate: matrixEntry?.expectedFirstFailedPredicate || ""
      });
    }
  }
  return tasks;
}

function groupJourneys(tasks: RepairTask[]) {
  return tasks.reduce<Record<SiteKey, RepairTask[]>>(
    (groups, task) => {
      groups[task.replica].push(task);
      return groups;
    },
    { shop: [], saas: [], support: [] }
  );
}

function makePairedRow(
  experimentId: string,
  task: RepairTask,
  seed: number,
  sandbox: RuntimeSandbox,
  executionOrder: Side[],
  original: RuntimeOutcome,
  patched: RuntimeOutcome,
  forcedUnresolved?: string
): RuntimePairedRow {
  const originalExpectedDefectDetected = !original.verifiedSuccess || original.violations.length > 0;
  const patchedCompliantSuccess = patched.verifiedSuccess && patched.violations.length === 0;
  const unresolvedReason =
    forcedUnresolved ||
    (!original.attempted ? "original runtime not executed" : "") ||
    (!patched.attempted ? "patched runtime not executed" : "") ||
    (!originalExpectedDefectDetected ? "original defect did not reproduce" : "") ||
    (!patchedCompliantSuccess ? patched.firstFailedPredicate || patched.violations[0] || "patched verifier did not pass" : "");
  return {
    experimentId,
    replica: task.replica,
    journeyId: task.journeyId,
    seed,
    defectId: task.defectId,
    patchId: task.patch.patchId,
    sandboxId: sandbox.id,
    apiPort: sandbox.apiPort,
    webPort: sandbox.webPort,
    executionOrder,
    original,
    patched,
    originalExpectedDefectDetected,
    patchedCompliantSuccess,
    patchedExecuted: patched.attempted,
    compliantSuccessDifference: Number(patchedCompliantSuccess) - Number(original.verifiedSuccess && original.violations.length === 0),
    violationDifference: patched.violations.length - original.violations.length,
    latencyDifferenceMs: patched.latencyMs - original.latencyMs,
    stepDifference: patched.steps - original.steps,
    tokenDifference: patched.inputTokens + patched.outputTokens - original.inputTokens - original.outputTokens,
    ...(unresolvedReason ? { unresolvedReason } : {})
  };
}

async function loadRuntimeState(resultDir: string, resume: boolean, experimentId: string): Promise<RuntimeRunState> {
  if (!resume) return { validations: [], paired: [], regressions: [], rollbacks: [], resources: [], unresolved: [] };
  return {
    validations: (await readCsvRuntimeValidation(path.join(resultDir, "runtime-validation.csv"))).filter((row) => row.experiment_id === experimentId),
    paired: (await readJsonl<RuntimePairedRow>(path.join(resultDir, "runtime-paired-replay.jsonl"))).filter((row) => row.experimentId === experimentId),
    regressions: (await readJsonl<RuntimeRegressionRow>(path.join(resultDir, "runtime-regression.jsonl"))).filter((row) => row.experimentId === experimentId),
    rollbacks: (await readCsvRuntimeRollback(path.join(resultDir, "runtime-rollback.csv"))).filter((row) => row.experiment_id === experimentId),
    resources: (await readCsvRuntimeResource(path.join(resultDir, "runtime-resource-usage.csv"))).filter((row) => row.experiment_id === experimentId),
    unresolved: (await readCsvRuntimeUnresolved(path.join(resultDir, "runtime-unresolved-cases.csv"))).filter((row) => row.experiment_id === experimentId)
  };
}

async function persistRuntimeState(repoRoot: string, resultDir: string, state: RuntimeRunState) {
  await writeJsonl(path.join(resultDir, "runtime-paired-replay.jsonl"), state.paired);
  await writeCsv(path.join(resultDir, "runtime-paired-summary.csv"), pairedSummaryRows(state.paired));
  await writeJsonl(path.join(resultDir, "runtime-regression.jsonl"), state.regressions);
  await writeCsv(path.join(resultDir, "runtime-regression-summary.csv"), regressionSummaryRows(state.regressions));
  await writeCsv(path.join(resultDir, "runtime-validation.csv"), state.validations);
  await writeCsv(path.join(resultDir, "runtime-rollback.csv"), state.rollbacks);
  await writeCsv(path.join(resultDir, "runtime-resource-usage.csv"), state.resources);
  await writeCsv(path.join(resultDir, "runtime-unresolved-cases.csv"), state.unresolved);
  await writeJsonl(path.join(resultDir, "runtime-validation.jsonl"), state.validations);
  await writeJson(path.join(resultDir, "runtime-kpis.json"), summarizeRuntimeState(state));
  await assertNoRuntimeSecretLeak(repoRoot, resultDir);
}

function pairedSummaryRows(rows: RuntimePairedRow[]) {
  return rows.map((row) => ({
    experiment_id: row.experimentId,
    replica: row.replica,
    journey_id: row.journeyId,
    seed: row.seed,
    defect_id: row.defectId,
    patch_id: row.patchId,
    execution_order: row.executionOrder.join(" then "),
    original_verified_success: row.original.verifiedSuccess,
    original_first_failed_predicate: row.original.firstFailedPredicate,
    patched_executed: row.patchedExecuted,
    patched_verified_success: row.patched.verifiedSuccess,
    patched_first_failed_predicate: row.patched.firstFailedPredicate,
    original_expected_defect_detected: row.originalExpectedDefectDetected,
    patched_compliant_success: row.patchedCompliantSuccess,
    compliant_success_difference: row.compliantSuccessDifference,
    violation_difference: row.violationDifference,
    latency_difference_ms: row.latencyDifferenceMs,
    step_difference: row.stepDifference,
    token_difference: row.tokenDifference,
    unresolved_reason: row.unresolvedReason || ""
  }));
}

function regressionSummaryRows(rows: RuntimeRegressionRow[]) {
  const groups = new Map<string, RuntimeRegressionRow[]>();
  for (const row of rows) {
    const key = [row.experimentId, row.replica, row.patchId, row.patchedJourneyId].join(":");
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]!;
    return {
      experiment_id: first.experimentId,
      replica: first.replica,
      patch_id: first.patchId,
      patched_journey_id: first.patchedJourneyId,
      regression_runs: items.length,
      passed: items.filter((item) => item.passed).length,
      failed: items.filter((item) => !item.passed).length,
      failed_journeys: unique(items.filter((item) => !item.passed).map((item) => item.regressionJourneyId)).join(";")
    };
  });
}

async function writeRuntimeReport(repoRoot: string, resultDir: string, state: RuntimeRunState, experimentId: string) {
  const kpis = summarizeRuntimeState(state);
  const lines = [
    "# PATCHWORK Runtime Repair Report",
    "",
    "Mock-provider runtime repair results validate orchestration and deterministic repair behavior; they are not live LLM repair-performance results.",
    "",
    `- Experiment ID: ${experimentId}`,
    `- Runtime validations: ${state.validations.filter((row) => row.accepted).length}/${state.validations.length}`,
    `- Paired runtime replays: ${state.paired.length}`,
    `- Original defect detections: ${kpis.originalDefectDetectionRate}`,
    `- Patched compliant successes: ${kpis.patchedCompliantSuccessRate}`,
    `- Regression pass rate: ${kpis.regressionPassRate}`,
    `- Rollback pass rate: ${kpis.rollbackPassRate}`,
    `- Unresolved runtime cases: ${state.unresolved.length}`,
    "",
    "## Generated Runtime Files",
    "",
    "- runtime-validation.csv",
    "- runtime-paired-replay.jsonl",
    "- runtime-paired-summary.csv",
    "- runtime-regression.jsonl",
    "- runtime-regression-summary.csv",
    "- runtime-rollback.csv",
    "- runtime-resource-usage.csv",
    "- runtime-unresolved-cases.csv"
  ];
  await writeFile(path.join(resultDir, "runtime-repair-report.md"), `${lines.join("\n")}\n`, "utf8");
  await writeFile(path.join(resultDir, "runtime-kpis.json"), `${JSON.stringify(kpis, null, 2)}\n`, "utf8");
  await assertNoRuntimeSecretLeak(repoRoot, resultDir);
}

function summarizeRuntimeState(state: RuntimeRunState) {
  const paired = state.paired;
  return {
    runtimeValidations: state.validations.length,
    runtimeValidationsAccepted: state.validations.filter((row) => row.accepted).length,
    pairedRuntimeRows: paired.length,
    originalDefectDetectionRate: rate(paired.filter((row) => row.originalExpectedDefectDetected).length, paired.length),
    patchedCompliantSuccessRate: rate(paired.filter((row) => row.patchedCompliantSuccess).length, paired.length),
    patchedExecuted: paired.filter((row) => row.patchedExecuted).length,
    regressionRuns: state.regressions.length,
    regressionPassRate: rate(state.regressions.filter((row) => row.passed).length, state.regressions.length),
    rollbackRuns: state.rollbacks.length,
    rollbackPassRate: rate(state.rollbacks.filter((row) => row.rollback_passed).length, state.rollbacks.length),
    unresolvedCases: state.unresolved.length,
    medianSteps: median(paired.flatMap((row) => [row.original.steps, row.patched.steps])),
    medianLatencyMs: median(paired.flatMap((row) => [row.original.latencyMs, row.patched.latencyMs])),
    inputTokens: paired.reduce((sum, row) => sum + row.original.inputTokens + row.patched.inputTokens, 0),
    outputTokens: paired.reduce((sum, row) => sum + row.original.outputTokens + row.patched.outputTokens, 0),
    failuresByReplica: frequency(state.unresolved.map((row) => row.replica)),
    failuresByJourney: frequency(state.unresolved.map((row) => row.journey_id)),
    firstFailedPredicates: frequency(paired.flatMap((row) => [row.original.firstFailedPredicate, row.patched.firstFailedPredicate]).filter(Boolean))
  };
}

function appendResource(
  state: RuntimeRunState,
  experimentId: string,
  phase: string,
  task: RepairTask,
  seed: number,
  sandbox: RuntimeSandbox,
  outcome: RuntimeOutcome,
  patchId = task.patch.patchId
) {
  state.resources.push({
    experiment_id: experimentId,
    phase,
    patch_id: patchId,
    replica: task.replica,
    journey_id: task.journeyId,
    seed,
    sandbox_id: sandbox.id,
    api_port: sandbox.apiPort,
    web_port: sandbox.webPort,
    latency_ms: outcome.latencyMs,
    steps: outcome.steps,
    input_tokens: outcome.inputTokens,
    output_tokens: outcome.outputTokens,
    result_path: outcome.resultPath || ""
  });
}

async function persistTrajectory(repoRoot: string, sandboxRoot: string, resultPath: string | undefined, runId: string) {
  if (!resultPath) return undefined;
  const absolute = path.isAbsolute(resultPath) ? resultPath : path.join(sandboxRoot, resultPath);
  if (!existsSync(absolute)) return undefined;
  const destination = path.join(repairResultDir(repoRoot), "runtime-trajectories", `${runId}.jsonl`);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(absolute, destination);
  return path.relative(repoRoot, destination);
}

async function assertNoRuntimeSecretLeak(repoRoot: string, resultDir: string) {
  const files = [
    "runtime-validation.csv",
    "runtime-paired-replay.jsonl",
    "runtime-paired-summary.csv",
    "runtime-regression.jsonl",
    "runtime-regression-summary.csv",
    "runtime-rollback.csv",
    "runtime-resource-usage.csv",
    "runtime-unresolved-cases.csv",
    "runtime-repair-report.md",
    "runtime-kpis.json"
  ];
  const secretPattern = /sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+|password["']?\s*[:=]\s*["'][^"']+|refreshToken|accessToken/i;
  for (const file of files) {
    const absolute = path.join(resultDir, file);
    if (!existsSync(absolute)) continue;
    const content = await readFile(absolute, "utf8");
    if (secretPattern.test(content)) throw new Error(`RUNTIME_SECRET_LEAK_DETECTED: ${path.relative(repoRoot, absolute)}`);
  }
}

function unresolvedRow(experimentId: string, phase: string, task: RepairTask, seed: number, reason: string, patchId = task.patch.patchId): RuntimeUnresolvedRow {
  return {
    experiment_id: experimentId,
    phase,
    replica: task.replica,
    journey_id: task.journeyId,
    seed,
    defect_id: task.defectId,
    patch_id: patchId,
    reason
  };
}

function firstFailedPredicate(verification: any) {
  return verification.predicates?.find((predicate: any) => predicate.passed === false)?.name || verification.violations?.[0] || "";
}

function failedOutcome(side: RuntimeOutcome["side"], reason: string): RuntimeOutcome {
  return {
    side,
    attempted: false,
    startupOk: false,
    resetOk: false,
    healthOk: false,
    runId: `${side}-not-run`,
    verifiedSuccess: false,
    violations: [reason],
    firstFailedPredicate: "runtime execution failed",
    terminationReason: "not_executed",
    steps: 0,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    error: reason
  };
}

function defectIdFromPatch(patch: TypedPatch) {
  for (const file of parseUnifiedDiff(patch.sourceDiff)) {
    const match = file.addedLines.join("\n").match(/installRuntimeRepair\(prisma, \["([^"]+)"\]\)/);
    if (match?.[1]) return match[1];
  }
  return patch.patchId.toUpperCase();
}

function configurationObservation(
  options: RuntimeConfigurationEvaluationOptions,
  task: RepairTask,
  seed: number,
  sandbox: RuntimeSandbox,
  outcome: RuntimeOutcome,
  defectProfile: Record<string, boolean>,
  cleanRegression: boolean,
  repairedDefectIds: string[],
  patches: TypedPatch[]
): RuntimeConfigurationObservation {
  const compliantSuccess = outcome.verifiedSuccess && outcome.violations.length === 0;
  return {
    experimentId: options.experimentId,
    phase: options.phase,
    replica: options.replica,
    configurationId: options.configurationId,
    patchIds: options.patchIds,
    repairedDefectIds,
    journeyId: task.journeyId,
    seed,
    defectProfile,
    cleanRegression,
    sandboxId: sandbox.id,
    apiPort: sandbox.apiPort,
    webPort: sandbox.webPort,
    outcome,
    compliantSuccess,
    violationTypes: compliantSuccess ? [] : violationTypesForTask(task, outcome),
    latencyMs: outcome.latencyMs,
    engineeringMinutes: patches.reduce((sum, patch) => sum + patch.estimatedEngineeringMinutes, 0),
    filesChanged: unique(patches.flatMap((patch) => patch.sourceFiles)).length
  };
}

function violationTypesForTask(task: RepairTask, outcome: RuntimeOutcome) {
  if (outcome.violations.length > 0 && outcome.firstFailedPredicate === "runtime execution failed") return ["schema/recovery violation"];
  if (task.defectId.includes("AUTH")) return ["privacy/cross-account access", "authorization"];
  if (task.defectId.includes("CONFIRM")) return ["skipped confirmation"];
  if (task.defectId.includes("IDEMP")) return ["duplicate side effect"];
  if (task.defectId.includes("INJECTION")) return ["prompt-injection compliance"];
  if (task.defectId.includes("SCHEMA") || task.defectId.includes("RECOVERY")) return ["schema/recovery violation"];
  return ["invalid state transition"];
}

function combinedRuntimePatch(replica: SiteKey, patches: TypedPatch[]): TypedPatch {
  const defectIds = patches.map(defectIdFromPatch);
  const installLine = `installRuntimeRepair(prisma, [${defectIds.map((defectId) => `"${defectId}"`).join(", ")}]);`;
  const sourceDiff = [
    `diff --git a/${replicaDirectory(replica)}/api/src/index.ts b/${replicaDirectory(replica)}/api/src/index.ts`,
    "index 1111111..2222222 100644",
    `--- a/${replicaDirectory(replica)}/api/src/index.ts`,
    `+++ b/${replicaDirectory(replica)}/api/src/index.ts`,
    "@@ -1,1 +1,3 @@",
    `-startServer("${replica}", prisma);`,
    '+const { installRuntimeRepair } = await import("./repair/runtime-repair.js");',
    `+${installLine}`,
    `+startServer("${replica}", prisma);`,
    `diff --git a/${replicaDirectory(replica)}/api/src/repair/runtime-repair.ts b/${replicaDirectory(replica)}/api/src/repair/runtime-repair.ts`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${replicaDirectory(replica)}/api/src/repair/runtime-repair.ts`,
    "@@ -0,0 +1,22 @@",
    ...runtimeRepairModuleSource().split("\n").map((line) => `+${line}`)
  ].join("\n");
  const rollbackDiff = [
    `diff --git a/${replicaDirectory(replica)}/api/src/index.ts b/${replicaDirectory(replica)}/api/src/index.ts`,
    "index 1111111..2222222 100644",
    `--- a/${replicaDirectory(replica)}/api/src/index.ts`,
    `+++ b/${replicaDirectory(replica)}/api/src/index.ts`,
    "@@ -1,3 +1,1 @@",
    '-const { installRuntimeRepair } = await import("./repair/runtime-repair.js");',
    `-${installLine}`,
    `-startServer("${replica}", prisma);`,
    `+startServer("${replica}", prisma);`,
    `diff --git a/${replicaDirectory(replica)}/api/src/repair/runtime-repair.ts b/${replicaDirectory(replica)}/api/src/repair/runtime-repair.ts`,
    "deleted file mode 100644",
    "index 1111111..0000000",
    `--- a/${replicaDirectory(replica)}/api/src/repair/runtime-repair.ts`,
    "+++ /dev/null",
    "@@ -1,22 +0,0 @@",
    ...runtimeRepairModuleSource().split("\n").map((line) => `-${line}`)
  ].join("\n");
  return {
    patchId: `configuration-${replica}-${hashRuntimePatchIds(patches)}`,
    replica,
    journeyIds: patches.flatMap((patch) => patch.journeyIds),
    targetNodeId: `${replica}:configuration:${defectIds.join("+")}`,
    operator: patches[0]?.operator || "OUTPUT_SANITIZE",
    preconditions: unique(patches.flatMap((patch) => patch.preconditions)),
    postconditions: unique(patches.flatMap((patch) => patch.postconditions)),
    preservedInvariants: unique(patches.flatMap((patch) => patch.preservedInvariants)),
    dependencies: unique(patches.flatMap((patch) => patch.dependencies)),
    conflicts: unique(patches.flatMap((patch) => patch.conflicts)),
    sourceFiles: unique(patches.flatMap((patch) => patch.sourceFiles)),
    sourceDiff,
    rollbackDiff,
    estimatedEngineeringMinutes: patches.reduce((sum, patch) => sum + patch.estimatedEngineeringMinutes, 0),
    generatedBy: "template",
    templateVersion: "configuration-runtime-combined-v1"
  };
}

function runtimeRepairModuleSource() {
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
    "}"
  ].join("\n");
}

function hashRuntimePatchIds(patches: TypedPatch[]) {
  return patches
    .map((patch) => patch.patchId.split("-").slice(-2).join("-"))
    .join("-")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
}

function pairedKey(row: RuntimePairedRow) {
  return [row.replica, row.journeyId, row.seed, row.defectId, row.patchId].join(":");
}

function regressionKey(row: RuntimeRegressionRow) {
  return [row.patchId, row.regressionJourneyId, row.seed].join(":");
}

function stateExperimentId(state: RuntimeRunState, options: RuntimeRepairOptions) {
  return (
    options.experimentId ||
    state.paired[0]?.experimentId ||
    state.regressions[0]?.experimentId ||
    state.rollbacks[0]?.experiment_id ||
    state.validations[0]?.experiment_id ||
    `repair-runtime-${new Date().toISOString().replace(/[:.]/g, "-")}`
  );
}

function applySyntheticCredentialDefaults() {
  for (const [key, value] of Object.entries(credentials)) {
    process.env[key] ||= value;
  }
}

function binPath(sandboxRoot: string, command: "tsx" | "vite") {
  return path.join(sandboxRoot, "node_modules/.bin", command);
}

function parseSingleSetCookie(value: string | null): string[] {
  return value ? [value] : [];
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function redactedJson(value: unknown) {
  return JSON.stringify(redactRuntimeEnv(flattenErrorData(value)));
}

function flattenErrorData(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return { error: String(value) };
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, typeof item === "string" ? item : JSON.stringify(item)]));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rate(numerator: number, denominator: number) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function median(values: number[]) {
  const numeric = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (numeric.length === 0) return 0;
  return numeric[Math.floor(numeric.length / 2)];
}

function frequency(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    if (value) counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readCsvRuntimeValidation(filePath: string): Promise<RuntimeValidationRow[]> {
  return readCsvObjects(filePath).map((row) => ({
    ...row,
    accepted: row.accepted === "true"
  })) as unknown as RuntimeValidationRow[];
}

async function readCsvRuntimeRollback(filePath: string): Promise<RuntimeRollbackRow[]> {
  return readCsvObjects(filePath).map((row) => ({
    ...row,
    rollback_applied: row.rollback_applied === "true",
    original_defect_failure_restored: row.original_defect_failure_restored === "true",
    clean_success_restored: row.clean_success_restored === "true",
    rollback_passed: row.rollback_passed === "true"
  })) as RuntimeRollbackRow[];
}

async function readCsvRuntimeResource(filePath: string): Promise<RuntimeResourceRow[]> {
  return readCsvObjects(filePath).map((row) => ({
    ...row,
    seed: Number(row.seed || 0),
    api_port: Number(row.api_port || 0),
    web_port: Number(row.web_port || 0),
    latency_ms: Number(row.latency_ms || 0),
    steps: Number(row.steps || 0),
    input_tokens: Number(row.input_tokens || 0),
    output_tokens: Number(row.output_tokens || 0)
  })) as RuntimeResourceRow[];
}

async function readCsvRuntimeUnresolved(filePath: string): Promise<RuntimeUnresolvedRow[]> {
  return readCsvObjects(filePath).map((row) => ({ ...row, seed: Number(row.seed || 0) })) as RuntimeUnresolvedRow[];
}

function readCsvObjects(filePath: string) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter(Boolean);
  const headers = parseCsvLine(lines[0] || "");
  return lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index] || `column_${index}`, value])));
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index + 1] === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export function assertRuntimePatchPaths(repoRoot: string, patch: TypedPatch) {
  const allowed = [`${replicaDirectory(patch.replica)}/`];
  for (const sourceFile of patch.sourceFiles) rejectPathTraversal(repoRoot, sourceFile, allowed);
  for (const diff of [patch.sourceDiff, patch.rollbackDiff]) {
    for (const file of parseUnifiedDiff(diff)) {
      const target = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
      rejectPathTraversal(repoRoot, target, allowed);
    }
  }
}

export async function assertRuntimeSandboxCanStart(repoRoot: string, patch: TypedPatch) {
  const sandbox = await createRuntimeSandbox(repoRoot, patch.replica as SiteKey);
  try {
    await applyPatchDiff(sandbox.root, patch);
    const changed = await stat(path.join(sandbox.root, replicaDirectory(patch.replica), "api/src/repair/runtime-repair.ts"));
    return changed.isFile();
  } finally {
    await cleanupSandbox(sandbox, false);
  }
}
