# Machine learning

Composed builders over the same layers, fed by pure metrics.

<Demo src="roc" :height="340" />

## Evaluation

| Builder | Shows |
| --- | --- |
| `addConfusionMatrix` | counts or row-normalised recall, with per-cell labels |
| `addRocCurve` | ROC + chance diagonal, AUC in the legend |
| `addPrCurve` | precision–recall + no-skill baseline, AP in the legend |
| `addCalibration` | reliability diagram + ECE |
| `addLiftCurve` | cumulative gain or lift against the fraction targeted |
| `addPredVsActual` | predictions against truth with the y=x reference and R² |
| `addResiduals` | residuals against the prediction or the sample order |
| `addLearningCurve` | train/validation score vs. training-set size, with CV bands |

<Demo src="confusion" :height="360" />

## Explainability & training

`addFeatureImportance` · `addShapBeeswarm` · `addPartialDependence` (PDP + ICE) ·
`addAttentionMap` · `addTrainingCurves` (EMA smoothing + best-epoch marker) ·
`addRidgeline` (distributions over epochs) · `addEmbedding` · `addDecisionBoundary`

## Pure metrics

Classification — `confusionMatrix`, `rocCurve`, `prCurve`, `calibrationCurve`,
`classificationReport` (per-class precision/recall/f1 plus macro and weighted
averages), `rocCurveOvR` (one-vs-rest with macro/micro AUC), `liftCurve`,
`logLoss`, `brierScore`.

Regression — `r2`, `mse`, `rmse`, `mae`.

Reducers — `pca(data, n, d, k)`, `standardize`, `emaSmooth`, `beeswarmLayout`.

A class the model never predicts scores 0 rather than `NaN`, so macro averages
stay comparable across runs.
