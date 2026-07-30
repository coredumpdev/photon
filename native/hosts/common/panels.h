/*
 * The demo charts, built through the public ABI and nothing else.
 *
 * These live outside every host on purpose. The claim this port makes is that
 * one engine draws the same chart under GLFW, Qt, C# and Java; the cheapest way
 * to keep that claim honest is for the hosts to share the *same* chart-building
 * code, so a difference on screen can only be the host's doing.
 *
 * C99, and free of any toolkit header.
 */
#ifndef PHOTON_PANELS_H
#define PHOTON_PANELS_H

#include <photon/photon.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PH_PANEL_COUNT 34

/**
 * The 3-D demo scenes, which are a second plot type rather than another panel.
 *
 * Kept beside the others so the chart-building code stays in one place, but
 * counted separately: a host has to create a ph_plot3d for these and render it
 * with ph_plot3d_render, so it opts in rather than getting them for free. Only
 * the Java gallery does so far; the GLFW and Qt ones show the 2-D panels.
 */
#define PH_PANEL_3D_COUNT 6

/**
 * Per-instance state for one set of panels.
 *
 * Not a set of globals, because a Qt window holds one independent item per panel,
 * each with its own plot on its own render thread — the streaming panel's
 * buffers cannot be shared between them.
 */
typedef struct ph_panels ph_panels;

ph_panels* ph_panels_create(void);
void ph_panels_free(ph_panels* panels);

/**
 * Build panel `index` into `plot`: series, axis titles, ticks and plot title.
 * Out-of-range indices wrap, so a host can lay out however many cells it likes.
 */
void ph_panels_build(ph_panels* panels, ph_plot plot, int index);

/** Rewrite the streaming panel's data for `seconds`. Cheap; call per frame. */
void ph_panels_advance(ph_panels* panels, double seconds);

/** The panel's title, for a host that wants it outside the plot. */
const char* ph_panels_title(int index);

/** Build 3-D scene `index` (0..PH_PANEL_3D_COUNT-1) into `plot`. */
void ph_panels_build_3d(ph_panels* panels, ph_plot3d plot, int index);

/** The 3-D scene's title. */
const char* ph_panels_title_3d(int index);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* PHOTON_PANELS_H */
