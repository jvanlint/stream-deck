import { describe, expect, it, vi } from "vitest";
import type { NanoleafClientFactory } from "../src/nanoleaf/client.js";
import { applyScene, toggleScene } from "../src/nanoleaf/scene.js";

describe("scene execution", () => {
  it("updates all bulbs concurrently with individual programs", async () => {
    const resolvers: Array<() => void> = [];
    const updateState = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    const clients = { async forDevice() { return { getState: vi.fn(), updateState }; } } as NanoleafClientFactory;
    const pending = applyScene([
      { deviceId: "left", power: true, brightness: 35, mode: "hs", hue: 0, sat: 100 },
      { deviceId: "right", power: true, brightness: 60, mode: "ct", ct: 4500 }
    ], clients);

    await vi.waitFor(() => expect(updateState).toHaveBeenCalledTimes(2));
    expect(updateState).toHaveBeenNthCalledWith(1, { on: { value: true }, brightness: { value: 35 }, hue: { value: 0 }, sat: { value: 100 } });
    expect(updateState).toHaveBeenNthCalledWith(2, { on: { value: true }, brightness: { value: 60 }, ct: { value: 4500 } });
    resolvers.forEach((resolve) => resolve());
    await expect(pending).resolves.toEqual({ succeeded: ["left", "right"], failed: [] });
  });

  it("reports a partial failure without hiding successful updates", async () => {
    const clients = {
      async forDevice(id: string) {
        return { getState: vi.fn(), updateState: id === "bad" ? vi.fn().mockRejectedValue(new Error("offline")) : vi.fn() };
      }
    } as NanoleafClientFactory;
    const result = await applyScene([
      { deviceId: "good", power: true },
      { deviceId: "bad", power: false }
    ], clients);
    expect(result.succeeded).toEqual(["good"]);
    expect(result.failed).toMatchObject([{ deviceId: "bad" }]);
  });

  it("turns every target off when every member already matches the configured scene", async () => {
    const updates: Record<string, ReturnType<typeof vi.fn>> = {};
    const clients = {
      async forDevice(id: string) {
        updates[id] = vi.fn();
        return {
          getState: async () => id === "left"
            ? { on: { value: true }, colorMode: "hs", hue: { value: 0 }, sat: { value: 100 } }
            : { on: { value: true }, colorMode: "ct", ct: { value: 4000 } },
          updateState: updates[id]
        };
      }
    } as unknown as NanoleafClientFactory;
    const result = await toggleScene([
      { deviceId: "left", power: true, mode: "hs", hue: 0, sat: 100 },
      { deviceId: "right", power: true, mode: "ct", ct: 4000 }
    ], clients);
    expect(result.mode).toBe("off");
    expect(updates.left).toHaveBeenCalledWith({ on: { value: false } });
    expect(updates.right).toHaveBeenCalledWith({ on: { value: false } });
  });

  it("turns off when the bulb echoes back values a shade off from what was requested", async () => {
    const updateState = vi.fn();
    const clients = {
      async forDevice() {
        return {
          getState: async () => ({
            on: { value: true },
            brightness: { value: 99 },
            colorMode: "hs",
            hue: { value: 1 },
            sat: { value: 99 }
          }),
          updateState
        };
      }
    } as unknown as NanoleafClientFactory;

    const result = await toggleScene([
      { deviceId: "bulb", power: true, brightness: 100, mode: "hs", hue: 0, sat: 100 }
    ], clients);

    expect(result.mode).toBe("off");
    expect(updateState).toHaveBeenCalledWith({ on: { value: false } });
  });

  it("changes an on bulb immediately when the pressed button has a different colour", async () => {
    const updateState = vi.fn();
    const clients = {
      async forDevice() {
        return {
          getState: async () => ({
            on: { value: true },
            brightness: { value: 100 },
            colorMode: "hs",
            hue: { value: 0 },
            sat: { value: 100 }
          }),
          updateState
        };
      }
    } as unknown as NanoleafClientFactory;

    const result = await toggleScene([
      { deviceId: "bulb", power: true, brightness: 100, mode: "hs", hue: 120, sat: 100 }
    ], clients);

    expect(result.mode).toBe("on");
    expect(updateState).toHaveBeenCalledWith({
      on: { value: true },
      brightness: { value: 100 },
      hue: { value: 120 },
      sat: { value: 100 }
    });
  });

  it("applies configured settings when every target is off", async () => {
    const updateState = vi.fn();
    const clients = {
      async forDevice() { return { getState: async () => ({ on: { value: false } }), updateState }; }
    } as unknown as NanoleafClientFactory;
    const result = await toggleScene([
      { deviceId: "left", power: false, brightness: 100, mode: "hs", hue: 0, sat: 100 }
    ], clients);
    expect(result.mode).toBe("on");
    expect(updateState).toHaveBeenCalledWith({ on: { value: true }, brightness: { value: 100 }, hue: { value: 0 }, sat: { value: 100 } });
  });
});
