# The Qt host: a QQuickFramebufferObject item for QML, a QOpenGLWidget for
# Widgets, and a gallery for each.
#
# Unlike the GLFW host this does not fetch anything — Qt is far too large to
# pull into a build, and anyone targeting Qt already has it. `find_package` is
# REQUIRED, so turning PHOTON_BUILD_QT_HOST on without Qt 6 fails at configure
# time with Qt's own message rather than a link error later.

# 6.4 rather than 6.5, which is what the first CI run cost: Ubuntu's current
# LTS ships Qt 6.4.2, and nothing in this host actually needs anything newer.
# Requiring a version because it happened to be the one on the author's machine
# is how a dependency floor ends up higher than the code's.
find_package(Qt6 6.4 REQUIRED COMPONENTS Core Gui Quick Qml Widgets OpenGLWidgets)

qt_standard_project_setup()

# ---------------------------------------------------------------------------
# The QML item, as a proper QML module
# ---------------------------------------------------------------------------

# STATIC so the generated plugin is a static library the gallery can link.
# Left to itself qt_add_qml_module makes it a MODULE, which is meant to be
# loaded from a plugin path at run time — the wrong shape for an app that
# should just run out of its build directory.
qt_add_qml_module(photon_qt_quick
  URI Photon
  VERSION 1.0
  STATIC
  SOURCES
    photonplotitem.h
    photonplotitem.cpp
  QML_FILES
    Main.qml
)
target_link_libraries(photon_qt_quick
  PUBLIC photon::photon photon_panels Qt6::Quick Qt6::Qml Qt6::Gui
)
target_include_directories(photon_qt_quick PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

qt_add_executable(photon_gallery_qml gallery_quick.cpp)
target_link_libraries(photon_gallery_qml PRIVATE photon_qt_quickplugin Qt6::Quick)

# ---------------------------------------------------------------------------
# The widget
# ---------------------------------------------------------------------------

qt_add_library(photon_qt_widgets STATIC
  photonplotwidget.h
  photonplotwidget.cpp
)
target_link_libraries(photon_qt_widgets
  PUBLIC photon::photon photon_panels Qt6::Widgets Qt6::OpenGLWidgets Qt6::Gui
)
target_include_directories(photon_qt_widgets PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

qt_add_executable(photon_gallery_widgets gallery_widgets.cpp)
target_link_libraries(photon_gallery_widgets PRIVATE photon_qt_widgets)

if(MSVC)
  foreach(target photon_qt_quick photon_qt_widgets photon_gallery_widgets)
    target_compile_options(${target} PRIVATE /W4 /utf-8)
  endforeach()
else()
  foreach(target photon_qt_quick photon_qt_widgets photon_gallery_widgets)
    target_compile_options(${target} PRIVATE -Wall -Wextra)
  endforeach()
endif()

# On Windows the DLL has to sit beside the .exe.
if(WIN32 AND PHOTON_BUILD_SHARED)
  foreach(target photon_gallery_qml photon_gallery_widgets)
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
              $<TARGET_FILE:photon> $<TARGET_FILE_DIR:${target}>
    )
  endforeach()
endif()
