import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { hashPassword } from "../auth/auth.js";
import { InternalAgentHarnessClient } from "../engine/experiment-engine.js";
import { prisma } from "../lib/prisma.js";

let baseUrl = "";
let server: any;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.user.deleteMany({ where: { email: { contains: "@platform-test.local" } } });
  await prisma.$disconnect();
});

describe("platform API auth and organization flows", () => {
  it("signs up, refreshes, logs out and enforces unique email", async () => {
    const jar = new CookieJar();
    const email = uniqueEmail("owner");
    const signup = await jar.fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      body: { email, name: "Test Owner", password: "Patchwork123!", organizationName: "Test Org" }
    });
    expect(signup.status).toBe(201);
    expect(signup.body.data.user.email).toBe(email);

    const duplicate = await jar.fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      body: { email, name: "Test Owner", password: "Patchwork123!", organizationName: "Test Org" }
    });
    expect(duplicate.status).toBe(409);

    const refresh = await jar.fetch(`${baseUrl}/auth/refresh`, { method: "POST" });
    expect(refresh.status).toBe(200);

    const me = await jar.fetch(`${baseUrl}/auth/me`);
    expect(me.status).toBe(200);
    expect(me.body.data.membership.role).toBe("owner");

    const logout = await jar.fetch(`${baseUrl}/auth/logout`, { method: "POST" });
    expect(logout.status).toBe(200);

    const afterLogout = await jar.fetch(`${baseUrl}/auth/me`);
    expect(afterLogout.status).toBe(401);
  });

  it("supports generic password reset without leaking tokens in responses", async () => {
    const jar = new CookieJar();
    const email = uniqueEmail("reset");
    await jar.fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      body: { email, name: "Reset Owner", password: "Patchwork123!", organizationName: "Reset Org" }
    });
    const forgot = await jar.fetch(`${baseUrl}/auth/forgot-password`, { method: "POST", body: { email } });
    expect(forgot.status).toBe(200);
    expect(JSON.stringify(forgot.body)).not.toContain("token");
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = await prisma.emailToken.findFirstOrThrow({ where: { userId: user.id, type: "password_reset", usedAt: null } });
    const rawToken = await readRawTokenFromOutbox(email);
    expect(token.tokenHash).not.toBe(rawToken);
    const reset = await jar.fetch(`${baseUrl}/auth/reset-password`, { method: "POST", body: { token: rawToken, password: "NewPatchwork123!" } });
    expect(reset.status).toBe(200);
    const login = await jar.fetch(`${baseUrl}/auth/login`, { method: "POST", body: { email, password: "NewPatchwork123!" } });
    expect(login.status).toBe(200);
  });

  it("enforces organization isolation and role authorization", async () => {
    const owner = new CookieJar();
    const ownerEmail = uniqueEmail("isolation-owner");
    await owner.fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      body: { email: ownerEmail, name: "Isolation Owner", password: "Patchwork123!", organizationName: "Isolation A" }
    });
    const project = await owner.fetch(`${baseUrl}/projects`, {
      method: "POST",
      body: { name: "Private Project", mode: "scan", repositoryStatus: "connected" }
    });
    expect(project.status).toBe(201);

    const other = new CookieJar();
    await other.fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      body: { email: uniqueEmail("isolation-other"), name: "Other Owner", password: "Patchwork123!", organizationName: "Isolation B" }
    });
    const blocked = await other.fetch(`${baseUrl}/projects/${project.body.data.project.id}`);
    expect(blocked.status).toBe(404);

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId: ownerUser.id }, include: { organization: true } });
    const viewer = await prisma.user.create({
      data: { email: uniqueEmail("viewer"), name: "Viewer", passwordHash: await hashPassword("Patchwork123!") }
    });
    await prisma.membership.create({ data: { userId: viewer.id, organizationId: membership.organizationId, role: "viewer" } });
    const viewerJar = new CookieJar();
    await viewerJar.fetch(`${baseUrl}/auth/login`, { method: "POST", body: { email: viewer.email, password: "Patchwork123!" } });
    const forbidden = await viewerJar.fetch(`${baseUrl}/projects`, {
      method: "POST",
      body: { name: "Viewer Project", mode: "scan" }
    });
    expect(forbidden.status).toBe(403);
  });

  it("creates project resources and starts a mock experiment", async () => {
    const jar = new CookieJar();
    await jar.fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      body: { email: uniqueEmail("experiment"), name: "Experiment Owner", password: "Patchwork123!", organizationName: "Experiment Org" }
    });
    const project = await jar.fetch(`${baseUrl}/projects`, { method: "POST", body: { name: "Agent Scan", mode: "repair" } });
    expect(project.status).toBe(201);
    const projectId = project.body.data.project.id;

    const environment = await jar.fetch(`${baseUrl}/projects/${projectId}/environments`, {
      method: "POST",
      body: { name: "Local", url: "http://localhost:3200", apiUrl: "http://localhost:4200", type: "local", resetCapable: true }
    });
    expect(environment.status).toBe(201);

    const journey = await jar.fetch(`${baseUrl}/projects/${projectId}/journeys`, {
      method: "POST",
      body: {
        name: "Create account",
        instruction: "Sign up and reach the authenticated dashboard.",
        startCheckpoint: "/signup",
        successPredicates: ["Dashboard is visible."],
        safetyInvariants: ["No secrets are shown."]
      }
    });
    expect(journey.status).toBe(201);

    const agent = await jar.fetch(`${baseUrl}/projects/${projectId}/agent-configurations`, {
      method: "POST",
      body: { name: "Accessibility A", kind: "accessibility_a", provider: "mock", model: "mock-a", settings: { observation: "aria" } }
    });
    expect(agent.status).toBe(201);

    const experiment = await jar.fetch(`${baseUrl}/experiments`, {
      method: "POST",
      body: {
        projectId,
        name: "Mock certification",
        journeyIds: [journey.body.data.journey.id],
        agentIds: [agent.body.data.agent.id],
        seeds: [1],
        defects: {},
        startMockRun: true
      }
    });
    expect(experiment.status).toBe(201);
    const run = await jar.fetch(`${baseUrl}/experiments/${experiment.body.data.runId}`);
    expect(run.status).toBe(200);
    expect(run.body.data.run.status).toBe("completed");
  });

  it("requires internal authorization for the platform-to-agent harness adapter", () => {
    const harness = new InternalAgentHarnessClient(process.cwd(), "platform-test-token");
    expect(() => harness.assertAuthorized("wrong-token")).toThrow(/AGENT_HARNESS_UNAUTHORIZED/);
    expect(() => harness.assertAuthorized("platform-test-token")).not.toThrow();
  });

  it("starts a dry-run real local pilot and polls status", async () => {
    process.env.PATCHWORK_REAL_ENGINE_DRY_RUN = "1";
    try {
      const jar = new CookieJar();
      await jar.fetch(`${baseUrl}/auth/signup`, {
        method: "POST",
        body: { email: uniqueEmail("real-engine"), name: "Real Owner", password: "Patchwork123!", organizationName: "Real Org" }
      });
      const project = await jar.fetch(`${baseUrl}/projects`, { method: "POST", body: { name: "ShopTwin", mode: "repair" } });
      expect(project.status).toBe(201);
      const projectId = project.body.data.project.id;

      const journey = await jar.fetch(`${baseUrl}/projects/${projectId}/journeys`, {
        method: "POST",
        body: {
          name: "SHOP-J1 Checkout readiness",
          instruction: "Find a seeded product and complete checkout.",
          startCheckpoint: "/products",
          successPredicates: ["Order is created."],
          safetyInvariants: ["No secrets are shown."]
        }
      });
      const agent = await jar.fetch(`${baseUrl}/projects/${projectId}/agent-configurations`, {
        method: "POST",
        body: { name: "Scripted baseline", kind: "scripted", provider: "scripted", model: "none", settings: {} }
      });

      const experiment = await jar.fetch(`${baseUrl}/experiments`, {
        method: "POST",
        body: {
          projectId,
          name: "Real local pilot dry run",
          journeyIds: [journey.body.data.journey.id],
          agentIds: [agent.body.data.agent.id],
          seeds: [1],
          defects: {},
          executionMode: "real-local-pilot",
          startMockRun: true
        }
      });
      expect(experiment.status).toBe(201);

      let run = await jar.fetch(`${baseUrl}/experiments/${experiment.body.data.runId}`);
      for (let attempt = 0; attempt < 10 && run.body.data.run.status !== "completed"; attempt += 1) {
        await delay(20);
        run = await jar.fetch(`${baseUrl}/experiments/${experiment.body.data.runId}`);
      }
      expect(run.status).toBe(200);
      expect(run.body.data.run.engineMode).toBe("real-local-pilot");
      expect(run.body.data.run.externalExperimentId).toContain("pilot-study-v2-platform");
      expect(run.body.data.run.exportDirectory).toBe("experiments/results/pilot-study-v2/mock");
      expect(["running", "completed"]).toContain(run.body.data.run.status);
      expect(run.body.data.exportLinks.map((link: { file: string }) => link.file)).toContain("reset-summary.csv");
      const trajectory = await jar.fetch(`${baseUrl}/experiments/${experiment.body.data.runId}/trajectories`);
      expect(trajectory.status).toBe(200);
      const failures = await jar.fetch(`${baseUrl}/experiments/${experiment.body.data.runId}/failures`);
      expect(failures.status).toBe(200);

      const resume = await jar.fetch(`${baseUrl}/experiments/${experiment.body.data.runId}/resume`, { method: "POST" });
      expect(resume.status).toBe(200);
      run = await jar.fetch(`${baseUrl}/experiments/${experiment.body.data.runId}`);
      expect(run.body.data.events.some((event: { type: string }) => event.type === "resume_requested")).toBe(true);

      const cancellable = await jar.fetch(`${baseUrl}/experiments`, {
        method: "POST",
        body: {
          projectId,
          name: "Real local pilot dry run cancellation",
          journeyIds: [journey.body.data.journey.id],
          agentIds: [agent.body.data.agent.id],
          seeds: [1],
          defects: {},
          executionMode: "real-local-pilot",
          startMockRun: true
        }
      });
      expect(cancellable.status).toBe(201);
      const cancel = await jar.fetch(`${baseUrl}/experiments/${cancellable.body.data.runId}/cancel`, { method: "POST" });
      expect(cancel.status).toBe(200);
      const cancelled = await jar.fetch(`${baseUrl}/experiments/${cancellable.body.data.runId}`);
      expect(cancelled.body.data.run.status).toBe("cancelled");
    } finally {
      delete process.env.PATCHWORK_REAL_ENGINE_DRY_RUN;
    }
  });
});

class CookieJar {
  private cookies = new Map<string, string>();

  async fetch(url: string, init: { method?: string; body?: unknown } = {}) {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const cookie = [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(url, {
      method: init.method || "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
    for (const value of response.headers.getSetCookie?.() || parseSetCookie(response.headers.get("set-cookie"))) {
      const first = value.split(";")[0];
      const index = first.indexOf("=");
      if (index > 0) this.cookies.set(first.slice(0, index), first.slice(index + 1));
    }
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@platform-test.local`;
}

async function readRawTokenFromOutbox(email: string) {
  const message = await prisma.mailOutbox.findFirstOrThrow({ where: { toEmail: email }, orderBy: { createdAt: "desc" } });
  const match = message.body.match(/token=([a-f0-9]+)/);
  if (!match) throw new Error("Token was not found in development outbox.");
  return match[1];
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSetCookie(value: string | null): string[] {
  return value ? [value] : [];
}
