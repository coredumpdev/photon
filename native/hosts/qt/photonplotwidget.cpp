#include "photonplotwidget.h"

#include <QMouseEvent>
#include <QOpenGLContext>
#include <QOpenGLFunctions>
#include <QWheelEvent>

extern "C" {
#include "panels.h"
}

namespace {

constexpr double kNotch = 120.0;
constexpr double kBrowserNotch = 100.0;

void* PH_CALL resolveGl(const char* name, void* user) {
  Q_UNUSED(user);
  QOpenGLContext* context = QOpenGLContext::currentContext();
  if (!context) return nullptr;
  return reinterpret_cast<void*>(context->getProcAddress(name));
}

ph_modifiers translateMods(Qt::KeyboardModifiers qtMods) {
  ph_modifiers mods = PH_MOD_NONE;
  if (qtMods & Qt::ShiftModifier) mods |= PH_MOD_SHIFT;
  if (qtMods & Qt::ControlModifier) mods |= PH_MOD_CTRL;
  if (qtMods & Qt::AltModifier) mods |= PH_MOD_ALT;
  if (qtMods & Qt::MetaModifier) mods |= PH_MOD_SUPER;
  return mods;
}

ph_button translateButton(Qt::MouseButton button) {
  if (button == Qt::RightButton) return PH_BUTTON_RIGHT;
  if (button == Qt::MiddleButton) return PH_BUTTON_MIDDLE;
  return PH_BUTTON_LEFT;
}

}  // namespace

PhotonPlotWidget::PhotonPlotWidget(int panel, QWidget* parent)
    : QOpenGLWidget(parent), m_panel(panel) {
  setMouseTracking(true);
  m_clock.start();
  m_animationTimer = startTimer(16);
}

PhotonPlotWidget::~PhotonPlotWidget() {
  // GL objects can only be freed while the context that owns them is current,
  // and this is the last moment that is true.
  makeCurrent();
  if (m_plot != PH_NULL_HANDLE) ph_plot_destroy(m_plot);
  doneCurrent();
  if (m_panels) ph_panels_free(m_panels);
}

void PhotonPlotWidget::initializeGL() {
  ph_host_desc host;
  ph_host_desc_init(&host);
  host.api = PH_GFX_GL33;
  host.get_proc_address = resolveGl;
  if (ph_init(PHOTON_ABI_VERSION, &host) != PH_OK) {
    qWarning("photon: ph_init failed: %s", ph_last_error());
    return;
  }

  m_panels = ph_panels_create();
  if (!m_panels) return;

  ph_plot_desc desc;
  ph_plot_desc_init(&desc);
  desc.theme = m_theme;
  ph_color_parse("#0f172a", &desc.background);
  if (ph_plot_create(&desc, &m_plot) != PH_OK) {
    qWarning("photon: ph_plot_create failed: %s", ph_last_error());
    m_plot = PH_NULL_HANDLE;
    return;
  }
  ph_panels_build(m_panels, m_plot, m_panel);
  ph_plot_set_size(m_plot, width(), height());
}

void PhotonPlotWidget::resizeGL(int width, int height) {
  if (m_plot == PH_NULL_HANDLE) return;
  ph_plot_set_size(m_plot, width, height);
}

void PhotonPlotWidget::paintGL() {
  if (m_plot == PH_NULL_HANDLE) return;
  if (m_animating) ph_panels_advance(m_panels, m_clock.elapsed() / 1000.0);

  QOpenGLFunctions* gl = QOpenGLContext::currentContext()->functions();
  // The widget's page colour, not transparent. A QOpenGLWidget composites onto
  // whatever the palette put behind it, and the chart's furniture — its title,
  // its axis labels — is coloured for the *chart's* theme, not the desktop's.
  // The QML item does the opposite and clears to nothing, because there a QML
  // window sits behind it and is itself themed.
  if (m_theme == PH_THEME_LIGHT) {
    gl->glClearColor(0.973f, 0.980f, 0.988f, 1.0f);  // #f8fafc
  } else {
    gl->glClearColor(0.051f, 0.067f, 0.090f, 1.0f);  // #0d1117
  }
  gl->glClear(GL_COLOR_BUFFER_BIT);

  const qreal dpr = devicePixelRatioF();
  ph_frame_target target;
  ph_frame_target_init(&target);
  // QOpenGLWidget draws into an FBO of its own and composites it; the handle is
  // what it wants back, and 0 would be the window's, which is not ours to touch.
  target.framebuffer = static_cast<uint32_t>(defaultFramebufferObject());
  target.width = static_cast<int32_t>(qRound(width() * dpr));
  target.height = static_cast<int32_t>(qRound(height() * dpr));
  target.dpr = static_cast<float>(dpr);
  target.flip_y = 0;

  if (ph_plot_render(m_plot, &target) != PH_OK) {
    qWarning("photon: render failed: %s", ph_last_error());
  }
  drainEvents();
}

void PhotonPlotWidget::drainEvents() {
  ph_event event;
  bool redraw = false;
  while (ph_plot_poll_event(m_plot, &event) == PH_OK && event.type != PH_EVENT_NONE) {
    if (event.type == PH_EVENT_REDRAW_REQUESTED) redraw = true;
    if (event.type == PH_EVENT_VIEW_CHANGED) {
      emit viewChanged(event.x.lo, event.x.hi, event.y.lo, event.y.hi);
    }
  }
  if (redraw && !m_animating) update();
}

void PhotonPlotWidget::setTheme(ph_theme theme) {
  m_theme = theme;
  if (m_plot != PH_NULL_HANDLE) ph_plot_set_theme(m_plot, theme);
  update();
}

void PhotonPlotWidget::setMode(ph_mode mode) {
  m_mode = mode;
  if (m_plot != PH_NULL_HANDLE) ph_plot_set_mode(m_plot, mode);
  update();
}

void PhotonPlotWidget::resetView() {
  if (m_plot != PH_NULL_HANDLE) ph_plot_reset_view(m_plot);
  update();
}

void PhotonPlotWidget::setAnimating(bool on) {
  m_animating = on;
  update();
}

void PhotonPlotWidget::mousePressEvent(QMouseEvent* event) {
  if (m_plot == PH_NULL_HANDLE) return;
  ph_plot_pointer_down(m_plot, event->position().x(), event->position().y(),
                       translateButton(event->button()), translateMods(event->modifiers()));
  drainEvents();
  update();
}

void PhotonPlotWidget::mouseMoveEvent(QMouseEvent* event) {
  if (m_plot == PH_NULL_HANDLE) return;
  ph_plot_pointer_move(m_plot, event->position().x(), event->position().y(),
                       translateMods(event->modifiers()));
  drainEvents();
  update();
}

void PhotonPlotWidget::mouseReleaseEvent(QMouseEvent* event) {
  if (m_plot == PH_NULL_HANDLE) return;
  ph_plot_pointer_up(m_plot, event->position().x(), event->position().y(),
                     translateButton(event->button()), translateMods(event->modifiers()));
  drainEvents();
  update();
}

void PhotonPlotWidget::leaveEvent(QEvent* event) {
  Q_UNUSED(event);
  if (m_plot == PH_NULL_HANDLE) return;
  ph_plot_pointer_leave(m_plot);
  drainEvents();
  update();
}

void PhotonPlotWidget::wheelEvent(QWheelEvent* event) {
  if (m_plot == PH_NULL_HANDLE) return;
  // Same correction as the QML item and the GLFW host: Qt is positive away from
  // the user and counts eighths of a degree; the core follows the browser's
  // deltaY, positive downward at roughly 100 per notch.
  const QPoint pixels = event->pixelDelta();
  const double delta =
      !pixels.isNull() ? -pixels.y() : -event->angleDelta().y() / kNotch * kBrowserNotch;
  ph_plot_wheel(m_plot, event->position().x(), event->position().y(), delta,
                translateMods(event->modifiers()));
  drainEvents();
  update();
  event->accept();
}

void PhotonPlotWidget::timerEvent(QTimerEvent* event) {
  if (event->timerId() != m_animationTimer) {
    QOpenGLWidget::timerEvent(event);
    return;
  }
  if (m_animating) update();
}
