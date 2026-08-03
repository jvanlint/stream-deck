# Nanoleaf Essentials for Stream Deck

A local-first Stream Deck plugin for Nanoleaf Matter Wi-Fi Essentials bulbs. The intended runtime discovers bulbs with mDNS, pairs with Nanoleaf's local HTTP API, and applies per-light programs concurrently without Home Assistant, Homebridge, or a Matter SDK.

The project is currently at **Phase 7: live state and icons**. Each key toggles its configured scene based on actual bulb state: when all targets are off it applies the scene, and when any target is on it turns the target off. Visible keys refresh state periodically and display dim, configured-colour, or warning imagery for off, on, and unreachable states.

## Prerequisites

- Node.js 20 or newer
- Elgato Stream Deck 6.6 or newer

## Develop

```powershell
npm install
npm test
npm run build
npm run validate
```

With the development plugin loaded, select an Apply Light Scene key to see discovered bulbs. Tap **Connect to API** in the Nanoleaf app and click **Pair** in the Property Inspector. Discovery requires the computer and bulbs to be on the same multicast-capable LAN; guest Wi-Fi and client isolation commonly block mDNS.

The build writes `com.jason.nanoleaf.sdPlugin/bin/plugin.js`. During development, link or copy the `com.jason.nanoleaf.sdPlugin` directory into Stream Deck's plugins directory, then restart Stream Deck. The Stream Deck CLI can also validate and package it with `npm run pack`.

## Architecture

- `src/actions` — Stream Deck action handlers
- `src/nanoleaf` — discovery, pairing, HTTP, state, groups, and persistence boundaries
- `src/models.ts` — shared domain and action-setting types
- `com.jason.nanoleaf.sdPlugin/ui` — Property Inspector
- `tests` — unit tests for runtime-independent behavior
- `docs/spec.md` — product specification and phased roadmap

Device references use stable EUI-64 identifiers. IP addresses and `.local` hostnames are treated only as refreshable network locations. Authentication tokens must not be written to action or global settings; Phase 3 will supply a platform-backed `TokenStore`.
