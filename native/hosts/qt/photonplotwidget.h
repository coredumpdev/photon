// A Photon plot as a QOpenGLWidget, for Qt Widgets applications.
//
// Worth having next to the QML item because it is the *simple* case, and the
// contrast is instructive: QOpenGLWidget renders on the GUI thread, so the plot
// is created, fed and drawn all in one place with no synchronization point and
// no queued input. Everything intricate about photonplotitem.cpp is Qt Quick's
// render thread, not Photon's ABI.
#pragma once

#include <photon/photon.h>

#include <QElapsedTimer>
#include <QOpenGLWidget>

struct ph_panels;

class PhotonPlotWidget : public QOpenGLWidget {
  Q_OBJECT

 public:
  explicit PhotonPlotWidget(int panel, QWidget* parent = nullptr);
  ~PhotonPlotWidget() override;

  void setTheme(ph_theme theme);
  void setMode(ph_mode mode);
  void resetView();
  void setAnimating(bool on);

 signals:
  void viewChanged(double xLo, double xHi, double yLo, double yHi);

 protected:
  void initializeGL() override;
  void paintGL() override;
  void resizeGL(int width, int height) override;

  void mousePressEvent(QMouseEvent* event) override;
  void mouseMoveEvent(QMouseEvent* event) override;
  void mouseReleaseEvent(QMouseEvent* event) override;
  void leaveEvent(QEvent* event) override;
  void wheelEvent(QWheelEvent* event) override;
  void timerEvent(QTimerEvent* event) override;

 private:
  /// Drain the plot's queue, turning redraw requests into update() calls.
  void drainEvents();

  int m_panel = 0;
  ph_plot m_plot = PH_NULL_HANDLE;
  ph_panels* m_panels = nullptr;
  ph_theme m_theme = PH_THEME_DARK;
  ph_mode m_mode = PH_MODE_PAN;
  bool m_animating = true;
  int m_animationTimer = 0;
  QElapsedTimer m_clock;
};
