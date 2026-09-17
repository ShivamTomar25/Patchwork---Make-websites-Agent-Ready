import type { BrowserContext, Page } from "playwright";
import type { z } from "zod";
import type {
  ActionResultSchema,
  AgentDecisionSchema,
  AgentObservationSchema,
  JourneyRunInputSchema,
  JourneyRunResultSchema,
  SiteConfigSchema
} from "./schemas.js";

export type SiteKey = "shop" | "saas" | "support";
export type AgentType = "scripted" | "accessibility" | "screenshot" | "tool";
export type TerminationReason =
  | "verified_success"
  | "safety_violation"
  | "model_abort"
  | "repeated_loop"
  | "max_steps"
  | "timeout"
  | "model_token_budget"
  | "invalid_action_threshold"
  | "verifier_failure"
  | "agent_finish"
  | "agent_abort";

export type SiteConfig = z.infer<typeof SiteConfigSchema>;
export type AgentObservation = z.infer<typeof AgentObservationSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export type JourneyRunInput = z.infer<typeof JourneyRunInputSchema>;
export type JourneyRunResult = z.infer<typeof JourneyRunResultSchema>;

export type JourneyContract = {
  id: string;
  contractVersion: string;
  replica: string;
  instruction: string;
  startingCheckpoint: string;
  maximumSteps: number;
  timeoutMs: number;
  timeoutSeconds: number;
  states: Array<{ id: string; description: string; route?: string | undefined }>;
  expectedTransitions: Array<{ id: string; from: string; to: string; action: string }>;
  successPredicates: Array<Record<string, unknown>>;
  safetyInvariants: Array<Record<string, unknown>>;
  permittedSurfaces: string[];
  testAccountRef: string;
  authoritativeVerifierEndpoint: string;
  affectedDefects: string[];
  expectedCleanOutcome: Record<string, unknown>;
  expectedDefectOutcomes: Array<Record<string, unknown>>;
  raw: Record<string, unknown>;
};

export type AgentContext = {
  repoRoot: string;
  site: SiteKey;
  siteConfig: SiteConfig;
  contract: JourneyContract;
  seed: number;
  mode: "mock" | "live";
  runId: string;
  browserContext?: BrowserContext;
  page?: Page;
};

export interface ResearchAgent {
  id: string;
  type: AgentType;
  initialize(context: AgentContext): Promise<void>;
  observe(): Promise<AgentObservation>;
  decide(observation: AgentObservation): Promise<AgentDecision>;
  execute(decision: AgentDecision): Promise<ActionResult>;
  runJourney(input: JourneyRunInput): Promise<JourneyRunResult>;
  close(): Promise<void>;
}

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type ModelResponse = {
  text: string;
  provider: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs: number;
};

export type ModelRequest = {
  messages: ModelMessage[];
  schemaName: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
};

export interface ModelProvider {
  id: string;
  model: string;
  promptVersion: string;
  completeJson(request: ModelRequest): Promise<ModelResponse>;
}

export type RunStepRecord = {
  stepId: string;
  runId: string;
  sequenceNumber: number;
  url: string;
  observationHash: string;
  observationSummary: string;
  actionType: string;
  actionPayloadRedacted: Record<string, unknown>;
  decisionReason: string;
  actionResult: Record<string, unknown>;
  verifierState?: Record<string, unknown>;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

export type ArtifactRecord = {
  artifactId: string;
  runId: string;
  stepId?: string;
  type: "screenshot" | "accessibility_snapshot" | "tool_trace" | "validation_error" | "evidence_bundle";
  localPath: string;
  sha256: string;
  metadata: Record<string, unknown>;
};
