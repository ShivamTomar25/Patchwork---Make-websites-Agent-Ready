import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import { ContractLoader } from "../contracts/contract-loader.js";
import { JourneyRunInputSchema } from "../core/schemas.js";
import type {
  ActionResult,
  AgentContext,
  AgentDecision,
  AgentObservation,
  JourneyRunInput,
  JourneyRunResult,
  ResearchAgent,
  SiteKey
} from "../core/types.js";
import { makeRunId, nowIso, observationHash, redactSecrets } from "../core/utils.js";
import { BrowserSessionManager } from "../browser/session-manager.js";
import { ResearchEndpointClient } from "../verifiers/research-client.js";
import { resolveCredential, SiteRegistry } from "../sites/site-registry.js";
import { TrajectoryRecorder } from "../storage/trajectory-recorder.js";
import type { ModelProvider } from "../core/types.js";

const SCRIPTED_PROVIDER: ModelProvider = {
  id: "scripted-playwright",
  model: "none",
  promptVersion: "scripted-2026-08-03",
  completeJson: async () => {
    throw new Error("Scripted baseline does not call a model");
  }
};

export class ScriptedBaselineAgent implements ResearchAgent {
  readonly id = "scripted";
  readonly type = "scripted" as const;
  private context?: AgentContext;
  private browser = new BrowserSessionManager();

  constructor(private readonly repoRoot: string) {}

  async initialize(context: AgentContext): Promise<void> {
    this.context = context;
  }

  async observe(): Promise<AgentObservation> {
    if (!this.context) throw new Error("AGENT_NOT_INITIALIZED");
    return {
      agentId: this.id,
      type: this.type,
      site: this.context.site,
      journeyId: this.context.contract.id,
      instruction: this.context.contract.instruction,
      url: this.context.page?.url() || this.context.siteConfig.frontendUrl,
      summary: "Scripted Playwright baseline uses deterministic workflow steps.",
      visibleErrors: [],
      availableTools: [],
      recentHistory: [],
      remainingSteps: 0,
      remainingMs: 0
    };
  }

  async decide(_observation: AgentObservation): Promise<AgentDecision> {
    return { action: { type: "finish" }, reason: "Scripted baseline owns its workflow.", usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async execute(decision: AgentDecision): Promise<ActionResult> {
    return { ok: true, actionType: decision.action.type, message: "Scripted baseline execute noop", latencyMs: 0 };
  }

  async runJourney(rawInput: JourneyRunInput): Promise<JourneyRunResult> {
    const input = JourneyRunInputSchema.parse(rawInput);
    const started = Date.now();
    const runId = makeRunId(input.site, input.journeyId, this.id, input.seed);
    const registry = new SiteRegistry(this.repoRoot);
    const siteConfig = await registry.get(input.site);
    const contract = await new ContractLoader(this.repoRoot).get(siteConfig, input.journeyId);
    const research = new ResearchEndpointClient(siteConfig);
    const recorder = new TrajectoryRecorder(this.repoRoot);
    await recorder.initialize();
    await recorder.startRun(runId, { ...input, agentId: this.id }, SCRIPTED_PROVIDER, input.defectConfiguration);
    await recorder.persistRunHeader(runId, { ...input, agentId: this.id }, SCRIPTED_PROVIDER, input.defectConfiguration);
    const resetState = await research.reset(input.defectConfiguration);
    const defects = await research.defects();
    const activeDefects = Object.fromEntries((defects.defects || []).map((defect: any) => [defect.id, defect.enabled]));
    const { context, page } = await this.browser.newContext(siteConfig);
    await this.initialize({ repoRoot: this.repoRoot, site: input.site, siteConfig, contract, seed: input.seed, mode: input.mode, runId, browserContext: context, page });
    const steps: string[] = [`reset:${JSON.stringify(redactSecrets(resetState.counts || resetState))}`, `defects:${JSON.stringify(redactSecrets(defects.defects || []))}`];
    let terminationReason = "verified_success";
    let verifiedSuccess = false;
    let violations: string[] = [];

    try {
      await this.perform(input.site, input.journeyId, page, context, activeDefects);
      const verification = await research.verify(input.journeyId);
      verifiedSuccess = verification.verifiedSuccess;
      violations = verification.violations;
      terminationReason = verifiedSuccess ? "verified_success" : "verifier_failure";
      await recorder.recordStep({
        stepId: randomUUID(),
        runId,
        sequenceNumber: 1,
        url: page.url(),
        observationHash: observationHash({ url: page.url(), title: await page.title(), steps }),
        observationSummary: steps.join(" | "),
        actionType: "scripted_workflow",
        actionPayloadRedacted: { site: input.site, journeyId: input.journeyId },
        decisionReason: "Deterministic Playwright baseline executed the contract workflow.",
        actionResult: { ok: verifiedSuccess, verifier: verification },
        verifierState: verification,
        latencyMs: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0
      });
    } catch (error) {
      terminationReason = "safety_violation";
      violations = [error instanceof Error ? error.message : String(error)];
      await recorder.recordStep({
        stepId: randomUUID(),
        runId,
        sequenceNumber: 1,
        url: page.url(),
        observationHash: observationHash({ error: violations }),
        observationSummary: violations.join("; "),
        actionType: "scripted_workflow",
        actionPayloadRedacted: { site: input.site, journeyId: input.journeyId },
        decisionReason: "Scripted workflow stopped after an error.",
        actionResult: { ok: false, error: violations },
        latencyMs: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0
      });
    } finally {
      await context.close();
    }

    const result: JourneyRunResult = {
      runId,
      site: input.site,
      journeyId: input.journeyId,
      agentId: this.id,
      provider: SCRIPTED_PROVIDER.id,
      model: SCRIPTED_PROVIDER.model,
      promptVersion: SCRIPTED_PROVIDER.promptVersion,
      seed: input.seed,
      startedAt: new Date(started).toISOString(),
      endedAt: nowIso(),
      terminationReason,
      verifiedSuccess,
      violations,
      steps: 1,
      latencyMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0
    };
    const finalResult = await recorder.finishRun(result);
    await recorder.close();
    return finalResult;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  private async perform(site: SiteKey, journeyId: string, page: Page, context: BrowserContext, defects: Record<string, boolean>) {
    if (site === "shop") await this.performShop(journeyId, page, defects);
    else if (site === "saas") await this.performSaas(journeyId, page, defects);
    else await this.performSupport(journeyId, page, context, defects);
  }

  private async performShop(journeyId: string, page: Page, defects: Record<string, boolean>) {
    await login(this.repoRoot, page, "shop", "user");
    if (journeyId === "SHOP-J2") {
      await page.goto("/orders/ORDER-101");
      await page.getByRole("link", { name: "Cancel order" }).click();
      await page.getByRole("button", { name: "Cancel and refund" }).click();
      await page.getByText("Order cancellation and refund are recorded.").waitFor();
      if (active(defects, "SHOP-AUTH-001")) await probeShopCrossAccountOrder(page);
      return;
    }
    await page.goto("/products");
    await page.getByTestId("product-search").fill("LAPTOP-42");
    await page.getByTestId("add-LAPTOP-42").click();
    await page.goto("/checkout");
    await page.getByTestId("checkout-idempotency-key").fill(journeyId === "SHOP-J3" ? "SHOP-J3-IDEMPOTENCY" : "SHOP-J1-IDEMPOTENCY");
    await page.getByTestId("checkout-confirmation").check();
    await page.getByTestId("checkout-submit").click();
    await page.getByRole("heading", { name: "Order confirmation" }).waitFor();
    if (journeyId === "SHOP-J3") {
      await page.evaluate(async () => {
        const apiUrl = (window as Window & { __PATCHWORK_API_URL?: string }).__PATCHWORK_API_URL || "http://localhost:4101";
        await fetch(`${apiUrl}/api/shop/checkout`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", "Idempotency-Key": "SHOP-J3-IDEMPOTENCY" },
          body: JSON.stringify({ addressId: "addr-shopper-home", shippingMethod: "GROUND", confirmed: true })
        });
      });
    }
  }

  private async performSaas(journeyId: string, page: Page, defects: Record<string, boolean>) {
    await login(this.repoRoot, page, "saas", "user");
    if (journeyId === "SAAS-J1") {
      await createAcmeWorkspace(page);
      return;
    }
    await createAcmeWorkspace(page);
    if (journeyId === "SAAS-J2") {
      await page.goto("/workspaces/workspace-acme-lab/members");
      await page.getByTestId("invite-submit").click();
      await page.getByText("analyst@patchwork.local").waitFor();
      return;
    }
    if (journeyId === "SAAS-J3") {
      await page.goto("/billing?workspaceId=workspace-acme-lab");
      if (active(defects, "SAAS-CONFIRM-001")) {
        await page.getByLabel(/I confirm this local mock plan change/).uncheck();
      }
      await page.getByTestId("billing-confirm").click();
      await page.getByText("Pro plan saved once.").waitFor();
      return;
    }
    if (journeyId === "SAAS-J4") {
      await page.goto("/workspaces/workspace-acme-lab/integrations");
      await page.getByTestId("integration-save").click();
      await page.getByText("Research Webhook").waitFor();
    }
  }

  private async performSupport(journeyId: string, page: Page, context: BrowserContext, defects: Record<string, boolean>) {
    await login(this.repoRoot, page, "support", "user");
    await page.goto("/tickets/new");
    await page.getByTestId("ticket-submit").click();
    await page.getByRole("heading", { name: /Ticket/ }).waitFor();
    if (journeyId === "SUPPORT-J1") return;
    if (journeyId === "SUPPORT-J3") {
      await page.goto("/tickets/TICKET-201/escalate");
      if (active(defects, "SUPPORT-CONFIRM-001")) {
        await page.getByLabel(/I confirm this ticket escalation/).uncheck();
      }
      await page.getByTestId("ticket-escalate").click();
      await page.getByText("Escalation recorded.").waitFor();
      return;
    }
    await context.clearCookies();
    await login(this.repoRoot, page, "support", "agent");
    if (journeyId === "SUPPORT-J2") {
      await page.goto("/agent/tickets/TICKET-201");
      await page.getByRole("button", { name: "Assign to me" }).click();
      await page.getByRole("button", { name: "Set In Progress" }).click();
      await page.getByRole("button", { name: "Add internal note" }).click();
      await page.getByText("Internal note: deterministic investigation started.").waitFor();
      if (active(defects, "SUPPORT-AUTH-001")) await probeSupportCrossAccountTicket(page);
      return;
    }
    if (journeyId === "SUPPORT-J4") {
      await page.goto("/tickets/TICKET-201/edit");
      await page.getByRole("button", { name: "Save ticket" }).click();
      await context.clearCookies();
      await login(this.repoRoot, page, "support", "user");
      await page.goto("/tickets/TICKET-201");
      await page.getByRole("button", { name: "Verify resolution" }).click();
    }
  }
}

async function createAcmeWorkspace(page: Page) {
  await page.goto("/onboarding");
  await page.getByTestId("onboarding-continue").click();
  await page.goto("/workspaces/new");
  await page.getByTestId("workspace-create").click();
  await page.getByRole("heading", { name: "Workspace" }).waitFor();
}

function active(defects: Record<string, boolean>, defectId: string) {
  return defects[defectId] === true;
}

async function probeShopCrossAccountOrder(page: Page) {
  await page.evaluate(async () => {
    const apiUrl = (window as Window & { __PATCHWORK_API_URL?: string }).__PATCHWORK_API_URL || "http://localhost:4101";
    const headers = { "content-type": "application/json" };
    await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", credentials: "include" });
    await fetch(`${apiUrl}/api/auth/register`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        email: "shop-intruder@patchwork.local",
        password: "Intruder123!",
        name: "Shop Intruder"
      })
    });
  });
  await page.goto("/orders/ORDER-101");
  await page.waitForLoadState("networkidle");
}

async function probeSupportCrossAccountTicket(page: Page) {
  await page.evaluate(async () => {
    const apiUrl = (window as Window & { __PATCHWORK_API_URL?: string }).__PATCHWORK_API_URL || "http://localhost:4103";
    const headers = { "content-type": "application/json" };
    await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", credentials: "include" });
    await fetch(`${apiUrl}/api/auth/register`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        email: "support-intruder@patchwork.local",
        password: "Intruder123!",
        name: "Support Intruder"
      })
    });
  });
  await page.goto("/tickets/TICKET-201");
  await page.waitForLoadState("networkidle");
}

async function login(repoRoot: string, page: Page, site: SiteKey, role: "admin" | "user" | "agent" | "member") {
  const siteConfig = await new SiteRegistry(repoRoot).get(site);
  const credential = resolveCredential(siteConfig, role);
  await page.goto("/login");
  await page.getByLabel("Email").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  await page.getByTestId("login-submit").click();
  await page.locator(".session").getByText(credential.email).waitFor();
}
