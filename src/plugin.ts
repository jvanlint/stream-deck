import streamDeck from "@elgato/streamdeck";
import { ApplySceneAction } from "./actions/apply-scene.js";
import { LocalNanoleafClientFactory } from "./nanoleaf/client.js";
import { MdnsDiscoveryService } from "./nanoleaf/discovery.js";
import { NanoleafDeviceManager } from "./nanoleaf/device-manager.js";
import { StreamDeckGroupRepository } from "./nanoleaf/groups.js";
import { NanoleafPairingService } from "./nanoleaf/pairing.js";
import { PlatformTokenStore, StreamDeckDeviceRepository } from "./nanoleaf/settings.js";

streamDeck.logger.setLevel("info");
const discovery = new MdnsDiscoveryService();
const devices = new StreamDeckDeviceRepository();
const tokens = new PlatformTokenStore();
const groups = new StreamDeckGroupRepository();
const pairing = new NanoleafPairingService(devices, tokens, {
  onAttempt: (method, status) => streamDeck.logger.info(`Nanoleaf pairing ${method} returned HTTP ${status}`)
});
const manager = new NanoleafDeviceManager(discovery, devices, tokens, pairing, groups);
const clients = new LocalNanoleafClientFactory(devices, tokens, discovery);

streamDeck.actions.registerAction(new ApplySceneAction(manager, clients));
streamDeck.connect();
void manager.start().catch((error) => streamDeck.logger.error(`Nanoleaf discovery stopped: ${String(error)}`));
