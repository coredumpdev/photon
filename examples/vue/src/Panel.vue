<script setup lang="ts">
import { ref } from "vue";
import FpsBadge from "./FpsBadge.vue";

// A titled card holding one chart. When `fps` is set (Dynamic tab) it overlays
// a self-measuring FPS badge (top-left). A fullscreen toggle sits top-right,
// revealed on hover. `.chart` is position:relative so overlays anchor to it.
defineProps<{ title: string; subtitle?: string; fps?: boolean; wide?: boolean }>();

const root = ref<HTMLElement | null>(null);
function toggleFullscreen(): void {
  const el = root.value;
  if (!el) return;
  if (document.fullscreenElement === el) document.exitFullscreen();
  else el.requestFullscreen().catch(() => { /* ignore */ });
}
</script>

<template>
  <section ref="root" class="panel" :class="{ wide }">
    <h2>{{ title }} <span v-if="subtitle">— {{ subtitle }}</span></h2>
    <button class="fs-btn" type="button" title="Fullscreen" aria-label="Fullscreen" @click="toggleFullscreen">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
      </svg>
    </button>
    <div class="chart">
      <FpsBadge v-if="fps" />
      <slot />
    </div>
  </section>
</template>
