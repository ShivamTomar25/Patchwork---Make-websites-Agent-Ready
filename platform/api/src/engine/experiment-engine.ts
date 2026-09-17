import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../generated/prisma/index.js";

export type ExperimentConfiguration = {
  projectId: string;
  journeyIds: string[];
  agentIds: string[];
  seeds: number[];
  defects: Record<string, boolean>;
  executionMode?: "mock" | "real-local-pilot";
};

export interface ExperimentEngine {
  validateConfiguration(config: ExperimentConfiguration): Promise<void>;
  startExperiment(experimentId: string): Promise<string>;
  getStatus(runId: string): Promise<unknown>;
  cancelExperiment(runId: string): Promise<void>;
  getTrajectory(runId: string): Promise<unknown[]>;
  getFailures(runId: string): Promise<unknown[]>;
  getPatches(runId: string): Promise<unknown[]>;
  startConfirmation(runId: string): Promise<unknown>;
}

type SiteKey = "shop" | "saas" | "support";
type PilotExportRecord = {
  experimentId: string;
  site: SiteKey;
  journeyId: string;
  agentId: string;
  provider: string;
  model: string;
  seed: number;
  condition: "clean" | "defect";
  defectId?: string;
  verifiedSuccess: boolean;
  violations: string[];
  firstFailedPredicate: string;
  terminationReason: string;
  steps: number;
  latencyMs: number;
  inputTokens: number | string;
  outputTokens: number | string;
  screenshots?: string[];
  accessibilitySnapshots?: string[];
  toolCalls?: string[];
  backendStateAfter?: unknown;
  resultPath?: string;
};

type AgentHarnessRunInput = {
  token: string;
  externalExperimentId: string;
  site: SiteKey;
  journeyIds: string[];
  seeds: number[];
  mode: "mock" | "live";
  resume?: boolean;
};

export class InternalAgentHarnessClient {
  private readonly manifestPath = process.env.PATCHWORK_PLATFORM_PILOT_MANIFEST || "experiments/configs/pilot-study-v2.yaml";
  private readonly resultDirectory = process.env.PATCHWORK_PLATFORM_PILOT_RESULT_DIR || "experiments/results/pilot-study-v2/mock";
  private readonly children = new Map<string, ReturnType<typeof spawn>>();

  constructor(
    private readonly repoRoot = resolveRepoRoot(),
    private readonly expectedToken = process.env.PATCHWORK_INTERNAL_AGENT_TOKEN || "development-internal-agent-token"
  ) {}

  assertAuthorized(token: string) {
    if (!token || token !== this.expectedToken) throw new Error("AGENT_HARNESS_UNAUTHORIZED");
  }

  async startPilot(input: AgentHarnessRunInput): Promise<{ code: number; stdout: string; stderr: string }> {
    this.assertAuthorized(input.token);
    if (process.env.PATCHWORK_REAL_ENGINE_DRY_RUN === "1") {
      return { code: 0, stdout: "dry-run", stderr: "" };
    }
    return new Promise((resolve, reject) => {
      const child = spawn(
        "npm",
        [
          "run",
          input.resume ? "research:resume" : "research:pilot",
          "--",
          "--mode",
          input.mode,
          "--manifest",
          this.manifestPath,
          "--result-directory",
          this.resultDirectory,
          "--experiment-id",
          input.externalExperimentId,
          "--sites",
          input.site,
          "--journeys",
          input.journeyIds.join(","),
          "--seeds",
          input.seeds.join(",")
        ],
        {
          cwd: this.repoRoot,
          env: { ...process.env, PATCHWORK_INTERNAL_AGENT_TOKEN: input.token },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      this.children.set(input.externalExperimentId, child);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        this.children.delete(input.externalExperimentId);
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  }

  cancel(externalExperimentId: string) {
    this.children.get(externalExperimentId)?.kill("SIGTERM");
  }

  async readRecords(externalExperimentId: string): Promise<PilotExportRecord[]> {
    const file = path.join(this.repoRoot, this.resultDirectory, "runs.jsonl");
    try {
      const content = await readFile(file, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PilotExportRecord)
        .filter((record) => record.experimentId === externalExperimentId);
    } catch {
      return [];
    }
  }

  exportLinks(runId: string) {
    return this.exportTargets().map((target) => ({
      file: target.key,
      label: target.label,
      url: `/api/v1/experiments/${runId}/exports/${encodeURIComponent(target.key)}`
    }));
  }

  exportFilePath(key: string) {
    const target = this.exportTargets().find((item) => item.key === key);
    if (!target) throw new Error("EXPORT_FILE_NOT_ALLOWED");
    return target.absolutePath;
  }

  getResultDirectory() {
    return this.resultDirectory;
  }

  getStudyId() {
    return path.basename(this.manifestPath, ".yaml");
  }

  private exportTargets() {
    const mockTargets = allowedExportFiles().map((file) => ({
      key: file,
      label: `mock ${file}`,
      absolutePath: path.join(this.repoRoot, this.resultDirectory, file)
    }));
    const optionalTargets = [
      ["live-smoke:live-smoke.json", "live smoke json", "experiments/results/pilot-study-v2/live-smoke/live-smoke.json"],
      ["live-smoke:live-smoke.md", "live smoke report", "experiments/results/pilot-study-v2/live-smoke/live-smoke.md"],
      ["live:live-smoke.json", "live pilot gate json", "experiments/results/pilot-study-v2/live/live-smoke.json"],
      ["live:live-smoke.md", "live pilot gate report", "experiments/results/pilot-study-v2/live/live-smoke.md"]
    ] as const;
    return [
      ...mockTargets,
      ...optionalTargets
        .map(([key, label, relativePath]) => ({ key, label, absolutePath: path.join(this.repoRoot, relativePath) }))
        .filter((target) => existsSync(target.absolutePath))
    ];
  }
}

export class MockExperimentEngine implements ExperimentEngine {
  constructor(private readonly prisma: PrismaClient) {}

  async validateConfiguration(config: ExperimentConfiguration) {
    if (config.journeyIds.length === 0) throw new Error("At least one journey is required.");
    if (config.agentIds.length === 0) throw new Error("At least one agent is required.");
    if (config.seeds.length === 0) throw new Error("At least one seed is required.");
  }

  async startExperiment(experimentId: string) {
    const experiment = await this.prisma.experiment.findUniqueOrThrow({
      where: { id: experimentId },
      include: { journeys: { include: { journey: true } }, agents: { include: { agent: true } }, project: true }
    });
    const hasDefect = Object.values(experiment.defects as Record<string, boolean>).some(Boolean);
    const run = await this.prisma.experimentRun.create({
      data: {
        organizationId: experiment.organizationId,
        experimentId,
        status: hasDefect ? "failed" : "completed",
        certified: !hasDefect,
        successRate: hasDefect ? 0.66 : 1,
        violationCount: hasDefect ? 2 : 0,
        latencyMs: 28400,
        inputTokens: 4210,
        outputTokens: 1180,
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date()
      }
    });
    await this.prisma.experiment.update({ where: { id: experimentId }, data: { status: hasDefect ? "failed" : "completed" } });
    await this.prisma.experimentEvent.createMany({
      data: [
        { runId: run.id, type: "queued", message: "Mock run accepted by experiment engine.", payload: {} },
        { runId: run.id, type: "agents_started", message: `${experiment.agents.length} agent configurations started.`, payload: {} },
        { runId: run.id, type: "verifier_finished", message: hasDefect ? "Verifier found safety violations." : "Verifier confirmed all selected predicates.", payload: { hasDefect } }
      ]
    });
    const firstJourney = experiment.journeys[0]?.journey;
    const firstAgent = experiment.agents[0]?.agent;
    await this.prisma.trajectoryStep.createMany({
      data: [0, 1, 2].map((index) => ({
        runId: run.id,
        journeyId: firstJourney?.id,
        agentId: firstAgent?.id,
        index,
        url: `${experiment.project.name.toLowerCase()}://synthetic/checkpoint-${index}`,
        action: index === 0 ? "navigate" : index === 1 ? "click_by_role" : "finish",
        observation: index === 2 ? "Authoritative verifier state recorded." : "Compact observation from mock engine.",
        screenshot: index === 1 ? "placeholder://screenshot-step-1" : null,
        toolCall: index === 1 ? { operationId: "mock_step", status: 200 } : undefined,
        verifier: { predicate: firstJourney?.name || "journey", passed: !hasDefect || index < 2 },
        latencyMs: 800 + index * 250
      }))
    });
    if (hasDefect) {
      await this.prisma.failure.create({
        data: {
          runId: run.id,
          firstPredicate: "Safety invariant remained violated after agent finish.",
          severity: "high",
          affectedComponents: ["journey contract", "confirmation gate"],
          evidence: { firstBadStep: 2, note: "Synthetic defect intentionally enabled." }
        }
      });
    }
    const patch = await this.prisma.patchCandidate.create({
      data: {
        runId: run.id,
        title: hasDefect ? "Guard unsafe completion before verifier pass" : "Preserve verified behavior",
        summary: hasDefect ? "Require verifier success before exposing a candidate certificate." : "No code change required for this clean run.",
        diff: hasDefect ? "--- a/app\n+++ b/app\n@@\n- finish()\n+ finishWhenVerifierPasses()" : "// clean-run evidence bundle",
        cost: hasDefect ? 3 : 0,
        rollback: "Revert the candidate patch and rerun mock confirmation.",
        status: hasDefect ? "proposed" : "certified",
        validations: {
          create: [
            { name: "typecheck", status: "passed", evidence: { command: "mock-tsc" } },
            { name: "verifier", status: hasDefect ? "pending" : "passed", evidence: { runId: run.id } }
          ]
        }
      }
    });
    const confirmation = await this.prisma.confirmation.create({
      data: {
        runId: run.id,
        status: hasDefect ? "not_certified" : "certified",
        successBound: hasDefect ? 0.66 : 0.98,
        safetyBound: hasDefect ? 0.72 : 0.99,
        notes: hasDefect ? "Synthetic confirmation withholds certification." : "Synthetic confirmation supports certificate scope."
      }
    });
    await this.prisma.certificate.create({
      data: {
        organizationId: experiment.organizationId,
        projectId: experiment.projectId,
        runId: run.id,
        scope: `${experiment.project.name} selected journeys`,
        status: hasDefect ? "not_certified" : "certified",
        evidence: { patchId: patch.id, confirmationId: confirmation.id, synthetic: true }
      }
    });
    await this.prisma.report.create({
      data: {
        organizationId: experiment.organizationId,
        projectId: experiment.projectId,
        runId: run.id,
        title: `${experiment.name} research report`,
        summary: hasDefect ? "Mock run demonstrates a controlled not-certified outcome." : "Mock run demonstrates a controlled certified outcome.",
        body: { agentComparison: experiment.agents.map((item) => item.agent.name), limitations: "Synthetic mock engine only." }
      }
    });
    return run.id;
  }

  async getStatus(runId: string) {
    return this.prisma.experimentRun.findUnique({ where: { id: runId } });
  }

  async cancelExperiment(runId: string) {
    await this.prisma.experimentRun.update({ where: { id: runId }, data: { status: "cancelled", endedAt: new Date() } });
  }

  async getTrajectory(runId: string) {
    return this.prisma.trajectoryStep.findMany({ where: { runId }, orderBy: { index: "asc" } });
  }

  async getFailures(runId: string) {
    return this.prisma.failure.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
  }

  async getPatches(runId: string) {
    return this.prisma.patchCandidate.findMany({ where: { runId }, include: { validations: true }, orderBy: { createdAt: "asc" } });
  }

  async startConfirmation(runId: string) {
    return this.prisma.confirmation.create({
      data: {
        runId,
        status: "running",
        successBound: 0,
        safetyBound: 0,
        notes: "Fresh mock confirmation started."
      }
    });
  }
}

export class RealExperimentEngine implements ExperimentEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly harness = new InternalAgentHarnessClient()
  ) {}

  async validateConfiguration(config: ExperimentConfiguration) {
    if (config.journeyIds.length === 0) throw new Error("At least one journey is required.");
    if (config.agentIds.length === 0) throw new Error("At least one agent is required.");
    if (config.seeds.length === 0) throw new Error("At least one seed is required.");
    await this.resolveSite(config.projectId);
    this.harness.assertAuthorized(internalToken());
  }

  async startExperiment(experimentId: string) {
    const experiment = await this.prisma.experiment.findUniqueOrThrow({
      where: { id: experimentId },
      include: { journeys: { include: { journey: true } }, agents: { include: { agent: true } }, project: true }
    });
    const site = await this.resolveSite(experiment.projectId);
    const journeyIds = contractJourneyIds(site, experiment.journeys.map((item) => item.journey.name));
    const externalExperimentId = `${this.harness.getStudyId()}-platform-${experimentId}`;
    const run = await this.prisma.experimentRun.create({
      data: {
        organizationId: experiment.organizationId,
        experimentId,
        status: "queued",
        engineMode: "real-local-pilot",
        externalExperimentId,
        externalRunId: externalExperimentId,
        exportDirectory: this.harness.getResultDirectory(),
        summaryMetrics: {
          site,
          journeyIds,
          seeds: experiment.seeds,
          state: "queued"
        }
      }
    });
    await this.prisma.experiment.update({ where: { id: experimentId }, data: { status: "queued" } });
    await this.prisma.experimentEvent.create({
      data: {
        runId: run.id,
        type: "queued",
        message: "Real local pilot accepted by platform engine.",
        payload: { externalExperimentId, site, journeyIds }
      }
    });
    void this.executeRun(run.id, experiment.id, {
      externalExperimentId,
      site,
      journeyIds,
      seeds: experiment.seeds
    });
    return run.id;
  }

  async getStatus(runId: string) {
    return this.prisma.experimentRun.findUnique({ where: { id: runId } });
  }

  async cancelExperiment(runId: string) {
    const run = await this.prisma.experimentRun.findUnique({ where: { id: runId } });
    if (run?.externalExperimentId) this.harness.cancel(run.externalExperimentId);
    await this.prisma.experimentRun.update({ where: { id: runId }, data: { status: "cancelled", endedAt: new Date() } });
    await this.prisma.experimentEvent.create({
      data: { runId, type: "cancelled", message: "Real local pilot cancellation requested.", payload: {} }
    });
  }

  async resumeExperiment(runId: string) {
    const run = await this.prisma.experimentRun.findUniqueOrThrow({
      where: { id: runId },
      include: { experiment: { include: { journeys: { include: { journey: true } }, project: true } } }
    });
    if (!run.externalExperimentId) throw new Error("REAL_RUN_EXTERNAL_ID_MISSING");
    const site = await this.resolveSite(run.experiment.projectId);
    const journeyIds = contractJourneyIds(site, run.experiment.journeys.map((item) => item.journey.name));
    void this.executeRun(
      run.id,
      run.experimentId,
      {
        externalExperimentId: run.externalExperimentId,
        site,
        journeyIds,
        seeds: run.experiment.seeds
      },
      true
    );
    await this.prisma.experimentEvent.create({
      data: {
        runId,
        type: "resume_requested",
        message: "Real local pilot resume requested.",
        payload: { externalExperimentId: run.externalExperimentId }
      }
    });
    return run.id;
  }

  async getTrajectory(runId: string) {
    const run = await this.prisma.experimentRun.findUnique({ where: { id: runId } });
    if (!run?.externalExperimentId) return [];
    const records = await this.harness.readRecords(run.externalExperimentId);
    return records.map((record, index) => ({
      id: `${runId}-${index}`,
      runId,
      journeyId: null,
      agentId: null,
      index,
      url: `${record.site}:${record.journeyId}`,
      action: `${record.condition}:${record.agentId}`,
      observation: `${record.terminationReason}; first failed predicate: ${record.firstFailedPredicate || "none"}`,
      screenshot: record.screenshots?.[0] || null,
      toolCall: { resultPath: record.resultPath, toolCalls: record.toolCalls || [] },
      verifier: { passed: record.verifiedSuccess, violations: record.violations, backendStateAfter: record.backendStateAfter },
      latencyMs: record.latencyMs,
      createdAt: new Date()
    }));
  }

  async getFailures(runId: string) {
    const run = await this.prisma.experimentRun.findUnique({ where: { id: runId } });
    if (!run?.externalExperimentId) return [];
    const records = await this.harness.readRecords(run.externalExperimentId);
    return records
      .filter((record) => !record.verifiedSuccess || record.violations.length > 0)
      .map((record, index) => ({
        id: `${runId}-failure-${index}`,
        runId,
        firstPredicate: record.firstFailedPredicate || record.violations[0] || "Verifier did not pass.",
        severity: record.condition === "defect" ? "expected-defect" : "high",
        affectedComponents: [record.site, record.journeyId, record.agentId],
        evidence: {
          condition: record.condition,
          defectId: record.defectId,
          violations: record.violations,
          resultPath: record.resultPath
        },
        createdAt: new Date()
      }));
  }

  async getPatches(_runId: string) {
    return [];
  }

  async startConfirmation(runId: string) {
    return this.prisma.confirmation.create({
      data: {
        runId,
        status: "not_certified",
        successBound: 0,
        safetyBound: 0,
        notes: "Pilot real-engine confirmation is not implemented yet."
      }
    });
  }

  exportLinks(runId: string) {
    return this.harness.exportLinks(runId);
  }

  exportFilePath(file: string) {
    return this.harness.exportFilePath(file);
  }

  private async executeRun(
    runId: string,
    experimentId: string,
    input: { externalExperimentId: string; site: SiteKey; journeyIds: string[]; seeds: number[] },
    resume = false
  ) {
    try {
      await this.prisma.experimentRun.update({ where: { id: runId }, data: { status: "running", startedAt: new Date() } });
      await this.prisma.experiment.update({ where: { id: experimentId }, data: { status: "running" } });
      await this.prisma.experimentEvent.create({
        data: {
          runId,
          type: "agents_started",
          message: "Agent harness started real local pilot execution.",
          payload: { externalExperimentId: input.externalExperimentId }
        }
      });
      const processResult = await this.harness.startPilot({
        token: internalToken(),
        externalExperimentId: input.externalExperimentId,
        site: input.site,
        journeyIds: input.journeyIds,
        seeds: input.seeds,
        mode: "mock",
        resume
      });
      if (processResult.code !== 0) throw new Error(`AGENT_HARNESS_FAILED: ${processResult.stderr || processResult.stdout}`);
      const latest = await this.prisma.experimentRun.findUnique({ where: { id: runId }, include: { experiment: true } });
      if (!latest) throw new Error("RUN_NOT_FOUND_AFTER_HARNESS");
      if (latest.status === "cancelled") return;
      const records = await this.harness.readRecords(input.externalExperimentId);
      const summary = summarizePilotRecords(records);
      await this.prisma.experimentRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          certified: false,
          successRate: summary.successRate,
          violationCount: summary.violationCount,
          latencyMs: summary.latencyMs,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens,
          endedAt: new Date(),
          summaryMetrics: summary
        }
      });
      await this.prisma.experiment.update({ where: { id: experimentId }, data: { status: "completed" } });
      await this.writeFailureSummaries(runId, records);
      await this.prisma.experimentEvent.create({
        data: {
          runId,
          type: "verifier_finished",
          message: "Authoritative verifier results imported from pilot exports.",
          payload: summary
        }
      });
      await this.prisma.report.create({
        data: {
          organizationId: latest.organizationId,
          projectId: latest.experiment.projectId,
          runId,
          title: "Real local pilot report",
          summary: `${summary.totalRuns} pilot records imported from agent harness exports.`,
          body: { summaryMetrics: summary, exportDirectory: this.harness.getResultDirectory(), exportFiles: this.harness.exportLinks(runId) }
        }
      });
    } catch (error) {
      await this.prisma.experimentRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          endedAt: new Date(),
          summaryMetrics: { error: error instanceof Error ? error.message : String(error) }
        }
      });
      await this.prisma.experiment.update({ where: { id: experimentId }, data: { status: "failed" } });
      await this.prisma.experimentEvent.create({
        data: {
          runId,
          type: "failed",
          message: error instanceof Error ? error.message : String(error),
          payload: {}
        }
      });
    }
  }

  private async writeFailureSummaries(runId: string, records: PilotExportRecord[]) {
    const failures = records.filter((record) => !record.verifiedSuccess || record.violations.length > 0).slice(0, 25);
    if (failures.length === 0) return;
    await this.prisma.failure.createMany({
      data: failures.map((record) => ({
        runId,
        firstPredicate: record.firstFailedPredicate || record.violations[0] || "Verifier did not pass.",
        severity: record.condition === "defect" ? "expected-defect" : "high",
        affectedComponents: [record.site, record.journeyId, record.agentId],
        evidence: { condition: record.condition, defectId: record.defectId, resultPath: record.resultPath }
      }))
    });
  }

  private async resolveSite(projectId: string): Promise<SiteKey> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const site = siteFromProjectName(project.name);
    if (!site) throw new Error(`PROJECT_NOT_IN_SITE_REGISTRY: ${project.name}`);
    return site;
  }
}

function summarizePilotRecords(records: PilotExportRecord[]) {
  const totalRuns = records.length;
  const successfulRuns = records.filter((record) => record.verifiedSuccess).length;
  const violationCount = records.reduce((sum, record) => sum + record.violations.length, 0);
  const failedRuns = totalRuns - successfulRuns;
  const defectRecords = records.filter((record) => record.condition === "defect");
  return {
    totalRuns,
    successfulRuns,
    failedRuns,
    successRate: totalRuns ? successfulRuns / totalRuns : 0,
    compliantSuccessRate: totalRuns ? records.filter((record) => record.verifiedSuccess && record.violations.length === 0).length / totalRuns : 0,
    violationRate: totalRuns ? records.filter((record) => record.violations.length > 0).length / totalRuns : 0,
    violationCount,
    medianSteps: median(records.map((record) => numericMetric(record.steps))),
    medianLatencyMs: median(records.map((record) => numericMetric(record.latencyMs))),
    latencyMs: records.reduce((sum, record) => sum + numericMetric(record.latencyMs), 0),
    inputTokens: records.reduce((sum, record) => sum + numericMetric(record.inputTokens), 0),
    outputTokens: records.reduce((sum, record) => sum + numericMetric(record.outputTokens), 0),
    expectedDefectDetectionRate: defectRecords.length
      ? defectRecords.filter((record) => !record.verifiedSuccess || record.violations.length > 0).length / defectRecords.length
      : 0,
    providerModelSnapshot: frequency(records.map((record) => `${record.provider || "unknown"}:${record.model || "unknown"}`)),
    firstFailedPredicateFrequency: frequency(records.map((record) => record.firstFailedPredicate || "none"))
  };
}

function numericMetric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function siteFromProjectName(name: string): SiteKey | undefined {
  const normalized = name.toLowerCase();
  if (normalized.includes("shop")) return "shop";
  if (normalized.includes("saas")) return "saas";
  if (normalized.includes("support")) return "support";
  return undefined;
}

function contractJourneyIds(site: SiteKey, selectedJourneyNames: string[]) {
  const defaults: Record<SiteKey, string[]> = {
    shop: ["SHOP-J1", "SHOP-J2", "SHOP-J3"],
    saas: ["SAAS-J1", "SAAS-J2", "SAAS-J3", "SAAS-J4"],
    support: ["SUPPORT-J1", "SUPPORT-J2", "SUPPORT-J3", "SUPPORT-J4"]
  };
  const known = defaults[site];
  const explicit = selectedJourneyNames
    .map((name) => known.find((journeyId) => name.toUpperCase().includes(journeyId)))
    .filter((journeyId): journeyId is string => Boolean(journeyId));
  return explicit.length > 0 ? explicit : known.slice(0, Math.max(1, selectedJourneyNames.length));
}

function resolveRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "experiments/configs/pilot-study-v1.yaml")) && existsSync(path.join(current, "agents/package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

function internalToken() {
  return process.env.PATCHWORK_INTERNAL_AGENT_TOKEN || "development-internal-agent-token";
}

function allowedExportFiles() {
  return [
    "manifest.snapshot.yaml",
    "runs.jsonl",
    "run-summary.csv",
    "journey-summary.csv",
    "agent-summary.csv",
    "defect-summary.csv",
    "violation-summary.csv",
    "termination-summary.csv",
    "reset-summary.csv",
    "pilot-report.md"
  ];
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function frequency(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}
