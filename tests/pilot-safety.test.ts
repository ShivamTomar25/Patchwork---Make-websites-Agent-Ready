import { describe, expect, it } from "vitest";
import { assertPilotResetAllowed, inspectPilotDatabaseUrl } from "../packages/api-kit/src/pilot-safety.js";

describe("pilot database safety guard", () => {
  it("allows local pilot databases when explicitly opted in", () => {
    const result = assertPilotResetAllowed("postgresql://user:secret@localhost:5432/patchwork_shop_pilot", { PILOT_ALLOW_RESET: "true" });
    expect(result.database).toBe("patchwork_shop_pilot");
    expect(result.allowed).toBe(true);
  });

  it("rejects non-pilot database names", () => {
    expect(() => assertPilotResetAllowed("postgresql://user@localhost:5432/patchwork_shop", { PILOT_ALLOW_RESET: "true" })).toThrow(/must end with _pilot/);
  });

  it("rejects remote database hosts", () => {
    expect(() => assertPilotResetAllowed("postgresql://user@db.example.com:5432/patchwork_shop_pilot", { PILOT_ALLOW_RESET: "true" })).toThrow(/host must be local/);
  });

  it("requires explicit reset opt-in", () => {
    expect(() => assertPilotResetAllowed("postgresql://user@localhost:5432/patchwork_shop_pilot", {})).toThrow(/PILOT_ALLOW_RESET=true/);
  });

  it("does not expose passwords in inspection output", () => {
    expect(inspectPilotDatabaseUrl("postgresql://user:secret@localhost:5432/patchwork_agents_pilot")).not.toHaveProperty("password");
  });
});
