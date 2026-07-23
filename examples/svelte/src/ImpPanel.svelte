<script lang="ts">
  import { Plot as CorePlot, type PlotOptions } from "@photonviz/core";
  import FsButton from "./FsButton.svelte";

  export let title: string;
  export let subtitle = "";
  export let options: PlotOptions | undefined = undefined;
  /** Imperative build step: add layers/indicators to the core Plot. */
  export let build: (p: CorePlot) => void;

  // Static imperative panel: build once, render, destroy on unmount. No rAF.
  function chart(node: HTMLElement) {
    const p = new CorePlot(node, options);
    build(p);
    p.render();
    return { destroy: () => p.destroy() };
  }
</script>

<section class="card">
  <FsButton />
  <h2>{title}{#if subtitle}<span> — {subtitle}</span>{/if}</h2>
  <div class="chart" use:chart></div>
</section>
