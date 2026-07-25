<script setup lang="ts">
/**
 * A live chart plus the exact source that produced it.
 *
 * Every demo is a real module under `docs/demos/`, so the code on the page is
 * type-checked and *is* what runs — a snippet cannot drift from its output.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";

const props = withDefaults(
  defineProps<{
    /** File name under `docs/demos/`, without the extension. */
    src: string;
    /** Chart height in CSS pixels. */
    height?: number | string;
    /** Start with the source expanded. */
    open?: boolean;
  }>(),
  { height: 320, open: false },
);

/** Every demo module + its raw text, resolved at build time. */
const modules = import.meta.glob("../../demos/*.ts");
const sources = import.meta.glob("../../demos/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const host = ref<HTMLDivElement>();
const source = ref("");
const error = ref("");
const dispose = shallowRef<(() => void) | null>(null);
const showCode = ref(props.open);

/** Strip the leading doc comment — the page prose already says what this is. */
function trim(text: string): string {
  return text.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "").trim();
}

onMounted(async () => {
  const key = `../../demos/${props.src}.ts`;
  source.value = trim(sources[key] ?? "");
  const load = modules[key];
  if (!load) {
    error.value = `Demo "${props.src}" not found`;
    return;
  }
  try {
    const mod = (await load()) as { default: (el: HTMLElement) => (() => void) | void };
    if (host.value) dispose.value = mod.default(host.value) ?? null;
  } catch (err) {
    // WebGL2 is required; say so rather than showing an empty box.
    error.value = err instanceof Error ? err.message : String(err);
  }
});

onBeforeUnmount(() => dispose.value?.());
</script>

<template>
  <div class="photon-demo">
    <div v-if="error" class="photon-demo__error">{{ error }}</div>
    <div
      v-else
      ref="host"
      class="photon-demo__chart"
      :style="{ height: typeof height === 'number' ? `${height}px` : height }"
    />
    <button class="photon-demo__toggle" type="button" @click="showCode = !showCode">
      {{ showCode ? "Hide" : "Show" }} source
    </button>
    <div v-show="showCode" class="photon-demo__code">
      <pre><code>{{ source }}</code></pre>
    </div>
  </div>
</template>

<style scoped>
.photon-demo {
  margin: 18px 0 26px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}
.photon-demo__chart {
  width: 100%;
  position: relative;
}
.photon-demo__error {
  padding: 14px 16px;
  color: var(--vp-c-danger-1);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
}
.photon-demo__toggle {
  width: 100%;
  padding: 7px 12px;
  border: 0;
  border-top: 1px solid var(--vp-c-divider);
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.photon-demo__toggle:hover {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-default-soft);
}
.photon-demo__code {
  border-top: 1px solid var(--vp-c-divider);
}
.photon-demo__code pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.6;
}
</style>
