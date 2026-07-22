import { geaPlugin } from "@geajs/vite-plugin"
import { defineConfig } from "tsdown"

// Plain-JS config (no TS config-loader) so `tsdown` builds on Node 20 too, where
// loading a .ts config would require `unrun`. Mirrors @geajs/ui's build: the gea
// compiler plugin transforms the .tsx `template()` JSX; each component is its own
// (default-exported) entry.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    plot: "src/plot.tsx",
    "polar-plot": "src/polar-plot.tsx",
    plot3d: "src/plot3d.tsx",
    series: "src/series.ts",
  },
  plugins: [geaPlugin()],
  format: "esm",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: { build: true },
  target: "es2022",
  platform: "browser",
  fixedExtension: true,
  // tsdown auto-externalizes dependencies + peerDependencies (@geajs/core,
  // @photonviz/core, @photonviz/map). We must NOT list @geajs/core in `external`
  // explicitly, or the gea plugin's `this.resolve("@geajs/core")` returns an
  // external stub and can't locate the compiler runtime.
})
