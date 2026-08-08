import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  SingletonAction,
  type WillAppearEvent
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

@action({ UUID: "com.deadfrogstudios.nanoleaflan.color-cycle" })
export class ColorCycleAction extends SingletonAction<Settings> {
  constructor(readonly manager: NanoleafDeviceManager, readonly clients: NanoleafClientFactory) {
    super();
  }

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    await this.#refresh(ev.action, ev.payload.settings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    await this.#refresh(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const settings = ev.payload.settings;
    const deviceIds = await this.#deviceIds(settings);
    if (deviceIds.length === 0) {
      await ev.action.showAlert();
      return;
    }
    const colors = normalizedColors(settings.colors);
    const index = Math.abs(Math.trunc(settings.nextColorIndex ?? 0)) % colors.length;
    const color = colors[index] ?? DEFAULT_COLOR;
    const { hue, sat } = hexToHueSaturation(color);
    const results = await Promise.allSettled(deviceIds.map(async (deviceId) => {
      const client = await this.clients.forDevice(deviceId);
      await client.updateState({ on: { value: true }, hue: { value: hue }, sat: { value: sat } });
    }));
    if (results.some((result) => result.status === "rejected")) {
      results.forEach((result) => { if (result.status === "rejected") streamDeck.logger.error(`Color cycle failed: ${String(result.reason)}`); });
      await ev.action.showAlert();
      return;
    }
    const nextColorIndex = (index + 1) % colors.length;
    await ev.action.setSettings({ ...settings, colors, nextColorIndex });
    await this.#setImage(ev.action, colors[nextColorIndex] ?? DEFAULT_COLOR);
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
    const index = Math.abs(Math.trunc(settings.nextColorIndex ?? 0)) % colors.length;
    if (actionInstance.isKey()) {
      await actionInstance.setTitle(settings.targetId ? "Cycle" : "Configure");
      await this.#setImage(actionInstance, settings.targetId ? colors[index] ?? DEFAULT_COLOR : "#3d4541");
    }
  }

  async #setImage(actionInstance: KeyDownEvent<Settings>["action"], color: string): Promise<void> {
    const svg = nanoleafBulbSvg.replace("#ffffff", color);
    await actionInstance.setImage(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  }
}
