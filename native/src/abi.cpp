// The C ABI entry points.
//
// Everything here is a thin shim: validate, translate, delegate. No logic lives
// in this file, because every line in it is duplicated by hand in four binding
// languages and the cheapest shim is the one that cannot disagree with them.
//
// Two invariants hold for every entry point:
//   1. It is `noexcept` in effect — a C++ exception must never unwind into a C
//      caller, so anything that can throw is wrapped and turned into a result
//      code.
//   2. It clears the thread's error string on entry, so ph_last_error() always
//      describes the most recent failure and never a stale one.

#include <photon/photon.h>

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <thread>
#include <vector>

#include "charts/diagrams.hpp"
#include "color/colormap.hpp"
#include "data/csv.hpp"
#include "data/downsample.hpp"
#include "error.hpp"
#include "finance/indicators.hpp"
#include "finance/transforms.hpp"
#include "layer.hpp"
#include "ml/metrics.hpp"
#include "ml/reduce.hpp"
#include "plot.hpp"
#include "plot3d/layers3d.hpp"
#include "registry.hpp"
#include "stats/regression.hpp"
#include "stats/signal.hpp"
#include "stats/stats.hpp"
#include "text/text.hpp"

using photon::clear_error;
using photon::fail;
using photon::LayerRef;
using photon::Plot;
using photon::Registry;

namespace {

/// Guard every entry point that touches the registry.
ph_result require_init() {
  if (!Registry::get().initialized) {
    return fail(PH_E_NOT_INITIALIZED, "ph_init has not been called");
  }
  return PH_OK;
}

/// Resolve a plot handle, or report exactly why it could not be resolved.
ph_result resolve_plot(ph_plot handle, Plot** out) {
  const ph_result init = require_init();
  if (init != PH_OK) return init;
  Plot* plot = Registry::get().plots.get(handle);
  if (!plot) return fail(PH_E_INVALID_HANDLE, "plot handle is stale or invalid");
  *out = plot;
  return PH_OK;
}

/**
 * Resolve the GL entry points on first use.
 *
 * Deferred rather than done in ph_init because the two are not on the same
 * thread in every host: Qt initializes on the GUI thread and only has a context
 * on the render thread. The first render is the first moment a context is
 * guaranteed, so that is where loading happens.
 */
ph_result ensure_gl_loaded() {
  Registry& registry = Registry::get();
  if (registry.gl.ready) return PH_OK;
  if (registry.gl_attempted) return fail(PH_E_GL, registry.gl_error);

  registry.gl_attempted = true;
  if (!registry.host.get_proc_address) {
    registry.gl_error =
        "cannot render: ph_init was given no get_proc_address, so GL entry points cannot be "
        "resolved (GLFW: glfwGetProcAddress, Qt: QOpenGLContext::getProcAddress)";
    return fail(PH_E_GL, registry.gl_error);
  }
  if (!photon::gl::load(registry.gl, registry.host.get_proc_address,
                        registry.host.get_proc_address_user, registry.gl_error)) {
    return fail(PH_E_GL, registry.gl_error);
  }
  return PH_OK;
}

/// A descriptor is rejected when it claims a size this build cannot interpret.
/// A *smaller* size is fine — it means an older binding that predates a field,
/// and the missing tail stays at its default.
template <typename T>
bool desc_size_ok(const T* desc) {
  return desc->struct_size == 0 || desc->struct_size <= sizeof(T);
}

/// Copy a caller's descriptor into a fully-defaulted one, so a short struct from
/// an older binding leaves the newer fields at their defaults.
template <typename T, typename InitFn>
T normalize(const T* desc, InitFn init) {
  T out{};
  init(&out);
  if (desc) {
    const size_t n = desc->struct_size == 0 ? sizeof(T)
                                            : (desc->struct_size < sizeof(T) ? desc->struct_size : sizeof(T));
    std::memcpy(&out, desc, n);
    out.struct_size = static_cast<uint32_t>(sizeof(T));
  }
  return out;
}

}  // namespace

// ---------------------------------------------------------------------------
// Library lifecycle
// ---------------------------------------------------------------------------

extern "C" uint32_t PH_CALL ph_abi_version(void) {
  return PHOTON_ABI_VERSION;
}

extern "C" void PH_CALL ph_version(int32_t* major, int32_t* minor, int32_t* patch) {
  // Tracks the npm package version this port was cut from.
  if (major) *major = 0;
  if (minor) *minor = 7;
  if (patch) *patch = 2;
}

extern "C" ph_result PH_CALL ph_init(uint32_t abi_version, const ph_host_desc* desc) {
  clear_error();
  if (abi_version != PHOTON_ABI_VERSION) {
    return fail(PH_E_ABI_MISMATCH,
                "caller was built against ABI " + std::to_string(abi_version) +
                    ", this library is ABI " + std::to_string(PHOTON_ABI_VERSION));
  }
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_host_desc.struct_size is larger than this build's");
  }
  Registry& registry = Registry::get();
  if (registry.initialized) return PH_OK;  // idempotent
  registry.host = normalize(desc, ph_host_desc_init);
  registry.initialized = true;
  return PH_OK;
}

extern "C" void PH_CALL ph_shutdown(void) {
  clear_error();
  Registry& registry = Registry::get();
  // GPU objects can only be freed while the context that owns them is current.
  // When it is not, they die with the context anyway — so this is best-effort,
  // not a leak we can do anything about from here.
  if (registry.gl.ready) {
    for (const uint64_t handle : registry.plots.handles()) {
      if (Plot* plot = registry.plots.get(handle)) plot->release_gl(registry.gl);
    }
    for (const uint64_t handle : registry.plots3d.handles()) {
      if (photon::plot3d::Plot3D* plot = registry.plots3d.get(handle)) {
        plot->release_gl(registry.gl);
      }
    }
    photon::text::release_atlas_gl(registry.gl);
    photon::gl::clear_program_cache(registry.gl);
  }
  // Layers first: their refs point at plots that are about to go away.
  registry.layers.clear();
  registry.plots.clear();
  registry.plots3d.clear();
  // Tables hold no GPU objects and belong to no plot, so their order is free.
  registry.tables.clear();
  registry.host = ph_host_desc{};
  registry.gl = photon::gl::Api{};
  registry.gl_error.clear();
  registry.gl_attempted = false;
  registry.initialized = false;
}

extern "C" const char* PH_CALL ph_last_error(void) {
  return photon::last_error();
}

extern "C" ph_result PH_CALL ph_color_parse(const char* css, ph_color* out) {
  clear_error();
  if (!css || !out) return fail(PH_E_INVALID_ARGUMENT, "css and out must be non-null");

  const char* s = css;
  while (*s == ' ' || *s == '\t') ++s;

  // rgb() and rgba(), which is the other half of what the web core's parseColor
  // reads. Nothing else: a named colour or an hsl() would render as opaque
  // black on the web, and accepting one here would mean the two cores draw
  // different charts from the same string. Refusing is the honest difference.
  if ((s[0] == 'r' || s[0] == 'R') && (s[1] == 'g' || s[1] == 'G') && (s[2] == 'b' || s[2] == 'B')) {
    const char* open = std::strchr(s, '(');
    if (!open) return fail(PH_E_INVALID_ARGUMENT, std::string("bad rgb colour: ") + css);
    double parts[4] = {0.0, 0.0, 0.0, 1.0};
    int found = 0;
    const char* cursor = open + 1;
    while (found < 4) {
      while (*cursor == ' ' || *cursor == ',' || *cursor == '\t' || *cursor == '/') ++cursor;
      if (*cursor == ')' || *cursor == '\0') break;
      char* end = nullptr;
      const double v = std::strtod(cursor, &end);
      if (end == cursor) return fail(PH_E_INVALID_ARGUMENT, std::string("bad rgb colour: ") + css);
      cursor = end;
      // A percentage is of the channel's full range, which for alpha is 1.
      if (*cursor == '%') {
        parts[found] = found == 3 ? v / 100.0 : v * 255.0 / 100.0;
        ++cursor;
      } else {
        parts[found] = v;
      }
      ++found;
    }
    if (found < 3) return fail(PH_E_INVALID_ARGUMENT, std::string("bad rgb colour: ") + css);
    const auto byte = [](double v) {
      return static_cast<uint32_t>(std::min(255.0, std::max(0.0, v)) + 0.5);
    };
    *out = (byte(parts[0]) << 24) | (byte(parts[1]) << 16) | (byte(parts[2]) << 8) |
           byte(parts[3] * 255.0);
    return PH_OK;
  }

  if (*s != '#') {
    return fail(PH_E_UNSUPPORTED,
                "only #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba() are parsed");
  }
  ++s;

  const auto hex = [](char c, int& value) -> bool {
    if (c >= '0' && c <= '9') { value = c - '0'; return true; }
    if (c >= 'a' && c <= 'f') { value = c - 'a' + 10; return true; }
    if (c >= 'A' && c <= 'F') { value = c - 'A' + 10; return true; }
    return false;
  };

  int digits[8] = {0};
  size_t n = 0;
  for (; n < 8 && s[n]; ++n) {
    if (!hex(s[n], digits[n])) return fail(PH_E_INVALID_ARGUMENT, std::string("bad hex color: ") + css);
  }
  if (s[n] != '\0' || (n != 3 && n != 4 && n != 6 && n != 8)) {
    return fail(PH_E_INVALID_ARGUMENT, std::string("bad hex color: ") + css);
  }

  uint32_t r, g, b, a;
  if (n <= 4) {  // shorthand: each digit doubles, #abc -> #aabbcc
    r = static_cast<uint32_t>(digits[0] * 17);
    g = static_cast<uint32_t>(digits[1] * 17);
    b = static_cast<uint32_t>(digits[2] * 17);
    a = n == 4 ? static_cast<uint32_t>(digits[3] * 17) : 255u;
  } else {
    r = static_cast<uint32_t>(digits[0] * 16 + digits[1]);
    g = static_cast<uint32_t>(digits[2] * 16 + digits[3]);
    b = static_cast<uint32_t>(digits[4] * 16 + digits[5]);
    a = n == 8 ? static_cast<uint32_t>(digits[6] * 16 + digits[7]) : 255u;
  }
  *out = (r << 24) | (g << 16) | (b << 8) | a;
  return PH_OK;
}

// ---------------------------------------------------------------------------
// Colormaps and palettes
// ---------------------------------------------------------------------------

namespace {

/// Turn a descriptor into the internal spec. A NULL name is not an error — it
/// means viridis, the same as an unknown one.
photon::color::Spec to_spec(const ph_colormap_spec& desc) {
  photon::color::Spec spec;
  if (desc.name) spec.name = desc.name;
  if (desc.stops && desc.stop_count > 0) {
    spec.stops.reserve(static_cast<size_t>(desc.stop_count));
    for (int32_t i = 0; i < desc.stop_count; ++i) {
      spec.stops.push_back(photon::color::to_rgb(desc.stops[i]));
    }
  }
  spec.reverse = desc.reverse != 0;
  spec.discrete_steps = desc.discrete_steps;
  return spec;
}

/// The name lists, kept alive for the process because the ABI hands out char*.
/// Rebuilt on each count/name call, which is cheap and happens off the frame
/// path — but the strings themselves come from registries that never erase.
const std::vector<std::string>& colormap_name_list() {
  static std::vector<std::string> names;
  names = photon::color::colormap_names();
  return names;
}

const std::vector<std::string>& palette_name_list() {
  static std::vector<std::string> names;
  names = photon::color::palette_names();
  return names;
}

}  // namespace

extern "C" void PH_CALL ph_colormap_spec_init(ph_colormap_spec* out) {
  if (!out) return;
  *out = ph_colormap_spec{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_colormap_spec));
  // name stays NULL, which resolves to viridis — the core's default too.
}

extern "C" ph_result PH_CALL ph_colormap_register(const char* name, const ph_color* stops,
                                                  int32_t stop_count) {
  clear_error();
  if (!name || !stops) return fail(PH_E_INVALID_ARGUMENT, "name and stops must be non-null");
  if (stop_count < 2) return fail(PH_E_INVALID_ARGUMENT, "a colormap needs at least 2 stops");
  std::vector<photon::color::Rgb> anchors;
  anchors.reserve(static_cast<size_t>(stop_count));
  for (int32_t i = 0; i < stop_count; ++i) anchors.push_back(photon::color::to_rgb(stops[i]));
  if (!photon::color::register_colormap(name, anchors)) {
    return fail(PH_E_INVALID_ARGUMENT, "colormap name must be non-empty");
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_colormap_sample(const ph_colormap_spec* spec, double t,
                                                ph_color* out) {
  clear_error();
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (spec && !desc_size_ok(spec)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_colormap_spec.struct_size is larger than this build's");
  }
  const ph_colormap_spec normalized = normalize(spec, ph_colormap_spec_init);
  const photon::color::Rgb c = photon::color::sample(to_spec(normalized), t);
  const auto byte = [](float v) {
    const float clamped = v <= 0.0f ? 0.0f : (v >= 1.0f ? 1.0f : v);
    return static_cast<uint32_t>(clamped * 255.0f + 0.5f);
  };
  *out = (byte(c.r) << 24) | (byte(c.g) << 16) | (byte(c.b) << 8) | 0xFFu;
  return PH_OK;
}

extern "C" int32_t PH_CALL ph_colormap_count(void) {
  return static_cast<int32_t>(colormap_name_list().size());
}

extern "C" const char* PH_CALL ph_colormap_name(int32_t index) {
  const std::vector<std::string>& names = colormap_name_list();
  if (index < 0 || static_cast<size_t>(index) >= names.size()) return nullptr;
  return names[static_cast<size_t>(index)].c_str();
}

extern "C" ph_result PH_CALL ph_symmetric_domain(const double* values, int32_t count,
                                                 double center, ph_range* out) {
  clear_error();
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (count > 0 && !values) {
    return fail(PH_E_INVALID_ARGUMENT, "values must be non-null when count > 0");
  }
  *out = photon::color::symmetric_domain(values, static_cast<size_t>(count), center);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_palette_register(const char* name, const ph_color* colors,
                                                 int32_t count) {
  clear_error();
  if (!name || !colors) return fail(PH_E_INVALID_ARGUMENT, "name and colors must be non-null");
  if (count < 1) return fail(PH_E_INVALID_ARGUMENT, "a palette needs at least one colour");
  const std::vector<ph_color> list(colors, colors + count);
  if (!photon::color::register_palette(name, list)) {
    return fail(PH_E_INVALID_ARGUMENT, "palette name must be non-empty");
  }
  return PH_OK;
}

extern "C" int32_t PH_CALL ph_palette_count(void) {
  return static_cast<int32_t>(palette_name_list().size());
}

extern "C" const char* PH_CALL ph_palette_name(int32_t index) {
  const std::vector<std::string>& names = palette_name_list();
  if (index < 0 || static_cast<size_t>(index) >= names.size()) return nullptr;
  return names[static_cast<size_t>(index)].c_str();
}

extern "C" ph_color PH_CALL ph_palette_color(const char* name, int32_t index) {
  return photon::color::palette_color(name ? name : "tableau10", index);
}

// ---------------------------------------------------------------------------
// Analysis — pure functions over arrays
// ---------------------------------------------------------------------------

namespace {

/// Validate one (pointer, count) input pair. Every analysis call starts here.
ph_result check_series(const double* values, int32_t count, const char* what) {
  if (count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (count > 0 && !values) {
    return fail(PH_E_INVALID_ARGUMENT, std::string(what) + " must be non-null when count > 0");
  }
  return PH_OK;
}

/// The same for the OHLC quartet, which half the indicators take.
ph_result check_hlc(const double* high, const double* low, const double* close, int32_t count) {
  ph_result r = check_series(high, count, "high");
  if (r != PH_OK) return r;
  r = check_series(low, count, "low");
  if (r != PH_OK) return r;
  return check_series(close, count, "close");
}

/// Hand one computed series back, if the caller asked for it. A NULL output is
/// "I do not want this one", which is why every multi-output call takes several.
void emit(const std::vector<double>& src, double* out) {
  if (out && !src.empty()) std::memcpy(out, src.data(), src.size() * sizeof(double));
}

/**
 * Hand back a counted result: write what fits, report what there was.
 *
 * `out_count` is deliberately the number produced rather than the number
 * written. A caller that passed a short buffer gets a truncated array and a
 * count that says so; a caller that passed capacity 0 gets the size to
 * allocate. Reporting the written count instead would make those two
 * indistinguishable from success.
 */
template <typename Out, typename In, typename Convert>
ph_result emit_counted(const std::vector<In>& src, Out* out, int32_t capacity, int32_t* out_count,
                       Convert convert) {
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  if (capacity > 0 && !out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null when capacity > 0");
  *out_count = static_cast<int32_t>(src.size());
  const size_t writable = std::min(src.size(), static_cast<size_t>(capacity));
  for (size_t i = 0; i < writable; ++i) out[i] = convert(src[i]);
  return PH_OK;
}

}  // namespace

extern "C" ph_result PH_CALL ph_fin_sma(const double* values, int32_t count, int32_t period,
                                        double* out) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::sma(values, static_cast<size_t>(count), period), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_wma(const double* values, int32_t count, int32_t period,
                                        double* out) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::wma(values, static_cast<size_t>(count), period), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_ema(const double* values, int32_t count, int32_t period,
                                        double* out) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::ema(values, static_cast<size_t>(count), period), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_rolling_std(const double* values, int32_t count, int32_t period,
                                                double* out) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::rolling_std(values, static_cast<size_t>(count), period), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_bollinger(const double* close, int32_t count, int32_t period,
                                              double k, double* out_middle, double* out_upper,
                                              double* out_lower) {
  clear_error();
  const ph_result r = check_series(close, count, "close");
  if (r != PH_OK) return r;
  const photon::finance::Band band =
      photon::finance::bollinger(close, static_cast<size_t>(count), period, k);
  emit(band.middle, out_middle);
  emit(band.upper, out_upper);
  emit(band.lower, out_lower);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_rsi(const double* close, int32_t count, int32_t period,
                                        double* out) {
  clear_error();
  const ph_result r = check_series(close, count, "close");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::rsi(close, static_cast<size_t>(count), period), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_macd(const double* close, int32_t count, int32_t fast,
                                         int32_t slow, int32_t signal_period, double* out_macd,
                                         double* out_signal, double* out_histogram) {
  clear_error();
  const ph_result r = check_series(close, count, "close");
  if (r != PH_OK) return r;
  const photon::finance::Macd m =
      photon::finance::macd(close, static_cast<size_t>(count), fast, slow, signal_period);
  emit(m.macd, out_macd);
  emit(m.signal, out_signal);
  emit(m.histogram, out_histogram);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_vwap(const double* high, const double* low, const double* close,
                                         const double* volume, int32_t count, double* out) {
  clear_error();
  ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  r = check_series(volume, count, "volume");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::vwap(high, low, close, volume, static_cast<size_t>(count)), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_true_range(const double* high, const double* low,
                                               const double* close, int32_t count, double* out) {
  clear_error();
  const ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::true_range(high, low, close, static_cast<size_t>(count)), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_atr(const double* high, const double* low, const double* close,
                                        int32_t count, int32_t period, double* out) {
  clear_error();
  const ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::atr(high, low, close, static_cast<size_t>(count), period), out);
  return PH_OK;
}

extern "C" int32_t PH_CALL ph_fin_first_finite(const double* values, int32_t count) {
  if (count <= 0) return -1;
  return photon::finance::first_finite(values, static_cast<size_t>(count));
}

extern "C" ph_result PH_CALL ph_fin_stochastic(const double* high, const double* low,
                                               const double* close, int32_t count,
                                               int32_t k_period, int32_t d_period, double* out_k,
                                               double* out_d) {
  clear_error();
  const ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  const photon::finance::Stochastic s =
      photon::finance::stochastic(high, low, close, static_cast<size_t>(count), k_period, d_period);
  emit(s.k, out_k);
  emit(s.d, out_d);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_keltner(const double* high, const double* low,
                                            const double* close, int32_t count, int32_t period,
                                            double mult, int32_t atr_period, double* out_middle,
                                            double* out_upper, double* out_lower) {
  clear_error();
  const ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  const photon::finance::Band band = photon::finance::keltner(
      high, low, close, static_cast<size_t>(count), period, mult, atr_period);
  emit(band.middle, out_middle);
  emit(band.upper, out_upper);
  emit(band.lower, out_lower);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_obv(const double* close, const double* volume, int32_t count,
                                        double* out) {
  clear_error();
  ph_result r = check_series(close, count, "close");
  if (r != PH_OK) return r;
  r = check_series(volume, count, "volume");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::obv(close, volume, static_cast<size_t>(count)), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_ichimoku(const double* high, const double* low, int32_t count,
                                             int32_t conv_period, int32_t base_period,
                                             int32_t span_b_period, double* out_conversion,
                                             double* out_base, double* out_span_a,
                                             double* out_span_b) {
  clear_error();
  ph_result r = check_series(high, count, "high");
  if (r != PH_OK) return r;
  r = check_series(low, count, "low");
  if (r != PH_OK) return r;
  const photon::finance::Ichimoku ich = photon::finance::ichimoku(
      high, low, static_cast<size_t>(count), conv_period, base_period, span_b_period);
  emit(ich.conversion, out_conversion);
  emit(ich.base, out_base);
  emit(ich.span_a, out_span_a);
  emit(ich.span_b, out_span_b);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_adx(const double* high, const double* low, const double* close,
                                        int32_t count, int32_t period, double* out_adx,
                                        double* out_plus_di, double* out_minus_di) {
  clear_error();
  const ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  const photon::finance::Adx a =
      photon::finance::adx(high, low, close, static_cast<size_t>(count), period);
  emit(a.adx, out_adx);
  emit(a.plus_di, out_plus_di);
  emit(a.minus_di, out_minus_di);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_supertrend(const double* high, const double* low,
                                               const double* close, int32_t count, int32_t period,
                                               double mult, double* out_trend,
                                               double* out_direction) {
  clear_error();
  const ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  const photon::finance::SuperTrend st =
      photon::finance::super_trend(high, low, close, static_cast<size_t>(count), period, mult);
  emit(st.trend, out_trend);
  emit(st.direction, out_direction);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_cci(const double* high, const double* low, const double* close,
                                        int32_t count, int32_t period, double* out) {
  clear_error();
  const ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::cci(high, low, close, static_cast<size_t>(count), period), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_mfi(const double* high, const double* low, const double* close,
                                        const double* volume, int32_t count, int32_t period,
                                        double* out) {
  clear_error();
  ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  r = check_series(volume, count, "volume");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::mfi(high, low, close, volume, static_cast<size_t>(count), period), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_williams_r(const double* high, const double* low,
                                               const double* close, int32_t count, int32_t period,
                                               double* out) {
  clear_error();
  const ph_result r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::williams_r(high, low, close, static_cast<size_t>(count), period), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_aroon(const double* high, const double* low, int32_t count,
                                          int32_t period, double* out_up, double* out_down,
                                          double* out_oscillator) {
  clear_error();
  ph_result r = check_series(high, count, "high");
  if (r != PH_OK) return r;
  r = check_series(low, count, "low");
  if (r != PH_OK) return r;
  const photon::finance::Aroon a =
      photon::finance::aroon(high, low, static_cast<size_t>(count), period);
  emit(a.up, out_up);
  emit(a.down, out_down);
  emit(a.oscillator, out_oscillator);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_donchian(const double* high, const double* low, int32_t count,
                                             int32_t period, double* out_middle, double* out_upper,
                                             double* out_lower) {
  clear_error();
  ph_result r = check_series(high, count, "high");
  if (r != PH_OK) return r;
  r = check_series(low, count, "low");
  if (r != PH_OK) return r;
  const photon::finance::Band band =
      photon::finance::donchian(high, low, static_cast<size_t>(count), period);
  emit(band.middle, out_middle);
  emit(band.upper, out_upper);
  emit(band.lower, out_lower);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_parabolic_sar(const double* high, const double* low,
                                                  int32_t count, double step, double max_step,
                                                  double* out) {
  clear_error();
  ph_result r = check_series(high, count, "high");
  if (r != PH_OK) return r;
  r = check_series(low, count, "low");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::finance::parabolic_sar(high, low, static_cast<size_t>(count), step, max_step), out);
  return PH_OK;
}

namespace {
constexpr double kFibRatios[7] = {0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0};
}  // namespace

extern "C" const double* PH_CALL ph_fin_fib_ratios(int32_t* out_count) {
  if (out_count) *out_count = 7;
  return kFibRatios;
}

extern "C" ph_result PH_CALL ph_fin_fib_retracements(double high, double low, const double* ratios,
                                                     int32_t count, double* out_price) {
  clear_error();
  if (!out_price) return fail(PH_E_INVALID_ARGUMENT, "out_price must be non-null");
  if (count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (!ratios && count < 7) {
    return fail(PH_E_INVALID_ARGUMENT, "the standard ratios need room for seven prices");
  }
  const double* source = ratios ? ratios : kFibRatios;
  const int32_t n = ratios ? count : 7;
  const double span = high - low;
  for (int32_t i = 0; i < n; ++i) out_price[i] = high - span * source[i];
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_pivot_points(double high, double low, double close,
                                                 ph_pivot_levels* out) {
  clear_error();
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  const photon::finance::PivotLevels p = photon::finance::pivot_points(high, low, close);
  out->pivot = p.pivot;
  out->r1 = p.r1;
  out->r2 = p.r2;
  out->r3 = p.r3;
  out->s1 = p.s1;
  out->s2 = p.s2;
  out->s3 = p.s3;
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_heikin_ashi(const double* open, const double* high,
                                                const double* low, const double* close,
                                                int32_t count, double* out_open, double* out_high,
                                                double* out_low, double* out_close) {
  clear_error();
  ph_result r = check_series(open, count, "open");
  if (r != PH_OK) return r;
  r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  const photon::finance::OhlcArrays ha =
      photon::finance::heikin_ashi(open, high, low, close, static_cast<size_t>(count));
  emit(ha.open, out_open);
  emit(ha.high, out_high);
  emit(ha.low, out_low);
  emit(ha.close, out_close);
  return PH_OK;
}

namespace {

ph_brick to_abi(const photon::finance::Brick& b) {
  ph_brick out{};
  out.open = b.open;
  out.close = b.close;
  out.x = b.x;
  out.up = b.up ? 1 : 0;
  return out;
}

}  // namespace

extern "C" ph_result PH_CALL ph_fin_renko(const double* close, int32_t count, double brick_size,
                                          ph_brick* out, int32_t capacity, int32_t* out_count) {
  clear_error();
  const ph_result r = check_series(close, count, "close");
  if (r != PH_OK) return r;
  const std::vector<photon::finance::Brick> bricks =
      photon::finance::renko(close, static_cast<size_t>(count), brick_size);
  return emit_counted(bricks, out, capacity, out_count, to_abi);
}

extern "C" ph_result PH_CALL ph_fin_line_break(const double* close, int32_t count, int32_t lines,
                                               ph_brick* out, int32_t capacity,
                                               int32_t* out_count) {
  clear_error();
  const ph_result r = check_series(close, count, "close");
  if (r != PH_OK) return r;
  const std::vector<photon::finance::Brick> bricks =
      photon::finance::line_break(close, static_cast<size_t>(count), lines);
  return emit_counted(bricks, out, capacity, out_count, to_abi);
}

extern "C" ph_result PH_CALL ph_fin_point_and_figure(const double* high, const double* low,
                                                     int32_t count, double box_size,
                                                     int32_t reversal, ph_pf_column* out,
                                                     int32_t capacity, int32_t* out_count) {
  clear_error();
  ph_result r = check_series(high, count, "high");
  if (r != PH_OK) return r;
  r = check_series(low, count, "low");
  if (r != PH_OK) return r;
  const std::vector<photon::finance::PfColumn> cols =
      photon::finance::point_and_figure(high, low, static_cast<size_t>(count), box_size, reversal);
  return emit_counted(cols, out, capacity, out_count, [](const photon::finance::PfColumn& c) {
    ph_pf_column o{};
    o.from = c.from;
    o.to = c.to;
    o.col = c.col;
    o.kind = static_cast<int32_t>(static_cast<unsigned char>(c.kind));
    return o;
  });
}

extern "C" ph_result PH_CALL ph_fin_volume_profile(const double* price, const double* volume,
                                                   int32_t count, int32_t bins, double* out_levels,
                                                   double* out_volume, ph_volume_profile* out_info) {
  clear_error();
  ph_result r = check_series(price, count, "price");
  if (r != PH_OK) return r;
  r = check_series(volume, count, "volume");
  if (r != PH_OK) return r;
  if (bins <= 0) return fail(PH_E_INVALID_ARGUMENT, "bins must be positive");
  const photon::finance::VolumeProfile vp =
      photon::finance::volume_profile(price, volume, static_cast<size_t>(count), bins);
  emit(vp.levels, out_levels);
  emit(vp.volume, out_volume);
  if (out_info) {
    out_info->bin_size = vp.bin_size;
    out_info->price_min = vp.price_min;
    out_info->price_max = vp.price_max;
    out_info->poc_index = vp.poc_index;
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_depth(const double* bid_price, const double* bid_size,
                                          int32_t bid_count, const double* ask_price,
                                          const double* ask_size, int32_t ask_count,
                                          double* out_bid_price, double* out_bid_cum,
                                          double* out_ask_price, double* out_ask_cum) {
  clear_error();
  ph_result r = check_series(bid_price, bid_count, "bid_price");
  if (r != PH_OK) return r;
  r = check_series(bid_size, bid_count, "bid_size");
  if (r != PH_OK) return r;
  r = check_series(ask_price, ask_count, "ask_price");
  if (r != PH_OK) return r;
  r = check_series(ask_size, ask_count, "ask_size");
  if (r != PH_OK) return r;
  const photon::finance::DepthCurves d =
      photon::finance::depth(bid_price, bid_size, static_cast<size_t>(bid_count), ask_price,
                             ask_size, static_cast<size_t>(ask_count));
  emit(d.bid_price, out_bid_price);
  emit(d.bid_cum, out_bid_cum);
  emit(d.ask_price, out_ask_price);
  emit(d.ask_cum, out_ask_cum);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_resample_ohlc(
    const double* time, const double* open, const double* high, const double* low,
    const double* close, const double* volume, int32_t count, double bucket_ms, double* out_time,
    double* out_open, double* out_high, double* out_low, double* out_close, double* out_volume,
    int32_t capacity, int32_t* out_count) {
  clear_error();
  ph_result r = check_series(time, count, "time");
  if (r != PH_OK) return r;
  r = check_series(open, count, "open");
  if (r != PH_OK) return r;
  r = check_hlc(high, low, close, count);
  if (r != PH_OK) return r;
  if (volume) {
    r = check_series(volume, count, "volume");
    if (r != PH_OK) return r;
  }
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::finance::ResampledOhlc res =
      photon::finance::resample_ohlc(time, open, high, low, close, volume,
                                     static_cast<size_t>(count), bucket_ms);
  *out_count = static_cast<int32_t>(res.time.size());
  const size_t writable = std::min(res.time.size(), static_cast<size_t>(capacity));
  const auto copy = [writable](const std::vector<double>& src, double* dst) {
    if (dst && writable > 0 && !src.empty()) std::memcpy(dst, src.data(), writable * sizeof(double));
  };
  copy(res.time, out_time);
  copy(res.open, out_open);
  copy(res.high, out_high);
  copy(res.low, out_low);
  copy(res.close, out_close);
  copy(res.volume, out_volume);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_fin_drawdown(const double* equity, int32_t count,
                                             double* out_values, double* out_peak,
                                             ph_drawdown* out_info) {
  clear_error();
  const ph_result r = check_series(equity, count, "equity");
  if (r != PH_OK) return r;
  const photon::finance::Drawdown dd =
      photon::finance::drawdown(equity, static_cast<size_t>(count));
  emit(dd.values, out_values);
  emit(dd.peak, out_peak);
  if (out_info) {
    out_info->max_drawdown = dd.max_drawdown;
    out_info->trough_index = dd.trough_index;
    out_info->peak_index = dd.peak_index;
  }
  return PH_OK;
}

namespace {

/// Copy at most `capacity` doubles into a caller buffer, if it asked for them.
void emit_capped(const std::vector<double>& src, double* out, size_t writable) {
  if (out && writable > 0 && !src.empty()) {
    std::memcpy(out, src.data(), std::min(writable, src.size()) * sizeof(double));
  }
}

}  // namespace

extern "C" ph_result PH_CALL ph_stat_histogram(const double* values, int32_t count, int32_t bins,
                                               double lo, double hi, double* out_edges,
                                               double* out_counts, double* out_centers,
                                               int32_t capacity, int32_t* out_bins) {
  clear_error();
  ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out_bins) return fail(PH_E_INVALID_ARGUMENT, "out_bins must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::stats::Histogram h =
      photon::stats::histogram(values, static_cast<size_t>(count), bins, lo, hi);
  *out_bins = static_cast<int32_t>(h.counts.size());
  const size_t writable = std::min(h.counts.size(), static_cast<size_t>(capacity));
  emit_capped(h.counts, out_counts, writable);
  emit_capped(h.centers, out_centers, writable);
  // One more edge than there are bins, which is the whole point of edges.
  emit_capped(h.edges, out_edges, writable > 0 ? writable + 1 : 0);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_histogram_edges(const double* values, int32_t count,
                                                     const double* edges, int32_t edge_count,
                                                     double* out_counts, double* out_centers) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!edges || edge_count < 2) {
    return fail(PH_E_INVALID_ARGUMENT, "edges must hold at least two entries");
  }
  const photon::stats::Histogram h = photon::stats::histogram_edges(
      values, static_cast<size_t>(count), edges, static_cast<size_t>(edge_count));
  emit(h.counts, out_counts);
  emit(h.centers, out_centers);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_hist2d(const double* x, const double* y, int32_t count,
                                            int32_t cols, int32_t rows, ph_range x_range,
                                            ph_range y_range, double* out_values, int32_t capacity,
                                            ph_grid_info* out_info) {
  clear_error();
  ph_result r = check_series(x, count, "x");
  if (r != PH_OK) return r;
  r = check_series(y, count, "y");
  if (r != PH_OK) return r;
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::stats::Histogram2D h =
      photon::stats::hist2d(x, y, static_cast<size_t>(count), cols, rows, x_range.lo, x_range.hi,
                            y_range.lo, y_range.hi);
  if (out_info) {
    out_info->cols = static_cast<int32_t>(h.cols);
    out_info->rows = static_cast<int32_t>(h.rows);
    out_info->x = ph_range{h.x0, h.x1};
    out_info->y = ph_range{h.y0, h.y1};
  }
  emit_capped(h.values, out_values, static_cast<size_t>(capacity));
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_quantile(const double* sorted, int32_t count, double q,
                                              double* out) {
  clear_error();
  const ph_result r = check_series(sorted, count, "sorted");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  const std::vector<double> copy(sorted, sorted + count);
  *out = photon::stats::quantile_sorted(copy, q);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_box(const double* values, int32_t count, ph_box_stats* out,
                                         double* out_outliers, int32_t capacity) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::stats::BoxStats box = photon::stats::box_stats(values, static_cast<size_t>(count));
  out->min = box.min;
  out->q1 = box.q1;
  out->median = box.median;
  out->q3 = box.q3;
  out->max = box.max;
  out->whisker_lo = box.whisker_lo;
  out->whisker_hi = box.whisker_hi;
  out->outlier_count = static_cast<int32_t>(box.outliers.size());
  out->valid = box.valid ? 1 : 0;
  emit_capped(box.outliers, out_outliers, static_cast<size_t>(capacity));
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_kde(const double* values, int32_t count, double lo, double hi,
                                         int32_t points, double* out_x, double* out_y) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (points < 1) return fail(PH_E_INVALID_ARGUMENT, "points must be positive");
  const photon::stats::Density d = photon::stats::kde(values, static_cast<size_t>(count), lo, hi,
                                                      static_cast<size_t>(points));
  emit(d.xs, out_x);
  emit(d.ys, out_y);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_fft(double* re, double* im, int32_t count) {
  clear_error();
  if (count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (count > 0 && (!re || !im)) {
    return fail(PH_E_INVALID_ARGUMENT, "re and im must both be non-null");
  }
  if (count > 0 && (count & (count - 1)) != 0) {
    return fail(PH_E_INVALID_ARGUMENT, "count must be a power of two");
  }
  photon::stats::fft(re, im, static_cast<size_t>(count));
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_spectrogram(const double* signal, int32_t count,
                                                 int32_t fft_size, int32_t hop, double sample_rate,
                                                 double* out_values, int32_t capacity,
                                                 ph_grid_info* out_info) {
  clear_error();
  const ph_result r = check_series(signal, count, "signal");
  if (r != PH_OK) return r;
  if (fft_size < 2 || (fft_size & (fft_size - 1)) != 0) {
    return fail(PH_E_INVALID_ARGUMENT, "fft_size must be a power of two of at least 2");
  }
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::stats::Spectrogram s = photon::stats::spectrogram(
      signal, static_cast<size_t>(count), fft_size, hop, sample_rate);
  if (out_info) {
    out_info->cols = static_cast<int32_t>(s.cols);
    out_info->rows = static_cast<int32_t>(s.rows);
    out_info->x = ph_range{s.x0, s.x1};
    out_info->y = ph_range{s.y0, s.y1};
  }
  emit_capped(s.values, out_values, static_cast<size_t>(capacity));
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_linear_regression(const double* x, const double* y,
                                                       int32_t count, ph_linear_fit* out) {
  clear_error();
  ph_result r = check_series(x, count, "x");
  if (r != PH_OK) return r;
  r = check_series(y, count, "y");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  const photon::stats::LinearFit fit =
      photon::stats::linear_regression(x, y, static_cast<size_t>(count));
  out->slope = fit.slope;
  out->intercept = fit.intercept;
  out->r2 = fit.r2;
  out->stderror = fit.stderror;
  out->n = static_cast<int32_t>(fit.n);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_linear_trend(const double* x, const double* y, int32_t count,
                                                  int32_t points, double band, double* out_x,
                                                  double* out_y, double* out_lower,
                                                  double* out_upper) {
  clear_error();
  ph_result r = check_series(x, count, "x");
  if (r != PH_OK) return r;
  r = check_series(y, count, "y");
  if (r != PH_OK) return r;
  const photon::stats::Trend t = photon::stats::linear_trend(
      x, y, static_cast<size_t>(count), points > 0 ? points : 2, band);
  emit(t.x, out_x);
  emit(t.y, out_y);
  emit(t.lower, out_lower);
  emit(t.upper, out_upper);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_loess(const double* x, const double* y, int32_t count,
                                           double bandwidth, int32_t points, double* out_x,
                                           double* out_y, int32_t capacity, int32_t* out_count) {
  clear_error();
  ph_result r = check_series(x, count, "x");
  if (r != PH_OK) return r;
  r = check_series(y, count, "y");
  if (r != PH_OK) return r;
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::stats::Trend t =
      photon::stats::loess(x, y, static_cast<size_t>(count), bandwidth, points);
  *out_count = static_cast<int32_t>(t.x.size());
  const size_t writable = std::min(t.x.size(), static_cast<size_t>(capacity));
  emit_capped(t.x, out_x, writable);
  emit_capped(t.y, out_y, writable);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_ecdf(const double* values, int32_t count, double* out_x,
                                          double* out_y, int32_t capacity, int32_t* out_count) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::stats::Trend e = photon::stats::ecdf(values, static_cast<size_t>(count));
  *out_count = static_cast<int32_t>(e.x.size());
  const size_t writable = std::min(e.x.size(), static_cast<size_t>(capacity));
  emit_capped(e.x, out_x, writable);
  emit_capped(e.y, out_y, writable);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_zscore(const double* values, int32_t count, double* out) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::stats::zscore(values, static_cast<size_t>(count)), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_correlation(const double* a, const double* b, int32_t count,
                                                 double* out) {
  clear_error();
  ph_result r = check_series(a, count, "a");
  if (r != PH_OK) return r;
  r = check_series(b, count, "b");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  *out = photon::stats::correlation(a, b, static_cast<size_t>(count));
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_corr_matrix(const double* const* columns, int32_t k,
                                                 int32_t count, double* out) {
  clear_error();
  if (k < 0 || count < 0) return fail(PH_E_INVALID_ARGUMENT, "k and count must be non-negative");
  if (k > 0 && !columns) return fail(PH_E_INVALID_ARGUMENT, "columns must be non-null when k > 0");
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  for (int32_t i = 0; i < k; ++i) {
    if (count > 0 && !columns[i]) {
      return fail(PH_E_INVALID_ARGUMENT, "every column must be non-null when count > 0");
    }
  }
  emit(photon::stats::corr_matrix(columns, static_cast<size_t>(k), static_cast<size_t>(count)),
       out);
  return PH_OK;
}

namespace {

/// An out-of-range window name is a caller error, not a silent fallback to Hann.
bool to_window(ph_window value, photon::stats::Window& out) {
  switch (value) {
    case PH_WINDOW_RECTANGULAR: out = photon::stats::Window::Rectangular; return true;
    case PH_WINDOW_HANN:        out = photon::stats::Window::Hann;        return true;
    case PH_WINDOW_HAMMING:     out = photon::stats::Window::Hamming;     return true;
    case PH_WINDOW_BLACKMAN:    out = photon::stats::Window::Blackman;    return true;
    case PH_WINDOW_BARTLETT:    out = photon::stats::Window::Bartlett;    return true;
    default:                                                             return false;
  }
}

}  // namespace

extern "C" ph_result PH_CALL ph_stat_window(ph_window window, int32_t count, double* out) {
  clear_error();
  if (count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (count > 0 && !out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  photon::stats::Window kind = photon::stats::Window::Hann;
  if (!to_window(window, kind)) return fail(PH_E_INVALID_ARGUMENT, "unknown window function");
  emit(photon::stats::window_function(kind, static_cast<size_t>(count)), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_welch(const double* signal, int32_t count, int32_t segment,
                                           double overlap, ph_window window, double sample_rate,
                                           double* out_frequencies, double* out_power,
                                           int32_t capacity, int32_t* out_bins) {
  clear_error();
  const ph_result r = check_series(signal, count, "signal");
  if (r != PH_OK) return r;
  if (!out_bins) return fail(PH_E_INVALID_ARGUMENT, "out_bins must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  photon::stats::Window kind = photon::stats::Window::Hann;
  if (!to_window(window, kind)) return fail(PH_E_INVALID_ARGUMENT, "unknown window function");
  const photon::stats::Psd psd = photon::stats::welch(signal, static_cast<size_t>(count), segment,
                                                      overlap, kind, sample_rate);
  *out_bins = static_cast<int32_t>(psd.power.size());
  const size_t writable = std::min(psd.power.size(), static_cast<size_t>(capacity));
  emit_capped(psd.frequencies, out_frequencies, writable);
  emit_capped(psd.power, out_power, writable);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_savitzky_golay(const double* values, int32_t count,
                                                    int32_t window, int32_t order, double* out) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::stats::savitzky_golay(values, static_cast<size_t>(count), window > 0 ? window : 9,
                                     order),
       out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_stat_cross_correlate(const double* a, const double* b,
                                                     int32_t count, int32_t max_lag,
                                                     ph_bool normalize, int32_t* out_lags,
                                                     double* out_values, int32_t capacity,
                                                     int32_t* out_count) {
  clear_error();
  ph_result r = check_series(a, count, "a");
  if (r != PH_OK) return r;
  r = check_series(b, count, "b");
  if (r != PH_OK) return r;
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::stats::Correlation c = photon::stats::cross_correlate(
      a, b, static_cast<size_t>(count), max_lag, normalize != 0);
  *out_count = static_cast<int32_t>(c.values.size());
  const size_t writable = std::min(c.values.size(), static_cast<size_t>(capacity));
  emit_capped(c.values, out_values, writable);
  if (out_lags && writable > 0) {
    std::memcpy(out_lags, c.lags.data(), writable * sizeof(int32_t));
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_confusion_matrix(const double* y_true, const double* y_pred,
                                                    int32_t count, int32_t classes,
                                                    double* out_counts, double* out_normalized,
                                                    double* out_support, int32_t capacity,
                                                    int32_t* out_classes) {
  clear_error();
  ph_result r = check_series(y_true, count, "y_true");
  if (r != PH_OK) return r;
  r = check_series(y_pred, count, "y_pred");
  if (r != PH_OK) return r;
  if (!out_classes) return fail(PH_E_INVALID_ARGUMENT, "out_classes must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::ml::ConfusionMatrix m =
      photon::ml::confusion_matrix(y_true, y_pred, static_cast<size_t>(count), classes);
  *out_classes = static_cast<int32_t>(m.classes);
  const size_t fit = std::min(m.classes, static_cast<size_t>(capacity));
  emit_capped(m.support, out_support, fit);
  emit_capped(m.counts, out_counts, fit * fit);
  emit_capped(m.normalized, out_normalized, fit * fit);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_roc_curve(const double* scores, const double* labels,
                                             int32_t count, double* out_fpr, double* out_tpr,
                                             double* out_thresholds, int32_t capacity,
                                             int32_t* out_count, double* out_auc) {
  clear_error();
  ph_result r = check_series(scores, count, "scores");
  if (r != PH_OK) return r;
  r = check_series(labels, count, "labels");
  if (r != PH_OK) return r;
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::ml::RocCurve roc =
      photon::ml::roc_curve(scores, labels, static_cast<size_t>(count));
  *out_count = static_cast<int32_t>(roc.fpr.size());
  const size_t fit = std::min(roc.fpr.size(), static_cast<size_t>(capacity));
  emit_capped(roc.fpr, out_fpr, fit);
  emit_capped(roc.tpr, out_tpr, fit);
  emit_capped(roc.thresholds, out_thresholds, fit);
  if (out_auc) *out_auc = roc.auc;
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_pr_curve(const double* scores, const double* labels,
                                            int32_t count, double* out_recall,
                                            double* out_precision, double* out_thresholds,
                                            int32_t capacity, int32_t* out_count, double* out_ap,
                                            double* out_baseline) {
  clear_error();
  ph_result r = check_series(scores, count, "scores");
  if (r != PH_OK) return r;
  r = check_series(labels, count, "labels");
  if (r != PH_OK) return r;
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::ml::PrCurve pr = photon::ml::pr_curve(scores, labels, static_cast<size_t>(count));
  *out_count = static_cast<int32_t>(pr.recall.size());
  const size_t fit = std::min(pr.recall.size(), static_cast<size_t>(capacity));
  emit_capped(pr.recall, out_recall, fit);
  emit_capped(pr.precision, out_precision, fit);
  emit_capped(pr.thresholds, out_thresholds, fit);
  if (out_ap) *out_ap = pr.ap;
  if (out_baseline) *out_baseline = pr.baseline;
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_calibration_curve(const double* scores, const double* labels,
                                                     int32_t count, int32_t bins,
                                                     double* out_mean_predicted,
                                                     double* out_fraction_positive,
                                                     double* out_bin_count, double* out_ece) {
  clear_error();
  ph_result r = check_series(scores, count, "scores");
  if (r != PH_OK) return r;
  r = check_series(labels, count, "labels");
  if (r != PH_OK) return r;
  if (bins < 1) return fail(PH_E_INVALID_ARGUMENT, "bins must be positive");
  const photon::ml::CalibrationCurve c =
      photon::ml::calibration_curve(scores, labels, static_cast<size_t>(count), bins);
  emit(c.mean_predicted, out_mean_predicted);
  emit(c.fraction_positive, out_fraction_positive);
  emit(c.bin_count, out_bin_count);
  if (out_ece) *out_ece = c.ece;
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_ema_smooth(const double* values, int32_t count, double weight,
                                              double* out) {
  clear_error();
  const ph_result r = check_series(values, count, "values");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::ml::ema_smooth(values, static_cast<size_t>(count), weight), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_regression_metrics(const double* y_true, const double* y_pred,
                                                      int32_t count,
                                                      ph_regression_metrics* out) {
  clear_error();
  ph_result r = check_series(y_true, count, "y_true");
  if (r != PH_OK) return r;
  r = check_series(y_pred, count, "y_pred");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  const size_t n = static_cast<size_t>(count);
  out->mse = photon::ml::mse(y_true, y_pred, n);
  out->rmse = photon::ml::rmse(y_true, y_pred, n);
  out->mae = photon::ml::mae(y_true, y_pred, n);
  out->r2 = photon::ml::r2(y_true, y_pred, n);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_probability_scores(const double* probs, const double* labels,
                                                      int32_t count, double eps,
                                                      double* out_log_loss, double* out_brier) {
  clear_error();
  ph_result r = check_series(probs, count, "probs");
  if (r != PH_OK) return r;
  r = check_series(labels, count, "labels");
  if (r != PH_OK) return r;
  const size_t n = static_cast<size_t>(count);
  if (out_log_loss) *out_log_loss = photon::ml::log_loss(probs, labels, n, eps > 0.0 ? eps : 1e-15);
  if (out_brier) *out_brier = photon::ml::brier_score(probs, labels, n);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_classification_report(const double* y_true,
                                                         const double* y_pred, int32_t count,
                                                         int32_t classes,
                                                         ph_class_score* out_per_class,
                                                         int32_t capacity,
                                                         ph_classification_report* out) {
  clear_error();
  ph_result r = check_series(y_true, count, "y_true");
  if (r != PH_OK) return r;
  r = check_series(y_pred, count, "y_pred");
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::ml::ClassificationReport report =
      photon::ml::classification_report(y_true, y_pred, static_cast<size_t>(count), classes);
  out->accuracy = report.accuracy;
  out->macro.precision = report.macro.precision;
  out->macro.recall = report.macro.recall;
  out->macro.f1 = report.macro.f1;
  out->weighted.precision = report.weighted.precision;
  out->weighted.recall = report.weighted.recall;
  out->weighted.f1 = report.weighted.f1;
  out->classes = static_cast<int32_t>(report.per_class.size());
  const size_t fit = std::min(report.per_class.size(), static_cast<size_t>(capacity));
  for (size_t i = 0; i < fit; ++i) {
    out_per_class[i].precision = report.per_class[i].precision;
    out_per_class[i].recall = report.per_class[i].recall;
    out_per_class[i].f1 = report.per_class[i].f1;
    out_per_class[i].support = report.per_class[i].support;
    out_per_class[i].label = report.per_class[i].label;
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_lift_curve(const double* scores, const double* labels,
                                              int32_t count, double* out_fraction, double* out_gain,
                                              double* out_lift, int32_t* out_positives) {
  clear_error();
  ph_result r = check_series(scores, count, "scores");
  if (r != PH_OK) return r;
  r = check_series(labels, count, "labels");
  if (r != PH_OK) return r;
  const photon::ml::LiftCurve lift =
      photon::ml::lift_curve(scores, labels, static_cast<size_t>(count));
  emit(lift.fraction, out_fraction);
  emit(lift.gain, out_gain);
  emit(lift.lift, out_lift);
  if (out_positives) *out_positives = static_cast<int32_t>(lift.positives);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_roc_ovr(const double* scores, const double* labels,
                                           int32_t count, int32_t classes, double* out_auc,
                                           double* out_macro_auc, double* out_micro_auc) {
  clear_error();
  const ph_result r = check_series(labels, count, "labels");
  if (r != PH_OK) return r;
  if (classes < 1) return fail(PH_E_INVALID_ARGUMENT, "classes must be positive");
  if (count > 0 && !scores) {
    return fail(PH_E_INVALID_ARGUMENT, "scores must be non-null when count > 0");
  }
  const photon::ml::MulticlassRoc roc = photon::ml::roc_curve_ovr(
      scores, labels, static_cast<size_t>(count), static_cast<size_t>(classes));
  if (out_auc) {
    for (size_t c = 0; c < roc.per_class.size(); ++c) out_auc[c] = roc.per_class[c].auc;
  }
  if (out_macro_auc) *out_macro_auc = roc.macro_auc;
  if (out_micro_auc) *out_micro_auc = roc.micro_auc;
  return PH_OK;
}

namespace {

/// Both PCA entry points want the same two-dimension check.
ph_result check_matrix(const double* data, int32_t n, int32_t d) {
  if (n < 0 || d < 0) return fail(PH_E_INVALID_ARGUMENT, "n and d must be non-negative");
  if (n > 0 && d > 0 && !data) {
    return fail(PH_E_INVALID_ARGUMENT, "data must be non-null for a non-empty matrix");
  }
  return PH_OK;
}

}  // namespace

extern "C" ph_result PH_CALL ph_ml_standardize(const double* data, int32_t n, int32_t d,
                                               double* out) {
  clear_error();
  const ph_result r = check_matrix(data, n, d);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit(photon::ml::standardize(data, static_cast<size_t>(n), static_cast<size_t>(d)), out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_ml_pca(const double* data, int32_t n, int32_t d, int32_t k,
                                       double* out_scores, double* out_components,
                                       double* out_explained, double* out_mean) {
  clear_error();
  const ph_result r = check_matrix(data, n, d);
  if (r != PH_OK) return r;
  if (k < 1) return fail(PH_E_INVALID_ARGUMENT, "k must be positive");
  const photon::ml::PcaResult pca = photon::ml::pca(data, static_cast<size_t>(n),
                                                    static_cast<size_t>(d), static_cast<size_t>(k));
  emit(pca.scores, out_scores);
  emit(pca.components, out_components);
  emit(pca.explained, out_explained);
  emit(pca.mean, out_mean);
  return PH_OK;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

extern "C" ph_result PH_CALL ph_data_lttb(const double* x, const double* y, int32_t count,
                                          int32_t threshold, double* out_x, double* out_y,
                                          int32_t capacity, int32_t* out_count) {
  clear_error();
  ph_result r = check_series(x, count, "x");
  if (r != PH_OK) return r;
  r = check_series(y, count, "y");
  if (r != PH_OK) return r;
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (threshold < 0) return fail(PH_E_INVALID_ARGUMENT, "threshold must be non-negative");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  const photon::data::Downsampled d = photon::data::lttb(
      x, y, static_cast<size_t>(count), static_cast<size_t>(threshold));
  *out_count = static_cast<int32_t>(d.x.size());
  const size_t fit = std::min(d.x.size(), static_cast<size_t>(capacity));
  emit_capped(d.x, out_x, fit);
  emit_capped(d.y, out_y, fit);
  return PH_OK;
}

extern "C" void PH_CALL ph_csv_options_init(ph_csv_options* out) {
  if (!out) return;
  *out = ph_csv_options{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_csv_options));
  // Everything else is a negation of a default that is on, so zero is right.
}

extern "C" ph_result PH_CALL ph_csv_parse(const char* text, int32_t length,
                                          const ph_csv_options* options, ph_table* out) {
  clear_error();
  const ph_result init = require_init();
  if (init != PH_OK) return init;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  *out = PH_NULL_HANDLE;
  if (!text) return fail(PH_E_INVALID_ARGUMENT, "text must be non-null");
  if (length < 0) return fail(PH_E_INVALID_ARGUMENT, "length must be non-negative");
  if (options && !desc_size_ok(options)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_csv_options.struct_size is larger than this build's");
  }
  const ph_csv_options normalized = normalize(options, ph_csv_options_init);

  photon::data::CsvOptions opts;
  opts.delimiter = normalized.delimiter == 0 ? ',' : static_cast<char>(normalized.delimiter);
  opts.header = normalized.no_header == 0;
  opts.skip_empty = normalized.keep_empty_lines == 0;

  const size_t n = length > 0 ? static_cast<size_t>(length) : std::strlen(text);
  try {
    auto table = std::make_unique<photon::data::Table>(photon::data::parse_csv(text, n, opts));
    *out = Registry::get().tables.insert(std::move(table));
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory parsing the CSV");
  }
  return PH_OK;
}

namespace {

photon::data::Table* resolve_table(ph_table handle) {
  if (!Registry::get().initialized) return nullptr;
  return Registry::get().tables.get(handle);
}

}  // namespace

extern "C" ph_result PH_CALL ph_table_destroy(ph_table table) {
  clear_error();
  if (table == PH_NULL_HANDLE) return PH_OK;
  const ph_result init = require_init();
  if (init != PH_OK) return init;
  if (!Registry::get().tables.erase(table)) {
    return fail(PH_E_INVALID_HANDLE, "table handle is stale or invalid");
  }
  return PH_OK;
}

extern "C" ph_bool PH_CALL ph_table_valid(ph_table table) {
  return resolve_table(table) != nullptr ? 1 : 0;
}

extern "C" int32_t PH_CALL ph_table_row_count(ph_table table) {
  const photon::data::Table* t = resolve_table(table);
  return t ? static_cast<int32_t>(t->row_count()) : -1;
}

extern "C" int32_t PH_CALL ph_table_column_count(ph_table table) {
  const photon::data::Table* t = resolve_table(table);
  return t ? static_cast<int32_t>(t->column_count()) : -1;
}

extern "C" const char* PH_CALL ph_table_header(ph_table table, int32_t column) {
  const photon::data::Table* t = resolve_table(table);
  if (!t || column < 0 || static_cast<size_t>(column) >= t->headers().size()) return nullptr;
  return t->headers()[static_cast<size_t>(column)].c_str();
}

extern "C" const char* PH_CALL ph_table_cell(ph_table table, int32_t row, int32_t column) {
  const photon::data::Table* t = resolve_table(table);
  if (!t || row < 0 || column < 0) return nullptr;
  if (static_cast<size_t>(row) >= t->row_count()) return nullptr;
  return t->cell(static_cast<size_t>(row), static_cast<size_t>(column)).c_str();
}

extern "C" int32_t PH_CALL ph_table_column_index(ph_table table, const char* name) {
  const photon::data::Table* t = resolve_table(table);
  if (!t || !name) return -1;
  return t->index_of(name);
}

extern "C" ph_result PH_CALL ph_table_numeric(ph_table table, int32_t column, double* out,
                                              int32_t capacity) {
  clear_error();
  const photon::data::Table* t = resolve_table(table);
  if (!t) return fail(PH_E_INVALID_HANDLE, "table handle is stale or invalid");
  if (column < 0 || static_cast<size_t>(column) >= t->column_count()) {
    return fail(PH_E_INVALID_ARGUMENT, "column is out of range");
  }
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  if (capacity > 0 && !out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  emit_capped(t->numeric(static_cast<size_t>(column)), out, static_cast<size_t>(capacity));
  return PH_OK;
}

// ---------------------------------------------------------------------------
// Descriptor defaults
// ---------------------------------------------------------------------------

extern "C" void PH_CALL ph_host_desc_init(ph_host_desc* out) {
  if (!out) return;
  *out = ph_host_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_host_desc));
  out->api = PH_GFX_GL33;
}

extern "C" void PH_CALL ph_frame_target_init(ph_frame_target* out) {
  if (!out) return;
  *out = ph_frame_target{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_frame_target));
  out->dpr = 1.0f;
}

extern "C" void PH_CALL ph_axis_desc_init(ph_axis_desc* out) {
  if (!out) return;
  *out = ph_axis_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_axis_desc));
  out->type = PH_SCALE_LINEAR;
  // lo == hi means "autoscale to the data", which is the core's default.
}

extern "C" void PH_CALL ph_axis_config_init(ph_axis_config* out) {
  if (!out) return;
  *out = ph_axis_config{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_axis_config));
  // Every other field is zero-means-default on purpose: the axis line, the ticks
  // and the grid are on, the colours come from the theme, and the sizes are the
  // ones resolve_axis_style() fills in.
}

extern "C" void PH_CALL ph_plot_desc_init(ph_plot_desc* out) {
  if (!out) return;
  *out = ph_plot_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_plot_desc));
  out->width = 640;
  out->height = 400;
  out->theme = PH_THEME_DARK;
  out->margin = ph_margin{16.0f, 16.0f, 40.0f, 56.0f};
  ph_axis_desc_init(&out->x);
  ph_axis_desc_init(&out->y);
  out->mode = PH_MODE_PAN;
  out->pick = PH_PICK_X;
  // Interaction, hover, crosshair and the colorbar are on by default, and their
  // descriptor fields are negated — so the defaults really are all-zero.
}

extern "C" void PH_CALL ph_line_desc_init(ph_line_desc* out) {
  if (!out) return;
  *out = ph_line_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_line_desc));
  out->width = 1.5f;
  out->join = PH_JOIN_ROUND;
  out->miter_limit = 4.0f;
  out->render_type = PH_RENDER_STATIC;
}

extern "C" void PH_CALL ph_scatter_desc_init(ph_scatter_desc* out) {
  if (!out) return;
  *out = ph_scatter_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_scatter_desc));
  out->size = 6.0f;
  out->marker = PH_MARKER_CIRCLE;
  out->render_type = PH_RENDER_STATIC;
}

// ---------------------------------------------------------------------------
// Plot lifecycle
// ---------------------------------------------------------------------------

extern "C" ph_result PH_CALL ph_plot_create(const ph_plot_desc* desc, ph_plot* out) {
  clear_error();
  const ph_result init = require_init();
  if (init != PH_OK) return init;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_plot_desc.struct_size is larger than this build's");
  }
  const ph_plot_desc normalized = normalize(desc, ph_plot_desc_init);
  try {
    auto plot = std::make_unique<Plot>(normalized);
    *out = Registry::get().plots.insert(std::move(plot));
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating plot");
  } catch (const std::exception& e) {
    return fail(PH_E_INTERNAL, e.what());
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_destroy(ph_plot handle) {
  clear_error();
  if (handle == PH_NULL_HANDLE) return PH_OK;
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  Registry& registry = Registry::get();
  // Free GPU objects while the context is (hopefully) still current. If the host
  // already tore the context down there is nothing to free — it went with it.
  if (registry.gl.ready && plot->owner_thread() == std::this_thread::get_id()) {
    plot->release_gl(registry.gl);
  }
  // Invalidate the layer handles before the layers themselves are freed, so a
  // host that still holds one gets PH_E_INVALID_HANDLE and not a dangling read.
  for (uint64_t layer : plot->layer_handles) registry.layers.erase(layer);
  registry.plots.erase(handle);
  return PH_OK;
}

extern "C" ph_bool PH_CALL ph_plot_valid(ph_plot handle) {
  Registry& registry = Registry::get();
  if (!registry.initialized) return 0;
  return registry.plots.get(handle) != nullptr ? 1 : 0;
}

extern "C" ph_result PH_CALL ph_plot_set_size(ph_plot handle, int32_t width, int32_t height) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (width < 0 || height < 0) return fail(PH_E_INVALID_ARGUMENT, "size must be non-negative");
  plot->set_size(width, height);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_margin(ph_plot handle, const ph_margin* margin) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!margin) return fail(PH_E_INVALID_ARGUMENT, "margin must be non-null");
  plot->set_margin(*margin);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_theme(ph_plot handle, ph_theme theme) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->set_theme(theme);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_title(ph_plot handle, const char* title) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->set_title(title);
  return PH_OK;
}

extern "C" void PH_CALL ph_title_config_init(ph_title_config* out) {
  if (!out) return;
  *out = ph_title_config{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_title_config));
}

extern "C" ph_result PH_CALL ph_plot_set_title_config(ph_plot handle,
                                                      const ph_title_config* config) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (config && !desc_size_ok(config)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_title_config.struct_size is larger than this build's");
  }
  const ph_title_config c = normalize(config, ph_title_config_init);
  photon::render::TitleStyle style;
  style.color = c.color;
  style.size = c.size;
  style.align = c.align == PH_ALIGN_LEFT    ? photon::text::Align::Left
                : c.align == PH_ALIGN_RIGHT ? photon::text::Align::Right
                                            : photon::text::Align::Center;
  plot->set_title(c.text);
  plot->set_title_style(style);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_equal_aspect(ph_plot handle, ph_bool enabled) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->set_equal_aspect(enabled != 0);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_colorbar(ph_plot handle, ph_bool enabled) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->set_colorbar(enabled != 0);
  return PH_OK;
}

extern "C" void PH_CALL ph_legend_config_init(ph_legend_config* out) {
  if (!out) return;
  *out = ph_legend_config{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_legend_config));
  // Everything else stays zero: off, top-right, vertical, clickable — which is
  // what an omitted `legend` means in the TypeScript too.
}

extern "C" ph_result PH_CALL ph_plot_set_legend(ph_plot handle, const ph_legend_config* config) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (config && !desc_size_ok(config)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_legend_config.struct_size is larger than this build's");
  }
  const ph_legend_config normalized = normalize(config, ph_legend_config_init);
  if (normalized.position < PH_LEGEND_TOP_RIGHT || normalized.position > PH_LEGEND_BOTTOM_RIGHT) {
    return fail(PH_E_INVALID_ARGUMENT, "unknown legend position");
  }
  plot->set_legend(normalized.enabled != 0, normalized.position, normalized.horizontal != 0,
                   normalized.no_toggle == 0);
  return PH_OK;
}

extern "C" void PH_CALL ph_annotation_init(ph_annotation* out) {
  if (!out) return;
  *out = ph_annotation{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_annotation));
  // A zeroed struct is a PH_ANNOTATION_SPAN on x at zero, left-aligned and
  // middle-baselined — which is what the equivalent TypeScript defaults to.
  out->baseline = PH_BASELINE_MIDDLE;
}

extern "C" ph_result PH_CALL ph_plot_add_annotation(ph_plot handle,
                                                    const ph_annotation* annotation,
                                                    ph_annotation_id* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (annotation && !desc_size_ok(annotation)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_annotation.struct_size is larger than this build's");
  }
  const ph_annotation normalized = normalize(annotation, ph_annotation_init);
  if (normalized.type < PH_ANNOTATION_SPAN || normalized.type > PH_ANNOTATION_FIB) {
    return fail(PH_E_INVALID_ARGUMENT, "unknown annotation type");
  }
  if (normalized.type == PH_ANNOTATION_LABEL && !normalized.text) {
    // A label with no text draws nothing, which is the silent-blank failure
    // this ABI reports rather than performs.
    return fail(PH_E_INVALID_ARGUMENT, "a label annotation needs `text`");
  }
  if (normalized.ratio_count < 0 || normalized.dash_count < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "ratio_count and dash_count must be non-negative");
  }
  if (normalized.ratio_count > 0 && !normalized.ratios) {
    return fail(PH_E_INVALID_ARGUMENT, "ratios must be non-null when ratio_count > 0");
  }
  if (normalized.dash_count > 0 && !normalized.dash) {
    return fail(PH_E_INVALID_ARGUMENT, "dash must be non-null when dash_count > 0");
  }
  try {
    *out = plot->add_annotation(normalized);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory adding an annotation");
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_remove_annotation(ph_plot handle, ph_annotation_id id) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!plot->remove_annotation(id)) {
    return fail(PH_E_INVALID_ARGUMENT, "no annotation with that id");
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_clear_annotations(ph_plot handle) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->clear_annotations();
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_tooltip(ph_plot handle, ph_bool enabled) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->set_tooltip(enabled != 0);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_pick_mode(ph_plot handle, ph_pick_mode mode) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (mode != PH_PICK_X && mode != PH_PICK_Y && mode != PH_PICK_XY) {
    return fail(PH_E_INVALID_ARGUMENT, "unknown pick mode");
  }
  plot->set_pick_mode(mode);
  return PH_OK;
}

// ---------------------------------------------------------------------------
// Axes and view
// ---------------------------------------------------------------------------

extern "C" ph_result PH_CALL ph_plot_set_scale(ph_plot handle, const char* axis, const ph_axis_desc* desc) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!axis) return fail(PH_E_INVALID_ARGUMENT, "axis must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_axis_desc.struct_size is larger than this build's");
  }
  const ph_axis_desc normalized = normalize(desc, ph_axis_desc_init);
  if (!plot->set_scale(axis, normalized)) {
    return fail(PH_E_INVALID_ARGUMENT, std::string("no such axis: ") + axis);
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_domain(ph_plot handle, const char* axis, ph_range domain) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!axis) return fail(PH_E_INVALID_ARGUMENT, "axis must be non-null");
  // Checked here so the message can say which of the two things went wrong.
  if (!std::isfinite(domain.lo) || !std::isfinite(domain.hi) ||
      !std::isfinite(domain.hi - domain.lo)) {
    return fail(PH_E_INVALID_ARGUMENT,
                "domain must be finite, and so must its span — an unrepresentable view "
                "projects every point to the same place and cannot be zoomed back out of");
  }
  if (!plot->set_domain(axis, domain)) {
    return fail(PH_E_INVALID_ARGUMENT, std::string("no such axis: ") + axis);
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_get_domain(ph_plot handle, const char* axis, ph_range* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!axis || !out) return fail(PH_E_INVALID_ARGUMENT, "axis and out must be non-null");
  if (!plot->get_domain(axis, *out)) {
    return fail(PH_E_INVALID_ARGUMENT, std::string("no such axis: ") + axis);
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_add_y_axis(ph_plot handle, const char* id,
                                                const ph_axis_desc* desc, int32_t side) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!id || !*id) return fail(PH_E_INVALID_ARGUMENT, "id must be a non-empty string");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_axis_desc.struct_size is larger than this build's");
  }
  const ph_axis_desc normalized = normalize(desc, ph_axis_desc_init);
  if (!plot->add_y_axis(id, normalized, side)) {
    return fail(PH_E_INVALID_ARGUMENT, std::string("y axis already exists: ") + id);
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_remove_y_axis(ph_plot handle, const char* id) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!id) return fail(PH_E_INVALID_ARGUMENT, "id must be non-null");
  if (!plot->remove_y_axis(id)) {
    return fail(PH_E_INVALID_ARGUMENT, std::string("cannot remove y axis: ") + id);
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_axis_config(ph_plot handle, const char* axis,
                                                    const ph_axis_config* desc) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!axis) return fail(PH_E_INVALID_ARGUMENT, "axis must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_axis_config.struct_size is larger than this build's");
  }
  if (desc) {
    const ph_axis_config normalized = normalize(desc, ph_axis_config_init);
    if (!plot->set_axis_config(axis, &normalized)) {
      return fail(PH_E_INVALID_ARGUMENT, std::string("no such axis: ") + axis);
    }
  } else if (!plot->set_axis_config(axis, nullptr)) {
    return fail(PH_E_INVALID_ARGUMENT, std::string("no such axis: ") + axis);
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_set_axis_ticks(ph_plot handle, const char* axis,
                                                    const ph_tick* ticks, int32_t count) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!axis) return fail(PH_E_INVALID_ARGUMENT, "axis must be non-null");
  if (count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must not be negative");
  if (count > 0 && !ticks) return fail(PH_E_INVALID_ARGUMENT, "ticks must be non-null when count > 0");
  if (!plot->set_axis_ticks(axis, ticks, count)) {
    return fail(PH_E_INVALID_ARGUMENT, std::string("no such axis: ") + axis);
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_autoscale(ph_plot handle) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->autoscale();
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_reset_view(ph_plot handle) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->reset_view();
  return PH_OK;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

namespace {

/// Shared tail of every add_* entry point: hand the layer to the plot, mint a
/// handle, and record it on the plot so teardown can invalidate it.
ph_result register_layer(ph_plot plot_handle, Plot* plot,
                         std::unique_ptr<photon::Layer> layer, ph_layer* out) {
  photon::Layer* borrowed = plot->add_layer(std::move(layer));
  auto ref = std::make_unique<LayerRef>();
  ref->plot = plot_handle;
  ref->layer = borrowed;
  const ph_layer handle = Registry::get().layers.insert(std::move(ref));
  borrowed->handle = handle;
  plot->layer_handles.push_back(handle);
  *out = handle;
  return PH_OK;
}

}  // namespace

extern "C" ph_result PH_CALL ph_plot_add_line(ph_plot handle, const ph_line_desc* desc, ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_line_desc.struct_size is larger than this build's");
  }
  const ph_line_desc normalized = normalize(desc, ph_line_desc_init);
  if (normalized.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (normalized.count > 0 && (!normalized.x || !normalized.y)) {
    return fail(PH_E_INVALID_ARGUMENT, "x and y must be non-null when count > 0");
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::LineLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating line layer");
  }
}

extern "C" void PH_CALL ph_patches_desc_init(ph_patches_desc* out) {
  if (!out) return;
  *out = ph_patches_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_patches_desc));
  out->opacity = 1.0f;
  out->render_type = PH_RENDER_STATIC;
}

extern "C" void PH_CALL ph_area_desc_init(ph_area_desc* out) {
  if (!out) return;
  *out = ph_area_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_area_desc));
  out->render_type = PH_RENDER_STATIC;
}

extern "C" void PH_CALL ph_bar_desc_init(ph_bar_desc* out) {
  if (!out) return;
  *out = ph_bar_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_bar_desc));
  out->orientation = PH_ORIENT_VERTICAL;
  out->render_type = PH_RENDER_STATIC;
  // width 0 means "80% of the median spacing", which is the core's default and
  // is also what a zero-initialized struct says.
}

/// The shape every xy layer's entry point has: validate, construct, register.
template <typename Desc, typename LayerType, typename InitFn>
ph_result add_xy_layer(ph_plot handle, const Desc* desc, ph_layer* out, InitFn init,
                       const char* what) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, std::string(what) + ".struct_size is larger than this build's");
  }
  const Desc normalized = normalize(desc, init);
  if (normalized.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (normalized.count > 0 && (!normalized.x || !normalized.y)) {
    return fail(PH_E_INVALID_ARGUMENT, "x and y must be non-null when count > 0");
  }
  try {
    return register_layer(handle, plot, std::make_unique<LayerType>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, std::string("out of memory creating ") + what);
  }
}

extern "C" ph_result PH_CALL ph_plot_add_area(ph_plot handle, const ph_area_desc* desc,
                                              ph_layer* out) {
  return add_xy_layer<ph_area_desc, photon::AreaLayer>(handle, desc, out, ph_area_desc_init,
                                                       "ph_area_desc");
}

extern "C" ph_result PH_CALL ph_plot_add_bar(ph_plot handle, const ph_bar_desc* desc,
                                             ph_layer* out) {
  return add_xy_layer<ph_bar_desc, photon::BarLayer>(handle, desc, out, ph_bar_desc_init,
                                                     "ph_bar_desc");
}

extern "C" void PH_CALL ph_pie_desc_init(ph_pie_desc* out) {
  if (!out) return;
  *out = ph_pie_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_pie_desc));
  out->radius = 1.0;
  out->render_type = PH_RENDER_STATIC;
  // start_angle stays 0, which the layer reads as pi/2 — twelve o'clock, where
  // a pie chart starts and where a zero-initialized struct has to land too.
}

extern "C" void PH_CALL ph_stem_desc_init(ph_stem_desc* out) {
  if (!out) return;
  *out = ph_stem_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_stem_desc));
  out->width = 1.5f;
  out->marker_size = 6.0f;
  out->render_type = PH_RENDER_STATIC;
}

extern "C" ph_result PH_CALL ph_plot_add_pie(ph_plot handle, const ph_pie_desc* desc,
                                             ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_pie_desc.struct_size is larger than this build's");
  }
  const ph_pie_desc normalized = normalize(desc, ph_pie_desc_init);
  if (normalized.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (normalized.count > 0 && !normalized.values) {
    return fail(PH_E_INVALID_ARGUMENT, "values must be non-null when count > 0");
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::PieLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating pie layer");
  }
}

extern "C" void PH_CALL ph_errorbar_desc_init(ph_errorbar_desc* out) {
  if (!out) return;
  *out = ph_errorbar_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_errorbar_desc));
  out->width = 1.5f;
  out->cap_size = 6.0f;
  out->band_opacity = 0.2f;
  out->render_type = PH_RENDER_STATIC;
}

extern "C" void PH_CALL ph_box_desc_init(ph_box_desc* out) {
  if (!out) return;
  *out = ph_box_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_box_desc));
  out->width = 0.6;
  out->render_type = PH_RENDER_STATIC;
}

extern "C" ph_result PH_CALL ph_plot_add_stem(ph_plot handle, const ph_stem_desc* desc,
                                              ph_layer* out) {
  return add_xy_layer<ph_stem_desc, photon::StemLayer>(handle, desc, out, ph_stem_desc_init,
                                                       "ph_stem_desc");
}

extern "C" void PH_CALL ph_contour_desc_init(ph_contour_desc* out) {
  if (!out) return;
  *out = ph_contour_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_contour_desc));
  out->render_type = PH_RENDER_STATIC;
  // color stays PH_COLOR_AUTO, which the layer reads as "colour each level
  // through the colormap" — the same thing an omitted `color` means in the
  // TypeScript.
}

extern "C" void PH_CALL ph_graph_desc_init(ph_graph_desc* out) {
  if (!out) return;
  *out = ph_graph_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_graph_desc));
  out->node_size = 10.0f;
  out->layout_iterations = 300;
  out->render_type = PH_RENDER_STATIC;
}

extern "C" ph_result PH_CALL ph_plot_add_contour(ph_plot handle, const ph_contour_desc* desc,
                                                 ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_contour_desc.struct_size is larger than this build's");
  }
  const ph_contour_desc normalized = normalize(desc, ph_contour_desc_init);
  if (normalized.cols < 0 || normalized.rows < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "cols and rows must be non-negative");
  }
  if (normalized.cols > 0 && normalized.rows > 0 && !normalized.values) {
    return fail(PH_E_INVALID_ARGUMENT, "values must be non-null when cols and rows are > 0");
  }
  if (normalized.level_count < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "level_count must be non-negative");
  }
  if (normalized.colormap && !desc_size_ok(normalized.colormap)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_colormap_spec.struct_size is larger than this build's");
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::ContourLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating contour layer");
  }
}

extern "C" ph_result PH_CALL ph_plot_add_graph(ph_plot handle, const ph_graph_desc* desc,
                                               ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_graph_desc.struct_size is larger than this build's");
  }
  const ph_graph_desc normalized = normalize(desc, ph_graph_desc_init);
  if (normalized.node_count < 0 || normalized.edge_count < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "node_count and edge_count must be non-negative");
  }
  // One position array without the other is a mistake; neither means "lay the
  // graph out for me", which is a legitimate and useful request.
  if ((normalized.x == nullptr) != (normalized.y == nullptr)) {
    return fail(PH_E_INVALID_ARGUMENT, "x and y must both be given, or both omitted");
  }
  if (normalized.edge_count > 0 && !normalized.edges) {
    return fail(PH_E_INVALID_ARGUMENT, "edges must be non-null when edge_count > 0");
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::GraphLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating graph layer");
  }
}

extern "C" void PH_CALL ph_hexbin_desc_init(ph_hexbin_desc* out) {
  if (!out) return;
  *out = ph_hexbin_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_hexbin_desc));
  out->render_type = PH_RENDER_STATIC;
  // radius and domain stay 0, which the layer reads as "derive them".
}

extern "C" void PH_CALL ph_quiver_desc_init(ph_quiver_desc* out) {
  if (!out) return;
  *out = ph_quiver_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_quiver_desc));
  out->width = 1.5f;
  out->head_size = 9.0f;
  out->render_type = PH_RENDER_STATIC;
}

extern "C" ph_result PH_CALL ph_plot_add_hexbin(ph_plot handle, const ph_hexbin_desc* desc,
                                                ph_layer* out) {
  return add_xy_layer<ph_hexbin_desc, photon::HexbinLayer>(handle, desc, out,
                                                           ph_hexbin_desc_init, "ph_hexbin_desc");
}

extern "C" ph_result PH_CALL ph_plot_add_quiver(ph_plot handle, const ph_quiver_desc* desc,
                                                ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_quiver_desc.struct_size is larger than this build's");
  }
  const ph_quiver_desc normalized = normalize(desc, ph_quiver_desc_init);
  if (normalized.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (normalized.count > 0 && (!normalized.x || !normalized.y || !normalized.u ||
                               !normalized.v)) {
    return fail(PH_E_INVALID_ARGUMENT, "x, y, u and v must be non-null when count > 0");
  }
  if (normalized.color_map && !desc_size_ok(normalized.color_map)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_colormap_spec.struct_size is larger than this build's");
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::QuiverLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating quiver layer");
  }
}

extern "C" void PH_CALL ph_candlestick_desc_init(ph_candlestick_desc* out) {
  if (!out) return;
  *out = ph_candlestick_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_candlestick_desc));
  out->wick_width = 1.5f;
  out->render_type = PH_RENDER_STATIC;
  // width stays 0, which the layer reads as 70% of the median spacing — the
  // same thing an omitted `width` means in the TypeScript.
}

extern "C" void PH_CALL ph_ohlc_desc_init(ph_ohlc_desc* out) {
  if (!out) return;
  *out = ph_ohlc_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_ohlc_desc));
  out->line_width = 1.5f;
  out->render_type = PH_RENDER_STATIC;
}

/// The five OHLC arrays are checked the same way for both layers.
template <typename Desc, typename LayerType>
ph_result add_ohlc_layer(ph_plot handle, const Desc* desc, ph_layer* out,
                         void (PH_CALL* init)(Desc*), const char* type_name) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT,
                std::string(type_name) + ".struct_size is larger than this build's");
  }
  const Desc normalized = normalize(desc, init);
  if (normalized.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (normalized.count > 0 && (!normalized.x || !normalized.open || !normalized.high ||
                               !normalized.low || !normalized.close)) {
    return fail(PH_E_INVALID_ARGUMENT,
                "x, open, high, low and close must be non-null when count > 0");
  }
  try {
    return register_layer(handle, plot, std::make_unique<LayerType>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating an OHLC layer");
  }
}

extern "C" ph_result PH_CALL ph_plot_add_candlestick(ph_plot handle,
                                                     const ph_candlestick_desc* desc,
                                                     ph_layer* out) {
  return add_ohlc_layer<ph_candlestick_desc, photon::CandlestickLayer>(
      handle, desc, out, ph_candlestick_desc_init, "ph_candlestick_desc");
}

extern "C" ph_result PH_CALL ph_plot_add_ohlc(ph_plot handle, const ph_ohlc_desc* desc,
                                              ph_layer* out) {
  return add_ohlc_layer<ph_ohlc_desc, photon::OhlcLayer>(handle, desc, out, ph_ohlc_desc_init,
                                                         "ph_ohlc_desc");
}

extern "C" void PH_CALL ph_heatmap_desc_init(ph_heatmap_desc* out) {
  if (!out) return;
  *out = ph_heatmap_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_heatmap_desc));
  out->render_type = PH_RENDER_STATIC;
  // extent and domain stay empty, which the layer reads as "fit to the data" —
  // the same thing an omitted `domain` means in the TypeScript.
}

extern "C" void PH_CALL ph_image_desc_init(ph_image_desc* out) {
  if (!out) return;
  *out = ph_image_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_image_desc));
  out->opacity = 1.0f;
  out->render_type = PH_RENDER_STATIC;
}

extern "C" ph_result PH_CALL ph_plot_add_heatmap(ph_plot handle, const ph_heatmap_desc* desc,
                                                 ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_heatmap_desc.struct_size is larger than this build's");
  }
  const ph_heatmap_desc normalized = normalize(desc, ph_heatmap_desc_init);
  if (normalized.cols < 0 || normalized.rows < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "cols and rows must be non-negative");
  }
  if (normalized.cols > 0 && normalized.rows > 0 && !normalized.values) {
    return fail(PH_E_INVALID_ARGUMENT, "values must be non-null when cols and rows are > 0");
  }
  if (normalized.colormap && !desc_size_ok(normalized.colormap)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_colormap_spec.struct_size is larger than this build's");
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::HeatmapLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating heatmap layer");
  }
}

extern "C" ph_result PH_CALL ph_plot_add_image(ph_plot handle, const ph_image_desc* desc,
                                               ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_image_desc.struct_size is larger than this build's");
  }
  const ph_image_desc normalized = normalize(desc, ph_image_desc_init);
  if (normalized.width < 0 || normalized.height < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "width and height must be non-negative");
  }
  if (normalized.width > 0 && normalized.height > 0 && !normalized.pixels) {
    return fail(PH_E_INVALID_ARGUMENT, "pixels must be non-null when width and height are > 0");
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::ImageLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating image layer");
  }
}

extern "C" ph_result PH_CALL ph_plot_add_errorbar(ph_plot handle, const ph_errorbar_desc* desc,
                                                  ph_layer* out) {
  return add_xy_layer<ph_errorbar_desc, photon::ErrorBarLayer>(handle, desc, out,
                                                               ph_errorbar_desc_init,
                                                               "ph_errorbar_desc");
}

extern "C" ph_result PH_CALL ph_plot_add_box(ph_plot handle, const ph_box_desc* desc,
                                             ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_box_desc.struct_size is larger than this build's");
  }
  const ph_box_desc normalized = normalize(desc, ph_box_desc_init);
  if (normalized.group_count < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "group_count must be non-negative");
  }
  if (normalized.group_count > 0 && !normalized.groups) {
    return fail(PH_E_INVALID_ARGUMENT, "groups must be non-null when group_count > 0");
  }
  for (int32_t i = 0; i < normalized.group_count; ++i) {
    const ph_box_group& group = normalized.groups[i];
    if (group.count < 0) return fail(PH_E_INVALID_ARGUMENT, "group count must be non-negative");
    if (group.count > 0 && !group.values) {
      return fail(PH_E_INVALID_ARGUMENT, "group values must be non-null when count > 0");
    }
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::BoxLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating box layer");
  }
}

extern "C" ph_result PH_CALL ph_plot_add_patches(ph_plot handle, const ph_patches_desc* desc,
                                                 ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_patches_desc.struct_size is larger than this build's");
  }
  const ph_patches_desc normalized = normalize(desc, ph_patches_desc_init);
  if (normalized.patch_count < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "patch_count must be non-negative");
  }
  if (normalized.patch_count > 0 && !normalized.patches) {
    return fail(PH_E_INVALID_ARGUMENT, "patches must be non-null when patch_count > 0");
  }
  // Checked here rather than skipped in the layer: a ring with a null pointer
  // is a caller mistake, and silently drawing the other patches would hide it.
  for (int32_t i = 0; i < normalized.patch_count; ++i) {
    const ph_patch& patch = normalized.patches[i];
    if (patch.count < 0) return fail(PH_E_INVALID_ARGUMENT, "patch count must be non-negative");
    if (patch.count > 0 && (!patch.x || !patch.y)) {
      return fail(PH_E_INVALID_ARGUMENT, "patch x and y must be non-null when count > 0");
    }
    if (patch.hole_count > 0 && !patch.holes) {
      return fail(PH_E_INVALID_ARGUMENT, "patch holes must be non-null when hole_count > 0");
    }
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::PatchesLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating patches layer");
  }
}

// ---------------------------------------------------------------------------
// Composed charts
// ---------------------------------------------------------------------------

namespace {

namespace charts = photon::charts;

/// A ring, plus the arrays a ph_patch has to point at while the layer copies it.
struct PatchStore {
  std::vector<charts::Ring> rings;
  std::vector<ph_patch> patches;

  void add(charts::Ring ring, ph_color color) {
    rings.push_back(std::move(ring));
    patches.push_back(ph_patch{});
    patches.back().color = color;
  }

  /// Point every patch at its ring. Deferred to here because pushing onto
  /// `rings` reallocates, and a pointer taken before that would dangle.
  const ph_patch* finish() {
    for (size_t i = 0; i < rings.size(); ++i) {
      patches[i].x = rings[i].x.data();
      patches[i].y = rings[i].y.data();
      patches[i].count = static_cast<int32_t>(rings[i].x.size());
    }
    return patches.data();
  }
};

/// An explicit colour, or the palette cycled by index.
ph_color pick_color(ph_color explicit_color, const char* palette, size_t index) {
  if (explicit_color != PH_COLOR_AUTO) return explicit_color;
  return photon::color::palette_color(palette ? palette : "tableau10",
                                      static_cast<int32_t>(index));
}

/**
 * The sunburst and the Sankey do not fall back to tableau10.
 *
 * Both keep their own ten-colour list in the web core rather than reaching for
 * the shared palette, and the two charts look quite different for it — the
 * shared one is muted where these are saturated, which is what a diagram of
 * nested wedges wants. Reproduced here rather than corrected, because a port
 * that quietly improves a default is a port whose output no longer matches.
 */
ph_color pick_vivid(ph_color explicit_color, const char* palette, size_t index) {
  if (explicit_color != PH_COLOR_AUTO) return explicit_color;
  if (palette) return photon::color::palette_color(palette, static_cast<int32_t>(index));
  static const ph_color kVivid[10] = {0x3b82f6ffu, 0xf472b6ffu, 0x22d3eeffu, 0xa3e635ffu,
                                      0xfbbf24ffu, 0xa78bfaffu, 0x34d399ffu, 0xfb7185ffu,
                                      0x60a5faffu, 0xf59e0bffu};
  return kVivid[index % 10];
}

/// The same colour with its alpha scaled, for a ribbon that has to read through.
ph_color with_alpha(ph_color color, double alpha) {
  const uint32_t a = static_cast<uint32_t>(
      std::min(255.0, std::max(0.0, static_cast<double>(color & 0xffu) * alpha + 0.5)));
  return (color & 0xffffff00u) | a;
}

/// A centred caption at a point in data space, which is how every chart in this
/// section names its parts.
void add_label(Plot* plot, double x, double y, const char* text) {
  if (!text) return;
  ph_annotation note{};
  ph_annotation_init(&note);
  note.type = PH_ANNOTATION_LABEL;
  note.x0 = x;
  note.y0 = y;
  note.text = text;
  note.align = PH_ALIGN_CENTER;
  plot->add_annotation(note);
}

/// `lo == hi` means "the caller did not choose", which for a drawing box is 0..1.
void default_extent(ph_range& r, double lo, double hi) {
  if (r.lo == r.hi) {
    r.lo = lo;
    r.hi = hi;
  }
}

/// Every builder ends the same way: one patches layer over the rings it built.
ph_result add_patch_layer(ph_plot handle, Plot* plot, PatchStore& store, float opacity,
                          const char* name, ph_render_type render_type, ph_layer* out) {
  ph_patches_desc patches{};
  ph_patches_desc_init(&patches);
  patches.patches = store.finish();
  patches.patch_count = static_cast<int32_t>(store.patches.size());
  patches.opacity = opacity;
  patches.name = name;
  patches.render_type = render_type;
  try {
    return register_layer(handle, plot, std::make_unique<photon::PatchesLayer>(patches), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the chart layer");
  }
}

}  // namespace

extern "C" void PH_CALL ph_treemap_desc_init(ph_treemap_desc* out) {
  if (!out) return;
  *out = ph_treemap_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_treemap_desc));
}

extern "C" ph_result PH_CALL ph_plot_add_treemap(ph_plot handle, const ph_treemap_desc* desc,
                                                 ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_treemap_desc.struct_size is larger than this build's");
  }
  ph_treemap_desc d = normalize(desc, ph_treemap_desc_init);
  if (d.item_count < 0) return fail(PH_E_INVALID_ARGUMENT, "item_count must be non-negative");
  if (d.item_count > 0 && !d.items) {
    return fail(PH_E_INVALID_ARGUMENT, "items must be non-null when item_count > 0");
  }
  default_extent(d.x, 0.0, 1.0);
  default_extent(d.y, 0.0, 1.0);

  std::vector<double> values(static_cast<size_t>(d.item_count));
  for (int32_t i = 0; i < d.item_count; ++i) values[static_cast<size_t>(i)] = d.items[i].value;
  const std::vector<charts::TreemapCell> cells =
      charts::treemap_layout(values.data(), values.size(), d.x.lo, d.y.lo, d.x.hi, d.y.hi);

  PatchStore store;
  for (size_t i = 0; i < cells.size(); ++i) {
    const charts::TreemapCell& c = cells[i];
    charts::Ring ring;
    ring.x = {c.x0, c.x1, c.x1, c.x0};
    ring.y = {c.y0, c.y0, c.y1, c.y1};
    store.add(std::move(ring), pick_color(d.items[c.item].color, d.palette, i));
  }
  const ph_result added =
      add_patch_layer(handle, plot, store, d.opacity, d.name, d.render_type, out);
  if (added != PH_OK) return added;

  if (!d.no_labels) {
    // A cell smaller than this in either direction has no room for its own
    // name, and a label overflowing its cell reads as belonging to the next one.
    const double min_w = std::abs(d.x.hi - d.x.lo) * 0.04;
    const double min_h = std::abs(d.y.hi - d.y.lo) * 0.04;
    for (const charts::TreemapCell& c : cells) {
      if (std::abs(c.x1 - c.x0) < min_w || std::abs(c.y1 - c.y0) < min_h) continue;
      add_label(plot, (c.x0 + c.x1) / 2.0, (c.y0 + c.y1) / 2.0, d.items[c.item].label);
    }
  }
  return PH_OK;
}

extern "C" void PH_CALL ph_funnel_desc_init(ph_funnel_desc* out) {
  if (!out) return;
  *out = ph_funnel_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_funnel_desc));
}

extern "C" ph_result PH_CALL ph_plot_add_funnel(ph_plot handle, const ph_funnel_desc* desc,
                                                ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_funnel_desc.struct_size is larger than this build's");
  }
  const ph_funnel_desc d = normalize(desc, ph_funnel_desc_init);
  if (d.item_count < 0) return fail(PH_E_INVALID_ARGUMENT, "item_count must be non-negative");
  if (d.item_count > 0 && !d.items) {
    return fail(PH_E_INVALID_ARGUMENT, "items must be non-null when item_count > 0");
  }

  std::vector<double> values(static_cast<size_t>(d.item_count));
  for (int32_t i = 0; i < d.item_count; ++i) values[static_cast<size_t>(i)] = d.items[i].value;
  const std::vector<charts::Ring> stages =
      charts::funnel_layout(values.data(), values.size(), d.width > 0.0 ? d.width : 1.0,
                            d.height > 0.0 ? d.height : 1.0, d.neck > 0.0 ? d.neck : 0.4);

  PatchStore store;
  std::vector<double> mid_y;
  mid_y.reserve(stages.size());
  for (size_t i = 0; i < stages.size(); ++i) {
    mid_y.push_back((stages[i].y[0] + stages[i].y[2]) / 2.0);
    store.add(stages[i], pick_color(d.items[i].color, d.palette, i));
  }
  const ph_result added =
      add_patch_layer(handle, plot, store, d.opacity, d.name, d.render_type, out);
  if (added != PH_OK) return added;

  if (!d.no_labels) {
    for (size_t i = 0; i < mid_y.size(); ++i) add_label(plot, 0.0, mid_y[i], d.items[i].label);
  }
  return PH_OK;
}

extern "C" void PH_CALL ph_sunburst_desc_init(ph_sunburst_desc* out) {
  if (!out) return;
  *out = ph_sunburst_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_sunburst_desc));
}

extern "C" ph_result PH_CALL ph_plot_add_sunburst(ph_plot handle, const ph_sunburst_desc* desc,
                                                  ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_sunburst_desc.struct_size is larger than this build's");
  }
  const ph_sunburst_desc d = normalize(desc, ph_sunburst_desc_init);
  if (d.node_count < 0) return fail(PH_E_INVALID_ARGUMENT, "node_count must be non-negative");
  if (d.node_count > 0 && !d.nodes) {
    return fail(PH_E_INVALID_ARGUMENT, "nodes must be non-null when node_count > 0");
  }
  for (int32_t i = 0; i < d.node_count; ++i) {
    // A parent that comes later would break the single-pass roll-up, and would
    // do it silently, so it is refused rather than reordered.
    if (d.nodes[i].parent >= i) {
      return fail(PH_E_INVALID_ARGUMENT, "a node's parent must come before it in the array");
    }
  }

  std::vector<charts::SunburstNode> nodes(static_cast<size_t>(d.node_count));
  for (int32_t i = 0; i < d.node_count; ++i) {
    nodes[static_cast<size_t>(i)].parent = d.nodes[i].parent;
    nodes[static_cast<size_t>(i)].value = d.nodes[i].value;
  }
  const std::vector<charts::SunburstArc> arcs = charts::sunburst_layout(
      nodes.data(), nodes.size(), d.ring_width > 0.0 ? d.ring_width : 1.0, d.center,
      d.start_angle != 0.0 ? d.start_angle : 1.5707963267948966);

  PatchStore store;
  for (size_t i = 0; i < arcs.size(); ++i) {
    if (arcs[i].a1 - arcs[i].a0 <= 0.0) continue;
    store.add(charts::arc_ring(arcs[i].a0, arcs[i].a1, arcs[i].r0, arcs[i].r1),
              pick_vivid(d.nodes[arcs[i].node].color, d.palette, i));
  }
  return add_patch_layer(handle, plot, store, d.opacity, d.name, d.render_type, out);
}

extern "C" void PH_CALL ph_sankey_desc_init(ph_sankey_desc* out) {
  if (!out) return;
  *out = ph_sankey_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_sankey_desc));
}

extern "C" ph_result PH_CALL ph_plot_add_sankey(ph_plot handle, const ph_sankey_desc* desc,
                                                ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_sankey_desc.struct_size is larger than this build's");
  }
  ph_sankey_desc d = normalize(desc, ph_sankey_desc_init);
  if (d.node_count < 0 || d.link_count < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "node_count and link_count must be non-negative");
  }
  if (d.node_count > 0 && !d.nodes) {
    return fail(PH_E_INVALID_ARGUMENT, "nodes must be non-null when node_count > 0");
  }
  if (d.link_count > 0 && !d.links) {
    return fail(PH_E_INVALID_ARGUMENT, "links must be non-null when link_count > 0");
  }
  default_extent(d.x, 0.0, 1.0);
  default_extent(d.y, 0.0, 1.0);

  std::vector<charts::SankeyLink> links(static_cast<size_t>(d.link_count));
  for (int32_t i = 0; i < d.link_count; ++i) {
    links[static_cast<size_t>(i)].source = d.links[i].source;
    links[static_cast<size_t>(i)].target = d.links[i].target;
    links[static_cast<size_t>(i)].value = d.links[i].value;
  }
  const charts::SankeyLayout layout = charts::sankey_layout(
      static_cast<size_t>(d.node_count), links.data(), links.size(), d.x.lo, d.y.lo, d.x.hi,
      d.y.hi, d.node_width > 0.0 ? d.node_width : 0.02,
      d.node_padding > 0.0 ? d.node_padding : 0.02);

  const auto node_color = [&](size_t i) { return pick_vivid(d.nodes[i].color, d.palette, i); };
  const double ribbon_alpha = d.ribbon_opacity > 0.0f ? static_cast<double>(d.ribbon_opacity) : 0.5;

  PatchStore store;
  // Ribbons first, so the node rectangles sit on top of the flows they carry.
  for (size_t i = 0; i < layout.ribbons.size(); ++i) {
    const size_t source = static_cast<size_t>(d.links[layout.ribbon_link[i]].source);
    store.add(layout.ribbons[i], with_alpha(node_color(source), ribbon_alpha));
  }
  for (const charts::NodeRect& n : layout.nodes) {
    charts::Ring ring;
    ring.x = {n.x0, n.x1, n.x1, n.x0};
    ring.y = {n.y0, n.y0, n.y1, n.y1};
    store.add(std::move(ring), node_color(n.node));
  }
  const ph_result added =
      add_patch_layer(handle, plot, store, d.opacity, d.name, d.render_type, out);
  if (added != PH_OK) return added;

  if (!d.no_labels) {
    for (const charts::NodeRect& n : layout.nodes) {
      add_label(plot, (n.x0 + n.x1) / 2.0, (n.y0 + n.y1) / 2.0, d.nodes[n.node].name);
    }
  }
  return PH_OK;
}

extern "C" void PH_CALL ph_chord_desc_init(ph_chord_desc* out) {
  if (!out) return;
  *out = ph_chord_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_chord_desc));
}

extern "C" ph_result PH_CALL ph_plot_add_chord(ph_plot handle, const ph_chord_desc* desc,
                                               ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_chord_desc.struct_size is larger than this build's");
  }
  const ph_chord_desc d = normalize(desc, ph_chord_desc_init);
  if (d.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (d.count > 0 && !d.matrix) {
    return fail(PH_E_INVALID_ARGUMENT, "matrix must be non-null when count > 0");
  }
  const double radius = d.radius > 0.0 ? d.radius : 1.0;
  const charts::ChordLayout layout = charts::chord_layout(
      d.matrix, static_cast<size_t>(d.count), radius,
      d.pad_angle > 0.0 ? d.pad_angle : 0.6283185307179586,
      d.arc_width > 0.0 ? d.arc_width : 0.06);
  const double alpha = d.ribbon_opacity > 0.0f ? static_cast<double>(d.ribbon_opacity) : 0.65;

  PatchStore store;
  // Ribbons under, opaque group arcs over.
  for (size_t i = 0; i < layout.ribbons.size(); ++i) {
    store.add(layout.ribbons[i],
              with_alpha(pick_color(PH_COLOR_AUTO, d.palette, layout.ribbon_from[i]), alpha));
  }
  for (size_t i = 0; i < layout.arcs.size(); ++i) {
    store.add(layout.arcs[i], pick_color(PH_COLOR_AUTO, d.palette, layout.arc_group[i]));
  }
  const ph_result added = add_patch_layer(handle, plot, store, 0.0f, d.name, d.render_type, out);
  if (added != PH_OK) return added;

  if (d.labels && d.label_count > 0) {
    const double label_r = radius * 1.08;
    for (size_t i = 0; i < layout.group_mid.size() && i < static_cast<size_t>(d.label_count); ++i) {
      add_label(plot, label_r * std::cos(layout.group_mid[i]),
                label_r * std::sin(layout.group_mid[i]), d.labels[i]);
    }
  }
  return PH_OK;
}

extern "C" void PH_CALL ph_gauge_desc_init(ph_gauge_desc* out) {
  if (!out) return;
  *out = ph_gauge_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_gauge_desc));
}

extern "C" ph_result PH_CALL ph_plot_add_gauge(ph_plot handle, const ph_gauge_desc* desc,
                                               ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_gauge_desc.struct_size is larger than this build's");
  }
  const ph_gauge_desc d = normalize(desc, ph_gauge_desc_init);
  if (d.threshold_count < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "threshold_count must be non-negative");
  }
  if (d.threshold_count > 0 && !d.thresholds) {
    return fail(PH_E_INVALID_ARGUMENT, "thresholds must be non-null when threshold_count > 0");
  }

  const double max = d.max != 0.0 ? d.max : 100.0;
  const charts::GaugeLayout geo =
      charts::gauge_layout(d.value, d.min, max, d.start_angle != 0.0 ? d.start_angle : 200.0,
                           d.end_angle != 0.0 ? d.end_angle : -20.0,
                           d.radius > 0.0 ? d.radius : 1.0,
                           d.inner_radius > 0.0 ? d.inner_radius : 0.7);

  // The highest threshold the value reaches wins, which is why this is a scan
  // rather than a lookup: the bands need not arrive sorted.
  ph_color value_color = d.color != PH_COLOR_AUTO ? d.color : 0x3b82f6ffu;
  double best = -std::numeric_limits<double>::infinity();
  for (int32_t i = 0; i < d.threshold_count; ++i) {
    if (d.value >= d.thresholds[i].value && d.thresholds[i].value >= best) {
      best = d.thresholds[i].value;
      value_color = d.thresholds[i].color;
    }
  }

  PatchStore store;
  store.add(geo.track, d.track_color != PH_COLOR_AUTO ? d.track_color : 0xe5e7ebffu);
  store.add(geo.value, value_color);
  store.add(geo.needle, d.needle_color != PH_COLOR_AUTO ? d.needle_color : 0x334155ffu);
  const ph_result added = add_patch_layer(handle, plot, store, 0.0f, d.name, d.render_type, out);
  if (added != PH_OK) return added;

  if (!d.no_label) {
    // Without a caption the number is nowhere: the arc says "about here" and
    // the needle says "exactly here", and neither says what "here" is.
    std::string text;
    if (d.label) {
      text = d.label;
    } else {
      char buffer[32];
      const std::to_chars_result written =
          std::to_chars(buffer, buffer + sizeof(buffer), d.value);
      text.assign(buffer, written.ec == std::errc() ? written.ptr : buffer);
    }
    add_label(plot, 0.0, -0.15, text.c_str());
  }
  return PH_OK;
}

extern "C" void PH_CALL ph_parallel_desc_init(ph_parallel_desc* out) {
  if (!out) return;
  *out = ph_parallel_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_parallel_desc));
}

extern "C" ph_result PH_CALL ph_plot_add_parallel(ph_plot handle, const ph_parallel_desc* desc,
                                                  ph_layer* out_layers, int32_t capacity,
                                                  int32_t* out_count) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_parallel_desc.struct_size is larger than this build's");
  }
  const ph_parallel_desc d = normalize(desc, ph_parallel_desc_init);
  if (d.dim_count < 0 || d.row_count < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "dim_count and row_count must be non-negative");
  }
  if (d.dim_count > 0 && d.row_count > 0 && !d.rows) {
    return fail(PH_E_INVALID_ARGUMENT, "rows must be non-null when there is data");
  }
  *out_count = d.row_count;
  if (capacity == 0) return PH_OK;
  if (!out_layers) return fail(PH_E_INVALID_ARGUMENT, "out_layers must be non-null");

  const charts::ParallelLayout layout = charts::parallel_layout(
      d.rows, static_cast<size_t>(d.row_count), static_cast<size_t>(d.dim_count));

  // The colour ramp's bounds, when rows are banded by a value rather than
  // cycled by index.
  double cb_lo = std::numeric_limits<double>::infinity();
  double cb_hi = -cb_lo;
  if (d.color_by) {
    for (int32_t i = 0; i < d.row_count; ++i) {
      if (!std::isfinite(d.color_by[i])) continue;
      cb_lo = std::min(cb_lo, d.color_by[i]);
      cb_hi = std::max(cb_hi, d.color_by[i]);
    }
  }
  const double cb_span = cb_hi - cb_lo;
  constexpr int32_t kBands = 10;  // the palettes are ten deep

  std::vector<double> axis_x(static_cast<size_t>(d.dim_count));
  for (int32_t i = 0; i < d.dim_count; ++i) axis_x[static_cast<size_t>(i)] = i;
  const float alpha = d.opacity > 0.0f ? d.opacity : 0.7f;

  const size_t writable = std::min(static_cast<size_t>(d.row_count), static_cast<size_t>(capacity));
  for (size_t row = 0; row < writable; ++row) {
    size_t band = row;
    if (d.color_by && std::isfinite(cb_lo)) {
      const double v = d.color_by[row];
      const double t = (!std::isfinite(v) || cb_span == 0.0) ? 0.0 : (v - cb_lo) / cb_span;
      band = static_cast<size_t>(
          std::min(kBands - 1, std::max(0, static_cast<int32_t>(t * kBands))));
    }
    ph_line_desc line{};
    ph_line_desc_init(&line);
    line.x = axis_x.data();
    line.y = layout.lines[row].data();
    line.count = d.dim_count;
    line.color = with_alpha(pick_color(PH_COLOR_AUTO, d.palette, band), alpha);
    line.width = d.width > 0.0f ? d.width : 1.0f;
    line.render_type = d.render_type;
    if (row == 0) line.name = d.name;
    ph_layer layer = PH_NULL_HANDLE;
    try {
      const ph_result added =
          register_layer(handle, plot, std::make_unique<photon::LineLayer>(line), &layer);
      if (added != PH_OK) return added;
    } catch (const std::bad_alloc&) {
      return fail(PH_E_OUT_OF_MEMORY, "out of memory creating a parallel-coordinates line");
    }
    out_layers[row] = layer;
  }

  if (!d.no_axes) {
    for (int32_t i = 0; i < d.dim_count; ++i) {
      ph_annotation note{};
      ph_annotation_init(&note);
      note.type = PH_ANNOTATION_SPAN;
      note.dim = PH_DIM_X;
      note.x0 = i;
      plot->add_annotation(note);
      if (d.dimensions) add_label(plot, i, 1.0, d.dimensions[i]);
    }
  }
  return PH_OK;
}

extern "C" void PH_CALL ph_grouped_bar_desc_init(ph_grouped_bar_desc* out) {
  if (!out) return;
  *out = ph_grouped_bar_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_grouped_bar_desc));
}

extern "C" void PH_CALL ph_stacked_desc_init(ph_stacked_desc* out) {
  if (!out) return;
  *out = ph_stacked_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_stacked_desc));
}

extern "C" void PH_CALL ph_histogram_desc_init(ph_histogram_desc* out) {
  if (!out) return;
  *out = ph_histogram_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_histogram_desc));
}

extern "C" void PH_CALL ph_spectrogram_desc_init(ph_spectrogram_desc* out) {
  if (!out) return;
  *out = ph_spectrogram_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_spectrogram_desc));
}

namespace {

/// Shared validation for the three multi-series builders.
ph_result check_series_set(const double* x, int32_t count, const ph_series* series,
                           int32_t series_count, int32_t capacity, const int32_t* out_count) {
  if (!out_count) return fail(PH_E_INVALID_ARGUMENT, "out_count must be non-null");
  if (capacity < 0) return fail(PH_E_INVALID_ARGUMENT, "capacity must be non-negative");
  if (count < 0 || series_count < 0) {
    return fail(PH_E_INVALID_ARGUMENT, "count and series_count must be non-negative");
  }
  if (count > 0 && !x) return fail(PH_E_INVALID_ARGUMENT, "x must be non-null when count > 0");
  if (series_count > 0 && !series) {
    return fail(PH_E_INVALID_ARGUMENT, "series must be non-null when series_count > 0");
  }
  for (int32_t i = 0; i < series_count; ++i) {
    if (count > 0 && !series[i].y) {
      return fail(PH_E_INVALID_ARGUMENT, "every series needs a y when count > 0");
    }
  }
  return PH_OK;
}

}  // namespace

extern "C" ph_result PH_CALL ph_plot_add_grouped_bars(ph_plot handle,
                                                      const ph_grouped_bar_desc* desc,
                                                      ph_layer* out_layers, int32_t capacity,
                                                      int32_t* out_count) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT,
                "ph_grouped_bar_desc.struct_size is larger than this build's");
  }
  const ph_grouped_bar_desc d = normalize(desc, ph_grouped_bar_desc_init);
  const ph_result checked =
      check_series_set(d.x, d.count, d.series, d.series_count, capacity, out_count);
  if (checked != PH_OK) return checked;
  *out_count = d.series_count;
  if (capacity == 0) return PH_OK;
  if (!out_layers) return fail(PH_E_INVALID_ARGUMENT, "out_layers must be non-null");

  const double group_width = d.group_width > 0.0 ? d.group_width : 0.8;
  const double slot = d.series_count > 0 ? group_width / d.series_count : group_width;
  const double bar_width = slot * (1.0 - (d.gap > 0.0 ? d.gap : 0.1));
  const size_t writable =
      std::min(static_cast<size_t>(d.series_count), static_cast<size_t>(capacity));
  for (size_t s = 0; s < writable; ++s) {
    ph_bar_desc bar{};
    ph_bar_desc_init(&bar);
    bar.x = d.x;
    bar.y = d.series[s].y;
    bar.count = d.count;
    bar.width = bar_width;
    // Symmetric about zero, so the cluster is centred on its category.
    bar.offset = (static_cast<double>(s) - (d.series_count - 1) / 2.0) * slot;
    bar.color = d.series[s].color;
    bar.name = d.series[s].name;
    bar.orientation = d.orientation;
    bar.y_axis = d.y_axis;
    bar.render_type = d.render_type;
    try {
      const ph_result added =
          register_layer(handle, plot, std::make_unique<photon::BarLayer>(bar), &out_layers[s]);
      if (added != PH_OK) return added;
    } catch (const std::bad_alloc&) {
      return fail(PH_E_OUT_OF_MEMORY, "out of memory creating a grouped bar layer");
    }
  }
  return PH_OK;
}

namespace {

/**
 * The stacking itself, shared by the bar and area forms: each series is drawn
 * from the running total of the ones before it, so `base` is where the previous
 * series stopped and `top` is where this one ends.
 */
struct Stack {
  std::vector<double> base;
  std::vector<double> top;
};

void advance_stack(Stack& stack, std::vector<double>& running, const double* y, size_t count) {
  stack.base = running;
  stack.top.assign(count, 0.0);
  for (size_t i = 0; i < count; ++i) {
    stack.top[i] = running[i] + (y ? y[i] : 0.0);
    running[i] = stack.top[i];
  }
}

}  // namespace

extern "C" ph_result PH_CALL ph_plot_add_stacked_bars(ph_plot handle, const ph_stacked_desc* desc,
                                                      ph_layer* out_layers, int32_t capacity,
                                                      int32_t* out_count) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_stacked_desc.struct_size is larger than this build's");
  }
  const ph_stacked_desc d = normalize(desc, ph_stacked_desc_init);
  const ph_result checked =
      check_series_set(d.x, d.count, d.series, d.series_count, capacity, out_count);
  if (checked != PH_OK) return checked;
  *out_count = d.series_count;
  if (capacity == 0) return PH_OK;
  if (!out_layers) return fail(PH_E_INVALID_ARGUMENT, "out_layers must be non-null");

  const size_t n = static_cast<size_t>(d.count);
  std::vector<double> running(n, 0.0);
  Stack stack;
  const size_t writable =
      std::min(static_cast<size_t>(d.series_count), static_cast<size_t>(capacity));
  for (size_t s = 0; s < writable; ++s) {
    advance_stack(stack, running, d.series[s].y, n);
    ph_bar_desc bar{};
    ph_bar_desc_init(&bar);
    bar.x = d.x;
    bar.y = stack.top.data();
    bar.base = stack.base.data();
    bar.count = d.count;
    bar.width = d.width;
    bar.color = d.series[s].color;
    bar.name = d.series[s].name;
    bar.orientation = d.orientation;
    bar.y_axis = d.y_axis;
    bar.render_type = d.render_type;
    try {
      const ph_result added =
          register_layer(handle, plot, std::make_unique<photon::BarLayer>(bar), &out_layers[s]);
      if (added != PH_OK) return added;
    } catch (const std::bad_alloc&) {
      return fail(PH_E_OUT_OF_MEMORY, "out of memory creating a stacked bar layer");
    }
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_add_stacked_area(ph_plot handle, const ph_stacked_desc* desc,
                                                      ph_layer* out_layers, int32_t capacity,
                                                      int32_t* out_count) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_stacked_desc.struct_size is larger than this build's");
  }
  const ph_stacked_desc d = normalize(desc, ph_stacked_desc_init);
  const ph_result checked =
      check_series_set(d.x, d.count, d.series, d.series_count, capacity, out_count);
  if (checked != PH_OK) return checked;
  *out_count = d.series_count;
  if (capacity == 0) return PH_OK;
  if (!out_layers) return fail(PH_E_INVALID_ARGUMENT, "out_layers must be non-null");

  const size_t n = static_cast<size_t>(d.count);
  std::vector<double> running(n, 0.0);
  Stack stack;
  const size_t writable =
      std::min(static_cast<size_t>(d.series_count), static_cast<size_t>(capacity));
  for (size_t s = 0; s < writable; ++s) {
    advance_stack(stack, running, d.series[s].y, n);
    ph_area_desc area{};
    ph_area_desc_init(&area);
    area.x = d.x;
    area.y = stack.top.data();
    area.base = stack.base.data();
    area.count = d.count;
    area.color = d.series[s].color;
    area.name = d.series[s].name;
    area.y_axis = d.y_axis;
    area.render_type = d.render_type;
    try {
      const ph_result added =
          register_layer(handle, plot, std::make_unique<photon::AreaLayer>(area), &out_layers[s]);
      if (added != PH_OK) return added;
    } catch (const std::bad_alloc&) {
      return fail(PH_E_OUT_OF_MEMORY, "out of memory creating a stacked area layer");
    }
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_add_histogram(ph_plot handle, const ph_histogram_desc* desc,
                                                   ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_histogram_desc.struct_size is larger than this build's");
  }
  const ph_histogram_desc d = normalize(desc, ph_histogram_desc_init);
  const ph_result checked = check_series(d.values, d.count, "values");
  if (checked != PH_OK) return checked;

  const photon::stats::Histogram h = photon::stats::histogram(
      d.values, static_cast<size_t>(d.count), d.bins, d.range.lo, d.range.hi);
  ph_bar_desc bar{};
  ph_bar_desc_init(&bar);
  bar.x = h.centers.data();
  bar.y = h.counts.data();
  bar.count = static_cast<int32_t>(h.counts.size());
  // Just under the bin width, so the bars touch without overlapping.
  bar.width = h.bin_width * 0.98;
  bar.color = d.color;
  bar.name = d.name;
  bar.y_axis = d.y_axis;
  bar.render_type = d.render_type;
  try {
    return register_layer(handle, plot, std::make_unique<photon::BarLayer>(bar), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the histogram layer");
  }
}

extern "C" ph_result PH_CALL ph_plot_add_spectrogram(ph_plot handle,
                                                     const ph_spectrogram_desc* desc,
                                                     ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT,
                "ph_spectrogram_desc.struct_size is larger than this build's");
  }
  const ph_spectrogram_desc d = normalize(desc, ph_spectrogram_desc_init);
  const ph_result checked = check_series(d.signal, d.count, "signal");
  if (checked != PH_OK) return checked;
  const int32_t size = d.fft_size > 0 ? d.fft_size : 256;
  if (size < 2 || (size & (size - 1)) != 0) {
    return fail(PH_E_INVALID_ARGUMENT, "fft_size must be a power of two of at least 2");
  }

  const photon::stats::Spectrogram s = photon::stats::spectrogram(
      d.signal, static_cast<size_t>(d.count), size, d.hop,
      d.sample_rate > 0.0 ? d.sample_rate : 1.0);
  ph_colormap_spec plasma{};
  ph_colormap_spec_init(&plasma);
  plasma.name = "plasma";
  ph_heatmap_desc heatmap{};
  ph_heatmap_desc_init(&heatmap);
  heatmap.values = s.values.data();
  heatmap.cols = static_cast<int32_t>(s.cols);
  heatmap.rows = static_cast<int32_t>(s.rows);
  heatmap.x = ph_range{s.x0, s.x1};
  heatmap.y = ph_range{s.y0, s.y1};
  heatmap.colormap = d.colormap ? d.colormap : &plasma;
  heatmap.name = d.name;
  heatmap.y_axis = d.y_axis;
  heatmap.render_type = d.render_type;
  try {
    return register_layer(handle, plot, std::make_unique<photon::HeatmapLayer>(heatmap), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the spectrogram layer");
  }
}

// ---------------------------------------------------------------------------
// Polar
// ---------------------------------------------------------------------------

extern "C" void PH_CALL ph_polar_config_init(ph_polar_config* out) {
  if (!out) return;
  *out = ph_polar_config{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_polar_config));
}

extern "C" void PH_CALL ph_polar_line_desc_init(ph_polar_line_desc* out) {
  if (!out) return;
  *out = ph_polar_line_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_polar_line_desc));
}

extern "C" void PH_CALL ph_polar_scatter_desc_init(ph_polar_scatter_desc* out) {
  if (!out) return;
  *out = ph_polar_scatter_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_polar_scatter_desc));
}

extern "C" ph_result PH_CALL ph_plot_set_polar(ph_plot handle, const ph_polar_config* config) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (config && !desc_size_ok(config)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_polar_config.struct_size is larger than this build's");
  }
  const ph_polar_config c = normalize(config, ph_polar_config_init);
  Plot::PolarConfig polar;
  polar.enabled = c.enabled != 0;
  polar.degrees = c.degrees != 0;
  polar.max_radius = c.max_radius;
  polar.rotation = c.rotation;
  polar.spoke_step = c.spoke_step;
  plot->set_polar(polar);
  return PH_OK;
}

namespace {

/// The (theta, r) pair every polar builder takes, checked once.
ph_result check_polar(const double* theta, const double* r, int32_t count) {
  if (count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (count > 0 && (!theta || !r)) {
    return fail(PH_E_INVALID_ARGUMENT, "theta and r must be non-null when count > 0");
  }
  return PH_OK;
}

/// Record what a layer was built from, so a later rotation can re-project it.
void attach_polar(Plot* plot, ph_layer handle, const double* theta, const double* r,
                  int32_t count, bool closed) {
  Plot* owner = nullptr;
  photon::Layer* layer = nullptr;
  if (photon::resolve_layer(handle, &owner, &layer) != PH_OK) return;
  layer->polar.theta.assign(theta, theta + count);
  layer->polar.r.assign(r, r + count);
  layer->polar.closed = closed;
  plot->refit_polar();
}

}  // namespace

extern "C" ph_result PH_CALL ph_plot_add_polar_line(ph_plot handle,
                                                    const ph_polar_line_desc* desc,
                                                    ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT,
                "ph_polar_line_desc.struct_size is larger than this build's");
  }
  const ph_polar_line_desc d = normalize(desc, ph_polar_line_desc_init);
  const ph_result checked = check_polar(d.theta, d.r, d.count);
  if (checked != PH_OK) return checked;

  std::vector<double> xs;
  std::vector<double> ys;
  plot->project_polar(d.theta, d.r, static_cast<size_t>(d.count), d.closed != 0, xs, ys);
  ph_line_desc line{};
  ph_line_desc_init(&line);
  line.x = xs.data();
  line.y = ys.data();
  line.count = static_cast<int32_t>(xs.size());
  line.color = d.color;
  line.width = d.width > 0.0f ? d.width : 2.0f;
  line.dash = d.dash;
  line.dash_count = d.dash_count;
  line.name = d.name;
  line.render_type = d.render_type;
  // A polar series is short and already resampled by whatever produced it;
  // decimation assumes a monotonic x, which a spiral does not have.
  line.no_decimate = 1;
  try {
    const ph_result added =
        register_layer(handle, plot, std::make_unique<photon::LineLayer>(line), out);
    if (added != PH_OK) return added;
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating polar line layer");
  }
  attach_polar(plot, *out, d.theta, d.r, d.count, d.closed != 0);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_add_polar_scatter(ph_plot handle,
                                                       const ph_polar_scatter_desc* desc,
                                                       ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT,
                "ph_polar_scatter_desc.struct_size is larger than this build's");
  }
  const ph_polar_scatter_desc d = normalize(desc, ph_polar_scatter_desc_init);
  const ph_result checked = check_polar(d.theta, d.r, d.count);
  if (checked != PH_OK) return checked;

  std::vector<double> xs;
  std::vector<double> ys;
  plot->project_polar(d.theta, d.r, static_cast<size_t>(d.count), false, xs, ys);
  ph_scatter_desc scatter{};
  ph_scatter_desc_init(&scatter);
  scatter.x = xs.data();
  scatter.y = ys.data();
  scatter.count = d.count;
  scatter.color = d.color;
  scatter.size = d.size > 0.0f ? d.size : 5.0f;
  scatter.sizes = d.sizes;
  scatter.colors = d.colors;
  scatter.marker = d.marker;
  scatter.name = d.name;
  scatter.render_type = d.render_type;
  try {
    const ph_result added =
        register_layer(handle, plot, std::make_unique<photon::ScatterLayer>(scatter), out);
    if (added != PH_OK) return added;
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating polar scatter layer");
  }
  attach_polar(plot, *out, d.theta, d.r, d.count, false);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_layer_set_polar(ph_layer handle, const double* theta,
                                                const double* r, int32_t count) {
  clear_error();
  Plot* plot = nullptr;
  photon::Layer* layer = nullptr;
  const ph_result resolved = photon::resolve_layer(handle, &plot, &layer);
  if (resolved != PH_OK) return resolved;
  const ph_result checked = check_polar(theta, r, count);
  if (checked != PH_OK) return checked;
  if (layer->polar.theta.empty() && count > 0 && !dynamic_cast<photon::XYLayer*>(layer)) {
    return fail(PH_E_INVALID_ARGUMENT, "this layer is not a polar line or scatter");
  }
  const bool closed = layer->polar.closed;
  layer->polar.theta.assign(theta, theta + count);
  layer->polar.r.assign(r, r + count);
  layer->polar.closed = closed;
  // The re-projection and the re-fit are the same ones a rotation does.
  plot->refit_polar();
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_add_scatter(ph_plot handle, const ph_scatter_desc* desc, ph_layer* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_scatter_desc.struct_size is larger than this build's");
  }
  const ph_scatter_desc normalized = normalize(desc, ph_scatter_desc_init);
  if (normalized.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (normalized.count > 0 && (!normalized.x || !normalized.y)) {
    return fail(PH_E_INVALID_ARGUMENT, "x and y must be non-null when count > 0");
  }
  if (normalized.color_map && !desc_size_ok(normalized.color_map)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_colormap_spec.struct_size is larger than this build's");
  }
  try {
    return register_layer(handle, plot, std::make_unique<photon::ScatterLayer>(normalized), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating scatter layer");
  }
}

extern "C" ph_result PH_CALL ph_layer_set_xy(ph_layer handle, const double* x, const double* y, int32_t count) {
  clear_error();
  Plot* plot = nullptr;
  photon::Layer* layer = nullptr;
  const ph_result r = photon::resolve_layer(handle, &plot, &layer);
  if (r != PH_OK) return r;
  if (count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (count > 0 && (!x || !y)) return fail(PH_E_INVALID_ARGUMENT, "x and y must be non-null when count > 0");
  auto* xy = dynamic_cast<photon::XYLayer*>(layer);
  if (!xy) return fail(PH_E_UNSUPPORTED, "this layer type has no x/y pair");
  xy->set_xy(x, y, static_cast<size_t>(count));
  plot->autoscale();
  return PH_OK;
}

namespace {

/// The shared body of every ph_layer_set_<name>: resolve, validate the header,
/// hand the whole descriptor to the layer.
template <typename Desc, typename LayerType, typename InitFn>
ph_result set_layer_data(ph_layer handle, const Desc* desc, InitFn init, const char* type_name) {
  clear_error();
  Plot* plot = nullptr;
  photon::Layer* layer = nullptr;
  const ph_result r = photon::resolve_layer(handle, &plot, &layer);
  if (r != PH_OK) return r;
  auto* typed = dynamic_cast<LayerType*>(layer);
  if (!typed) {
    return fail(PH_E_INVALID_ARGUMENT,
                std::string("this layer is not a ") + type_name + " layer");
  }
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT,
                std::string(type_name) + ".struct_size is larger than this build's");
  }
  const Desc normalized = normalize(desc, init);
  try {
    typed->set_data(normalized);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory replacing layer data");
  }
  // The axes follow the new data the way they follow a ph_layer_set_xy.
  plot->autoscale();
  plot->request_render();
  return PH_OK;
}

}  // namespace

extern "C" ph_result PH_CALL ph_layer_set_area(ph_layer handle, const ph_area_desc* desc) {
  return set_layer_data<ph_area_desc, photon::AreaLayer>(handle, desc, ph_area_desc_init, "ph_area_desc");
}

extern "C" ph_result PH_CALL ph_layer_set_bar(ph_layer handle, const ph_bar_desc* desc) {
  return set_layer_data<ph_bar_desc, photon::BarLayer>(handle, desc, ph_bar_desc_init, "ph_bar_desc");
}

extern "C" ph_result PH_CALL ph_layer_set_errorbar(ph_layer handle, const ph_errorbar_desc* desc) {
  return set_layer_data<ph_errorbar_desc, photon::ErrorBarLayer>(handle, desc, ph_errorbar_desc_init, "ph_errorbar_desc");
}

extern "C" ph_result PH_CALL ph_layer_set_candlestick(ph_layer handle, const ph_candlestick_desc* desc) {
  return set_layer_data<ph_candlestick_desc, photon::CandlestickLayer>(handle, desc, ph_candlestick_desc_init, "ph_candlestick_desc");
}

extern "C" ph_result PH_CALL ph_layer_set_ohlc(ph_layer handle, const ph_ohlc_desc* desc) {
  return set_layer_data<ph_ohlc_desc, photon::OhlcLayer>(handle, desc, ph_ohlc_desc_init, "ph_ohlc_desc");
}

extern "C" ph_result PH_CALL ph_layer_set_heatmap(ph_layer handle, const ph_heatmap_desc* desc) {
  return set_layer_data<ph_heatmap_desc, photon::HeatmapLayer>(handle, desc, ph_heatmap_desc_init, "ph_heatmap_desc");
}

extern "C" ph_result PH_CALL ph_layer_set_hexbin(ph_layer handle, const ph_hexbin_desc* desc) {
  return set_layer_data<ph_hexbin_desc, photon::HexbinLayer>(handle, desc, ph_hexbin_desc_init, "ph_hexbin_desc");
}

extern "C" ph_result PH_CALL ph_layer_set_quiver(ph_layer handle, const ph_quiver_desc* desc) {
  return set_layer_data<ph_quiver_desc, photon::QuiverLayer>(handle, desc, ph_quiver_desc_init, "ph_quiver_desc");
}

extern "C" ph_result PH_CALL ph_layer_set_contour(ph_layer handle, const ph_contour_desc* desc) {
  return set_layer_data<ph_contour_desc, photon::ContourLayer>(handle, desc, ph_contour_desc_init, "ph_contour_desc");
}

extern "C" ph_result PH_CALL ph_layer_set_visible(ph_layer handle, ph_bool visible) {
  clear_error();
  photon::plot3d::Plot3D* scene = nullptr;
  photon::plot3d::Layer3D* layer3d = nullptr;
  if (photon::resolve_layer3d(handle, &scene, &layer3d) == PH_OK) {
    clear_error();
    layer3d->set_visible(visible != 0);
    scene->refit();
    return PH_OK;
  }
  clear_error();
  Plot* plot = nullptr;
  photon::Layer* layer = nullptr;
  const ph_result r = photon::resolve_layer(handle, &plot, &layer);
  if (r != PH_OK) return r;
  layer->set_visible(visible != 0);
  plot->autoscale();  // axes re-fit to what is left, matching the web core
  return PH_OK;
}

extern "C" ph_bool PH_CALL ph_layer_valid(ph_layer handle) {
  Plot* plot = nullptr;
  photon::Layer* layer = nullptr;
  if (photon::resolve_layer(handle, &plot, &layer) == PH_OK) return 1;
  photon::plot3d::Plot3D* scene = nullptr;
  photon::plot3d::Layer3D* layer3d = nullptr;
  return photon::resolve_layer3d(handle, &scene, &layer3d) == PH_OK ? 1 : 0;
}

extern "C" ph_result PH_CALL ph_layer_bounds(ph_layer handle, ph_range* x, ph_range* y) {
  clear_error();
  Plot* plot = nullptr;
  photon::Layer* layer = nullptr;
  const ph_result r = photon::resolve_layer(handle, &plot, &layer);
  if (r != PH_OK) return r;
  if (!x || !y) return fail(PH_E_INVALID_ARGUMENT, "x and y must be non-null");
  if (!layer->bounds(*x, *y)) return fail(PH_E_UNSUPPORTED, "layer holds no finite data");
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_layer_destroy(ph_layer handle) {
  clear_error();
  if (handle == PH_NULL_HANDLE) return PH_OK;
  // A 3-D layer comes out of the same table, so this call serves both.
  photon::plot3d::Plot3D* scene = nullptr;
  photon::plot3d::Layer3D* layer3d = nullptr;
  if (photon::resolve_layer3d(handle, &scene, &layer3d) == PH_OK) {
    clear_error();
    auto& handles3d = scene->layer_handles;
    handles3d.erase(std::remove(handles3d.begin(), handles3d.end(), handle), handles3d.end());
    Registry::get().layers.erase(handle);
    Registry& registry = Registry::get();
    scene->remove_layer(layer3d, registry.gl.ready ? &registry.gl : nullptr);
    return PH_OK;
  }
  clear_error();
  Plot* plot = nullptr;
  photon::Layer* layer = nullptr;
  const ph_result r = photon::resolve_layer(handle, &plot, &layer);
  if (r != PH_OK) return r;
  auto& handles = plot->layer_handles;
  handles.erase(std::remove(handles.begin(), handles.end(), handle), handles.end());
  Registry::get().layers.erase(handle);
  plot->remove_layer(layer);
  return PH_OK;
}

// ---------------------------------------------------------------------------
// 3-D
// ---------------------------------------------------------------------------

namespace {

namespace p3d = photon::plot3d;

ph_result resolve_plot3d(ph_plot3d handle, p3d::Plot3D** out) {
  const ph_result init = require_init();
  if (init != PH_OK) return init;
  p3d::Plot3D* plot = Registry::get().plots3d.get(handle);
  if (!plot) return fail(PH_E_INVALID_HANDLE, "3-D plot handle is stale or invalid");
  *out = plot;
  return PH_OK;
}

/// The 3-D twin of register_layer: same table, same handle type, so
/// ph_layer_destroy and ph_layer_set_visible work on either kind.
ph_result register_layer3d(ph_plot3d plot_handle, p3d::Plot3D* plot,
                           std::unique_ptr<p3d::Layer3D> layer, ph_layer* out) {
  p3d::Layer3D* borrowed = plot->add_layer(std::move(layer));
  auto ref = std::make_unique<LayerRef>();
  ref->plot3d = plot_handle;
  ref->layer3d = borrowed;
  const ph_layer handle = Registry::get().layers.insert(std::move(ref));
  borrowed->handle = handle;
  plot->layer_handles.push_back(handle);
  *out = handle;
  return PH_OK;
}

/// Rendering is the one place a 3-D plot must be on the thread that made it,
/// for exactly the reason the 2-D one must: the GL context belongs to a thread.
ph_result check_render_thread3d(const p3d::Plot3D* plot) {
  if (plot->owner() != std::this_thread::get_id()) {
    return fail(PH_E_WRONG_THREAD,
                "a 3-D plot must be rendered on the thread that created it");
  }
  return PH_OK;
}

}  // namespace

extern "C" void PH_CALL ph_plot3d_desc_init(ph_plot3d_desc* out) {
  if (!out) return;
  *out = ph_plot3d_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_plot3d_desc));
  out->width = 640;
  out->height = 420;
  out->theme = PH_THEME_DARK;
  out->azimuth = 0.7;
  out->elevation = 0.5;
  out->distance = 3.6;
}

extern "C" ph_result PH_CALL ph_plot3d_create(const ph_plot3d_desc* desc, ph_plot3d* out) {
  clear_error();
  const ph_result init = require_init();
  if (init != PH_OK) return init;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  *out = PH_NULL_HANDLE;
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_plot3d_desc.struct_size is larger than this build's");
  }
  const ph_plot3d_desc d = normalize(desc, ph_plot3d_desc_init);
  try {
    *out = Registry::get().plots3d.insert(std::make_unique<p3d::Plot3D>(d));
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the 3-D plot");
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_destroy(ph_plot3d handle) {
  clear_error();
  if (handle == PH_NULL_HANDLE) return PH_OK;
  const ph_result init = require_init();
  if (init != PH_OK) return init;
  Registry& registry = Registry::get();
  p3d::Plot3D* plot = registry.plots3d.get(handle);
  if (!plot) return fail(PH_E_INVALID_HANDLE, "3-D plot handle is stale or invalid");
  // The layer handles go first: they point at a scene that is about to vanish.
  for (const ph_layer layer : plot->layer_handles) registry.layers.erase(layer);
  if (registry.gl.ready) plot->release_gl(registry.gl);
  registry.plots3d.erase(handle);
  return PH_OK;
}

extern "C" ph_bool PH_CALL ph_plot3d_valid(ph_plot3d handle) {
  p3d::Plot3D* plot = nullptr;
  const bool ok = resolve_plot3d(handle, &plot) == PH_OK;
  clear_error();
  return ok ? 1 : 0;
}

extern "C" ph_result PH_CALL ph_plot3d_set_size(ph_plot3d handle, int32_t width, int32_t height) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (width <= 0 || height <= 0) return fail(PH_E_INVALID_ARGUMENT, "size must be positive");
  plot->set_size(width, height);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_set_theme(ph_plot3d handle, ph_theme theme) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  plot->set_theme(theme);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_set_title(ph_plot3d handle, const char* title) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  plot->set_title(title);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_set_axis_labels(ph_plot3d handle, const char* x,
                                                       const char* y, const char* z) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  plot->set_axis_labels(x, y, z);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_set_camera(ph_plot3d handle, double azimuth,
                                                  double elevation, double distance) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  plot->set_camera(azimuth, elevation, distance);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_get_camera(ph_plot3d handle, double* out_azimuth,
                                                  double* out_elevation, double* out_distance) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  double azimuth = 0.0;
  double elevation = 0.0;
  double distance = 0.0;
  plot->get_camera(azimuth, elevation, distance);
  if (out_azimuth) *out_azimuth = azimuth;
  if (out_elevation) *out_elevation = elevation;
  if (out_distance) *out_distance = distance;
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_set_light(ph_plot3d handle, float x, float y, float z,
                                                 float ambient) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  p3d::Light light = plot->light();
  light.x = x;
  light.y = y;
  light.z = z;
  light.ambient = ambient;
  plot->set_light(light);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_reset_view(ph_plot3d handle) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  plot->reset_view();
  return PH_OK;
}

extern "C" void PH_CALL ph_surface_desc_init(ph_surface_desc* out) {
  if (!out) return;
  *out = ph_surface_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_surface_desc));
}

extern "C" ph_result PH_CALL ph_plot3d_add_surface(ph_plot3d handle, const ph_surface_desc* desc,
                                                   ph_layer* out) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_surface_desc.struct_size is larger than this build's");
  }
  const ph_surface_desc d = normalize(desc, ph_surface_desc_init);
  if (d.cols < 2 || d.rows < 2) {
    return fail(PH_E_INVALID_ARGUMENT, "a surface needs at least a 2x2 grid");
  }
  if (!d.values) return fail(PH_E_INVALID_ARGUMENT, "values must be non-null");
  try {
    return register_layer3d(handle, plot, std::make_unique<p3d::SurfaceLayer>(d), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the surface layer");
  }
}

extern "C" void PH_CALL ph_pointcloud_desc_init(ph_pointcloud_desc* out) {
  if (!out) return;
  *out = ph_pointcloud_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_pointcloud_desc));
}

extern "C" ph_result PH_CALL ph_plot3d_add_pointcloud(ph_plot3d handle,
                                                      const ph_pointcloud_desc* desc,
                                                      ph_layer* out) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT,
                "ph_pointcloud_desc.struct_size is larger than this build's");
  }
  const ph_pointcloud_desc d = normalize(desc, ph_pointcloud_desc_init);
  if (d.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (d.count > 0 && (!d.x || !d.y || !d.z)) {
    return fail(PH_E_INVALID_ARGUMENT, "x, y and z must be non-null when count > 0");
  }
  try {
    return register_layer3d(handle, plot, std::make_unique<p3d::PointCloudLayer>(d), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the point cloud layer");
  }
}

extern "C" void PH_CALL ph_line3d_desc_init(ph_line3d_desc* out) {
  if (!out) return;
  *out = ph_line3d_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_line3d_desc));
}

extern "C" ph_result PH_CALL ph_plot3d_add_line(ph_plot3d handle, const ph_line3d_desc* desc,
                                                ph_layer* out) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_line3d_desc.struct_size is larger than this build's");
  }
  const ph_line3d_desc d = normalize(desc, ph_line3d_desc_init);
  if (d.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (d.count > 0 && (!d.x || !d.y || !d.z)) {
    return fail(PH_E_INVALID_ARGUMENT, "x, y and z must be non-null when count > 0");
  }
  try {
    return register_layer3d(handle, plot, std::make_unique<p3d::Line3DLayer>(d), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the 3-D line layer");
  }
}

extern "C" void PH_CALL ph_bar3d_desc_init(ph_bar3d_desc* out) {
  if (!out) return;
  *out = ph_bar3d_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_bar3d_desc));
}

extern "C" ph_result PH_CALL ph_plot3d_add_bars(ph_plot3d handle, const ph_bar3d_desc* desc,
                                                ph_layer* out) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_bar3d_desc.struct_size is larger than this build's");
  }
  const ph_bar3d_desc d = normalize(desc, ph_bar3d_desc_init);
  if (d.cols < 1 || d.rows < 1) return fail(PH_E_INVALID_ARGUMENT, "cols and rows must be positive");
  if (!d.values) return fail(PH_E_INVALID_ARGUMENT, "values must be non-null");
  try {
    return register_layer3d(handle, plot, std::make_unique<p3d::Bar3DLayer>(d), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the 3-D bar layer");
  }
}

extern "C" void PH_CALL ph_quiver3d_desc_init(ph_quiver3d_desc* out) {
  if (!out) return;
  *out = ph_quiver3d_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_quiver3d_desc));
}

extern "C" ph_result PH_CALL ph_plot3d_add_quiver(ph_plot3d handle, const ph_quiver3d_desc* desc,
                                                  ph_layer* out) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_quiver3d_desc.struct_size is larger than this build's");
  }
  const ph_quiver3d_desc d = normalize(desc, ph_quiver3d_desc_init);
  if (d.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (d.count > 0 && (!d.x || !d.y || !d.z || !d.u || !d.v || !d.w)) {
    return fail(PH_E_INVALID_ARGUMENT,
                "all six of x, y, z, u, v and w must be non-null when count > 0");
  }
  try {
    return register_layer3d(handle, plot, std::make_unique<p3d::Line3DLayer>(d), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the 3-D quiver layer");
  }
}

extern "C" void PH_CALL ph_contour3d_desc_init(ph_contour3d_desc* out) {
  if (!out) return;
  *out = ph_contour3d_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_contour3d_desc));
}

extern "C" ph_result PH_CALL ph_plot3d_add_contour(ph_plot3d handle,
                                                   const ph_contour3d_desc* desc, ph_layer* out) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_contour3d_desc.struct_size is larger than this build's");
  }
  const ph_contour3d_desc d = normalize(desc, ph_contour3d_desc_init);
  if (d.cols < 2 || d.rows < 2) {
    return fail(PH_E_INVALID_ARGUMENT, "a contour needs at least a 2x2 grid");
  }
  if (!d.values) return fail(PH_E_INVALID_ARGUMENT, "values must be non-null");
  if (d.level_count < 0) return fail(PH_E_INVALID_ARGUMENT, "level_count must be non-negative");
  if (d.level_count > 0 && !d.level_values) {
    return fail(PH_E_INVALID_ARGUMENT, "level_values must be non-null when level_count > 0");
  }
  try {
    return register_layer3d(handle, plot, std::make_unique<p3d::Contour3DLayer>(d), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the 3-D contour layer");
  }
}

extern "C" void PH_CALL ph_boxes3d_desc_init(ph_boxes3d_desc* out) {
  if (!out) return;
  *out = ph_boxes3d_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_boxes3d_desc));
}

extern "C" ph_result PH_CALL ph_plot3d_add_boxes(ph_plot3d handle, const ph_boxes3d_desc* desc,
                                                 ph_layer* out) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_boxes3d_desc.struct_size is larger than this build's");
  }
  const ph_boxes3d_desc d = normalize(desc, ph_boxes3d_desc_init);
  if (d.count < 0) return fail(PH_E_INVALID_ARGUMENT, "count must be non-negative");
  if (d.count > 0 && !d.boxes) {
    return fail(PH_E_INVALID_ARGUMENT, "boxes must be non-null when count > 0");
  }
  try {
    return register_layer3d(handle, plot, std::make_unique<p3d::Boxes3DLayer>(d), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the 3-D box layer");
  }
}

extern "C" void PH_CALL ph_isosurface_desc_init(ph_isosurface_desc* out) {
  if (!out) return;
  *out = ph_isosurface_desc{};
  out->struct_size = static_cast<uint32_t>(sizeof(ph_isosurface_desc));
}

extern "C" ph_result PH_CALL ph_plot3d_add_isosurface(ph_plot3d handle,
                                                      const ph_isosurface_desc* desc,
                                                      ph_layer* out) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  if (desc && !desc_size_ok(desc)) {
    return fail(PH_E_INVALID_ARGUMENT,
                "ph_isosurface_desc.struct_size is larger than this build's");
  }
  const ph_isosurface_desc d = normalize(desc, ph_isosurface_desc_init);
  if (d.nx < 2 || d.ny < 2 || d.nz < 2) {
    return fail(PH_E_INVALID_ARGUMENT, "a volume needs at least two samples on every axis");
  }
  if (!d.values) return fail(PH_E_INVALID_ARGUMENT, "values must be non-null");
  try {
    return register_layer3d(handle, plot, std::make_unique<p3d::IsosurfaceLayer>(d), out);
  } catch (const std::bad_alloc&) {
    return fail(PH_E_OUT_OF_MEMORY, "out of memory creating the isosurface layer");
  }
}

extern "C" ph_result PH_CALL ph_plot3d_pointer_down(ph_plot3d handle, double px, double py,
                                                    ph_button button, ph_modifiers mods) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  (void)button;
  (void)mods;
  plot->pointer_down(px, py);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_pointer_move(ph_plot3d handle, double px, double py,
                                                    ph_modifiers mods) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  (void)mods;
  plot->pointer_move(px, py);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_pointer_up(ph_plot3d handle, double px, double py,
                                                  ph_button button, ph_modifiers mods) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  (void)px;
  (void)py;
  (void)button;
  (void)mods;
  plot->pointer_up();
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_wheel(ph_plot3d handle, double px, double py,
                                             double delta_y, ph_modifiers mods) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  (void)px;
  (void)py;
  (void)mods;
  plot->wheel(delta_y);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_render(ph_plot3d handle, const ph_frame_target* target) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!target) return fail(PH_E_INVALID_ARGUMENT, "target must be non-null");
  if (!desc_size_ok(target)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_frame_target.struct_size is larger than this build's");
  }
  r = check_render_thread3d(plot);
  if (r != PH_OK) return r;
  r = ensure_gl_loaded();
  if (r != PH_OK) return r;
  const ph_frame_target normalized = normalize(target, ph_frame_target_init);
  Registry& registry = Registry::get();
  std::string error;
  if (!plot->render(registry.gl, registry.host.api, normalized, error)) {
    return fail(PH_E_GL, error);
  }
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_render_pixels(ph_plot3d handle, int32_t width,
                                                     int32_t height, float dpr, uint8_t* out_rgba,
                                                     int32_t stride_bytes) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (width <= 0 || height <= 0) return fail(PH_E_INVALID_ARGUMENT, "size must be positive");
  if (!out_rgba) return fail(PH_E_INVALID_ARGUMENT, "out_rgba must be non-null");
  if (stride_bytes < width * 4) {
    return fail(PH_E_INVALID_ARGUMENT, "stride_bytes must be at least width * 4");
  }
  r = check_render_thread3d(plot);
  if (r != PH_OK) return r;
  r = ensure_gl_loaded();
  if (r != PH_OK) return r;
  Registry& registry = Registry::get();
  std::string error;
  if (!plot->render_pixels(registry.gl, registry.host.api, width, height,
                           dpr > 0.0f ? dpr : 1.0f, out_rgba, stride_bytes, error)) {
    return fail(PH_E_GL, error);
  }
  return PH_OK;
}

extern "C" ph_bool PH_CALL ph_plot3d_needs_redraw(ph_plot3d handle) {
  p3d::Plot3D* plot = nullptr;
  const bool ok = resolve_plot3d(handle, &plot) == PH_OK;
  clear_error();
  return ok && plot->needs_redraw() ? 1 : 0;
}

extern "C" ph_result PH_CALL ph_plot3d_poll_event(ph_plot3d handle, ph_event* out) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  plot->poll_event(*out);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot3d_clear_events(ph_plot3d handle) {
  clear_error();
  p3d::Plot3D* plot = nullptr;
  const ph_result r = resolve_plot3d(handle, &plot);
  if (r != PH_OK) return r;
  plot->clear_events();
  return PH_OK;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

extern "C" ph_result PH_CALL ph_plot_set_mode(ph_plot handle, ph_mode mode) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (mode < PH_MODE_PAN || mode > PH_MODE_BOX_Y) {
    return fail(PH_E_INVALID_ARGUMENT, "mode is out of range");
  }
  plot->set_mode(mode);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_get_mode(ph_plot handle, ph_mode* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  *out = plot->mode();
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_pointer_down(ph_plot handle, double px, double py,
                                                  ph_button button, ph_modifiers mods) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->pointer_down(px, py, button, mods);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_pointer_move(ph_plot handle, double px, double py, ph_modifiers mods) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->pointer_move(px, py, mods);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_pointer_up(ph_plot handle, double px, double py,
                                                ph_button button, ph_modifiers mods) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->pointer_up(px, py, button, mods);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_pointer_leave(ph_plot handle) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->pointer_leave();
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_wheel(ph_plot handle, double px, double py,
                                           double delta_y, ph_modifiers mods) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->wheel(px, py, delta_y, mods);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_pan_pixels(ph_plot handle, double dx, double dy) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->pan_pixels(dx, dy);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_zoom_around(ph_plot handle, double nx, double ny, double factor) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!(factor > 0.0)) return fail(PH_E_INVALID_ARGUMENT, "factor must be positive");
  plot->zoom_around(nx, ny, factor);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_data_at_pixel(ph_plot handle, double px, double py,
                                                   double* out_x, double* out_y) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out_x || !out_y) return fail(PH_E_INVALID_ARGUMENT, "out_x and out_y must be non-null");
  plot->data_at_pixel(px, py, *out_x, *out_y);
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_pixel_at_data(ph_plot handle, double x, double y,
                                                   double* out_px, double* out_py) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out_px || !out_py) return fail(PH_E_INVALID_ARGUMENT, "out_px and out_py must be non-null");
  plot->pixel_at_data(x, y, *out_px, *out_py);
  return PH_OK;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

extern "C" ph_result PH_CALL ph_plot_render(ph_plot handle, const ph_frame_target* target) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!target) return fail(PH_E_INVALID_ARGUMENT, "target must be non-null");
  if (!desc_size_ok(target)) {
    return fail(PH_E_INVALID_ARGUMENT, "ph_frame_target.struct_size is larger than this build's");
  }
  if (plot->owner_thread() != std::this_thread::get_id()) {
    return fail(PH_E_WRONG_THREAD,
                "a plot must be rendered on the thread that created it — its GL context is current there");
  }
  const ph_result gl = ensure_gl_loaded();
  if (gl != PH_OK) return gl;

  const ph_frame_target normalized = normalize(target, ph_frame_target_init);
  Registry& registry = Registry::get();
  std::string error;
  if (!plot->render(registry.gl, registry.host.api, normalized, error)) {
    return fail(PH_E_GL, std::move(error));
  }
  plot->mark_drawn();
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_render_pixels(ph_plot handle, int32_t width, int32_t height,
                                                   float dpr, uint8_t* out_rgba, int32_t stride_bytes) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out_rgba) return fail(PH_E_INVALID_ARGUMENT, "out_rgba must be non-null");
  if (width <= 0 || height <= 0) return fail(PH_E_INVALID_ARGUMENT, "width and height must be positive");
  if (stride_bytes < width * 4) {
    return fail(PH_E_INVALID_ARGUMENT, "stride_bytes must be at least width * 4");
  }
  if (plot->owner_thread() != std::this_thread::get_id()) {
    return fail(PH_E_WRONG_THREAD,
                "a plot must be rendered on the thread that created it — its GL context is current there");
  }
  const ph_result gl = ensure_gl_loaded();
  if (gl != PH_OK) return gl;

  Registry& registry = Registry::get();
  std::string error;
  if (!plot->render_pixels(registry.gl, registry.host.api, width, height, dpr, out_rgba,
                           stride_bytes, error)) {
    return fail(PH_E_GL, std::move(error));
  }
  plot->mark_drawn();
  return PH_OK;
}

extern "C" ph_bool PH_CALL ph_plot_needs_redraw(ph_plot handle) {
  Plot* plot = nullptr;
  if (resolve_plot(handle, &plot) != PH_OK) return 0;
  return plot->needs_redraw() ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

extern "C" ph_result PH_CALL ph_plot_poll_event(ph_plot handle, ph_event* out) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  if (!out) return fail(PH_E_INVALID_ARGUMENT, "out must be non-null");
  plot->poll_event(*out);  // leaves type == PH_EVENT_NONE when the queue is empty
  return PH_OK;
}

extern "C" ph_result PH_CALL ph_plot_clear_events(ph_plot handle) {
  clear_error();
  Plot* plot = nullptr;
  const ph_result r = resolve_plot(handle, &plot);
  if (r != PH_OK) return r;
  plot->clear_events();
  return PH_OK;
}
