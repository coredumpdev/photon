import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  external: ["solid-js", "solid-js/web", "@photonviz/core", "@photonviz/map"],
});
