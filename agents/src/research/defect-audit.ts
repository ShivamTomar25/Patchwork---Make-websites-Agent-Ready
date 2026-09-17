import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { ExperimentRunner, type AgentId } from "../runner/experiment-runner.js";
import type { SiteKey } from "../core/types.js";
import { redactSecrets } from "../core/utils.js";
import { SiteRegistry } from "../sites/site-registry.js";
import { ResearchEndpointClient } from "../verifiers/research-client.js";
import { applySyntheticCredentialDefaults } from "./local-fixtures.js";
import { loadPilotManifest, type PilotJourney } from "./pilot-manifest.js";

type MatrixEntry = {
  replica: SiteKey;
  journeyId: string;
  defectId: string;
  defectFamily: string;
  activationMechanism: string;
  affectedRouteApiComponent: string;
  expectedFirstFailedPredicate: string;
  expectedAuthoritativeState: string;
  expectedViolationType: string;
  expectedAgentVisibleSymptom: string;
  verifierEndpoint: string;
  cleanExpectedOutcome: string;
  defectExpectedOutcome: string;
  recoveryExpectedOutcome: string;
};

type AuditRow = {
  replica: SiteKey;
  journeyId: string;
  defectId: string;
  cleanPassed: boolean;
  defectDetected: boolean;
  recoveryPassed: boolean;
  activationAudited: boolean;
  firstFailedPredicate: string;
  evidenceFile: string;
};

export async function runDefectAudit(repoRoot: string) {
  applySyntheticCredentialDefaults();
  const manifest = await loadPilotManifest(repoRoot, "experiments/configs/pilot-study-v2.yaml");
  const matrix = await loadMatrix(repoRoot);
  const matrixByJourney = new Map(matrix.map((entry) => [entry.journeyId, entry]));
  const resultDirectory = path.join(repoRoot, "experiments/results/defect-audit");
  const evidenceDirectory = path.join(resultDirectory, "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  const registry = new SiteRegistry(repoRoot);
  const runner = new ExperimentRunner(repoRoot);
  const rows: AuditRow[] = [];

  for (const site of Object.keys(manifest.replicas) as SiteKey[]) {
    const replica = manifest.replicas[site];
    for (const journey of replica.journeys) {
      const entry = matrixByJourney.get(journey.id);
      if (!entry) throw new Error(`DEFECT_MATRIX_ENTRY_MISSING: ${journey.id}`);
      if (entry.defectId !== journey.deterministicDefectId) {
        throw new Error(`DEFECT_MATRIX_MISMATCH: ${journey.id} matrix=${entry.defectId} manifest=${journey.deterministicDefectId}`);
      }
      const siteConfig = await registry.get(site);
      const client = new ResearchEndpointClient(siteConfig);
      const cleanResult = await runJourney(runner, site, journey, "scripted", {});
      const cleanVerification = await client.verify(journey.id);
      const defectConfiguration = { [journey.deterministicDefectId]: true };
      const defectResult = await runJourney(runner, site, journey, journey.defectAgent as AgentId, defectConfiguration);
      const defectVerification = await client.verify(journey.id);
      const defectsAfterRun = await client.defects();
      const eventsAfterRun = await client.request(siteConfig.eventsEndpoint);
      const resetAfterDefect = await client.reset({});
      const recoveryResult = await runJourney(runner, site, journey, "scripted", {});
      const recoveryVerification = await client.verify(journey.id);
      const finalReset = await client.reset({});
      const firstFailedPredicate = defectVerification.predicates.find((predicate) => !predicate.passed)?.name || "";
      const evidenceFile = `${site}-${journey.id}-${journey.deterministicDefectId}.json`;
      const activationAudited = JSON.stringify(eventsAfterRun).includes("research.defects.update") &&
        JSON.stringify(eventsAfterRun).includes(journey.deterministicDefectId) &&
        JSON.stringify(defectsAfterRun).includes(`"id":"${journey.deterministicDefectId}"`) &&
        JSON.stringify(defectsAfterRun).includes("\"enabled\":true");
      const cleanPassed = cleanVerification.verifiedSuccess && cleanResult.verifiedSuccess;
      const defectDetected = !defectVerification.verifiedSuccess && firstFailedPredicate === entry.expectedFirstFailedPredicate;
      const recoveryPassed = recoveryVerification.verifiedSuccess && recoveryResult.verifiedSuccess;
      const row: AuditRow = {
        replica: site,
        journeyId: journey.id,
        defectId: journey.deterministicDefectId,
        cleanPassed,
        defectDetected,
        recoveryPassed,
        activationAudited,
        firstFailedPredicate,
        evidenceFile
      };
      rows.push(row);
      await writeFile(
        path.join(evidenceDirectory, evidenceFile),
        `${JSON.stringify(redactSecrets({
          matrix: entry,
          cleanResult,
          cleanVerification,
          defectResult,
          defectVerification,
          defectsAfterRun,
          activationAudited,
          resetAfterDefect,
          recoveryResult,
          recoveryVerification,
          finalReset
        }), null, 2)}\n`
      );
    }
  }

  await writeFile(path.join(resultDirectory, "defect-matrix.csv"), matrixCsv(matrix));
  await writeFile(path.join(resultDirectory, "defect-audit.json"), `${JSON.stringify(redactSecrets({ rows }), null, 2)}\n`);
  await writeFile(path.join(resultDirectory, "defect-audit.md"), renderAudit(rows));

  const cleanCount = rows.filter((row) => row.cleanPassed).length;
  const defectCount = rows.filter((row) => row.defectDetected && row.activationAudited).length;
  const recoveryCount = rows.filter((row) => row.recoveryPassed).length;
  if (cleanCount !== 11 || defectCount !== 11 || recoveryCount !== 11) {
    throw new Error(`DEFECT_AUDIT_FAILED: clean=${cleanCount}/11 defect=${defectCount}/11 recovery=${recoveryCount}/11`);
  }
  return { ok: true, cleanCount, defectCount, recoveryCount, rows, resultDirectory: "experiments/results/defect-audit" };
}

async function runJourney(
  runner: ExperimentRunner,
  site: SiteKey,
  journey: PilotJourney,
  agentId: AgentId,
  defectConfiguration: Record<string, boolean>
) {
  return runner.run({
    site,
    journeyId: journey.id,
    agentId,
    mode: "mock",
    seed: 1,
    maxSteps: journey.maximumSteps,
    timeoutMs: journey.timeoutSeconds * 1000,
    tokenBudget: 20000,
    authorizeResearchTools: false,
    defectConfiguration
  });
}

async function loadMatrix(repoRoot: string): Promise<MatrixEntry[]> {
  const content = await readFile(path.join(repoRoot, "experiments/configs/defect-verifier-matrix.yaml"), "utf8");
  const parsed = YAML.parse(content);
  return parsed.entries as MatrixEntry[];
}

function matrixCsv(entries: MatrixEntry[]) {
  return csv(
    [
      "replica",
      "journey_id",
      "defect_id",
      "defect_family",
      "activation_mechanism",
      "affected_route_api_component",
      "expected_first_failed_predicate",
      "expected_authoritative_state",
      "expected_violation_type",
      "expected_agent_visible_symptom",
      "verifier_endpoint",
      "clean_expected_outcome",
      "defect_expected_outcome",
      "recovery_expected_outcome"
    ],
    entries.map((entry) => [
      entry.replica,
      entry.journeyId,
      entry.defectId,
      entry.defectFamily,
      entry.activationMechanism,
      entry.affectedRouteApiComponent,
      entry.expectedFirstFailedPredicate,
      entry.expectedAuthoritativeState,
      entry.expectedViolationType,
      entry.expectedAgentVisibleSymptom,
      entry.verifierEndpoint,
      entry.cleanExpectedOutcome,
      entry.defectExpectedOutcome,
      entry.recoveryExpectedOutcome
    ])
  );
}

function renderAudit(rows: AuditRow[]) {
  return [
    "# PATCHWORK Defect Audit",
    "",
    `Clean baseline: ${rows.filter((row) => row.cleanPassed).length}/11`,
    `Defect detection: ${rows.filter((row) => row.defectDetected && row.activationAudited).length}/11`,
    `Recovery: ${rows.filter((row) => row.recoveryPassed).length}/11`,
    "",
    "| Journey | Defect | Clean | Defect | Recovery | First failed predicate |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) =>
      `| ${row.replica}/${row.journeyId} | ${row.defectId} | ${yes(row.cleanPassed)} | ${yes(row.defectDetected && row.activationAudited)} | ${yes(row.recoveryPassed)} | ${row.firstFailedPredicate || "none"} |`
    ),
    ""
  ].join("\n");
}

function yes(value: boolean) {
  return value ? "pass" : "fail";
}

function csv(header: string[], rows: unknown[][]) {
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n";
}

function cell(value: unknown) {
  const text = String(value ?? "");
  return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
