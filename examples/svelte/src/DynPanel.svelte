<script lang="ts">
  import { live, type LiveHandle } from "./live";
  import FsButton from "./FsButton.svelte";

  export let title: string;
  export let subtitle = "";
  /** Builds the animated plot on this panel's chart node. */
  export let setup: (node: HTMLElement) => LiveHandle;

  let fps = 0;
</script>

<section class="card">
  <FsButton />
  <h2>{title}{#if subtitle}<span> — {subtitle}</span>{/if}</h2>
  <!-- Badge is a sibling overlay (not a child of the chart div) so the plot's
       canvas never clobbers it. Anchored top-left of the chart. -->
  <div class="chartwrap">
    <div class="chart" use:live={{ setup, onFps: (f) => (fps = f) }}></div>
    <div class="fps">{fps} fps</div>
  </div>
</section>
