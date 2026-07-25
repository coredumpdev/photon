# Finance

Specialist charts, a deep indicator set, and a session axis that removes market
gaps — all on the same GPU pipeline.

<Demo src="candles" :height="360" />

## Charts

```ts
import { addBollinger, addDepth, addDrawdown, addHeikinAshi, addRenko, addVolumeProfile } from "@photonviz/core";
```

`plot.addCandlestick({ x, open, high, low, close })` and `plot.addOhlc(...)` are
the primitives; the builders above compose them with a transform.

## The session axis

Real markets have gaps — nights, weekends, holidays. Plotting against wall-clock
time leaves dead space. `ordinal-time` plots bars at integer indices, so the gaps
collapse, while the ticks still show calendar dates:

```ts
new Plot(el, { scales: { x: { type: "ordinal-time", times: epochMs } } });
```

## Indicators

Pure `array → array`, each returning a `Float64Array` with a leading `NaN`
warm-up run that the layers skip:

`sma` `ema` `wma` `rollingStd` `bollinger` `rsi` `macd` `vwap` `trueRange` `atr`
`stochastic` `keltner` `obv` `ichimoku` `adx` `superTrend` `fibRetracements`
`cci` `mfi` `williamsR` `aroon` `donchian` `parabolicSar` `pivotPoints`

## Transforms

`heikinAshi` `renko` `lineBreak` `pointAndFigure` `volumeProfile` `depth`
`resampleOhlc(time, ohlc, bucketMs, volume?)` `drawdown(equity)`

`resampleOhlc` rolls bars up to a coarser timeframe with buckets aligned to the
epoch, skipping empty ones rather than filling them — which is what a market
calendar wants.

## Drawdown

The companion pane to an equity curve: how far below its running high-water mark
the strategy sat, and the deepest stretch marked.

<Demo src="drawdown" :height="340" />

## Linked panes

`linkX([price, volume, rsi])` syncs pan, zoom and the crosshair across the stack.
