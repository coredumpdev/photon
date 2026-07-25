import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "tsup";

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * Bundle against core's built output. The Python wheel must be self-contained —
 * a notebook loads this one file and nothing else, with no CDN and no extension.
 */
const core = path.resolve(here, "../packages/core/dist/index.js");

export default defineConfig({
  entry: { widget: path.resolve(here, "widget/index.ts") },
  outDir: path.resolve(here, "src/photonviz/static"),
  format: ["esm"],
  target: "es2020",
  platform: "browser",
  minify: true,
  sourcemap: false,
  dts: false,
  clean: false,
  esbuildOptions(options) {
    options.alias = { "@photonviz/core": core };
  },
});
