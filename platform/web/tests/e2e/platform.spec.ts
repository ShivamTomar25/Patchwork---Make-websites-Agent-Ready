import { expect, test } from "@playwright/test";

test("public navigation and mobile menu work", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Test. Repair. Verify agent-facing software." })).toBeVisible();
  if (isMobile) {
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  }
  await page.getByRole("link", { name: "Platform" }).click();
  await expect(page.getByRole("heading", { name: "Central platform" })).toBeVisible();
  if (isMobile) await page.goto("/research");
  else await page.getByRole("link", { name: "Research" }).click();
  await expect(page.getByRole("heading", { name: "Research framing" })).toBeVisible();
  if (isMobile) await page.goto("/pricing");
  else await page.getByRole("link", { name: "Pricing" }).click();
  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
});

test("signup, project, journey, experiment and logout flow works", async ({ page, isMobile }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E Owner");
  await page.getByLabel("Work email").fill(`e2e-${suffix}@platform-test.local`);
  await page.getByLabel("Organization").fill(`E2E Org ${suffix}`);
  await page.getByLabel("Password").fill("Patchwork123!");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  if (isMobile) await page.getByRole("button").first().click();
  await page.goto("/app/projects/new");
  await page.getByLabel("Project name").fill(`E2E Project ${suffix}`);
  await page.getByLabel("Mode").selectOption("repair");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: `E2E Project ${suffix}` })).toBeVisible();
  const projectId = page.url().split("/").pop();

  await page.goto(`/app/projects/${projectId}/journeys/new`);
  await page.getByLabel("Name").fill("E2E login journey");
  await page.getByLabel("Instruction").fill("Create an account and verify the dashboard is visible.");
  await page.getByLabel("Start checkpoint").fill("/signup");
  await page.getByLabel("Success predicates").fill("Dashboard is visible");
  await page.getByLabel("Safety invariants").fill("No token is shown");
  await page.getByRole("button", { name: "Save journey" }).click();
  await expect(page.getByRole("heading", { name: "E2E login journey" })).toBeVisible();

  await page.goto(`/app/projects/${projectId}/experiments/new`);
  await page.getByLabel("Name").fill("E2E mock result");
  await page.getByLabel("Journey").selectOption({ label: "E2E login journey" });
  await page.getByLabel("Agent").selectOption({ label: "Scripted baseline" });
  await page.getByRole("button", { name: "Start mock run" }).click();
  await expect(page.getByRole("heading", { name: "E2E mock result" })).toBeVisible();
  await expect(page.getByText("Status timeline")).toBeVisible();

  await page.goto(`${page.url()}/trajectories`);
  await expect(page.getByText("Step timeline")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Step timeline")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

test("demo login reaches dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("PATCHWORK Research Lab")).toBeVisible();
});
