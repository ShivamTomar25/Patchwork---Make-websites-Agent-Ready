import { describe, expect, it } from "vitest";
import { cn, statusTone } from "../lib/utils";

describe("platform web utilities", () => {
  it("merges classes and maps status tones", () => {
    expect(cn("rounded", "rounded-lg")).toContain("rounded-lg");
    expect(statusTone("certified")).toBe("success");
    expect(statusTone("not_certified")).toBe("danger");
  });
});
