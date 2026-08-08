# Nanoleaf LAN

[![Stream Deck 6.9+](https://img.shields.io/badge/Stream%20Deck-6.9%2B-0097D7)](https://www.elgato.com/s/downloads)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Control Nanoleaf Matter Wi-Fi Essentials bulbs directly from an Elgato Stream Deck—locally, quickly, and without Home Assistant, Homebridge, cloud services, or a Matter SDK.

The plugin discovers bulbs over mDNS and pairs with Nanoleaf's local HTTP API. **Set Color** applies a configured colour, colour temperature, and brightness to a bulb or group. **Color Cycle** advances through a user-defined colour list, with green, red, and blue supplied by default.

Developed by [Dead Frog Studios](https://deadfrogstudios.com).

> [!NOTE]
> This project is under active development. It currently targets Nanoleaf Matter Wi-Fi Essentials bulbs that expose Nanoleaf's local HTTP OpenAPI.

## Features

- Local network control with no cloud dependency
- Automatic bulb discovery using `_nanoleafapi._tcp.local`
- Manual IP address fallback when mDNS is unavailable
- One-time pairing through the Nanoleaf app
- Secure token storage with Windows DPAPI or macOS Keychain
- User-defined bulb groups and friendly device names
- **Set Color** action for power, brightness, colour, and colour-temperature scenes
- **Color Cycle** action with an editable colour list and green, red, and blue defaults
- Concurrent scene updates for responsive multi-light control
- Live key status with on, off, unconfigured, and unavailable states
- Key indicators that show configured colours even when a bulb is off
- Stream Deck+ support for both actions
- Custom Color Cycle LCD layout with current-colour bulb, cycle swatches, and brightness bar
- Dial press or touchscreen tap to activate; dial rotation adjusts brightness in 5% steps
- Stable device identity based on EUI-64 rather than changing IP addresses

## Requirements

- Elgato Stream Deck 6.9 or newer
- Windows 10 or newer, or macOS 12 or newer
- A Nanoleaf Matter Wi-Fi Essentials bulb on the same local network as the computer
- Node.js 20 or newer when building from source

Your network must allow multicast traffic for automatic discovery. Guest networks, VLAN boundaries, and Wi-Fi client isolation commonly block mDNS; the plugin also supports adding a bulb by IP address.

## Install from source

Clone the repository and install its pinned dependencies:

```shell
git clone https://github.com/jvanlint/stream-deck.git
cd stream-deck
npm ci
```

Build, validate, and package the plugin:

```shell
npm run build
npm run validate
npm run pack
```

The package command creates `com.deadfrogstudios.nanoleaflan.streamDeckPlugin` in the repository root. This is the file to install locally or upload to the Stream Deck Marketplace. The marketplace's `*.streamdeckplugin` file filter is case-insensitive.

For development, link the plugin directory instead:

```shell
npx streamdeck link com.deadfrogstudios.nanoleaflan.sdPlugin
```

Restart Stream Deck after linking if the plugin does not appear immediately.

If you test by manually copying files, copy the complete `com.deadfrogstudios.nanoleaflan.sdPlugin` directory after every build, replacing the existing plugin directory, and restart Stream Deck. The `.streamDeckPlugin` package is not required for this local folder-copy workflow.

## Set up a control

1. Drag **Set Color** from the **Nanoleaf LAN** category onto a key or Stream Deck+ dial.
2. Open the action's Property Inspector and expand **Plugin setup**.
3. Wait for your bulb to appear. If discovery fails, add its IP address manually.
4. In the Nanoleaf app, open the bulb's settings and tap **Connect to API**.
5. Click **Pair bulb with open window** in the Property Inspector.
6. Optionally rename bulbs or create a group.
7. Select a paired bulb or group and configure its colour and brightness.

Pairing and groups are shared by every Nanoleaf control. Scene settings belong to the individual key or dial, so the same group can have several different looks.

### Set Color behaviour

- **Key press, dial press, or touchscreen tap:** if every target bulb already matches the configured scene, turn the targets off; otherwise apply the scene immediately.
- **Dial rotation:** adjust configured brightness in 5% increments and switch the target bulbs on.
- **Key image:** shows the current on/off state, configured colour, or a warning when a bulb cannot be reached.

## Set up Color Cycle

1. Drag **Color Cycle** onto a key or Stream Deck+ dial.
2. Select a paired bulb or group in the Property Inspector.
3. Edit the colour circles. Use **+** to append a colour and **−** to remove the last colour.
4. Press the key or dial to apply the next colour.

Color Cycle starts with green, red, and blue. Its key shows the currently applied colour plus up to three overlapping cycle swatches. On Stream Deck+, the LCD places those swatches in the tile's upper-right corner and shows the current brightness as a percentage and progress bar.

### Color Cycle behaviour

- **Key press, dial press, or touchscreen tap:** apply the next configured colour and advance the saved cycle position.
- **Dial rotation:** adjust brightness in 5% increments without changing the current colour.
- **Key and LCD bulb:** show the colour most recently applied by Color Cycle.
- **Cycle swatches:** show up to the first three configured colours.

## Development

```shell
npm test          # Run the test suite once
npm run test:watch
npm run typecheck
npm run build
npm run validate
```

The Vitest suite is isolated from the network: HTTP requests, mDNS discovery, repositories, and Nanoleaf clients are replaced with test doubles. It covers the core logic but is not an end-to-end hardware test. Discovery, pairing, secure credential storage, and real bulb behaviour still need to be checked manually on a local LAN with your own devices and Stream Deck installation.

The build type-checks the source and bundles the runtime to `com.deadfrogstudios.nanoleaflan.sdPlugin/bin/plugin.js`.

### Project structure

```text
com.deadfrogstudios.nanoleaflan.sdPlugin/
  manifest.json             Stream Deck plugin manifest
  layouts/                  Custom Stream Deck+ LCD layouts
  static/                   Plugin and action artwork
  ui/                       Property Inspector
src/
  actions/                  Stream Deck action handlers
  nanoleaf/                 Discovery, pairing, API, state, and persistence
  models.ts                 Shared domain and settings types
  plugin.ts                 Runtime entry point
tests/                      Vitest unit tests
docs/spec.md                Product specification and roadmap
scripts/build.mjs           esbuild bundle configuration
```

See the [product specification](docs/spec.md) for the protocol details, internal model, and roadmap.

## Security and privacy

The plugin communicates with bulbs only over the local network. Nanoleaf authentication tokens are never stored in per-action settings: Windows protects them with DPAPI for the current user, while macOS stores them in Keychain. Device metadata, groups, and action configuration are stored through Stream Deck's settings APIs.

## Troubleshooting

### No bulbs are discovered

- Confirm the computer and bulb are on the same LAN.
- Disable guest-network or client-isolation features that prevent devices from communicating.
- Ensure multicast/mDNS traffic is allowed between the devices.
- Use **Bulb not discovered?** in the Property Inspector to add the bulb's IPv4 address.

### Pairing fails

- Start **Connect to API** in the Nanoleaf app immediately before clicking the pairing button.
- Confirm the bulb is reachable from the computer and retry while the pairing window is open.
- If the bulb's address changed, refresh discovery or add its current address manually.

### A key shows a warning

The plugin could not read one or more configured bulbs. Check that the bulbs are powered, online, and still reachable on the local network.

## Contributing

Issues and pull requests are welcome. For code changes:

1. Create a focused branch.
2. Add or update tests for the changed behaviour.
3. Run `npm test`, `npm run typecheck`, and `npm run validate`.
4. Manually verify hardware-facing changes on a compatible Nanoleaf bulb when possible.
5. Open a pull request describing the user-facing change, test environment, and how it was verified.

Please do not commit logs, `node_modules`, or local credentials. Generated `.streamDeckPlugin` packages should only be committed when the release process explicitly requires them.

## Acknowledgements

Created by [Dead Frog Studios](https://deadfrogstudios.com). Built with the [Elgato Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/) and Nanoleaf's local OpenAPI.
