import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const outdir = "com.deadfrogstudios.nanoleaflan.sdPlugin/bin";
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: process.cwd(),
  entryPoints: [resolve("src/plugin.ts")],
  outfile: `${outdir}/plugin.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  loader: { ".svg": "text" },
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
  },
  sourcemap: true,
  logLevel: "info"
});
