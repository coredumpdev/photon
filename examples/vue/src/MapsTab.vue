<script setup lang="ts">
// ===========================================================================
// MapsTab — offline vector basemaps. No FPS badges. Mounted lazily (v-if in
// App.vue) so the WebGL containers are visible & sized when the plots build.
//   1) GeoJSON world  — fully offline (Natural Earth 10m embedded in the lib).
//   2) Vector basemap — keyless MapLibre demo tiles + declarative city overlay.
//   3) PMTiles        — offline; guarded behind a local-file picker (no network).
// ===========================================================================
import { GeoJson, Map, Plot, Scatter } from "@photonviz/vue";
import {
  Plot as CorePlot,
  type PlotOptions,
} from "@photonviz/core";
import {
  addMap,
  lonLatToWorld,
  pmtilesSource,
  protomapsStyle,
  worldToLonLat,
  xyzVectorSource,
  type GeoJsonOptions,
  type MapLayer,
  type MapStyle,
} from "@photonviz/map";
import { worldCountries } from "@photonviz/map/world";
import { onUnmounted, ref } from "vue";
import Panel from "./Panel.vue";

const geo = worldCountries as GeoJsonOptions["geojson"];

const lonLatReadout = (x: number, y: number) => {
  const [lon, lat] = worldToLonLat(x, y);
  return [
    { label: "lon", value: `${lon.toFixed(2)}°` },
    { label: "lat", value: `${lat.toFixed(2)}°` },
  ];
};

// --- 1) offline GeoJSON world -----------------------------------------------
const geoOptions = {
  theme: "dark",
  showToolbar: true,
  equalAspect: true,
  boundedPan: true,
  hoverReadout: lonLatReadout,
} as PlotOptions;
const adminStyle: MapStyle = {
  background: [0.05, 0.09, 0.16, 1],
  paint(_layer, type) {
    return type === "polygon"
      ? { kind: "fill", color: [0.16, 0.2, 0.26, 1], outline: [0.5, 0.58, 0.68, 1], outlineWidth: 1.2 }
      : { kind: "line", color: [0.5, 0.58, 0.68, 1], width: 1.2 };
  },
};

// --- 2) vector basemap + city overlay ---------------------------------------
const basemapOptions = {
  theme: "dark",
  showToolbar: true,
  equalAspect: true,
  crosshair: true,
  boundedPan: true,
  hoverReadout: lonLatReadout,
} as PlotOptions;
const basemapSource = xyzVectorSource({
  url: "https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf",
  attribution: "© MapLibre demo tiles",
  maxZoom: 5,
});
const oceanStyle: MapStyle = {
  background: [0.05, 0.09, 0.16, 1],
  paint(layer, type) {
    if (layer === "countries")
      return type === "polygon"
        ? { kind: "fill", color: [0.16, 0.2, 0.26, 1] }
        : { kind: "line", color: [0.3, 0.36, 0.44, 1], width: 1 };
    if (layer === "geolines") return { kind: "line", color: [0.2, 0.25, 0.32, 1], width: 1 };
    return null;
  },
};
const cities: Array<[string, number, number]> = [
  ["Istanbul", 28.98, 41.01],
  ["Tokyo", 139.69, 35.69],
  ["New York", -74.0, 40.71],
  ["São Paulo", -46.63, -23.55],
  ["Sydney", 151.21, -33.87],
  ["Cairo", 31.24, 30.04],
];
const cityX: number[] = [];
const cityY: number[] = [];
for (const [, lon, lat] of cities) {
  const [x, y] = lonLatToWorld(lon, lat);
  cityX.push(x);
  cityY.push(y);
}

// --- 3) PMTiles (offline) — built against @photonviz/core on file pick -------
const pmEl = ref<HTMLDivElement | null>(null);
const pmCaption = ref("no network — pick a .pmtiles file →");
let pmPlot: CorePlot | null = null;
let pmMap: MapLayer | null = null;

function onPmFile(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !pmEl.value) return;
  if (!pmPlot) {
    pmPlot = new CorePlot(pmEl.value, {
      theme: "dark",
      showToolbar: true,
      equalAspect: true,
      boundedPan: true,
      crosshair: true,
      hoverReadout: lonLatReadout,
    });
  }
  if (pmMap) {
    pmMap.dispose();
    pmMap = null;
  }
  const source = pmtilesSource({ blob: file, attribution: `local: ${file.name}` });
  pmMap = addMap(pmPlot, { source, style: protomapsStyle("dark") });
  pmCaption.value = `local: ${file.name}`;
}

onUnmounted(() => {
  pmMap?.dispose();
  pmPlot?.destroy();
});
</script>

<template>
  <div class="grid">
    <Panel title="GeoJSON world" subtitle="offline · Natural Earth 10m">
      <Plot :options="geoOptions">
        <GeoJson :geojson="geo" layer="admin" :style="adminStyle" />
      </Plot>
      <div class="cap">© Natural Earth (public domain) · embedded</div>
    </Panel>

    <Panel title="Vector basemap" subtitle="addMap · MVT · city overlay" wide>
      <Plot :options="basemapOptions">
        <Map :source="basemapSource" :style="oceanStyle" :bbox="[-175, -58, 190, 78]" />
        <Scatter :x="cityX" :y="cityY" :size="8" color="#f472b6" />
      </Plot>
      <div class="cap">© MapLibre demo tiles</div>
    </Panel>

    <Panel title="PMTiles (offline)" subtitle="pick a local .pmtiles file">
      <div ref="pmEl" style="position: relative; width: 100%; height: 100%"></div>
      <div class="cap">{{ pmCaption }}</div>
      <input class="file" type="file" accept=".pmtiles" @change="onPmFile" />
    </Panel>
  </div>
</template>
