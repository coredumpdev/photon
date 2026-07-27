# Statistics & signal

## Fits

`addRegression` draws a least-squares line with an optional ±band, or a LOESS
curve when the relationship is not linear. The fit's r² lands in the legend, so
the chart states its own quality.

<Demo src="regression" :height="340" />

```ts
addRegression(plot, { x, y, band: 2 });                  // OLS ± 2·stderr
addRegression(plot, { x, y, method: "loess", bandwidth: 0.3 });
```

Pure equivalents: `linearRegression(x, y)` → `{ slope, intercept, r2, stderr,
predict }`, `linearTrend`, `loess`.

## Distributions

`addEcdf(plot, { values })` draws the empirical CDF as a step line — the most
honest way to compare two distributions, since it involves no binning choice at
all. `histogram`, `boxStats`, `kde` and `quantileSorted` are exported as pure
functions.

## Correlation

<Demo src="corr" :height="380" />

```ts
addCorrMatrix(plot, { columns, names });   // diverging, locked to ±1
corrMatrix(columns);                       // the raw k×k matrix
correlation(a, b);                         // one pair
```

## Spectra

`addPsd` runs Welch's method — averaged periodograms of overlapping windowed
segments — so a noisy signal gives a readable spectrum instead of grass.

<Demo src="psd" :height="340" />

```ts
addPsd(plot, { signal, sampleRate: 500, segment: 1024, window: "hann" });
```

Pure: `welch`, `windowFunction(name, n)` (`hann`, `hamming`, `blackman`,
`bartlett`, `rectangular`), `fft`, `spectrogram`.

## Waterfall

`addWaterfall` is the streaming half of a spectrogram: frequency across, time
**down**. Each pushed column becomes the newest row at the top, the history
slides down a row, and the y axis reads as a clock.

<Demo src="waterfall" :height="380" />

```ts
const wf = addWaterfall(plot, {
  extent: [0, 160_000],        // the band one row spans
  cols: 512, rows: 400,        // cells across × rows of history
  rowSeconds: 0.08,            // seconds one row covers → 32s on screen
  domain: [-68, -6],           // fix it, or the colours breathe every push
  colormap: "plasma", name: "power (dB)",
  timeFormat: "hh:mm:ss",      // or "mm:ss.mmm", or (s) => your own label
  timeTitle: "time",
});

wf.push(psdInDb);              // one column per step; longer columns are block-maxed
wf.setTimeAxis({ format: "mm:ss.mmm" });   // relabel live
plot.render();
```

A column longer than `cols` is reduced by **block maximum**, so a peak two bins
wide survives fitting a 200k-bin spectrum into a few hundred cells. Give the plot
`margin: { left: 72 }` — clock labels are wider than plain numbers and the margin
is not measured from them. `history` opens on a pre-computed grid (row 0 at the
bottom) instead of an empty one.

Pure: `waterfallTimeTicks(now, span, opts)`, `formatDuration(seconds, style)`,
`niceTimeStep(span, count)`, `blockMax(values, cols)`.

## Smoothing & correlation in time

- `savitzkyGolay(values, window, order)` — least-squares polynomial smoothing that
  preserves peak height and width, unlike a moving average.
- `crossCorrelate(a, b, maxLag)` → `{ lags, values }`. Normalised by default, so
  the peak lag reads directly as "b lags a by k". Pass the same array twice for
  an autocorrelation.
- `zscore`, `ecdf` for quick standardisation and ranking.
