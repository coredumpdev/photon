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

## Smoothing & correlation in time

- `savitzkyGolay(values, window, order)` — least-squares polynomial smoothing that
  preserves peak height and width, unlike a moving average.
- `crossCorrelate(a, b, maxLag)` → `{ lags, values }`. Normalised by default, so
  the peak lag reads directly as "b lags a by k". Pass the same array twice for
  an autocorrelation.
- `zscore`, `ecdf` for quick standardisation and ranking.
