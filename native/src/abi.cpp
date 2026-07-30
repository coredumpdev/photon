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
#include <cmath>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <thread>
#include <vector>

#include "color/colormap.hpp"
#include "error.hpp"
#include "finance/indicators.hpp"
#include "finance/transforms.hpp"
#include "layer.hpp"
#include "plot.hpp"
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
    photon::text::release_atlas_gl(registry.gl);
    photon::gl::clear_program_cache(registry.gl);
  }
  // Layers first: their refs point at plots that are about to go away.
  registry.layers.clear();
  registry.plots.clear();
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
  if (*s != '#') {
    // rgb()/rgba()/named colors arrive with the text renderer in Faz 1, which is
    // where a real CSS color parser has to exist anyway.
    return fail(PH_E_UNSUPPORTED, "only #rgb, #rgba, #rrggbb and #rrggbbaa are parsed in this build");
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
  return photon::resolve_layer(handle, &plot, &layer) == PH_OK ? 1 : 0;
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
