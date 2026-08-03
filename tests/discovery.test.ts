import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { Service } from "bonjour-service";
import { eui64FromMac, MdnsDiscoveryService, NANOLEAF_SERVICE_TYPE, parseNanoleafService } from "../src/nanoleaf/discovery.js";

class FakeBrowser extends EventEmitter {
  stopped = false;
  stop(): void { this.stopped = true; }
}

describe("Nanoleaf mDNS discovery", () => {
  it("derives Nanoleaf EUI-64 identity from a hardware address", () => {
    expect(eui64FromMac("80-8a-f7-24-3c-6d")).toBe("0000808AF7243C6D");
    expect(eui64FromMac("not-a-mac")).toBeUndefined();
  });
  it("parses and normalizes Nanoleaf TXT records", () => {
    expect(parseNanoleafService({
      host: "808AF7243C6D.local.",
      addresses: ["fe80::828a:f7ff:fe24:3c6d", "192.168.1.109"],
      port: 16021,
      txt: { eui64: "0000-808A-F724-3C6D", md: "NL75K1", srcvers: "4.0.12" }
    })).toEqual({
      eui64: "0000808AF7243C6D",
      host: "192.168.1.109",
      port: 16021,
      model: "NL75K1",
      firmware: "4.0.12"
    });
  });

  it("ignores services without a valid stable identity", () => {
    expect(parseNanoleafService({ host: "bulb.local", addresses: [], port: 16021, txt: { md: "NL75K1" } })).toBeUndefined();
  });

  it("discovers devices once and cleans up when cancelled", async () => {
    const browser = new FakeBrowser();
    let destroyed = false;
    let query: unknown;
    const discovery = new MdnsDiscoveryService({
      createBonjour: () => ({
        find(options) { query = options; return browser; },
        destroy() { destroyed = true; }
      })
    });
    const controller = new AbortController();
    const iterator = discovery.discover(controller.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    const service = {
      host: "bulb.local.", port: 16021,
      txt: { eui64: "0000808AF7243C6D", md: "NL75K1", srcvers: "4.0.12" }
    } as Service;
    browser.emit("up", service);

    await expect(pending).resolves.toMatchObject({ value: { eui64: "0000808AF7243C6D" }, done: false });
    expect(query).toEqual({ type: NANOLEAF_SERVICE_TYPE, protocol: "tcp" });
    controller.abort();
    await iterator.next();
    expect(browser.stopped).toBe(true);
    expect(destroyed).toBe(true);
  });
});
