// A Photon plot as a QML item.
//
// The whole difficulty of this host is threading, and it is worth stating up
// front. QQuickFramebufferObject renders on Qt's *render thread*, which is not
// the GUI thread where QML lives and where mouse events arrive. A plot belongs
// to the thread that created it — `ph_plot_render` returns PH_E_WRONG_THREAD
// from anywhere else — so the plot is created inside the Renderer, and every
// interaction the item collects has to cross a thread boundary to reach it.
//
// The crossing point is `Renderer::synchronize()`, which Qt calls on the render
// thread *while the GUI thread is blocked*. That is the one moment both sides
// can be touched safely, so it is the only moment either side is touched: the
// item queues input, synchronize() drains the queue into the plot, and nothing
// else reaches across.
#pragma once

#include <photon/photon.h>

#include <QList>
#include <QQuickFramebufferObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

class PhotonPlotItem : public QQuickFramebufferObject {
  Q_OBJECT
  QML_NAMED_ELEMENT(PhotonPlot)

  /// Which of the shared demo charts (hosts/common/panels.c) to build.
  Q_PROPERTY(int panel READ panel WRITE setPanel NOTIFY panelChanged)
  Q_PROPERTY(Theme theme READ theme WRITE setTheme NOTIFY themeChanged)
  Q_PROPERTY(Mode mode READ mode WRITE setMode NOTIFY modeChanged)
  /// Drives the streaming panel. Costs a frame per tick, so it is opt-out.
  Q_PROPERTY(bool animating READ animating WRITE setAnimating NOTIFY animatingChanged)

 public:
  enum Theme { Dark = 0, Light = 1 };
  Q_ENUM(Theme)

  enum Mode { Pan = 0, Box = 1, BoxX = 2, BoxY = 3 };
  Q_ENUM(Mode)

  explicit PhotonPlotItem(QQuickItem* parent = nullptr);
  ~PhotonPlotItem() override;

  Renderer* createRenderer() const override;

  int panel() const { return m_panel; }
  void setPanel(int panel);
  Theme theme() const { return m_theme; }
  void setTheme(Theme theme);
  Mode mode() const { return m_mode; }
  void setMode(Mode mode);
  bool animating() const { return m_animating; }
  void setAnimating(bool on);

  /// Restore the domains the plot was created with.
  Q_INVOKABLE void resetView();

 signals:
  void panelChanged();
  void themeChanged();
  void modeChanged();
  void animatingChanged();
  /// Emitted after a frame in which the view moved. Coordinates are data space.
  void viewChanged(double xLo, double xHi, double yLo, double yHi);

 protected:
  void mousePressEvent(QMouseEvent* event) override;
  void mouseMoveEvent(QMouseEvent* event) override;
  void mouseReleaseEvent(QMouseEvent* event) override;
  void hoverMoveEvent(QHoverEvent* event) override;
  void hoverLeaveEvent(QHoverEvent* event) override;
  void wheelEvent(QWheelEvent* event) override;
  void timerEvent(QTimerEvent* event) override;

 private:
  friend class PhotonPlotRenderer;

  /// One queued interaction. Flat rather than a QEvent subclass because it has
  /// to survive being read on another thread with no Qt event loop involved.
  struct Input {
    enum Kind { Press, Move, Release, Leave, Wheel } kind;
    double px = 0.0;
    double py = 0.0;
    ph_button button = PH_BUTTON_LEFT;
    ph_modifiers mods = PH_MOD_NONE;
    double delta = 0.0;
  };

  void queue(const Input& input);

  QList<Input> m_pending;
  int m_panel = 0;
  Theme m_theme = Dark;
  Mode m_mode = Pan;
  bool m_animating = true;
  bool m_resetRequested = false;
  int m_animationTimer = 0;
  qint64 m_startedAt = 0;
};
