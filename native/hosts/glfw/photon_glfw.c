#include "photon_glfw.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#define PH_GLFW_MAX_PLOTS 16
#define PH_GLFW_MAX_HOSTS 8

struct ph_glfw_host {
  GLFWwindow* window;
  ph_plot plots[PH_GLFW_MAX_PLOTS];
  int count;
  int columns;
  int rows;

  /* Logical window size and the device pixel ratio derived from it. */
  int logical_width;
  int logical_height;
  int framebuffer_width;
  int framebuffer_height;
  float dpr;

  double cursor_x;
  double cursor_y;
  int hovered; /* index into plots, or -1 */

  int dirty;

  /* The two GL calls the host itself makes. The library keeps its own loader
   * private, so they are resolved here rather than borrowed from it. */
  void(PH_CALL* clear_color)(float, float, float, float);
  void(PH_CALL* clear)(unsigned);

  /* Chained so a host application keeps whatever it had installed. */
  GLFWcursorposfun previous_cursor_pos;
  GLFWmousebuttonfun previous_mouse_button;
  GLFWscrollfun previous_scroll;
  GLFWcursorenterfun previous_cursor_enter;
  GLFWframebuffersizefun previous_framebuffer_size;
  GLFWwindowsizefun previous_window_size;
};

/* GLFW's user pointer belongs to the application, so the window -> host map
 * lives here instead. Eight windows is more than any host that is not a tiling
 * dashboard, and a fixed array needs no allocation or teardown ordering. */
static ph_glfw_host* g_hosts[PH_GLFW_MAX_HOSTS];

static ph_glfw_host* host_for(GLFWwindow* window) {
  for (int i = 0; i < PH_GLFW_MAX_HOSTS; i++) {
    if (g_hosts[i] && g_hosts[i]->window == window) return g_hosts[i];
  }
  return NULL;
}

#define GL_COLOR_BUFFER_BIT 0x00004000u

/* ------------------------------------------------------------------------- */
/* Layout                                                                     */
/* ------------------------------------------------------------------------- */

static double cell_width(const ph_glfw_host* host) {
  return (double)host->logical_width / (double)host->columns;
}

static double cell_height(const ph_glfw_host* host) {
  return (double)host->logical_height / (double)host->rows;
}

/** Which cell (mx, my) falls in, in logical window coordinates. */
static int cell_at(const ph_glfw_host* host, double mx, double my) {
  const double cw = cell_width(host);
  const double ch = cell_height(host);
  if (cw <= 0.0 || ch <= 0.0) return -1;
  const int column = (int)floor(mx / cw);
  const int row = (int)floor(my / ch);
  if (column < 0 || column >= host->columns || row < 0 || row >= host->rows) return -1;
  const int index = row * host->columns + column;
  return index < host->count ? index : -1;
}

static void cell_local(const ph_glfw_host* host, int index, double mx, double my, double* out_x,
                       double* out_y) {
  const int column = index % host->columns;
  const int row = index / host->columns;
  *out_x = mx - column * cell_width(host);
  *out_y = my - row * cell_height(host);
}

/** Push the current cell size onto every plot. */
static void sync_sizes(ph_glfw_host* host) {
  const int w = (int)lround(cell_width(host));
  const int h = (int)lround(cell_height(host));
  for (int i = 0; i < host->count; i++) ph_plot_set_size(host->plots[i], w, h);
  host->dirty = 1;
}

static void refresh_geometry(ph_glfw_host* host) {
  glfwGetWindowSize(host->window, &host->logical_width, &host->logical_height);
  glfwGetFramebufferSize(host->window, &host->framebuffer_width, &host->framebuffer_height);
  /* Derive the ratio from the two sizes rather than from glfwGetWindowContentScale:
   * on a fractional-scaling Wayland or X11 setup the content scale and the real
   * framebuffer ratio can disagree, and it is the framebuffer that must win. */
  host->dpr = host->logical_width > 0
                  ? (float)host->framebuffer_width / (float)host->logical_width
                  : 1.0f;
  if (host->dpr <= 0.0f) host->dpr = 1.0f;
  sync_sizes(host);
}

/* ------------------------------------------------------------------------- */
/* Input                                                                      */
/* ------------------------------------------------------------------------- */

static ph_modifiers translate_mods(int glfw_mods) {
  ph_modifiers mods = PH_MOD_NONE;
  if (glfw_mods & GLFW_MOD_SHIFT) mods |= PH_MOD_SHIFT;
  if (glfw_mods & GLFW_MOD_CONTROL) mods |= PH_MOD_CTRL;
  if (glfw_mods & GLFW_MOD_ALT) mods |= PH_MOD_ALT;
  if (glfw_mods & GLFW_MOD_SUPER) mods |= PH_MOD_SUPER;
  return mods;
}

static ph_button translate_button(int glfw_button) {
  if (glfw_button == GLFW_MOUSE_BUTTON_RIGHT) return PH_BUTTON_RIGHT;
  if (glfw_button == GLFW_MOUSE_BUTTON_MIDDLE) return PH_BUTTON_MIDDLE;
  return PH_BUTTON_LEFT;
}

/** Drain the queues; a redraw request from any plot dirties the window. */
static void drain_events(ph_glfw_host* host) {
  for (int i = 0; i < host->count; i++) {
    ph_event event;
    while (ph_plot_poll_event(host->plots[i], &event) == PH_OK && event.type != PH_EVENT_NONE) {
      if (event.type == PH_EVENT_REDRAW_REQUESTED) host->dirty = 1;
    }
  }
}

static void on_cursor_pos(GLFWwindow* window, double mx, double my) {
  ph_glfw_host* host = host_for(window);
  if (!host) return;
  if (host->previous_cursor_pos) host->previous_cursor_pos(window, mx, my);

  host->cursor_x = mx;
  host->cursor_y = my;
  const int index = cell_at(host, mx, my);

  /* Moving between cells has to tell the one being left, or it keeps drawing a
   * hover crosshair for a pointer that is somewhere else entirely. */
  if (index != host->hovered && host->hovered >= 0) {
    ph_plot_pointer_leave(host->plots[host->hovered]);
  }
  host->hovered = index;
  if (index < 0) {
    drain_events(host);
    return;
  }

  double lx = 0.0, ly = 0.0;
  cell_local(host, index, mx, my, &lx, &ly);
  ph_plot_pointer_move(host->plots[index], lx, ly, PH_MOD_NONE);
  drain_events(host);
}

static void on_mouse_button(GLFWwindow* window, int button, int action, int mods) {
  ph_glfw_host* host = host_for(window);
  if (!host) return;
  if (host->previous_mouse_button) host->previous_mouse_button(window, button, action, mods);

  const int index = cell_at(host, host->cursor_x, host->cursor_y);
  if (index < 0) return;
  double lx = 0.0, ly = 0.0;
  cell_local(host, index, host->cursor_x, host->cursor_y, &lx, &ly);

  if (action == GLFW_PRESS) {
    ph_plot_pointer_down(host->plots[index], lx, ly, translate_button(button),
                         translate_mods(mods));
  } else if (action == GLFW_RELEASE) {
    ph_plot_pointer_up(host->plots[index], lx, ly, translate_button(button), translate_mods(mods));
  }
  drain_events(host);
}

static void on_scroll(GLFWwindow* window, double xoffset, double yoffset) {
  ph_glfw_host* host = host_for(window);
  if (!host) return;
  if (host->previous_scroll) host->previous_scroll(window, xoffset, yoffset);

  const int index = cell_at(host, host->cursor_x, host->cursor_y);
  if (index < 0) return;
  double lx = 0.0, ly = 0.0;
  cell_local(host, index, host->cursor_x, host->cursor_y, &lx, &ly);

  /* GLFW reports notches, positive upward. The core was written against the
   * browser's WheelEvent.deltaY: positive *downward*, and about 100 per notch.
   * Getting this wrong is not a bug that crashes anything — it is a zoom that
   * feels inverted or wrong-speed next to the same chart on the web. */
  ph_plot_wheel(host->plots[index], lx, ly, -yoffset * 100.0, PH_MOD_NONE);
  drain_events(host);
}

static void on_cursor_enter(GLFWwindow* window, int entered) {
  ph_glfw_host* host = host_for(window);
  if (!host) return;
  if (host->previous_cursor_enter) host->previous_cursor_enter(window, entered);
  if (!entered && host->hovered >= 0) {
    ph_plot_pointer_leave(host->plots[host->hovered]);
    host->hovered = -1;
    drain_events(host);
  }
}

static void on_framebuffer_size(GLFWwindow* window, int width, int height) {
  ph_glfw_host* host = host_for(window);
  if (!host) return;
  if (host->previous_framebuffer_size) host->previous_framebuffer_size(window, width, height);
  refresh_geometry(host);
}

static void on_window_size(GLFWwindow* window, int width, int height) {
  ph_glfw_host* host = host_for(window);
  if (!host) return;
  if (host->previous_window_size) host->previous_window_size(window, width, height);
  refresh_geometry(host);
}

/* ------------------------------------------------------------------------- */
/* Lifecycle and drawing                                                      */
/* ------------------------------------------------------------------------- */

ph_glfw_host* ph_glfw_host_create(GLFWwindow* window, const ph_plot* plots, int count,
                                  int columns) {
  if (!window || !plots || count <= 0 || count > PH_GLFW_MAX_PLOTS || columns <= 0) return NULL;
  if (host_for(window)) return NULL;

  int slot = -1;
  for (int i = 0; i < PH_GLFW_MAX_HOSTS; i++) {
    if (!g_hosts[i]) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return NULL;

  ph_glfw_host* host = (ph_glfw_host*)calloc(1, sizeof(ph_glfw_host));
  if (!host) return NULL;
  host->window = window;
  host->count = count;
  host->columns = columns < count ? columns : count;
  host->rows = (count + host->columns - 1) / host->columns;
  host->hovered = -1;
  host->dirty = 1;
  memcpy(host->plots, plots, (size_t)count * sizeof(ph_plot));

  host->clear_color =
      (void(PH_CALL*)(float, float, float, float))glfwGetProcAddress("glClearColor");
  host->clear = (void(PH_CALL*)(unsigned))glfwGetProcAddress("glClear");

  g_hosts[slot] = host;

  host->previous_cursor_pos = glfwSetCursorPosCallback(window, on_cursor_pos);
  host->previous_mouse_button = glfwSetMouseButtonCallback(window, on_mouse_button);
  host->previous_scroll = glfwSetScrollCallback(window, on_scroll);
  host->previous_cursor_enter = glfwSetCursorEnterCallback(window, on_cursor_enter);
  host->previous_framebuffer_size = glfwSetFramebufferSizeCallback(window, on_framebuffer_size);
  host->previous_window_size = glfwSetWindowSizeCallback(window, on_window_size);

  refresh_geometry(host);
  return host;
}

void ph_glfw_host_destroy(ph_glfw_host* host) {
  if (!host) return;
  glfwSetCursorPosCallback(host->window, host->previous_cursor_pos);
  glfwSetMouseButtonCallback(host->window, host->previous_mouse_button);
  glfwSetScrollCallback(host->window, host->previous_scroll);
  glfwSetCursorEnterCallback(host->window, host->previous_cursor_enter);
  glfwSetFramebufferSizeCallback(host->window, host->previous_framebuffer_size);
  glfwSetWindowSizeCallback(host->window, host->previous_window_size);

  for (int i = 0; i < PH_GLFW_MAX_HOSTS; i++) {
    if (g_hosts[i] == host) g_hosts[i] = NULL;
  }
  free(host);
}

int ph_glfw_host_dirty(const ph_glfw_host* host) {
  if (!host) return 0;
  if (host->dirty) return 1;
  for (int i = 0; i < host->count; i++) {
    if (ph_plot_needs_redraw(host->plots[i])) return 1;
  }
  return 0;
}

ph_plot ph_glfw_host_hovered(const ph_glfw_host* host) {
  if (!host || host->hovered < 0) return PH_NULL_HANDLE;
  return host->plots[host->hovered];
}

int ph_glfw_host_draw(ph_glfw_host* host) {
  if (!host) return 0;
  if (host->framebuffer_width <= 0 || host->framebuffer_height <= 0) return 1;

  if (host->clear_color && host->clear) {
    host->clear_color(0.0f, 0.0f, 0.0f, 0.0f);
    host->clear(GL_COLOR_BUFFER_BIT);
  }

  const double cw = cell_width(host);
  const double ch = cell_height(host);
  const double dpr = host->dpr;

  for (int i = 0; i < host->count; i++) {
    const int column = i % host->columns;
    const int row = i / host->columns;

    ph_frame_target target;
    ph_frame_target_init(&target);
    target.framebuffer = 0; /* the window's own */
    target.x = (int32_t)lround(column * cw * dpr);
    target.width = (int32_t)lround((column + 1) * cw * dpr) - target.x;
    /* GL's origin is bottom-left, so the top row of cells is the high y. */
    const int32_t top = (int32_t)lround(row * ch * dpr);
    const int32_t bottom = (int32_t)lround((row + 1) * ch * dpr);
    target.y = (int32_t)host->framebuffer_height - bottom;
    target.height = bottom - top;
    target.dpr = host->dpr;
    target.flip_y = 0;

    if (ph_plot_render(host->plots[i], &target) != PH_OK) return 0;
  }

  glfwSwapBuffers(host->window);
  host->dirty = 0;
  drain_events(host);
  /* Rendering itself queues a redraw request in some paths; the frame just
   * drawn satisfies it, so the flag is cleared after the drain, not before. */
  host->dirty = 0;
  return 1;
}
