# The Qt host

Two ways to put a Photon plot in a Qt application, and one gallery for each.

| | |
| --- | --- |
| `photonplotitem.{h,cpp}` | `PhotonPlot`, a `QQuickFramebufferObject` for QML |
| `photonplotwidget.{h,cpp}` | `PhotonPlotWidget`, a `QOpenGLWidget` for Qt Widgets |
| `Main.qml` + `gallery_quick.cpp` | the Quick gallery |
| `gallery_widgets.cpp` | the Widgets gallery |

```bash
cmake -S . -B build/qt -DPHOTON_BUILD_QT_HOST=ON
cmake --build build/qt
./build/qt/bin/photon_gallery_qml
./build/qt/bin/photon_gallery_widgets
```

Both accept `--grab <file.png>`: render, write the window to disk, exit. That is
how the Qt output gets compared against `examples/vanilla` as an image rather
than by eye.

Qt is `find_package`d, not fetched — anyone targeting Qt already has it, and it
is far too large to pull into a build. Requires Qt 6.4+, which is what Ubuntu's
current LTS ships; the floor started at 6.5 for no better reason than the
version on the machine it was written on, and CI said so.

## Why this host exists

Not to ship a Qt widget. To find out what the ABI got wrong.

The second host is the one that tests the first host's abstraction, and this one
found four things. Three were bugs, and two of those were in the *engine*, not
in Qt.

### The decimal separator

Qt calls `setlocale(LC_ALL, "")` before `main()` runs. Every `printf`-family
conversion then follows the desktop's locale — so on a Turkish or German machine
the identical build that printed `0.5` under GLFW printed `0,5` under Qt, while
the web core printed `0.5` everywhere, because JavaScript has no locale to
consult. Fixed by moving tick formatting to `std::to_chars`, which is specified
to behave as printf does *in the C locale*. `tests/scale_test.cpp` now sets a
comma-decimal locale and checks the labels.

This is the single best argument for building a second host: a chart looked
right in every test and on every screenshot, and was wrong for most of Europe.

### `flip_y`

Faz 0 added `ph_frame_target.flip_y` on the assumption that "Qt's FBOs are
top-left origin". They are not — a `QQuickFramebufferObject`'s FBO is an
ordinary bottom-left-origin GL framebuffer. What Qt does differently is *not
mirror* the texture when it composites the item, so a correctly rendered frame
appears upside down. The fix is Qt's own knob, `setMirrorVertically(true)`,
which folds the flip into a composite Qt was going to do anyway.

Worse, the flag as implemented was incorrect: it moved the plot region and the
overlay's pixel transform but left the layers drawing upright, so a host that
set it would have got right-way-up axes over upside-down data — a failure that
looks like a data bug, not a host bug. It is now one flipped `glBlitFramebuffer`
of the finished frame, which no future layer can forget to honour, and
`tests/gl_smoke_test.c` renders the same chart both ways and checks that one is
the mirror of the other.

### The wheel

Qt reports wheels in eighths of a degree, positive *away from the user*, and
trackpads in pixels. The core follows the browser's `WheelEvent.deltaY`,
positive *downward*, about 100 per notch. Both the sign and the scale have to be
corrected. Nothing crashes if you get it wrong; the zoom just feels inverted or
wrong-speed next to the same chart on the web, which is the kind of bug that
survives a long time.

### Clearing

The Quick item clears to nothing and composites onto the QML window, which is
itself themed. The widget clears to the *chart's* page colour instead, because a
`QOpenGLWidget` composites onto whatever the palette put behind it, and the
chart's title and labels are coloured for the chart's theme, not the desktop's.
Neither is more correct; they are different hosts.

## Threading, which is the actual work

`QQuickFramebufferObject` renders on Qt's **render thread**. QML, properties and
mouse events all live on the **GUI thread**. A plot belongs to the thread that
created it — `ph_plot_render` returns `PH_E_WRONG_THREAD` from anywhere else —
so the plot is created inside the `Renderer`, on the render thread, and every
interaction the item collects has to cross a thread boundary to reach it.

`Renderer::synchronize()` is the crossing point: Qt calls it on the render
thread *while the GUI thread is blocked*. That is the one moment both sides can
be touched safely, so it is the only moment either is touched. The item appends
input to a queue; `synchronize()` drains the queue into the plot, pushes down
size, theme and mode, and drains the plot's event queue back out. Nothing else
reaches across.

The `viewChanged` signal is emitted from the render thread, so Qt queues it and
the GUI thread receives it shortly after. **Never connect to it with
`Qt::DirectConnection`** — that would run the slot on the render thread.

`QOpenGLWidget` has none of this: it renders on the GUI thread, so the widget
creates, feeds and draws its plot in one place. The contrast is the point.

## Two things a Qt host must do

```cpp
QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
```

Qt 6 defaults to its RHI abstraction and is free to pick Vulkan, Metal or D3D,
in which case there is no GL context to hand the engine and
`QQuickFramebufferObject` does not work at all. Call it before the first window
is created.

```cpp
QSurfaceFormat format;
format.setVersion(3, 3);
format.setProfile(QSurfaceFormat::CoreProfile);
QSurfaceFormat::setDefaultFormat(format);
```

The shaders are written against GL 3.3 core.

## Known gaps

- One panel per item. `PhotonPlot.panel` picks from the shared demo charts in
  `hosts/common/panels.c`; there is no API for a host to build its own series
  from QML yet, because that needs the same `synchronize()` treatment as input
  and is a larger design than a reference host should invent alone.
- Changing `panel` destroys and rebuilds the plot rather than swapping layers.
- If Qt drops and recreates the scene graph — a hidden window, a lost context —
  the `Renderer` goes with it and the plot is rebuilt from scratch, losing the
  current view. A real host should save and restore the domains around that.
