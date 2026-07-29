#include "scale.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <limits>

namespace photon {
namespace {

/// Log scales require strictly positive bounds — same clamp as LogScale.sanitize.
void sanitize_log(double& lo, double& hi) {
  if (!(lo > 0.0)) lo = 1e-9;
  if (!(hi > lo)) hi = lo * 10.0;
}

constexpr double kSecond = 1000.0;
constexpr double kMinute = 60000.0;
constexpr double kHour = 3600000.0;
constexpr double kDay = 86400000.0;

/// Candidate time steps in ms, coarse→fine. Mirrors TIME_STEPS in scale.ts.
constexpr double kTimeSteps[] = {
    kSecond, 5 * kSecond, 15 * kSecond, 30 * kSecond,
    kMinute, 5 * kMinute, 15 * kMinute, 30 * kMinute,
    kHour,   3 * kHour,   6 * kHour,    12 * kHour,
    kDay,    2 * kDay,    7 * kDay,     30 * kDay,   90 * kDay, 365 * kDay,
};

const char* const kMonths[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

/**
 * Local-time calendar fields for an epoch-ms instant.
 *
 * The web core reads these off a JS `Date`, which is local-time throughout
 * (`getHours`, `getMonth`, `getDate`). Matching that matters: a session axis
 * that labelled bars in UTC would put the day boundary in the wrong place for
 * every market outside it.
 */
struct Calendar {
  int year = 1970;
  int month = 0;  // 0-11, like Date#getMonth
  int day = 1;
  int hours = 0;
  int minutes = 0;
  int weekday = 4;  // 0 = Sunday, like Date#getDay
  bool valid = false;
};

Calendar calendar(double epoch_ms) {
  Calendar out;
  if (!std::isfinite(epoch_ms)) return out;
  // Floor rather than truncate so instants before 1970 land on the right second.
  const double seconds = std::floor(epoch_ms / 1000.0);
  if (seconds < static_cast<double>(std::numeric_limits<std::time_t>::min()) ||
      seconds > static_cast<double>(std::numeric_limits<std::time_t>::max())) {
    return out;
  }
  const std::time_t t = static_cast<std::time_t>(seconds);
  std::tm tm{};
#if defined(_WIN32)
  if (localtime_s(&tm, &t) != 0) return out;
#else
  if (localtime_r(&t, &tm) == nullptr) return out;
#endif
  out.year = tm.tm_year + 1900;
  out.month = tm.tm_mon;
  out.day = tm.tm_mday;
  out.hours = tm.tm_hour;
  out.minutes = tm.tm_min;
  out.weekday = tm.tm_wday;
  out.valid = true;
  return out;
}

/// Epoch-ms of local midnight on the given calendar day.
double local_midnight_ms(const Calendar& c) {
  std::tm tm{};
  tm.tm_year = c.year - 1900;
  tm.tm_mon = c.month;
  tm.tm_mday = c.day;
  tm.tm_isdst = -1;  // let the C library decide, as `new Date(y,m,d)` does
  const std::time_t t = std::mktime(&tm);
  return t == static_cast<std::time_t>(-1) ? 0.0 : static_cast<double>(t) * 1000.0;
}

std::string pad2(int n) {
  char buffer[8];
  std::snprintf(buffer, sizeof(buffer), "%02d", n);
  return std::string(buffer);
}

std::string hhmm(const Calendar& c) {
  return pad2(c.hours) + ":" + pad2(c.minutes);
}

std::string day_month(const Calendar& c) {
  return std::to_string(c.day) + " " + kMonths[c.month];
}

std::string month_label(const Calendar& c) {
  return c.month == 0 ? std::to_string(c.year) : std::string(kMonths[c.month]);
}

/// The calendar levels an ordinal-time axis chooses between, coarse→fine.
/// Each `key` labels a bar's period; ticks land on the first bar of each period,
/// so gridlines snap to real calendar dates and stay put while panning.
struct Level {
  long long (*key)(const Calendar&);
  std::string (*label)(const Calendar&);
};

long long key_year(const Calendar& c) { return c.year; }
long long key_quarter(const Calendar& c) { return c.year * 4LL + c.month / 3; }
long long key_month(const Calendar& c) { return c.year * 12LL + c.month; }
long long key_week(const Calendar& c) {
  const int dow = (c.weekday + 6) % 7;  // Monday = 0
  const double midnight = local_midnight_ms(c);
  return static_cast<long long>(std::floor((midnight - dow * kDay) / kDay));
}
long long key_day(const Calendar& c) { return c.year * 10000LL + c.month * 100LL + c.day; }
long long key_six_hours(const Calendar& c) { return key_day(c) * 4 + c.hours / 6; }
long long key_hour(const Calendar& c) { return key_day(c) * 24 + c.hours; }
long long key_quarter_hour(const Calendar& c) {
  return (key_day(c) * 24 + c.hours) * 4 + c.minutes / 15;
}
long long key_minute(const Calendar& c) { return (key_day(c) * 24 + c.hours) * 60 + c.minutes; }

std::string label_year(const Calendar& c) { return std::to_string(c.year); }

const Level kLevels[] = {
    {key_year, label_year},        {key_quarter, month_label},
    {key_month, month_label},      {key_week, day_month},
    {key_day, day_month},          {key_six_hours, hhmm},
    {key_hour, hhmm},              {key_quarter_hour, hhmm},
    {key_minute, hhmm},
};

}  // namespace

double Scale::norm(double value) const {
  if (is_log()) {
    if (value <= 0.0) return 0.0;
    const double la = std::log10(lo);
    const double lb = std::log10(hi);
    if (lb == la) return 0.0;
    return (std::log10(value) - la) / (lb - la);
  }
  if (hi == lo) return 0.0;
  return (value - lo) / (hi - lo);
}

double Scale::invert(double t) const {
  if (is_log()) {
    const double la = std::log10(lo);
    const double lb = std::log10(hi);
    return std::pow(10.0, la + t * (lb - la));
  }
  return lo + t * (hi - lo);
}

bool Scale::set_domain(double new_lo, double new_hi) {
  // A view has to stay representable, and past a certain zoom-out it stops
  // being so: each wheel notch multiplies the span, and after enough of them
  // `hi - lo` overflows to infinity. From that moment norm() divides by
  // infinity, every point in the series projects to the same place, and
  // invert() can no longer produce a finite domain — so zooming back in does
  // not recover. The chart goes blank and stays blank.
  //
  // Refusing the update turns that cliff into a wall: the furthest zoom-out is
  // simply as far as it goes. The endpoints and the span are all checked,
  // because two finite endpoints can still have an infinite difference.
  if (!std::isfinite(new_lo) || !std::isfinite(new_hi) || !std::isfinite(new_hi - new_lo)) {
    return false;
  }
  lo = new_lo;
  hi = new_hi;
  if (is_log()) sanitize_log(lo, hi);
  return true;
}

void Scale::set_band_domain(size_t n) {
  lo = -0.5;
  hi = n > 0 ? static_cast<double>(n) - 0.5 : 0.5;
}

bool Scale::configure(const ph_axis_desc& desc) {
  type = desc.type;

  factors.clear();
  if (type == PH_SCALE_CATEGORICAL && desc.factors && desc.factor_count > 0) {
    factors.reserve(static_cast<size_t>(desc.factor_count));
    for (int32_t i = 0; i < desc.factor_count; ++i) {
      if (!desc.factors[i]) return false;
      factors.emplace_back(desc.factors[i]);
    }
  }

  times.clear();
  if (type == PH_SCALE_ORDINAL_TIME && desc.times && desc.time_count > 0) {
    times.assign(desc.times, desc.times + desc.time_count);
  }

  // The two index-based scales derive their domain from the data they were
  // given; everything else takes the descriptor's domain, or a type-appropriate
  // default when the caller left it empty to mean "autoscale".
  if (type == PH_SCALE_CATEGORICAL) {
    set_band_domain(factors.size());
  } else if (type == PH_SCALE_ORDINAL_TIME) {
    set_band_domain(times.size());
  } else if (desc.domain.lo != desc.domain.hi) {
    set_domain(desc.domain.lo, desc.domain.hi);
  } else if (type == PH_SCALE_LOG) {
    set_domain(1.0, 1000.0);
  } else if (type == PH_SCALE_TIME) {
    set_domain(0.0, 86400000.0);
  } else {
    set_domain(0.0, 1.0);
  }
  return true;
}

// -- ticks ------------------------------------------------------------------

namespace {

/// LogScale.ticks: a decade major plus 2..9 minors, across the visible decades.
std::vector<Tick> log_ticks(double lo, double hi) {
  std::vector<Tick> out;
  const int first = static_cast<int>(std::floor(std::log10(lo)));
  const int last = static_cast<int>(std::ceil(std::log10(hi)));
  // A domain spanning hundreds of decades would emit tens of thousands of ticks.
  if (last - first > 320) return out;
  for (int e = first; e <= last; ++e) {
    const double base = std::pow(10.0, e);
    Tick major;
    major.value = base;
    out.push_back(major);
    for (int m = 2; m <= 9; ++m) {
      Tick minor;
      minor.value = m * base;
      minor.minor = true;
      minor.grid = false;
      out.push_back(minor);
    }
  }
  return out;
}

/// TimeScale.chooseStep: coarsest candidate step that is still fine enough.
double choose_time_step(double span, int target) {
  const double ideal = span / (target > 0 ? target : 1);
  for (const double step : kTimeSteps) {
    if (step >= ideal) return step;
  }
  return kTimeSteps[std::size(kTimeSteps) - 1];
}

std::vector<Tick> time_ticks(double lo, double hi, int target) {
  std::vector<Tick> out;
  if (!std::isfinite(lo) || !std::isfinite(hi) || lo == hi) return out;
  const double step = choose_time_step(hi - lo, target);
  const double start = std::ceil(lo / step) * step;
  for (int i = 0; i < 1000; ++i) {
    const double v = start + i * step;
    if (v > hi) break;
    Tick tick;
    tick.value = v;
    out.push_back(tick);
  }
  return out;
}

}  // namespace

std::vector<Tick> Scale::ticks(int target) const {
  switch (type) {
    case PH_SCALE_LOG:
      return log_ticks(lo, hi);

    case PH_SCALE_TIME:
      return time_ticks(lo, hi, target);

    case PH_SCALE_CATEGORICAL: {
      std::vector<Tick> out;
      out.reserve(factors.size());
      for (size_t i = 0; i < factors.size(); ++i) {
        Tick tick;
        tick.value = static_cast<double>(i);
        tick.label = factors[i];
        tick.grid = false;
        out.push_back(tick);
      }
      return out;
    }

    case PH_SCALE_ORDINAL_TIME:
      return ordinal_time_ticks(target);

    case PH_SCALE_LINEAR:
    default:
      return auto_ticks(lo, hi, target);
  }
}

std::vector<Tick> Scale::ordinal_time_ticks(int target) const {
  std::vector<Tick> out;
  const long long n = static_cast<long long>(times.size());
  if (n == 0) return out;

  long long i0 = static_cast<long long>(std::ceil(lo - 1e-9));
  long long i1 = static_cast<long long>(std::floor(hi + 1e-9));
  i0 = std::max<long long>(0, i0);
  i1 = std::min<long long>(n - 1, i1);
  if (i1 < i0) return out;

  // Precompute the calendar fields once; every level below reads them.
  std::vector<Calendar> cal(static_cast<size_t>(i1 - i0 + 1));
  for (long long i = i0; i <= i1; ++i) {
    cal[static_cast<size_t>(i - i0)] = calendar(times[static_cast<size_t>(i)]);
  }
  const Calendar before = i0 > 0 ? calendar(times[static_cast<size_t>(i0 - 1)]) : Calendar{};

  const auto period_starts = [&](const Level& level) {
    std::vector<long long> starts;
    // Seed with the bar *before* the window so a period already in progress at
    // the left edge does not get a spurious tick.
    bool have_prev = i0 > 0;
    long long prev = have_prev ? level.key(before) : 0;
    for (long long i = i0; i <= i1; ++i) {
      const long long k = level.key(cal[static_cast<size_t>(i - i0)]);
      if (!have_prev || k != prev) {
        starts.push_back(i);
        prev = k;
        have_prev = true;
      }
    }
    return starts;
  };

  // Pick the level whose tick count sits closest to `target`, penalizing
  // over-dense and near-empty results.
  const Level* chosen = nullptr;
  std::vector<long long> chosen_starts;
  double best = std::numeric_limits<double>::infinity();
  for (const Level& level : kLevels) {
    const std::vector<long long> starts = period_starts(level);
    if (starts.empty()) continue;
    const double count = static_cast<double>(starts.size());
    const double over = count > target * 1.5 ? (count - target * 1.5) * 3.0 : 0.0;
    const double sparse = count < 2 ? 100.0 : 0.0;
    const double score = std::fabs(count - target) + over + sparse;
    if (score < best) {
      best = score;
      chosen = &level;
      chosen_starts = starts;
    }
  }

  if (!chosen) {
    // No calendar boundary anywhere in view (a handful of same-minute bars):
    // fall back to even spacing with a full date-and-time label.
    const long long step = std::max<long long>(1, (i1 - i0) / std::max(1, target - 1));
    for (long long i = i0; i <= i1; i += step) {
      const Calendar& c = cal[static_cast<size_t>(i - i0)];
      Tick tick;
      tick.value = static_cast<double>(i);
      tick.label = day_month(c) + " " + hhmm(c);
      out.push_back(tick);
    }
    return out;
  }

  out.reserve(chosen_starts.size());
  for (const long long i : chosen_starts) {
    Tick tick;
    tick.value = static_cast<double>(i);
    tick.label = chosen->label(cal[static_cast<size_t>(i - i0)]);
    out.push_back(tick);
  }
  return out;
}

std::string Scale::format_tick(double value) const {
  switch (type) {
    case PH_SCALE_LOG: {
      if (!(value > 0.0)) return default_format(value);
      const int e = static_cast<int>(std::lround(std::log10(value)));
      if (e <= -4 || e >= 5) return "1e" + std::to_string(e);
      return default_format(value);
    }

    case PH_SCALE_TIME: {
      const double span = hi - lo;
      const Calendar c = calendar(value);
      if (!c.valid) return default_format(value);
      if (span < kDay) return hhmm(c);
      if (span < 90 * kDay) return std::to_string(c.month + 1) + "/" + std::to_string(c.day);
      return std::to_string(c.year);
    }

    case PH_SCALE_CATEGORICAL: {
      const long long i = std::lround(value);
      if (i < 0 || i >= static_cast<long long>(factors.size())) return std::string();
      return factors[static_cast<size_t>(i)];
    }

    case PH_SCALE_ORDINAL_TIME: {
      if (times.empty()) return std::string();
      long long i = std::lround(value);
      i = std::max<long long>(0, std::min<long long>(static_cast<long long>(times.size()) - 1, i));
      const Calendar c = calendar(times[static_cast<size_t>(i)]);
      if (!c.valid) return std::string();
      return day_month(c) + " " + hhmm(c);
    }

    case PH_SCALE_LINEAR:
    default:
      return default_format(value);
  }
}

}  // namespace photon
