import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { NanoleafGroup } from "../models.js";

export interface GroupRepository {
  list(): Promise<NanoleafGroup[]>;
  get(id: string): Promise<NanoleafGroup | undefined>;
  save(group: NanoleafGroup): Promise<void>;
  remove(id: string): Promise<void>;
}

interface GroupSettings extends JsonObject {
  groups?: Array<NanoleafGroup & JsonObject>;
}

export function validateGroupName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) throw new Error("Group name is required");
  if (normalized.length > 40) throw new Error("Group name must be 40 characters or fewer");
  return normalized;
}

export class StreamDeckGroupRepository implements GroupRepository {
  async list(): Promise<NanoleafGroup[]> {
    return (await streamDeck.settings.getGlobalSettings<GroupSettings>()).groups ?? [];
  }

  async get(id: string): Promise<NanoleafGroup | undefined> {
    return (await this.list()).find((group) => group.id === id);
  }

  async save(group: NanoleafGroup): Promise<void> {
    const settings = await streamDeck.settings.getGlobalSettings<GroupSettings>();
    const groups = (settings.groups ?? []).filter((item) => item.id !== group.id);
    groups.push(group as NanoleafGroup & JsonObject);
    await streamDeck.settings.setGlobalSettings({ ...settings, groups });
  }

  async remove(id: string): Promise<void> {
    const settings = await streamDeck.settings.getGlobalSettings<GroupSettings>();
    await streamDeck.settings.setGlobalSettings({
      ...settings,
      groups: (settings.groups ?? []).filter((group) => group.id !== id)
    });
  }
}
