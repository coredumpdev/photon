import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  title: "Photon",
  description: "GPU-accelerated (WebGL2) scientific plotting for the web",
  lang: "en-US",
  // Served under the demo site at /photon/docs/ ; overridden for local dev.
  base: process.env.DOCS_BASE ?? "/photon/docs/",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["meta", { name: "theme-color", content: "#60a5fa" }],
    ["meta", { property: "og:title", content: "Photon — WebGL2 charts" }],
    [
      "meta",
      {
        property: "og:description",
        content: "40+ chart types across 2D, 3D, polar, finance, ML and model architecture. Zero dependencies.",
      },
    ],
  ],

  vite: {
    resolve: {
      // Docs demos import the workspace source directly, so `pnpm docs:dev`
      // picks up core changes without a rebuild.
      alias: { "@photonviz/core": path.resolve(here, "../../packages/core/src/index.ts") },
    },
  },

  themeConfig: {
    logo: undefined,
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Charts", link: "/charts/2d" },
      { text: "Python", link: "/python/" },
      { text: "API", link: "/api/" },
      {
        text: "Links",
        items: [
          { text: "Live gallery", link: "https://coredumpdev.github.io/photon/" },
          { text: "Playground", link: "https://coredumpdev.github.io/photon/playground/" },
          { text: "Docs for AI agents", link: "https://coredumpdev.github.io/photon/llms-full.txt" },
          { text: "npm", link: "https://www.npmjs.com/package/@photonviz/core" },
          { text: "PyPI", link: "https://pypi.org/project/photonviz/" },
        ],
      },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Plot, layers & scales", link: "/guide/concepts" },
          { text: "Colour & colorbars", link: "/guide/color" },
          { text: "Interaction & legend", link: "/guide/interaction" },
          { text: "Streaming", link: "/guide/streaming" },
          { text: "Frameworks", link: "/guide/frameworks" },
        ],
      },
      {
        text: "Charts",
        items: [
          { text: "2D", link: "/charts/2d" },
          { text: "3D", link: "/charts/3d" },
          { text: "Polar", link: "/charts/polar" },
          { text: "Finance", link: "/charts/finance" },
          { text: "Statistics & signal", link: "/charts/statistics" },
          { text: "Machine learning", link: "/charts/ml" },
          { text: "Model architecture", link: "/charts/model-graph" },
          { text: "Diagrams", link: "/charts/diagrams" },
        ],
      },
      {
        text: "Python",
        items: [
          { text: "Jupyter, Lab & Colab", link: "/python/" },
          { text: "Python API", link: "/python/api" },
        ],
      },
      { text: "Reference", items: [{ text: "TypeScript API", link: "/api/" }] },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/coredumpdev/photon" }],

    search: { provider: "local" },

    footer: {
      message: "MIT licensed. WebGL2 required.",
      copyright: "© Muzaffer Tolga Yakar",
    },

    editLink: {
      pattern: "https://github.com/coredumpdev/photon/edit/master/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
