import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ActionExecutor, fileToDataUrl } from "../browser/action-executor.js";
import { screenshotObservation } from "../browser/observations.js";
import { BrowserSessionManager } from "../browser/session-manager.js";
import { ContractLoader } from "../contracts/contract-loader.js";
import { BudgetManager } from "../core/budget-manager.js";
import { LoopDetector } from "../core/loop-detector.js";
import { JourneyRunInputSchema } from "../core/schemas.js";
import type {
  ActionResult,
  AgentContext,
  AgentDecision,
  AgentObservation,
  JourneyRunInput,
  JourneyRunResult,
  ResearchAgent
} from "../core/types.js";
import { makeRunId, nowIso, observationHash, redactSecrets, sha256 } from "../core/utils.js";
import { parseDecisionWithRetry } from "../providers/model-provider.js";
import { ModelProviderRegistry } from "../providers/provider-registry.js";
import { SiteRegistry } from "../sites/site-registry.js";
import { TrajectoryRecorder } from "../storage/trajectory-recorder.js";
import { ResearchEndpointClient } from "../verifiers/research-client.js";

export class ScreenshotAgent implements ResearchAgent {
  readonly id = "screenshot";
  readonly type = "screenshot" as const;
  private context?: AgentContext;
  private executor?: ActionExecutor;
  private readonly browser = new BrowserSessionManager();

  constructor(private readonly repoRoot: string) {}

  async initialize(context: AgentContext): Promise<void> {
    this.context = context;
    this.executor = new ActionExecutor(context.siteConfig, context.page);
  }

  async observe(): Promise<AgentObservation> {
    if (!this.context?.page) throw new Error("AGENT_NOT_INITIALIZED");
    return screenshotObservation({
      page: this.context.page,
      site: this.context.site,
      agentId: this.id,
      contract: this.context.contract,
      recentHistory: [],
      remainingSteps: 0,
      remainingMs: 0,
      artifactsDir: path.join(this.repoRoot, "agents/results/artifacts", this.context.runId),
      runId: this.context.runId,
      sequence: 0
    });
  }

  async decide(observation: AgentObservation): Promise<AgentDecision> {
    const provider = new ModelProviderRegistry().get(this.id, this.context?.mode || "mock");
    const system = await readFile(path.join(this.repoRoot, "agents/prompts/screenshot.md"), "utf8");
    const imageUrl = observation.screenshotPath ? await fileToDataUrl(observation.screenshotPath) : "";
    const { decision } = await parseDecisionWithRetry(provider, {
      schemaName: "ScreenshotAgentDecision",
      temperature: 0,
      maxOutputTokens: 512,
      timeoutMs: 30000,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify({ ...observation, screenshotPath: undefined }) },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ]
    });
    return decision;
  }

  async execute(decision: AgentDecision): Promise<ActionResult> {
    if (!this.executor) throw new Error("AGENT_NOT_INITIALIZED");
    return this.executor.execute(decision);
  }

  async runJourney(rawInput: JourneyRunInput): Promise<JourneyRunResult> {
    const input = JourneyRunInputSchema.parse({ ...rawInput, agentId: this.id });
    const started = Date.now();
    const runId = makeRunId(input.site, input.journeyId, this.id, input.seed);
    const registry = new SiteRegistry(this.repoRoot);
    const siteConfig = await registry.get(input.site);
    const contract = await new ContractLoader(this.repoRoot).get(siteConfig, input.journeyId);
    const provider = new ModelProviderRegistry().get(this.id, input.mode);
    const research = new ResearchEndpointClient(siteConfig);
    const recorder = new TrajectoryRecorder(this.repoRoot);
    await recorder.initialize();
    await research.reset(input.defectConfiguration);
    const defects = await research.defects();
    const defectConfiguration = Object.fromEntries((defects.defects || []).map((defect: any) => [defect.id, defect.enabled]));
    await recorder.startRun(runId, input, provider, defectConfiguration);
    await recorder.persistRunHeader(runId, input, provider, defectConfiguration);
    const { context, page } = await this.browser.newContext(siteConfig);
    await page.goto(startUrl(input.site));
    await this.initialize({ repoRoot: this.repoRoot, site: input.site, siteConfig, contract, seed: input.seed, mode: input.mode, runId, browserContext: context, page });
    const budget = new BudgetManager(input.maxSteps, input.timeoutMs, input.tokenBudget);
    const loopDetector = new LoopDetector();
    const history: string[] = [];
    let terminationReason = "max_steps";
    let verifiedSuccess = false;
    let violations: string[] = [];
    let stepCount = 0;

    try {
      while (true) {
        budget.assertCanContinue(stepCount);
        const observation = await screenshotObservation({
          page,
          site: input.site,
          agentId: this.id,
          contract,
          recentHistory: history,
          remainingSteps: budget.remainingSteps(stepCount),
          remainingMs: budget.remainingMs(),
          artifactsDir: path.join(this.repoRoot, "agents/results/artifacts", runId),
          runId,
          sequence: stepCount + 1
        });
        if (observation.screenshotPath && observation.screenshotHash) {
          await recorder.recordArtifact({
            artifactId: randomUUID(),
            runId,
            type: "screenshot",
            localPath: observation.screenshotPath,
            sha256: observation.screenshotHash,
            metadata: observation.viewport || {}
          });
        }
        const hash = observationHash({ url: observation.url, screenshotHash: observation.screenshotHash, viewport: observation.viewport });
        const decision =
          input.mode === "mock" ? await mockScreenshotDecision(page, input.site, history) : await this.decide(observation);
        const result = await this.execute(decision);
        budget.recordUsage(decision.usage.inputTokens, decision.usage.outputTokens);
        history.push(`${decision.action.type}:${decision.reason}:${result.ok ? "ok" : "fail"}`);
        stepCount += 1;
        await recorder.recordStep({
          stepId: randomUUID(),
          runId,
          sequenceNumber: stepCount,
          url: page.url(),
          observationHash: hash,
          observationSummary: observation.summary,
          actionType: decision.action.type,
          actionPayloadRedacted: redactSecrets(decision.action),
          decisionReason: decision.reason,
          actionResult: result as unknown as Record<string, unknown>,
          latencyMs: result.latencyMs,
          inputTokens: decision.usage.inputTokens,
          outputTokens: decision.usage.outputTokens
        });
        if (decision.action.type === "abort") {
          terminationReason = "agent_abort";
          break;
        }
        const verification = await research.verify(input.journeyId).catch(() => undefined);
        if (verification?.verifiedSuccess) {
          verifiedSuccess = true;
          terminationReason = "verified_success";
          break;
        }
        if (decision.action.type === "finish") {
          terminationReason = "agent_finish";
          violations = verification?.violations || ["Agent finished before authoritative success"];
          break;
        }
        if (loopDetector.check({ url: page.url(), observationHash: hash, action: decision.action })) {
          terminationReason = "repeated_loop";
          violations = ["Repeated screenshot/action state"];
          break;
        }
      }
    } catch (error) {
      terminationReason = error instanceof Error ? error.message : "safety_violation";
      violations = [terminationReason];
    } finally {
      await context.close();
    }

    if (!verifiedSuccess) {
      const verification = await research.verify(input.journeyId).catch(() => undefined);
      verifiedSuccess = Boolean(verification?.verifiedSuccess);
      violations = verification?.violations || violations;
      if (verifiedSuccess) terminationReason = "verified_success";
    }
    const usage = budget.usage();
    const result: JourneyRunResult = {
      runId,
      site: input.site,
      journeyId: input.journeyId,
      agentId: this.id,
      provider: provider.id,
      model: provider.model,
      promptVersion: provider.promptVersion,
      seed: input.seed,
      startedAt: new Date(started).toISOString(),
      endedAt: nowIso(),
      terminationReason,
      verifiedSuccess,
      violations,
      steps: stepCount,
      latencyMs: Date.now() - started,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens
    };
    const finalResult = await recorder.finishRun(result);
    await recorder.close();
    return finalResult;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

function startUrl(site: string) {
  if (site === "shop") return "/cart";
  if (site === "saas") return "/onboarding";
  return "/tickets/new";
}

async function mockScreenshotDecision(page: any, site: string, history: string[]): Promise<AgentDecision> {
  if (page.url().includes("/login")) return clickCenter(page, "button", "Login", "Click the visible login button in the screenshot.");
  if (site === "shop") {
    if (page.url().includes("/cart")) {
      await page.goto("/products");
      return { action: { type: "wait", ms: 1 }, reason: "navigate-products", usage: { inputTokens: 0, outputTokens: 0 } };
    }
    if (page.url().includes("/products") && !history.some((item) => item.includes("add target"))) return clickCenter(page, "button", "Add", "add target");
    if (page.url().includes("/products")) {
      await page.goto("/checkout");
      return { action: { type: "wait", ms: 1 }, reason: "Go to checkout after visible cart action.", usage: { inputTokens: 0, outputTokens: 0 } };
    }
    if (page.url().includes("/checkout")) return clickCenter(page, "button", "Place confirmed order", "Click the visible checkout confirmation button.");
  }
  if (site === "saas") {
    if (page.url().includes("/onboarding")) return clickCenter(page, "button", "Complete onboarding", "Click visible onboarding completion.");
    if (page.url().includes("/workspaces/new")) return clickCenter(page, "button", "Create workspace", "Click visible workspace creation.");
    await page.goto("/workspaces/new");
    return { action: { type: "wait", ms: 1 }, reason: "Move to visible workspace creation screen.", usage: { inputTokens: 0, outputTokens: 0 } };
  }
  if (site === "support" && page.url().includes("/tickets/new")) return clickCenter(page, "button", "Submit high-priority ticket", "Click visible ticket submit.");
  return { action: { type: "finish" }, reason: "Mock screenshot flow reached terminal state.", usage: { inputTokens: 0, outputTokens: 0 } };
}

async function clickCenter(page: any, role: string, name: string, reason: string): Promise<AgentDecision> {
  const box = await page.getByRole(role, { name }).boundingBox();
  if (!box) return { action: { type: "abort", code: "MOCK_TARGET_NOT_FOUND", message: `${role}:${name}` }, reason, usage: { inputTokens: 0, outputTokens: 0 } };
  return {
    action: { type: "click_xy", x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y + box.height / 2) },
    reason,
    usage: { inputTokens: 0, outputTokens: 0 }
  };
}

export function screenshotArtifactHash(buffer: Buffer) {
  return sha256(buffer);
}
