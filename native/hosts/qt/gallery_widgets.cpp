/*
 * The Qt Widgets gallery — the same nineteen charts, in QOpenGLWidgets.
 *
 * Shorter than the Quick one by roughly the size of a thread boundary.
 */

#include <QApplication>
#include <QPixmap>
#include <QTimer>
#include <QGridLayout>
#include <QLabel>
#include <QMainWindow>
#include <QStatusBar>
#include <QSurfaceFormat>
#include <QToolBar>
#include <QWidget>

extern "C" {
#include "panels.h"
}

#include "photonplotwidget.h"

int main(int argc, char** argv) {
  QSurfaceFormat format;
  format.setRenderableType(QSurfaceFormat::OpenGL);
  format.setVersion(3, 3);
  format.setProfile(QSurfaceFormat::CoreProfile);
  format.setAlphaBufferSize(8);
  QSurfaceFormat::setDefaultFormat(format);

  QApplication app(argc, argv);

  QMainWindow window;
  window.setWindowTitle("Photon — Qt Widgets gallery");
  window.resize(1280, 800);

  auto* central = new QWidget;
  auto* grid = new QGridLayout(central);
  grid->setContentsMargins(6, 6, 6, 6);
  grid->setSpacing(6);

  QList<PhotonPlotWidget*> plots;
  for (int i = 0; i < PH_PANEL_COUNT; ++i) {
    auto* plot = new PhotonPlotWidget(i);
    plots.append(plot);
    grid->addWidget(plot, i / 5, i % 5);
  }
  window.setCentralWidget(central);

  auto* readout = new QLabel("drag to pan · wheel to zoom");
  window.statusBar()->addPermanentWidget(readout);
  for (PhotonPlotWidget* plot : plots) {
    QObject::connect(plot, &PhotonPlotWidget::viewChanged, readout,
                     [readout](double xLo, double xHi, double, double) {
                       readout->setText(QStringLiteral("x [%1, %2]")
                                            .arg(xLo, 0, 'f', 2)
                                            .arg(xHi, 0, 'f', 2));
                     });
  }

  auto* toolbar = window.addToolBar("View");
  bool* dark = new bool(true);
  bool* animating = new bool(true);
  toolbar->addAction("Pan", [&plots] {
    for (PhotonPlotWidget* plot : plots) plot->setMode(PH_MODE_PAN);
  });
  toolbar->addAction("Box zoom", [&plots] {
    for (PhotonPlotWidget* plot : plots) plot->setMode(PH_MODE_BOX);
  });
  toolbar->addAction("Reset", [&plots] {
    for (PhotonPlotWidget* plot : plots) plot->resetView();
  });
  toolbar->addAction("Pause / play", [&plots, animating] {
    *animating = !*animating;
    for (PhotonPlotWidget* plot : plots) plot->setAnimating(*animating);
  });
  toolbar->addAction("Light / dark", [&plots, dark] {
    *dark = !*dark;
    for (PhotonPlotWidget* plot : plots) plot->setTheme(*dark ? PH_THEME_DARK : PH_THEME_LIGHT);
  });

  window.show();

  // Same `--grab <file.png>` as the Quick gallery, for the same reason: the
  // comparison against the web gallery should be an image diff, not a squint.
  const QStringList arguments = app.arguments();
  const int grabIndex = arguments.indexOf(QStringLiteral("--grab"));
  if (grabIndex > 0 && grabIndex + 1 < arguments.size()) {
    const QString path = arguments.at(grabIndex + 1);
    QTimer::singleShot(1200, &window, [&window, path] {
      if (!window.grab().save(path)) {
        qWarning("could not write %s", qPrintable(path));
        QCoreApplication::exit(1);
        return;
      }
      QCoreApplication::quit();
    });
  }

  return app.exec();
}
