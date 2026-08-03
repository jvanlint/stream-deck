import type { DeviceRepository, TokenStore } from "./settings.js";

export interface PairingService {
  pair(host: string, port: number, signal?: AbortSignal): Promise<PairingResult>;
  unpair(deviceId: string): Promise<void>;
}

export interface PairingResult {
  token: string;
  name?: string;
  model?: string;
  firmware?: string;
}

export interface PairingOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onAttempt?: (method: "POST" | "GET", status: number) => void;
}

function baseUrl(host: string, port: number): string {
  const normalizedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}/api/v1`;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** Implements Nanoleaf OpenAPI pairing and authorization verification. */
export class NanoleafPairingService implements PairingService {
  readonly #devices: DeviceRepository;
  readonly #tokens: TokenStore;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #pollIntervalMs: number;
  readonly #timeoutMs: number;
  readonly #onAttempt: ((method: "POST" | "GET", status: number) => void) | undefined;

  constructor(devices: DeviceRepository, tokens: TokenStore, options: PairingOptions = {}) {
    this.#devices = devices;
    this.#tokens = tokens;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.#timeoutMs = options.timeoutMs ?? 35_000;
    this.#onAttempt = options.onAttempt;
  }

  async pair(host: string, port: number, signal?: AbortSignal): Promise<PairingResult> {
    const deadline = Date.now() + this.#timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw signal.reason;
      try {
        for (const method of ["POST", "GET"] as const) {
          const response = await this.#fetch(`${baseUrl(host, port)}/new`, { method, ...(signal ? { signal } : {}) });
          this.#onAttempt?.(method, response.status);
          if (response.ok) {
            const text = await response.text();
            let body: { auth_token?: unknown } = {};
            try { body = JSON.parse(text) as { auth_token?: unknown }; } catch { /* try firmware fallback */ }
            if (typeof body.auth_token === "string" && body.auth_token.length > 0) {
              const information = await this.#getDeviceInformation(host, port, body.auth_token, signal);
              return { token: body.auth_token, ...information };
            }
            lastError = new Error(`Nanoleaf returned HTTP ${response.status} without a pairing token`);
          } else {
            lastError = new Error(`Nanoleaf ${method} pairing returned HTTP ${response.status}`);
          }
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        lastError = error;
      }
      await this.#sleep(this.#pollIntervalMs, signal);
    }

    throw new Error(`Pairing timed out. Tap “Connect to API” in the Nanoleaf app and try again.${lastError ? ` Last error: ${String(lastError)}` : ""}`);
  }

  async unpair(deviceId: string): Promise<void> {
    const device = await this.#devices.get(deviceId);
    const token = await this.#tokens.get(deviceId);
    if (device && token) {
      const response = await this.#fetch(`${baseUrl(device.host, device.port)}/${encodeURIComponent(token)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error(`Nanoleaf unpair returned HTTP ${response.status}`);
    }
    await this.#tokens.remove(deviceId);
  }

  async #getDeviceInformation(host: string, port: number, token: string, signal?: AbortSignal): Promise<Omit<PairingResult, "token">> {
    const response = await this.#fetch(`${baseUrl(host, port)}/${encodeURIComponent(token)}/`, signal ? { signal } : {});
    if (!response.ok) throw new Error(`Nanoleaf token verification returned HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    return {
      ...(typeof body.name === "string" && body.name ? { name: body.name } : {}),
      ...(typeof body.model === "string" && body.model ? { model: body.model } : {}),
      ...(typeof body.firmwareVersion === "string" && body.firmwareVersion ? { firmware: body.firmwareVersion } : {})
    };
  }
}
