import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactRecord, JourneyRunInput, JourneyRunResult, ModelProvider, RunStepRecord } from "../core/types.js";
import { nowIso, redactSecrets, writeJsonlLine } from "../core/utils.js";

type PrismaLike = any;

export class TrajectoryRecorder {
  private prisma?: PrismaLike;
  private startedAt = new Date();
  private jsonlPath = "";

  constructor(
    private readonly repoRoot: string,
    private readonly useDatabase = process.env.AGENTS_DISABLE_DB !== "1"
  ) {}

  async initialize() {
    if (!this.useDatabase) return;
    const module = await import("../generated/prisma/index.js").catch(() => undefined);
    if (!module) return;
    this.prisma = new module.PrismaClient();
  }

  async startRun(runId: string, input: JourneyRunInput, provider: ModelProvider, defectConfiguration: Record<string, unknown>) {
    this.startedAt = new Date();
    this.jsonlPath = path.join(
      this.repoRoot,
      "agents/results/raw",
      input.site,
      input.journeyId,
      input.agentId,
      `${input.agentId}-${input.seed}-${Date.now()}.jsonl`
    );
    const payload = {
      runId,
      site: input.site,
      journeyId: input.journeyId,
      agentId: input.agentId,
      provider: provider.id,
      model: provider.model,
      promptVersion: provider.promptVersion,
      seed: input.seed,
      defectConfiguration,
      startedAt: this.startedAt,
      violations: []
    };
    await writeJsonlLine(this.jsonlPath, { type: "run_start", at: nowIso(), ...payload });
  }

  async persistRunHeader(runId: string, input: JourneyRunInput, provider: ModelProvider, defectConfiguration: Record<string, unknown>) {
    await this.prisma?.run.upsert({
      where: { runId },
      update: {},
      create: {
        runId,
        site: input.site,
        journeyId: input.journeyId,
        agentId: input.agentId,
        provider: provider.id,
        model: provider.model,
        promptVersion: provider.promptVersion,
        seed: input.seed,
        defectConfiguration,
        startedAt: this.startedAt,
        violations: []
      }
    });
  }

  async recordStep(step: RunStepRecord) {
    await writeJsonlLine(this.jsonlPath, { type: "step", at: nowIso(), ...step });
    await this.prisma?.step.create({
      data: {
        stepId: step.stepId,
        runId: step.runId,
        sequenceNumber: step.sequenceNumber,
        url: step.url,
        observationHash: step.observationHash,
        observationSummary: step.observationSummary,
        actionType: step.actionType,
        actionPayloadRedacted: redactSecrets(step.actionPayloadRedacted),
        decisionReason: step.decisionReason,
        actionResult: redactSecrets(step.actionResult),
        verifierState: step.verifierState || undefined,
        latencyMs: step.latencyMs,
        inputTokens: step.inputTokens,
        outputTokens: step.outputTokens
      }
    });
  }

  async recordArtifact(artifact: ArtifactRecord) {
    await writeJsonlLine(this.jsonlPath, { event: "artifact", at: nowIso(), ...artifact });
    await this.prisma?.artifact.create({
      data: {
        artifactId: artifact.artifactId,
        runId: artifact.runId,
        stepId: artifact.stepId,
        type: artifact.type,
        localPath: artifact.localPath,
        sha256: artifact.sha256,
        metadata: artifact.metadata
      }
    });
  }

  async finishRun(result: JourneyRunResult) {
    await writeJsonlLine(this.jsonlPath, { type: "run_end", at: nowIso(), ...result });
    await this.prisma?.run.update({
      where: { runId: result.runId },
      data: {
        endedAt: new Date(result.endedAt),
        terminationReason: result.terminationReason,
        verifiedSuccess: result.verifiedSuccess,
        violations: result.violations,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens
      }
    });
    await this.exportCsvSummaries();
    return { ...result, resultPath: this.jsonlPath };
  }

  async exportCsvSummaries() {
    const resultsDir = path.join(this.repoRoot, "agents/results");
    await mkdir(resultsDir, { recursive: true });
    const runs = this.prisma ? await this.prisma.run.findMany({ orderBy: { startedAt: "desc" } }) : [];
    await writeFile(
      path.join(resultsDir, "run-summary.csv"),
      ["run_id,site,journey_id,agent_id,provider,model,termination_reason,verified_success,latency_ms", ...runs.map(formatRunCsv)].join("\n")
    );
    await writeFile(
      path.join(resultsDir, "model-usage.csv"),
      ["run_id,provider,model,input_tokens,output_tokens", ...runs.map((run: any) => `${run.runId},${run.provider},${run.model},${run.inputTokens},${run.outputTokens}`)].join("\n")
    );
    const counts = new Map<string, number>();
    for (const run of runs) counts.set(run.terminationReason || "unknown", (counts.get(run.terminationReason || "unknown") || 0) + 1);
    await writeFile(
      path.join(resultsDir, "termination-summary.csv"),
      ["termination_reason,count", ...[...counts.entries()].map(([reason, count]) => `${reason},${count}`)].join("\n")
    );
  }

  async close() {
    await this.prisma?.$disconnect();
  }
}

export class ResultExporter {
  constructor(private readonly recorder: TrajectoryRecorder) {}

  async exportCsvSummaries() {
    await this.recorder.exportCsvSummaries();
  }
}

function formatRunCsv(run: any) {
  return [
    run.runId,
    run.site,
    run.journeyId,
    run.agentId,
    run.provider,
    run.model,
    run.terminationReason || "",
    String(run.verifiedSuccess ?? ""),
    String(run.latencyMs || 0)
  ].join(",");
}
