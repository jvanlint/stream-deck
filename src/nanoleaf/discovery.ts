import Bonjour, { type Browser, type Service } from "bonjour-service";
import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import { promisify } from "node:util";

export const NANOLEAF_SERVICE_TYPE = "nanoleafapi";
const execFileAsync = promisify(execFile);

export interface DiscoveredNanoleaf {
  eui64: string;
  host: string;
  port: number;
  model: string;
  firmware: string;
}

export interface DiscoveryService {
  discover(signal?: AbortSignal): AsyncIterable<DiscoveredNanoleaf>;
  resolve(eui64: string, signal?: AbortSignal): Promise<DiscoveredNanoleaf | undefined>;
}

interface BrowserLike {
  on(event: "up" | "txt-update" | "srv-update", listener: (service: Service) => void): this;
  stop(): void;
}

interface BonjourLike {
  find(options: { type: string; protocol: "tcp" }): BrowserLike;
  destroy(): void;
}

export interface MdnsDiscoveryOptions {
  resolveTimeoutMs?: number;
  createBonjour?: () => BonjourLike;
}

function txtValue(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Converts a DNS-SD service into the stable subset used by the plugin. */
export function parseNanoleafService(service: Pick<Service, "host" | "port" | "txt" | "addresses">): DiscoveredNanoleaf | undefined {
  const txt = (service.txt ?? {}) as Record<string, unknown>;
  const eui64 = txtValue(txt.eui64).replaceAll(/[:-]/g, "").toUpperCase();
  const ipv4 = service.addresses?.find((address) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address));
  const host = ipv4 ?? service.host?.replace(/\.$/, "") ?? "";
  if (!/^[0-9A-F]{16}$/.test(eui64) || host.length === 0 || !Number.isInteger(service.port) || service.port <= 0) {
    return undefined;
  }

  return {
    eui64,
    host,
    port: service.port,
    model: txtValue(txt.md),
    firmware: txtValue(txt.srcvers)
  };
}

export function eui64FromMac(mac: string): string | undefined {
  const normalized = mac.replaceAll(/[:-]/g, "").toUpperCase();
  return /^[0-9A-F]{12}$/.test(normalized) ? `0000${normalized}` : undefined;
}

/** Resolves a directly reachable bulb's stable identifier from the local neighbor table. */
export async function resolveEui64FromHost(host: string, port = 16021): Promise<string> {
  const { address } = await lookup(host, { family: 4 });
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: address, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Timed out connecting to the bulb")); }, 5_000);
    socket.once("connect", () => { clearTimeout(timer); socket.end(); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });

  const command = process.platform === "win32" ? "arp.exe" : "/usr/sbin/arp";
  const args = process.platform === "win32" ? ["-a", address] : ["-n", address];
  const { stdout } = await execFileAsync(command, args, { windowsHide: true });
  const mac = stdout.match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i)?.[0];
  const eui64 = mac ? eui64FromMac(mac) : undefined;
  if (!eui64) throw new Error("Could not determine the bulb identity from its IP address");
  return eui64;
}

export class MdnsDiscoveryService implements DiscoveryService {
  readonly #resolveTimeoutMs: number;
  readonly #createBonjour: () => BonjourLike;
  readonly #cache = new Map<string, DiscoveredNanoleaf>();

  constructor(options: MdnsDiscoveryOptions = {}) {
    this.#resolveTimeoutMs = options.resolveTimeoutMs ?? 5_000;
    this.#createBonjour = options.createBonjour ?? (() => new Bonjour());
  }

  async *discover(signal?: AbortSignal): AsyncIterable<DiscoveredNanoleaf> {
    if (signal?.aborted) return;

    const bonjour = this.#createBonjour();
    const browser = bonjour.find({ type: NANOLEAF_SERVICE_TYPE, protocol: "tcp" }) as Browser;
    const queued: DiscoveredNanoleaf[] = [];
    const waiting: Array<() => void> = [];
    const seen = new Map<string, string>();
    let stopped = false;

    const wake = (): void => waiting.shift()?.();
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      browser.stop();
      bonjour.destroy();
      while (waiting.length > 0) wake();
    };
    const enqueue = (service: Service): void => {
      const device = parseNanoleafService(service);
      if (!device) return;
      const signature = `${device.host}:${device.port}:${device.model}:${device.firmware}`;
      if (seen.get(device.eui64) === signature) return;
      seen.set(device.eui64, signature);
      this.#cache.set(device.eui64, device);
      queued.push(device);
      wake();
    };

    browser.on("up", enqueue).on("txt-update", enqueue).on("srv-update", enqueue);
    signal?.addEventListener("abort", stop, { once: true });

    try {
      while (!stopped) {
        const device = queued.shift();
        if (device) {
          yield device;
          continue;
        }
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
    } finally {
      signal?.removeEventListener("abort", stop);
      stop();
    }
  }

  async resolve(eui64: string, signal?: AbortSignal): Promise<DiscoveredNanoleaf | undefined> {
    const id = eui64.replaceAll(/[:-]/g, "").toUpperCase();
    const cached = this.#cache.get(id);
    if (cached) return cached;
    if (signal?.aborted) return undefined;

    const timeout = AbortSignal.timeout(this.#resolveTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    for await (const device of this.discover(combined)) {
      if (device.eui64 === id) return device;
    }
    return undefined;
  }
}
