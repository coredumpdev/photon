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

#define PH_PANEL_COUNT 8

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

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* PHOTON_PANELS_H */
