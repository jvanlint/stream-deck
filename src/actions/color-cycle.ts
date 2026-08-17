import streamDeck, {
  action,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type KeyUpEvent,
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
import { configurationBulbDataUrl } from "../icons/configuration-cog.js";
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

export function hueSaturationToHex(hue: number, saturation: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const c = s;
  const x = c * (1 - Math.abs((normalizedHue / 60) % 2 - 1));
  const m = 1 - c;
  let rgb: [number, number, number];
  if (normalizedHue < 60) rgb = [c, x, 0];
  else if (normalizedHue < 120) rgb = [x, c, 0];
  else if (normalizedHue < 180) rgb = [0, c, x];
  else if (normalizedHue < 240) rgb = [0, x, c];
  else if (normalizedHue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return `#${rgb.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function settingsForObservedColor(settings: Settings, colors: string[], observedColor: string): Settings {
  const matchingIndex = colors.findIndex((color) => color.toLowerCase() === observedColor.toLowerCase());
  return {
    ...settings,
    currentColor: observedColor,
    ...(matchingIndex >= 0 ? { nextColorIndex: (matchingIndex + 1) % colors.length } : {})
  } as Settings;
}

export function selectCycleColor(
  settings: Pick<ColorCycleActionSettings, "currentColor" | "nextColorIndex">,
  colors: string[],
  restoreCurrentColor: boolean
): { color: string; nextColorIndex: number } {
  const index = Math.abs(Math.trunc(settings.nextColorIndex ?? 0)) % colors.length;
  if (restoreCurrentColor && typeof settings.currentColor === "string" && HEX_COLOR.test(settings.currentColor)) {
    return { color: settings.currentColor, nextColorIndex: index };
  }
  return { color: colors[index] ?? DEFAULT_COLOR, nextColorIndex: (index + 1) % colors.length };
}

@action({ UUID: "com.deadfrogstudios.nanoleaflan.color-cycle" })
export class ColorCycleAction extends SingletonAction<Settings> {
  readonly #statusTimers = new Map<string, ReturnType<typeof setInterval>>();
  readonly #stateCache = new Map<string, { color: string; brightness: number; on: boolean; checkedAt: number }>();
  readonly #dialPending = new Map<string, {
    ticks: number;
    timer: ReturnType<typeof setTimeout>;
    action: DialRotateEvent<Settings>["action"];
    settings: Settings;
  }>();
  readonly #keyPresses = new Map<string, {
    longPress: boolean;
    settings: Settings;
    timer: ReturnType<typeof setTimeout>;
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

  override onKeyDown(ev: KeyDownEvent<Settings>): void {
    const existing = this.#keyPresses.get(ev.action.id);
    if (existing) clearTimeout(existing.timer);
    const press = {
      longPress: false,
      settings: ev.payload.settings,
      timer: setTimeout(() => {
        press.longPress = true;
        void this.#turnOff(ev.action, press.settings);
      }, 750)
    };
    this.#keyPresses.set(ev.action.id, press);
  }

  override async onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> {
    const press = this.#keyPresses.get(ev.action.id);
    if (!press) return;
    clearTimeout(press.timer);
    this.#keyPresses.delete(ev.action.id);
    if (!press.longPress) await this.#cycle(ev.action, ev.payload.settings);
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
    const keyPress = this.#keyPresses.get(ev.action.id);
    if (keyPress) clearTimeout(keyPress.timer);
    this.#keyPresses.delete(ev.action.id);
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
    const restoreCurrentColor = deviceIds.every((deviceId) => this.#stateCache.get(deviceId)?.on === false);
    const { color, nextColorIndex } = selectCycleColor(settings, colors, restoreCurrentColor);
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
    for (const deviceId of deviceIds) this.#stateCache.set(deviceId, { color, brightness, on: true, checkedAt: Date.now() });
    const updatedSettings = { ...settings, colors, nextColorIndex, currentColor: color } as Settings;
    await actionInstance.setSettings(updatedSettings);
    await this.#refresh(actionInstance, updatedSettings);
  }

  async #turnOff(actionInstance: KeyDownEvent<Settings>["action"], settings: Settings): Promise<void> {
    const deviceIds = await this.#deviceIds(settings);
    if (deviceIds.length === 0) {
      await actionInstance.showAlert();
      return;
    }
    const results = await Promise.allSettled(deviceIds.map(async (deviceId) => {
      const client = await this.clients.forDevice(deviceId);
      await client.updateState({ on: { value: false } });
    }));
    if (results.some((result) => result.status === "rejected")) {
      await actionInstance.showAlert();
      return;
    }
    for (const deviceId of deviceIds) {
      const cached = this.#stateCache.get(deviceId);
      this.#stateCache.set(deviceId, {
        color: cached?.color ?? settings.currentColor ?? DEFAULT_COLOR,
        brightness: cached?.brightness ?? settings.brightness ?? 100,
        on: false,
        checkedAt: Date.now()
      });
    }
    await this.#refresh(actionInstance, settings);
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
        on: true,
        checkedAt: Date.now()
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
    if (!settings.targetId) {
      await this.#showConfigurationIcon(actionInstance);
      return;
    }
    let currentColor = typeof settings.currentColor === "string" && HEX_COLOR.test(settings.currentColor)
      ? settings.currentColor
      : colors[0] ?? DEFAULT_COLOR;
    let brightness = Math.max(1, Math.min(100, settings.brightness ?? 100));
    let on = true;
    let synchronizedSettings = settings;
    let primaryDeviceId: string | undefined;
    if (settings.targetId) {
      try {
        const deviceId = (await this.#deviceIds(settings))[0];
        primaryDeviceId = deviceId;
        if (deviceId) {
          const cached = this.#stateCache.get(deviceId);
          if (cached) {
            currentColor = cached.color;
            brightness = cached.brightness;
            on = cached.on;
          }
          if (!cached || Date.now() - cached.checkedAt >= 2_000) {
            const state = await (await this.clients.forDevice(deviceId)).getState();
            on = state.on.value;
            streamDeck.logger.info(
              `Color Cycle state ${deviceId}: on=${state.on.value} mode=${state.colorMode} hue=${state.hue.value} sat=${state.sat.value}`
            );
            if (on) {
              currentColor = hueSaturationToHex(state.hue.value, state.sat.value);
              synchronizedSettings = settingsForObservedColor(settings, colors, currentColor);
            }
            brightness = Math.max(1, Math.min(100, Math.round(state.brightness.value)));
            this.#stateCache.set(deviceId, { color: currentColor, brightness, on, checkedAt: Date.now() });
          }
        }
      } catch (error) {
        streamDeck.logger.warn(`Unable to refresh Color Cycle state: ${String(error)}`);
      }
    }
    // Refreshes can overlap when timers and settings events arrive together. Always
    // render the newest shared device state so an older callback cannot repaint a
    // freshly synchronized red icon with the green value it captured earlier.
    const latest = primaryDeviceId ? this.#stateCache.get(primaryDeviceId) : undefined;
    if (latest) {
      currentColor = latest.color;
      brightness = latest.brightness;
      on = latest.on;
    }
    if (actionInstance.isKey()) {
      await actionInstance.setTitle("");
      streamDeck.logger.info(`Color Cycle key ${actionInstance.id}: rendering ${on ? currentColor : "OFF"} for target ${settings.targetId}`);
      await this.#setImage(actionInstance, on ? currentColor : "#3d4541", colors, on);
    } else if (actionInstance.isDial()) {
      await actionInstance.setFeedback({
        title: "Color Cycle",
        value: settings.targetId ? on ? `${brightness}%` : "OFF" : "Configure",
        indicator: settings.targetId && on ? brightness : 0,
        icon: this.#dialIcon(settings.targetId && on ? currentColor : "#3d4541"),
        swatches: this.#dialSwatches(settings.targetId ? colors : [])
      });
    }
    if (synchronizedSettings.currentColor !== settings.currentColor
      || synchronizedSettings.nextColorIndex !== settings.nextColorIndex) {
      await actionInstance.setSettings(synchronizedSettings);
    }
  }

  #dialIcon(color: string): string {
    const svg = nanoleafBulbSvg.replace("#ffffff", color);
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  async #showConfigurationIcon(actionInstance: WillAppearEvent<Settings>["action"]): Promise<void> {
    if (actionInstance.isKey()) {
      await actionInstance.setTitle("");
      await actionInstance.setImage(configurationBulbDataUrl());
    } else if (actionInstance.isDial()) {
      await actionInstance.setFeedback({ title: "", value: "", indicator: 0, icon: configurationBulbDataUrl(false), swatches: this.#dialSwatches([]) });
    }
  }

  #dialSwatches(colors: string[]): string {
    const circles = colors.slice(0, 3).map((color, index) =>
      `<circle cx="${13 + index * 12}" cy="15" r="9" fill="${color}" stroke="#fff" stroke-width="2"/>`
    ).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 30">${circles}</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  async #setImage(actionInstance: KeyDownEvent<Settings>["action"], color: string, colors: string[], on: boolean): Promise<void> {
    const swatches = this.#colorSwatches(colors);
    const offMark = on ? "" : '<rect x="49" y="60" width="46" height="24" rx="7" fill="#d7dcda"/><text x="72" y="77" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#151b18">OFF</text>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><path d="${NANOLEAF_BULB_PATH}" transform="translate(18 9) scale(4.5)" fill="${color}"/>${offMark}${swatches}</svg>`;
    await actionInstance.setImage(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  }

  #colorSwatches(colors: string[]): string {
    return colors.slice(0, 3).map((swatch, index) =>
      `<circle cx="${94 + index * 14}" cy="22" r="11" fill="${swatch}" stroke="#fff" stroke-width="3"/>`
    ).join("");
  }
}
