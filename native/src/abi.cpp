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
#include "layer.hpp"
#include "plot.hpp"
#include "registry.hpp"
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
  if (normalized.color_by) {
    // Accepting this and quietly drawing every point in one colour is the
    // blank-chart failure mode by another name. Say what is missing instead.
    return fail(PH_E_UNSUPPORTED,
                "colorBy needs the colormap tables, which arrive in Faz 4; pass per-point "
                "`colors` for now");
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
