#include "photonplotitem.h"

#include <QDateTime>
#include <QHoverEvent>
#include <QMouseEvent>
#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QOpenGLFramebufferObjectFormat>
#include <QOpenGLFunctions>
#include <QQuickWindow>
#include <QWheelEvent>

extern "C" {
#include "panels.h"
}

namespace {

/// One notch of a mouse wheel, in Qt's eighths of a degree.
constexpr double kNotch = 120.0;
/// What the browser reports for that same notch, and what the core expects.
constexpr double kBrowserNotch = 100.0;

/**
 * Resolve GL entry points through whatever context Qt has made current.
 *
 * Qt hands back a `QFunctionPointer`; the ABI wants a `void*`. Converting
 * between the two is conditionally supported in C++ rather than guaranteed, but
 * it is what every GL loader on every platform we target does, and there is no
 * portable alternative that a C ABI can express.
 */
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

/**
 * The render-thread half.
 *
 * Everything here — the plot, its layers, its GL objects — is created, used and
 * destroyed on Qt's render thread, which is the only thread where the scene
 * graph's GL context is current.
 */
class PhotonPlotRenderer : public QQuickFramebufferObject::Renderer {
 public:
  ~PhotonPlotRenderer() override {
    if (m_plot != PH_NULL_HANDLE) ph_plot_destroy(m_plot);
    if (m_panels) ph_panels_free(m_panels);
  }

  QOpenGLFramebufferObject* createFramebufferObject(const QSize& size) override {
    QOpenGLFramebufferObjectFormat format;
    // No depth or stencil: the 2D path disables the depth test, and the
    // overlay and the layers both blend rather than test.
    format.setAttachment(QOpenGLFramebufferObject::NoAttachment);
    format.setSamples(0);
    m_size = size;
    return new QOpenGLFramebufferObject(size, format);
  }

  /**
   * The one safe moment. Qt calls this on the render thread with the GUI thread
   * blocked, so it is where — and only where — the item's state reaches the
   * plot and the plot's events reach the item.
   */
  void synchronize(QQuickFramebufferObject* object) override {
    auto* item = static_cast<PhotonPlotItem*>(object);

    if (!m_initialized) {
      ph_host_desc host;
      ph_host_desc_init(&host);
      host.api = PH_GFX_GL33;
      host.get_proc_address = resolveGl;
      // Idempotent, so several items each doing this is fine.
      m_initialized = ph_init(PHOTON_ABI_VERSION, &host) == PH_OK;
      if (!m_initialized) {
        qWarning("photon: ph_init failed: %s", ph_last_error());
        return;
      }
    }

    if (m_plot == PH_NULL_HANDLE || m_panel != item->m_panel) {
      rebuild(item->m_panel);
      if (m_plot == PH_NULL_HANDLE) return;
    }

    m_dpr = item->window() ? item->window()->effectiveDevicePixelRatio() : 1.0;
    ph_plot_set_size(m_plot, static_cast<int32_t>(qRound(item->width())),
                     static_cast<int32_t>(qRound(item->height())));
    ph_plot_set_theme(m_plot, item->m_theme == PhotonPlotItem::Light ? PH_THEME_LIGHT
                                                                    : PH_THEME_DARK);
    ph_plot_set_mode(m_plot, static_cast<ph_mode>(item->m_mode));

    for (const PhotonPlotItem::Input& input : item->m_pending) {
      switch (input.kind) {
        case PhotonPlotItem::Input::Press:
          ph_plot_pointer_down(m_plot, input.px, input.py, input.button, input.mods);
          break;
        case PhotonPlotItem::Input::Move:
          ph_plot_pointer_move(m_plot, input.px, input.py, input.mods);
          break;
        case PhotonPlotItem::Input::Release:
          ph_plot_pointer_up(m_plot, input.px, input.py, input.button, input.mods);
          break;
        case PhotonPlotItem::Input::Leave:
          ph_plot_pointer_leave(m_plot);
          break;
        case PhotonPlotItem::Input::Wheel:
          ph_plot_wheel(m_plot, input.px, input.py, input.delta, input.mods);
          break;
      }
    }
    item->m_pending.clear();

    if (item->m_resetRequested) {
      ph_plot_reset_view(m_plot);
      item->m_resetRequested = false;
    }

    if (item->m_animating) {
      const qint64 now = QDateTime::currentMSecsSinceEpoch();
      ph_panels_advance(m_panels, static_cast<double>(now - item->m_startedAt) / 1000.0);
    }

    // Drained here because this is the only place the plot may be touched at
    // all. The signal goes out from the render thread, so Qt queues it and the
    // GUI thread receives it shortly after — which is why a caller must never
    // connect to it with Qt::DirectConnection.
    ph_event event;
    while (ph_plot_poll_event(m_plot, &event) == PH_OK && event.type != PH_EVENT_NONE) {
      if (event.type == PH_EVENT_VIEW_CHANGED) {
        emit item->viewChanged(event.x.lo, event.x.hi, event.y.lo, event.y.hi);
      }
    }
  }

  void render() override {
    if (m_plot == PH_NULL_HANDLE) return;

    QOpenGLFunctions* gl = QOpenGLContext::currentContext()->functions();
    gl->glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
    gl->glClear(GL_COLOR_BUFFER_BIT);

    ph_frame_target target;
    ph_frame_target_init(&target);
    target.framebuffer = framebufferObject()->handle();
    target.width = m_size.width();
    target.height = m_size.height();
    target.dpr = static_cast<float>(m_dpr);
    // Qt's FBO is an ordinary bottom-left-origin GL framebuffer, so this is 0.
    // What Qt does *not* do by default is flip the texture when it composites
    // the item, which is why the constructor calls setMirrorVertically(true).
    // Photon's own flip_y would also produce an upright chart, at the cost of an
    // extra full-frame blit — letting Qt fold the flip into a composite it was
    // going to do anyway is free. Both were tried; see hosts/qt/README.md.
    target.flip_y = 0;

    if (ph_plot_render(m_plot, &target) != PH_OK) {
      qWarning("photon: render failed: %s", ph_last_error());
    }
  }

 private:
  void rebuild(int panel) {
    if (m_plot != PH_NULL_HANDLE) {
      ph_plot_destroy(m_plot);
      m_plot = PH_NULL_HANDLE;
    }
    if (!m_panels) {
      m_panels = ph_panels_create();
      if (!m_panels) return;
    }

    ph_plot_desc desc;
    ph_plot_desc_init(&desc);
    ph_color_parse("#0f172a", &desc.background);
    if (ph_plot_create(&desc, &m_plot) != PH_OK) {
      qWarning("photon: ph_plot_create failed: %s", ph_last_error());
      m_plot = PH_NULL_HANDLE;
      return;
    }
    ph_panels_build(m_panels, m_plot, panel);
    m_panel = panel;
  }

  ph_plot m_plot = PH_NULL_HANDLE;
  ph_panels* m_panels = nullptr;
  int m_panel = -1;
  QSize m_size;
  qreal m_dpr = 1.0;
  bool m_initialized = false;
};

// ---------------------------------------------------------------------------
// The GUI-thread half
// ---------------------------------------------------------------------------

PhotonPlotItem::PhotonPlotItem(QQuickItem* parent) : QQuickFramebufferObject(parent) {
  setAcceptedMouseButtons(Qt::AllButtons);
  setAcceptHoverEvents(true);
  // Without this the chart is upside down: Qt composites the item's FBO texture
  // as-is, and a GL framebuffer's first row is its bottom one.
  setMirrorVertically(true);
  m_startedAt = QDateTime::currentMSecsSinceEpoch();
  m_animationTimer = startTimer(16);
}

PhotonPlotItem::~PhotonPlotItem() = default;

QQuickFramebufferObject::Renderer* PhotonPlotItem::createRenderer() const {
  return new PhotonPlotRenderer;
}

void PhotonPlotItem::setPanel(int panel) {
  if (m_panel == panel) return;
  m_panel = panel;
  emit panelChanged();
  update();
}

void PhotonPlotItem::setTheme(Theme theme) {
  if (m_theme == theme) return;
  m_theme = theme;
  emit themeChanged();
  update();
}

void PhotonPlotItem::setMode(Mode mode) {
  if (m_mode == mode) return;
  m_mode = mode;
  emit modeChanged();
  update();
}

void PhotonPlotItem::setAnimating(bool on) {
  if (m_animating == on) return;
  m_animating = on;
  emit animatingChanged();
  update();
}

void PhotonPlotItem::resetView() {
  m_resetRequested = true;
  update();
}

void PhotonPlotItem::queue(const Input& input) {
  // Bounded for the same reason the core's event queue is: a host that stops
  // rendering must not turn a mouse move into a leak.
  if (m_pending.size() > 512) m_pending.removeFirst();
  m_pending.append(input);
  update();
}

void PhotonPlotItem::mousePressEvent(QMouseEvent* event) {
  Input input;
  input.kind = Input::Press;
  input.px = event->position().x();
  input.py = event->position().y();
  input.button = translateButton(event->button());
  input.mods = translateMods(event->modifiers());
  queue(input);
  event->accept();
}

void PhotonPlotItem::mouseMoveEvent(QMouseEvent* event) {
  Input input;
  input.kind = Input::Move;
  input.px = event->position().x();
  input.py = event->position().y();
  input.mods = translateMods(event->modifiers());
  queue(input);
  event->accept();
}

void PhotonPlotItem::mouseReleaseEvent(QMouseEvent* event) {
  Input input;
  input.kind = Input::Release;
  input.px = event->position().x();
  input.py = event->position().y();
  input.button = translateButton(event->button());
  input.mods = translateMods(event->modifiers());
  queue(input);
  event->accept();
}

void PhotonPlotItem::hoverMoveEvent(QHoverEvent* event) {
  Input input;
  input.kind = Input::Move;
  input.px = event->position().x();
  input.py = event->position().y();
  input.mods = translateMods(event->modifiers());
  queue(input);
}

void PhotonPlotItem::hoverLeaveEvent(QHoverEvent* event) {
  Q_UNUSED(event);
  Input input;
  input.kind = Input::Leave;
  queue(input);
}

void PhotonPlotItem::wheelEvent(QWheelEvent* event) {
  Input input;
  input.kind = Input::Wheel;
  input.px = event->position().x();
  input.py = event->position().y();
  input.mods = translateMods(event->modifiers());

  // Qt reports wheels positive *away from the user* and trackpads in pixels;
  // the core follows the browser's WheelEvent.deltaY, positive *downward* and
  // roughly 100 per notch. Both signs and both scales have to be corrected, and
  // getting it wrong is not a crash — it is a zoom that feels inverted or
  // wrong-speed next to the same chart on the web.
  const QPoint pixels = event->pixelDelta();
  if (!pixels.isNull()) {
    input.delta = -pixels.y();
  } else {
    input.delta = -event->angleDelta().y() / kNotch * kBrowserNotch;
  }
  queue(input);
  event->accept();
}

void PhotonPlotItem::timerEvent(QTimerEvent* event) {
  if (event->timerId() != m_animationTimer) {
    QQuickFramebufferObject::timerEvent(event);
    return;
  }
  if (m_animating) update();
}
