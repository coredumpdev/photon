import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/world.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // No sourcemaps: the embedded world dataset would otherwise emit a useless
  // ~25 MB world.js.map that only bloats the published package.
  sourcemap: false,
  target: "es2020",
  external: ["@photonviz/core"],
});
