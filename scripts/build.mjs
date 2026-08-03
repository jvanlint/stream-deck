import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const outdir = "com.jason.nanoleaf.sdPlugin/bin";
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: process.cwd(),
  entryPoints: [resolve("src/plugin.ts")],
  outfile: resolve(outdir, "plugin.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
  },
  sourcemap: true,
  logLevel: "info"
});
