import { z } from "zod";

export const NodeTypeSchema = z.enum([
  "PAGE",
  "CONTROL",
  "FORM_FIELD",
  "FRONTEND_STATE",
  "API_OPERATION",
  "DATABASE_STATE",
  "AUTH_SCOPE",
  "CONFIRMATION",
  "VERIFIER_PREDICATE",
  "SIDE_EFFECT",
  "ERROR_CONTRACT"
]);

export const EdgeTypeSchema = z.enum([
  "NAVIGATES_TO",
  "INVOKES",
  "READS",
  "WRITES",
  "REQUIRES",
  "AUTHORIZES",
  "PRECEDES",
  "VERIFIES",
  "CONTRADICTS",
  "DEPENDS_ON",
  "ROLLS_BACK"
]);

export const PatchOperatorSchema = z.enum([
  "SEMANTIC_RELABEL",
  "SESSION_RESTORE",
  "IDEMPOTENCY_INSERT",
  "SCHEMA_CORRECT",
  "TYPED_RECOVERY",
  "AUTH_SCOPE_NARROW",
  "CONFIRMATION_INSERT",
  "UNTRUSTED_CONTENT_ISOLATE",
  "OUTPUT_SANITIZE"
]);

export const FailureCategorySchema = z.enum([
  "agent_execution_failure",
  "interface_failure",
  "api_schema_failure",
  "authorization_failure",
  "safety_violation",
  "verifier_infrastructure_failure"
]);

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: NodeTypeSchema,
  label: z.string().min(1),
  replica: z.string().min(1),
  journeyId: z.string().optional(),
  defectId: z.string().optional(),
  route: z.string().optional(),
  source: z.string().optional(),
  temporalIndex: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  type: EdgeTypeSchema,
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
  replica: z.string().min(1),
  journeyId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const AffordanceGraphSchema = z.object({
  graphId: z.string().min(1),
  replica: z.string().min(1),
  contractVersion: z.string().min(1),
  generatedAt: z.string().datetime(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema)
});

export const LocalizationResultSchema = z.object({
  journeyId: z.string().min(1),
  runId: z.string().min(1),
  replica: z.string().min(1),
  seed: z.number().int().min(1),
  defectId: z.string().min(1),
  firstViolatedPredicate: z.string().min(1),
  lastVerifiedCheckpoint: z.string().min(1),
  failureCategory: FailureCategorySchema,
  evidenceEventIds: z.array(z.string()),
  confidence: z.number().min(0).max(1)
});

export const FailureConeSchema = z.object({
  journeyId: z.string().min(1),
  runId: z.string().min(1),
  replica: z.string().min(1),
  defectId: z.string().min(1),
  firstViolatedPredicate: z.string().min(1),
  backwardNodes: z.array(z.string()),
  forwardNodes: z.array(z.string()),
  candidateRepairTargets: z.array(z.string()),
  fullGraphNodeCount: z.number().int().min(0),
  coneNodeCount: z.number().int().min(0),
  rootCauseNodeId: z.string().min(1),
  exactRootCause: z.boolean(),
  top3RootCause: z.boolean(),
  rootCauseContained: z.boolean(),
  conePercent: z.number().min(0).max(100)
});

export const TypedPatchSchema = z.object({
  patchId: z.string().min(1),
  replica: z.string().min(1),
  journeyIds: z.array(z.string().min(1)).min(1),
  targetNodeId: z.string().min(1),
  operator: PatchOperatorSchema,
  preconditions: z.array(z.string()).min(1),
  postconditions: z.array(z.string()).min(1),
  preservedInvariants: z.array(z.string()),
  dependencies: z.array(z.string()),
  conflicts: z.array(z.string()),
  sourceFiles: z.array(z.string().min(1)).min(1),
  sourceDiff: z.string().min(1),
  rollbackDiff: z.string().min(1),
  estimatedEngineeringMinutes: z.number().int().min(0),
  generatedBy: z.enum(["template", "llm"]),
  templateVersion: z.string().min(1)
});

export const PatchValidationSchema = z.object({
  patchId: z.string().min(1),
  replica: z.string().min(1),
  journeyId: z.string().min(1),
  schemaValidation: z.enum(["pass", "fail"]),
  diffParse: z.enum(["pass", "fail"]),
  pathSafety: z.enum(["pass", "fail"]),
  astStaticAnalysis: z.enum(["pass", "fail"]),
  dependencyConflict: z.enum(["pass", "fail"]),
  typeCheck: z.enum(["pass", "fail", "not_run"]),
  unitTests: z.enum(["pass", "fail", "not_run"]),
  propertyTests: z.enum(["pass", "fail", "not_run"]),
  contractTests: z.enum(["pass", "fail", "not_run"]),
  sandboxBuild: z.enum(["pass", "fail", "not_run"]),
  sandboxIntegrationTests: z.enum(["pass", "fail", "not_run"]),
  invariantVerification: z.enum(["pass", "fail", "not_run"]),
  rollbackTest: z.enum(["pass", "fail", "not_run"]),
  accepted: z.boolean(),
  reason: z.string()
});

export const PairedReplayRecordSchema = z.object({
  journeyId: z.string().min(1),
  replica: z.string().min(1),
  seed: z.number().int().min(1),
  defectId: z.string().min(1),
  patchId: z.string().min(1),
  executionOrder: z.array(z.enum(["baseline", "patched"])).length(2),
  baselineRunId: z.string().min(1),
  baselineVerifiedSuccess: z.boolean(),
  baselineViolations: z.array(z.string()),
  patchedExecuted: z.boolean(),
  patchedRunId: z.string().optional(),
  patchedVerifiedSuccess: z.boolean().optional(),
  patchedViolations: z.array(z.string()).optional(),
  compliantSuccessDifference: z.number().optional(),
  violationDifference: z.number().optional(),
  latencyDifferenceMs: z.number().optional(),
  stepDifference: z.number().optional(),
  tokenDifference: z.number().optional(),
  unresolvedReason: z.string().optional()
});

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type EdgeType = z.infer<typeof EdgeTypeSchema>;
export type PatchOperator = z.infer<typeof PatchOperatorSchema>;
export type FailureCategory = z.infer<typeof FailureCategorySchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type AffordanceGraph = z.infer<typeof AffordanceGraphSchema>;
export type LocalizationResult = z.infer<typeof LocalizationResultSchema>;
export type FailureCone = z.infer<typeof FailureConeSchema>;
export type TypedPatch = z.infer<typeof TypedPatchSchema>;
export type PatchValidation = z.infer<typeof PatchValidationSchema>;
export type PairedReplayRecord = z.infer<typeof PairedReplayRecordSchema>;
