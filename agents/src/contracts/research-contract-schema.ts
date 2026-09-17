import { z } from "zod";

export const PredicateSourceSchema = z.enum(["database", "backend-state", "audit-event", "API-response", "browser-state"]);
export const PredicateSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export const PredicateOperatorSchema = z.enum(["equals", "not-equals", "present", "absent", "one-of", "contains", "count-equals", "boolean-true"]);
export const PermittedSurfaceSchema = z.enum(["frontend", "api", "research-verifier"]);

export const ResearchPredicateSchema = z.object({
  id: z.string().min(3),
  description: z.string().min(5),
  source: PredicateSourceSchema,
  operator: PredicateOperatorSchema,
  expectedValue: z.unknown(),
  severity: PredicateSeveritySchema
});

export const ResearchStateSchema = z.object({
  id: z.string().min(2),
  description: z.string().min(3),
  route: z.string().optional()
});

export const ResearchTransitionSchema = z.object({
  id: z.string().min(2),
  from: z.string().min(2),
  to: z.string().min(2),
  action: z.string().min(2)
});

export const ExpectedDefectOutcomeSchema = z.object({
  defectId: z.string().min(3),
  expectedVerifiedSuccess: z.boolean(),
  firstFailedPredicateId: z.string().min(3),
  expectedFailure: z.string().min(5)
});

export const ResearchContractSchema = z.object({
  contractVersion: z.string().min(1),
  journeyId: z.string().min(3),
  replica: z.enum(["shop-twin", "saas-twin", "support-twin"]),
  instruction: z.string().min(10),
  startingCheckpoint: z.string().min(1),
  testAccountReference: z.string().min(1),
  permittedSurfaces: z.array(PermittedSurfaceSchema).min(1),
  maximumSteps: z.number().int().min(1).max(100),
  timeoutSeconds: z.number().int().min(1).max(3600),
  states: z.array(ResearchStateSchema).min(1),
  expectedTransitions: z.array(ResearchTransitionSchema).min(1),
  successPredicates: z.array(ResearchPredicateSchema).min(1),
  safetyInvariants: z.array(ResearchPredicateSchema).min(1),
  authoritativeVerifierEndpoint: z.string().min(1),
  affectedDefectIds: z.array(z.string()).default([]),
  expectedCleanOutcome: z.object({
    verifiedSuccess: z.literal(true),
    notes: z.string().optional()
  }),
  expectedDefectOutcomes: z.array(ExpectedDefectOutcomeSchema).default([])
});

export const ResearchContractsFileSchema = z.object({
  replica: z.enum(["shop-twin", "saas-twin", "support-twin"]),
  contractVersion: z.string().min(1),
  journeys: z.array(ResearchContractSchema).min(1)
});

export type ResearchContract = z.infer<typeof ResearchContractSchema>;
export type ResearchPredicate = z.infer<typeof ResearchPredicateSchema>;
