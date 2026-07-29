/*
 * The GLFW gallery: fourteen charts in one window, one GL context, one swap.
 *
 * The charts themselves come from hosts/common/panels.c, shared verbatim with
 * the Qt galleries — so anything that looks different between the two hosts is
 * the host's fault, not the chart's. This file is only windowing.
 *
 *   drag             pan          wheel      zoom about the cursor
 *   B                box zoom     P          back to pan
 *   R                reset view   T          light / dark
 *   space            pause the streaming panel
 */

#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#include <photon/photon.h>
#include <stdio.h>

#include "panels.h"
#include "photon_glfw.h"

static ph_plot g_plots[PH_PANEL_COUNT];
static ph_panels* g_panels = NULL;
static int g_theme = PH_THEME_DARK;
static int g_paused = 0;

static void* PH_CALL resolve_gl(const char* name, void* user) {
  (void)user;
  /* Every GL loader in existence hands entry points back as void*, but ISO C
   * does not promise a function pointer survives the trip through one — so the
   * conversion goes through a union rather than a cast. */
  union {
    GLFWglproc function;
    void* object;
  } bridge;
  bridge.function = glfwGetProcAddress(name);
  return bridge.object;
}

static void on_key(GLFWwindow* window, int key, int scancode, int action, int mods) {
  (void)scancode;
  (void)mods;
  if (action != GLFW_PRESS) return;
  switch (key) {
    case GLFW_KEY_ESCAPE:
      glfwSetWindowShouldClose(window, GLFW_TRUE);
      break;
    case GLFW_KEY_R:
      for (int i = 0; i < PH_PANEL_COUNT; i++) ph_plot_reset_view(g_plots[i]);
      break;
    case GLFW_KEY_B:
      for (int i = 0; i < PH_PANEL_COUNT; i++) ph_plot_set_mode(g_plots[i], PH_MODE_BOX);
      break;
    case GLFW_KEY_P:
      for (int i = 0; i < PH_PANEL_COUNT; i++) ph_plot_set_mode(g_plots[i], PH_MODE_PAN);
      break;
    case GLFW_KEY_T:
      g_theme = g_theme == PH_THEME_DARK ? PH_THEME_LIGHT : PH_THEME_DARK;
      for (int i = 0; i < PH_PANEL_COUNT; i++) ph_plot_set_theme(g_plots[i], g_theme);
      break;
    case GLFW_KEY_SPACE:
      g_paused = !g_paused;
      break;
    default:
      break;
  }
}

static void on_glfw_error(int code, const char* description) {
  fprintf(stderr, "glfw error %d: %s\n", code, description);
}

int main(void) {
  glfwSetErrorCallback(on_glfw_error);
  if (!glfwInit()) {
    fprintf(stderr, "could not initialize GLFW\n");
    return 1;
  }

  glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
  glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
  glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
  glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
  glfwWindowHint(GLFW_SCALE_TO_MONITOR, GLFW_TRUE);
  glfwWindowHint(GLFW_SAMPLES, 0);

  GLFWwindow* window = glfwCreateWindow(1280, 800, "Photon — native gallery", NULL, NULL);
  if (!window) {
    fprintf(stderr, "could not create a GL 3.3 core window\n");
    glfwTerminate();
    return 1;
  }
  glfwMakeContextCurrent(window);
  glfwSwapInterval(1);
  glfwSetKeyCallback(window, on_key);

  ph_host_desc host_desc;
  ph_host_desc_init(&host_desc);
  host_desc.api = PH_GFX_GL33;
  host_desc.get_proc_address = resolve_gl;
  if (ph_init(PHOTON_ABI_VERSION, &host_desc) != PH_OK) {
    fprintf(stderr, "ph_init failed: %s\n", ph_last_error());
    return 1;
  }

  g_panels = ph_panels_create();
  if (!g_panels) return 1;

  ph_plot_desc plot_desc;
  ph_plot_desc_init(&plot_desc);
  plot_desc.theme = g_theme;
  ph_color_parse("#0f172a", &plot_desc.background);
  for (int i = 0; i < PH_PANEL_COUNT; i++) {
    if (ph_plot_create(&plot_desc, &g_plots[i]) != PH_OK) {
      fprintf(stderr, "ph_plot_create failed: %s\n", ph_last_error());
      return 1;
    }
    ph_panels_build(g_panels, g_plots[i], i);
  }

  ph_glfw_host* host = ph_glfw_host_create(window, g_plots, PH_PANEL_COUNT, 5);
  if (!host) {
    fprintf(stderr, "could not attach the plots to the window\n");
    return 1;
  }

  while (!glfwWindowShouldClose(window)) {
    if (!g_paused) ph_panels_advance(g_panels, glfwGetTime());

    if (!ph_glfw_host_draw(host)) {
      fprintf(stderr, "render failed: %s\n", ph_last_error());
      break;
    }

    /* An animating panel means there is always another frame owed; when it is
     * paused the loop goes to sleep until something actually happens. */
    if (g_paused && !ph_glfw_host_dirty(host)) {
      glfwWaitEvents();
    } else {
      glfwPollEvents();
    }
  }

  ph_glfw_host_destroy(host);
  ph_panels_free(g_panels);
  ph_shutdown();
  glfwDestroyWindow(window);
  glfwTerminate();
  return 0;
}
