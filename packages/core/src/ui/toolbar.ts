import type { InteractionMode } from "../types.js";

/** The subset of Plot the toolbar drives. Kept minimal to avoid an import cycle. */
export interface ToolbarHost {
  setMode(mode: InteractionMode): void;
  getMode(): InteractionMode;
  home(): void;
  onModeChange(cb: (mode: InteractionMode) => void): void;
  /** Optional: download the current view as a PNG. Adds a toolbar button when present. */
  download?(): void;
  /** Optional: interactive drawing tools. Adds a tool group (trendline / hline / ray / fib / rect / clear) when present. */
  drawTools?: {
    set(tool: string | null): void;
    get(): string | null;
    clear(): void;
    onChange(cb: (tool: string | null) => void): void;
  };
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
  download: `<path d="M8 1.8v8.4M4.8 7l3.2 3.2L11.2 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 11.5v1.7A1 1 0 0 0 3.5 14.2h9a1 1 0 0 0 1-1V11.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  trendline: `<path d="M2 13 14 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="2" cy="13" r="1.6" fill="currentColor"/><circle cx="14" cy="3" r="1.6" fill="currentColor"/>`,
  hline: `<path d="M1.5 8h13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/>`,
  ray: `<path d="M2 12 13 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13 4 10 4.4M13 4l-.4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="2" cy="12" r="1.6" fill="currentColor"/>`,
  fib: `<path d="M2 3h12M2 6.2h12M2 9.4h12M2 12.6h12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
  rect: `<rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.4 2"/>`,
  trash: `<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
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
  if (host.download) {
    buttons.push({ key: "download", title: "Download PNG", icon: ICONS.download, action: () => host.download!() });
  }

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

  // Drawing tools group (trendline / hline / ray / fib / rect / clear).
  if (host.drawTools) {
    const dt = host.drawTools;
    const mkBtn = (icon: string, title: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${icon}</svg>`;
      Object.assign(btn.style, {
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: "26px", height: "26px", padding: "0", border: "none", borderRadius: "6px",
        background: "transparent", color: t.fg, cursor: "pointer", transition: "background 0.12s, color 0.12s",
      } as CSSStyleDeclaration);
      btn.addEventListener("mouseenter", () => { if (btn.dataset.active !== "true") btn.style.background = t.hoverBg; });
      btn.addEventListener("mouseleave", () => { if (btn.dataset.active !== "true") btn.style.background = "transparent"; });
      return btn;
    };

    const sep = document.createElement("div");
    Object.assign(sep.style, { width: "1px", height: "18px", background: t.border, margin: "0 3px", alignSelf: "center" } as CSSStyleDeclaration);
    bar.appendChild(sep);

    const drawList: Array<{ key: string; title: string; icon: string }> = [
      { key: "trendline", title: "Trendline", icon: ICONS.trendline },
      { key: "hline", title: "Horizontal line", icon: ICONS.hline },
      { key: "ray", title: "Ray", icon: ICONS.ray },
      { key: "fib", title: "Fibonacci retracement", icon: ICONS.fib },
      { key: "rect", title: "Rectangle", icon: ICONS.rect },
    ];
    const drawBtns = new Map<string, HTMLButtonElement>();
    for (const d of drawList) {
      const btn = mkBtn(d.icon, d.title);
      btn.addEventListener("click", () => dt.set(dt.get() === d.key ? null : d.key));
      drawBtns.set(d.key, btn);
      bar.appendChild(btn);
    }
    const clearBtn = mkBtn(ICONS.trash, "Clear drawings");
    clearBtn.addEventListener("click", () => dt.clear());
    bar.appendChild(clearBtn);

    const setDrawActive = (tool: string | null) => {
      for (const [k, b] of drawBtns) {
        const active = k === tool;
        b.dataset.active = String(active);
        b.style.background = active ? t.activeBg : "transparent";
        b.style.color = active ? t.activeFg : t.fg;
      }
    };
    setDrawActive(dt.get());
    dt.onChange(setDrawActive);
  }

  container.appendChild(bar);
  return {
    element: bar,
    destroy: () => bar.remove(),
  };
}
