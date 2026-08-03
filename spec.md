# Nanoleaf Stream Deck Plugin Specification

## Overview

Create a native Elgato Stream Deck plugin for Nanoleaf Matter Wi‑Fi
Essentials bulbs using the local HTTP OpenAPI.

### Goals

-   Local-only operation
-   Automatic discovery via mDNS
-   One-time pairing
-   No Home Assistant or Homebridge
-   No Matter SDK
-   User-defined groups
-   Individual light programming per action
-   Fast concurrent updates

## Discovery

Service: `_nanoleafapi._tcp.local`

Example TXT: - id=3807 - eui64=0000808AF7243C6D - md=NL75K1 -
srcvers=4.0.12

Use `eui64` as the permanent device identifier.

## Pairing

1.  Discover bulb.
2.  User clicks Pair.
3.  Plugin polls `POST /api/v1/new`.
4.  User taps **Connect to API** in the Nanoleaf app.
5.  Receive auth token.
6.  Verify using `GET /api/v1/{token}/state`.

## API

### Read state

`GET /api/v1/{token}/state`

Example response:

``` json
{
  "on":{"value":true},
  "brightness":{"value":100,"min":1,"max":100},
  "hue":{"value":0,"min":0,"max":360},
  "sat":{"value":100,"min":0,"max":100},
  "ct":{"value":3278,"min":2127,"max":6535},
  "colorMode":"hs"
}
```

Observations: - Sending hue/sat switches `colorMode` to `hs`. - Sending
`ct` switches `colorMode` to `ct`.

## Internal Model

### Device

``` json
{
  "eui64":"0000808AF7243C6D",
  "name":"Office Left",
  "host":"808AF7243C6D.local",
  "port":16021,
  "model":"NL75K1",
  "firmware":"4.0.12",
  "token":"<secure>"
}
```

### Group

``` json
{
  "name":"Office",
  "devices":["0000808AF7243C6D","0000808AF7999999"]
}
```

## Stream Deck Experience

Global manager: - Discover devices - Pair/unpair - Rename devices -
Create groups

Actions should **not** be fixed templates like 'Red Light'.

Instead every action stores the desired state for each individual light.

Example:

``` json
{
  "target":"Office",
  "lights":[
    {
      "device":"Office Left",
      "power":true,
      "brightness":35,
      "mode":"hs",
      "hue":0,
      "sat":100
    },
    {
      "device":"Office Right",
      "power":true,
      "brightness":60,
      "mode":"ct",
      "ct":4500
    }
  ]
}
```

## Runtime

-   Resolve devices by eui64
-   Discover current host via mDNS
-   Send concurrent PUT requests
-   Refresh state
-   Update button feedback

## Project Structure

``` text
src/
  actions/
  ui/
  nanoleaf/
    discovery.ts
    pairing.ts
    client.ts
    state.ts
    groups.ts
    settings.ts
```

## Development Phases

1.  Scaffold plugin and build pipeline.
2.  mDNS discovery.
3.  Pairing and secure token storage.
4.  HTTP client.
5.  Device manager and groups.
6.  Stream Deck actions.
7.  Live state/icons.
8.  Effects, Stream Deck+ support and Marketplace release.

## Design Principles

-   Local first
-   No static IPs
-   Secure token storage
-   Concurrent requests
-   Extensible architecture
-   Individual light programming
