import { Component } from "@geajs/core";
import { linkX } from "@photonviz/core";
import { Plot, PolarPlot, Plot3D, addBollinger, addDepth, rsi, macd, firstFinite } from "@photonviz/gea";

import { makeRng, jitter, businessDays } from "./data";
import { buildStatic } from "./static-catalog";
import { buildDynamic, type Updater } from "./dynamic-catalog";
import { financeData } from "./finance-catalog";
import { buildML } from "./ml-catalog";

// Catalogs are built once at load. buildStatic() eagerly materializes all the
// static data; buildDynamic() only builds the streaming *setup* closures — each
// chart's heavy data is generated lazily inside onReady when the panel mounts.
const S = buildStatic();
const D = buildDynamic();

const STATIC_COUNT = S.plots2D.length + S.polars.length + S.plots3D.length;
const DYNAMIC_COUNT = D.plots2D.length + D.polars.length + D.plots3D.length + 2; // + linked finance
const FINANCE_COUNT = 8;

// ---- ML catalog (built once; static synthetic data, no streaming) ----------
const ML = buildML();
const ML_COUNT = ML.length;

// ---- Finance data + indicators (built once; static, no streaming) ----------
const FIN = financeData();
const FIN_ORD = { theme: "dark" as const, scales: { x: { type: "ordinal-time" as const, times: FIN.times } }, showToolbar: false };
const FIN_PLAIN = { theme: "dark" as const, showToolbar: false };
const FIN_RSI_OPTS = { theme: "dark" as const, scales: { x: { type: "ordinal-time" as const, times: FIN.times }, y: { domain: [0, 100] } }, showToolbar: false };

/** Slice a series past its warm-up NaNs (indicators return leading NaN). */
const finTrim = (y: Float64Array) => { const s = Math.max(0, firstFinite(y)); return { x: FIN.idx.subarray(s), y: y.subarray(s) }; };
const FIN_RSI = finTrim(rsi(FIN.c, 14));
const FIN_MACD = macd(FIN.c, 12, 26, 9);
const FIN_HIST = finTrim(FIN_MACD.histogram);
const FIN_MLINE = finTrim(FIN_MACD.macd);
const FIN_SIG = finTrim(FIN_MACD.signal);

// Linked-dashboard core plots (captured via onReady, joined once all three ready).
let finLinked: any = {};

// ============================================================================
// Per-chart fullscreen button (top-right, shown on panel hover). Its root IS the
// <button>; the SVG icon is set as innerHTML (no JSX-namespace surprises) and the
// target panel is found via closest(".panel"). Photon resizes via ResizeObserver.
// ============================================================================
class FsButton extends Component {
  onAfterRender(): void {
    if (this.el) this.el.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  toggle(): void {
    const panel = this.el?.closest(".panel") as HTMLElement | null;
    if (!panel) return;
    if (document.fullscreenElement === panel) document.exitFullscreen();
    else panel.requestFullscreen().catch(() => { /* ignore */ });
  }

  template() {
    return <button class="fs-btn" type="button" title="Fullscreen" aria-label="Toggle fullscreen" click={() => this.toggle()}></button>;
  }
}

// ============================================================================
// Static tab — one panel per chart via the config-driven Gea components. Single
// wrapper series render declaratively (`series`); composite charts the wrapper
// can't express as one series carry an imperative `setup` run through onReady.
// ============================================================================
class StaticTab extends Component {
  template() {
    return (
      <div class="grid">
        {S.plots2D.map((c) => (
          <div class="panel" key={`s2-${c.title}`}>
            <FsButton />
            <h2>{c.title}{c.subtitle ? <span> — {c.subtitle}</span> : null}</h2>
            <div class="chart">
              <Plot
                options={c.options}
                yAxes={c.yAxes}
                series={c.series}
                annotations={c.annotations}
                onReady={c.setup ? (p) => c.setup!(p) : undefined}
              />
            </div>
          </div>
        ))}
        {S.polars.map((c) => (
          <div class="panel" key={`sp-${c.title}`}>
            <FsButton />
            <h2>{c.title}{c.subtitle ? <span> — {c.subtitle}</span> : null}</h2>
            <div class="chart"><PolarPlot options={c.options} series={c.series} /></div>
          </div>
        ))}
        {S.plots3D.map((c) => (
          <div class="panel" key={`s3-${c.title}`}>
            <FsButton />
            <h2>{c.title}{c.subtitle ? <span> — {c.subtitle}</span> : null}</h2>
            <div class="chart">
              <Plot3D options={c.options} layers={c.layers} onReady={c.setup ? (p) => c.setup!(p) : undefined} />
            </div>
          </div>
        ))}
      </div>
    );
  }
}

// ============================================================================
// Dynamic tab — the same catalog animated. Each panel's onReady grabs the core
// plot, adds renderType:"dynamic" layers and registers an updater. A single rAF
// loop drives every updater and repaints the FPS badges (top-left over charts).
// The updaters live in a module-scoped array (not a reactive field) so the tight
// loop touches raw plots/layers, never proxied ones.
// ============================================================================
let dynUpdaters: Updater[] = [];

// Linked-finance shared state (built lazily as both panels' onReady fire).
const FIN_TIMES = businessDays(60, Date.UTC(2024, 0, 1));
const FIN_OPTS_PRICE = { theme: "dark" as const, scales: { x: { type: "ordinal-time" as const, times: FIN_TIMES } }, showToolbar: false };
const FIN_OPTS_VOL = { theme: "dark" as const, scales: { x: { type: "ordinal-time" as const, times: FIN_TIMES }, y: { domain: [0, 80] } }, showToolbar: false };
let fin: any = null;

class DynamicTab extends Component {
  declare props: { active: boolean };

  fps = 0; // reactive — bound by every FPS badge

  private raf = 0;
  private frame = 0;
  private fpsAvg = 0;
  private lastNow = 0;
  private fpsPaint = 0;

  created(): void {
    dynUpdaters = [];
    fin = null;
  }

  /** onReady for a catalog panel: run its setup, keep the returned updater. */
  register(setup: (p: any) => Updater, plot: any): void {
    dynUpdaters.push(setup(plot));
  }

  // --- Linked finance: candlesticks + volume, joined via linkX ---------------
  private finInit() {
    if (fin) return fin;
    const { rand, gaussian } = makeRng(7);
    const N = 60;
    const idx = Float64Array.from({ length: N }, (_, i) => i);
    const o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N), vol = new Float64Array(N);
    let price = 100;
    for (let i = 0; i < N; i++) {
      const open = price, close = open + gaussian(0, 2);
      o[i] = open; c[i] = close;
      h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1));
      l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1));
      vol[i] = 20 + Math.abs(close - open) * 6 + rand() * 10;
      price = close;
    }
    fin = { N, idx, o, h, l, c, vol, rand, priceP: null, volP: null, cs: null, volBar: null };
    return fin;
  }

  onFinancePrice(plot: any): void {
    const f = this.finInit();
    f.priceP = plot;
    f.cs = plot.addCandlestick({ x: f.idx, open: f.o, high: f.h, low: f.l, close: f.c, renderType: "dynamic" });
    this.finReady();
  }

  onFinanceVol(plot: any): void {
    const f = this.finInit();
    f.volP = plot;
    f.volBar = plot.addBar({ x: f.idx, y: f.vol, width: 0.7, color: "#38bdf8", renderType: "dynamic" });
    this.finReady();
  }

  private finReady(): void {
    const f = fin;
    if (!f || !f.priceP || !f.volP) return;
    linkX([f.priceP, f.volP]);
    const { N, idx, o, h, l, c, vol } = f;
    let curOpen = c[N - 1], curClose = curOpen, hi = curOpen, lo = curOpen, curVol = vol[N - 1], sinceClose = 0;
    dynUpdaters.push(() => {
      curClose += f.rand() * 2 - 1; hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
      curVol = Math.max(5, curVol + jitter() * 3);
      f.cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose });
      vol[N - 1] = curVol; f.volBar.setData(idx, vol);
      f.priceP.render(); f.volP.render();
      if (++sinceClose > 60) {
        sinceClose = 0;
        for (let i = 0; i < N - 1; i++) { o[i] = o[i + 1]; h[i] = h[i + 1]; l[i] = l[i + 1]; c[i] = c[i + 1]; vol[i] = vol[i + 1]; }
        curOpen = curClose; o[N - 1] = curOpen; h[N - 1] = curOpen; l[N - 1] = curOpen; c[N - 1] = curOpen; hi = lo = curOpen;
        curVol = 20 + f.rand() * 10; vol[N - 1] = curVol;
        f.cs.setData({ x: idx, open: o, high: h, low: l, close: c });
      }
    });
  }

  onAfterRender(): void {
    const loop = (now: number): void => {
      this.frame++;
      const t = this.frame / 60;
      if (this.props.active) {
        for (const u of dynUpdaters) u(t);
        if (this.lastNow > 0) {
          const dt = now - this.lastNow;
          if (dt > 0) { const inst = 1000 / dt; this.fpsAvg = this.fpsAvg > 0 ? this.fpsAvg * 0.9 + inst * 0.1 : inst; }
        }
        if (now - this.fpsPaint > 250) { this.fpsPaint = now; this.fps = Math.round(this.fpsAvg); }
      }
      this.lastNow = now;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    dynUpdaters = [];
    fin = null;
    super.dispose();
  }

  template() {
    return (
      <div class="grid">
        {D.plots2D.map((c) => (
          <div class="panel" key={`d2-${c.title}`}>
            <FsButton />
            <h2>{c.title}{c.subtitle ? <span> — {c.subtitle}</span> : null}</h2>
            <div class="chart">
              <div class="fps">{this.fps} fps</div>
              <Plot options={c.options} onReady={(p) => this.register(c.setup, p)} />
            </div>
          </div>
        ))}
        {D.polars.map((c) => (
          <div class="panel" key={`dp-${c.title}`}>
            <FsButton />
            <h2>{c.title}{c.subtitle ? <span> — {c.subtitle}</span> : null}</h2>
            <div class="chart">
              <div class="fps">{this.fps} fps</div>
              <PolarPlot options={c.options} onReady={(p) => this.register(c.setup, p)} />
            </div>
          </div>
        ))}
        {D.plots3D.map((c) => (
          <div class="panel" key={`d3-${c.title}`}>
            <FsButton />
            <h2>{c.title}{c.subtitle ? <span> — {c.subtitle}</span> : null}</h2>
            <div class="chart">
              <div class="fps">{this.fps} fps</div>
              <Plot3D options={c.options} onReady={(p) => this.register(c.setup, p)} />
            </div>
          </div>
        ))}

        {/* Linked finance dashboard — price + volume joined via linkX. */}
        <div class="panel" key="fin-price">
          <FsButton />
          <h2>Linked finance · price<span> — candlesticks · ordinal-time</span></h2>
          <div class="chart">
            <div class="fps">{this.fps} fps</div>
            <Plot options={FIN_OPTS_PRICE} onReady={(p) => this.onFinancePrice(p)} />
          </div>
        </div>
        <div class="panel" key="fin-vol">
          <FsButton />
          <h2>Linked finance · volume<span> — linkX-ed pane</span></h2>
          <div class="chart">
            <div class="fps">{this.fps} fps</div>
            <Plot options={FIN_OPTS_VOL} onReady={(p) => this.onFinanceVol(p)} />
          </div>
        </div>
      </div>
    );
  }
}

// ============================================================================
// Finance tab — specialist charts on the finance module. All STATIC (no FPS).
// Single-layer transforms (Heikin-Ashi / Renko / volume profile) render
// declaratively via `series`; multi-layer overlays (Bollinger, Depth) and the
// linkX-ed price/RSI/MACD dashboard are wired imperatively through onReady.
// ============================================================================
class FinanceTab extends Component {
  created(): void { finLinked = {}; }

  // Bollinger bands over the candlesticks (candles come from the declarative series).
  onBollinger(plot: any): void {
    addBollinger(plot, { x: FIN.idx, close: FIN.c, period: 20, k: 2, bandColor: "rgba(167,139,250,0.14)" });
  }

  // Depth chart from the synthesized cumulative order book.
  onDepth(plot: any): void {
    addDepth(plot, { bids: FIN.bids, asks: FIN.asks });
  }

  // Linked dashboard — capture each core plot, then join on the ordinal-time axis.
  onLinkPrice(plot: any): void { finLinked.price = plot; this.linkReady(); }
  onLinkRsi(plot: any): void { finLinked.rsi = plot; this.linkReady(); }
  onLinkMacd(plot: any): void { finLinked.macd = plot; this.linkReady(); }
  private linkReady(): void {
    if (finLinked.price && finLinked.rsi && finLinked.macd) linkX([finLinked.price, finLinked.rsi, finLinked.macd]);
  }

  template() {
    return (
      <div class="grid">
        <div class="panel">
          <FsButton />
          <h2>Heikin-Ashi<span> — smoothed candles</span></h2>
          <div class="chart">
            <Plot options={FIN_ORD} series={[{ type: "heikinAshi", x: FIN.idx, open: FIN.o, high: FIN.h, low: FIN.l, close: FIN.c }]} />
          </div>
        </div>

        <div class="panel">
          <FsButton />
          <h2>Renko<span> — brickSize 2 · wickless</span></h2>
          <div class="chart">
            <Plot options={FIN_PLAIN} series={[{ type: "renko", close: FIN.c, brickSize: 2 }]} />
          </div>
        </div>

        <div class="panel">
          <FsButton />
          <h2>Bollinger Bands<span> — 20 · 2σ</span></h2>
          <div class="chart">
            <Plot options={FIN_ORD} series={[{ type: "candlestick", x: FIN.idx, open: FIN.o, high: FIN.h, low: FIN.l, close: FIN.c }]} onReady={(p) => this.onBollinger(p)} />
          </div>
        </div>

        <div class="panel">
          <FsButton />
          <h2>Volume profile<span> — volume by price · POC</span></h2>
          <div class="chart">
            <Plot options={FIN_PLAIN} series={[{ type: "volumeProfile", price: FIN.c, volume: FIN.vol, bins: 24, color: "#3b82f6", pocColor: "#f59e0b" }]} />
          </div>
        </div>

        <div class="panel">
          <FsButton />
          <h2>Depth chart<span> — cumulative order book</span></h2>
          <div class="chart">
            <Plot options={FIN_PLAIN} onReady={(p) => this.onDepth(p)} />
          </div>
        </div>

        <div class="panel">
          <FsButton />
          <h2>Linked · price<span> — candles · drag to pan</span></h2>
          <div class="chart">
            <Plot options={FIN_ORD} series={[{ type: "candlestick", x: FIN.idx, open: FIN.o, high: FIN.h, low: FIN.l, close: FIN.c }]} onReady={(p) => this.onLinkPrice(p)} />
          </div>
        </div>

        <div class="panel">
          <FsButton />
          <h2>Linked · RSI(14)<span> — 70 / 30 guides</span></h2>
          <div class="chart">
            <Plot
              options={FIN_RSI_OPTS}
              series={[{ type: "line", x: FIN_RSI.x, y: FIN_RSI.y, color: "#f472b6", width: 1.5, name: "RSI" }]}
              annotations={[
                { type: "span", dim: "y", value: 70, color: "#475569", dash: [4, 4] },
                { type: "span", dim: "y", value: 30, color: "#475569", dash: [4, 4] },
              ]}
              onReady={(p) => this.onLinkRsi(p)}
            />
          </div>
        </div>

        <div class="panel">
          <FsButton />
          <h2>Linked · MACD<span> — 12/26/9</span></h2>
          <div class="chart">
            <Plot
              options={FIN_ORD}
              series={[
                { type: "bar", x: FIN_HIST.x, y: FIN_HIST.y, width: 0.7, color: "#64748b" },
                { type: "line", x: FIN_MLINE.x, y: FIN_MLINE.y, color: "#60a5fa", width: 1.5, name: "MACD" },
                { type: "line", x: FIN_SIG.x, y: FIN_SIG.y, color: "#f59e0b", width: 1.5, name: "signal" },
              ]}
              onReady={(p) => this.onLinkMacd(p)}
            />
          </div>
        </div>
      </div>
    );
  }
}

// ============================================================================
// ML tab — deep-learning charts on the ml module. All STATIC (no FPS). Every
// panel is a composed ML builder (addConfusionMatrix / addEmbedding / …) wired
// imperatively through onReady on the core Plot handle, from the ml catalog.
// ============================================================================
class MLTab extends Component {
  template() {
    return (
      <div class="grid">
        {ML.map((c) => (
          <div class="panel" key={`ml-${c.title}`}>
            <FsButton />
            <h2>{c.title}{c.subtitle ? <span> — {c.subtitle}</span> : null}</h2>
            <div class="chart">
              <Plot options={c.options} onReady={(p) => c.setup(p)} />
            </div>
          </div>
        ))}
      </div>
    );
  }
}

// ============================================================================
// App shell — one grid per tab. Static is default and built on load; Dynamic,
// Finance and ML mount LAZILY the first time their tab is activated so their
// WebGL charts are built while visible (a plot built under display:none sizes
// to 0). Built tabs stay mounted (just hidden) so switching back is instant.
// ============================================================================
export default class App extends Component {
  activeTab: "static" | "dynamic" | "finance" | "ml" = "static";
  builtDynamic = false;
  builtFinance = false;
  builtMl = false;

  activate(name: "static" | "dynamic" | "finance" | "ml"): void {
    // Make the tab visible first, then mount its charts on the next frame — so a
    // lazily-built plot never initializes while its section is still display:none
    // (a WebGL plot built hidden sizes to 0).
    this.activeTab = name;
    if (name === "dynamic" && !this.builtDynamic) requestAnimationFrame(() => { this.builtDynamic = true; });
    if (name === "finance" && !this.builtFinance) requestAnimationFrame(() => { this.builtFinance = true; });
    if (name === "ml" && !this.builtMl) requestAnimationFrame(() => { this.builtMl = true; });
  }

  template() {
    return (
      <main>
        <header>
          <h1><b>Photon</b> · Gea — WebGL2 chart gallery</h1>
          <p>Config-driven Gea components over one shared WebGL2 context. <b>Static</b>: the full chart catalog. <b>Dynamic</b>: the same catalog streaming live at 60fps, each panel with an FPS badge.</p>
        </header>

        <div class="tabs">
          <button class={this.activeTab === "static" ? "tab active" : "tab"} click={() => this.activate("static")}>Static<span class="count">{STATIC_COUNT}</span></button>
          <button class={this.activeTab === "dynamic" ? "tab active" : "tab"} click={() => this.activate("dynamic")}>Dynamic<span class="count">{DYNAMIC_COUNT}</span></button>
          <button class={this.activeTab === "finance" ? "tab active" : "tab"} click={() => this.activate("finance")}>Finance<span class="count">{FINANCE_COUNT}</span></button>
          <button class={this.activeTab === "ml" ? "tab active" : "tab"} click={() => this.activate("ml")}>ML<span class="count">{ML_COUNT}</span></button>
        </div>
        <div class="tabbar-line"></div>

        <section class={this.activeTab === "static" ? "tabpanel active" : "tabpanel"}>
          <StaticTab />
        </section>
        <section class={this.activeTab === "dynamic" ? "tabpanel active" : "tabpanel"}>
          {this.builtDynamic ? <DynamicTab active={this.activeTab === "dynamic"} /> : null}
        </section>
        <section class={this.activeTab === "finance" ? "tabpanel active" : "tabpanel"}>
          {this.builtFinance ? <FinanceTab /> : null}
        </section>
        <section class={this.activeTab === "ml" ? "tabpanel active" : "tabpanel"}>
          {this.builtMl ? <MLTab /> : null}
        </section>
      </main>
    );
  }
}
