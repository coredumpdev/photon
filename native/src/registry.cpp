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
  Plot* plot = registry.plots.get(ref->plot);
  if (!plot) return fail(PH_E_INVALID_HANDLE, "the layer's plot has been destroyed");
  if (out_plot) *out_plot = plot;
  if (out_layer) *out_layer = ref->layer;
  return PH_OK;
}

}  // namespace photon
