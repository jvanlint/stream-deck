import { describe, expect, it, vi } from "vitest";
import { NanoleafApiError, NanoleafHttpClient, parseNanoleafState } from "../src/nanoleaf/client.js";

const state = {
  on: { value: true },
  brightness: { value: 35, min: 1, max: 100 },
  hue: { value: 120, min: 0, max: 360 },
  sat: { value: 80, min: 0, max: 100 },
  ct: { value: 4500, min: 2127, max: 6535 },
  colorMode: "hs"
};

describe("Nanoleaf HTTP client", () => {
  it("reads and validates device state", async () => {
    const request = vi.fn().mockResolvedValue(Response.json(state));
    const client = new NanoleafHttpClient("192.168.1.109", 16021, "secret-token", { fetch: request as typeof fetch });
    await expect(client.getState()).resolves.toEqual(state);
    expect(request.mock.calls[0]?.[0]).toBe("http://192.168.1.109:16021/api/v1/secret-token/state");
  });

  it("sends state updates as JSON", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new NanoleafHttpClient("bulb.local", 16021, "secret-token", { fetch: request as typeof fetch });
    await client.updateState({ on: { value: true }, brightness: { value: 50 } });
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: { value: true }, brightness: { value: 50 } })
    });
  });

  it("turns authorization failures into actionable errors without exposing tokens", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const client = new NanoleafHttpClient("bulb.local", 16021, "super-secret", { fetch: request as typeof fetch });
    await expect(client.getState()).rejects.toMatchObject({ status: 401, message: "Nanoleaf authorization expired; pair the bulb again" });
  });

  it("rejects incomplete state responses", () => {
    expect(() => parseNanoleafState({ on: { value: true } })).toThrow(NanoleafApiError);
  });
});
