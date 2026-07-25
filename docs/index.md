---
layout: home
hero:
  name: Photon
  text: WebGL2 charts that don't flinch
  tagline: 40+ chart types across 2D, 3D, polar, finance, statistics, ML and model architecture. Millions of points at 60fps. Zero runtime dependencies.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Chart catalog
      link: /charts/2d
    - theme: alt
      text: Live gallery
      link: https://coredumpdev.github.io/photon/
features:
  - title: Fast by construction
    details: Geometry lives on the GPU (instanced WebGL2 + min/max decimation, on-GPU above 200k points). Axes and labels are drawn on a Canvas2D overlay, so text stays crisp at any zoom.
  - title: One context, many charts
    details: Every plot renders into a single shared WebGL2 context and blits the result. A dashboard can hold dozens of live charts without exhausting the browser's context limit.
  - title: Scientific, not decorative
    details: Linear, log, time, categorical and gap-collapsing session scales. Colorbars, error bars, contours, isosurfaces, volume raymarching, PSDs and regression bands.
  - title: Model architecture
    details: Draw a PyTorch, Keras, scikit-learn or ONNX model — a Netron-style DAG in 2D, or cuboids sized by each layer's output tensor in 3D.
  - title: Any framework, or none
    details: A zero-dependency core with React, Vue, Svelte, Solid and Gea bindings, plus framework-free Web Components — and a Python bridge for Jupyter and Colab.
  - title: Honest colour
    details: 12 perceptual colormaps (sequential, diverging, cyclic) and colour-vision-safe palettes. Value-mapped layers draw their own colorbar; register your own ramp by name.
---
