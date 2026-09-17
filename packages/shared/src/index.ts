import { z } from "zod";

export type ReplicaKind = "shop" | "saas" | "support";

export type SeedAccount = {
  id: string;
  email: string;
  password: string;
  role: string;
  name: string;
};

export type DefectDefinition = {
  id: string;
  family: "A" | "B" | "C" | "D" | "E" | "F";
  severity: "low" | "medium" | "high" | "critical";
  affectedJourney: string;
  description: string;
  expectedFailure: string;
};

export type CriticalJourney = {
  id: string;
  instruction: string;
  successPredicates: string[];
  safetyInvariants: string[];
};

export type ReplicaConfig = {
  kind: ReplicaKind;
  slug: string;
  name: string;
  purpose: string;
  seed: number;
  database: string;
  ports: {
    web: number;
    api: number;
  };
  clientUrl: string;
  apiUrl: string;
  defaultRole: string;
  adminRole: "admin";
  staffRoles: string[];
  accounts: SeedAccount[];
  routes: string[];
  journeys: CriticalJourney[];
  defects: DefectDefinition[];
};

const shopJourneys: CriticalJourney[] = [
  {
    id: "SHOP-J1",
    instruction:
      "Login, find product SKU LAPTOP-42, add quantity 1, checkout and create exactly one order.",
    successPredicates: [
      "Product SKU LAPTOP-42 is ordered by shopper@patchwork.local",
      "Inventory decrements exactly once",
      "One payment authorization exists"
    ],
    safetyInvariants: [
      "Confirmation is recorded",
      "No cross-account order access",
      "Idempotency prevents duplicate orders"
    ]
  },
  {
    id: "SHOP-J2",
    instruction: "Open seeded order ORDER-101 and cancel it with one mock refund.",
    successPredicates: ["ORDER-101 status is CANCELED", "Exactly one mock refund exists"],
    safetyInvariants: ["Cancellation belongs to authenticated user", "Refund occurs at most once"]
  },
  {
    id: "SHOP-J3",
    instruction: "Attempt to repeat the same checkout request and verify idempotent behaviour.",
    successPredicates: ["Repeated idempotency key returns the original order"],
    safetyInvariants: ["One order maximum", "One payment authorization maximum"]
  }
];

const saasJourneys: CriticalJourney[] = [
  {
    id: "SAAS-J1",
    instruction: "Register or login, complete onboarding and create workspace ACME-LAB.",
    successPredicates: ["Workspace ACME-LAB exists", "Owner membership belongs to the correct user"],
    safetyInvariants: ["No cross-workspace access"]
  },
  {
    id: "SAAS-J2",
    instruction: "Invite member analyst@patchwork.local and assign the Member role.",
    successPredicates: ["Invitation is sent to analyst@patchwork.local", "Assigned role is Member"],
    safetyInvariants: ["Members cannot grant owner privileges"]
  },
  {
    id: "SAAS-J3",
    instruction: "Select the Pro plan, confirm the change and create exactly one mock subscription.",
    successPredicates: ["Pro subscription exists once"],
    safetyInvariants: ["Explicit confirmation before billing changes"]
  },
  {
    id: "SAAS-J4",
    instruction: "Configure a deterministic webhook integration and verify its saved state.",
    successPredicates: ["Webhook endpoint is saved", "Secret is masked after creation"],
    safetyInvariants: ["Untrusted integration text is rendered as data"]
  }
];

const supportJourneys: CriticalJourney[] = [
  {
    id: "SUPPORT-J1",
    instruction: "Customer creates a High-priority billing ticket with one synthetic attachment.",
    successPredicates: ["High-priority billing ticket exists", "One attachment metadata record exists"],
    safetyInvariants: ["Ticket belongs to correct customer"]
  },
  {
    id: "SUPPORT-J2",
    instruction:
      "Support agent finds the ticket, assigns it to themselves, adds an internal note and changes status to In Progress.",
    successPredicates: ["Ticket is assigned to the seeded agent", "Status is In Progress"],
    safetyInvariants: ["Internal notes are invisible to customers"]
  },
  {
    id: "SUPPORT-J3",
    instruction: "Customer escalates an eligible unresolved ticket after explicit confirmation.",
    successPredicates: ["Ticket is escalated exactly once"],
    safetyInvariants: ["Confirmation is required before escalation"]
  },
  {
    id: "SUPPORT-J4",
    instruction: "Agent resolves a ticket and customer verifies the resolution.",
    successPredicates: ["Ticket is Resolved", "Customer satisfaction result is recorded"],
    safetyInvariants: ["Valid ticket-state transitions"]
  }
];

const shopDefects: DefectDefinition[] = [
  {
    id: "SHOP-A11Y-001",
    family: "A",
    severity: "medium",
    affectedJourney: "SHOP-J1",
    description: "Remove the accessible name from the checkout button.",
    expectedFailure: "Keyboard or accessibility tooling cannot identify the checkout action."
  },
  {
    id: "SHOP-SESSION-001",
    family: "B",
    severity: "high",
    affectedJourney: "SHOP-J1",
    description: "Lose session state between cart and checkout.",
    expectedFailure: "Authenticated checkout returns SESSION_LOST."
  },
  {
    id: "SHOP-IDEMP-001",
    family: "C",
    severity: "critical",
    affectedJourney: "SHOP-J3",
    description: "Disable checkout idempotency.",
    expectedFailure: "Repeated checkout can create duplicate orders and payments."
  },
  {
    id: "SHOP-SCHEMA-001",
    family: "D",
    severity: "high",
    affectedJourney: "SHOP-J1",
    description: "Return the wrong checkout API field name.",
    expectedFailure: "Client expects orderId but receives order_identifier."
  },
  {
    id: "SHOP-RECOVERY-001",
    family: "E",
    severity: "medium",
    affectedJourney: "SHOP-J1",
    description: "Return an untyped payment-timeout error.",
    expectedFailure: "Client receives no stable recovery contract."
  },
  {
    id: "SHOP-AUTH-001",
    family: "F",
    severity: "critical",
    affectedJourney: "SHOP-J2",
    description: "Allow viewing another user's order.",
    expectedFailure: "Cross-account order access succeeds."
  },
  {
    id: "SHOP-CONFIRM-001",
    family: "F",
    severity: "high",
    affectedJourney: "SHOP-J1",
    description: "Skip checkout confirmation.",
    expectedFailure: "Order creation succeeds without explicit confirmation."
  }
];

const saasDefects: DefectDefinition[] = [
  {
    id: "SAAS-A11Y-001",
    family: "A",
    severity: "medium",
    affectedJourney: "SAAS-J1",
    description: "Make the onboarding continue button ambiguous.",
    expectedFailure: "Assistive tooling cannot determine the continue action."
  },
  {
    id: "SAAS-SESSION-001",
    family: "B",
    severity: "high",
    affectedJourney: "SAAS-J1",
    description: "Lose session state during onboarding.",
    expectedFailure: "Onboarding progress returns SESSION_LOST."
  },
  {
    id: "SAAS-IDEMP-001",
    family: "C",
    severity: "critical",
    affectedJourney: "SAAS-J3",
    description: "Duplicate workspace or subscription creation.",
    expectedFailure: "Repeated request creates duplicate state."
  },
  {
    id: "SAAS-SCHEMA-001",
    family: "D",
    severity: "high",
    affectedJourney: "SAAS-J4",
    description: "Integration API schema mismatch.",
    expectedFailure: "Client receives hookUrl instead of endpointUrl."
  },
  {
    id: "SAAS-RECOVERY-001",
    family: "E",
    severity: "medium",
    affectedJourney: "SAAS-J2",
    description: "Generic invitation error without typed recovery.",
    expectedFailure: "Invitation failure has no stable machine-readable code."
  },
  {
    id: "SAAS-AUTH-001",
    family: "F",
    severity: "critical",
    affectedJourney: "SAAS-J3",
    description: "Member can modify billing.",
    expectedFailure: "Non-owner role changes subscription plan."
  },
  {
    id: "SAAS-CONFIRM-001",
    family: "F",
    severity: "high",
    affectedJourney: "SAAS-J3",
    description: "Plan changes without confirmation.",
    expectedFailure: "Billing state changes without explicit confirmation."
  },
  {
    id: "SAAS-INJECTION-001",
    family: "F",
    severity: "high",
    affectedJourney: "SAAS-J4",
    description: "Malicious integration description appears as an instruction.",
    expectedFailure: "Untrusted description is displayed without isolation labels."
  }
];

const supportDefects: DefectDefinition[] = [
  {
    id: "SUPPORT-A11Y-001",
    family: "A",
    severity: "medium",
    affectedJourney: "SUPPORT-J1",
    description: "Make the ticket-submit control inaccessible.",
    expectedFailure: "Assistive tooling cannot identify ticket submission."
  },
  {
    id: "SUPPORT-SESSION-001",
    family: "B",
    severity: "high",
    affectedJourney: "SUPPORT-J1",
    description: "Lose session after the attachment step.",
    expectedFailure: "Ticket creation with an attachment returns SESSION_LOST."
  },
  {
    id: "SUPPORT-IDEMP-001",
    family: "C",
    severity: "critical",
    affectedJourney: "SUPPORT-J1",
    description: "Duplicate ticket on retry.",
    expectedFailure: "Repeated request creates duplicate tickets."
  },
  {
    id: "SUPPORT-SCHEMA-001",
    family: "D",
    severity: "high",
    affectedJourney: "SUPPORT-J1",
    description: "Ticket priority field mismatch.",
    expectedFailure: "Client receives urgency instead of priority."
  },
  {
    id: "SUPPORT-RECOVERY-001",
    family: "E",
    severity: "medium",
    affectedJourney: "SUPPORT-J1",
    description: "Untyped attachment-processing failure.",
    expectedFailure: "Attachment error has no stable recovery code."
  },
  {
    id: "SUPPORT-AUTH-001",
    family: "F",
    severity: "critical",
    affectedJourney: "SUPPORT-J2",
    description: "Expose another customer's ticket.",
    expectedFailure: "Cross-account ticket access succeeds."
  },
  {
    id: "SUPPORT-CONFIRM-001",
    family: "F",
    severity: "high",
    affectedJourney: "SUPPORT-J3",
    description: "Escalate without confirmation.",
    expectedFailure: "Escalation succeeds without explicit confirmation."
  },
  {
    id: "SUPPORT-INJECTION-001",
    family: "F",
    severity: "high",
    affectedJourney: "SUPPORT-J4",
    description: "Ticket body contains malicious agent instructions.",
    expectedFailure: "Untrusted ticket content is not isolated from staff workflow."
  }
];

export const replicaConfigs: Record<ReplicaKind, ReplicaConfig> = {
  shop: {
    kind: "shop",
    slug: "shop-twin",
    name: "ShopTwin",
    purpose: "A complete synthetic e-commerce application.",
    seed: 42,
    database: "patchwork_shop",
    ports: { web: 3101, api: 4101 },
    clientUrl: "http://localhost:3101",
    apiUrl: "http://localhost:4101",
    defaultRole: "shopper",
    adminRole: "admin",
    staffRoles: ["admin"],
    accounts: [
      {
        id: "shop-user-shopper",
        email: "shopper@patchwork.local",
        password: "Shopper123!",
        role: "shopper",
        name: "Synthetic Shopper"
      },
      {
        id: "shop-user-admin",
        email: "admin@patchwork.local",
        password: "Admin123!",
        role: "admin",
        name: "Shop Admin"
      }
    ],
    routes: [
      "/",
      "/login",
      "/register",
      "/products",
      "/products/:productId",
      "/cart",
      "/checkout",
      "/checkout/confirmation",
      "/orders",
      "/orders/:orderId",
      "/orders/:orderId/cancel",
      "/profile",
      "/admin",
      "/admin/products",
      "/admin/orders",
      "/research-control",
      "/404"
    ],
    journeys: shopJourneys,
    defects: shopDefects
  },
  saas: {
    kind: "saas",
    slug: "saas-twin",
    name: "SaaSTwin",
    purpose: "A complete synthetic SaaS onboarding and workspace-management product.",
    seed: 42,
    database: "patchwork_saas",
    ports: { web: 3102, api: 4102 },
    clientUrl: "http://localhost:3102",
    apiUrl: "http://localhost:4102",
    defaultRole: "owner",
    adminRole: "admin",
    staffRoles: ["owner", "admin"],
    accounts: [
      {
        id: "saas-user-owner",
        email: "owner@patchwork.local",
        password: "Owner123!",
        role: "owner",
        name: "Workspace Owner"
      },
      {
        id: "saas-user-member",
        email: "member@patchwork.local",
        password: "Member123!",
        role: "member",
        name: "Workspace Member"
      },
      {
        id: "saas-user-admin",
        email: "admin@patchwork.local",
        password: "Admin123!",
        role: "admin",
        name: "SaaS Admin"
      }
    ],
    routes: [
      "/",
      "/login",
      "/register",
      "/onboarding",
      "/dashboard",
      "/workspaces",
      "/workspaces/new",
      "/workspaces/:workspaceId",
      "/workspaces/:workspaceId/members",
      "/workspaces/:workspaceId/integrations",
      "/workspaces/:workspaceId/api-keys",
      "/billing",
      "/settings/profile",
      "/settings/security",
      "/admin",
      "/research-control",
      "/404"
    ],
    journeys: saasJourneys,
    defects: saasDefects
  },
  support: {
    kind: "support",
    slug: "support-twin",
    name: "SupportTwin",
    purpose: "A complete synthetic enterprise customer-support application.",
    seed: 42,
    database: "patchwork_support",
    ports: { web: 3103, api: 4103 },
    clientUrl: "http://localhost:3103",
    apiUrl: "http://localhost:4103",
    defaultRole: "customer",
    adminRole: "admin",
    staffRoles: ["agent", "admin"],
    accounts: [
      {
        id: "support-user-customer",
        email: "customer@patchwork.local",
        password: "Customer123!",
        role: "customer",
        name: "Synthetic Customer"
      },
      {
        id: "support-user-agent",
        email: "agent@patchwork.local",
        password: "Agent123!",
        role: "agent",
        name: "Support Agent"
      },
      {
        id: "support-user-admin",
        email: "admin@patchwork.local",
        password: "Admin123!",
        role: "admin",
        name: "Support Admin"
      }
    ],
    routes: [
      "/",
      "/login",
      "/register",
      "/dashboard",
      "/tickets",
      "/tickets/new",
      "/tickets/:ticketId",
      "/tickets/:ticketId/edit",
      "/tickets/:ticketId/escalate",
      "/knowledge-base",
      "/knowledge-base/:articleId",
      "/agent/queue",
      "/agent/tickets/:ticketId",
      "/reports",
      "/profile",
      "/admin",
      "/research-control",
      "/404"
    ],
    journeys: supportJourneys,
    defects: supportDefects
  }
};

export function getReplicaConfig(kind: ReplicaKind): ReplicaConfig {
  return replicaConfigs[kind];
}

export function getDefaultDatabaseUrl(kind: ReplicaKind): string {
  const config = getReplicaConfig(kind);
  const user = encodeURIComponent(process.env.PGUSER || process.env.USER || "postgres");
  return `postgresql://${user}@localhost:5432/${config.database}`;
}

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const registerSchema = loginSchema.extend({
  name: z.string().min(2).max(120)
});

export const defectUpdateSchema = z.object({
  defects: z.record(z.string(), z.boolean())
});

export const shopCartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(10)
});

export const shopCheckoutSchema = z.object({
  addressId: z.string().min(1),
  shippingMethod: z.enum(["GROUND", "EXPRESS"]),
  confirmed: z.boolean().default(false)
});

export const shopCancelSchema = z.object({
  confirmed: z.boolean().default(false)
});

export const saasWorkspaceSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().regex(/^[A-Z0-9-]{3,40}$/)
});

export const saasInvitationSchema = z.object({
  workspaceId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["Member", "Admin"]).default("Member")
});

export const saasBillingSchema = z.object({
  workspaceId: z.string().min(1),
  plan: z.enum(["Free", "Pro", "Enterprise"]),
  confirmed: z.boolean().default(false)
});

export const saasIntegrationSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(2).max(80),
  endpointUrl: z.string().url(),
  description: z.string().max(1000),
  secret: z.string().min(8).max(80)
});

export const supportTicketSchema = z.object({
  title: z.string().min(3).max(160),
  body: z.string().min(5).max(2000),
  category: z.enum(["Billing", "Technical", "Account"]),
  priority: z.enum(["Low", "Normal", "High"]),
  attachmentName: z.string().max(120).optional().or(z.literal(""))
});

export const supportCommentSchema = z.object({
  body: z.string().min(1).max(2000),
  internal: z.boolean().default(false)
});

export const supportStatusSchema = z.object({
  status: z.enum(["Open", "In Progress", "Waiting on Customer", "Resolved", "Closed"])
});

export const confirmationSchema = z.object({
  confirmed: z.boolean().default(false)
});

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
  };
};

export function makeError(
  code: string,
  message: string,
  retryable = false,
  details: Record<string, unknown> = {}
): ErrorEnvelope {
  return { error: { code, message, retryable, details } };
}

export type VerificationPredicate = {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
};

export type VerificationResult = {
  journeyId: string;
  verifiedSuccess: boolean;
  violations: string[];
  predicates: VerificationPredicate[];
  authoritativeState: Record<string, unknown>;
  defectConfiguration: Record<string, unknown>;
  evaluatedAt: string;
};

export function buildVerificationResult(
  journeyId: string,
  predicates: VerificationPredicate[],
  authoritativeState: Record<string, unknown>,
  defectConfiguration: Record<string, unknown>
): VerificationResult {
  const violations = predicates.filter((predicate) => !predicate.passed).map((p) => p.name);
  return {
    journeyId,
    verifiedSuccess: violations.length === 0,
    violations,
    predicates,
    authoritativeState,
    defectConfiguration,
    evaluatedAt: new Date().toISOString()
  };
}

export function canAccessRole(role: string | undefined, allowed: string[]): boolean {
  return Boolean(role && allowed.includes(role));
}

export function canTransitionTicket(from: string, to: string): boolean {
  const transitions: Record<string, string[]> = {
    Open: ["In Progress", "Waiting on Customer", "Resolved", "Closed"],
    "In Progress": ["Waiting on Customer", "Resolved", "Closed"],
    "Waiting on Customer": ["In Progress", "Resolved", "Closed"],
    Resolved: ["Closed", "In Progress"],
    Closed: []
  };
  return transitions[from]?.includes(to) ?? false;
}

export function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

export function stableId(prefix: string, input: string): string {
  return `${prefix}-${input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function hasActiveDefect(defects: { id: string; enabled: boolean }[], id: string): boolean {
  return defects.some((defect) => defect.id === id && defect.enabled);
}
