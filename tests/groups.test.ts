import { describe, expect, it } from "vitest";
import { validateGroupName } from "../src/nanoleaf/groups.js";

describe("group names", () => {
  it("trims and normalizes whitespace", () => {
    expect(validateGroupName("  Office   Lights  ")).toBe("Office Lights");
  });

  it("rejects empty and excessively long names", () => {
    expect(() => validateGroupName("   ")).toThrow("Group name is required");
    expect(() => validateGroupName("x".repeat(41))).toThrow("40 characters or fewer");
  });
});
