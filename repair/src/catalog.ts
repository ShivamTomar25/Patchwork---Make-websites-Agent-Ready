import type { FailureCategory, NodeType, PatchOperator } from "./schemas.js";
import type { MatrixEntry } from "./io.js";

export type RepairTemplate = {
  operator: PatchOperator;
  targetNodeType: NodeType;
  failureCategory: FailureCategory;
  templateVersion: string;
  estimatedEngineeringMinutes: number;
  preconditions: string[];
  postconditions: string[];
  preservedInvariants: string[];
  dependencies: string[];
  conflicts: string[];
};

export const operatorTemplates: Record<PatchOperator, RepairTemplate> = {
  SEMANTIC_RELABEL: {
    operator: "SEMANTIC_RELABEL",
    targetNodeType: "CONTROL",
    failureCategory: "interface_failure",
    templateVersion: "semantic-relabel-v1",
    estimatedEngineeringMinutes: 20,
    preconditions: ["control is present but inaccessible or ambiguous"],
    postconditions: ["control has a stable accessible name and test id"],
    preservedInvariants: ["no data mutation semantics change"],
    dependencies: [],
    conflicts: []
  },
  SESSION_RESTORE: {
    operator: "SESSION_RESTORE",
    targetNodeType: "ERROR_CONTRACT",
    failureCategory: "interface_failure",
    templateVersion: "session-restore-v1",
    estimatedEngineeringMinutes: 35,
    preconditions: ["authenticated user exists before transition", "session loss is verifier observable"],
    postconditions: ["session is preserved or restored before protected mutation"],
    preservedInvariants: ["auth cookie remains httpOnly", "expired sessions remain rejected"],
    dependencies: ["AUTH_SCOPE"],
    conflicts: ["AUTH_SCOPE_NARROW"]
  },
  IDEMPOTENCY_INSERT: {
    operator: "IDEMPOTENCY_INSERT",
    targetNodeType: "SIDE_EFFECT",
    failureCategory: "safety_violation",
    templateVersion: "idempotency-insert-v1",
    estimatedEngineeringMinutes: 45,
    preconditions: ["mutation has deterministic idempotency key", "side effect is not externally real"],
    postconditions: ["reused idempotency key returns the first stored response"],
    preservedInvariants: ["at most one payment/refund/subscription/ticket side effect"],
    dependencies: ["DATABASE_STATE"],
    conflicts: []
  },
  SCHEMA_CORRECT: {
    operator: "SCHEMA_CORRECT",
    targetNodeType: "ERROR_CONTRACT",
    failureCategory: "api_schema_failure",
    templateVersion: "schema-correct-v1",
    estimatedEngineeringMinutes: 25,
    preconditions: ["API response shape differs from verifier contract"],
    postconditions: ["response exposes the contract field name"],
    preservedInvariants: ["secret values remain masked"],
    dependencies: ["API_OPERATION"],
    conflicts: ["OUTPUT_SANITIZE"]
  },
  TYPED_RECOVERY: {
    operator: "TYPED_RECOVERY",
    targetNodeType: "ERROR_CONTRACT",
    failureCategory: "api_schema_failure",
    templateVersion: "typed-recovery-v1",
    estimatedEngineeringMinutes: 30,
    preconditions: ["failure path returns untyped response"],
    postconditions: ["failure path returns stable code and retryability"],
    preservedInvariants: ["failed side effect is not persisted"],
    dependencies: ["ERROR_CONTRACT"],
    conflicts: []
  },
  AUTH_SCOPE_NARROW: {
    operator: "AUTH_SCOPE_NARROW",
    targetNodeType: "AUTH_SCOPE",
    failureCategory: "authorization_failure",
    templateVersion: "auth-scope-narrow-v1",
    estimatedEngineeringMinutes: 40,
    preconditions: ["resource ownership or role can be computed locally"],
    postconditions: ["cross-account access returns forbidden"],
    preservedInvariants: ["admin/staff paths remain allowed when explicitly permitted"],
    dependencies: ["AUTH_SCOPE", "DATABASE_STATE"],
    conflicts: []
  },
  CONFIRMATION_INSERT: {
    operator: "CONFIRMATION_INSERT",
    targetNodeType: "CONFIRMATION",
    failureCategory: "safety_violation",
    templateVersion: "confirmation-insert-v1",
    estimatedEngineeringMinutes: 25,
    preconditions: ["mutation changes billing/escalation/destructive state"],
    postconditions: ["unconfirmed mutation is rejected"],
    preservedInvariants: ["confirmed mutation still succeeds"],
    dependencies: ["FORM_FIELD", "API_OPERATION"],
    conflicts: []
  },
  UNTRUSTED_CONTENT_ISOLATE: {
    operator: "UNTRUSTED_CONTENT_ISOLATE",
    targetNodeType: "SIDE_EFFECT",
    failureCategory: "safety_violation",
    templateVersion: "untrusted-content-isolate-v1",
    estimatedEngineeringMinutes: 30,
    preconditions: ["user-provided text is displayed in a workflow surface"],
    postconditions: ["user-provided text is explicitly marked untrusted"],
    preservedInvariants: ["ticket content remains visible to authorized users"],
    dependencies: ["FRONTEND_STATE"],
    conflicts: []
  },
  OUTPUT_SANITIZE: {
    operator: "OUTPUT_SANITIZE",
    targetNodeType: "SIDE_EFFECT",
    failureCategory: "safety_violation",
    templateVersion: "output-sanitize-v1",
    estimatedEngineeringMinutes: 25,
    preconditions: ["response includes sensitive or unsafe output"],
    postconditions: ["response omits sensitive fields and normalizes unsafe text"],
    preservedInvariants: ["non-secret identifiers remain available"],
    dependencies: ["API_OPERATION"],
    conflicts: []
  }
};

const selectedDefectOperators: Record<string, PatchOperator> = {
  "SHOP-SESSION-001": "SESSION_RESTORE",
  "SHOP-AUTH-001": "AUTH_SCOPE_NARROW",
  "SHOP-IDEMP-001": "IDEMPOTENCY_INSERT",
  "SAAS-SESSION-001": "SESSION_RESTORE",
  "SAAS-RECOVERY-001": "TYPED_RECOVERY",
  "SAAS-CONFIRM-001": "CONFIRMATION_INSERT",
  "SAAS-SCHEMA-001": "SCHEMA_CORRECT",
  "SUPPORT-SESSION-001": "SESSION_RESTORE",
  "SUPPORT-AUTH-001": "AUTH_SCOPE_NARROW",
  "SUPPORT-CONFIRM-001": "CONFIRMATION_INSERT",
  "SUPPORT-INJECTION-001": "UNTRUSTED_CONTENT_ISOLATE"
};

export function templateForDefect(defectId: string): RepairTemplate {
  const operator = selectedDefectOperators[defectId] || "OUTPUT_SANITIZE";
  return operatorTemplates[operator];
}

export function rootCauseNodeId(entry: Pick<MatrixEntry, "replica" | "defectId">) {
  return `${entry.replica}:root-cause:${entry.defectId}`;
}

export function verifierPredicateNodeId(replica: string, journeyId: string, predicate: string) {
  return `${replica}:verifier:${journeyId}:${predicate.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function apiOperationNodeId(entry: Pick<MatrixEntry, "replica" | "journeyId">) {
  return `${entry.replica}:api:${entry.journeyId}`;
}

export function replicaDirectory(replica: string) {
  return `replicas/${replica}-twin`;
}

export function patchSourceFile(replica: string, defectId: string) {
  return `${replicaDirectory(replica)}/api/src/repair/${defectId}.ts`;
}
