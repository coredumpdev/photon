/*
 * Model metrics, PCA, CSV and LTTB.
 *
 * Transcribed from packages/core/test/ml.test.ts and data.test.ts. The ROC and
 * PR cases matter most: both walk a score-sorted list and collapse ties into a
 * single vertex, and an off-by-one in that walk gives an AUC that is plausible,
 * stable, and wrong — which is why the hand-computed 0.75 is here.
 */

#include <cmath>
#include <cstddef>
#include <cstring>
#include <string>
#include <vector>

#include "check.h"
#include "data/csv.hpp"
#include "data/downsample.hpp"
#include "ml/metrics.hpp"
#include "ml/reduce.hpp"

namespace ml = photon::ml;
namespace data = photon::data;

namespace {

// ---- classification metrics ----------------------------------------------

void test_confusion_matrix_counts_support_and_normalizes() {
  const std::vector<double> truth{0, 0, 1, 1, 2};
  const std::vector<double> pred{0, 1, 1, 1, 2};
  const ml::ConfusionMatrix cm = ml::confusion_matrix(truth.data(), pred.data(), 5, 3);
  CHECK_EQ(cm.classes, 3);
  const double want_counts[9] = {1, 1, 0, 0, 2, 0, 0, 0, 1};
  for (size_t i = 0; i < 9; ++i) CHECK_NEAR(cm.counts[i], want_counts[i], 1e-12);
  const double want_support[3] = {2, 2, 1};
  for (size_t i = 0; i < 3; ++i) CHECK_NEAR(cm.support[i], want_support[i], 1e-12);
  const double want_norm[9] = {0.5, 0.5, 0, 0, 1, 0, 0, 0, 1};
  for (size_t i = 0; i < 9; ++i) CHECK_NEAR(cm.normalized[i], want_norm[i], 1e-12);
}

void test_confusion_matrix_infers_the_class_count() {
  const std::vector<double> v{0, 3};
  CHECK_EQ(ml::confusion_matrix(v.data(), v.data(), 2).classes, 4);
}

void test_roc_perfect_separation_is_auc_one() {
  const std::vector<double> scores{0.9, 0.8, 0.2, 0.1};
  const std::vector<double> labels{1, 1, 0, 0};
  const ml::RocCurve roc = ml::roc_curve(scores.data(), labels.data(), 4);
  CHECK_NEAR(roc.auc, 1.0, 1e-10);
  CHECK_NEAR(roc.fpr.front(), 0.0, 1e-12);
  CHECK_NEAR(roc.tpr.front(), 0.0, 1e-12);
  CHECK_NEAR(roc.fpr.back(), 1.0, 1e-10);
  CHECK_NEAR(roc.tpr.back(), 1.0, 1e-10);
}

void test_roc_matches_a_hand_computed_auc() {
  const std::vector<double> scores{0.1, 0.4, 0.35, 0.8};
  const std::vector<double> labels{0, 0, 1, 1};
  CHECK_NEAR(ml::roc_curve(scores.data(), labels.data(), 4).auc, 0.75, 1e-10);
}

void test_roc_all_equal_is_chance_and_one_class_is_undefined() {
  const std::vector<double> flat{0.5, 0.5, 0.5, 0.5};
  const std::vector<double> mixed{1, 0, 1, 0};
  CHECK_NEAR(ml::roc_curve(flat.data(), mixed.data(), 4).auc, 0.5, 1e-10);
  const std::vector<double> two{0.9, 0.1};
  const std::vector<double> both{1, 1};
  // Not zero: an area under a curve that never rises is undefined, not empty.
  CHECK(std::isnan(ml::roc_curve(two.data(), both.data(), 2).auc));
}

void test_pr_curve_average_precision_and_baseline() {
  const std::vector<double> scores{0.1, 0.4, 0.35, 0.8};
  const std::vector<double> labels{0, 0, 1, 1};
  const ml::PrCurve pr = ml::pr_curve(scores.data(), labels.data(), 4);
  CHECK_NEAR(pr.ap, 0.8333333, 1e-5);
  CHECK_NEAR(pr.baseline, 0.5, 1e-10);
  CHECK_NEAR(pr.recall.front(), 0.0, 1e-12);
  CHECK_NEAR(pr.precision.front(), 1.0, 1e-12);
}

void test_calibration_curve_bins_and_ece() {
  const std::vector<double> scores{0.1, 0.2, 0.8, 0.9};
  const std::vector<double> labels{0, 0, 1, 1};
  const ml::CalibrationCurve cal = ml::calibration_curve(scores.data(), labels.data(), 4, 2);
  CHECK_NEAR(cal.mean_predicted[0], 0.15, 1e-10);
  CHECK_NEAR(cal.fraction_positive[0], 0.0, 1e-10);
  CHECK_NEAR(cal.mean_predicted[1], 0.85, 1e-10);
  CHECK_NEAR(cal.fraction_positive[1], 1.0, 1e-10);
  CHECK_NEAR(cal.ece, 0.15, 1e-10);
}

void test_calibration_empty_bins_are_nan() {
  const std::vector<double> scores{0.05, 0.06};
  const std::vector<double> labels{0, 1};
  const ml::CalibrationCurve cal = ml::calibration_curve(scores.data(), labels.data(), 2, 4);
  CHECK(std::isnan(cal.mean_predicted[3]));
}

void test_ema_debiases_so_the_first_sample_is_exact() {
  const std::vector<double> flat{5, 5, 5, 5};
  const std::vector<double> s = ml::ema_smooth(flat.data(), 4, 0.9);
  for (const double v : s) CHECK_NEAR(v, 5.0, 1e-10);
  const std::vector<double> jump{3, 100, 7};
  CHECK_NEAR(ml::ema_smooth(jump.data(), 3, 0.6)[0], 3.0, 1e-10);
}

void test_ema_passes_non_finite_through_without_advancing() {
  const std::vector<double> gap{2.0, std::nan(""), 2.0};
  const std::vector<double> s = ml::ema_smooth(gap.data(), 3, 0.5);
  CHECK(std::isnan(s[1]));
  CHECK_NEAR(s[2], 2.0, 1e-10);
}

void test_regression_metrics_agree_with_each_other() {
  // No TypeScript counterpart: the four are separate exports there and always
  // read together here, so what is checked is that they stay consistent.
  const std::vector<double> truth{1, 2, 3, 4};
  const std::vector<double> pred{1.5, 2.5, 2.5, 3.5};
  CHECK_NEAR(ml::mse(truth.data(), pred.data(), 4), 0.25, 1e-12);
  CHECK_NEAR(ml::rmse(truth.data(), pred.data(), 4), 0.5, 1e-12);
  CHECK_NEAR(ml::mae(truth.data(), pred.data(), 4), 0.5, 1e-12);
  // A perfect prediction is r2 = 1 even where the target is constant.
  const std::vector<double> same{7, 7, 7};
  CHECK_NEAR(ml::r2(same.data(), same.data(), 3), 1.0, 1e-12);
  const std::vector<double> off{7, 7, 8};
  CHECK_NEAR(ml::r2(same.data(), off.data(), 3), 0.0, 1e-12);
  CHECK(std::isnan(ml::mse(nullptr, nullptr, 0)));
}

void test_probability_scores() {
  // No TypeScript counterpart.
  const std::vector<double> probs{1.0, 0.0};
  const std::vector<double> labels{1, 0};
  CHECK_NEAR(ml::log_loss(probs.data(), labels.data(), 2), 0.0, 1e-12);
  CHECK_NEAR(ml::brier_score(probs.data(), labels.data(), 2), 0.0, 1e-12);
  // A confident mistake is clipped, so it costs a large number rather than inf.
  const std::vector<double> wrong{0, 1};
  const double loss = ml::log_loss(probs.data(), wrong.data(), 2);
  CHECK(std::isfinite(loss) && loss > 30.0);
}

void test_classification_report_scores_every_class() {
  // No TypeScript counterpart.
  const std::vector<double> truth{0, 0, 1, 1, 2};
  const std::vector<double> pred{0, 1, 1, 1, 0};
  const ml::ClassificationReport r =
      ml::classification_report(truth.data(), pred.data(), 5, 3);
  CHECK_EQ(r.per_class.size(), 3);
  CHECK_NEAR(r.accuracy, 3.0 / 5.0, 1e-12);
  // Class 0: one true positive, one false positive (the 2 predicted as 0).
  CHECK_NEAR(r.per_class[0].precision, 0.5, 1e-12);
  CHECK_NEAR(r.per_class[0].recall, 0.5, 1e-12);
  // Class 2 is never predicted, so it scores zero rather than NaN — which is
  // what keeps the macro average comparable between runs.
  CHECK_NEAR(r.per_class[2].precision, 0.0, 1e-12);
  CHECK_NEAR(r.per_class[2].f1, 0.0, 1e-12);
  CHECK(r.weighted.f1 >= r.macro.f1 - 1e-12);
}

void test_lift_curve_walks_a_ranked_list() {
  // No TypeScript counterpart.
  const std::vector<double> scores{0.9, 0.8, 0.2, 0.1};
  const std::vector<double> labels{1, 1, 0, 0};
  const ml::LiftCurve lift = ml::lift_curve(scores.data(), labels.data(), 4);
  CHECK_EQ(lift.positives, 2);
  CHECK_EQ(lift.fraction.size(), 5);
  CHECK_NEAR(lift.fraction[2], 0.5, 1e-12);
  CHECK_NEAR(lift.gain[2], 1.0, 1e-12);  // the top half holds every positive
  CHECK_NEAR(lift.lift[2], 2.0, 1e-12);  // twice as good as random
  CHECK_NEAR(lift.gain.back(), 1.0, 1e-12);
  CHECK_NEAR(lift.lift.back(), 1.0, 1e-12);
}

void test_one_vs_rest_roc() {
  // No TypeScript counterpart. Three samples, three classes, each scored
  // highest on its own class, so every one-vs-rest problem separates perfectly.
  const std::vector<double> scores{0.8, 0.1, 0.1, 0.1, 0.8, 0.1, 0.1, 0.1, 0.8};
  const std::vector<double> labels{0, 1, 2};
  const ml::MulticlassRoc roc = ml::roc_curve_ovr(scores.data(), labels.data(), 3, 3);
  CHECK_EQ(roc.per_class.size(), 3);
  for (const ml::RocCurve& c : roc.per_class) CHECK_NEAR(c.auc, 1.0, 1e-12);
  CHECK_NEAR(roc.macro_auc, 1.0, 1e-12);
  CHECK_NEAR(roc.micro_auc, 1.0, 1e-12);
}

// ---- PCA ------------------------------------------------------------------

void test_pca_recovers_the_dominant_axis() {
  const std::vector<double> data{-3, 0, -1, 0, 1, 0, 3, 0};  // 4x2, variance in dim 0
  const ml::PcaResult r = ml::pca(data.data(), 4, 2, 1);
  CHECK(std::abs(r.components[0]) > 0.999);
  CHECK(std::abs(r.components[1]) < 0.01);
  CHECK_NEAR(r.explained[0], 1.0, 1e-6);
  // The scores are the centred x-coordinates, up to a sign flip.
  const double want[4] = {3, 1, 1, 3};
  for (size_t i = 0; i < 4; ++i) CHECK_NEAR(std::abs(r.scores[i]), want[i], 1e-6);
}

void test_pca_is_deterministic() {
  const std::vector<double> data{1, 2, 2, 1, 3, 5, 4, 3, 5, 8};
  const ml::PcaResult a = ml::pca(data.data(), 5, 2, 2);
  const ml::PcaResult b = ml::pca(data.data(), 5, 2, 2);
  for (size_t i = 0; i < a.scores.size(); ++i) {
    // Bit for bit, because the seed is arithmetic rather than random and two
    // hosts drawing the same embedding depend on exactly that.
    CHECK(a.scores[i] == b.scores[i]);
  }
}

void test_standardize_centres_each_column() {
  const std::vector<double> data{1, 2, 3};
  const std::vector<double> z = ml::standardize(data.data(), 3, 1);
  CHECK_NEAR(z[0], -1.0, 1e-10);
  CHECK_NEAR(z[1], 0.0, 1e-10);
  CHECK_NEAR(z[2], 1.0, 1e-10);
}

// ---- CSV ------------------------------------------------------------------

data::Table parse(const std::string& text, const data::CsvOptions& opts = {}) {
  return data::parse_csv(text.data(), text.size(), opts);
}

void test_csv_parses_headers_and_numeric_columns() {
  const data::Table t = parse("x,y\n1,2\n3,4\n5,6");
  CHECK_EQ(t.column_count(), 2);
  CHECK_STR(t.headers()[0], "x");
  CHECK_STR(t.headers()[1], "y");
  CHECK_EQ(t.row_count(), 3);
  const std::vector<double> y = t.numeric(1);
  CHECK_NEAR(y[0], 2.0, 1e-12);
  CHECK_NEAR(y[2], 6.0, 1e-12);
  CHECK_STR(t.cell(1, 0), "3");
  CHECK_EQ(t.index_of("y"), 1);
  CHECK_EQ(t.index_of("nope"), -1);
}

void test_csv_handles_quotes_commas_and_escapes() {
  const data::Table t = parse("name,note\n\"Doe, John\",\"he said \"\"hi\"\"\"\nJane,ok");
  CHECK_STR(t.cell(0, 0), "Doe, John");
  CHECK_STR(t.cell(0, 1), "he said \"hi\"");
  CHECK_STR(t.cell(1, 0), "Jane");
}

void test_csv_handles_crlf_and_skips_blank_lines() {
  const data::Table t = parse("a,b\r\n1,2\r\n\r\n3,4\r\n");
  CHECK_EQ(t.row_count(), 2);
  const std::vector<double> b = t.numeric(1);
  CHECK_NEAR(b[0], 2.0, 1e-12);
  CHECK_NEAR(b[1], 4.0, 1e-12);
}

void test_csv_non_numeric_cells_are_nan_and_headerless_names_columns() {
  const data::Table t = parse("v\nx");
  CHECK(std::isnan(t.numeric(0)[0]));
  data::CsvOptions bare;
  bare.header = false;
  const data::Table h = parse("1,2\n3,4", bare);
  CHECK_STR(h.headers()[0], "col0");
  CHECK_STR(h.headers()[1], "col1");
  CHECK_EQ(h.row_count(), 2);
}

void test_csv_out_of_range_access_is_empty_rather_than_undefined() {
  // No TypeScript counterpart: JavaScript returns undefined and coerces, and
  // this half would read past the end.
  const data::Table t = parse("a\n1");
  CHECK_STR(t.cell(99, 0), "");
  CHECK_STR(t.cell(0, 99), "");
  CHECK(data::parse_csv(nullptr, 0).headers().empty());
}

// ---- LTTB -----------------------------------------------------------------

void test_lttb_keeps_the_ends_and_hits_the_threshold() {
  const size_t n = 1000;
  std::vector<double> x(n);
  std::vector<double> y(n);
  for (size_t i = 0; i < n; ++i) {
    x[i] = static_cast<double>(i);
    y[i] = std::sin(static_cast<double>(i) / 20.0);
  }
  const data::Downsampled d = data::lttb(x.data(), y.data(), n, 100);
  CHECK_EQ(d.x.size(), 100);
  CHECK_NEAR(d.x.front(), 0.0, 1e-12);
  CHECK_NEAR(d.x.back(), static_cast<double>(n - 1), 1e-12);
}

void test_lttb_copies_through_when_the_threshold_is_large() {
  const std::vector<double> x{0, 1, 2};
  const std::vector<double> y{0, 1, 0};
  const data::Downsampled d = data::lttb(x.data(), y.data(), 3, 10);
  CHECK_EQ(d.x.size(), 3);
  CHECK_NEAR(d.y[1], 1.0, 1e-12);
  // A threshold of 2 or less has no bucket to work with, so it copies too.
  CHECK_EQ(data::lttb(x.data(), y.data(), 3, 2).x.size(), 3);
}

void test_lttb_preserves_a_sharp_peak() {
  const size_t n = 500;
  std::vector<double> x(n);
  std::vector<double> y(n, 0.0);
  for (size_t i = 0; i < n; ++i) x[i] = static_cast<double>(i);
  y[250] = 100.0;  // a lone spike, which a stride would drop entirely
  const data::Downsampled d = data::lttb(x.data(), y.data(), n, 50);
  double peak = 0.0;
  for (const double v : d.y) peak = std::max(peak, v);
  CHECK_NEAR(peak, 100.0, 1e-9);
}

}  // namespace

int main() {
  RUN(test_confusion_matrix_counts_support_and_normalizes);
  RUN(test_confusion_matrix_infers_the_class_count);
  RUN(test_roc_perfect_separation_is_auc_one);
  RUN(test_roc_matches_a_hand_computed_auc);
  RUN(test_roc_all_equal_is_chance_and_one_class_is_undefined);
  RUN(test_pr_curve_average_precision_and_baseline);
  RUN(test_calibration_curve_bins_and_ece);
  RUN(test_calibration_empty_bins_are_nan);
  RUN(test_ema_debiases_so_the_first_sample_is_exact);
  RUN(test_ema_passes_non_finite_through_without_advancing);
  RUN(test_regression_metrics_agree_with_each_other);
  RUN(test_probability_scores);
  RUN(test_classification_report_scores_every_class);
  RUN(test_lift_curve_walks_a_ranked_list);
  RUN(test_one_vs_rest_roc);
  RUN(test_pca_recovers_the_dominant_axis);
  RUN(test_pca_is_deterministic);
  RUN(test_standardize_centres_each_column);
  RUN(test_csv_parses_headers_and_numeric_columns);
  RUN(test_csv_handles_quotes_commas_and_escapes);
  RUN(test_csv_handles_crlf_and_skips_blank_lines);
  RUN(test_csv_non_numeric_cells_are_nan_and_headerless_names_columns);
  RUN(test_csv_out_of_range_access_is_empty_rather_than_undefined);
  RUN(test_lttb_keeps_the_ends_and_hits_the_threshold);
  RUN(test_lttb_copies_through_when_the_threshold_is_large);
  RUN(test_lttb_preserves_a_sharp_peak);
  return TEST_MAIN_RESULT();
}
