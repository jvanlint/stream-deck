import type { LightProgram } from "../models.js";

export type NanoleafUpdate = Record<string, { value: boolean | number }>;

/** Approximate a Kelvin colour temperature as an sRGB icon colour. */
export function colourTemperatureToHex(kelvin: number): string {
  const temperature = clamp(kelvin, 1_000, 40_000) / 100;
  const red = temperature <= 66
    ? 255
    : 329.698727446 * ((temperature - 60) ** -0.1332047592);
  const green = temperature <= 66
    ? 99.4708025861 * Math.log(temperature) - 161.1195681661
    : 288.1221695283 * ((temperature - 60) ** -0.0755148492);
  const blue = temperature >= 66
    ? 255
    : temperature <= 19
      ? 0
      : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  return `#${[red, green, blue]
    .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Convert an action program to the payload accepted by the local HTTP API. */
export function toUpdatePayload(program: LightProgram): NanoleafUpdate {
  const update: NanoleafUpdate = { on: { value: program.power } };
  if (!program.power) return update;
  if (program.brightness !== undefined) {
    update.brightness = { value: clamp(program.brightness, 1, 100) };
  }
  if (program.mode === "hs") {
    update.hue = { value: clamp(program.hue, 0, 360) };
    update.sat = { value: clamp(program.sat, 0, 100) };
  } else if (program.mode === "ct") {
    update.ct = { value: program.ct };
  }
  return update;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
