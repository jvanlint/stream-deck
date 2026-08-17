import { describe, expect, it } from "vitest";
import { hueSaturationToHex, selectCycleColor, settingsForObservedColor } from "../src/actions/color-cycle.js";

describe("Color Cycle color selection", () => {
  const colors = ["#00ff00", "#ff0000", "#0000ff"];

  it("restores the last color without advancing when the bulb is off", () => {
    expect(selectCycleColor({ currentColor: "#ff0000", nextColorIndex: 2 }, colors, true)).toEqual({
      color: "#ff0000",
      nextColorIndex: 2
    });
  });

  it("advances on the next press after the bulb has been restored", () => {
    expect(selectCycleColor({ currentColor: "#ff0000", nextColorIndex: 2 }, colors, false)).toEqual({
      color: "#0000ff",
      nextColorIndex: 0
    });
  });

  it("synchronizes the current and next colors from an observed bulb state", () => {
    expect(settingsForObservedColor({ currentColor: "#00ff00", nextColorIndex: 1 }, colors, "#ff0000")).toMatchObject({
      currentColor: "#ff0000",
      nextColorIndex: 2
    });
  });

  it.each([
    [0, "#ff0000"],
    [120, "#00ff00"],
    [240, "#0000ff"],
    [300, "#ff00ff"]
  ])("converts hue %i to %s", (hue, color) => {
    expect(hueSaturationToHex(hue, 100)).toBe(color);
  });
});
