import { ContractLoader } from "../contracts/contract-loader.js";
import { AccessibilityAgent } from "../agents/accessibility-agent.js";
import { OpenApiToolAgent } from "../agents/openapi-tool-agent.js";
import { ScreenshotAgent } from "../agents/screenshot-agent.js";
import { ScriptedBaselineAgent } from "../agents/scripted-baseline-agent.js";
import type { JourneyRunInput, JourneyRunResult, ResearchAgent, SiteKey } from "../core/types.js";
import { SiteRegistry } from "../sites/site-registry.js";
import { ResearchEndpointClient } from "../verifiers/research-client.js";
import { stableJson } from "../core/utils.js";

export type AgentId = "scripted" | "accessibility-a" | "accessibility-b" | "screenshot" | "tool";
type MatrixOptions = {
  mode: "mock" | "live";
  sites?: SiteKey[];
  journeys?: string[];
  agents?: AgentId[];
  seeds: number[];
  concurrency?: number;
  defectConfiguration?: Record<string, boolean>;
  resume?: boolean;
};

export class ExperimentRunner {
  constructor(private readonly repoRoot: string) {}

  createAgent(agentId: AgentId): ResearchAgent {
    if (agentId === "scripted") return new ScriptedBaselineAgent(this.repoRoot);
    if (agentId === "accessibility-a" || agentId === "accessibility-b") return new AccessibilityAgent(agentId, this.repoRoot);
    if (agentId === "screenshot") return new ScreenshotAgent(this.repoRoot);
    return new OpenApiToolAgent(this.repoRoot);
  }

  async run(input: JourneyRunInput): Promise<JourneyRunResult> {
    const agent = this.createAgent(input.agentId as AgentId);
    try {
      return await agent.runJourney(input);
    } finally {
      await agent.close();
    }
  }

  async smoke(): Promise<{ ok: boolean; results: JourneyRunResult[]; health: Record<string, unknown> }> {
    const registry = new SiteRegistry(this.repoRoot);
    const loader = new ContractLoader(this.repoRoot);
    const health: Record<string, unknown> = {};
    const results: JourneyRunResult[] = [];
    for (const [site, config] of await registry.list()) {
      const client = new ResearchEndpointClient(config);
      health[site] = await client.health();
      await client.reset();
      const contracts = await loader.loadAll(config);
      for (const contract of contracts) {
        results.push(
          await this.run({
            site,
            journeyId: contract.id,
            agentId: "scripted",
            mode: "mock",
            seed: 1,
            maxSteps: contract.maximumSteps,
            timeoutMs: contract.timeoutMs,
            tokenBudget: 1,
            authorizeResearchTools: false,
            defectConfiguration: {}
          })
        );
      }
    }
    return { ok: results.every((result) => result.verifiedSuccess), results, health };
  }

  async matrix(options: MatrixOptions): Promise<JourneyRunResult[]> {
    const registry = new SiteRegistry(this.repoRoot);
    const loader = new ContractLoader(this.repoRoot);
    const sites = options.sites || (["shop", "saas", "support"] as SiteKey[]);
    const agents = options.agents || (["accessibility-a", "accessibility-b", "screenshot", "tool"] as AgentId[]);
    const tasks: JourneyRunInput[] = [];
    for (const site of sites) {
      const config = await registry.get(site);
      const contracts = await loader.loadAll(config);
      const selectedContracts = options.journeys
        ? contracts.filter((item) => options.journeys?.includes(item.id))
        : options.mode === "mock"
          ? contracts.slice(0, 1)
          : contracts;
      for (const contract of selectedContracts) {
        for (const agentId of agents) {
          for (const seed of options.seeds) {
            tasks.push({
              site,
              journeyId: contract.id,
              agentId,
              mode: options.mode,
              seed,
              maxSteps: options.mode === "mock" ? Math.min(contract.maximumSteps, 12) : contract.maximumSteps,
              timeoutMs: contract.timeoutMs,
              tokenBudget: 20000,
              authorizeResearchTools: false,
              defectConfiguration: options.defectConfiguration || {}
            });
          }
        }
      }
    }
    const concurrency = options.concurrency || 1;
    const results: JourneyRunResult[] = [];
    for (let index = 0; index < tasks.length; index += concurrency) {
      const batch = tasks.slice(index, index + concurrency);
      results.push(
        ...(await Promise.all(
          batch.map(async (task) => {
            if (options.resume) {
              const completed = await this.findCompletedRun(task);
              if (completed) return completed;
            }
            return this.run(task);
          })
        ))
      );
    }
    return results;
  }

  private async findCompletedRun(input: JourneyRunInput): Promise<JourneyRunResult | undefined> {
    const module = await import("../generated/prisma/index.js").catch(() => undefined);
    if (!module) return undefined;
    const prisma = new module.PrismaClient();
    try {
      const candidates = await prisma.run.findMany({
        where: {
          site: input.site,
          journeyId: input.journeyId,
          agentId: input.agentId,
          seed: input.seed,
          verifiedSuccess: true
        },
        orderBy: { startedAt: "desc" },
        take: 25
      });
      const defectConfiguration = stableJson(input.defectConfiguration || {});
      const run = candidates.find((candidate: any) => stableJson(candidate.defectConfiguration || {}) === defectConfiguration);
      if (!run) return undefined;
      const violations = Array.isArray(run.violations) ? run.violations.filter((value: unknown): value is string => typeof value === "string") : [];
      return {
        runId: run.runId,
        site: input.site,
        journeyId: input.journeyId,
        agentId: input.agentId,
        provider: run.provider,
        model: run.model,
        promptVersion: run.promptVersion,
        seed: input.seed,
        startedAt: run.startedAt.toISOString(),
        endedAt: (run.endedAt || run.startedAt).toISOString(),
        terminationReason: "resumed_already_complete",
        verifiedSuccess: true,
        violations,
        steps: 0,
        latencyMs: Number(run.latencyMs || 0),
        inputTokens: Number(run.inputTokens || 0),
        outputTokens: Number(run.outputTokens || 0)
      };
    } finally {
      await prisma.$disconnect();
    }
  }
}
