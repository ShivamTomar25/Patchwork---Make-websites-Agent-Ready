import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { JourneyContract, SiteConfig } from "../core/types.js";
import { ResearchContractsFileSchema, type ResearchContract } from "./research-contract-schema.js";

type RawJourney = {
  id: string;
  instruction: string;
  starting_checkpoint?: string;
  startingCheckpoint?: string;
  maximum_steps?: number;
  maximumSteps?: number;
  timeout?: string | number;
  timeoutMs?: number;
  success_predicates?: string[];
  successPredicates?: string[];
  safety_invariants?: string[];
  safetyInvariants?: string[];
  affected_defects?: string[];
  affectedDefects?: string[];
};

export class ContractLoader {
  constructor(private readonly repoRoot: string) {}

  async loadAll(siteConfig: SiteConfig): Promise<JourneyContract[]> {
    const directory = path.resolve(this.repoRoot, siteConfig.contractDirectory);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));
    const contracts: JourneyContract[] = [];
    for (const file of files) {
      const parsed = YAML.parse(await readFile(path.join(directory, file), "utf8")) as { journeys?: RawJourney[] };
      const strict = ResearchContractsFileSchema.safeParse(parsed);
      if (strict.success) {
        contracts.push(...strict.data.journeys.map(normalizeResearchContract));
        continue;
      }
      for (const journey of parsed.journeys || []) {
        contracts.push(normalizeJourney(journey));
      }
    }
    return contracts;
  }

  async get(siteConfig: SiteConfig, journeyId: string): Promise<JourneyContract> {
    const contracts = await this.loadAll(siteConfig);
    const contract = contracts.find((item) => item.id === journeyId);
    if (!contract) throw new Error(`CONTRACT_NOT_FOUND: ${journeyId}`);
    return contract;
  }
}

function normalizeJourney(raw: RawJourney): JourneyContract {
  const timeoutMs = raw.timeoutMs || parseTimeout(raw.timeout) || 120000;
  return {
    id: raw.id,
    contractVersion: "legacy",
    replica: "unknown",
    instruction: raw.instruction,
    startingCheckpoint: raw.starting_checkpoint || raw.startingCheckpoint || "deterministic_seed",
    maximumSteps: raw.maximum_steps || raw.maximumSteps || 30,
    timeoutMs,
    timeoutSeconds: Math.ceil(timeoutMs / 1000),
    states: [],
    expectedTransitions: [],
    successPredicates: (raw.success_predicates || raw.successPredicates || []).map((description, index) => ({ id: `${raw.id}-legacy-success-${index + 1}`, description })),
    safetyInvariants: (raw.safety_invariants || raw.safetyInvariants || []).map((description, index) => ({ id: `${raw.id}-legacy-safety-${index + 1}`, description })),
    permittedSurfaces: ["frontend", "api", "research-verifier"],
    testAccountRef: inferAccount(raw.id),
    authoritativeVerifierEndpoint: `/api/research/verify/${raw.id}`,
    affectedDefects: raw.affected_defects || raw.affectedDefects || [],
    expectedCleanOutcome: { verifiedSuccess: true },
    expectedDefectOutcomes: [],
    raw: raw as unknown as Record<string, unknown>
  };
}

function normalizeResearchContract(raw: ResearchContract): JourneyContract {
  return {
    id: raw.journeyId,
    contractVersion: raw.contractVersion,
    replica: raw.replica,
    instruction: raw.instruction,
    startingCheckpoint: raw.startingCheckpoint,
    maximumSteps: raw.maximumSteps,
    timeoutMs: raw.timeoutSeconds * 1000,
    timeoutSeconds: raw.timeoutSeconds,
    states: raw.states,
    expectedTransitions: raw.expectedTransitions,
    successPredicates: raw.successPredicates,
    safetyInvariants: raw.safetyInvariants,
    permittedSurfaces: raw.permittedSurfaces,
    testAccountRef: raw.testAccountReference,
    authoritativeVerifierEndpoint: raw.authoritativeVerifierEndpoint,
    affectedDefects: raw.affectedDefectIds,
    expectedCleanOutcome: raw.expectedCleanOutcome,
    expectedDefectOutcomes: raw.expectedDefectOutcomes,
    raw: raw as unknown as Record<string, unknown>
  };
}

function parseTimeout(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (!value) return undefined;
  const match = value.match(/^(\d+)\s*s$/);
  if (match) return Number(match[1]) * 1000;
  return undefined;
}

function inferAccount(journeyId: string): string {
  if (journeyId === "SUPPORT-J2" || journeyId === "SUPPORT-J4") return "agent";
  return "user";
}
