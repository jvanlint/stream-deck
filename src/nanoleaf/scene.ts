import type { LightProgram } from "../models.js";
import type { NanoleafClientFactory } from "./client.js";
import { toUpdatePayload } from "./state.js";

export interface SceneApplyResult {
  succeeded: string[];
  failed: Array<{ deviceId: string; error: unknown }>;
}

export interface SceneToggleResult extends SceneApplyResult {
  mode: "on" | "off";
}

/** Applies all light programs concurrently and reports partial failures. */
export async function applyScene(programs: LightProgram[], clients: NanoleafClientFactory): Promise<SceneApplyResult> {
  const results = await Promise.allSettled(programs.map(async (program) => {
    const client = await clients.forDevice(program.deviceId);
    await client.updateState(toUpdatePayload(program));
    return program.deviceId;
  }));
  const succeeded: string[] = [];
  const failed: SceneApplyResult["failed"] = [];
  results.forEach((result, index) => {
    const deviceId = programs[index]?.deviceId ?? "unknown";
    if (result.status === "fulfilled") succeeded.push(result.value);
    else failed.push({ deviceId, error: result.reason });
  });
  return { succeeded, failed };
}

/** Reads current state, then turns all targets off if any are on; otherwise applies the configured scene. */
export async function toggleScene(programs: LightProgram[], clients: NanoleafClientFactory): Promise<SceneToggleResult> {
  const resolved = await Promise.allSettled(programs.map(async (program) => ({
    program,
    client: await clients.forDevice(program.deviceId)
  })));
  const resolveFailures = resolved.flatMap((result, index) => result.status === "rejected"
    ? [{ deviceId: programs[index]?.deviceId ?? "unknown", error: result.reason }]
    : []);
  if (resolveFailures.length > 0) return { mode: "off", succeeded: [], failed: resolveFailures };

  const entries = resolved.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const states = await Promise.allSettled(entries.map(({ client }) => client.getState()));
  const stateFailures = states.flatMap((result, index) => result.status === "rejected"
    ? [{ deviceId: entries[index]?.program.deviceId ?? "unknown", error: result.reason }]
    : []);
  if (stateFailures.length > 0) return { mode: "off", succeeded: [], failed: stateFailures };

  const turnOff = states.some((result) => result.status === "fulfilled" && result.value.on.value);
  const updates = await Promise.allSettled(entries.map(({ program, client }) => client.updateState(
    turnOff ? { on: { value: false } } : toUpdatePayload({ ...program, power: true } as LightProgram)
  )));
  const succeeded: string[] = [];
  const failed: SceneApplyResult["failed"] = [];
  updates.forEach((result, index) => {
    const deviceId = entries[index]?.program.deviceId ?? "unknown";
    if (result.status === "fulfilled") succeeded.push(deviceId);
    else failed.push({ deviceId, error: result.reason });
  });
  return { mode: turnOff ? "off" : "on", succeeded, failed };
}
