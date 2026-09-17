import { z } from "zod";

export const SiteConfigSchema = z.object({
  name: z.string(),
  frontendUrl: z.string().url(),
  apiUrl: z.string().url(),
  openapiUrl: z.string().url(),
  healthEndpoint: z.string(),
  resetEndpoint: z.string(),
  stateEndpoint: z.string(),
  eventsEndpoint: z.string(),
  defectsEndpoint: z.string(),
  verifierEndpointTemplate: z.string(),
  contractDirectory: z.string(),
  allowedHosts: z.array(z.string()).min(1),
  credentials: z.record(z.string(), z.string())
});

export const SitesFileSchema = z.record(z.enum(["shop", "saas", "support"]), SiteConfigSchema);

const NavigateActionSchema = z.object({
  type: z.literal("navigate"),
  url: z.string()
});

const ClickByRoleActionSchema = z.object({
  type: z.literal("click_by_role"),
  role: z.string(),
  name: z.string()
});

const FillByLabelActionSchema = z.object({
  type: z.literal("fill_by_label"),
  label: z.string(),
  value: z.string()
});

const SelectOptionActionSchema = z.object({
  type: z.literal("select_option"),
  label: z.string(),
  value: z.string()
});

const CheckActionSchema = z.object({
  type: z.enum(["check", "uncheck"]),
  label: z.string().optional(),
  testId: z.string().optional()
});

const KeyActionSchema = z.object({
  type: z.literal("press_key"),
  key: z.string()
});

const ScrollActionSchema = z.object({
  type: z.literal("scroll"),
  deltaX: z.number().int().default(0),
  deltaY: z.number().int()
});

const WaitActionSchema = z.object({
  type: z.literal("wait"),
  ms: z.number().int().min(0).max(5000)
});

const GoBackActionSchema = z.object({
  type: z.literal("go_back")
});

const FinishActionSchema = z.object({
  type: z.literal("finish")
});

const AbortActionSchema = z.object({
  type: z.literal("abort"),
  code: z.string(),
  message: z.string()
});

const ClickXYActionSchema = z.object({
  type: z.literal("click_xy"),
  x: z.number().int().min(0),
  y: z.number().int().min(0)
});

const TypeTextActionSchema = z.object({
  type: z.literal("type_text"),
  text: z.string()
});

const ToolCallActionSchema = z.object({
  type: z.literal("call_tool"),
  operationId: z.string(),
  path: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  pathParams: z.record(z.string(), z.string()).default({}),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.unknown().optional()
});

const InspectToolsActionSchema = z.object({
  type: z.literal("inspect_available_tools")
});

export const AgentActionSchema = z.discriminatedUnion("type", [
  NavigateActionSchema,
  ClickByRoleActionSchema,
  FillByLabelActionSchema,
  SelectOptionActionSchema,
  CheckActionSchema,
  KeyActionSchema,
  ScrollActionSchema,
  WaitActionSchema,
  GoBackActionSchema,
  FinishActionSchema,
  AbortActionSchema,
  ClickXYActionSchema,
  TypeTextActionSchema,
  ToolCallActionSchema,
  InspectToolsActionSchema
]);

export const AgentDecisionSchema = z.object({
  action: AgentActionSchema,
  reason: z.string().min(1).max(300),
  usage: z
    .object({
      inputTokens: z.number().int().min(0).default(0),
      outputTokens: z.number().int().min(0).default(0)
    })
    .default({ inputTokens: 0, outputTokens: 0 })
});

export const AgentObservationSchema = z.object({
  agentId: z.string(),
  type: z.enum(["scripted", "accessibility", "screenshot", "tool"]),
  site: z.enum(["shop", "saas", "support"]),
  journeyId: z.string(),
  instruction: z.string(),
  url: z.string(),
  title: z.string().optional(),
  summary: z.string(),
  accessibilitySnapshot: z.string().optional(),
  visibleErrors: z.array(z.string()).default([]),
  screenshotPath: z.string().optional(),
  screenshotHash: z.string().optional(),
  viewport: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
  availableTools: z.array(z.string()).default([]),
  recentHistory: z.array(z.string()).default([]),
  remainingSteps: z.number().int().min(0),
  remainingMs: z.number().int().min(0)
});

export const ActionResultSchema = z.object({
  ok: z.boolean(),
  actionType: z.string(),
  url: z.string().optional(),
  status: z.number().int().optional(),
  message: z.string(),
  data: z.unknown().optional(),
  latencyMs: z.number().int().min(0).default(0)
});

export const VerificationResultSchema = z.object({
  journeyId: z.string(),
  verifiedSuccess: z.boolean(),
  violations: z.array(z.string()),
  predicates: z.array(
    z.object({
      name: z.string(),
      expected: z.string(),
      actual: z.string(),
      passed: z.boolean()
    })
  ),
  authoritativeState: z.record(z.string(), z.unknown()),
  defectConfiguration: z.record(z.string(), z.unknown()),
  evaluatedAt: z.string()
});

export const JourneyRunInputSchema = z.object({
  site: z.enum(["shop", "saas", "support"]),
  journeyId: z.string(),
  agentId: z.string(),
  mode: z.enum(["mock", "live"]).default("mock"),
  seed: z.number().int().default(1),
  maxSteps: z.number().int().min(1).max(100).default(30),
  timeoutMs: z.number().int().min(1000).default(120000),
  tokenBudget: z.number().int().min(1).default(20000),
  authorizeResearchTools: z.boolean().default(false),
  defectConfiguration: z.record(z.string(), z.boolean()).default({})
});

export const JourneyRunResultSchema = z.object({
  runId: z.string(),
  site: z.enum(["shop", "saas", "support"]),
  journeyId: z.string(),
  agentId: z.string(),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  seed: z.number().int(),
  startedAt: z.string(),
  endedAt: z.string(),
  terminationReason: z.string(),
  verifiedSuccess: z.boolean(),
  violations: z.array(z.string()),
  steps: z.number().int(),
  latencyMs: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  resultPath: z.string().optional()
});

export const FinalStudyManifestSchema = z.object({
  mode: z.enum(["pilot", "final"]),
  agents: z.object({
    accessibilityA: z.object({ provider: z.string(), model: z.string() }),
    accessibilityB: z.object({ provider: z.string(), model: z.string() })
  })
});
