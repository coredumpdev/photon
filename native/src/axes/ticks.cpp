#include "axes/ticks.hpp"

#include <charconv>
#include <cmath>
#include <system_error>

namespace photon {
namespace {

/**
 * printf-style formatting that the C locale cannot reach.
 *
 * This is not a stylistic preference. `snprintf("%g")` writes whatever decimal
 * separator LC_NUMERIC names, and a Qt application calls `setlocale(LC_ALL, "")`
 * before main() gets going — so on a Turkish or German desktop the very same
 * build that prints `0.5` under GLFW prints `0,5` under Qt. The web core prints
 * `0.5` everywhere, because JavaScript's number formatting has no locale to
 * consult. `std::to_chars` is specified to behave as printf does *in the C
 * locale*, which is the only way to get that guarantee back.
 */
std::string format_c(double value, std::chars_format format, int precision) {
  char buffer[64];
  const std::to_chars_result result =
      std::to_chars(buffer, buffer + sizeof(buffer), value, format, precision);
  if (result.ec != std::errc{}) return {};
  return std::string(buffer, result.ptr);
}

/**
 * `%.1e` with the exponent normalized to JavaScript's shape.
 *
 * C prints a minimum of two exponent digits (`1.2e+06`); JS `toExponential(1)`
 * prints the minimum needed (`1.2e+6`). Axis labels are user-visible, so a web
 * chart and a native chart showing the same tick as `1.2e+6` and `1.2e+06`
 * would be a visible divergence.
 */
std::string exponential_1(double value) {
  std::string out = format_c(value, std::chars_format::scientific, 1);

  const size_t e = out.find('e');
  if (e == std::string::npos) return out;
  size_t digit = e + 1;
  if (digit < out.size() && (out[digit] == '+' || out[digit] == '-')) ++digit;
  size_t first_significant = digit;
  while (first_significant + 1 < out.size() && out[first_significant] == '0') ++first_significant;
  out.erase(digit, first_significant - digit);
  return out;
}

}  // namespace

double nice_step(double raw_step) {
  const double magnitude = std::pow(10.0, std::floor(std::log10(raw_step)));
  const double normalized = raw_step / magnitude;  // in [1, 10)
  double nice;
  if (normalized < 1.5) nice = 1.0;
  else if (normalized < 3.0) nice = 2.0;
  else if (normalized < 7.0) nice = 5.0;
  else nice = 10.0;
  return nice * magnitude;
}

std::vector<Tick> auto_ticks(double min, double max, int target) {
  std::vector<Tick> ticks;
  if (!std::isfinite(min) || !std::isfinite(max) || min == max) return ticks;

  const double span = max - min;
  const double step = nice_step(span / (target > 1 ? target : 1));
  if (!std::isfinite(step) || step <= 0.0) return ticks;
  const double start = std::ceil(min / step) * step;

  // Bounded so float drift over many steps cannot spin forever.
  for (int i = 0; i < 1000; ++i) {
    const double v = start + i * step;
    if (v > max + step * 1e-6) break;
    Tick tick;
    // Snap a value that is really zero-plus-drift back to a clean 0.
    tick.value = std::fabs(v) < step * 1e-6 ? 0.0 : v;
    ticks.push_back(tick);
  }
  return ticks;
}

std::vector<Tick> with_minor_ticks(const std::vector<Tick>& major, int count) {
  if (count <= 0 || major.size() < 2) return major;
  std::vector<Tick> out;
  out.reserve(major.size() * static_cast<size_t>(count + 1));
  for (size_t i = 0; i < major.size(); ++i) {
    out.push_back(major[i]);
    if (i + 1 >= major.size()) continue;
    const double a = major[i].value;
    const double b = major[i + 1].value;
    const double step = (b - a) / (count + 1);
    for (int k = 1; k <= count; ++k) {
      Tick minor;
      minor.value = a + step * k;
      minor.minor = true;
      minor.grid = false;
      out.push_back(minor);
    }
  }
  return out;
}

std::string default_format(double value) {
  if (value == 0.0) return "0";
  const double abs = std::fabs(value);
  if (!std::isfinite(value)) return std::isnan(value) ? "NaN" : (value > 0 ? "Infinity" : "-Infinity");
  if (abs >= 1e6 || abs < 1e-4) return exponential_1(value);

  // JS does `parseFloat(value.toPrecision(6)).toString()`: six significant
  // digits, trailing zeros trimmed. `%.6g` is the same thing — and within the
  // range left after the guard above it never flips to scientific notation,
  // because %g only does so below 1e-4 or at/above 1e6.
  return format_c(value, std::chars_format::general, 6);
}

std::string compact_format(double value) {
  if (value == 0.0) return "0";
  if (!std::isfinite(value)) return default_format(value);
  const double abs = std::fabs(value);
  if (abs >= 1e5 || abs < 1e-3) return exponential_1(value);
  return format_c(value, std::chars_format::general, 3);
}

}  // namespace photon
