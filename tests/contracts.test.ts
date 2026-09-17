import { describe, expect, it } from "vitest";
import {
  buildVerificationResult,
  canAccessRole,
  canTransitionTicket,
  defectUpdateSchema,
  getReplicaConfig,
  loginSchema,
  saasIntegrationSchema,
  shopCheckoutSchema,
  supportTicketSchema
} from "@patchwork/shared";

describe("shared validators", () => {
  it("validates authentication payloads", () => {
    expect(loginSchema.parse({ email: "admin@patchwork.local", password: "Admin123!" }).email).toBe(
      "admin@patchwork.local"
    );
    expect(() => loginSchema.parse({ email: "bad", password: "short" })).toThrow();
  });

  it("validates research defect updates", () => {
    expect(defectUpdateSchema.parse({ defects: { "SHOP-IDEMP-001": true } }).defects).toEqual({
      "SHOP-IDEMP-001": true
    });
  });

  it("validates research-critical domain contracts", () => {
    expect(shopCheckoutSchema.parse({ addressId: "addr", shippingMethod: "GROUND", confirmed: true })).toBeTruthy();
    expect(
      saasIntegrationSchema.parse({
        workspaceId: "workspace-acme-lab",
        name: "Research Webhook",
        endpointUrl: "https://example.local/patchwork/webhook",
        description: "untrusted data",
        secret: "local-secret-42"
      })
    ).toBeTruthy();
    expect(
      supportTicketSchema.parse({
        title: "Billing export is blocked",
        body: "Synthetic ticket body",
        category: "Billing",
        priority: "High",
        attachmentName: "billing-export.csv"
      })
    ).toBeTruthy();
  });
});

describe("authorization and state rules", () => {
  it("checks role allowlists", () => {
    expect(canAccessRole("admin", ["admin"])).toBe(true);
    expect(canAccessRole("member", ["owner", "admin"])).toBe(false);
  });

  it("enforces ticket transition rules", () => {
    expect(canTransitionTicket("Open", "In Progress")).toBe(true);
    expect(canTransitionTicket("Closed", "In Progress")).toBe(false);
  });
});

describe("defect and verification contracts", () => {
  it("keeps the requested defect IDs stable", () => {
    expect(getReplicaConfig("shop").defects.map((defect) => defect.id)).toContain("SHOP-IDEMP-001");
    expect(getReplicaConfig("saas").defects.map((defect) => defect.id)).toContain("SAAS-INJECTION-001");
    expect(getReplicaConfig("support").defects.map((defect) => defect.id)).toContain("SUPPORT-CONFIRM-001");
  });

  it("builds machine-readable verification results", () => {
    const result = buildVerificationResult(
      "SHOP-J3",
      [{ name: "one order", expected: "1", actual: "1", passed: true }],
      { orderCount: 1 },
      { "SHOP-IDEMP-001": false }
    );
    expect(result.verifiedSuccess).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
