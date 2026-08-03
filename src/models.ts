/** Stable identity and last-known network location for a paired bulb. */
export interface NanoleafDevice {
  eui64: string;
  name: string;
  host: string;
  port: number;
  model: string;
  firmware: string;
  /** Tokens must be persisted by a secure token store, never action settings. */
  token?: string;
}

export interface NanoleafGroup {
  id: string;
  name: string;
  /** Device EUI-64 identifiers, not names or IP addresses. */
  devices: string[];
}

export interface ValueRange {
  value: number;
  min: number;
  max: number;
}

export interface NanoleafState {
  on: { value: boolean };
  brightness: ValueRange;
  hue: ValueRange;
  sat: ValueRange;
  ct: ValueRange;
  colorMode: "hs" | "ct" | string;
}

export type LightProgram = {
  deviceId: string;
  power: boolean;
  brightness?: number;
} & (
  | { mode: "hs"; hue: number; sat: number; colorHex?: string }
  | { mode: "ct"; ct: number }
  | { mode?: undefined }
);

export interface SceneActionSettings {
  targetId?: string;
  targetType?: "device" | "group";
  lights?: LightProgram[];
}
