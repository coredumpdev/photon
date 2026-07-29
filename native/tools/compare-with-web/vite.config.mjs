import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// This directory is not a workspace package, so `@photonviz/core` does not
// resolve on its own. Aliased to the *source* rather than to dist, so the
// comparison runs against what is in the tree and needs no build step first.
export default defineConfig({
  root: here,
  base: "./",
  resolve: {
    alias: {
      "@photonviz/core": path.resolve(here, "../../../packages/core/src/index.ts"),
    },
  },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
