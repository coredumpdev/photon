import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import Demo from "./Demo.vue";
import "./custom.css";

/** Register `<Demo src="…" />` so any markdown page can embed a live chart. */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Demo", Demo);
  },
} satisfies Theme;
