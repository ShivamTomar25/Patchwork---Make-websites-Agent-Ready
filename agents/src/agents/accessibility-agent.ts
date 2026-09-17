import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ActionExecutor } from "../browser/action-executor.js";
import { accessibilityObservation } from "../browser/observations.js";
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
import { makeRunId, nowIso, observationHash, redactSecrets } from "../core/utils.js";
import { parseDecisionWithRetry } from "../providers/model-provider.js";
import { ModelProviderRegistry } from "../providers/provider-registry.js";
import { SiteRegistry } from "../sites/site-registry.js";
import { TrajectoryRecorder } from "../storage/trajectory-recorder.js";
import { ResearchEndpointClient } from "../verifiers/research-client.js";

export class AccessibilityAgent implements ResearchAgent {
  readonly type = "accessibility" as const;
  private context?: AgentContext;
  private executor?: ActionExecutor;
  private readonly browser = new BrowserSessionManager();

  constructor(
    readonly id: "accessibility-a" | "accessibility-b",
    private readonly repoRoot: string
  ) {}

  async initialize(context: AgentContext): Promise<void> {
    this.context = context;
    this.executor = new ActionExecutor(context.siteConfig, context.page);
  }

  async observe(): Promise<AgentObservation> {
    if (!this.context?.page) throw new Error("AGENT_NOT_INITIALIZED");
    return accessibilityObservation({
      page: this.context.page,
      site: this.context.site,
      agentId: this.id,
      agentType: this.type,
      contract: this.context.contract,
      recentHistory: [],
      remainingSteps: 0,
      remainingMs: 0
    });
  }

  async decide(observation: AgentObservation): Promise<AgentDecision> {
    const promptPath = path.join(this.repoRoot, "agents/prompts", this.id === "accessibility-a" ? "accessibility-a.md" : "accessibility-b.md");
    const system = await readFile(promptPath, "utf8");
    const provider = new ModelProviderRegistry().get(this.id, this.context?.mode || "mock");
    const { decision } = await parseDecisionWithRetry(provider, {
      schemaName: "AgentDecision",
      temperature: 0,
      maxOutputTokens: 512,
      timeoutMs: 30000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(observation) }
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
    await page.goto(startUrl(input.site, input.journeyId));
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
        const observation = await accessibilityObservation({
          page,
          site: input.site,
          agentId: this.id,
          agentType: this.type,
          contract,
          recentHistory: history,
          remainingSteps: budget.remainingSteps(stepCount),
          remainingMs: budget.remainingMs()
        });
        const hash = observationHash(observation);
        const decision =
          input.mode === "mock" ? mockAccessibilityDecision(observation, history) : await this.decide(observation);
        const result = await this.execute(decision);
        budget.recordUsage(decision.usage.inputTokens, decision.usage.outputTokens);
        history.push(`${decision.action.type}:${decision.reason}:${result.ok ? "ok" : "fail"}`);
        stepCount += 1;
        const verifierState = stepCount % 2 === 0 ? await research.state().catch(() => undefined) : undefined;
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
          verifierState,
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
          violations = [];
          terminationReason = "verified_success";
          break;
        }
        if (decision.action.type === "finish") {
          terminationReason = "agent_finish";
          violations = verification?.violations || ["Agent finished before authoritative success"];
          break;
        }
        if (loopDetector.check({ url: page.url(), observationHash: hash, action: decision.action, verifierState })) {
          terminationReason = "repeated_loop";
          violations = ["Repeated URL/observation/action state"];
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

function startUrl(site: string, journeyId: string): string {
  if (site === "shop") return journeyId === "SHOP-J2" ? "/orders/ORDER-101" : "/cart";
  if (site === "saas") return journeyId === "SAAS-J1" ? "/onboarding" : "/workspaces/new";
  return "/tickets/new";
}

function mockAccessibilityDecision(observation: AgentObservation, history: string[]): AgentDecision {
  const url = observation.url;
  const clickedAdd = history.some((item) => item.includes("click_by_role:Add"));
  if (url.includes("/login")) return action({ type: "click_by_role", role: "button", name: "Login" }, "Login form is prefilled with the configured seeded account.");
  if (observation.site === "shop") {
    if (url.includes("/cart") && !clickedAdd) return action({ type: "navigate", url: "http://localhost:3101/products" }, "Authenticated session is ready; go to the product catalogue.");
    if (url.includes("/products") && !clickedAdd) return action({ type: "click_by_role", role: "button", name: "Add" }, "Add the filtered LAPTOP-42 product.");
    if (url.includes("/products") && clickedAdd) return action({ type: "navigate", url: "http://localhost:3101/checkout" }, "Cart has the target product; move to checkout.");
    if (url.includes("/checkout") && !url.includes("confirmation")) return action({ type: "click_by_role", role: "button", name: "Place confirmed order" }, "Confirm the local checkout.");
  }
  if (observation.site === "saas") {
    if (url.includes("/onboarding")) return action({ type: "click_by_role", role: "button", name: "Complete onboarding" }, "Complete onboarding.");
    if (url.includes("/workspaces/new")) return action({ type: "click_by_role", role: "button", name: "Create workspace" }, "Create ACME-LAB workspace.");
  }
  if (observation.site === "support") {
    if (url.includes("/tickets/new")) return action({ type: "click_by_role", role: "button", name: "Submit high-priority ticket" }, "Submit the prefilled ticket.");
  }
  return action({ type: "finish" }, "Mock accessibility agent reached the expected terminal page.");
}

function action(actionValue: AgentDecision["action"], reason: string): AgentDecision {
  return { action: actionValue, reason, usage: { inputTokens: 0, outputTokens: 0 } };
}
