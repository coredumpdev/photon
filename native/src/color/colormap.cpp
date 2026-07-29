#include "color/colormap.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <mutex>

namespace photon::color {
namespace {

/// The anchors, transcribed from ANCHORS in colormap.ts. Coarse on purpose:
/// eleven points interpolated linearly is what the web core samples, so the
/// tables have to be built from the same numbers or the two pictures differ by
/// a shade nobody can attribute.
struct Builtin {
  const char* name;
  std::vector<Rgb> anchors;
};

const std::vector<Builtin>& builtins() {
  static const std::vector<Builtin> kBuiltins = {
      {"viridis",
       {{0.267f, 0.005f, 0.329f}, {0.283f, 0.141f, 0.458f}, {0.254f, 0.265f, 0.53f},
        {0.207f, 0.372f, 0.553f}, {0.164f, 0.471f, 0.558f}, {0.128f, 0.567f, 0.551f},
        {0.135f, 0.659f, 0.518f}, {0.267f, 0.749f, 0.441f}, {0.478f, 0.821f, 0.318f},
        {0.741f, 0.873f, 0.15f}, {0.993f, 0.906f, 0.144f}}},
      {"plasma",
       {{0.05f, 0.03f, 0.53f}, {0.29f, 0.01f, 0.63f}, {0.49f, 0.01f, 0.66f},
        {0.66f, 0.13f, 0.59f}, {0.8f, 0.28f, 0.47f}, {0.9f, 0.43f, 0.35f},
        {0.97f, 0.6f, 0.24f}, {0.99f, 0.78f, 0.15f}, {0.94f, 0.98f, 0.13f}}},
      {"inferno",
       {{0.001f, 0.000f, 0.014f}, {0.113f, 0.045f, 0.226f}, {0.267f, 0.051f, 0.327f},
        {0.417f, 0.090f, 0.328f}, {0.578f, 0.148f, 0.284f}, {0.735f, 0.216f, 0.212f},
        {0.865f, 0.317f, 0.126f}, {0.951f, 0.462f, 0.043f}, {0.988f, 0.645f, 0.040f},
        {0.964f, 0.843f, 0.273f}, {0.988f, 0.998f, 0.645f}}},
      {"magma",
       {{0.001f, 0.000f, 0.014f}, {0.107f, 0.047f, 0.222f}, {0.255f, 0.059f, 0.367f},
        {0.400f, 0.096f, 0.451f}, {0.550f, 0.145f, 0.470f}, {0.702f, 0.196f, 0.446f},
        {0.847f, 0.267f, 0.380f}, {0.945f, 0.396f, 0.331f}, {0.986f, 0.559f, 0.415f},
        {0.997f, 0.727f, 0.545f}, {0.987f, 0.991f, 0.749f}}},
      {"cividis",
       {{0.000f, 0.135f, 0.305f}, {0.000f, 0.204f, 0.396f}, {0.086f, 0.273f, 0.432f},
        {0.243f, 0.339f, 0.428f}, {0.353f, 0.406f, 0.437f}, {0.447f, 0.474f, 0.458f},
        {0.542f, 0.545f, 0.469f}, {0.647f, 0.620f, 0.446f}, {0.760f, 0.699f, 0.399f},
        {0.879f, 0.783f, 0.320f}, {0.995f, 0.875f, 0.203f}}},
      {"turbo",
       {{0.190f, 0.072f, 0.232f}, {0.276f, 0.394f, 0.858f}, {0.144f, 0.678f, 0.933f},
        {0.070f, 0.886f, 0.706f}, {0.336f, 0.982f, 0.404f}, {0.694f, 0.994f, 0.184f},
        {0.917f, 0.870f, 0.196f}, {0.995f, 0.646f, 0.203f}, {0.958f, 0.372f, 0.106f},
        {0.812f, 0.166f, 0.024f}, {0.480f, 0.016f, 0.011f}}},
      {"grayscale", {{0.05f, 0.05f, 0.05f}, {0.95f, 0.95f, 0.95f}}},
      {"coolwarm",
       {{0.23f, 0.3f, 0.75f}, {0.55f, 0.69f, 0.98f}, {0.87f, 0.87f, 0.87f},
        {0.96f, 0.6f, 0.48f}, {0.71f, 0.02f, 0.15f}}},
      {"RdBu",
       {{0.404f, 0.000f, 0.121f}, {0.698f, 0.094f, 0.168f}, {0.839f, 0.376f, 0.302f},
        {0.957f, 0.647f, 0.510f}, {0.992f, 0.859f, 0.780f}, {0.969f, 0.969f, 0.969f},
        {0.820f, 0.898f, 0.941f}, {0.573f, 0.773f, 0.871f}, {0.262f, 0.576f, 0.765f},
        {0.129f, 0.400f, 0.674f}, {0.019f, 0.188f, 0.380f}}},
      {"BrBG",
       {{0.329f, 0.188f, 0.020f}, {0.549f, 0.317f, 0.039f}, {0.749f, 0.506f, 0.176f},
        {0.875f, 0.761f, 0.490f}, {0.965f, 0.910f, 0.764f}, {0.961f, 0.961f, 0.961f},
        {0.780f, 0.918f, 0.898f}, {0.502f, 0.804f, 0.757f}, {0.208f, 0.592f, 0.561f},
        {0.004f, 0.400f, 0.369f}, {0.000f, 0.235f, 0.188f}}},
      {"spectral",
       {{0.620f, 0.004f, 0.259f}, {0.835f, 0.243f, 0.310f}, {0.957f, 0.427f, 0.263f},
        {0.992f, 0.682f, 0.380f}, {0.996f, 0.878f, 0.545f}, {1.000f, 1.000f, 0.749f},
        {0.902f, 0.961f, 0.596f}, {0.671f, 0.867f, 0.643f}, {0.400f, 0.761f, 0.647f},
        {0.196f, 0.533f, 0.741f}, {0.369f, 0.310f, 0.635f}}},
      {"twilight",
       {{0.886f, 0.851f, 0.887f}, {0.657f, 0.749f, 0.869f}, {0.400f, 0.596f, 0.784f},
        {0.243f, 0.427f, 0.663f}, {0.196f, 0.259f, 0.478f}, {0.180f, 0.129f, 0.239f},
        {0.318f, 0.114f, 0.216f}, {0.518f, 0.180f, 0.271f}, {0.694f, 0.325f, 0.353f},
        {0.831f, 0.545f, 0.518f}, {0.886f, 0.851f, 0.887f}}},
  };
  return kBuiltins;
}

struct BuiltinPalette {
  const char* name;
  std::vector<ph_color> colors;
};

const std::vector<BuiltinPalette>& builtin_palettes() {
  static const std::vector<BuiltinPalette> kPalettes = {
      {"tableau10",
       {0x4e79a7ffu, 0xf28e2bffu, 0xe15759ffu, 0x76b7b2ffu, 0x59a14fffu, 0xedc948ffu,
        0xb07aa1ffu, 0xff9da7ffu, 0x9c755fffu, 0xbab0acffu}},
      {"okabe-ito",
       {0x0072b2ffu, 0xe69f00ffu, 0x009e73ffu, 0xcc79a7ffu, 0x56b4e9ffu, 0xd55e00ffu,
        0xf0e442ffu, 0x000000ffu}},
      {"set2",
       {0x66c2a5ffu, 0xfc8d62ffu, 0x8da0cbffu, 0xe78ac3ffu, 0xa6d854ffu, 0xffd92fffu,
        0xe5c494ffu, 0xb3b3b3ffu}},
      {"bright",
       {0x60a5faffu, 0xf472b6ffu, 0x34d399ffu, 0xfbbf24ffu, 0xa78bfaffu, 0x22d3eeffu,
        0xfb923cffu, 0xf87171ffu, 0xc084fcffu, 0x4ade80ffu}},
  };
  return kPalettes;
}

/// The registries and their lock. One mutex covers both, because they are only
/// touched when a layer is built or a host asks what exists — never per frame.
std::mutex& registry_mutex() {
  static std::mutex mutex;
  return mutex;
}

/// Registration order matters: `colormap_names` promises built-ins first.
std::vector<std::string>& custom_colormap_order() {
  static std::vector<std::string> order;
  return order;
}

std::map<std::string, std::vector<Rgb>>& custom_colormaps() {
  static std::map<std::string, std::vector<Rgb>> maps;
  return maps;
}

/// Bumped when a name is re-registered. It goes into the cache key rather than
/// erasing the stale table, because `lut()` hands out a reference that a render
/// thread may still be holding — a cache that only grows can never dangle, and
/// it grows once per registration, not once per frame.
std::map<std::string, uint64_t>& colormap_versions() {
  static std::map<std::string, uint64_t> versions;
  return versions;
}

std::vector<std::string>& custom_palette_order() {
  static std::vector<std::string> order;
  return order;
}

std::map<std::string, std::vector<ph_color>>& custom_palettes() {
  static std::map<std::string, std::vector<ph_color>> palettes;
  return palettes;
}

/// Anchors for a name, or viridis when there are none. Caller holds the lock.
const std::vector<Rgb>& anchors_for(const std::string& name) {
  const auto& custom = custom_colormaps();
  const auto found = custom.find(name);
  if (found != custom.end()) return found->second;
  for (const Builtin& builtin : builtins()) {
    if (name == builtin.name) return builtin.anchors;
  }
  return builtins().front().anchors;  // viridis
}

Lut build(const std::vector<Rgb>& anchors) {
  Lut out{};
  if (anchors.empty()) return out;
  if (anchors.size() == 1) {
    for (size_t s = 0; s < kLutSize; ++s) {
      out[s * 3] = anchors[0].r;
      out[s * 3 + 1] = anchors[0].g;
      out[s * 3 + 2] = anchors[0].b;
    }
    return out;
  }
  const size_t last = anchors.size() - 1;
  for (size_t s = 0; s < kLutSize; ++s) {
    const double pos = (static_cast<double>(s) / static_cast<double>(kLutSize - 1)) *
                       static_cast<double>(last);
    const size_t i = std::min(last - 1, static_cast<size_t>(std::floor(pos)));
    const float f = static_cast<float>(pos - static_cast<double>(i));
    const Rgb& a = anchors[i];
    const Rgb& b = anchors[i + 1];
    out[s * 3] = a.r + (b.r - a.r) * f;
    out[s * 3 + 1] = a.g + (b.g - a.g) * f;
    out[s * 3 + 2] = a.b + (b.b - a.b) * f;
  }
  return out;
}

Lut reverse_of(const Lut& table) {
  Lut out{};
  for (size_t s = 0; s < kLutSize; ++s) {
    const size_t src = (kLutSize - 1 - s) * 3;
    out[s * 3] = table[src];
    out[s * 3 + 1] = table[src + 1];
    out[s * 3 + 2] = table[src + 2];
  }
  return out;
}

/// Flatten a table into `steps` bands, sampling each band at its centre value
/// the way discreteColormap does — so band k is the colour at k/(n-1).
Lut quantize(const Lut& table, int32_t steps) {
  Lut out{};
  const int32_t n = std::max(1, steps);
  for (size_t s = 0; s < kLutSize; ++s) {
    const double t = static_cast<double>(s) / static_cast<double>(kLutSize - 1);
    const int32_t band = std::min(n - 1, static_cast<int32_t>(t * n));
    const double at = n == 1 ? 0.5 : static_cast<double>(band) / static_cast<double>(n - 1);
    const Rgb c = sample(table, at);
    out[s * 3] = c.r;
    out[s * 3 + 1] = c.g;
    out[s * 3 + 2] = c.b;
  }
  return out;
}

/// Caller holds the lock.
std::string cache_key(const Spec& spec) {
  std::string key;
  if (spec.stops.empty()) {
    key = spec.name;
    const auto version = colormap_versions().find(spec.name);
    if (version != colormap_versions().end()) {
      key += "\x01v" + std::to_string(version->second);
    }
  } else {
    // A leading NUL so an inline ramp can never collide with a name.
    key.push_back('\0');
    for (const Rgb& stop : spec.stops) {
      key += std::to_string(stop.r) + "," + std::to_string(stop.g) + "," +
             std::to_string(stop.b) + "|";
    }
  }
  if (spec.reverse) key += "\x01r";
  if (spec.discrete_steps > 0) key += "\x01d" + std::to_string(spec.discrete_steps);
  return key;
}

}  // namespace

Rgb to_rgb(ph_color color) {
  return Rgb{static_cast<float>((color >> 24) & 0xFFu) / 255.0f,
             static_cast<float>((color >> 16) & 0xFFu) / 255.0f,
             static_cast<float>((color >> 8) & 0xFFu) / 255.0f};
}

Rgb sample(const Lut& table, double t) {
  // NaN fails both comparisons, so it has to be caught before it becomes an
  // index. JavaScript's `(NaN * 255) | 0` is 0, which lands on the low end —
  // matching that is cheaper to explain than a third behaviour.
  const double c = (!std::isfinite(t) || t <= 0.0) ? 0.0 : (t >= 1.0 ? 1.0 : t);
  const size_t j = static_cast<size_t>(c * static_cast<double>(kLutSize - 1)) * 3;
  return Rgb{table[j], table[j + 1], table[j + 2]};
}

const Lut& lut(const Spec& spec) {
  static std::map<std::string, Lut> cache;
  const std::lock_guard<std::mutex> guard(registry_mutex());

  const std::string key = cache_key(spec);
  const auto found = cache.find(key);
  if (found != cache.end()) return found->second;

  Lut table = build(spec.stops.empty() ? anchors_for(spec.name) : spec.stops);
  if (spec.reverse) table = reverse_of(table);
  if (spec.discrete_steps > 0) table = quantize(table, spec.discrete_steps);
  return cache.emplace(key, table).first->second;
}

Rgb sample(const Spec& spec, double t) {
  return sample(lut(spec), t);
}

bool register_colormap(const std::string& name, const std::vector<Rgb>& stops) {
  if (name.empty() || stops.size() < 2) return false;
  const std::lock_guard<std::mutex> guard(registry_mutex());
  if (custom_colormaps().find(name) == custom_colormaps().end()) {
    custom_colormap_order().push_back(name);
  }
  custom_colormaps()[name] = stops;
  ++colormap_versions()[name];
  return true;
}

std::vector<std::string> colormap_names() {
  const std::lock_guard<std::mutex> guard(registry_mutex());
  std::vector<std::string> names;
  names.reserve(builtins().size() + custom_colormap_order().size());
  for (const Builtin& builtin : builtins()) names.emplace_back(builtin.name);
  for (const std::string& name : custom_colormap_order()) {
    // A registration that replaced a built-in must not appear twice.
    if (std::find(names.begin(), names.end(), name) == names.end()) names.push_back(name);
  }
  return names;
}

ph_range symmetric_domain(const double* values, size_t count, double center) {
  double reach = 0.0;
  if (values) {
    for (size_t i = 0; i < count; ++i) {
      const double d = std::abs(values[i] - center);
      if (d > reach && std::isfinite(d)) reach = d;
    }
  }
  if (reach == 0.0) reach = 1.0;
  return ph_range{center - reach, center + reach};
}

bool register_palette(const std::string& name, const std::vector<ph_color>& colors) {
  if (name.empty() || colors.empty()) return false;
  const std::lock_guard<std::mutex> guard(registry_mutex());
  if (custom_palettes().find(name) == custom_palettes().end()) {
    custom_palette_order().push_back(name);
  }
  custom_palettes()[name] = colors;
  return true;
}

std::vector<std::string> palette_names() {
  const std::lock_guard<std::mutex> guard(registry_mutex());
  std::vector<std::string> names;
  for (const BuiltinPalette& builtin : builtin_palettes()) names.emplace_back(builtin.name);
  for (const std::string& name : custom_palette_order()) {
    if (std::find(names.begin(), names.end(), name) == names.end()) names.push_back(name);
  }
  return names;
}

const std::vector<ph_color>& palette(const std::string& name) {
  const std::lock_guard<std::mutex> guard(registry_mutex());
  const auto found = custom_palettes().find(name);
  if (found != custom_palettes().end()) return found->second;
  for (const BuiltinPalette& builtin : builtin_palettes()) {
    if (name == builtin.name) return builtin.colors;
  }
  return builtin_palettes().front().colors;  // tableau10
}

ph_color palette_color(const std::string& name, int32_t index) {
  const std::vector<ph_color>& colors = palette(name);
  const int32_t n = static_cast<int32_t>(colors.size());
  return colors[static_cast<size_t>(((index % n) + n) % n)];
}

}  // namespace photon::color
