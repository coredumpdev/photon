// Importing the package registers <photon-plot>, <photon-plot3d>, <photon-polar>.
import { PhotonPlotElement, PhotonPlot3DElement, PhotonPolarElement } from "@photonviz/wc";

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// --- Line --------------------------------------------------------------------
{
  const x = Float64Array.from({ length: 240 }, (_, i) => i);
  const y = x.map((v) => Math.sin(v / 14) + Math.sin(v / 37) * 0.4);
  byId<PhotonPlotElement>("line").series = [{ type: "line", x, y, color: "#60a5fa", width: 2, name: "signal" }];
}

// --- Candlestick + Heikin-Ashi (shared OHLC) ---------------------------------
{
  const n = 60;
  const x = Float64Array.from({ length: n }, (_, i) => i);
  const open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n);
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price, c = o + (Math.random() - 0.5) * 5;
    open[i] = o; close[i] = c;
    high[i] = Math.max(o, c) + Math.random() * 2;
    low[i] = Math.min(o, c) - Math.random() * 2;
    price = c;
  }
  byId<PhotonPlotElement>("candle").series = [{ type: "candlestick", x, open, high, low, close }];
  byId<PhotonPlotElement>("ha").series = [{ type: "heikinAshi", x, open, high, low, close }];
}

// --- Bars --------------------------------------------------------------------
{
  const x = Float64Array.from({ length: 12 }, (_, i) => i);
  const y = x.map(() => 20 + Math.random() * 80);
  byId<PhotonPlotElement>("bars").series = [{ type: "bar", x, y, color: "#34d399", width: 0.7 }];
}

// --- Pie ---------------------------------------------------------------------
{
  const pie = byId<PhotonPlotElement>("pie");
  pie.options = { theme: "dark", equalAspect: true, showToolbar: false };
  pie.series = [{ type: "pie", values: [38, 24, 18, 12, 8], colormap: "viridis" }];
}

// --- Polar -------------------------------------------------------------------
{
  const theta = Float64Array.from({ length: 180 }, (_, i) => (i * 2 * Math.PI) / 180);
  const r = theta.map((t) => 0.5 + 0.5 * Math.cos(3 * t));
  byId<PhotonPolarElement>("polar").series = [{ type: "line", theta, r, color: "#a78bfa", width: 2, closed: true }];
}

// --- 3D surface --------------------------------------------------------------
{
  const cols = 40, rows = 40;
  const values = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = (i / cols - 0.5) * 6, v = (j / rows - 0.5) * 6;
      values[j * cols + i] = Math.sin(Math.hypot(u, v)) / (Math.hypot(u, v) + 0.5);
    }
  }
  byId<PhotonPlot3DElement>("surf").layers = [{ type: "surface", values, cols, rows, colormap: "viridis" }];
}
