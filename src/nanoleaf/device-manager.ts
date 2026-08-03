import { resolveEui64FromHost, type DiscoveredNanoleaf, type DiscoveryService } from "./discovery.js";
import { validateGroupName, type GroupRepository } from "./groups.js";
import type { PairingService } from "./pairing.js";
import type { DeviceRepository, TokenStore } from "./settings.js";
import type { NanoleafGroup } from "../models.js";

export interface ManagedDevice extends DiscoveredNanoleaf {
  name: string;
  paired: boolean;
}

export class NanoleafDeviceManager {
  readonly #discovery: DiscoveryService;
  readonly #devices: DeviceRepository;
  readonly #tokens: TokenStore;
  readonly #pairing: PairingService;
  readonly #groups: GroupRepository;
  readonly #listeners = new Set<() => void>();
  readonly #discovered = new Map<string, DiscoveredNanoleaf>();

  constructor(discovery: DiscoveryService, devices: DeviceRepository, tokens: TokenStore, pairing: PairingService, groups: GroupRepository) {
    this.#discovery = discovery;
    this.#devices = devices;
    this.#tokens = tokens;
    this.#pairing = pairing;
    this.#groups = groups;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(signal?: AbortSignal): Promise<void> {
    for await (const discovered of this.#discovery.discover(signal)) {
      this.#discovered.set(discovered.eui64, discovered);
      const existing = await this.#devices.get(discovered.eui64);
      await this.#devices.save({
        ...discovered,
        name: existing?.name ?? `${discovered.model || "Nanoleaf"} ${discovered.eui64.slice(-4)}`
      });
      this.#notify();
    }
  }

  async list(): Promise<ManagedDevice[]> {
    const stored = await this.#devices.list();
    return Promise.all(stored.map(async (device) => ({
      ...device,
      ...(this.#discovered.get(device.eui64) ?? {}),
      paired: (await this.#tokens.get(device.eui64)) !== undefined
    })));
  }

  async listGroups(): Promise<NanoleafGroup[]> {
    return this.#groups.list();
  }

  async renameDevice(eui64: string, name: string): Promise<void> {
    const device = await this.#devices.get(eui64);
    if (!device) throw new Error("Bulb not found");
    const normalized = validateGroupName(name);
    await this.#devices.save({ ...device, name: normalized });
    this.#notify();
  }

  async createGroup(name: string): Promise<void> {
    await this.#groups.save({ id: crypto.randomUUID(), name: validateGroupName(name), devices: [] });
    this.#notify();
  }

  async renameGroup(id: string, name: string): Promise<void> {
    const group = await this.#groups.get(id);
    if (!group) throw new Error("Group not found");
    await this.#groups.save({ ...group, name: validateGroupName(name) });
    this.#notify();
  }

  async setGroupDevices(id: string, deviceIds: string[]): Promise<void> {
    const group = await this.#groups.get(id);
    if (!group) throw new Error("Group not found");
    const known = new Set((await this.#devices.list()).map((device) => device.eui64));
    const devices = [...new Set(deviceIds)].filter((deviceId) => known.has(deviceId));
    await this.#groups.save({ ...group, devices });
    this.#notify();
  }

  async deleteGroup(id: string): Promise<void> {
    await this.#groups.remove(id);
    this.#notify();
  }

  async pair(eui64: string, signal?: AbortSignal): Promise<void> {
    const device = await this.#devices.get(eui64);
    if (!device) throw new Error("That bulb is no longer available. Refresh discovery and try again.");
    const result = await this.#pairing.pair(device.host, device.port, signal);
    await this.#tokens.set(eui64, result.token);
    await this.#devices.save({
      ...device,
      name: result.name ?? device.name,
      model: result.model ?? device.model,
      firmware: result.firmware ?? device.firmware
    });
    this.#notify();
  }

  async pairAvailable(): Promise<void> {
    const devices = await this.list();
    const candidates = devices.filter((device) => !device.paired);
    if (candidates.length === 0) throw new Error("All discovered bulbs are already paired");
    const controllers = candidates.map(() => new AbortController());
    try {
      await Promise.any(candidates.map((device, index) => this.pair(device.eui64, controllers[index]?.signal)));
    } catch (error) {
      if (error instanceof AggregateError) throw new Error("No bulb accepted pairing. Reopen Connect to API and try again.");
      throw error;
    } finally {
      for (const controller of controllers) controller.abort();
    }
  }

  async addManual(host: string, port = 16021): Promise<void> {
    const normalizedHost = host.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!/^[a-zA-Z0-9.-]+$/.test(normalizedHost)) throw new Error("Enter a valid IP address or local hostname");
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Port must be between 1 and 65535");
    const normalizedId = await resolveEui64FromHost(normalizedHost, port);

    const existing = await this.#devices.get(normalizedId);
    await this.#devices.save({
      eui64: normalizedId,
      name: existing?.name ?? `Nanoleaf ${normalizedId.slice(-4)}`,
      host: normalizedHost,
      port,
      model: existing?.model ?? "",
      firmware: existing?.firmware ?? ""
    });
    this.#notify();
  }

  async unpair(eui64: string): Promise<void> {
    await this.#pairing.unpair(eui64);
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
