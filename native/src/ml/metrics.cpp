#include "ml/metrics.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>

namespace photon::ml {

namespace {

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
constexpr double kInf = std::numeric_limits<double>::infinity();

/// Indices sorted by descending score.
///
/// `std::sort` with the same comparator the TypeScript uses. The order among
/// equal scores is unspecified in both, and it does not matter: the curve
/// builders consume a whole tie group at once before emitting a vertex, which
/// is exactly what makes the result independent of how ties are ordered.
std::vector<size_t> argsort_desc(const double* scores, size_t n) {
  std::vector<size_t> idx(n);
  std::iota(idx.begin(), idx.end(), size_t{0});
  std::sort(idx.begin(), idx.end(), [scores](size_t a, size_t b) { return scores[a] > scores[b]; });
  return idx;
}

/// The TypeScript's `x | 0`: truncate toward zero into a 32-bit int.
int to_int(double v) {
  if (!std::isfinite(v)) return 0;
  return static_cast<int>(v);
}

}  // namespace

ConfusionMatrix confusion_matrix(const double* y_true, const double* y_pred, size_t count,
                                 int classes) {
  ConfusionMatrix out;
  if (!y_true || !y_pred) count = 0;
  int c = classes;
  if (classes <= 0) {
    c = 0;
    for (size_t i = 0; i < count; ++i) {
      c = std::max({c, to_int(y_true[i]) + 1, to_int(y_pred[i]) + 1});
    }
  }
  c = std::max(1, c);
  out.classes = static_cast<size_t>(c);
  out.counts.assign(out.classes * out.classes, 0.0);
  for (size_t i = 0; i < count; ++i) {
    const int t = to_int(y_true[i]);
    const int p = to_int(y_pred[i]);
    if (t < 0 || t >= c || p < 0 || p >= c) continue;
    out.counts[static_cast<size_t>(t) * out.classes + static_cast<size_t>(p)] += 1.0;
  }
  out.support.assign(out.classes, 0.0);
  out.normalized.assign(out.classes * out.classes, 0.0);
  for (size_t t = 0; t < out.classes; ++t) {
    double s = 0.0;
    for (size_t p = 0; p < out.classes; ++p) s += out.counts[t * out.classes + p];
    out.support[t] = s;
    if (s > 0.0) {
      for (size_t p = 0; p < out.classes; ++p) {
        out.normalized[t * out.classes + p] = out.counts[t * out.classes + p] / s;
      }
    }
  }
  return out;
}

RocCurve roc_curve(const double* scores, const double* labels, size_t count) {
  RocCurve out;
  if (!scores || !labels) count = 0;
  size_t positives = 0;
  size_t negatives = 0;
  for (size_t i = 0; i < count; ++i) {
    if (labels[i] != 0.0) {
      ++positives;
    } else {
      ++negatives;
    }
  }
  const std::vector<size_t> idx = argsort_desc(scores, count);
  out.fpr.push_back(0.0);
  out.tpr.push_back(0.0);
  out.thresholds.push_back(kInf);
  double tp = 0.0;
  double fp = 0.0;
  double prev_f = 0.0;
  double prev_t = 0.0;
  double auc = 0.0;
  for (size_t i = 0; i < count;) {
    const double t = scores[idx[i]];
    // The whole tie group is consumed before a vertex is emitted, which is what
    // makes the curve independent of how equal scores happened to sort.
    while (i < count && scores[idx[i]] == t) {
      if (labels[idx[i]] != 0.0) {
        tp += 1.0;
      } else {
        fp += 1.0;
      }
      ++i;
    }
    const double f = negatives ? fp / static_cast<double>(negatives) : 0.0;
    const double r = positives ? tp / static_cast<double>(positives) : 0.0;
    auc += ((f - prev_f) * (r + prev_t)) / 2.0;
    out.fpr.push_back(f);
    out.tpr.push_back(r);
    out.thresholds.push_back(t);
    prev_f = f;
    prev_t = r;
  }
  out.auc = (positives && negatives) ? auc : kNaN;
  return out;
}

PrCurve pr_curve(const double* scores, const double* labels, size_t count) {
  PrCurve out;
  if (!scores || !labels) count = 0;
  size_t positives = 0;
  for (size_t i = 0; i < count; ++i) {
    if (labels[i] != 0.0) ++positives;
  }
  const std::vector<size_t> idx = argsort_desc(scores, count);
  out.recall.push_back(0.0);
  out.precision.push_back(1.0);
  out.thresholds.push_back(kInf);
  double tp = 0.0;
  double fp = 0.0;
  double prev_r = 0.0;
  double ap = 0.0;
  for (size_t i = 0; i < count;) {
    const double t = scores[idx[i]];
    while (i < count && scores[idx[i]] == t) {
      if (labels[idx[i]] != 0.0) {
        tp += 1.0;
      } else {
        fp += 1.0;
      }
      ++i;
    }
    const double r = positives ? tp / static_cast<double>(positives) : 0.0;
    const double p = (tp + fp) != 0.0 ? tp / (tp + fp) : 1.0;
    ap += (r - prev_r) * p;
    out.recall.push_back(r);
    out.precision.push_back(p);
    out.thresholds.push_back(t);
    prev_r = r;
  }
  out.ap = positives ? ap : kNaN;
  out.baseline = count ? static_cast<double>(positives) / static_cast<double>(count) : 0.0;
  return out;
}

CalibrationCurve calibration_curve(const double* scores, const double* labels, size_t count,
                                   int bins) {
  CalibrationCurve out;
  if (!scores || !labels) count = 0;
  const size_t b = static_cast<size_t>(std::max(1, bins));
  std::vector<double> sum_score(b, 0.0);
  std::vector<double> sum_label(b, 0.0);
  out.bin_count.assign(b, 0.0);
  for (size_t i = 0; i < count; ++i) {
    const double s = scores[i];
    if (!std::isfinite(s)) continue;
    double raw = std::floor(s * static_cast<double>(b));
    if (!(raw >= 0.0)) raw = 0.0;
    size_t k = static_cast<size_t>(raw);
    if (k >= b) k = b - 1;
    sum_score[k] += s;
    sum_label[k] += labels[i] != 0.0 ? 1.0 : 0.0;
    out.bin_count[k] += 1.0;
  }
  out.mean_predicted.assign(b, kNaN);
  out.fraction_positive.assign(b, kNaN);
  const double n = static_cast<double>(std::max<size_t>(1, count));
  for (size_t k = 0; k < b; ++k) {
    if (out.bin_count[k] <= 0.0) continue;
    const double conf = sum_score[k] / out.bin_count[k];
    const double acc = sum_label[k] / out.bin_count[k];
    out.mean_predicted[k] = conf;
    out.fraction_positive[k] = acc;
    out.ece += (out.bin_count[k] / n) * std::abs(acc - conf);
  }
  return out;
}

std::vector<double> ema_smooth(const double* values, size_t count, double weight) {
  std::vector<double> out(count, 0.0);
  if (!values) return out;
  const double w = std::min(0.999999, std::max(0.0, weight));
  double last = 0.0;
  int num = 0;
  for (size_t i = 0; i < count; ++i) {
    const double v = values[i];
    if (!std::isfinite(v)) {
      out[i] = v;
      continue;
    }
    last = last * w + (1.0 - w) * v;
    ++num;
    // The debias: without it the first samples are pulled toward zero, which
    // reads as a training curve that starts lower than it did.
    out[i] = last / (1.0 - std::pow(w, static_cast<double>(num)));
  }
  return out;
}

double mse(const double* y_true, const double* y_pred, size_t count) {
  if (!y_true || !y_pred || count == 0) return kNaN;
  double acc = 0.0;
  for (size_t i = 0; i < count; ++i) {
    const double d = y_true[i] - y_pred[i];
    acc += d * d;
  }
  return acc / static_cast<double>(count);
}

double rmse(const double* y_true, const double* y_pred, size_t count) {
  return std::sqrt(mse(y_true, y_pred, count));
}

double mae(const double* y_true, const double* y_pred, size_t count) {
  if (!y_true || !y_pred || count == 0) return kNaN;
  double acc = 0.0;
  for (size_t i = 0; i < count; ++i) acc += std::abs(y_true[i] - y_pred[i]);
  return acc / static_cast<double>(count);
}

double r2(const double* y_true, const double* y_pred, size_t count) {
  if (!y_true || !y_pred || count == 0) return kNaN;
  double mean = 0.0;
  for (size_t i = 0; i < count; ++i) mean += y_true[i];
  mean /= static_cast<double>(count);
  double ss_res = 0.0;
  double ss_tot = 0.0;
  for (size_t i = 0; i < count; ++i) {
    const double r = y_true[i] - y_pred[i];
    const double t = y_true[i] - mean;
    ss_res += r * r;
    ss_tot += t * t;
  }
  if (ss_tot == 0.0) return ss_res == 0.0 ? 1.0 : 0.0;
  return 1.0 - ss_res / ss_tot;
}

double log_loss(const double* probs, const double* labels, size_t count, double eps) {
  if (!probs || !labels || count == 0) return kNaN;
  double acc = 0.0;
  for (size_t i = 0; i < count; ++i) {
    const double p = std::min(1.0 - eps, std::max(eps, probs[i]));
    acc += labels[i] > 0.0 ? -std::log(p) : -std::log(1.0 - p);
  }
  return acc / static_cast<double>(count);
}

double brier_score(const double* probs, const double* labels, size_t count) {
  if (!probs || !labels || count == 0) return kNaN;
  double acc = 0.0;
  for (size_t i = 0; i < count; ++i) {
    const double d = probs[i] - (labels[i] > 0.0 ? 1.0 : 0.0);
    acc += d * d;
  }
  return acc / static_cast<double>(count);
}

ClassificationReport classification_report(const double* y_true, const double* y_pred, size_t count,
                                           int classes) {
  ClassificationReport out;
  if (!y_true || !y_pred) count = 0;
  int k = classes;
  if (classes <= 0) {
    k = 0;
    for (size_t i = 0; i < count; ++i) {
      k = std::max({k, static_cast<int>(y_true[i]) + 1, static_cast<int>(y_pred[i]) + 1});
    }
  }
  k = std::max(0, k);
  const size_t kn = static_cast<size_t>(k);

  std::vector<double> tp(kn, 0.0);
  std::vector<double> fp(kn, 0.0);
  std::vector<double> fn(kn, 0.0);
  std::vector<double> support(kn, 0.0);
  size_t correct = 0;
  for (size_t i = 0; i < count; ++i) {
    const double t = y_true[i];
    const double p = y_pred[i];
    if (t >= 0.0 && t < static_cast<double>(k)) support[static_cast<size_t>(t)] += 1.0;
    if (t == p) {
      ++correct;
      if (t >= 0.0 && t < static_cast<double>(k)) tp[static_cast<size_t>(t)] += 1.0;
    } else {
      if (p >= 0.0 && p < static_cast<double>(k)) fp[static_cast<size_t>(p)] += 1.0;
      if (t >= 0.0 && t < static_cast<double>(k)) fn[static_cast<size_t>(t)] += 1.0;
    }
  }

  out.per_class.reserve(kn);
  for (size_t c = 0; c < kn; ++c) {
    ClassScore score;
    score.label = static_cast<int>(c);
    score.precision = (tp[c] + fp[c]) == 0.0 ? 0.0 : tp[c] / (tp[c] + fp[c]);
    score.recall = (tp[c] + fn[c]) == 0.0 ? 0.0 : tp[c] / (tp[c] + fn[c]);
    score.f1 = (score.precision + score.recall) == 0.0
                   ? 0.0
                   : (2.0 * score.precision * score.recall) / (score.precision + score.recall);
    score.support = support[c];
    out.per_class.push_back(score);
  }

  const auto average = [&](double ClassScore::*field, bool weighted) {
    if (kn == 0) return 0.0;
    if (!weighted) {
      double acc = 0.0;
      for (const ClassScore& s : out.per_class) acc += s.*field;
      return acc / static_cast<double>(kn);
    }
    double acc = 0.0;
    double total = 0.0;
    for (size_t c = 0; c < kn; ++c) {
      acc += out.per_class[c].*field * support[c];
      total += support[c];
    }
    return total == 0.0 ? 0.0 : acc / total;
  };
  out.accuracy = count == 0 ? 0.0 : static_cast<double>(correct) / static_cast<double>(count);
  out.macro.precision = average(&ClassScore::precision, false);
  out.macro.recall = average(&ClassScore::recall, false);
  out.macro.f1 = average(&ClassScore::f1, false);
  out.weighted.precision = average(&ClassScore::precision, true);
  out.weighted.recall = average(&ClassScore::recall, true);
  out.weighted.f1 = average(&ClassScore::f1, true);
  return out;
}

LiftCurve lift_curve(const double* scores, const double* labels, size_t count) {
  LiftCurve out;
  if (!scores || !labels) count = 0;
  const std::vector<size_t> order = argsort_desc(scores, count);
  for (size_t i = 0; i < count; ++i) {
    if (labels[i] > 0.0) ++out.positives;
  }
  out.fraction.assign(count + 1, 0.0);
  out.gain.assign(count + 1, 0.0);
  out.lift.assign(count + 1, 0.0);
  double hits = 0.0;
  for (size_t i = 0; i < count; ++i) {
    if (labels[order[i]] > 0.0) hits += 1.0;
    const double f = static_cast<double>(i + 1) / static_cast<double>(count);
    out.fraction[i + 1] = f;
    out.gain[i + 1] = out.positives == 0 ? 0.0 : hits / static_cast<double>(out.positives);
    out.lift[i + 1] = f == 0.0 ? 0.0 : out.gain[i + 1] / f;
  }
  // The origin has no fraction to divide by, so it borrows the first step's
  // lift rather than plotting a zero the curve never actually passes through.
  out.lift[0] = count == 0 ? 0.0 : out.lift[1];
  return out;
}

MulticlassRoc roc_curve_ovr(const double* scores, const double* labels, size_t count,
                            size_t classes) {
  MulticlassRoc out;
  if (!scores || !labels) count = 0;
  double macro = 0.0;
  // The micro curve pools every (score, is-this-class) pair into one problem.
  std::vector<double> pooled_scores(count * classes, 0.0);
  std::vector<double> pooled_labels(count * classes, 0.0);
  std::vector<double> s(count, 0.0);
  std::vector<double> l(count, 0.0);
  for (size_t c = 0; c < classes; ++c) {
    for (size_t i = 0; i < count; ++i) {
      s[i] = scores[i * classes + c];
      l[i] = static_cast<size_t>(labels[i]) == c ? 1.0 : 0.0;
      pooled_scores[c * count + i] = s[i];
      pooled_labels[c * count + i] = l[i];
    }
    RocCurve roc = roc_curve(s.data(), l.data(), count);
    macro += roc.auc;
    out.per_class.push_back(std::move(roc));
  }
  out.macro_auc = classes == 0 ? 0.0 : macro / static_cast<double>(classes);
  out.micro_auc = roc_curve(pooled_scores.data(), pooled_labels.data(), count * classes).auc;
  return out;
}

}  // namespace photon::ml
