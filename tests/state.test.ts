import { describe, expect, it } from "vitest";
import { colourTemperatureToHex, toUpdatePayload } from "../src/nanoleaf/state.js";

describe("toUpdatePayload", () => {
  it("creates an HS update and clamps API ranges", () => {
    expect(toUpdatePayload({ deviceId: "bulb-1", power: true, brightness: 101, mode: "hs", hue: -1, sat: 50 })).toEqual({
      on: { value: true }, brightness: { value: 100 }, hue: { value: 0 }, sat: { value: 50 }
    });
  });

  it("does not mix HS fields into a colour-temperature update", () => {
    expect(toUpdatePayload({ deviceId: "bulb-2", power: true, mode: "ct", ct: 4500 }))
      .toEqual({ on: { value: true }, ct: { value: 4500 } });
  });

  it("sends only power-off so colour fields cannot reactivate the bulb", () => {
    expect(toUpdatePayload({ deviceId: "bulb-3", power: false, brightness: 80, mode: "hs", hue: 240, sat: 100 }))
      .toEqual({ on: { value: false } });
  });
});

describe("colourTemperatureToHex", () => {
  it("renders 4000 K as warm white rather than the plugin accent green", () => {
    expect(colourTemperatureToHex(4000)).toBe("#ffcea6");
  });

  it("renders cooler temperatures with a bluer tint", () => {
    expect(colourTemperatureToHex(6500)).toBe("#fffefa");
  });
});
