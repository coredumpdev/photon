/*
 * A GLFW host for Photon.
 *
 * This is the first of the four hosts, and its job is to prove the boundary is
 * real: everything below is window management and input translation, and none
 * of it knows anything about charts. A Qt, Avalonia or LWJGL host is the same
 * hundred lines written against a different toolkit.
 *
 * It drives a grid of plots inside one window and one GL context. One plot in a
 * 1x1 grid is the ordinary case; the grid exists because the interesting thing
 * about `ph_frame_target` is that it carries a *rectangle*, so a dashboard of
 * charts is one context and one swap rather than one context per chart. (That
 * is also the difference from the web core, which cannot have more than about
 * sixteen live contexts and blits out of a shared one — see DESIGN.md.)
 *
 * C99, so it doubles as a worked example of the ABI from C.
 */
#ifndef PHOTON_GLFW_H
#define PHOTON_GLFW_H

/* glfw3.h pulls in the system GL header by default. Nothing here needs it — the
 * two GL calls the host makes are resolved through glfwGetProcAddress, and the
 * library keeps its own loader private — and including it would collide with
 * whatever loader the application already uses. */
#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#include <photon/photon.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ph_glfw_host ph_glfw_host;

/**
 * Attach `count` plots to `window`, laid out left-to-right in `columns`.
 *
 * Installs the cursor, button, scroll, key, size and content-scale callbacks.
 * The plots stay owned by the caller. Returns NULL if the window already has a
 * host, or if there are more plots than the fixed grid holds.
 *
 * `glfwMakeContextCurrent(window)` must already have been called, and
 * `ph_init` must have been given `glfwGetProcAddress`.
 */
ph_glfw_host* ph_glfw_host_create(GLFWwindow* window, const ph_plot* plots, int count,
                                  int columns);

/** Remove the callbacks and free the host. The plots are untouched. */
void ph_glfw_host_destroy(ph_glfw_host* host);

/**
 * Render every cell into the window's framebuffer and swap.
 *
 * Returns 0 and leaves the reason in `ph_last_error()` if a plot failed to draw.
 */
int ph_glfw_host_draw(ph_glfw_host* host);

/** Non-zero when any plot has asked for a frame since the last draw. */
int ph_glfw_host_dirty(const ph_glfw_host* host);

/** The plot under the cursor, or PH_NULL_HANDLE when it is outside them all. */
ph_plot ph_glfw_host_hovered(const ph_glfw_host* host);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* PHOTON_GLFW_H */
