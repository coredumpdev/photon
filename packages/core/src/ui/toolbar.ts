import type { InteractionMode } from "../types.js";

/** The subset of Plot the toolbar drives. Kept minimal to avoid an import cycle. */
export interface ToolbarHost {
  setMode(mode: InteractionMode): void;
  getMode(): InteractionMode;
  home(): void;
  onModeChange(cb: (mode: InteractionMode) => void): void;
}

export interface ToolbarTheme {
  bg: string;
  fg: string;
  border: string;
  activeBg: string;
  activeFg: string;
  hoverBg: string;
}

const lightToolbar: ToolbarTheme = {
  bg: "rgba(255,255,255,0.9)",
  fg: "#475569",
  border: "rgba(100,116,139,0.25)",
  activeBg: "#3b82f6",
  activeFg: "#ffffff",
  hoverBg: "rgba(100,116,139,0.12)",
};

const darkToolbar: ToolbarTheme = {
  bg: "rgba(15,23,42,0.85)",
  fg: "#cbd5e1",
  border: "rgba(148,163,184,0.25)",
  activeBg: "#3b82f6",
  activeFg: "#ffffff",
  hoverBg: "rgba(148,163,184,0.15)",
};

// 16x16 SVG icons, currentColor-driven so they inherit button color.
const ICONS = {
  home: `<path d="M2 7.5 8 2l6 5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 7v6.5h3.2V10h1.6v3.5H12V7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  pan: `<path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
  box: `<rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.4 2"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>`,
  boxX: `<path d="M1.5 8h13M3.5 5.5 1.5 8l2 2.5M12.5 5.5 14.5 8l-2 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.5" y="3" width="7" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 1.8"/>`,
  boxY: `<path d="M8 1.5v13M5.5 3.5 8 1.5l2.5 2M5.5 12.5 8 14.5l2.5-2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="4.5" width="10" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 1.8"/>`,
};

interface Btn {
  key: string;
  title: string;
  icon: string;
  mode?: InteractionMode;
  action?: () => void;
}

/** Build a floating toolbar in `container` and wire it to the plot host. */
export function createToolbar(
  container: HTMLElement,
  host: ToolbarHost,
  dark: boolean,
): { element: HTMLElement; destroy: () => void } {
  const t = dark ? darkToolbar : lightToolbar;

  const bar = document.createElement("div");
  Object.assign(bar.style, {
    position: "absolute",
    top: "8px",
    right: "8px",
    zIndex: "3",
    display: "flex",
    gap: "2px",
    padding: "3px",
    borderRadius: "8px",
    background: t.bg,
    border: `1px solid ${t.border}`,
    backdropFilter: "blur(6px)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  } as CSSStyleDeclaration);

  const buttons: Btn[] = [
    { key: "home", title: "Reset view (Home)", icon: ICONS.home, action: () => host.home() },
    { key: "pan", title: "Pan", icon: ICONS.pan, mode: "pan" },
    { key: "box", title: "Box zoom", icon: ICONS.box, mode: "box" },
    { key: "box-x", title: "Zoom X only", icon: ICONS.boxX, mode: "box-x" },
    { key: "box-y", title: "Zoom Y only", icon: ICONS.boxY, mode: "box-y" },
  ];

  const modeButtons = new Map<InteractionMode, HTMLButtonElement>();

  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = b.title;
    btn.setAttribute("aria-label", b.title);
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${b.icon}</svg>`;
    Object.assign(btn.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "26px",
      height: "26px",
      padding: "0",
      border: "none",
      borderRadius: "6px",
      background: "transparent",
      color: t.fg,
      cursor: "pointer",
      transition: "background 0.12s, color 0.12s",
    } as CSSStyleDeclaration);

    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active !== "true") btn.style.background = t.hoverBg;
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active !== "true") btn.style.background = "transparent";
    });
    btn.addEventListener("click", () => {
      if (b.action) b.action();
      if (b.mode) host.setMode(b.mode);
    });

    if (b.mode) modeButtons.set(b.mode, btn);
    bar.appendChild(btn);
  }

  const setActive = (mode: InteractionMode) => {
    for (const [m, btn] of modeButtons) {
      const active = m === mode;
      btn.dataset.active = String(active);
      btn.style.background = active ? t.activeBg : "transparent";
      btn.style.color = active ? t.activeFg : t.fg;
    }
  };

  setActive(host.getMode());
  host.onModeChange(setActive);

  container.appendChild(bar);
  return {
    element: bar,
    destroy: () => bar.remove(),
  };
}
