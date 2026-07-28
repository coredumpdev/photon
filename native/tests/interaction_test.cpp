/*
 * The interaction port, checked against the numbers core/src/plot.ts produces.
 *
 * This is the test that matters most in Faz 0. The whole premise of the native
 * port is that it is the *same library*, not a lookalike — so a drag of 56.8px
 * on a 640x400 plot has to land on exactly the domain the web version lands on.
 * Every expected value below is hand-derived from the formulas in plot.ts
 * (panX, panY, zoomAround, plotRegion, padDomain), not from running this code.
 *
 * Reference layout used throughout: 640x400 with the default 16/16/40/56
 * margins, giving a plot region of left=56, top=16, width=568, height=344.
 */

#include <photon/photon.h>

#include <cmath>
#include <thread>

#include "check.h"

namespace {

constexpr double kEps = 1e-9;

/* The reference region, spelled out so a change to the default margins fails
 * here loudly instead of quietly shifting every expectation below. */
constexpr double kRegionLeft = 56.0;
constexpr double kRegionTop = 16.0;
constexpr double kRegionWidth = 568.0;   // 640 - 56 - 16
constexpr double kRegionHeight = 344.0;  // 400 - 16 - 40

ph_plot make_plot(ph_range x, ph_range y) {
  ph_plot plot = PH_NULL_HANDLE;
  ph_plot_desc desc;
  ph_plot_desc_init(&desc);
  desc.width = 640;
  desc.height = 400;
  CHECK_EQ(ph_plot_create(&desc, &plot), PH_OK);
  CHECK_EQ(ph_plot_set_domain(plot, "x", x), PH_OK);
  CHECK_EQ(ph_plot_set_domain(plot, "y", y), PH_OK);
  return plot;
}

ph_range domain_of(ph_plot plot, const char* axis) {
  ph_range r{0.0, 0.0};
  CHECK_EQ(ph_plot_get_domain(plot, axis, &r), PH_OK);
  return r;
}

void test_plot_region_matches_layout() {
  ph_plot plot = make_plot({0.0, 10.0}, {0.0, 100.0});

  // The region is not directly observable through the ABI, so probe it: the
  // centre pixel of the region must map to the centre of both domains.
  double dx = 0.0, dy = 0.0;
  CHECK_EQ(ph_plot_data_at_pixel(plot, kRegionLeft + kRegionWidth / 2,
                                 kRegionTop + kRegionHeight / 2, &dx, &dy), PH_OK);
  CHECK_NEAR(dx, 5.0, kEps);
  CHECK_NEAR(dy, 50.0, kEps);

  // ...and the projection has to invert exactly.
  double px = 0.0, py = 0.0;
  CHECK_EQ(ph_plot_pixel_at_data(plot, 5.0, 50.0, &px, &py), PH_OK);
  CHECK_NEAR(px, kRegionLeft + kRegionWidth / 2, kEps);
  CHECK_NEAR(py, kRegionTop + kRegionHeight / 2, kEps);

  // Screen y grows downwards: the top of the region is the top of the domain.
  CHECK_EQ(ph_plot_data_at_pixel(plot, kRegionLeft, kRegionTop, &dx, &dy), PH_OK);
  CHECK_NEAR(dx, 0.0, kEps);
  CHECK_NEAR(dy, 100.0, kEps);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_pan_matches_plot_ts() {
  ph_plot plot = make_plot({0.0, 10.0}, {0.0, 100.0});

  // panX: f = dx / region.width = 56.8 / 568 = 0.1
  //       domain = [invert(-f), invert(1-f)] = [-1, 9]
  // panY: f = dy / region.height = 34.4 / 344 = 0.1
  //       domain = [invert(f), invert(1+f)] = [10, 110]
  CHECK_EQ(ph_plot_pan_pixels(plot, 56.8, 34.4), PH_OK);

  const ph_range x = domain_of(plot, "x");
  CHECK_NEAR(x.lo, -1.0, 1e-9);
  CHECK_NEAR(x.hi, 9.0, 1e-9);

  const ph_range y = domain_of(plot, "y");
  CHECK_NEAR(y.lo, 10.0, 1e-9);
  CHECK_NEAR(y.hi, 110.0, 1e-9);

  // Panning back by the same delta must return the original view exactly —
  // the span is preserved, so this is a real round trip and not an accumulation.
  CHECK_EQ(ph_plot_pan_pixels(plot, -56.8, -34.4), PH_OK);
  const ph_range x2 = domain_of(plot, "x");
  CHECK_NEAR(x2.lo, 0.0, 1e-9);
  CHECK_NEAR(x2.hi, 10.0, 1e-9);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_zoom_around_matches_plot_ts() {
  ph_plot plot = make_plot({0.0, 10.0}, {0.0, 100.0});

  // zoomAround(0.5, 0.5, 2): t = nx * (1 - factor) = -0.5
  //   x = [invert(-0.5), invert(1.5)] = [-5, 15]
  //   y = [invert(-0.5), invert(1.5)] = [-50, 150]
  CHECK_EQ(ph_plot_zoom_around(plot, 0.5, 0.5, 2.0), PH_OK);

  const ph_range x = domain_of(plot, "x");
  CHECK_NEAR(x.lo, -5.0, 1e-9);
  CHECK_NEAR(x.hi, 15.0, 1e-9);
  const ph_range y = domain_of(plot, "y");
  CHECK_NEAR(y.lo, -50.0, 1e-9);
  CHECK_NEAR(y.hi, 150.0, 1e-9);

  // Zooming about a corner must pin that corner: nx = 0 keeps the low edge.
  ph_plot corner = make_plot({0.0, 10.0}, {0.0, 100.0});
  CHECK_EQ(ph_plot_zoom_around(corner, 0.0, 0.0, 0.5), PH_OK);
  const ph_range cx = domain_of(corner, "x");
  CHECK_NEAR(cx.lo, 0.0, 1e-9);
  CHECK_NEAR(cx.hi, 5.0, 1e-9);

  CHECK_EQ(ph_plot_zoom_around(plot, 0.5, 0.5, 0.0), PH_E_INVALID_ARGUMENT);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
  CHECK_EQ(ph_plot_destroy(corner), PH_OK);
}

void test_wheel_uses_the_browser_factor() {
  ph_plot plot = make_plot({0.0, 10.0}, {0.0, 100.0});

  // The web core reads a wheel event as factor = exp(deltaY * 0.001), and the
  // native side must not invent its own curve or a native host will feel
  // different from the browser at the same scroll speed.
  const double factor = std::exp(100.0 * 0.001);  // 1.1051709180756477
  const double t = 0.5 * (1.0 - factor);

  CHECK_EQ(ph_plot_wheel(plot, kRegionLeft + kRegionWidth / 2,
                         kRegionTop + kRegionHeight / 2, 100.0, PH_MOD_NONE), PH_OK);

  const ph_range x = domain_of(plot, "x");
  CHECK_NEAR(x.lo, t * 10.0, 1e-9);
  CHECK_NEAR(x.hi, (t + factor) * 10.0, 1e-9);
  // Positive deltaY scrolls down, which zooms *out*: the span grew.
  CHECK(x.hi - x.lo > 10.0);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_log_scale_zooms_multiplicatively() {
  ph_plot plot = PH_NULL_HANDLE;
  ph_plot_desc desc;
  ph_plot_desc_init(&desc);
  desc.width = 640;
  desc.height = 400;
  desc.x.type = PH_SCALE_LOG;
  desc.x.domain = ph_range{1.0, 1000.0};
  CHECK_EQ(ph_plot_create(&desc, &plot), PH_OK);

  // A log axis zooms in log space, so invert(t) = 10^(la + t*(lb-la)) with
  // la = 0, lb = 3. zoomAround(0.5, _, 2) gives t = -0.5:
  //   [10^(-1.5), 10^(4.5)]
  CHECK_EQ(ph_plot_zoom_around(plot, 0.5, 0.5, 2.0), PH_OK);
  const ph_range x = domain_of(plot, "x");
  CHECK_NEAR(x.lo, std::pow(10.0, -1.5), 1e-12);
  CHECK_NEAR(x.hi, std::pow(10.0, 4.5), 1e-6);
  // The invariant a log axis actually has to keep: the *ratio* is preserved.
  CHECK_NEAR(std::log10(x.hi / x.lo), 6.0, 1e-9);

  // A log domain can never be driven non-positive, however far it is panned.
  for (int i = 0; i < 40; ++i) CHECK_EQ(ph_plot_pan_pixels(plot, 200.0, 0.0), PH_OK);
  const ph_range panned = domain_of(plot, "x");
  CHECK(panned.lo > 0.0);
  CHECK(panned.hi > panned.lo);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_box_zoom_and_axis_lock() {
  // Drag from the region's top-left to its centre.
  ph_plot plot = make_plot({0.0, 10.0}, {0.0, 100.0});
  CHECK_EQ(ph_plot_set_mode(plot, PH_MODE_BOX), PH_OK);
  CHECK_EQ(ph_plot_pointer_down(plot, kRegionLeft, kRegionTop, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK);
  CHECK_EQ(ph_plot_pointer_move(plot, kRegionLeft + kRegionWidth / 2,
                                kRegionTop + kRegionHeight / 2, PH_MOD_NONE), PH_OK);
  CHECK_EQ(ph_plot_pointer_up(plot, kRegionLeft + kRegionWidth / 2,
                              kRegionTop + kRegionHeight / 2, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK);

  const ph_range x = domain_of(plot, "x");
  CHECK_NEAR(x.lo, 0.0, 1e-9);
  CHECK_NEAR(x.hi, 5.0, 1e-9);
  // The selection's *bottom* pixel is the domain's low edge.
  const ph_range y = domain_of(plot, "y");
  CHECK_NEAR(y.lo, 50.0, 1e-9);
  CHECK_NEAR(y.hi, 100.0, 1e-9);
  CHECK_EQ(ph_plot_destroy(plot), PH_OK);

  // box-x locks the y axis; box-y locks the x axis.
  ph_plot bx = make_plot({0.0, 10.0}, {0.0, 100.0});
  CHECK_EQ(ph_plot_set_mode(bx, PH_MODE_BOX_X), PH_OK);
  CHECK_EQ(ph_plot_pointer_down(bx, kRegionLeft, kRegionTop, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK);
  CHECK_EQ(ph_plot_pointer_up(bx, kRegionLeft + kRegionWidth / 2,
                              kRegionTop + kRegionHeight / 2, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK);
  const ph_range bxx = domain_of(bx, "x");
  const ph_range bxy = domain_of(bx, "y");
  CHECK_NEAR(bxx.hi, 5.0, 1e-9);
  CHECK_NEAR(bxy.lo, 0.0, 1e-9);
  CHECK_NEAR(bxy.hi, 100.0, 1e-9);
  // The same lock governs the wheel, not just the drag.
  CHECK_EQ(ph_plot_wheel(bx, kRegionLeft + 10.0, kRegionTop + 10.0, 100.0, PH_MOD_NONE), PH_OK);
  const ph_range after = domain_of(bx, "y");
  CHECK_NEAR(after.lo, 0.0, 1e-9);
  CHECK_NEAR(after.hi, 100.0, 1e-9);
  CHECK_EQ(ph_plot_destroy(bx), PH_OK);

  // A click with no drag must not zoom into a 1px box and throw the view away.
  ph_plot click = make_plot({0.0, 10.0}, {0.0, 100.0});
  CHECK_EQ(ph_plot_set_mode(click, PH_MODE_BOX), PH_OK);
  CHECK_EQ(ph_plot_pointer_down(click, 300.0, 200.0, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK);
  CHECK_EQ(ph_plot_pointer_up(click, 301.0, 200.5, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK);
  const ph_range unchanged = domain_of(click, "x");
  CHECK_NEAR(unchanged.lo, 0.0, 1e-9);
  CHECK_NEAR(unchanged.hi, 10.0, 1e-9);
  CHECK_EQ(ph_plot_destroy(click), PH_OK);
}

void test_drag_pans_by_the_pointer_delta() {
  ph_plot plot = make_plot({0.0, 10.0}, {0.0, 100.0});
  // Default mode is pan.
  CHECK_EQ(ph_plot_pointer_down(plot, 300.0, 200.0, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK);
  CHECK_EQ(ph_plot_pointer_move(plot, 300.0 + 56.8, 200.0, PH_MOD_NONE), PH_OK);
  CHECK_EQ(ph_plot_pointer_up(plot, 300.0 + 56.8, 200.0, PH_BUTTON_LEFT, PH_MOD_NONE), PH_OK);

  const ph_range x = domain_of(plot, "x");
  CHECK_NEAR(x.lo, -1.0, 1e-9);
  CHECK_NEAR(x.hi, 9.0, 1e-9);

  // A move after the button is released is a hover, not a continued drag.
  CHECK_EQ(ph_plot_pointer_move(plot, 500.0, 200.0, PH_MOD_NONE), PH_OK);
  const ph_range after = domain_of(plot, "x");
  CHECK_NEAR(after.lo, -1.0, 1e-9);
  CHECK_NEAR(after.hi, 9.0, 1e-9);

  // Right-click is the context menu's, and must not pan.
  CHECK_EQ(ph_plot_pointer_down(plot, 300.0, 200.0, PH_BUTTON_RIGHT, PH_MOD_NONE), PH_OK);
  CHECK_EQ(ph_plot_pointer_move(plot, 400.0, 200.0, PH_MOD_NONE), PH_OK);
  const ph_range still = domain_of(plot, "x");
  CHECK_NEAR(still.lo, -1.0, 1e-9);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_autoscale_padding_matches_plot_ts() {
  ph_plot plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(nullptr, &plot), PH_OK);

  double xs[3] = {0.0, 1.0, 2.0};
  double ys[3] = {10.0, 20.0, 30.0};
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = xs;
  line.y = ys;
  line.count = 3;
  ph_layer layer = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_add_line(plot, &line, &layer), PH_OK);

  // padDomain pads by 5% of the span on each side.
  const ph_range x = domain_of(plot, "x");
  CHECK_NEAR(x.lo, -0.1, 1e-12);
  CHECK_NEAR(x.hi, 2.1, 1e-12);
  const ph_range y = domain_of(plot, "y");
  CHECK_NEAR(y.lo, 9.0, 1e-12);
  CHECK_NEAR(y.hi, 31.0, 1e-12);

  // Hiding the only series leaves the axes where they were rather than
  // collapsing them to an empty domain.
  CHECK_EQ(ph_layer_set_visible(layer, 0), PH_OK);
  const ph_range hidden = domain_of(plot, "x");
  CHECK_NEAR(hidden.lo, -0.1, 1e-12);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_autoscale_of_a_flat_series() {
  // A single point, or a constant series, has zero span. padDomain falls back
  // to +/-1 rather than producing an inverted or empty domain.
  ph_plot plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(nullptr, &plot), PH_OK);

  double xs[2] = {5.0, 5.0};
  double ys[2] = {7.0, 7.0};
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = xs;
  line.y = ys;
  line.count = 2;
  ph_layer layer = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_add_line(plot, &line, &layer), PH_OK);

  const ph_range x = domain_of(plot, "x");
  CHECK_NEAR(x.lo, 4.0, 1e-12);
  CHECK_NEAR(x.hi, 6.0, 1e-12);
  const ph_range y = domain_of(plot, "y");
  CHECK_NEAR(y.lo, 6.0, 1e-12);
  CHECK_NEAR(y.hi, 8.0, 1e-12);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_non_finite_samples_do_not_poison_bounds() {
  // A NaN is a hole in a series, not a data point. One of them must not
  // collapse the whole domain — the web core skips them and so must this.
  ph_plot plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(nullptr, &plot), PH_OK);

  double xs[4] = {0.0, 1.0, 2.0, 3.0};
  double ys[4] = {10.0, std::nan(""), 30.0, INFINITY};
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = xs;
  line.y = ys;
  line.count = 4;
  ph_layer layer = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_add_line(plot, &line, &layer), PH_OK);

  ph_range bx{}, by{};
  CHECK_EQ(ph_layer_bounds(layer, &bx, &by), PH_OK);
  CHECK_NEAR(by.lo, 10.0, 1e-12);
  CHECK_NEAR(by.hi, 30.0, 1e-12);
  // x = 1 and x = 3 are dropped along with their y partners.
  CHECK_NEAR(bx.lo, 0.0, 1e-12);
  CHECK_NEAR(bx.hi, 2.0, 1e-12);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_named_y_axes() {
  ph_plot plot = make_plot({0.0, 10.0}, {0.0, 100.0});

  ph_axis_desc right;
  ph_axis_desc_init(&right);
  right.domain = ph_range{0.0, 1.0};
  CHECK_EQ(ph_plot_add_y_axis(plot, "volume", &right, 1), PH_OK);
  // Ids are unique, and "y" is taken by the primary axis.
  CHECK_EQ(ph_plot_add_y_axis(plot, "volume", &right, 1), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_plot_add_y_axis(plot, "y", &right, 1), PH_E_INVALID_ARGUMENT);

  // A vertical pan moves every y axis together, as plot.ts does when no axis
  // id is being dragged.
  CHECK_EQ(ph_plot_pan_pixels(plot, 0.0, 34.4), PH_OK);
  const ph_range primary = domain_of(plot, "y");
  const ph_range secondary = domain_of(plot, "volume");
  CHECK_NEAR(primary.lo, 10.0, 1e-9);
  CHECK_NEAR(secondary.lo, 0.1, 1e-9);

  CHECK_EQ(ph_plot_get_domain(plot, "nope", nullptr), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_plot_remove_y_axis(plot, "y"), PH_E_INVALID_ARGUMENT);  // primary stays
  CHECK_EQ(ph_plot_remove_y_axis(plot, "volume"), PH_OK);
  ph_range gone{};
  CHECK_EQ(ph_plot_get_domain(plot, "volume", &gone), PH_E_INVALID_ARGUMENT);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_reset_view_returns_to_the_initial_domains() {
  ph_plot plot = PH_NULL_HANDLE;
  ph_plot_desc desc;
  ph_plot_desc_init(&desc);
  desc.x.domain = ph_range{0.0, 10.0};
  desc.y.domain = ph_range{0.0, 100.0};
  CHECK_EQ(ph_plot_create(&desc, &plot), PH_OK);

  CHECK_EQ(ph_plot_zoom_around(plot, 0.5, 0.5, 0.25), PH_OK);
  CHECK(domain_of(plot, "x").hi < 10.0);

  CHECK_EQ(ph_plot_reset_view(plot), PH_OK);
  const ph_range x = domain_of(plot, "x");
  CHECK_NEAR(x.lo, 0.0, 1e-9);
  CHECK_NEAR(x.hi, 10.0, 1e-9);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_event_queue_coalesces_and_drains() {
  ph_plot plot = make_plot({0.0, 10.0}, {0.0, 100.0});
  CHECK_EQ(ph_plot_clear_events(plot), PH_OK);

  // A drag emits one view change per pointer move. A host polling once per
  // frame only cares about the latest, and an unbounded queue would be a leak.
  for (int i = 0; i < 500; ++i) {
    CHECK_EQ(ph_plot_pan_pixels(plot, 1.0, 0.0), PH_OK);
  }

  int view_changes = 0;
  int redraws = 0;
  int total = 0;
  ph_event ev;
  while (ph_plot_poll_event(plot, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
    if (ev.type == PH_EVENT_VIEW_CHANGED) ++view_changes;
    if (ev.type == PH_EVENT_REDRAW_REQUESTED) ++redraws;
    ++total;
    CHECK(total < 32);  // guards against a queue that never drains
  }
  CHECK_EQ(view_changes, 1);
  CHECK_EQ(redraws, 1);

  // The surviving view-change carries the *final* domain, not the first.
  const ph_range x = domain_of(plot, "x");
  CHECK(x.lo < -8.0);

  // Draining leaves the queue empty and poll stays well-behaved.
  CHECK_EQ(ph_plot_poll_event(plot, &ev), PH_OK);
  CHECK_EQ(ev.type, PH_EVENT_NONE);

  // Mode changes are discrete and must not be coalesced away.
  CHECK_EQ(ph_plot_set_mode(plot, PH_MODE_BOX), PH_OK);
  CHECK_EQ(ph_plot_set_mode(plot, PH_MODE_BOX_X), PH_OK);
  int mode_changes = 0;
  while (ph_plot_poll_event(plot, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
    if (ev.type == PH_EVENT_MODE_CHANGED) ++mode_changes;
  }
  CHECK_EQ(mode_changes, 2);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_cursor_events_report_data_coordinates() {
  ph_plot plot = make_plot({0.0, 10.0}, {0.0, 100.0});
  CHECK_EQ(ph_plot_clear_events(plot), PH_OK);

  CHECK_EQ(ph_plot_pointer_move(plot, kRegionLeft + kRegionWidth / 2,
                                kRegionTop + kRegionHeight / 2, PH_MOD_NONE), PH_OK);

  ph_event ev;
  bool saw_cursor = false;
  while (ph_plot_poll_event(plot, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
    if (ev.type != PH_EVENT_CURSOR_MOVED) continue;
    saw_cursor = true;
    CHECK_NEAR(ev.cursor_x, 5.0, 1e-9);
    CHECK_NEAR(ev.cursor_y, 50.0, 1e-9);
    CHECK_EQ(ev.cursor_valid, 1);
  }
  CHECK(saw_cursor);

  // Leaving the plot reports an invalid cursor so a host can hide its tooltip.
  CHECK_EQ(ph_plot_clear_events(plot), PH_OK);
  CHECK_EQ(ph_plot_pointer_leave(plot), PH_OK);
  bool saw_invalid = false;
  while (ph_plot_poll_event(plot, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
    if (ev.type == PH_EVENT_CURSOR_MOVED && ev.cursor_valid == 0) saw_invalid = true;
  }
  CHECK(saw_invalid);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_bounded_pan_keeps_the_view_over_the_data() {
  ph_plot plot = PH_NULL_HANDLE;
  ph_plot_desc desc;
  ph_plot_desc_init(&desc);
  desc.width = 640;
  desc.height = 400;
  desc.bounded_pan = 1;
  CHECK_EQ(ph_plot_create(&desc, &plot), PH_OK);

  double xs[2] = {0.0, 10.0};
  double ys[2] = {0.0, 10.0};
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = xs;
  line.y = ys;
  line.count = 2;
  ph_layer layer = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_add_line(plot, &line, &layer), PH_OK);

  CHECK_EQ(ph_plot_set_domain(plot, "x", ph_range{2.0, 4.0}), PH_OK);
  const double span_before = domain_of(plot, "x").hi - domain_of(plot, "x").lo;

  // Pan far past the right edge of the data.
  for (int i = 0; i < 20; ++i) CHECK_EQ(ph_plot_pan_pixels(plot, -400.0, 0.0), PH_OK);

  const ph_range x = domain_of(plot, "x");
  // Clamped inside the data, and — the point of clampAxis — with the zoom level
  // preserved rather than squashed.
  CHECK(x.hi <= 10.0 + 1e-9);
  CHECK_NEAR(x.hi - x.lo, span_before, 1e-9);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_layer_data_can_be_streamed() {
  ph_plot plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(nullptr, &plot), PH_OK);

  double xs[2] = {0.0, 1.0};
  double ys[2] = {0.0, 1.0};
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = xs;
  line.y = ys;
  line.count = 2;
  line.render_type = PH_RENDER_DYNAMIC;
  ph_layer layer = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_add_line(plot, &line, &layer), PH_OK);

  // The descriptor's arrays are copied during the call, so a host is free to
  // reuse or free them — the whole reason a GC'd binding needs no pinning.
  xs[0] = 999.0;
  ph_range bx{}, by{};
  CHECK_EQ(ph_layer_bounds(layer, &bx, &by), PH_OK);
  CHECK_NEAR(bx.lo, 0.0, 1e-12);

  double nx[3] = {5.0, 6.0, 7.0};
  double ny[3] = {50.0, 60.0, 70.0};
  CHECK_EQ(ph_layer_set_xy(layer, nx, ny, 3), PH_OK);
  CHECK_EQ(ph_layer_bounds(layer, &bx, &by), PH_OK);
  CHECK_NEAR(bx.lo, 5.0, 1e-12);
  CHECK_NEAR(by.hi, 70.0, 1e-12);

  // An empty layer has no bounds to report, and says so.
  CHECK_EQ(ph_layer_set_xy(layer, nullptr, nullptr, 0), PH_OK);
  CHECK_EQ(ph_layer_bounds(layer, &bx, &by), PH_E_UNSUPPORTED);

  CHECK_EQ(ph_layer_destroy(layer), PH_OK);
  CHECK_EQ(ph_layer_valid(layer), 0);
  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_render_refuses_a_foreign_thread() {
  // A plot's GL context is current on exactly one thread. Rendering from
  // another is the mistake a Qt host makes first, and it has to be an error
  // code rather than a driver crash.
  ph_plot plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(nullptr, &plot), PH_OK);

  ph_frame_target target;
  ph_frame_target_init(&target);
  target.width = 640;
  target.height = 400;

  ph_result from_other_thread = PH_OK;
  std::thread worker([&] { from_other_thread = ph_plot_render(plot, &target); });
  worker.join();
  CHECK_EQ(from_other_thread, PH_E_WRONG_THREAD);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

void test_handles_are_not_reused_naively() {
  // Slot reuse is fine; handle reuse is not. A recycled slot must come back
  // with a new generation so an old handle stays invalid forever.
  ph_plot first = PH_NULL_HANDLE;
  ph_plot second = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(nullptr, &first), PH_OK);
  CHECK_EQ(ph_plot_destroy(first), PH_OK);
  CHECK_EQ(ph_plot_create(nullptr, &second), PH_OK);

  CHECK(first != second);
  CHECK_EQ(ph_plot_valid(first), 0);
  CHECK_EQ(ph_plot_valid(second), 1);

  CHECK_EQ(ph_plot_destroy(second), PH_OK);
}

}  // namespace

int main() {
  CHECK_EQ(ph_init(PHOTON_ABI_VERSION, nullptr), PH_OK);

  RUN(test_plot_region_matches_layout);
  RUN(test_pan_matches_plot_ts);
  RUN(test_zoom_around_matches_plot_ts);
  RUN(test_wheel_uses_the_browser_factor);
  RUN(test_log_scale_zooms_multiplicatively);
  RUN(test_box_zoom_and_axis_lock);
  RUN(test_drag_pans_by_the_pointer_delta);
  RUN(test_autoscale_padding_matches_plot_ts);
  RUN(test_autoscale_of_a_flat_series);
  RUN(test_non_finite_samples_do_not_poison_bounds);
  RUN(test_named_y_axes);
  RUN(test_reset_view_returns_to_the_initial_domains);
  RUN(test_event_queue_coalesces_and_drains);
  RUN(test_cursor_events_report_data_coordinates);
  RUN(test_bounded_pan_keeps_the_view_over_the_data);
  RUN(test_layer_data_can_be_streamed);
  RUN(test_render_refuses_a_foreign_thread);
  RUN(test_handles_are_not_reused_naively);

  ph_shutdown();
  return TEST_MAIN_RESULT();
}
