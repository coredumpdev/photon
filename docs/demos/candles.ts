/** Candlesticks with Bollinger bands, on a gap-free session axis. */
import { Plot, addBollinger } from "@photonviz/core";
import { BASE, ohlc } from "./_data";

export default (el: HTMLElement) => {
  const bars = ohlc(160);
  const plot = new Plot(el, { ...BASE, title: "Price", legend: true });

  plot.addCandlestick(bars);
  addBollinger(plot, { x: bars.x, close: bars.close, period: 20 });
  return () => plot.destroy();
};
