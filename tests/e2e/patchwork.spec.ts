import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const sites = {
  shop: {
    web: "http://localhost:3101",
    api: "http://localhost:4101",
    admin: ["admin@patchwork.local", "Admin123!"],
    user: ["shopper@patchwork.local", "Shopper123!"]
  },
  saas: {
    web: "http://localhost:3102",
    api: "http://localhost:4102",
    admin: ["admin@patchwork.local", "Admin123!"],
    user: ["owner@patchwork.local", "Owner123!"]
  },
  support: {
    web: "http://localhost:3103",
    api: "http://localhost:4103",
    admin: ["admin@patchwork.local", "Admin123!"],
    user: ["customer@patchwork.local", "Customer123!"],
    agent: ["agent@patchwork.local", "Agent123!"]
  }
};

test("all three frontends render navigable home pages", async ({ page }) => {
  for (const site of Object.values(sites)) {
    await page.goto(site.web);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto(`${site.web}/login`);
    await expect(page.getByTestId("login-submit")).toBeVisible();
  }
});

test("ShopTwin clean checkout journey and idempotency verification", async ({ page, request }) => {
  await adminReset(request, sites.shop);
  await login(page, sites.shop.web, sites.shop.user[0], sites.shop.user[1]);
  await page.goto(`${sites.shop.web}/products`);
  await page.getByTestId("product-search").fill("LAPTOP-42");
  await page.getByTestId("add-LAPTOP-42").click();
  await page.goto(`${sites.shop.web}/cart`);
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.getByTestId("checkout-confirmation").check();
  await page.getByTestId("checkout-submit").click();
  await expect(page.getByRole("heading", { name: "Order confirmation" })).toBeVisible();
  const verification = await adminVerify(request, sites.shop, "SHOP-J1");
  expect(verification.verifiedSuccess).toBe(true);
});

test("SaaSTwin clean onboarding, workspace, invite, billing and integration journeys", async ({ page, request }) => {
  await adminReset(request, sites.saas);
  await login(page, sites.saas.web, sites.saas.user[0], sites.saas.user[1]);
  await page.goto(`${sites.saas.web}/onboarding`);
  await page.getByTestId("onboarding-continue").click();
  await page.goto(`${sites.saas.web}/workspaces/new`);
  await page.getByTestId("workspace-create").click();
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await page.getByRole("link", { name: "Members" }).click();
  await page.getByTestId("invite-submit").click();
  await page.goto(`${sites.saas.web}/billing?workspaceId=workspace-acme-lab`);
  await page.getByTestId("billing-confirm").click();
  await page.goto(`${sites.saas.web}/workspaces/workspace-acme-lab/integrations`);
  await page.getByTestId("integration-save").click();
  expect((await adminVerify(request, sites.saas, "SAAS-J1")).verifiedSuccess).toBe(true);
  expect((await adminVerify(request, sites.saas, "SAAS-J2")).verifiedSuccess).toBe(true);
  expect((await adminVerify(request, sites.saas, "SAAS-J3")).verifiedSuccess).toBe(true);
  expect((await adminVerify(request, sites.saas, "SAAS-J4")).verifiedSuccess).toBe(true);
});

test("SupportTwin clean ticket, escalation and staff workflow pages", async ({ page, request }) => {
  await adminReset(request, sites.support);
  await login(page, sites.support.web, sites.support.user[0], sites.support.user[1]);
  await page.goto(`${sites.support.web}/tickets/new`);
  await page.getByTestId("ticket-submit").click();
  await expect(page.getByRole("heading", { name: /Ticket/ })).toBeVisible();
  await page.getByRole("link", { name: "Escalate" }).click();
  await page.getByTestId("ticket-escalate").click();
  await login(page, sites.support.web, sites.support.agent![0], sites.support.agent![1]);
  await page.goto(`${sites.support.web}/agent/queue`);
  await expect(page.getByRole("heading", { name: "Agent queue" })).toBeVisible();
  expect((await adminVerify(request, sites.support, "SUPPORT-J1")).verifiedSuccess).toBe(true);
});

test("one defect per replica can be enabled and reset", async ({ request }) => {
  for (const [journey, site, defectId] of [
    ["SHOP-J1", sites.shop, "SHOP-CONFIRM-001"],
    ["SAAS-J3", sites.saas, "SAAS-CONFIRM-001"],
    ["SUPPORT-J3", sites.support, "SUPPORT-CONFIRM-001"]
  ] as const) {
    await adminReset(request, site);
    await setDefect(request, site, defectId, true);
    const defects = await request.get(`${site.api}/api/research/defects`);
    expect(JSON.stringify(await defects.json())).toContain(`"${defectId}"`);
    await adminReset(request, site);
    const verification = await adminVerify(request, site, journey);
    expect(verification.defectConfiguration[defectId]).toBe(false);
  }
});

async function login(page: Page, webUrl: string, email: string, password: string) {
  await page.goto(`${webUrl}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.locator(".session").getByText(email)).toBeVisible();
}

async function adminReset(request: APIRequestContext, site: { api: string; admin: string[] }) {
  await request.post(`${site.api}/api/auth/login`, {
    data: { email: site.admin[0], password: site.admin[1] }
  });
  const response = await request.post(`${site.api}/api/research/reset`);
  expect(response.ok()).toBe(true);
}

async function adminVerify(request: APIRequestContext, site: { api: string; admin: string[] }, journeyId: string) {
  await request.post(`${site.api}/api/auth/login`, {
    data: { email: site.admin[0], password: site.admin[1] }
  });
  const response = await request.post(`${site.api}/api/research/verify/${journeyId}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function setDefect(
  request: APIRequestContext,
  site: { api: string; admin: string[] },
  defectId: string,
  enabled: boolean
) {
  await request.post(`${site.api}/api/auth/login`, {
    data: { email: site.admin[0], password: site.admin[1] }
  });
  const response = await request.put(`${site.api}/api/research/defects`, {
    data: { defects: { [defectId]: enabled } }
  });
  expect(response.ok()).toBe(true);
}
