import { describe, expect, it, vi } from "vitest";
import type { NanoleafDevice } from "../src/models.js";
import { NanoleafPairingService } from "../src/nanoleaf/pairing.js";
import type { DeviceRepository, TokenStore } from "../src/nanoleaf/settings.js";

function repositories(device?: NanoleafDevice, token?: string): { devices: DeviceRepository; tokens: TokenStore } {
  let storedToken = token;
  return {
    devices: {
      async list() { return device ? [device] : []; },
      async get(id) { return device?.eui64 === id ? device : undefined; },
      async save() {},
      async remove() {}
    },
    tokens: {
      async get() { return storedToken; },
      async set(_id, value) { storedToken = value; },
      async remove() { storedToken = undefined; }
    }
  };
}

describe("Nanoleaf pairing", () => {
  it("polls for authorization and verifies the issued token", async () => {
    const { devices, tokens } = repositories();
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ auth_token: "secret-token" }))
      .mockResolvedValueOnce(Response.json({ name: "Office Left", model: "NL75K1", firmwareVersion: "4.0.12" }));
    const pairing = new NanoleafPairingService(devices, tokens, {
      fetch: request as typeof fetch,
      sleep: async () => {}
    });

    await expect(pairing.pair("bulb.local", 16021)).resolves.toEqual({
      token: "secret-token",
      name: "Office Left",
      model: "NL75K1",
      firmware: "4.0.12"
    });
    expect(request).toHaveBeenNthCalledWith(1, "http://bulb.local:16021/api/v1/new", { method: "POST" });
    expect(request).toHaveBeenNthCalledWith(2, "http://bulb.local:16021/api/v1/new", { method: "GET" });
    expect(request).toHaveBeenLastCalledWith("http://bulb.local:16021/api/v1/secret-token/", {});
  });

  it("revokes the remote token before removing it locally", async () => {
    const device = { eui64: "0000808AF7243C6D", name: "Office", host: "bulb.local", port: 16021, model: "NL75K1", firmware: "4.0.12" };
    const { devices, tokens } = repositories(device, "secret-token");
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const pairing = new NanoleafPairingService(devices, tokens, { fetch: request as typeof fetch });

    await pairing.unpair(device.eui64);
    expect(request).toHaveBeenCalledWith("http://bulb.local:16021/api/v1/secret-token", { method: "DELETE" });
    await expect(tokens.get(device.eui64)).resolves.toBeUndefined();
  });
});
