import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { VerificationResultSchema } from "../core/schemas.js";
import type { JourneyRunResult, SiteKey } from "../core/types.js";
import { parseRange, redactSecrets } from "../core/utils.js";
import { ExperimentRunner, type AgentId } from "../runner/experiment-runner.js";
import { SiteRegistry } from "../sites/site-registry.js";
import { ResearchEndpointClient } from "../verifiers/research-client.js";
import { validateContracts } from "./contract-validator.js";
import { applySyntheticCredentialDefaults } from "./local-fixtures.js";
import { loadPilotManifest, type PilotJourney, type PilotManifest } from "./pilot-manifest.js";
import { exportPilotResults, readExistingPilotRecords, type PilotRunRecord } from "./result-exporter.js";

type VerificationResult = z.infer<typeof VerificationResultSchema>;

export type PilotMode = "mock" | "live";

export type PilotRunnerOptions = {
  mode: PilotMode;
  manifestPath?: string;
  resultDirectory?: string;
  experimentId?: string;
  resume?: boolean;
  sites?: SiteKey[];
  journeys?: string[];
  seeds?: number[];
  limit?: number;
  liveVerifier?: boolean;
};

export type PilotRunnerResult = {
  ok: boolean;
  experimentId: string;
  mode: PilotMode;
  plannedRuns: number;
  completedRuns: number;
  skippedRuns: number;
  records: PilotRunRecord[];
  resultDirectory: string;
};

type PilotTask = {
  site: SiteKey;
  siteName: string;
  contractVersion: string;
  journey: PilotJourney;
  seed: number;
  condition: "clean" | "defect";
  agentId: AgentId;
  provider: string;
  model: string;
  promptVersion: string;
  defectConfiguration: Record<string, boolean>;
  defectId?: string;
};

export class ResearchPilotRunner {
  constructor(private readonly repoRoot: string) {}

  async run(options: PilotRunnerOptions): Promise<PilotRunnerResult> {
    applySyntheticCredentialDefaults();
    const manifest = await loadPilotManifest(this.repoRoot, options.manifestPath);
    const resultDirectory = options.resultDirectory || directoryForMode(manifest, options.mode);
    const experimentId = options.experimentId || makeExperimentId();
    const validation = await validateContracts(this.repoRoot, { liveVerifier: options.liveVerifier !== false });
    if (!validation.ok) {
      throw new Error(`CONTRACT_VALIDATION_FAILED: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    }
    const tasks = planPilotTasks(manifest, options);
    ensureLiveModeIsConfigured(tasks, options.mode);

    const records = options.resume ? await readExistingPilotRecords(this.repoRoot, resultDirectory) : [];
    const completedKeys = new Set(records.map(pilotRunKey));
    const runner = new ExperimentRunner(this.repoRoot);
    const registry = new SiteRegistry(this.repoRoot);
    let completedRuns = 0;
    let skippedRuns = 0;

    for (const task of tasks) {
      const taskKey = pilotRunKey({ ...task, experimentId });
      if (options.resume && completedKeys.has(taskKey)) {
        skippedRuns += 1;
        continue;
      }
      const siteConfig = await registry.get(task.site);
      const client = new ResearchEndpointClient(siteConfig);
      const preRunReset = await client.reset(task.defectConfiguration);
      const healthBefore = await client.health();
      const backendStateBefore = await client.state();
      const result = await runner.run({
        site: task.site,
        journeyId: task.journey.id,
        agentId: task.agentId,
        mode: options.mode,
        seed: task.seed,
        maxSteps: task.journey.maximumSteps,
        timeoutMs: task.journey.timeoutSeconds * 1000,
        tokenBudget: 20000,
        authorizeResearchTools: false,
        defectConfiguration: task.defectConfiguration
      });
      const verifier = await client.verify(task.journey.id);
      const backendStateAfter = await client.state();
      const cleanReset = await client.reset({});
      const cleanHealth = await client.health();
      const recovery = task.condition === "defect" ? await this.verifyCleanRecovery(runner, client, task, options.mode) : undefined;
      const record = makeRunRecord({
        experimentId,
        manifest,
        task,
        result,
        verifier,
        backendStateBefore,
        backendStateAfter,
        resetResult: {
          preRunReset,
          healthBefore,
          cleanReset,
          cleanHealth,
          ...(recovery || {})
        }
      });
      records.push(record);
      completedKeys.add(pilotRunKey(record));
      completedRuns += 1;
      await exportPilotResults(this.repoRoot, manifest, records, resultDirectory);
    }

    await exportPilotResults(this.repoRoot, manifest, records, resultDirectory);
    return {
      ok: true,
      experimentId,
      mode: options.mode,
      plannedRuns: tasks.length,
      completedRuns,
      skippedRuns,
      records,
      resultDirectory
    };
  }

  async report(options: Pick<PilotRunnerOptions, "manifestPath" | "resultDirectory" | "mode"> = { mode: "mock" }): Promise<PilotRunnerResult> {
    const manifest = await loadPilotManifest(this.repoRoot, options.manifestPath);
    const resultDirectory = options.resultDirectory || directoryForMode(manifest, options.mode || "mock");
    const records = await readExistingPilotRecords(this.repoRoot, resultDirectory);
    await exportPilotResults(this.repoRoot, manifest, records, resultDirectory);
    return {
      ok: true,
      experimentId: records[0]?.experimentId || "not-run",
      mode: "mock",
      plannedRuns: records.length,
      completedRuns: 0,
      skippedRuns: 0,
      records,
      resultDirectory
    };
  }

  private async verifyCleanRecovery(runner: ExperimentRunner, client: ResearchEndpointClient, task: PilotTask, mode: PilotMode) {
    const recoveryResult = await runner.run({
      site: task.site,
      journeyId: task.journey.id,
      agentId: task.journey.cleanAgent,
      mode,
      seed: task.seed,
      maxSteps: task.journey.maximumSteps,
      timeoutMs: task.journey.timeoutSeconds * 1000,
      tokenBudget: 20000,
      authorizeResearchTools: false,
      defectConfiguration: {}
    });
    const recoveryVerification = await client.verify(task.journey.id);
    const finalCleanReset = await client.reset({});
    const finalCleanHealth = await client.health();
    return {
      recoveryResult: {
        runId: recoveryResult.runId,
        verifiedSuccess: recoveryResult.verifiedSuccess,
        terminationReason: recoveryResult.terminationReason,
        violations: recoveryResult.violations,
        resultPath: recoveryResult.resultPath
      },
      recoveryVerification,
      finalCleanReset,
      finalCleanHealth
    };
  }
}

export function planPilotTasks(manifest: PilotManifest, options: Pick<PilotRunnerOptions, "sites" | "journeys" | "seeds" | "limit"> = {}): PilotTask[] {
  const selectedSites = options.sites || (Object.keys(manifest.replicas) as SiteKey[]);
  const selectedJourneys = options.journeys ? new Set(options.journeys) : undefined;
  const selectedSeeds = options.seeds || manifest.seeds;
  const tasks: PilotTask[] = [];
  for (const site of selectedSites) {
    const replica = manifest.replicas[site];
    for (const journey of replica.journeys) {
      if (selectedJourneys && !selectedJourneys.has(journey.id)) continue;
      for (const seed of selectedSeeds) {
        tasks.push(makeTask(manifest, site, replica.name, replica.contractVersion, journey, seed, "clean"));
        tasks.push(makeTask(manifest, site, replica.name, replica.contractVersion, journey, seed, "defect"));
      }
    }
  }
  return typeof options.limit === "number" ? tasks.slice(0, options.limit) : tasks;
}

export function pilotRunKey(input: Pick<PilotTask, "site" | "journey" | "seed" | "condition" | "agentId" | "defectId"> & { experimentId: string }): string;
export function pilotRunKey(input: PilotRunRecord): string;
export function pilotRunKey(input: (Pick<PilotTask, "site" | "journey" | "seed" | "condition" | "agentId" | "defectId"> & { experimentId: string }) | PilotRunRecord) {
  const journeyId = "journey" in input ? input.journey.id : input.journeyId;
  const defectId = input.defectId || "clean";
  return [input.experimentId, input.site, journeyId, input.seed, input.condition, input.agentId, defectId].join(":");
}

export function parseNumberList(input: string | undefined, fallback: number[]): number[] {
  if (!input) return fallback;
  return input
    .split(",")
    .flatMap((part) => parseRange(part.trim(), []))
    .filter((value, index, values) => Number.isInteger(value) && values.indexOf(value) === index);
}

function makeTask(
  manifest: PilotManifest,
  site: SiteKey,
  siteName: string,
  contractVersion: string,
  journey: PilotJourney,
  seed: number,
  condition: "clean" | "defect"
): PilotTask {
  const agentId = (condition === "clean" ? journey.cleanAgent : journey.defectAgent) as AgentId;
  const agent = manifest.agents.find((item) => item.id === agentId);
  if (!agent) throw new Error(`PILOT_AGENT_NOT_FOUND: ${agentId}`);
  const defectConfiguration = condition === "defect" ? { [journey.deterministicDefectId]: true } : {};
  const base: PilotTask = {
    site,
    siteName,
    contractVersion,
    journey,
    seed,
    condition,
    agentId,
    provider: agent.provider,
    model: agent.model,
    promptVersion: agent.promptVersion,
    defectConfiguration
  };
  return condition === "defect" ? { ...base, defectId: journey.deterministicDefectId } : base;
}

function makeRunRecord(input: {
  experimentId: string;
  manifest: PilotManifest;
  task: PilotTask;
  result: JourneyRunResult;
  verifier: VerificationResult;
  backendStateBefore: unknown;
  backendStateAfter: unknown;
  resetResult: unknown;
}): PilotRunRecord {
  const violations = unique([...input.result.violations, ...input.verifier.violations]);
  const firstFailedPredicate = firstFailedPredicateName(input.verifier) || violations[0] || "";
  const base: PilotRunRecord = {
    experimentId: input.experimentId,
    manifestVersion: input.manifest.manifestVersion,
    siteCommit: input.manifest.siteCommit,
    contractVersion: input.task.contractVersion,
    site: input.task.site,
    journeyId: input.task.journey.id,
    agentId: input.result.agentId,
    provider: input.result.provider,
    model: input.result.model,
    promptVersion: input.result.promptVersion,
    seed: input.task.seed,
    condition: input.task.condition,
    verifiedSuccess: input.verifier.verifiedSuccess,
    violations,
    firstFailedPredicate,
    terminationReason: input.result.terminationReason,
    steps: input.result.steps,
    latencyMs: input.result.latencyMs,
    inputTokens: input.result.inputTokens,
    outputTokens: input.result.outputTokens,
    screenshots: [],
    accessibilitySnapshots: [],
    toolCalls: [],
    backendStateBefore: redactSecrets(input.backendStateBefore),
    backendStateAfter: redactSecrets(input.backendStateAfter),
    resetResult: redactSecrets(input.resetResult)
  };
  return {
    ...base,
    ...(input.task.defectId ? { defectId: input.task.defectId } : {}),
    ...(input.result.resultPath ? { resultPath: input.result.resultPath } : {})
  };
}

function firstFailedPredicateName(verifier: VerificationResult) {
  return verifier.predicates.find((predicate) => !predicate.passed)?.name || "";
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function ensureLiveModeIsConfigured(tasks: PilotTask[], mode: PilotMode) {
  if (mode !== "live") return;
  const nonScriptedAgents = [...new Set(tasks.map((task) => task.agentId).filter((agentId) => agentId !== "scripted"))];
  const missing = nonScriptedAgents.flatMap(requiredProviderEnv).filter((name) => !process.env[name]);
  if (missing.length > 0) throw new Error(`LIVE_AGENT_KEYS_MISSING: ${missing.join(", ")}`);
}

function requiredProviderEnv(agentId: AgentId) {
  const prefix =
    agentId === "accessibility-a" ? "TEXT_AGENT_A" : agentId === "accessibility-b" ? "TEXT_AGENT_B" : agentId === "screenshot" ? "VISION" : "TOOL_AGENT";
  return [`${prefix}_BASE_URL`, `${prefix}_API_KEY`, `${prefix}_MODEL`];
}

function makeExperimentId() {
  return `pilot-study-v1-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function directoryForMode(manifest: PilotManifest, mode: PilotMode) {
  if (mode === "live") return manifest.resultDirectories?.live || "experiments/results/pilot-study-v1";
  return manifest.resultDirectories?.mock || "experiments/results/pilot-study-v1";
}
