import type { NanoleafState, ValueRange } from "../models.js";
import type { DiscoveryService } from "./discovery.js";
import type { DeviceRepository, TokenStore } from "./settings.js";
import type { NanoleafUpdate } from "./state.js";

export interface NanoleafClient {
  getState(): Promise<NanoleafState>;
  updateState(update: NanoleafUpdate): Promise<void>;
}

export interface NanoleafClientFactory {
  forDevice(deviceId: string): Promise<NanoleafClient>;
}

export interface HttpClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class NanoleafApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "NanoleafApiError";
  }
}

function apiBase(host: string, port: number, token: string): string {
  const normalizedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}/api/v1/${encodeURIComponent(token)}`;
}

function isRange(value: unknown): value is ValueRange {
  if (!value || typeof value !== "object") return false;
  const range = value as Record<string, unknown>;
  return typeof range.value === "number" && Number.isFinite(range.value)
    && typeof range.min === "number" && Number.isFinite(range.min)
    && typeof range.max === "number" && Number.isFinite(range.max);
}

export function parseNanoleafState(value: unknown): NanoleafState {
  if (!value || typeof value !== "object") throw new NanoleafApiError("Nanoleaf returned an invalid state response");
  const state = value as Record<string, unknown>;
  const on = state.on as Record<string, unknown> | undefined;
  if (!on || typeof on.value !== "boolean" || !isRange(state.brightness) || !isRange(state.hue)
    || !isRange(state.sat) || !isRange(state.ct) || typeof state.colorMode !== "string") {
    throw new NanoleafApiError("Nanoleaf returned an incomplete state response");
  }
  return {
    on: { value: on.value },
    brightness: state.brightness,
    hue: state.hue,
    sat: state.sat,
    ct: state.ct,
    colorMode: state.colorMode
  };
}

function validateUpdate(update: NanoleafUpdate): void {
  const allowed = new Set(["on", "brightness", "hue", "sat", "ct"]);
  for (const [key, field] of Object.entries(update)) {
    if (!allowed.has(key)) throw new NanoleafApiError(`Unsupported Nanoleaf state field: ${key}`);
    if (!field || (typeof field.value !== "boolean" && (typeof field.value !== "number" || !Number.isFinite(field.value)))) {
      throw new NanoleafApiError(`Invalid value for Nanoleaf state field: ${key}`);
    }
  }
}

export class NanoleafHttpClient implements NanoleafClient {
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(host: string, port: number, token: string, options: HttpClientOptions = {}) {
    this.#base = apiBase(host, port, token);
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  async getState(): Promise<NanoleafState> {
    const response = await this.#request("state", { method: "GET" });
    try {
      return parseNanoleafState(await response.json());
    } catch (error) {
      if (error instanceof NanoleafApiError) throw error;
      throw new NanoleafApiError("Nanoleaf returned malformed state JSON");
    }
  }

  async updateState(update: NanoleafUpdate): Promise<void> {
    validateUpdate(update);
    await this.#request("state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update)
    });
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}/${path}`, { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") throw new NanoleafApiError("Nanoleaf request timed out");
      throw new NanoleafApiError(`Unable to reach Nanoleaf device: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.ok) return response;
    if (response.status === 401) throw new NanoleafApiError("Nanoleaf authorization expired; pair the bulb again", 401);
    throw new NanoleafApiError(`Nanoleaf request failed with HTTP ${response.status}`, response.status);
  }
}

export class LocalNanoleafClientFactory implements NanoleafClientFactory {
  constructor(
    readonly devices: DeviceRepository,
    readonly tokens: TokenStore,
    readonly discovery: DiscoveryService,
    readonly options: HttpClientOptions = {}
  ) {}

  async forDevice(deviceId: string): Promise<NanoleafClient> {
    const device = await this.devices.get(deviceId);
    if (!device) throw new NanoleafApiError(`Unknown Nanoleaf device: ${deviceId}`);
    const token = await this.tokens.get(deviceId);
    if (!token) throw new NanoleafApiError("Nanoleaf bulb is not paired");

    const current = await this.discovery.resolve(deviceId).catch(() => undefined);
    if (current && (current.host !== device.host || current.port !== device.port)) {
      device.host = current.host;
      device.port = current.port;
      device.model = current.model || device.model;
      device.firmware = current.firmware || device.firmware;
      await this.devices.save(device);
    }
    return new NanoleafHttpClient(device.host, device.port, token, this.options);
  }
}
