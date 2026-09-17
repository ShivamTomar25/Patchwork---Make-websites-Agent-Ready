import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { replicaConfigs, type ReplicaKind } from "@patchwork/shared";
import { SiteRegistry } from "../sites/site-registry.js";
import { ResearchEndpointClient } from "../verifiers/research-client.js";
import { ResearchContractsFileSchema, type ResearchContract } from "../contracts/research-contract-schema.js";
import { applySyntheticCredentialDefaults } from "./local-fixtures.js";

type ValidationIssue = {
  level: "error" | "warning";
  journeyId?: string | undefined;
  message: string;
};

type ValidationResult = {
  ok: boolean;
  generatedAt: string;
  contractCount: number;
  issues: ValidationIssue[];
  verifierChecks: Array<{ journeyId: string; ok: boolean; endpoint: string; verifiedSuccess: boolean }>;
};

const replicaToSite: Record<string, ReplicaKind> = {
  "shop-twin": "shop",
  "saas-twin": "saas",
  "support-twin": "support"
};

const accountRoleByReference: Record<string, string> = {
  user: "default",
  admin: "admin",
  member: "member",
  agent: "agent"
};

export async function validateContracts(repoRoot: string, options: { liveVerifier?: boolean } = {}): Promise<ValidationResult> {
  applySyntheticCredentialDefaults();
  const registry = new SiteRegistry(repoRoot);
  const issues: ValidationIssue[] = [];
  const verifierChecks: ValidationResult["verifierChecks"] = [];
  const seen = new Set<string>();
  const contracts = await loadResearchContracts(repoRoot);

  for (const contract of contracts) {
    if (seen.has(contract.journeyId)) issues.push(error(contract.journeyId, `Duplicate journey id ${contract.journeyId}.`));
    seen.add(contract.journeyId);

    const siteKey = replicaToSite[contract.replica];
    if (!siteKey) {
      issues.push(error(contract.journeyId, `Unknown replica ${contract.replica}.`));
      continue;
    }
    const config = replicaConfigs[siteKey];
    const siteConfig = await registry.get(siteKey);
    const knownJourney = config.journeys.some((journey: { id: string }) => journey.id === contract.journeyId);
    if (!knownJourney) issues.push(error(contract.journeyId, "Journey id is not registered in shared replica config."));
    if (contract.authoritativeVerifierEndpoint !== siteConfig.verifierEndpointTemplate.replace("{journeyId}", contract.journeyId)) {
      issues.push(error(contract.journeyId, "Authoritative verifier endpoint does not match SiteRegistry."));
    }

    const stateIds = new Set(contract.states.map((state) => state.id));
    if (!stateIds.has(contract.startingCheckpoint)) issues.push(error(contract.journeyId, "Starting checkpoint is not declared as a state."));
    for (const transition of contract.expectedTransitions) {
      if (!stateIds.has(transition.from)) issues.push(error(contract.journeyId, `Transition ${transition.id} references unknown from-state ${transition.from}.`));
      if (!stateIds.has(transition.to)) issues.push(error(contract.journeyId, `Transition ${transition.id} references unknown to-state ${transition.to}.`));
    }

    for (const surface of contract.permittedSurfaces) {
      if (!["frontend", "api", "research-verifier"].includes(surface)) issues.push(error(contract.journeyId, `Unsupported surface ${surface}.`));
    }
    if (contract.maximumSteps < 1 || contract.maximumSteps > 100) issues.push(error(contract.journeyId, "Maximum steps is invalid."));
    if (contract.timeoutSeconds < 1 || contract.timeoutSeconds > 3600) issues.push(error(contract.journeyId, "Timeout is invalid."));
    if (contract.successPredicates.length === 0) issues.push(error(contract.journeyId, "Success predicates are empty."));
    if (contract.safetyInvariants.length === 0) issues.push(error(contract.journeyId, "Safety invariants are empty."));

    const knownDefects = new Set(config.defects.map((defect: { id: string }) => defect.id));
    for (const defectId of contract.affectedDefectIds) {
      if (!knownDefects.has(defectId)) issues.push(error(contract.journeyId, `Unknown defect id ${defectId}.`));
    }
    for (const outcome of contract.expectedDefectOutcomes) {
      if (!knownDefects.has(outcome.defectId)) issues.push(error(contract.journeyId, `Expected outcome references unknown defect id ${outcome.defectId}.`));
      const predicateIds = new Set([...contract.successPredicates, ...contract.safetyInvariants].map((predicate) => predicate.id));
      if (!predicateIds.has(outcome.firstFailedPredicateId)) {
        issues.push(error(contract.journeyId, `Expected defect outcome references unknown predicate ${outcome.firstFailedPredicateId}.`));
      }
    }

    if (!accountExists(config, contract.testAccountReference)) {
      issues.push(error(contract.journeyId, `Seeded account reference ${contract.testAccountReference} is not available for ${contract.replica}.`));
    }
    for (const state of contract.states) {
      if (state.route && !routeExists(config.routes, state.route)) {
        issues.push(error(contract.journeyId, `State route ${state.route} is not registered for ${contract.replica}.`));
      }
    }

    if (options.liveVerifier !== false) {
      try {
        const client = new ResearchEndpointClient(siteConfig);
        const verifier = await client.verify(contract.journeyId);
        verifierChecks.push({
          journeyId: contract.journeyId,
          ok: true,
          endpoint: contract.authoritativeVerifierEndpoint,
          verifiedSuccess: verifier.verifiedSuccess
        });
      } catch (err) {
        issues.push(error(contract.journeyId, `Verifier response failed schema or reachability check: ${err instanceof Error ? err.message : String(err)}`));
        verifierChecks.push({ journeyId: contract.journeyId, ok: false, endpoint: contract.authoritativeVerifierEndpoint, verifiedSuccess: false });
      }
    }
  }

  const result: ValidationResult = {
    ok: !issues.some((issue) => issue.level === "error"),
    generatedAt: new Date().toISOString(),
    contractCount: contracts.length,
    issues,
    verifierChecks
  };
  await writeValidationResults(repoRoot, result);
  return result;
}

export async function loadResearchContracts(repoRoot: string): Promise<ResearchContract[]> {
  const files = [
    "replicas/shop-twin/research/contracts/journeys.yaml",
    "replicas/saas-twin/research/contracts/journeys.yaml",
    "replicas/support-twin/research/contracts/journeys.yaml"
  ];
  const contracts: ResearchContract[] = [];
  for (const file of files) {
    const parsed = YAML.parse(await readFile(path.join(repoRoot, file), "utf8"));
    contracts.push(...ResearchContractsFileSchema.parse(parsed).journeys);
  }
  return contracts;
}

async function writeValidationResults(repoRoot: string, result: ValidationResult) {
  const resultsDir = path.join(repoRoot, "results");
  await mkdir(resultsDir, { recursive: true });
  await writeFile(path.join(resultsDir, "contracts-validation.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(resultsDir, "contracts-validation.md"), renderMarkdown(result));
}

function renderMarkdown(result: ValidationResult) {
  const lines = [
    "# PATCHWORK Contract Validation",
    "",
    `Generated: ${result.generatedAt}`,
    `Contracts: ${result.contractCount}`,
    `Status: ${result.ok ? "PASS" : "FAIL"}`,
    "",
    "## Issues",
    ""
  ];
  if (result.issues.length === 0) lines.push("No validation issues.");
  else for (const issue of result.issues) lines.push(`- ${issue.level.toUpperCase()} ${issue.journeyId || "global"}: ${issue.message}`);
  lines.push("", "## Verifier Checks", "");
  for (const check of result.verifierChecks) {
    lines.push(`- ${check.journeyId}: ${check.ok ? "schema-ok" : "failed"} (${check.endpoint})`);
  }
  return `${lines.join("\n")}\n`;
}

function error(journeyId: string | undefined, message: string): ValidationIssue {
  return { level: "error", journeyId, message };
}

function accountExists(config: (typeof replicaConfigs)[ReplicaKind], reference: string) {
  const expectedRole = accountRoleByReference[reference] || reference;
  if (expectedRole === "default") return config.accounts.some((account) => account.role === config.defaultRole);
  return config.accounts.some((account) => account.role === expectedRole);
}

function routeExists(routes: string[], actual: string) {
  return routes.some((route) => {
    const pattern = `^${route.replace(/:[^/]+/g, "__PARAM__").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/__PARAM__/g, "[^/]+")}$`;
    return new RegExp(pattern).test(actual);
  });
}
