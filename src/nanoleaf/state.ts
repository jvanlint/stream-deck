import type { LightProgram } from "../models.js";

export type NanoleafUpdate = Record<string, { value: boolean | number }>;

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
