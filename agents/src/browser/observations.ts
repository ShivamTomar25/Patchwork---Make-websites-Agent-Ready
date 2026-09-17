import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { AgentObservation, AgentType, JourneyContract, SiteKey } from "../core/types.js";
import { compactText, sha256 } from "../core/utils.js";

export async function accessibilityObservation(input: {
  page: Page;
  site: SiteKey;
  agentId: string;
  agentType: AgentType;
  contract: JourneyContract;
  recentHistory: string[];
  remainingSteps: number;
  remainingMs: number;
}): Promise<AgentObservation> {
  const title = await input.page.title();
  const snapshot = await getAriaSnapshot(input.page);
  const visibleErrors = await input.page
    .locator('[role="alert"], .form-error, .status.error')
    .allTextContents()
    .catch(() => []);
  return {
    agentId: input.agentId,
    type: input.agentType,
    site: input.site,
    journeyId: input.contract.id,
    instruction: input.contract.instruction,
    url: input.page.url(),
    title,
    summary: compactText(snapshot, 1200),
    accessibilitySnapshot: compactText(snapshot, 6000),
    visibleErrors: visibleErrors.map((item) => compactText(item, 300)),
    availableTools: [],
    recentHistory: input.recentHistory.slice(-6),
    remainingSteps: input.remainingSteps,
    remainingMs: input.remainingMs
  };
}

export async function screenshotObservation(input: {
  page: Page;
  site: SiteKey;
  agentId: string;
  contract: JourneyContract;
  recentHistory: string[];
  remainingSteps: number;
  remainingMs: number;
  artifactsDir: string;
  runId: string;
  sequence: number;
}): Promise<AgentObservation> {
  await mkdir(input.artifactsDir, { recursive: true });
  const screenshot = await input.page.screenshot({ type: "png", fullPage: false });
  const hash = sha256(screenshot);
  const filePath = path.join(input.artifactsDir, `${input.runId}-step${input.sequence}-${hash.slice(0, 10)}.png`);
  await writeFile(filePath, screenshot);
  const viewport = input.page.viewportSize() || { width: 0, height: 0 };
  return {
    agentId: input.agentId,
    type: "screenshot",
    site: input.site,
    journeyId: input.contract.id,
    instruction: input.contract.instruction,
    url: input.page.url(),
    summary: `Screenshot ${viewport.width}x${viewport.height} sha256=${hash}`,
    screenshotPath: filePath,
    screenshotHash: hash,
    viewport,
    visibleErrors: [],
    availableTools: [],
    recentHistory: input.recentHistory.slice(-6),
    remainingSteps: input.remainingSteps,
    remainingMs: input.remainingMs
  };
}

async function getAriaSnapshot(page: Page): Promise<string> {
  const body = page.locator("body") as unknown as { ariaSnapshot?: () => Promise<string> };
  if (body.ariaSnapshot) return body.ariaSnapshot();
  const [buttons, links, inputs, headings] = await Promise.all([
    page.locator("button").allTextContents().catch(() => []),
    page.locator("a").allTextContents().catch(() => []),
    page.locator("input, textarea, select").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") || node.getAttribute("name") || "")),
    page.locator("h1,h2,h3").allTextContents().catch(() => [])
  ]);
  return JSON.stringify({ headings, links, buttons, fields: inputs });
}
