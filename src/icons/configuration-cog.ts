const GEAR_SEGMENTS = [
  "M15.24 6.37c.41.23.8.51 1.14.83c0 0 2.62-1.08 2.63-1.06c0 0 1.56 2.7 1.56 2.7c.01.03-2.22 1.75-2.22 1.75c.1.45.15.93.15 1.41",
  "M18.5 11.99c.01.47-.04.95-.15 1.4c0 0 2.25 1.73 2.23 1.75c0 0-1.56 2.7-1.56 2.7c-.02.02-2.63-1.05-2.63-1.05c-.34.31-.73.59-1.15.83",
  "M15.26 17.62c-.4.24-.84.44-1.29.57c0 0-.37 2.81-.4 2.81c0 0-3.12 0-3.12 0c-.03-.01-.41-2.8-.41-2.8c-.44-.14-.88-.34-1.3-.58",
  "M8.76 17.63c-.41-.23-.8-.51-1.14-.83c0 0-2.62 1.08-2.63 1.06c0 0-1.56-2.7-1.56-2.7c-.01-.03 2.22-1.75 2.22-1.75c-.1-.45-.15-.93-.15-1.41",
  "M5.5 12.01c-.01-.47.04-.95.15-1.4c0 0-2.25-1.73-2.23-1.75c0 0 1.56-2.7 1.56-2.7c.02-.02 2.63 1.05 2.63 1.05c.34-.31.73-.59 1.15-.83",
  "M8.74 6.38c.4-.24.84-.44 1.29-.57c0 0 .37-2.81.4-2.81c0 0 3.12 0 3.12 0c.03.01.41 2.8.41 2.8c.44.14.88.34 1.3.58"
];

import nanoleafBulbSvg from "../../com.deadfrogstudios.nanoleaflan.sdPlugin/static/imgs/nanoleaf-bulb.svg";

const NANOLEAF_BULB_PATH = /<path[^>]*\sd="([^"]+)"/.exec(nanoleafBulbSvg)?.[1] ?? "";

export function configurationBulbDataUrl(background = true): string {
  const segments = GEAR_SEGMENTS.map((path) => `<path d="${path}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">${background ? '<rect width="144" height="144" rx="18" fill="#151b18"/>' : ""}<path d="${NANOLEAF_BULB_PATH}" transform="translate(18 18) scale(4.5)" fill="#3d4541"/><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.1" transform="translate(42 42) scale(2.5)"><circle cx="12" cy="12" r="3"/>${segments}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
