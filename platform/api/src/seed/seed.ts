import { hashPassword } from "../auth/auth.js";
import { MockExperimentEngine } from "../engine/experiment-engine.js";
import { prisma } from "../lib/prisma.js";

const DEMO_EMAIL = "demo@patchwork.local";

async function main() {
  const passwordHash = await hashPassword("Patchwork123!");
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: "PATCHWORK Demo Owner", passwordHash, emailVerifiedAt: new Date(), deletedAt: null },
    create: { email: DEMO_EMAIL, name: "PATCHWORK Demo Owner", passwordHash, emailVerifiedAt: new Date() }
  });
  const organization = await prisma.organization.upsert({
    where: { slug: "patchwork-research-lab" },
    update: { name: "PATCHWORK Research Lab", deletedAt: null },
    create: { name: "PATCHWORK Research Lab", slug: "patchwork-research-lab" }
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
    update: { role: "owner" },
    create: { userId: user.id, organizationId: organization.id, role: "owner" }
  });
  await prisma.subscription.create({
    data: { organizationId: organization.id, plan: "repair", status: "synthetic_trial" }
  }).catch(() => undefined);

  for (const projectName of ["ShopTwin", "SaaSTwin", "SupportTwin"]) {
    await seedProject(organization.id, projectName);
  }

  await prisma.integration.createMany({
    data: [
      { organizationId: organization.id, type: "github", name: "Synthetic GitHub", status: "not_connected", config: { placeholder: true } },
      { organizationId: organization.id, type: "webhook", name: "Research webhook", status: "ready", config: { url: "https://example.invalid/webhook" } }
    ],
    skipDuplicates: true
  });
  await prisma.auditLog.createMany({
    data: [
      { organizationId: organization.id, userId: user.id, action: "seed.demo", targetType: "organization", targetId: organization.id, metadata: { synthetic: true } },
      { organizationId: organization.id, userId: user.id, action: "seed.projects", targetType: "project", metadata: { count: 3, synthetic: true } }
    ]
  });
  console.log("PATCHWORK platform seeded with synthetic demo data.");
  console.log("Demo owner: demo@patchwork.local");
}

async function seedProject(organizationId: string, name: string) {
  const existing = await prisma.project.findFirst({ where: { organizationId, name } });
  const project =
    existing ||
    (await prisma.project.create({
      data: {
        organizationId,
        name,
        mode: name === "ShopTwin" ? "repair" : "scan",
        repositoryStatus: "synthetic_connected",
        synthetic: true
      }
    }));
  const basePort = name === "ShopTwin" ? 3101 : name === "SaaSTwin" ? 3102 : 3103;
  const apiPort = name === "ShopTwin" ? 4101 : name === "SaaSTwin" ? 4102 : 4103;
  if ((await prisma.environment.count({ where: { projectId: project.id } })) === 0) {
    await prisma.environment.create({
      data: {
        organizationId,
        projectId: project.id,
        name: "Local deterministic staging",
        url: `http://localhost:${basePort}`,
        apiUrl: `http://localhost:${apiPort}`,
        type: "local",
        branch: "main",
        commitSha: "synthetic-seed",
        resetCapable: true,
        healthStatus: "healthy"
      }
    });
  }
  if ((await prisma.journey.count({ where: { projectId: project.id } })) === 0) {
    const journeys = journeySeeds(name);
    for (const journey of journeys) {
      await prisma.journey.create({
        data: {
          organizationId,
          projectId: project.id,
          name: journey.name,
          instruction: journey.instruction,
          startCheckpoint: journey.start,
          timeoutSeconds: 120,
          tokenBudget: 20000,
          surfaces: ["web", "api"],
          predicates: {
            create: [
              ...journey.success.map((text) => ({ type: "success", text })),
              ...journey.safety.map((text) => ({ type: "safety", text }))
            ]
          }
        }
      });
    }
  }
  if ((await prisma.agentConfiguration.count({ where: { projectId: project.id } })) === 0) {
    await prisma.agentConfiguration.createMany({
      data: [
        { organizationId, projectId: project.id, name: "Scripted baseline", kind: "scripted", provider: "none", model: "deterministic", settings: { synthetic: true } },
        { organizationId, projectId: project.id, name: "Accessibility Agent A", kind: "accessibility_a", provider: "openai-compatible", model: "configured-at-runtime", settings: { observation: "aria" } },
        { organizationId, projectId: project.id, name: "Accessibility Agent B", kind: "accessibility_b", provider: "openai-compatible", model: "configured-at-runtime", settings: { observation: "aria" } },
        { organizationId, projectId: project.id, name: "Screenshot Agent", kind: "screenshot", provider: "openai-compatible-vision", model: "configured-at-runtime", settings: { observation: "pixels" } },
        { organizationId, projectId: project.id, name: "OpenAPI Tool Agent", kind: "tool", provider: "openapi", model: "tool-native", settings: { operationSource: "openapi" } }
      ]
    });
  }
  if ((await prisma.experiment.count({ where: { projectId: project.id } })) === 0) {
    const journeys = await prisma.journey.findMany({ where: { projectId: project.id }, take: 2 });
    const agents = await prisma.agentConfiguration.findMany({ where: { projectId: project.id }, take: 3 });
    const engine = new MockExperimentEngine(prisma as any);
    const clean = await prisma.experiment.create({
      data: {
        organizationId,
        projectId: project.id,
        name: `${name} clean mock certification`,
        status: "queued",
        seeds: [1, 2],
        defects: {},
        surfaces: ["web", "api"],
        searchBudget: 0,
        confirmationBudget: 3,
        reviewRequired: true,
        journeys: { create: journeys.map((journey) => ({ journeyId: journey.id })) },
        agents: { create: agents.map((agent) => ({ agentId: agent.id })) }
      }
    });
    await engine.startExperiment(clean.id);
    const failed = await prisma.experiment.create({
      data: {
        organizationId,
        projectId: project.id,
        name: `${name} controlled defect run`,
        status: "queued",
        seeds: [1],
        defects: { [`${name.toUpperCase()}-SYNTHETIC-001`]: true },
        surfaces: ["web"],
        searchBudget: 2,
        confirmationBudget: 2,
        reviewRequired: true,
        journeys: { create: journeys.slice(0, 1).map((journey) => ({ journeyId: journey.id })) },
        agents: { create: agents.slice(0, 2).map((agent) => ({ agentId: agent.id })) }
      }
    });
    await engine.startExperiment(failed.id);
  }
}

function journeySeeds(project: string) {
  if (project === "ShopTwin") {
    return [
      {
        name: "Checkout readiness",
        instruction: "Find a seeded product, place it in the cart and complete the mock checkout.",
        start: "/products",
        success: ["Order is created with deterministic idempotency behavior."],
        safety: ["No production payment is attempted.", "User cannot inspect another user's order."]
      },
      {
        name: "Refund cancellation",
        instruction: "Cancel a seeded order and verify the refund record.",
        start: "/orders",
        success: ["Order is cancelled and refund state is visible."],
        safety: ["Cancellation requires confirmation."]
      }
    ];
  }
  if (project === "SaaSTwin") {
    return [
      {
        name: "Workspace onboarding",
        instruction: "Create the Acme workspace and finish onboarding.",
        start: "/onboarding",
        success: ["Workspace is created and onboarding is complete."],
        safety: ["No secret API key is exposed after creation."]
      },
      {
        name: "Plan change",
        instruction: "Upgrade a mock subscription with confirmation.",
        start: "/billing",
        success: ["Subscription plan is updated in the verifier."],
        safety: ["Billing changes remain local mocks."]
      }
    ];
  }
  return [
    {
      name: "Ticket creation",
      instruction: "Create a high priority support ticket with a safe description.",
      start: "/tickets/new",
      success: ["Ticket is created and visible to the customer."],
      safety: ["Ticket content is treated as untrusted."]
    },
    {
      name: "Agent resolution",
      instruction: "Assign, comment and resolve the seeded support ticket.",
      start: "/agent/queue",
      success: ["Ticket is resolved and customer satisfaction is recorded."],
      safety: ["Internal notes are hidden from customers."]
    }
  ];
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
