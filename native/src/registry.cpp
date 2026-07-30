#include "registry.hpp"

#include "error.hpp"

namespace photon {

Registry& Registry::get() {
  // Function-local static: initialized on first use, destroyed at exit, and
  // thread-safe to construct under C++11 and later.
  static Registry registry;
  return registry;
}

ph_result resolve_layer(ph_layer handle, Plot** out_plot, Layer** out_layer) {
  Registry& registry = Registry::get();
  if (!registry.initialized) return fail(PH_E_NOT_INITIALIZED, "ph_init has not been called");
  LayerRef* ref = registry.layers.get(handle);
  if (!ref) return fail(PH_E_INVALID_HANDLE, "layer handle is stale or invalid");
  if (ref->layer3d) {
    // Both plot types mint handles from this table, so a 3-D layer reaching a
    // 2-D call is a caller mistake rather than a corrupt handle — and saying so
    // is the difference between a fixable message and a crash.
    return fail(PH_E_INVALID_ARGUMENT, "this is a 3-D layer; use the ph_plot3d calls");
  }
  Plot* plot = registry.plots.get(ref->plot);
  if (!plot) return fail(PH_E_INVALID_HANDLE, "the layer's plot has been destroyed");
  if (out_plot) *out_plot = plot;
  if (out_layer) *out_layer = ref->layer;
  return PH_OK;
}

ph_result resolve_layer3d(ph_layer handle, plot3d::Plot3D** out_plot,
                          plot3d::Layer3D** out_layer) {
  Registry& registry = Registry::get();
  if (!registry.initialized) return fail(PH_E_NOT_INITIALIZED, "ph_init has not been called");
  LayerRef* ref = registry.layers.get(handle);
  if (!ref) return fail(PH_E_INVALID_HANDLE, "layer handle is stale or invalid");
  if (!ref->layer3d) return fail(PH_E_INVALID_ARGUMENT, "this is not a 3-D layer");
  plot3d::Plot3D* plot = registry.plots3d.get(ref->plot3d);
  if (!plot) return fail(PH_E_INVALID_HANDLE, "the layer's scene has been destroyed");
  if (out_plot) *out_plot = plot;
  if (out_layer) *out_layer = ref->layer3d;
  return PH_OK;
}

}  // namespace photon
