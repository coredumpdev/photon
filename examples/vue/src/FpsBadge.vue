<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

// Self-measuring FPS badge: its own rAF samples frame deltas and paints a
// smoothed reading. Pinned top-left of the (position:relative) chart cell.
const fps = ref(0);
let raf = 0;
let last = 0;
let avg = 0;
let lastPaint = 0;

function loop(now: number): void {
  if (last > 0) {
    const dt = now - last;
    if (dt > 0) {
      const inst = 1000 / dt;
      avg = avg > 0 ? avg * 0.9 + inst * 0.1 : inst;
    }
  }
  last = now;
  if (now - lastPaint > 250) {
    lastPaint = now;
    fps.value = Math.round(avg);
  }
  raf = requestAnimationFrame(loop);
}

onMounted(() => {
  raf = requestAnimationFrame(loop);
});
onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf);
});
</script>

<template>
  <div class="fps-badge">{{ fps ? `${fps} fps` : "— fps" }}</div>
</template>

<style scoped>
.fps-badge {
  position: absolute;
  top: 6px;
  left: 8px;
  z-index: 5;
  padding: 2px 7px;
  border-radius: 6px;
  font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e2e8f0;
  background: rgba(14, 21, 38, 0.7);
  border: 1px solid #1e293b;
  backdrop-filter: blur(3px);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
</style>
