import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ExperimentRunner } from "../src/runner/experiment-runner.js";
import { applySyntheticCredentialDefaults } from "../src/research/local-fixtures.js";
import { SiteRegistry } from "../src/sites/site-registry.js";
import { ResearchEndpointClient } from "../src/verifiers/research-client.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const runLiveIntegration = process.env.PATCHWORK_AGENTS_INTEGRATION === "1";
applySyntheticCredentialDefaults();

describe.skipIf(!runLiveIntegration)("local replica integration", () => {
  const cleanJourneys = [
    ["shop", "SHOP-J1", 30, 120000],
    ["shop", "SHOP-J2", 24, 90000],
    ["shop", "SHOP-J3", 24, 120000],
    ["saas", "SAAS-J1", 30, 120000],
    ["saas", "SAAS-J2", 24, 90000],
    ["saas", "SAAS-J3", 24, 90000],
    ["saas", "SAAS-J4", 24, 90000],
    ["support", "SUPPORT-J1", 30, 120000],
    ["support", "SUPPORT-J2", 30, 120000],
    ["support", "SUPPORT-J3", 24, 90000],
    ["support", "SUPPORT-J4", 30, 120000]
  ] as const;

  it.each(cleanJourneys)("runs clean scripted baseline for %s %s", async (site, journeyId, maxSteps, timeoutMs) => {
    const result = await new ExperimentRunner(repoRoot).run({
      site,
      journeyId,
      agentId: "scripted",
      mode: "mock",
      seed: 1,
      maxSteps,
      timeoutMs,
      tokenBudget: 1000,
      authorizeResearchTools: false,
      defectConfiguration: {}
    });
    expect(result.verifiedSuccess).toBe(true);
  });

  it.each([
    ["shop", "SHOP-J1", "SHOP-SESSION-001"],
    ["saas", "SAAS-J1", "SAAS-SESSION-001"],
    ["support", "SUPPORT-J1", "SUPPORT-SESSION-001"]
  ] as const)("detects deterministic defect for %s", async (site, journeyId, defectId) => {
    const result = await new ExperimentRunner(repoRoot).run({
      site,
      journeyId,
      agentId: "scripted",
      mode: "mock",
      seed: 1,
      maxSteps: 30,
      timeoutMs: 120000,
      tokenBudget: 1000,
      authorizeResearchTools: false,
      defectConfiguration: { [defectId]: true }
    });
    expect(result.verifiedSuccess).toBe(false);
  });

  it("runs a clean scripted journey and verifies backend state", async () => {
    const result = await new ExperimentRunner(repoRoot).run({
      site: "shop",
      journeyId: "SHOP-J1",
      agentId: "scripted",
      mode: "mock",
      seed: 1,
      maxSteps: 30,
      timeoutMs: 120000,
      tokenBudget: 1000,
      authorizeResearchTools: false,
      defectConfiguration: {}
    });
    expect(result.verifiedSuccess).toBe(true);
  });

  it("activates a deterministic defect and records expected verifier failure", async () => {
    const result = await new ExperimentRunner(repoRoot).run({
      site: "shop",
      journeyId: "SHOP-J1",
      agentId: "scripted",
      mode: "mock",
      seed: 1,
      maxSteps: 30,
      timeoutMs: 120000,
      tokenBudget: 1000,
      authorizeResearchTools: false,
      defectConfiguration: { "SHOP-SESSION-001": true }
    });
    expect(result.verifiedSuccess).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("restores clean state after a defect reset", async () => {
    const site = await new SiteRegistry(repoRoot).get("shop");
    const client = new ResearchEndpointClient(site);
    await client.reset({ "SHOP-SESSION-001": true });
    await client.reset({});
    const defects = await client.defects();
    expect(JSON.stringify(defects)).not.toContain('"enabled":true');
    const result = await new ExperimentRunner(repoRoot).run({
      site: "shop",
      journeyId: "SHOP-J1",
      agentId: "scripted",
      mode: "mock",
      seed: 2,
      maxSteps: 30,
      timeoutMs: 120000,
      tokenBudget: 1000,
      authorizeResearchTools: false,
      defectConfiguration: {}
    });
    expect(result.verifiedSuccess).toBe(true);
  });

  it("runs a mock accessibility journey and verifies backend state", async () => {
    const result = await new ExperimentRunner(repoRoot).run({
      site: "shop",
      journeyId: "SHOP-J1",
      agentId: "accessibility-a",
      mode: "mock",
      seed: 1,
      maxSteps: 12,
      timeoutMs: 120000,
      tokenBudget: 1000,
      authorizeResearchTools: false,
      defectConfiguration: {}
    });
    expect(result.verifiedSuccess).toBe(true);
  });

  it("runs a mock screenshot journey and verifies backend state", async () => {
    const result = await new ExperimentRunner(repoRoot).run({
      site: "support",
      journeyId: "SUPPORT-J1",
      agentId: "screenshot",
      mode: "mock",
      seed: 1,
      maxSteps: 10,
      timeoutMs: 120000,
      tokenBudget: 1000,
      authorizeResearchTools: false,
      defectConfiguration: {}
    });
    expect(result.verifiedSuccess).toBe(true);
  });

  it("runs a mock tool journey and verifies backend state", async () => {
    const result = await new ExperimentRunner(repoRoot).run({
      site: "saas",
      journeyId: "SAAS-J1",
      agentId: "tool",
      mode: "mock",
      seed: 1,
      maxSteps: 10,
      timeoutMs: 120000,
      tokenBudget: 1000,
      authorizeResearchTools: false,
      defectConfiguration: {}
    });
    expect(result.verifiedSuccess).toBe(true);
  });
});
