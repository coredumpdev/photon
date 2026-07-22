import { geaPlugin } from "@geajs/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [geaPlugin()],
  // Keep @geajs/core unbundled so the gea plugin can resolve its real dist entry
  // (and derive the compiler runtime) under pnpm's symlinked layout.
  optimizeDeps: { exclude: ["@geajs/core", "@photonviz/gea", "@photonviz/core", "@photonviz/map"] },
});
