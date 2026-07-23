<script setup lang="ts">
// ===========================================================================
// Three-tab gallery shell.
//   • Static  — the full catalog with render-type="static" (default, mounted
//               immediately while visible).
//   • Dynamic — the same catalog with render-type="dynamic", each panel
//               animated by a shared rAF loop + a self-measuring FPS badge,
//               plus a linkX-ed finance dashboard.
//   • Maps    — offline vector basemaps, no FPS.
// Each tab is rendered with v-if keyed on the active tab, so Dynamic and Maps
// mount only the first time they are shown — a WebGL plot built while its
// container is display:none would size to 0. Static is visible on load.
// ===========================================================================
import { ref } from "vue";
import GalleryTab from "./GalleryTab.vue";
import FinanceTab from "./FinanceTab.vue";
import MapsTab from "./MapsTab.vue";

type Tab = "static" | "dynamic" | "finance" | "maps";
const tab = ref<Tab>("static");

const tabs: Array<{ id: Tab; label: string; count: number }> = [
  { id: "static", label: "Static", count: 48 },
  { id: "dynamic", label: "Dynamic", count: 50 },
  { id: "finance", label: "Finance", count: 8 },
  { id: "maps", label: "Maps", count: 3 },
];
</script>

<template>
  <header>
    <h1><b>Photon</b> — Vue chart gallery</h1>
    <p>
      Three tabs, one <code>@photonviz/vue</code> component tree.
      <b>Static</b>: the full catalog (hover, box/X/Y zoom, drag an axis to pan · 3D: drag to orbit).
      <b>Dynamic</b>: the same catalog streaming live via <code>requestAnimationFrame</code>, each panel with an FPS badge.
      <b>Finance</b>: Heikin-Ashi, Renko, Bollinger, volume profile, depth + a linkX-ed RSI/MACD dashboard.
      <b>Maps</b>: offline vector basemaps.
    </p>
  </header>

  <div class="tabs">
    <button
      v-for="t in tabs"
      :key="t.id"
      class="tab"
      :class="{ active: tab === t.id }"
      @click="tab = t.id"
    >
      {{ t.label }}<span class="count">{{ t.count }}</span>
    </button>
  </div>
  <div class="tabbar-line"></div>

  <!-- Static is mounted while visible; Dynamic/Maps mount lazily on first show. -->
  <GalleryTab v-if="tab === 'static'" :dynamic="false" />
  <GalleryTab v-else-if="tab === 'dynamic'" :dynamic="true" />
  <FinanceTab v-else-if="tab === 'finance'" />
  <MapsTab v-else-if="tab === 'maps'" />
</template>

<style>
:root { color-scheme: dark; }
html, body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0b1020; color: #cbd5e1; }
header { padding: 16px 20px 4px; }
header h1 { margin: 0; font-size: 18px; }
header h1 b { color: #60a5fa; }
header p { margin: 4px 0 0; font-size: 13px; color: #94a3b8; }
header code { color: #7dd3fc; font-size: 12px; }

.tabs { display: flex; gap: 6px; padding: 12px 20px 0; }
.tab {
  appearance: none; cursor: pointer;
  font: 600 13px system-ui, sans-serif; color: #94a3b8;
  background: #0e1526; border: 1px solid #1e293b; border-bottom: none;
  padding: 8px 16px; border-radius: 8px 8px 0 0;
}
.tab:hover { color: #cbd5e1; }
.tab.active { color: #e2e8f0; background: #141d33; border-color: #334155; }
.tab .count { color: #475569; font-weight: 400; margin-left: 6px; }
.tab.active .count { color: #60a5fa; }
.tabbar-line { height: 1px; background: #1e293b; margin: 0 20px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 14px; padding: 16px 20px 40px;
}
.panel {
  position: relative; border: 1px solid #1e293b; border-radius: 10px;
  background: #0e1526; overflow: hidden;
}
.panel.wide { grid-column: 1 / -1; }
.panel h2 {
  margin: 0; padding: 8px 12px; font-size: 13px; font-weight: 600;
  color: #e2e8f0; border-bottom: 1px solid #1e293b;
}
.panel h2 span { color: #64748b; font-weight: 400; }
.chart { position: relative; height: 260px; }
.cap {
  position: absolute; right: 6px; bottom: 6px; z-index: 5; padding: 2px 7px;
  border-radius: 6px; font: 500 10.5px system-ui, sans-serif; color: #cbd5e1;
  background: rgba(14,21,38,.72); border: 1px solid #1e293b;
  pointer-events: none; max-width: 70%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.file { position: absolute; left: 8px; bottom: 8px; z-index: 6; font-size: 11px; color: #cbd5e1; max-width: 60%; }
</style>
