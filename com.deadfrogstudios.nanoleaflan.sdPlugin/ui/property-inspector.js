/* global WebSocket */
let websocket;
let actionContext;
let actionUUID;
let settings = {};
let operationTimer;
let currentDevices = [];
let currentGroups = [];

const devicesElement = document.querySelector("#devices");
const groupsElement = document.querySelector("#groups");
const emptyElement = document.querySelector("#empty");
const noGroupsElement = document.querySelector("#no-groups");
const summaryElement = document.querySelector("#summary");
const messageElement = document.querySelector("#message");
const targetElement = document.querySelector("#target");
const programsElement = document.querySelector("#programs");
const noTargetElement = document.querySelector("#no-target");

function sendPayload(payload) {
  websocket?.send(JSON.stringify({ event: "sendToPlugin", action: actionUUID, context: actionContext, payload }));
}

function send(command, deviceId) {
  sendPayload({ command, ...(deviceId ? { deviceId } : {}) });
}

function setMessage(message, error = false) {
  if (!message) clearTimeout(operationTimer);
  messageElement.textContent = message || "";
  messageElement.className = error ? "error" : "success";
}

function saveSettings() {
  websocket?.send(JSON.stringify({ event: "setSettings", context: actionContext, payload: settings }));
}

function selectedDeviceIds() {
  if (!settings.targetId) return [];
  if (settings.targetType === "device") return currentDevices.some((device) => device.paired && device.eui64 === settings.targetId) ? [settings.targetId] : [];
  const group = currentGroups.find((item) => item.id === settings.targetId);
  const paired = new Set(currentDevices.filter((device) => device.paired).map((device) => device.eui64));
  return group ? group.devices.filter((id) => paired.has(id)) : [];
}

function reconcilePrograms() {
  const existing = new Map((settings.lights || []).map((program) => [program.deviceId, { ...program, power: true }]));
  const ids = selectedDeviceIds();
  const lights = ids.map((deviceId) => existing.get(deviceId) || { deviceId, power: true, brightness: 100, mode: "ct", ct: 4000 });
  const changed = JSON.stringify(lights) !== JSON.stringify(settings.lights || []);
  settings.lights = lights;
  return changed;
}

function numberField(labelText, value, min, max, onChange) {
  const label = document.createElement("label");
  label.className = "control-field";
  const text = document.createElement("span");
  text.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener("change", () => onChange(Math.min(max, Math.max(min, Number(input.value)))));
  label.append(text, input);
  return label;
}

function sliderField(labelText, value, min, max, onChange) {
  const field = document.createElement("label");
  field.className = "slider-field";
  const header = document.createElement("span");
  const title = document.createElement("span");
  title.textContent = labelText;
  const output = document.createElement("output");
  output.textContent = `${value}%`;
  header.append(title, output);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener("input", () => { output.textContent = `${input.value}%`; });
  input.addEventListener("change", () => onChange(Number(input.value)));
  field.append(header, input);
  return field;
}

function hsvToHex(hue, saturation) {
  const s = saturation / 100;
  const c = s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = 1 - c;
  let rgb = [c, x, 0];
  if (hue >= 60 && hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else if (hue >= 300) rgb = [c, 0, x];
  return `#${rgb.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsv(hex) {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue: Math.round(hue), sat: Math.round(max === 0 ? 0 : delta / max * 100) };
}

const colourSwatches = [
  ["Red", "#ff0000"], ["Orange", "#ff8000"], ["Yellow", "#ffff00"],
  ["Green", "#00ff00"], ["Cyan", "#00ffff"], ["Blue", "#0066ff"],
  ["Purple", "#8000ff"], ["Pink", "#ff0080"], ["White", "#ffffff"]
];

function renderScene() {
  const previous = targetElement.value;
  targetElement.replaceChildren(new Option("Select a paired bulb or group", ""));
  const paired = currentDevices.filter((device) => device.paired);
  if (paired.length) {
    const devicesGroup = document.createElement("optgroup");
    devicesGroup.label = "Bulbs";
    paired.forEach((device) => devicesGroup.append(new Option(device.name, `device:${device.eui64}`)));
    targetElement.append(devicesGroup);
  }
  if (currentGroups.length) {
    const groupsGroup = document.createElement("optgroup");
    groupsGroup.label = "Groups";
    currentGroups.forEach((group) => groupsGroup.append(new Option(group.name, `group:${group.id}`)));
    targetElement.append(groupsGroup);
  }
  targetElement.value = settings.targetId ? `${settings.targetType}:${settings.targetId}` : previous;
  const changed = reconcilePrograms();
  programsElement.replaceChildren();
  noTargetElement.hidden = settings.lights?.length > 0;

  for (const program of settings.lights || []) {
    const device = currentDevices.find((item) => item.eui64 === program.deviceId);
    const card = document.createElement("article");
    card.className = "program-card";
    const title = document.createElement("strong");
    title.textContent = device?.name || program.deviceId;
    card.append(title);

    const toggleHint = document.createElement("small");
    toggleHint.className = "toggle-hint";
    toggleHint.textContent = "Press: apply this scene · Press again: turn off";
    card.append(toggleHint);
    card.append(sliderField("Brightness", program.brightness ?? 100, 1, 100, (value) => { program.brightness = value; saveSettings(); }));

    const modeLabel = document.createElement("label");
    modeLabel.className = "control-field";
    const modeText = document.createElement("span");
    modeText.textContent = "Colour mode";
    const mode = document.createElement("select");
    mode.append(new Option("Keep current colour", "none"), new Option("Hue / saturation", "hs"), new Option("Colour temperature", "ct"));
    mode.value = program.mode || "none";
    mode.addEventListener("change", () => {
      if (mode.value === "hs") Object.assign(program, {
        mode: "hs",
        hue: program.hue ?? 0,
        sat: program.sat ?? 100,
        colorHex: program.colorHex || hsvToHex(program.hue ?? 0, program.sat ?? 100)
      });
      else if (mode.value === "ct") {
        Object.assign(program, { mode: "ct", ct: program.ct ?? 4000 });
        delete program.hue; delete program.sat; delete program.colorHex;
      } else {
        delete program.mode; delete program.hue; delete program.sat; delete program.ct; delete program.colorHex;
      }
      saveSettings();
      renderScene();
    });
    modeLabel.append(modeText, mode);
    card.append(modeLabel);

    if (program.mode === "hs") {
      const colourRow = document.createElement("div");
      colourRow.className = "colour-row";
      const colourLabel = document.createElement("label");
      colourLabel.textContent = "Colour";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = /^#[0-9a-f]{6}$/i.test(program.colorHex || "") ? program.colorHex : hsvToHex(program.hue, program.sat);
      picker.addEventListener("input", () => {
        Object.assign(program, hexToHsv(picker.value), { colorHex: picker.value });
        saveSettings();
      });
      picker.addEventListener("change", renderScene);
      colourLabel.append(picker);
      const palette = document.createElement("div");
      palette.className = "swatches";
      for (const [swatchName, colour] of colourSwatches) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "swatch";
        swatch.title = swatchName;
        swatch.setAttribute("aria-label", swatchName);
        swatch.style.backgroundColor = colour;
        swatch.addEventListener("click", () => {
          Object.assign(program, hexToHsv(colour), { colorHex: colour });
          saveSettings();
          renderScene();
        });
        palette.append(swatch);
      }
      colourRow.append(colourLabel, palette);
      card.append(colourRow);
      card.append(sliderField("Saturation", program.sat, 0, 100, (value) => {
        program.sat = value;
        program.colorHex = hsvToHex(program.hue, program.sat);
        saveSettings();
        renderScene();
      }));
    } else if (program.mode === "ct") {
      card.append(numberField("Temperature", program.ct, 2127, 6535, (value) => { program.ct = value; saveSettings(); }));
    }
    programsElement.append(card);
  }
  if (changed) saveSettings();
}

function renderDevices() {
  clearTimeout(operationTimer);
  devicesElement.replaceChildren();
  emptyElement.hidden = currentDevices.length !== 0;
  summaryElement.textContent = `${currentDevices.length} bulb${currentDevices.length === 1 ? "" : "s"} discovered`;
  if (!currentDevices.some((device) => device.paired)) document.querySelector("#plugin-setup").open = true;

  for (const device of currentDevices) {
    const card = document.createElement("article");
    card.className = "device stacked";
    const header = document.createElement("div");
    header.className = "device-header";
    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = device.name;
    const metadata = document.createElement("small");
    metadata.textContent = `${device.model || "Nanoleaf"} · ${device.host}:${device.port}`;
    const identity = document.createElement("small");
    identity.textContent = device.eui64;
    details.append(name, metadata, identity);
    const pairButton = document.createElement("button");
    pairButton.type = "button";
    pairButton.className = device.paired ? "secondary" : "primary";
    pairButton.textContent = device.paired ? "Unpair" : "Pair";
    pairButton.addEventListener("click", () => {
      pairButton.disabled = true;
      pairButton.textContent = device.paired ? "Unpairing…" : "Pairing…";
      setMessage(device.paired ? "Removing authorization…" : "Waiting for Nanoleaf authorization…");
      send(device.paired ? "unpair" : "pair", device.eui64);
    });
    header.append(details, pairButton);

    const rename = document.createElement("div");
    rename.className = "rename-row";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 40;
    input.value = device.name;
    input.setAttribute("aria-label", `Nickname for ${device.name}`);
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save name";
    save.addEventListener("click", () => sendPayload({ command: "renameDevice", deviceId: device.eui64, name: input.value }));
    rename.append(input, save);
    card.append(header, rename);
    devicesElement.append(card);
  }
}

function renderGroups() {
  groupsElement.replaceChildren();
  noGroupsElement.hidden = currentGroups.length !== 0;
  for (const group of currentGroups) {
    const card = document.createElement("article");
    card.className = "group-card";
    const nameRow = document.createElement("div");
    nameRow.className = "rename-row";
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 40;
    name.value = group.name;
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", () => sendPayload({ command: "renameGroup", groupId: group.id, name: name.value }));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => sendPayload({ command: "deleteGroup", groupId: group.id }));
    nameRow.append(name, save, remove);
    card.append(nameRow);

    const paired = currentDevices.filter((device) => device.paired);
    if (paired.length === 0) {
      const hint = document.createElement("small");
      hint.textContent = "Pair bulbs before adding them to a group.";
      card.append(hint);
    }
    for (const device of paired) {
      const label = document.createElement("label");
      label.className = "member";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = group.devices.includes(device.eui64);
      checkbox.addEventListener("change", () => {
        const selected = [...card.querySelectorAll('input[type="checkbox"]:checked')].map((element) => element.value);
        sendPayload({ command: "setGroupDevices", groupId: group.id, deviceIds: selected });
      });
      checkbox.value = device.eui64;
      label.append(checkbox, document.createTextNode(device.name));
      card.append(label);
    }
    groupsElement.append(card);
  }
}

window.connectElgatoStreamDeckSocket = function (port, propertyInspectorUUID, registerEvent, info, actionInfo) {
  actionContext = propertyInspectorUUID;
  const parsedAction = JSON.parse(actionInfo);
  actionUUID = parsedAction.action;
  settings = parsedAction.payload.settings || {};
  websocket = new WebSocket(`ws://127.0.0.1:${port}`);
  websocket.addEventListener("open", () => {
    websocket.send(JSON.stringify({ event: registerEvent, uuid: propertyInspectorUUID }));
    send("refresh");
  });
  websocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data).payload;
    if (!payload) return;
    if (payload.event === "devices") {
      currentDevices = Array.isArray(payload.devices) ? payload.devices : [];
      currentGroups = Array.isArray(payload.groups) ? payload.groups : [];
      renderDevices();
      renderGroups();
      renderScene();
      if (payload.message) setMessage(payload.message);
    } else if (payload.event === "status") {
      setMessage(payload.command === "pair" || payload.command === "pairAvailable" ? "Waiting for Nanoleaf authorization…" : "Removing authorization…");
    } else if (payload.event === "error") {
      clearTimeout(operationTimer);
      setMessage(payload.message || "Operation failed", true);
    }
  });
};

document.querySelector("#refresh").addEventListener("click", () => send("refresh"));
targetElement.addEventListener("change", () => {
  const [targetType, targetId] = targetElement.value.split(":");
  if (!targetId) {
    delete settings.targetType;
    delete settings.targetId;
    settings.lights = [];
  } else {
    settings.targetType = targetType;
    settings.targetId = targetId;
    settings.lights = [];
  }
  reconcilePrograms();
  saveSettings();
  renderScene();
});
document.querySelector("#pair-open").addEventListener("click", () => {
  setMessage("Checking discovered bulbs for an open pairing window…");
  send("pairAvailable");
});
document.querySelector("#create-group").addEventListener("click", () => {
  const input = document.querySelector("#group-name");
  sendPayload({ command: "createGroup", name: input.value });
  input.value = "";
});
document.querySelector("#add-manual").addEventListener("click", () => {
  const host = document.querySelector("#host").value.trim();
  if (!host) return setMessage("Enter the bulb IP address", true);
  setMessage("Adding bulb…");
  settings.manualHostRequest = host;
  websocket?.send(JSON.stringify({ event: "setSettings", context: actionContext, payload: settings }));
  clearTimeout(operationTimer);
  operationTimer = setTimeout(() => setMessage("The plugin did not respond. Restart Stream Deck and try again.", true), 8000);
});
