import streamDeck, {
  action,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent
  , type WillDisappearEvent
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import type { ColorCycleActionSettings } from "../models.js";
import type { NanoleafClientFactory } from "../nanoleaf/client.js";
import type { NanoleafDeviceManager } from "../nanoleaf/device-manager.js";
import nanoleafBulbSvg from "../../com.deadfrogstudios.nanoleaflan.sdPlugin/static/imgs/nanoleaf-bulb.svg";

type Settings = ColorCycleActionSettings & JsonObject;
const DEFAULT_COLOR = "#00ff00";
const DEFAULT_COLORS = [DEFAULT_COLOR, "#ff0000", "#0000ff"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const NANOLEAF_BULB_PATH = /<path[^>]*\sd="([^"]+)"/.exec(nanoleafBulbSvg)?.[1] ?? "";

function normalizedColors(colors: unknown): string[] {
  if (!Array.isArray(colors)) return DEFAULT_COLORS;
  const valid = colors.filter((color): color is string => typeof color === "string" && HEX_COLOR.test(color));
  return valid.length > 0 ? valid : DEFAULT_COLORS;
}

function hexToHueSaturation(hex: string): { hue: number; sat: number } {
  const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue: Math.round(hue), sat: Math.round(max === 0 ? 0 : delta / max * 100) };
}

function hueSaturationToHex(hue: number, saturation: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const c = s;
  const x = c * (1 - Math.abs((normalizedHue / 60) % 2 - 1));
  const m = 1 - c;
  let rgb: [number, number, number] = [c, x, 0];
  if (normalizedHue >= 60 && normalizedHue < 120) rgb = [x, c, 0];
  else if (normalizedHue < 180) rgb = [0, c, x];
  else if (normalizedHue < 240) rgb = [0, x, c];
  else if (normalizedHue < 300) rgb = [x, 0, c];
  else if (normalizedHue >= 300) rgb = [c, 0, x];
  return `#${rgb.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

@action({ UUID: "com.deadfrogstudios.nanoleaflan.color-cycle" })
export class ColorCycleAction extends SingletonAction<Settings> {
  readonly #statusTimers = new Map<string, ReturnType<typeof setInterval>>();
  readonly #stateCache = new Map<string, { color: string; brightness: number; updatedAt: number }>();
  readonly #dialPending = new Map<string, {
    ticks: number;
    timer: ReturnType<typeof setTimeout>;
    action: DialRotateEvent<Settings>["action"];
    settings: Settings;
  }>();

  constructor(readonly manager: NanoleafDeviceManager, readonly clients: NanoleafClientFactory) {
    super();
  }

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    await this.#refresh(ev.action, ev.payload.settings);
    const existing = this.#statusTimers.get(ev.action.id);
    if (existing) clearInterval(existing);
    this.#statusTimers.set(ev.action.id, setInterval(() => {
      void ev.action.getSettings<Settings>().then((settings) => this.#refresh(ev.action, settings));
    }, 5_000));
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    await this.#refresh(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    await this.#cycle(ev.action, ev.payload.settings);
  }

  override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
    await this.#cycle(ev.action, ev.payload.settings);
  }

  override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
    await this.#cycle(ev.action, ev.payload.settings);
  }

  override onDialRotate(ev: DialRotateEvent<Settings>): void {
    const existing = this.#dialPending.get(ev.action.id);
    if (existing) clearTimeout(existing.timer);
    this.#dialPending.set(ev.action.id, {
      ticks: (existing?.ticks ?? 0) + ev.payload.ticks,
      action: ev.action,
      settings: ev.payload.settings,
      timer: setTimeout(() => { void this.#applyBrightness(ev.action.id); }, 120)
    });
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    const statusTimer = this.#statusTimers.get(ev.action.id);
    if (statusTimer) clearInterval(statusTimer);
    this.#statusTimers.delete(ev.action.id);
    const pending = this.#dialPending.get(ev.action.id);
    if (pending) clearTimeout(pending.timer);
    this.#dialPending.delete(ev.action.id);
  }

  async #cycle(
    actionInstance: KeyDownEvent<Settings>["action"] | DialDownEvent<Settings>["action"] | TouchTapEvent<Settings>["action"],
    settings: Settings
  ): Promise<void> {
    const deviceIds = await this.#deviceIds(settings);
    if (deviceIds.length === 0) {
      await actionInstance.showAlert();
      return;
    }
    const colors = normalizedColors(settings.colors);
    const index = Math.abs(Math.trunc(settings.nextColorIndex ?? 0)) % colors.length;
    const color = colors[index] ?? DEFAULT_COLOR;
    const { hue, sat } = hexToHueSaturation(color);
    const results = await Promise.allSettled(deviceIds.map(async (deviceId) => {
      const client = await this.clients.forDevice(deviceId);
      await client.updateState({
        on: { value: true },
        brightness: { value: Math.max(1, Math.min(100, settings.brightness ?? 100)) },
        hue: { value: hue },
        sat: { value: sat }
      });
    }));
    if (results.some((result) => result.status === "rejected")) {
      results.forEach((result) => { if (result.status === "rejected") streamDeck.logger.error(`Color cycle failed: ${String(result.reason)}`); });
      await actionInstance.showAlert();
      return;
    }
    const brightness = Math.max(1, Math.min(100, settings.brightness ?? 100));
    for (const deviceId of deviceIds) this.#stateCache.set(deviceId, { color, brightness, updatedAt: Date.now() });
    const nextColorIndex = (index + 1) % colors.length;
    const updatedSettings = { ...settings, colors, nextColorIndex, currentColor: color } as Settings;
    await actionInstance.setSettings(updatedSettings);
    await this.#refresh(actionInstance, updatedSettings);
  }

  async #applyBrightness(actionId: string): Promise<void> {
    const pending = this.#dialPending.get(actionId);
    if (!pending) return;
    this.#dialPending.delete(actionId);
    const deviceIds = await this.#deviceIds(pending.settings);
    if (deviceIds.length === 0) {
      await pending.action.showAlert();
      return;
    }
    const brightness = Math.max(1, Math.min(100, (pending.settings.brightness ?? 100) + pending.ticks * 5));
    const results = await Promise.allSettled(deviceIds.map(async (deviceId) => {
      const client = await this.clients.forDevice(deviceId);
      await client.updateState({ on: { value: true }, brightness: { value: brightness } });
    }));
    if (results.some((result) => result.status === "rejected")) {
      await pending.action.showAlert();
      return;
    }
    for (const deviceId of deviceIds) {
      const cached = this.#stateCache.get(deviceId);
      this.#stateCache.set(deviceId, {
        color: cached?.color ?? pending.settings.currentColor ?? DEFAULT_COLOR,
        brightness,
        updatedAt: Date.now()
      });
    }
    const updatedSettings = { ...pending.settings, brightness } as Settings;
    await pending.action.setSettings(updatedSettings);
    await this.#refresh(pending.action, updatedSettings);
  }

  override async onPropertyInspectorDidAppear(_ev: PropertyInspectorDidAppearEvent<Settings>): Promise<void> {
    await this.#sendTargets();
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
    if (!ev.payload || typeof ev.payload !== "object" || Array.isArray(ev.payload)) return;
    if ((ev.payload as JsonObject).command === "refresh") await this.#sendTargets();
  }

  async #sendTargets(): Promise<void> {
    const devices = await this.manager.list() as unknown as JsonObject[];
    const groups = await this.manager.listGroups() as unknown as JsonObject[];
    await streamDeck.ui.sendToPropertyInspector({ event: "targets", devices, groups });
  }

  async #deviceIds(settings: Settings): Promise<string[]> {
    if (!settings.targetId) return [];
    if (settings.targetType === "device") return [settings.targetId];
    if (settings.targetType === "group") return (await this.manager.listGroups()).find((group) => group.id === settings.targetId)?.devices ?? [];
    return [];
  }

  async #refresh(actionInstance: WillAppearEvent<Settings>["action"], settings: Settings): Promise<void> {
    const colors = normalizedColors(settings.colors);
    let currentColor = typeof settings.currentColor === "string" && HEX_COLOR.test(settings.currentColor)
      ? settings.currentColor
      : colors[0] ?? DEFAULT_COLOR;
    let brightness = Math.max(1, Math.min(100, settings.brightness ?? 100));
    if (settings.targetId) {
      try {
        const deviceId = (await this.#deviceIds(settings))[0];
        if (deviceId) {
          const cached = this.#stateCache.get(deviceId);
          if (cached) {
            currentColor = cached.color;
            brightness = cached.brightness;
          } else {
            const state = await (await this.clients.forDevice(deviceId)).getState();
            if (state.on.value) currentColor = hueSaturationToHex(state.hue.value, state.sat.value);
            brightness = Math.max(1, Math.min(100, Math.round(state.brightness.value)));
            this.#stateCache.set(deviceId, { color: currentColor, brightness, updatedAt: Date.now() });
          }
        }
      } catch (error) {
        streamDeck.logger.warn(`Unable to refresh Color Cycle state: ${String(error)}`);
      }
    }
    if (actionInstance.isKey()) {
      await actionInstance.setTitle(settings.targetId ? "" : "Configure");
      await this.#setImage(actionInstance, settings.targetId ? currentColor : "#3d4541", settings.targetId ? colors : []);
    } else if (actionInstance.isDial()) {
      await actionInstance.setFeedback({
        title: "Color Cycle",
        value: settings.targetId ? `${brightness}%` : "Configure",
        indicator: settings.targetId ? brightness : 0,
        icon: this.#dialIcon(settings.targetId ? currentColor : "#3d4541"),
        swatches: this.#dialSwatches(settings.targetId ? colors : [])
      });
    }
  }

  #dialIcon(color: string): string {
    const svg = nanoleafBulbSvg.replace("#ffffff", color);
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  #dialSwatches(colors: string[]): string {
    const circles = colors.slice(0, 3).map((color, index) =>
      `<circle cx="${13 + index * 12}" cy="15" r="9" fill="${color}" stroke="#fff" stroke-width="2"/>`
    ).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 30">${circles}</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  async #setImage(actionInstance: KeyDownEvent<Settings>["action"], color: string, colors: string[]): Promise<void> {
    const swatches = this.#colorSwatches(colors);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><path d="${NANOLEAF_BULB_PATH}" transform="translate(18 9) scale(4.5)" fill="${color}"/>${swatches}</svg>`;
    await actionInstance.setImage(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  }

  #colorSwatches(colors: string[]): string {
    return colors.slice(0, 3).map((swatch, index) =>
      `<circle cx="${94 + index * 14}" cy="22" r="11" fill="${swatch}" stroke="#fff" stroke-width="3"/>`
    ).join("");
  }
}
