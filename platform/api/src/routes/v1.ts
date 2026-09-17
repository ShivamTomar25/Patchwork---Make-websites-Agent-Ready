import { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  clearAuthCookies,
  createEmailToken,
  ForgotPasswordSchema,
  hashPassword,
  issueSession,
  LoginSchema,
  publicUser,
  requireAuth,
  requireRole,
  ResetPasswordSchema,
  rotateRefreshToken,
  sha256,
  SignupSchema,
  slugify,
  VerifyEmailSchema,
  verifyPassword,
  type AuthRequest
} from "../auth/auth.js";
import { MockExperimentEngine, RealExperimentEngine } from "../engine/experiment-engine.js";
import type { Role } from "../generated/prisma/index.js";
import { env } from "../lib/env.js";
import { ApiError, asyncHandler, pagination, sendCreated, sendData, validate } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { redact } from "../lib/security.js";

const router = Router();
const mockEngine = new MockExperimentEngine(prisma as any);
const realEngine = new RealExperimentEngine(prisma as any);
const writeRoles: Role[] = ["owner", "admin", "engineer"];
const adminRoles: Role[] = ["owner", "admin"];

const ProjectSchema = z.object({
  name: z.string().min(2).max(160),
  mode: z.enum(["scan", "repair"]).default("scan"),
  repositoryUrl: z.string().url().optional().or(z.literal("")),
  repositoryStatus: z.string().default("not_connected")
});

const EnvironmentSchema = z.object({
  name: z.string().min(2).max(160),
  url: z.string().url(),
  apiUrl: z.string().url().optional().or(z.literal("")),
  type: z.enum(["local", "staging", "production"]).default("staging"),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  resetCapable: z.boolean().default(false),
  healthStatus: z.enum(["unknown", "healthy", "degraded", "down"]).default("unknown")
});

const JourneySchema = z.object({
  name: z.string().min(2).max(160),
  instruction: z.string().min(10),
  startCheckpoint: z.string().min(2),
  timeoutSeconds: z.number().int().min(10).max(3600).default(120),
  tokenBudget: z.number().int().min(100).max(250000).default(20000),
  surfaces: z.array(z.string()).default(["web"]),
  successPredicates: z.array(z.string()).min(1),
  safetyInvariants: z.array(z.string()).min(1)
});

const AgentSchema = z.object({
  name: z.string().min(2).max(160),
  kind: z.enum(["scripted", "accessibility_a", "accessibility_b", "screenshot", "tool"]),
  provider: z.string().optional(),
  model: z.string().optional(),
  enabled: z.boolean().default(true),
  secretConfigured: z.boolean().default(false),
  settings: z.record(z.string(), z.unknown()).default({})
});

const ExperimentSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(160),
  journeyIds: z.array(z.string()).min(1),
  agentIds: z.array(z.string()).min(1),
  seeds: z.array(z.number().int().min(1)).default([1]),
  defects: z.record(z.string(), z.boolean()).default({}),
  surfaces: z.array(z.string()).default(["web"]),
  searchBudget: z.number().int().min(0).default(0),
  confirmationBudget: z.number().int().min(0).default(0),
  reviewRequired: z.boolean().default(true),
  executionMode: z.enum(["mock", "real-local-pilot"]).default("mock"),
  startMockRun: z.boolean().default(true)
});

const PatchActionSchema = z.object({ decision: z.enum(["approved", "rejected"]) });

router.get("/health", (_req, res) => {
  sendData(res, { ok: true, service: "patchwork-platform-api", time: new Date().toISOString() });
});

router.get("/openapi.json", (_req, res) => {
  sendData(res, {
    openapi: "3.1.0",
    info: { title: "PATCHWORK Platform API", version: "0.1.0" },
    servers: [{ url: env.apiUrl }],
    paths: Object.fromEntries(
      [
        "/api/v1/auth/signup",
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/me",
        "/api/v1/projects",
        "/api/v1/experiments",
        "/api/v1/certificates",
        "/api/v1/reports",
        "/api/v1/audit-logs"
      ].map((path) => [path, { summary: "PATCHWORK platform endpoint" }])
    )
  });
});

router.post(
  "/auth/signup",
  asyncHandler(async (req, res) => {
    const input = validate(SignupSchema, req.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ApiError(409, "EMAIL_IN_USE", "An account with this email already exists.");
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) }
      });
      const baseSlug = slugify(input.organizationName);
      const organization = await tx.organization.create({
        data: { name: input.organizationName, slug: `${baseSlug}-${user.id.slice(-5)}` }
      });
      await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: "owner" } });
      await tx.subscription.create({ data: { organizationId: organization.id, plan: "repair", status: "trial" } });
      await tx.auditLog.create({
        data: { organizationId: organization.id, userId: user.id, action: "auth.signup", targetType: "user", targetId: user.id, metadata: { synthetic: false } }
      });
      return { user, organization };
    });
    await createEmailToken(result.user.id, "verify_email", result.user.email);
    await issueSession(res, result.user, req);
    sendCreated(res, { user: publicUser(result.user), organization: result.organization });
  })
);

router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const input = validate(LoginSchema, req.body);
    const user = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new ApiError(401, "AUTH_FAILED", "Email or password is incorrect.");
    }
    await issueSession(res, user, req);
    await audit(req as AuthRequest, "auth.login", "user", user.id, {});
    sendData(res, { user: publicUser(user) });
  })
);

router.post(
  "/auth/refresh",
  asyncHandler(async (req, res) => {
    const user = await rotateRefreshToken(req, res);
    sendData(res, { user: publicUser(user) });
  })
);

router.post(
  "/auth/logout",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const token = req.cookies?.refreshToken;
    if (token) {
      const session = await prisma.session.findFirst({ where: { userId: req.auth?.user.id, refreshTokenHash: sha256(token), revokedAt: null } });
      if (session) await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    }
    clearAuthCookies(res);
    await audit(req, "auth.logout", "session", req.auth?.user.id, {});
    sendData(res, { ok: true });
  })
);

router.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    sendData(res, {
      user: publicUser(req.auth!.user),
      organization: req.auth!.organization,
      membership: { id: req.auth!.membership.id, role: req.auth!.membership.role }
    });
  })
);

router.post(
  "/auth/forgot-password",
  asyncHandler(async (req, res) => {
    const input = validate(ForgotPasswordSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (user) await createEmailToken(user.id, "password_reset", user.email);
    sendData(res, { ok: true, message: "If an account exists, reset instructions have been queued." });
  })
);

router.post(
  "/auth/reset-password",
  asyncHandler(async (req, res) => {
    const input = validate(ResetPasswordSchema, req.body);
    const token = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(input.token) }, include: { user: true } });
    if (!token || token.usedAt || token.expiresAt < new Date() || token.type !== "password_reset") {
      throw new ApiError(400, "TOKEN_INVALID", "Password reset token is invalid or expired.");
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: token.userId }, data: { passwordHash: await hashPassword(input.password) } }),
      prisma.emailToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      prisma.session.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date() } })
    ]);
    sendData(res, { ok: true });
  })
);

router.post(
  "/auth/verify-email",
  asyncHandler(async (req, res) => {
    const input = validate(VerifyEmailSchema, req.body);
    const token = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!token || token.usedAt || token.expiresAt < new Date() || token.type !== "verify_email") {
      throw new ApiError(400, "TOKEN_INVALID", "Email verification token is invalid or expired.");
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.emailToken.update({ where: { id: token.id }, data: { usedAt: new Date() } })
    ]);
    sendData(res, { ok: true });
  })
);

router.post(
  "/auth/sessions/:id/revoke",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    await prisma.session.updateMany({ where: { id: param(req, "id"), userId: req.auth!.user.id }, data: { revokedAt: new Date() } });
    sendData(res, { ok: true });
  })
);

router.use(requireAuth);

router.get("/organizations/current", (req: AuthRequest, res) => {
  sendData(res, { organization: req.auth!.organization, role: req.auth!.membership.role });
});

router.patch(
  "/organizations/current",
  requireRole(adminRoles),
  asyncHandler(async (req: AuthRequest, res) => {
    const input = validate(z.object({ name: z.string().min(2).max(160) }), req.body);
    const organization = await prisma.organization.update({ where: { id: req.auth!.organization.id }, data: input });
    await audit(req, "organization.update", "organization", organization.id, input);
    sendData(res, { organization });
  })
);

router.get(
  "/projects",
  asyncHandler(async (req: AuthRequest, res) => {
    const { skip, take, page, pageSize } = pagination(req);
    const where = { organizationId: req.auth!.organization.id, deletedAt: null, name: { contains: String(req.query.q || ""), mode: "insensitive" as const } };
    const [items, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: "desc" },
        include: { environments: true, journeys: true, agents: true, certificates: true }
      }),
      prisma.project.count({ where })
    ]);
    sendData(res, { projects: items }, { page, pageSize, total });
  })
);

router.post(
  "/projects",
  requireRole(writeRoles),
  asyncHandler(async (req: AuthRequest, res) => {
    const input = validate(ProjectSchema, req.body);
    const project = await prisma.project.create({
      data: {
        organizationId: req.auth!.organization.id,
        name: input.name,
        mode: input.mode,
        repositoryUrl: input.repositoryUrl || null,
        repositoryStatus: input.repositoryStatus,
        agents: { create: defaultAgents(req.auth!.organization.id) }
      },
      include: { agents: true }
    });
    await audit(req, "project.create", "project", project.id, input);
    sendCreated(res, { project });
  })
);

router.get("/projects/:projectId", asyncHandler(async (req: AuthRequest, res) => sendData(res, { project: await requireProject(req) })));

router.patch(
  "/projects/:projectId",
  requireRole(writeRoles),
  asyncHandler(async (req: AuthRequest, res) => {
    await requireProject(req);
    const input = validate(ProjectSchema.partial(), req.body);
    const project = await prisma.project.update({ where: { id: param(req, "projectId") }, data: normalizeEmpty(input) });
    await audit(req, "project.update", "project", project.id, input);
    sendData(res, { project });
  })
);

router.delete(
  "/projects/:projectId",
  requireRole(adminRoles),
  asyncHandler(async (req: AuthRequest, res) => {
    await requireProject(req);
    await prisma.project.update({ where: { id: param(req, "projectId") }, data: { deletedAt: new Date() } });
    await audit(req, "project.delete", "project", param(req, "projectId"), {});
    sendData(res, { ok: true });
  })
);

router.get("/projects/:projectId/environments", asyncHandler(async (req: AuthRequest, res) => {
  await requireProject(req);
  const environments = await prisma.environment.findMany({ where: { projectId: param(req, "projectId"), deletedAt: null }, orderBy: { createdAt: "desc" } });
  sendData(res, { environments });
}));

router.post("/projects/:projectId/environments", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  await requireProject(req);
  const input = validate(EnvironmentSchema, req.body);
  const environment = await prisma.environment.create({
    data: { ...normalizeEmpty(input), organizationId: req.auth!.organization.id, projectId: param(req, "projectId") }
  });
  await audit(req, "environment.create", "environment", environment.id, input);
  sendCreated(res, { environment });
}));

router.patch("/environments/:environmentId", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  const existing = await requireEnvironment(req);
  const input = validate(EnvironmentSchema.partial(), req.body);
  const environment = await prisma.environment.update({ where: { id: existing.id }, data: normalizeEmpty(input) });
  sendData(res, { environment });
}));

router.delete("/environments/:environmentId", requireRole(adminRoles), asyncHandler(async (req: AuthRequest, res) => {
  const existing = await requireEnvironment(req);
  await prisma.environment.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  sendData(res, { ok: true });
}));

router.get("/projects/:projectId/journeys", asyncHandler(async (req: AuthRequest, res) => {
  await requireProject(req);
  const journeys = await prisma.journey.findMany({ where: { projectId: param(req, "projectId"), deletedAt: null }, include: { predicates: true }, orderBy: { createdAt: "desc" } });
  sendData(res, { journeys });
}));

router.post("/projects/:projectId/journeys", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  await requireProject(req);
  const input = validate(JourneySchema, req.body);
  const journey = await prisma.journey.create({
    data: {
      organizationId: req.auth!.organization.id,
      projectId: param(req, "projectId"),
      name: input.name,
      instruction: input.instruction,
      startCheckpoint: input.startCheckpoint,
      timeoutSeconds: input.timeoutSeconds,
      tokenBudget: input.tokenBudget,
      surfaces: input.surfaces,
      predicates: {
        create: [
          ...input.successPredicates.map((text) => ({ type: "success", text })),
          ...input.safetyInvariants.map((text) => ({ type: "safety", text }))
        ]
      }
    },
    include: { predicates: true }
  });
  await audit(req, "journey.create", "journey", journey.id, input);
  sendCreated(res, { journey });
}));

router.get("/projects/:projectId/journeys/:journeyId", asyncHandler(async (req: AuthRequest, res) => {
  await requireProject(req);
  const journey = await prisma.journey.findFirst({ where: { id: param(req, "journeyId"), projectId: param(req, "projectId"), deletedAt: null }, include: { predicates: true } });
  if (!journey) throw new ApiError(404, "JOURNEY_NOT_FOUND", "Journey was not found.");
  sendData(res, { journey });
}));

router.patch("/projects/:projectId/journeys/:journeyId", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  await requireProject(req);
  const input = validate(JourneySchema.partial(), req.body);
  const journey = await prisma.journey.update({
    where: { id: param(req, "journeyId") },
    data: {
      name: input.name,
      instruction: input.instruction,
      startCheckpoint: input.startCheckpoint,
      timeoutSeconds: input.timeoutSeconds,
      tokenBudget: input.tokenBudget,
      surfaces: input.surfaces
    },
    include: { predicates: true }
  });
  sendData(res, { journey });
}));

router.delete("/projects/:projectId/journeys/:journeyId", requireRole(adminRoles), asyncHandler(async (req: AuthRequest, res) => {
  await requireProject(req);
  await prisma.journey.update({ where: { id: param(req, "journeyId") }, data: { deletedAt: new Date() } });
  sendData(res, { ok: true });
}));

router.get("/projects/:projectId/agent-configurations", asyncHandler(async (req: AuthRequest, res) => {
  await requireProject(req);
  const agents = await prisma.agentConfiguration.findMany({ where: { projectId: param(req, "projectId"), deletedAt: null }, orderBy: { kind: "asc" } });
  sendData(res, { agents: agents.map(redactAgent) });
}));

router.post("/projects/:projectId/agent-configurations", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  await requireProject(req);
  const input = validate(AgentSchema, req.body);
  const agent = await prisma.agentConfiguration.create({
    data: { ...input, settings: input.settings as any, organizationId: req.auth!.organization.id, projectId: param(req, "projectId") }
  });
  sendCreated(res, { agent: redactAgent(agent) });
}));

router.patch("/agent-configurations/:agentId", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  const existing = await requireAgent(req);
  const input = validate(AgentSchema.partial(), req.body);
  const agent = await prisma.agentConfiguration.update({ where: { id: existing.id }, data: { ...input, settings: input.settings as any } });
  sendData(res, { agent: redactAgent(agent) });
}));

router.get("/experiments", asyncHandler(async (req: AuthRequest, res) => {
  const { skip, take, page, pageSize } = pagination(req);
  const where = { organizationId: req.auth!.organization.id };
  const [experiments, total] = await Promise.all([
    prisma.experiment.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { project: true, runs: { orderBy: { createdAt: "desc" }, take: 1 } } }),
    prisma.experiment.count({ where })
  ]);
  sendData(res, { experiments }, { page, pageSize, total });
}));

router.post("/experiments", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  const input = validate(ExperimentSchema, req.body);
  const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: req.auth!.organization.id, deletedAt: null } });
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project was not found.");
  const selectedEngine = input.executionMode === "real-local-pilot" ? realEngine : mockEngine;
  await selectedEngine.validateConfiguration(input);
  const experiment = await prisma.experiment.create({
    data: {
      organizationId: req.auth!.organization.id,
      projectId: input.projectId,
      name: input.name,
      status: input.startMockRun ? "queued" : "draft",
      seeds: input.seeds,
      defects: input.defects,
      surfaces: input.surfaces,
      searchBudget: input.searchBudget,
      confirmationBudget: input.confirmationBudget,
      reviewRequired: input.reviewRequired,
      journeys: { create: input.journeyIds.map((journeyId) => ({ journeyId })) },
      agents: { create: input.agentIds.map((agentId) => ({ agentId })) }
    }
  });
  const runId = input.startMockRun ? await selectedEngine.startExperiment(experiment.id) : null;
  await audit(req, "experiment.create", "experiment", experiment.id, { ...input, runId });
  sendCreated(res, { experiment, runId });
}));

router.get("/experiments/:runId", asyncHandler(async (req: AuthRequest, res) => {
  const run = await requireRun(req);
  const selectedEngine = engineForRun(run);
  const [events, failures, patches, confirmations, reports, certificates, steps] = await Promise.all([
    prisma.experimentEvent.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } }),
    selectedEngine.getFailures(run.id),
    selectedEngine.getPatches(run.id),
    prisma.confirmation.findMany({ where: { runId: run.id }, orderBy: { createdAt: "desc" } }),
    prisma.report.findMany({ where: { runId: run.id } }),
    prisma.certificate.findMany({ where: { runId: run.id } }),
    selectedEngine.getTrajectory(run.id)
  ]);
  const exportLinks = run.engineMode === "real-local-pilot" ? realEngine.exportLinks(run.id) : [];
  sendData(res, { run: { ...run, steps }, events, failures, patches, confirmations, reports, certificates, exportLinks, repair: readRepairEvidence(run.id) });
}));

router.post("/experiments/:runId/cancel", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  const run = await requireRun(req);
  await engineForRun(run).cancelExperiment(run.id);
  sendData(res, { ok: true });
}));

router.post("/experiments/:runId/resume", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  const run = await requireRun(req);
  if (run.engineMode !== "real-local-pilot") throw new ApiError(400, "RUN_NOT_RESUMABLE", "Only real local pilot runs can be resumed.");
  await realEngine.resumeExperiment(run.id);
  sendData(res, { ok: true });
}));

router.get("/experiments/:runId/trajectories", asyncHandler(async (req: AuthRequest, res) => {
  const run = await requireRun(req);
  sendData(res, { steps: await engineForRun(run).getTrajectory(run.id) });
}));

router.get("/experiments/:runId/failures", asyncHandler(async (req: AuthRequest, res) => {
  const run = await requireRun(req);
  sendData(res, { failures: await engineForRun(run).getFailures(run.id) });
}));

router.get("/experiments/:runId/patches", asyncHandler(async (req: AuthRequest, res) => {
  const run = await requireRun(req);
  sendData(res, { patches: await engineForRun(run).getPatches(run.id) });
}));

router.post("/patches/:patchId/decision", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  const input = validate(PatchActionSchema, req.body);
  const patch: any = await prisma.patchCandidate.findUnique({ where: { id: param(req, "patchId") }, include: { run: true } });
  if (!patch || patch.run.organizationId !== req.auth!.organization.id) throw new ApiError(404, "PATCH_NOT_FOUND", "Patch candidate was not found.");
  const updated = await prisma.patchCandidate.update({ where: { id: patch.id }, data: { status: input.decision } });
  await audit(req, `patch.${input.decision}`, "patch", patch.id, {});
  sendData(res, { patch: updated });
}));

router.post("/experiments/:runId/confirmation", requireRole(writeRoles), asyncHandler(async (req: AuthRequest, res) => {
  const run = await requireRun(req);
  sendCreated(res, { confirmation: await engineForRun(run).startConfirmation(run.id) });
}));

router.get("/experiments/:runId/exports/:file", asyncHandler(async (req: AuthRequest, res) => {
  const run = await requireRun(req);
  const file = param(req, "file");
  const root = resolveRepoRoot();
  const searchExport = [
    ...searchCertificationFullExportTargets(path.join(root, "experiments/results/search-certification-pilot-v2/full-confirmation")),
    ...searchCertificationExportTargets(path.join(root, "experiments/results/search-certification-pilot-v2")),
    ...searchCertificationExportTargets(path.join(root, "experiments/results/search-certification-pilot-v1"))
  ].find((target) => target.key === file);
  if (searchExport) {
    res.download(searchExport.absolutePath);
    return;
  }
  const repairExport = repairExportTargets(path.join(resolveRepoRoot(), "experiments/results/repair-pilot-v1")).find((target) => target.key === file);
  if (repairExport) {
    res.download(repairExport.absolutePath);
    return;
  }
  if (run.engineMode !== "real-local-pilot") throw new ApiError(404, "EXPORT_NOT_FOUND", "This run does not have pilot exports.");
  res.download(realEngine.exportFilePath(file));
}));

router.get("/certificates", asyncHandler(async (req: AuthRequest, res) => {
  const certificates = await prisma.certificate.findMany({ where: { organizationId: req.auth!.organization.id }, include: { project: true }, orderBy: { issuedAt: "desc" } });
  sendData(res, { certificates });
}));

router.get("/reports", asyncHandler(async (req: AuthRequest, res) => {
  const reports = await prisma.report.findMany({ where: { organizationId: req.auth!.organization.id }, include: { project: true }, orderBy: { createdAt: "desc" } });
  sendData(res, { reports });
}));

router.get("/integrations", asyncHandler(async (req: AuthRequest, res) => {
  const integrations = await prisma.integration.findMany({ where: { organizationId: req.auth!.organization.id }, orderBy: { createdAt: "desc" } });
  sendData(res, { integrations: integrations.map((item) => ({ ...item, config: redact(item.config) })) });
}));

router.post("/integrations", requireRole(adminRoles), asyncHandler(async (req: AuthRequest, res) => {
  const input = validate(z.object({ type: z.enum(["github", "slack", "webhook", "openapi"]), name: z.string().min(2), config: z.record(z.string(), z.unknown()).default({}) }), req.body);
  const integration = await prisma.integration.create({ data: { ...input, config: input.config as any, organizationId: req.auth!.organization.id } });
  sendCreated(res, { integration: { ...integration, config: redact(integration.config) } });
}));

router.get("/team", asyncHandler(async (req: AuthRequest, res) => {
  const team = await prisma.membership.findMany({ where: { organizationId: req.auth!.organization.id }, include: { user: true }, orderBy: { createdAt: "asc" } });
  sendData(res, { members: team.map((item) => ({ id: item.id, role: item.role, user: publicUser(item.user) })) });
}));

router.patch("/team/:membershipId", requireRole(adminRoles), asyncHandler(async (req: AuthRequest, res) => {
  const input = validate(z.object({ role: z.enum(["owner", "admin", "engineer", "viewer"]) }), req.body);
  const membership = await prisma.membership.findFirst({ where: { id: param(req, "membershipId"), organizationId: req.auth!.organization.id } });
  if (!membership) throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "Membership was not found.");
  const updated = await prisma.membership.update({ where: { id: membership.id }, data: { role: input.role } });
  sendData(res, { membership: updated });
}));

router.get("/audit-logs", asyncHandler(async (req: AuthRequest, res) => {
  const logs = await prisma.auditLog.findMany({ where: { organizationId: req.auth!.organization.id }, include: { user: true }, orderBy: { createdAt: "desc" }, take: 100 });
  sendData(res, { logs: logs.map((log) => ({ ...log, metadata: redact(log.metadata), user: log.user ? publicUser(log.user) : null })) });
}));

router.get("/dashboard", asyncHandler(async (req: AuthRequest, res) => {
  const organizationId = req.auth!.organization.id;
  const [projects, runs, certificates, approvals] = await Promise.all([
    prisma.project.count({ where: { organizationId, deletedAt: null } }),
    prisma.experimentRun.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 12, include: { experiment: { include: { project: true } } } }),
    prisma.certificate.count({ where: { organizationId, status: "certified" } }),
    prisma.patchCandidate.count({ where: { status: "proposed", run: { organizationId } } })
  ]);
  const successful = runs.filter((run) => run.status === "completed").length;
  const violations = runs.reduce((sum, run) => sum + run.violationCount, 0);
  sendData(res, {
    metrics: {
      projects,
      recentExperiments: runs.length,
      compliantSuccessRate: runs.length ? Math.round((successful / runs.length) * 100) : 0,
      violations,
      certifiedResults: certificates,
      pendingApprovals: approvals
    },
    recentRuns: runs
  });
}));

async function requireProject(req: AuthRequest) {
  const project: any = await prisma.project.findFirst({
    where: { id: param(req, "projectId"), organizationId: req.auth!.organization.id, deletedAt: null },
    include: {
      environments: { where: { deletedAt: null } },
      journeys: { where: { deletedAt: null }, include: { predicates: true } },
      agents: { where: { deletedAt: null } },
      experiments: { orderBy: { createdAt: "desc" }, take: 5 },
      certificates: { orderBy: { issuedAt: "desc" }, take: 5 }
    }
  });
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project was not found.");
  return { ...project, agents: project.agents.map(redactAgent) };
}

async function requireEnvironment(req: AuthRequest) {
  const environment = await prisma.environment.findFirst({ where: { id: param(req, "environmentId"), organizationId: req.auth!.organization.id, deletedAt: null } });
  if (!environment) throw new ApiError(404, "ENVIRONMENT_NOT_FOUND", "Environment was not found.");
  return environment;
}

async function requireAgent(req: AuthRequest) {
  const agent = await prisma.agentConfiguration.findFirst({ where: { id: param(req, "agentId"), organizationId: req.auth!.organization.id, deletedAt: null } });
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent configuration was not found.");
  return agent;
}

async function requireRun(req: AuthRequest) {
  const run = await prisma.experimentRun.findFirst({
    where: { id: param(req, "runId"), organizationId: req.auth!.organization.id },
    include: {
      steps: { orderBy: { index: "asc" } },
      experiment: { include: { project: true, journeys: { include: { journey: true } }, agents: { include: { agent: true } } } }
    }
  });
  if (!run) throw new ApiError(404, "RUN_NOT_FOUND", "Experiment run was not found.");
  return run;
}

async function audit(req: AuthRequest, action: string, targetType: string, targetId: string | undefined, metadata: Record<string, unknown>) {
  const organizationId = req.auth?.organization.id;
  const userId = req.auth?.user.id;
  if (!organizationId) return;
  await prisma.auditLog.create({ data: { organizationId, userId, action, targetType, targetId, metadata: redact(metadata) as any } });
}

function redactAgent<T extends { settings: unknown }>(agent: T) {
  return { ...agent, settings: redact(agent.settings) };
}

function normalizeEmpty<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === "" ? null : value])) as T;
}

function engineForRun(run: { engineMode?: string }) {
  return run.engineMode === "real-local-pilot" ? realEngine : mockEngine;
}

function param(req: AuthRequest, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : String(value);
}

function defaultAgents(organizationId: string) {
  return [
    { organizationId, name: "Scripted baseline", kind: "scripted" as const, provider: "none", model: "deterministic", settings: { default: true } },
    { organizationId, name: "Accessibility Agent A", kind: "accessibility_a" as const, provider: "openai-compatible", model: "configured-at-runtime", settings: { observation: "aria" } },
    { organizationId, name: "Accessibility Agent B", kind: "accessibility_b" as const, provider: "openai-compatible", model: "configured-at-runtime", settings: { observation: "aria" } },
    { organizationId, name: "Screenshot Agent", kind: "screenshot" as const, provider: "openai-compatible-vision", model: "configured-at-runtime", settings: { observation: "pixels" } },
    { organizationId, name: "OpenAPI Tool Agent", kind: "tool" as const, provider: "openapi", model: "tool-native", settings: { observation: "tools" } }
  ];
}

function readRepairEvidence(runId: string) {
  const dir = path.join(resolveRepoRoot(), "experiments/results/repair-pilot-v1");
  const runtimeReplay = readJsonl(path.join(dir, "runtime-paired-replay.jsonl"));
  const searchV2Dir = path.join(resolveRepoRoot(), "experiments/results/search-certification-pilot-v2");
  const searchV1Dir = path.join(resolveRepoRoot(), "experiments/results/search-certification-pilot-v1");
  const searchDir = existsSync(path.join(searchV2Dir, "search-certification-v2-report.md")) ? searchV2Dir : searchV1Dir;
  return {
    kpis: readCsvObjects(path.join(dir, "repair-kpis.csv"))[0] || null,
    runtimeKpis: readJson(path.join(dir, "runtime-kpis.json")),
    localizations: readJsonl(path.join(dir, "localization.jsonl")).slice(0, 50),
    cones: readJsonl(path.join(dir, "failure-cones.jsonl")).slice(0, 50),
    patches: readJsonl(path.join(dir, "patches.jsonl")).slice(0, 20),
    validations: readJsonl(path.join(dir, "patch-validation.jsonl")).slice(0, 20),
    replay: readJsonl(path.join(dir, "paired-replay.jsonl")).slice(0, 50),
    runtimeValidations: readCsvObjects(path.join(dir, "runtime-validation.csv")).slice(0, 50),
    runtimeReplay: runtimeReplay.slice(0, 50),
    runtimeRegression: readJsonl(path.join(dir, "runtime-regression.jsonl")).slice(0, 50),
    runtimeRegressionSummary: readCsvObjects(path.join(dir, "runtime-regression-summary.csv")).slice(0, 50),
    runtimeRollback: readCsvObjects(path.join(dir, "runtime-rollback.csv")).slice(0, 50),
    runtimeUnresolved: readCsvObjects(path.join(dir, "runtime-unresolved-cases.csv")).slice(0, 50),
    runtimePredicates: runtimeReplay.slice(0, 20).map((row: any) => ({
      patchId: row.patchId,
      journeyId: row.journeyId,
      originalFirstFailedPredicate: row.original?.firstFailedPredicate || "",
      patchedPredicates: row.patched?.predicates || [],
      originalResultPath: row.original?.resultPath,
      patchedResultPath: row.patched?.resultPath
    })),
    reportPath: existsSync(path.join(dir, "repair-pilot-report.md")) ? "experiments/results/repair-pilot-v1/repair-pilot-report.md" : null,
    runtimeReportPath: existsSync(path.join(dir, "runtime-repair-report.md")) ? "experiments/results/repair-pilot-v1/runtime-repair-report.md" : null,
    runtimeExportLinks: repairExportTargets(dir).map((target) => ({
      file: target.key,
      label: target.label,
      url: `/api/v1/experiments/${runId}/exports/${encodeURIComponent(target.key)}`
    })),
    searchCertification: readSearchCertificationEvidence(runId, searchDir)
  };
}

function readSearchCertificationEvidence(runId: string, dir: string) {
  const searchHistory = readJsonl(path.join(dir, "search-history.jsonl"));
  const repeatedSearch = readJsonl(path.join(dir, "repeated-search-results.jsonl"));
  const confirmation = readJsonl(path.join(dir, "confirmation-observations.jsonl"));
  const confidence = readJsonl(path.join(dir, "confidence-sequence-history.jsonl"));
  const version = dir.endsWith("search-certification-pilot-v2") ? "v2" : "v1";
  const reportFile = version === "v2" ? "search-certification-v2-report.md" : "search-certification-report.md";
  return {
    version,
    configurationSpace: readCsvObjects(path.join(dir, "configuration-space.csv")).slice(0, 50),
    oracleSummary: readCsvObjects(path.join(dir, "oracle-summary.csv")).slice(0, 50),
    objectiveAudit: readCsvObjects(path.join(dir, "objective-audit.csv")).slice(0, 50),
    searchHistory: searchHistory.slice(0, 50),
    repeatedSearch: repeatedSearch.slice(0, 50),
    searchSummary: readCsvObjects(path.join(dir, "search-summary.csv")).slice(0, 50),
    strategyComparison: readCsvObjects(path.join(dir, "search-strategy-comparison.csv")).slice(0, 50),
    budgetSensitivity: readCsvObjects(path.join(dir, "budget-sensitivity.csv")).slice(0, 50),
    candidateRecall: readCsvObjects(path.join(dir, "candidate-recall.csv")).slice(0, 50),
    candidateSetAudit: readJson(path.join(dir, "candidate-set-audit.json")),
    regretSummary: readCsvObjects(path.join(dir, "regret-summary.csv")).slice(0, 50),
    candidateSets: ["shop", "saas", "support"].map((replica) => readJson(path.join(dir, `candidate-set-${replica}.json`))).filter(Boolean),
    confirmationBudgetPlan: readJson(path.join(dir, "confirmation-budget-plan.json")),
    fullConfirmation: readFullConfirmationEvidence(runId, path.join(dir, "full-confirmation")),
    confirmationObservations: confirmation.slice(0, 50),
    confidenceHistory: confidence.slice(-50),
    confirmationSummary: readCsvObjects(path.join(dir, "confirmation-summary.csv")).slice(0, 50),
    certificates: readJsonl(path.join(dir, "certificates.jsonl")),
    safetySummary: readCsvObjects(path.join(dir, "safety-summary.csv")).slice(0, 50),
    abstentionSummary: readCsvObjects(path.join(dir, "abstention-summary.csv")).slice(0, 50),
    reportPath: existsSync(path.join(dir, reportFile)) ? `${path.relative(resolveRepoRoot(), dir)}/${reportFile}` : null,
    progress: {
      evaluatedConfigurations: new Set(searchHistory.map((row: any) => `${row.replica}:${row.configurationId}`)).size || new Set(repeatedSearch.flatMap((row: any) => (row.evaluatedConfigurations || []).map((configurationId: string) => `${row.replica}:${configurationId}`))).size,
      repeatedSearchRuns: repeatedSearch.length,
      confirmationRuns: confirmation.length,
      frozenCandidateSets: ["shop", "saas", "support"].filter((replica) => existsSync(path.join(dir, `candidate-set-${replica}.json`))).length,
      certificateStatus: frequency(readJsonl(path.join(dir, "certificates.jsonl")).map((row: any) => row.status))
    },
    exportLinks: searchCertificationExportTargets(dir).map((target) => ({
      file: target.key,
      label: target.label,
      url: `/api/v1/experiments/${runId}/exports/${encodeURIComponent(target.key)}`
    }))
  };
}

function readFullConfirmationEvidence(runId: string, dir: string) {
  if (!existsSync(dir)) return null;
  const observations = readJsonl(path.join(dir, "confirmation-observations.jsonl"));
  return {
    status: readJson(path.join(dir, "status.json")),
    summary: readCsvObjects(path.join(dir, "confirmation-summary.csv")).slice(0, 50),
    candidateBounds: readCsvObjects(path.join(dir, "candidate-bounds.csv")).slice(0, 50),
    safetyStreams: readCsvObjects(path.join(dir, "safety-stream-summary.csv")).slice(0, 50),
    objectiveBounds: readCsvObjects(path.join(dir, "objective-bound-summary.csv")).slice(0, 50),
    stoppingGaps: readCsvObjects(path.join(dir, "stopping-gap-history.csv")).slice(0, 50),
    seedUsage: readCsvObjects(path.join(dir, "seed-usage.csv")).slice(0, 50),
    runIndex: readCsvObjects(path.join(dir, "confirmation-run-index.csv")).slice(0, 50),
    runtimeFailures: readCsvObjects(path.join(dir, "runtime-failures.csv")).slice(0, 50),
    certificates: readJsonl(path.join(dir, "certificates.jsonl")),
    observations: observations.slice(0, 50),
    progress: {
      confirmationRuns: observations.length,
      byReplica: frequency(observations.map((row: any) => row.replica))
    },
    evidenceBundles: ["shop", "saas", "support"].map((replica) => ({
      replica,
      path: `experiments/results/search-certification-pilot-v2/full-confirmation/evidence-bundle-${replica}`
    })),
    exportLinks: searchCertificationFullExportTargets(dir).map((target) => ({
      file: target.key,
      label: target.label,
      url: `/api/v1/experiments/${runId}/exports/${encodeURIComponent(target.key)}`
    }))
  };
}

function repairExportTargets(dir: string) {
  return [
    "runtime-validation.csv",
    "runtime-paired-replay.jsonl",
    "runtime-paired-summary.csv",
    "runtime-regression.jsonl",
    "runtime-regression-summary.csv",
    "runtime-rollback.csv",
    "runtime-resource-usage.csv",
    "runtime-unresolved-cases.csv",
    "runtime-repair-report.md",
    "runtime-kpis.json"
  ]
    .map((file) => ({
      key: `repair-runtime:${file}`,
      label: `repair runtime ${file}`,
      absolutePath: path.join(dir, file)
    }))
    .filter((target) => existsSync(target.absolutePath));
}

function searchCertificationFullExportTargets(dir: string) {
  return [
    "manifest.snapshot.yaml",
    "candidate-set-audit.json",
    "confirmation-observations.jsonl",
    "confirmation-run-index.csv",
    "confidence-sequence-history.jsonl",
    "candidate-bounds.csv",
    "safety-stream-summary.csv",
    "objective-bound-summary.csv",
    "stopping-gap-history.csv",
    "seed-usage.csv",
    "runtime-failures.csv",
    "confirmation-summary.csv",
    "certificates.jsonl",
    "full-confirmation-report.md",
    "evidence-bundle-shop/candidate-set.json",
    "evidence-bundle-shop/confirmation-observations.jsonl",
    "evidence-bundle-shop/candidate-bounds.csv",
    "evidence-bundle-shop/certificate.json",
    "evidence-bundle-saas/candidate-set.json",
    "evidence-bundle-saas/confirmation-observations.jsonl",
    "evidence-bundle-saas/candidate-bounds.csv",
    "evidence-bundle-saas/certificate.json",
    "evidence-bundle-support/candidate-set.json",
    "evidence-bundle-support/confirmation-observations.jsonl",
    "evidence-bundle-support/candidate-bounds.csv",
    "evidence-bundle-support/certificate.json"
  ]
    .map((file) => ({
      key: `search-certification-v2-full:${file}`,
      label: `search certification v2 full ${file}`,
      absolutePath: path.join(dir, file)
    }))
    .filter((target) => existsSync(target.absolutePath));
}

function searchCertificationExportTargets(dir: string) {
  const version = dir.endsWith("search-certification-pilot-v2") ? "search-certification-v2" : "search-certification";
  const files = dir.endsWith("search-certification-pilot-v2")
    ? [
        "manifest.snapshot.yaml",
        "objective-audit.csv",
        "candidate-set-audit.json",
        "candidate-recall-audit.csv",
        "repeated-search-results.jsonl",
        "search-strategy-comparison.csv",
        "budget-sensitivity.csv",
        "candidate-recall.csv",
        "regret-summary.csv",
        "confirmation-budget-plan.json",
        "confirmation-observations.jsonl",
        "confidence-sequence-history.jsonl",
        "certificates.jsonl",
        "search-certification-v2-report.md"
      ]
    : [
    "configuration-space.csv",
    "oracle-results.jsonl",
    "oracle-summary.csv",
    "search-history.jsonl",
    "search-summary.csv",
    "candidate-set-shop.json",
    "candidate-set-saas.json",
    "candidate-set-support.json",
    "confirmation-observations.jsonl",
    "confidence-sequence-history.jsonl",
    "confirmation-summary.csv",
    "certificates.jsonl",
    "candidate-recall.csv",
    "regret-summary.csv",
    "safety-summary.csv",
    "abstention-summary.csv",
    "search-certification-report.md"
  ];
  return files
    .map((file) => ({
      key: `${version}:${file}`,
      label: `${version.replaceAll("-", " ")} ${file}`,
      absolutePath: path.join(dir, file)
    }))
    .filter((target) => existsSync(target.absolutePath));
}

function frequency(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function readJson(file: string) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

function readJsonl(file: string) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readCsvObjects(file: string) {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const headers = lines[0]?.split(",") || [];
  return lines.slice(1).map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index] || `column_${index}`, value])));
}

function resolveRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "experiments/configs/pilot-study-v2.yaml")) && existsSync(path.join(current, "repair/package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

export default router;
