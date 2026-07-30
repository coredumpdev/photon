// Process-global state behind the ABI: the host descriptor and the two handle
// tables.
//
// Ownership is split deliberately. A Plot owns its layers as unique_ptrs, the
// same as the web core; the layer table only owns a *reference* record, so a
// layer handle can be validated and resolved without a second owner of the
// object. Destroying a plot erases its layer handles, which is what makes a
// layer handle held past its plot's lifetime return PH_E_INVALID_HANDLE rather
// than dereference freed memory.
#pragma once

#include <photon/photon.h>

#include "data/csv.hpp"
#include "handle_table.hpp"
#include "layer.hpp"
#include "plot.hpp"
#include "plot3d/plot3d.hpp"

namespace photon {

/// What a ph_layer resolves to.
///
/// One table serves both plot types, so ph_layer_destroy and
/// ph_layer_set_visible work on a 3-D layer exactly as they do on a 2-D one.
/// Exactly one of the two pairs is set.
struct LayerRef {
  ph_plot plot = PH_NULL_HANDLE;
  Layer* layer = nullptr;
  ph_plot3d plot3d = PH_NULL_HANDLE;
  plot3d::Layer3D* layer3d = nullptr;
};

struct Registry {
  bool initialized = false;
  ph_host_desc host{};
  HandleTable<Plot> plots;
  HandleTable<LayerRef> layers;
  /// Parsed CSVs. Unlike a layer, a table belongs to nothing and outlives every
  /// plot — it is data the caller loaded, not something the renderer owns.
  HandleTable<data::Table> tables;
  HandleTable<plot3d::Plot3D> plots3d;

  /// Resolved GL entry points. Empty until the first render, because ph_init
  /// may run long before any context is current — a Qt host initializes the
  /// library on the GUI thread and only gets a context on the render thread.
  gl::Api gl;
  /// Why loading failed, so the message is not re-derived on every frame.
  std::string gl_error;
  bool gl_attempted = false;

  static Registry& get();
};

/// Resolve a layer handle to both its plot and the layer itself.
/// Returns PH_OK, or the specific reason it failed.
ph_result resolve_layer(ph_layer handle, Plot** out_plot, Layer** out_layer);

/// The same for a 3-D layer. A handle that names the wrong kind is refused with
/// a message that says which, rather than resolving to the wrong pointer.
ph_result resolve_layer3d(ph_layer handle, plot3d::Plot3D** out_plot,
                          plot3d::Layer3D** out_layer);

}  // namespace photon
