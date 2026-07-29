/*
 * The Qt Quick gallery.
 *
 * Two lines here matter more than the rest of the file. `setGraphicsApi` pins
 * the scene graph to OpenGL: Qt 6 defaults to its RHI abstraction and is free
 * to pick Vulkan, Metal or D3D, in which case there is no GL context to hand
 * the engine and QQuickFramebufferObject does not work at all. And the surface
 * format asks for a 3.3 core context, which is the one the shaders are written
 * against.
 */

#include <QGuiApplication>
#include <QImage>
#include <QQmlApplicationEngine>
#include <QUrl>
#include <QQuickWindow>
#include <QSurfaceFormat>
#include <QTimer>

int main(int argc, char** argv) {
  QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);

  QSurfaceFormat format;
  format.setRenderableType(QSurfaceFormat::OpenGL);
  format.setVersion(3, 3);
  format.setProfile(QSurfaceFormat::CoreProfile);
  format.setAlphaBufferSize(8);
  format.setDepthBufferSize(0);
  format.setStencilBufferSize(0);
  QSurfaceFormat::setDefaultFormat(format);

  QGuiApplication app(argc, argv);
  app.setApplicationName("Photon Qt gallery");

  QQmlApplicationEngine engine;
  // load(QUrl) rather than loadFromModule, which is nicer and is 6.5+. Ubuntu's
  // current LTS ships 6.4, and nothing else here needs anything newer, so the
  // older spelling is what keeps the floor where the code actually is. The
  // prefix is pinned in CMakeLists.txt because its default moved in 6.5.
  engine.load(QUrl(QStringLiteral("qrc:/Photon/Main.qml")));
  if (engine.rootObjects().isEmpty()) return 1;

  // `--grab <file.png>` renders a few frames, writes the window to disk and
  // exits. It exists so the Qt gallery and the web gallery can be diffed as
  // images rather than by eye — and it is the fastest way to catch the one
  // thing this host can get wrong invisibly, which is vertical orientation.
  const QStringList arguments = app.arguments();
  const int grabIndex = arguments.indexOf(QStringLiteral("--grab"));
  if (grabIndex > 0 && grabIndex + 1 < arguments.size()) {
    const QString path = arguments.at(grabIndex + 1);
    auto* window = qobject_cast<QQuickWindow*>(engine.rootObjects().first());
    if (!window) return 1;
    QTimer::singleShot(1200, window, [window, path] {
      const QImage image = window->grabWindow();
      if (!image.save(path)) {
        qWarning("could not write %s", qPrintable(path));
        QCoreApplication::exit(1);
        return;
      }
      QCoreApplication::quit();
    });
  }

  return app.exec();
}
