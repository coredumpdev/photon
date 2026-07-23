<script lang="ts">
  // Per-chart fullscreen toggle. Drop <FsButton /> inside any `.card`; it finds
  // its own panel root (nearest `.card` ancestor) and toggles fullscreen on it.
  // Photon's plots resize to fill via their ResizeObserver.
  let btn: HTMLButtonElement;
  function toggle(): void {
    const root = btn.closest(".card") as HTMLElement | null;
    if (!root) return;
    if (document.fullscreenElement === root) document.exitFullscreen();
    else root.requestFullscreen().catch(() => { /* ignore */ });
  }
</script>

<button
  bind:this={btn}
  class="fs-btn"
  type="button"
  title="Fullscreen"
  aria-label="Toggle fullscreen"
  on:click={toggle}
>
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</button>
