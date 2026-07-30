// Classification and regression metrics — port of core/src/ml/metrics.ts.
//
// Array in, struct out, no state. The charts that draw these live above them:
// a ROC curve is two arrays and a number long before anything decides to plot
// it, and keeping that separation is what lets a host score a model on a
// worker thread.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::ml {

/// A confusion matrix: raw counts and the row-normalised (recall) view.
struct ConfusionMatrix {
  /// Row-major `classes * classes`; row is the true label, column the predicted.
  std::vector<double> counts;
  /// Row-normalised. A row with no support stays all zero rather than NaN.
  std::vector<double> normalized;
  /// Per-true-class support — the row totals.
  std::vector<double> support;
  size_t classes = 0;
};

/// `classes` of 0 means max(label) + 1. Out-of-range labels are ignored.
ConfusionMatrix confusion_matrix(const double* y_true, const double* y_pred, size_t count,
                                 int classes = 0);

/// A receiver-operating-characteristic curve and its area.
struct RocCurve {
  std::vector<double> fpr;
  std::vector<double> tpr;
  /// The score threshold at each vertex; +inf at the origin.
  std::vector<double> thresholds;
  /// NaN when either class is absent — an AUC over one class is meaningless.
  double auc = 0.0;
};

/// Ties at equal scores collapse to one vertex; the AUC is the trapezoid rule.
RocCurve roc_curve(const double* scores, const double* labels, size_t count);

/// A precision-recall curve and its average precision.
struct PrCurve {
  std::vector<double> recall;
  std::vector<double> precision;
  std::vector<double> thresholds;
  /// Sum of (R_n - R_n-1) * P_n. NaN with no positives.
  double ap = 0.0;
  /// The positive base rate — what a no-skill classifier scores.
  double baseline = 0.0;
};

PrCurve pr_curve(const double* scores, const double* labels, size_t count);

/// A reliability diagram: predicted confidence against observed frequency.
struct CalibrationCurve {
  /// Mean predicted probability per bin; NaN where the bin is empty.
  std::vector<double> mean_predicted;
  /// Observed positive fraction per bin; NaN where the bin is empty.
  std::vector<double> fraction_positive;
  std::vector<double> bin_count;
  /// Expected Calibration Error — sum of (n_b/N) * |acc_b - conf_b|.
  double ece = 0.0;
};

CalibrationCurve calibration_curve(const double* scores, const double* labels, size_t count,
                                   int bins = 10);

/// TensorBoard's debiased EMA over a noisy training curve. Non-finite values
/// pass through and do not advance the average.
std::vector<double> ema_smooth(const double* values, size_t count, double weight = 0.6);

double mse(const double* y_true, const double* y_pred, size_t count);
double rmse(const double* y_true, const double* y_pred, size_t count);
double mae(const double* y_true, const double* y_pred, size_t count);
/// 1 is perfect, 0 matches predicting the mean, negative is worse than that.
double r2(const double* y_true, const double* y_pred, size_t count);

/// Binary cross-entropy. Probabilities are clipped away from 0 and 1 so one
/// confident mistake cannot return infinity.
double log_loss(const double* probs, const double* labels, size_t count, double eps = 1e-15);
/// Mean squared error of predicted probabilities. Lower is better.
double brier_score(const double* probs, const double* labels, size_t count);

/// Precision, recall, F1 and support for one class.
struct ClassScore {
  int label = 0;
  double precision = 0.0;
  double recall = 0.0;
  double f1 = 0.0;
  double support = 0.0;
};

struct Average {
  double precision = 0.0;
  double recall = 0.0;
  double f1 = 0.0;
};

/// A scikit-learn shaped report.
struct ClassificationReport {
  std::vector<ClassScore> per_class;
  double accuracy = 0.0;
  /// Unweighted over classes — every class counts the same.
  Average macro;
  /// Support-weighted — dominated by the common classes.
  Average weighted;
};

/// A class the model never predicts scores 0 precision rather than NaN, so the
/// macro average stays comparable across runs.
ClassificationReport classification_report(const double* y_true, const double* y_pred,
                                           size_t count, int classes = 0);

/// Cumulative gain and lift against the fraction of the population targeted.
struct LiftCurve {
  std::vector<double> fraction;
  /// The share of all positives captured by then — the gain curve.
  std::vector<double> gain;
  /// gain / fraction: how many times better than random.
  std::vector<double> lift;
  size_t positives = 0;
};

LiftCurve lift_curve(const double* scores, const double* labels, size_t count);

/// One-vs-rest ROC for a multiclass problem.
struct MulticlassRoc {
  std::vector<RocCurve> per_class;
  /// The unweighted mean of the per-class AUCs.
  double macro_auc = 0.0;
  /// The AUC of the pooled binarised problem, dominated by the common classes.
  double micro_auc = 0.0;
};

/// `scores` is row-major `count * classes`, `labels` the true class index.
MulticlassRoc roc_curve_ovr(const double* scores, const double* labels, size_t count,
                            size_t classes);

}  // namespace photon::ml
