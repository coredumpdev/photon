<script lang="ts">
  import {
    plot,
    polarPlot,
    plot3d,
    type PlotConfig,
    type PolarConfig,
    type Plot3DConfig,
  } from "@photonviz/svelte";

  export let title: string;
  export let subtitle = "";
  export let kind: "plot" | "polar" | "plot3d";
  export let cfg: PlotConfig | PolarConfig | Plot3DConfig;

  // Svelte's template parser can't read inline `as` casts, so narrow here.
  $: plotCfg = cfg as PlotConfig;
  $: polarCfg = cfg as PolarConfig;
  $: plot3dCfg = cfg as Plot3DConfig;
</script>

<section class="card">
  <h2>{title}{#if subtitle}<span> — {subtitle}</span>{/if}</h2>
  {#if kind === "plot"}
    <div class="chart" use:plot={plotCfg}></div>
  {:else if kind === "polar"}
    <div class="chart" use:polarPlot={polarCfg}></div>
  {:else}
    <div class="chart" use:plot3d={plot3dCfg}></div>
  {/if}
</section>
