<script setup lang="ts">
import FpsBadge from "./FpsBadge.vue";

// A titled card holding one chart. When `fps` is set (Dynamic tab) it overlays
// a self-measuring FPS badge. `.chart` is position:relative so the badge and
// any captions anchor to it.
defineProps<{ title: string; subtitle?: string; fps?: boolean; wide?: boolean }>();
</script>

<template>
  <section class="panel" :class="{ wide }">
    <h2>{{ title }} <span v-if="subtitle">— {{ subtitle }}</span></h2>
    <div class="chart">
      <FpsBadge v-if="fps" />
      <slot />
    </div>
  </section>
</template>
