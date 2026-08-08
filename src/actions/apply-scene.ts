import streamDeck, {
  action,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type PropertyInspectorDidAppearEvent,
  type PropertyInspectorDidDisappearEvent,
  type SendToPluginEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent
  , type WillDisappearEvent
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import type { SceneActionSettings } from "../models.js";
import type { NanoleafClientFactory } from "../nanoleaf/client.js";
import type { NanoleafDeviceManager } from "../nanoleaf/device-manager.js";
import { toggleScene } from "../nanoleaf/scene.js";
import { colourTemperatureToHex } from "../nanoleaf/state.js";
import nanoleafBulbSvg from "../../com.deadfrogstudios.nanoleaflan.sdPlugin/static/imgs/nanoleaf-bulb.svg";

type Settings = SceneActionSettings & JsonObject & { manualHostRequest?: string };
const NANOLEAF_BULB_PATH = /<path[^>]*\sd="([^"]+)"/.exec(nanoleafBulbSvg)?.[1] ?? "";

@action({ UUID: "com.deadfrogstudios.nanoleaflan.apply-scene" })
export class ApplySceneAction extends SingletonAction<Settings> {
  readonly #manager: NanoleafDeviceManager;
  readonly #clients: NanoleafClientFactory;
  #propertyInspectorVisible = false;
  readonly #statusTimers = new Map<string, ReturnType<typeof setInterval>>();
  readonly #stateCache = new Map<string, { on: boolean; brightness: number; checkedAt: number }>();
  readonly #stateReads = new Map<string, Promise<{ on: boolean; brightness: number }>>();
  readonly #dialPending = new Map<string, {
    ticks: number;
    timer: ReturnType<typeof setTimeout>;
    action: DialRotateEvent<Settings>["action"];
    settings: Settings;
  }>();

  constructor(manager: NanoleafDeviceManager, clients: NanoleafClientFactory) {
    super();
    this.#manager = manager;
    this.#clients = clients;
    manager.onChange(() => { if (this.#propertyInspectorVisible) void this.#sendDevices(); });
  }

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    const count = ev.payload.settings.lights?.length ?? 0;
    if (ev.action.isKey()) await ev.action.setTitle(count > 0 ? `${count} light${count === 1 ? "" : "s"}` : "Configure");
    await this.#refreshAction(ev.action, ev.payload.settings.lights ?? []);
    const existing = this.#statusTimers.get(ev.action.id);
    if (existing) clearInterval(existing);
    this.#statusTimers.set(ev.action.id, setInterval(() => {
      void ev.action.getSettings<Settings>().then((settings) => this.#refreshAction(ev.action, settings.lights ?? []));
    }, 10_000));
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    const timer = this.#statusTimers.get(ev.action.id);
    if (timer) clearInterval(timer);
    this.#statusTimers.delete(ev.action.id);
    const pending = this.#dialPending.get(ev.action.id);
    if (pending) clearTimeout(pending.timer);
    this.#dialPending.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const programs = ev.payload.settings.lights ?? [];
    await this.#toggle(ev.action, programs, "Button");
  }

  override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
    await this.#toggle(ev.action, ev.payload.settings.lights ?? [], "Dial press");
  }

  override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
    await this.#toggle(ev.action, ev.payload.settings.lights ?? [], "Touch tap");
  }

  override onDialRotate(ev: DialRotateEvent<Settings>): void {
    const existing = this.#dialPending.get(ev.action.id);
    if (existing) clearTimeout(existing.timer);
    const pending = {
      ticks: (existing?.ticks ?? 0) + ev.payload.ticks,
      action: ev.action,
      settings: ev.payload.settings,
      timer: setTimeout(() => { void this.#applyDialRotation(ev.action.id); }, 120)
    };
    this.#dialPending.set(ev.action.id, pending);
  }

  async #toggle(
    actionInstance: KeyDownEvent<Settings>["action"] | DialDownEvent<Settings>["action"] | TouchTapEvent<Settings>["action"],
    programs: NonNullable<Settings["lights"]>,
    source: string
  ): Promise<void> {
    const pressedAt = performance.now();
    if (programs.length === 0) {
      streamDeck.logger.warn("Apply Scene pressed before any lights were configured");
      await actionInstance.showAlert();
      return;
    }
    const result = await toggleScene(programs, this.#clients);
    streamDeck.logger.info(
      `${source} API cycle completed in ${Math.round(performance.now() - pressedAt)}ms `
      + `(${result.mode}, ${result.succeeded.length} succeeded, ${result.failed.length} failed)`
    );
    const on = result.mode === "on";
    for (const deviceId of result.succeeded) {
      const previous = this.#stateCache.get(deviceId);
      const program = programs.find((item) => item.deviceId === deviceId);
      this.#stateCache.set(deviceId, {
        on,
        brightness: on ? program?.brightness ?? previous?.brightness ?? 100 : previous?.brightness ?? program?.brightness ?? 100,
        checkedAt: Date.now()
      });
    }
    if (result.failed.length === 0) {
      streamDeck.logger.info(`Scene applied to ${result.succeeded.length} light(s)`);
      if (actionInstance.isKey()) await actionInstance.setImage(this.#keyImage(result.mode, this.#configuredColour(programs)));
      if (actionInstance.isDial()) await this.#refreshDial(actionInstance, programs);
    } else {
      for (const failure of result.failed) streamDeck.logger.error(`Scene update failed for ${failure.deviceId}: ${String(failure.error)}`);
      await actionInstance.showAlert();
    }
    // toggleScene already confirmed the requested state. Avoid immediately issuing
    // another GET, which can overwhelm slower bulbs and delay the icon update.
  }

  async #applyDialRotation(actionId: string): Promise<void> {
    const pending = this.#dialPending.get(actionId);
    if (!pending) return;
    this.#dialPending.delete(actionId);
    const programs = pending.settings.lights ?? [];
    if (programs.length === 0) {
      await pending.action.showAlert();
      return;
    }
    const delta = pending.ticks * 5;
    const updated = programs.map((program) => ({
      ...program,
      power: true,
      brightness: Math.max(1, Math.min(100, (program.brightness ?? 100) + delta))
    }));
    const results = await Promise.allSettled(updated.map(async (program) => {
      const client = await this.#clients.forDevice(program.deviceId);
      await client.updateState({ on: { value: true }, brightness: { value: program.brightness ?? 100 } });
      this.#stateCache.set(program.deviceId, { on: true, brightness: program.brightness ?? 100, checkedAt: Date.now() });
    }));
    if (results.some((result) => result.status === "rejected")) {
      await pending.action.showAlert();
      return;
    }
    const settings = { ...pending.settings, lights: updated } as Settings;
    await pending.action.setSettings(settings);
    await this.#refreshDial(pending.action, updated);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    const count = ev.payload.settings.lights?.length ?? 0;
    if (ev.action.isKey()) await ev.action.setTitle(count > 0 ? `${count} light${count === 1 ? "" : "s"}` : "Configure");
    await this.#refreshAction(ev.action, ev.payload.settings.lights ?? []);
    const host = ev.payload.settings.manualHostRequest;
    if (!host) return;
    const { manualHostRequest: _request, ...settings } = ev.payload.settings;
    await ev.action.setSettings(settings as Settings);
    streamDeck.logger.info(`Adding manually addressed Nanoleaf bulb at ${host}`);
    try {
      await this.#manager.addManual(host);
      await this.#sendDevices("Bulb added. Open Connect to API, then click Pair.");
    } catch (error) {
      streamDeck.logger.error(`Manual Nanoleaf add failed: ${String(error)}`);
      await streamDeck.ui.sendToPropertyInspector({ event: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  override async onPropertyInspectorDidAppear(_ev: PropertyInspectorDidAppearEvent<Settings>): Promise<void> {
    this.#propertyInspectorVisible = true;
    await this.#sendDevices();
  }

  override onPropertyInspectorDidDisappear(_ev: PropertyInspectorDidDisappearEvent<Settings>): void {
    this.#propertyInspectorVisible = false;
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
    if (!ev.payload || typeof ev.payload !== "object" || Array.isArray(ev.payload)) return;
    const message = ev.payload as JsonObject;
    const command = message.command;
    streamDeck.logger.info(`Property Inspector command received: ${String(command)}`);
    if (command === "refresh") {
      await this.#sendDevices();
      return;
    }
    if (command === "pairAvailable") {
      await streamDeck.ui.sendToPropertyInspector({ event: "status", command });
      try {
        await this.#manager.pairAvailable();
        await this.#sendDevices("Paired successfully; the Nanoleaf app name is now shown.");
      } catch (error) {
        await streamDeck.ui.sendToPropertyInspector({ event: "error", message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (command === "addManual" && typeof message.host === "string") {
      try {
        await this.#manager.addManual(message.host);
        await this.#sendDevices("Bulb added. Open Connect to API, then click Pair.");
      } catch (error) {
        await streamDeck.ui.sendToPropertyInspector({ event: "error", message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    try {
      if (command === "renameDevice" && typeof message.deviceId === "string" && typeof message.name === "string") {
        await this.#manager.renameDevice(message.deviceId, message.name);
        await this.#sendDevices("Bulb nickname saved");
        return;
      }
      if (command === "createGroup" && typeof message.name === "string") {
        await this.#manager.createGroup(message.name);
        await this.#sendDevices("Group created");
        return;
      }
      if (command === "renameGroup" && typeof message.groupId === "string" && typeof message.name === "string") {
        await this.#manager.renameGroup(message.groupId, message.name);
        await this.#sendDevices("Group renamed");
        return;
      }
      if (command === "setGroupDevices" && typeof message.groupId === "string" && Array.isArray(message.deviceIds)
        && message.deviceIds.every((id) => typeof id === "string")) {
        await this.#manager.setGroupDevices(message.groupId, message.deviceIds as string[]);
        await this.#sendDevices("Group membership saved");
        return;
      }
      if (command === "deleteGroup" && typeof message.groupId === "string") {
        await this.#manager.deleteGroup(message.groupId);
        await this.#sendDevices("Group deleted");
        return;
      }
    } catch (error) {
      await streamDeck.ui.sendToPropertyInspector({ event: "error", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if ((command !== "pair" && command !== "unpair") || typeof message.deviceId !== "string") return;

    await streamDeck.ui.sendToPropertyInspector({ event: "status", deviceId: message.deviceId, command });
    try {
      if (command === "pair") await this.#manager.pair(message.deviceId);
      else await this.#manager.unpair(message.deviceId);
      await this.#sendDevices(command === "pair" ? "Pairing successful" : "Bulb unpaired");
    } catch (error) {
      streamDeck.logger.error(`${command} failed for ${message.deviceId}: ${String(error)}`);
      await streamDeck.ui.sendToPropertyInspector({ event: "error", deviceId: message.deviceId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  async #sendDevices(message?: string): Promise<void> {
    const devices = await this.#manager.list() as unknown as JsonObject[];
    const groups = await this.#manager.listGroups() as unknown as JsonObject[];
    await streamDeck.ui.sendToPropertyInspector({ event: "devices", devices, groups, ...(message ? { message } : {}) });
  }

  async #refreshAction(actionInstance: WillAppearEvent<Settings>["action"], programs: Settings["lights"]): Promise<void> {
    if (actionInstance.isDial()) {
      await this.#refreshDial(actionInstance, programs ?? []);
      return;
    }
    if (!actionInstance.isKey()) return;
    if (!programs || programs.length === 0) {
      await actionInstance.setImage(this.#keyImage("unconfigured", "#65d96e"));
      return;
    }
    try {
      const states = await Promise.all(programs.map((program) => this.#getStatus(program.deviceId)));
      await actionInstance.setImage(this.#keyImage(states.some((state) => state.on) ? "on" : "off", this.#configuredColour(programs)));
    } catch (error) {
      streamDeck.logger.warn(`Unable to refresh key status: ${String(error)}`);
      await actionInstance.setImage(this.#keyImage("error", "#e0a12e"));
    }
  }

  async #refreshDial(actionInstance: DialDownEvent<Settings>["action"], programs: NonNullable<Settings["lights"]>): Promise<void> {
    if (programs.length === 0) {
      await actionInstance.setFeedback({
        title: "Nanoleaf LAN",
        value: "Configure",
        indicator: 0,
        icon: this.#dialIcon("#65d96e")
      });
      return;
    }
    try {
      const states = await Promise.all(programs.map((program) => this.#getStatus(program.deviceId)));
      const on = states.some((state) => state.on);
      const brightness = Math.round(states.reduce((sum, state) => sum + state.brightness, 0) / states.length);
      await actionInstance.setFeedback({
        title: await this.#dialName(programs),
        value: on ? `${brightness}%` : "OFF",
        indicator: on ? brightness : 0,
        icon: this.#dialIcon(on ? this.#configuredColour(programs) : "#3d4541")
      });
    } catch (error) {
      streamDeck.logger.warn(`Unable to refresh dial status: ${String(error)}`);
      await actionInstance.setFeedback({
        title: await this.#dialName(programs),
        value: "Unavailable",
        indicator: 0,
        icon: this.#dialIcon("#e0a12e")
      });
    }
  }

  async #getStatus(deviceId: string): Promise<{ on: boolean; brightness: number }> {
    const cached = this.#stateCache.get(deviceId);
    if (cached && Date.now() - cached.checkedAt < 5_000) return cached;
    const existing = this.#stateReads.get(deviceId);
    if (existing) return existing;
    const read = (async () => {
      const state = await (await this.#clients.forDevice(deviceId)).getState();
      const status = { on: state.on.value, brightness: state.brightness.value };
      this.#stateCache.set(deviceId, { ...status, checkedAt: Date.now() });
      return status;
    })();
    this.#stateReads.set(deviceId, read);
    try {
      return await read;
    } finally {
      this.#stateReads.delete(deviceId);
    }
  }

  #configuredColour(programs: NonNullable<Settings["lights"]>): string {
    const program = programs[0];
    if (program?.mode === "hs" && /^#[0-9a-f]{6}$/i.test(program.colorHex ?? "")) {
      return program.colorHex ?? "#65d96e";
    }
    if (program?.mode === "ct") return colourTemperatureToHex(program.ct);
    return "#65d96e";
  }

  #dialIcon(colour: string): string {
    const svg = nanoleafBulbSvg.replace("#ffffff", colour);
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  async #dialName(programs: NonNullable<Settings["lights"]>): Promise<string> {
    const ids = new Set(programs.map((program) => program.deviceId));
    const groups = await this.#manager.listGroups();
    const group = groups.find((candidate) => candidate.devices.length === ids.size
      && candidate.devices.every((deviceId) => ids.has(deviceId)));
    if (group) return group.name;
    const devices = await this.#manager.list();
    if (programs.length === 1) {
      return devices.find((device) => device.eui64 === programs[0]?.deviceId)?.name ?? "Nanoleaf light";
    }
    return `${programs.length} Nanoleaf lights`;
  }

  #keyImage(status: "on" | "off" | "error" | "unconfigured", colour: string): string {
    const fill = status === "off" ? "#3d4541" : colour;
    const badge = status === "error" ? '<path d="M111 18 132 55H90Z" fill="#e0a12e"/><path d="M111 30v12m0 6v1" stroke="#151b18" stroke-width="4" stroke-linecap="round"/>' : "";
    const mark = status === "unconfigured" ? '<path d="M72 48v32M56 64h32" stroke="#fff" stroke-width="7" stroke-linecap="round"/>' : "";
    const offMark = status === "off" ? '<rect x="49" y="60" width="46" height="24" rx="7" fill="#d7dcda"/><text x="72" y="77" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#151b18">OFF</text>' : "";
    const colourDot = status === "off" ? `<circle cx="122" cy="22" r="8" fill="${colour}" stroke="#d7dcda" stroke-width="2"/>` : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect width="144" height="144" rx="18" fill="#151b18"/><path d="${NANOLEAF_BULB_PATH}" transform="scale(6)" fill="${fill}"/>${mark}${badge}${offMark}${colourDot}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}
