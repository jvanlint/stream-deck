/* global WebSocket */
let websocket;
let actionContext;
let actionUUID;
let settings = {};
let devices = [];
let groups = [];

const defaultColors = ["#00ff00", "#ff0000", "#0000ff"];
const target = document.querySelector("#cycle-target");
const colorList = document.querySelector("#cycle-color-list");
const message = document.querySelector("#cycle-message");

function sendPayload(payload) {
  websocket?.send(JSON.stringify({ event: "sendToPlugin", action: actionUUID, context: actionContext, payload }));
}

function saveSettings() {
  websocket?.send(JSON.stringify({ event: "setSettings", context: actionContext, payload: settings }));
}

function renderTargets() {
  target.replaceChildren(new Option("Select a paired bulb or group", ""));
  const paired = devices.filter((device) => device.paired);
  if (paired.length) {
    const deviceOptions = document.createElement("optgroup");
    deviceOptions.label = "Bulbs";
    paired.forEach((device) => deviceOptions.append(new Option(device.name, `device:${device.eui64}`)));
    target.append(deviceOptions);
  }
  if (groups.length) {
    const groupOptions = document.createElement("optgroup");
    groupOptions.label = "Groups";
    groups.forEach((group) => groupOptions.append(new Option(group.name, `group:${group.id}`)));
    target.append(groupOptions);
  }
  target.value = settings.targetId ? `${settings.targetType}:${settings.targetId}` : "";
  message.textContent = paired.length === 0 ? "Pair bulbs using the Apply Light Scene plugin setup first." : "";
}

function renderColors() {
  colorList.replaceChildren();
  settings.colors.forEach((color, index) => {
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = color;
    picker.setAttribute("aria-label", `Cycle color ${index + 1}`);
    picker.addEventListener("input", () => {
      settings.colors[index] = picker.value;
      settings.nextColorIndex = 0;
      saveSettings();
    });
    colorList.append(picker);
  });
  document.querySelector("#remove-cycle-color").disabled = settings.colors.length <= 1;
}

window.connectElgatoStreamDeckSocket = function (port, propertyInspectorUUID, registerEvent, info, actionInfo) {
  actionContext = propertyInspectorUUID;
  const parsedAction = JSON.parse(actionInfo);
  actionUUID = parsedAction.action;
  settings = parsedAction.payload.settings || {};
  if (!Array.isArray(settings.colors) || settings.colors.length === 0) {
    settings.colors = [...defaultColors];
    settings.nextColorIndex = 0;
  }
  renderColors();
  websocket = new WebSocket(`ws://127.0.0.1:${port}`);
  websocket.addEventListener("open", () => {
    websocket.send(JSON.stringify({ event: registerEvent, uuid: propertyInspectorUUID }));
    saveSettings();
    sendPayload({ command: "refresh" });
  });
  websocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data).payload;
    if (payload?.event !== "targets") return;
    devices = Array.isArray(payload.devices) ? payload.devices : [];
    groups = Array.isArray(payload.groups) ? payload.groups : [];
    renderTargets();
  });
};

target.addEventListener("change", () => {
  const separator = target.value.indexOf(":");
  if (separator < 0) {
    delete settings.targetType;
    delete settings.targetId;
  } else {
    settings.targetType = target.value.slice(0, separator);
    settings.targetId = target.value.slice(separator + 1);
  }
  settings.nextColorIndex = 0;
  saveSettings();
});

document.querySelector("#add-cycle-color").addEventListener("click", () => {
  settings.colors.push("#ffffff");
  settings.nextColorIndex = 0;
  saveSettings();
  renderColors();
});

document.querySelector("#remove-cycle-color").addEventListener("click", () => {
  if (settings.colors.length <= 1) return;
  settings.colors.pop();
  settings.nextColorIndex = 0;
  saveSettings();
  renderColors();
});
