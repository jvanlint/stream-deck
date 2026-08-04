import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { spawn } from "node:child_process";
import type { NanoleafDevice } from "../models.js";

export interface DeviceRepository {
  list(): Promise<NanoleafDevice[]>;
  get(eui64: string): Promise<NanoleafDevice | undefined>;
  save(device: NanoleafDevice): Promise<void>;
  remove(eui64: string): Promise<void>;
}

export interface TokenStore {
  get(eui64: string): Promise<string | undefined>;
  set(eui64: string, token: string): Promise<void>;
  remove(eui64: string): Promise<void>;
}

interface PluginSettings extends JsonObject {
  devices?: Array<NanoleafDevice & JsonObject>;
  protectedTokens?: Record<string, string>;
}

export class StreamDeckDeviceRepository implements DeviceRepository {
  async list(): Promise<NanoleafDevice[]> {
    return (await streamDeck.settings.getGlobalSettings<PluginSettings>()).devices ?? [];
  }

  async get(eui64: string): Promise<NanoleafDevice | undefined> {
    return (await this.list()).find((device) => device.eui64 === eui64);
  }

  async save(device: NanoleafDevice): Promise<void> {
    const settings = await streamDeck.settings.getGlobalSettings<PluginSettings>();
    const devices = (settings.devices ?? []).filter((item) => item.eui64 !== device.eui64);
    const { token: _token, ...safeDevice } = device;
    devices.push(safeDevice as NanoleafDevice & JsonObject);
    await streamDeck.settings.setGlobalSettings({ ...settings, devices });
  }

  async remove(eui64: string): Promise<void> {
    const settings = await streamDeck.settings.getGlobalSettings<PluginSettings>();
    await streamDeck.settings.setGlobalSettings({
      ...settings,
      devices: (settings.devices ?? []).filter((device) => device.eui64 !== eui64)
    });
  }
}

function run(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `${command} exited with ${code}`)));
    child.stdin.end(input);
  });
}

const DPAPI_LOAD = "Add-Type -AssemblyName System.Security;";
const DPAPI_PROTECT = `${DPAPI_LOAD}$v=[Console]::In.ReadToEnd();$b=[Text.Encoding]::UTF8.GetBytes($v);$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))`;
const DPAPI_UNPROTECT = `${DPAPI_LOAD}$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))`;
const KEYCHAIN_SERVICE = "com.deadfrogstudios.nanoleaflan";

/** Stores tokens with Windows DPAPI or macOS Keychain; tokens never enter action settings. */
export class PlatformTokenStore implements TokenStore {
  readonly #cache = new Map<string, string>();

  async get(eui64: string): Promise<string | undefined> {
    const cached = this.#cache.get(eui64);
    if (cached) return cached;
    if (process.platform === "darwin") {
      try {
        const token = await run("/usr/bin/security", ["find-generic-password", "-a", eui64, "-s", KEYCHAIN_SERVICE, "-w"]);
        this.#cache.set(eui64, token);
        return token;
      } catch {
        return undefined;
      }
    }
    this.#requireWindows();
    const settings = await streamDeck.settings.getGlobalSettings<PluginSettings>();
    const protectedToken = settings.protectedTokens?.[eui64];
    if (!protectedToken) return undefined;
    const token = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_UNPROTECT], protectedToken);
    this.#cache.set(eui64, token);
    return token;
  }

  async set(eui64: string, token: string): Promise<void> {
    if (process.platform === "darwin") {
      await run("/usr/bin/security", ["add-generic-password", "-U", "-a", eui64, "-s", KEYCHAIN_SERVICE, "-w", token]);
      this.#cache.set(eui64, token);
      return;
    }
    this.#requireWindows();
    const protectedToken = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_PROTECT], token);
    const settings = await streamDeck.settings.getGlobalSettings<PluginSettings>();
    await streamDeck.settings.setGlobalSettings({
      ...settings,
      protectedTokens: { ...(settings.protectedTokens ?? {}), [eui64]: protectedToken }
    });
    this.#cache.set(eui64, token);
  }

  async remove(eui64: string): Promise<void> {
    this.#cache.delete(eui64);
    if (process.platform === "darwin") {
      try { await run("/usr/bin/security", ["delete-generic-password", "-a", eui64, "-s", KEYCHAIN_SERVICE]); } catch { /* already absent */ }
      return;
    }
    this.#requireWindows();
    const settings = await streamDeck.settings.getGlobalSettings<PluginSettings>();
    const protectedTokens = { ...(settings.protectedTokens ?? {}) };
    delete protectedTokens[eui64];
    await streamDeck.settings.setGlobalSettings({ ...settings, protectedTokens });
  }

  #requireWindows(): void {
    if (process.platform !== "win32") throw new Error(`Secure token storage is unsupported on ${process.platform}`);
  }
}
