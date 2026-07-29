// The QML gallery: the same six charts as the GLFW one, in a 3x2 grid.
//
// Each cell is a PhotonPlot, which is a QQuickFramebufferObject — so this is
// six independent plots, each on Qt's render thread, composited by the scene
// graph alongside ordinary QML controls.

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Photon

ApplicationWindow {
    id: window
    width: 1280
    height: 800
    visible: true
    title: "Photon — Qt Quick gallery"
    color: dark ? "#0d1117" : "#f8fafc"

    property bool dark: true
    property int plotMode: PhotonPlot.Pan
    property bool animating: true

    header: ToolBar {
        RowLayout {
            anchors.fill: parent
            spacing: 8

            Label {
                text: "Photon"
                font.bold: true
                Layout.leftMargin: 12
            }

            ToolButton {
                text: "Pan"
                checked: window.plotMode === PhotonPlot.Pan
                onClicked: window.plotMode = PhotonPlot.Pan
            }
            ToolButton {
                text: "Box zoom"
                checked: window.plotMode === PhotonPlot.Box
                onClicked: window.plotMode = PhotonPlot.Box
            }
            ToolButton {
                text: "Reset"
                onClicked: {
                    for (let i = 0; i < grid.children.length; ++i) {
                        let cell = grid.children[i]
                        if (cell.resetView)
                            cell.resetView()
                    }
                }
            }
            ToolButton {
                text: window.animating ? "Pause" : "Play"
                onClicked: window.animating = !window.animating
            }
            ToolButton {
                text: window.dark ? "Light" : "Dark"
                onClicked: window.dark = !window.dark
            }

            Item { Layout.fillWidth: true }

            Label {
                id: readout
                text: "drag to pan · wheel to zoom"
                color: window.dark ? "#94a3b8" : "#475569"
                Layout.rightMargin: 12
            }
        }
    }

    GridLayout {
        id: grid
        anchors.fill: parent
        anchors.margins: 6
        columns: 3
        rowSpacing: 6
        columnSpacing: 6

        Repeater {
            // Mirrors PH_PANEL_COUNT in hosts/common/panels.h, which QML cannot
            // see. If one changes, so does the other.
            model: 6
            PhotonPlot {
                required property int index
                panel: index
                theme: window.dark ? PhotonPlot.Dark : PhotonPlot.Light
                mode: window.plotMode
                animating: window.animating
                Layout.fillWidth: true
                Layout.fillHeight: true

                // Proof the plot talks back: the domain arrives from the render
                // thread as a queued signal, and lands in an ordinary QML label.
                onViewChanged: (xLo, xHi, yLo, yHi) => {
                    readout.text = "x [" + xLo.toFixed(2) + ", " + xHi.toFixed(2) + "]"
                }
            }
        }
    }
}
