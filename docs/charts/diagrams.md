# Diagrams

Hierarchy, flow and composition charts. Each is a pure layout function plus a
builder that feeds one `patches` (or `line`) layer — no new WebGL code.

<Demo src="treemap" :height="360" />

| Chart | Builder | Pure layout |
| --- | --- | --- |
| Treemap | `addTreemap(plot, { items, colors })` | `treemapLayout` |
| Funnel | `addFunnel(plot, { items, neck })` | `funnelLayout` |
| Sunburst | `addSunburst(plot, { root })` | `sunburstLayout` |
| Gauge | `addGauge(plot, { value, min, max, thresholds })` | `gaugeLayout` |
| Sankey | `addSankey(plot, { nodes, links })` | `sankeyLayout` |
| Chord | `addChord(plot, { matrix, labels })` | `chordLayout` |
| Parallel coordinates | `addParallelCoordinates(plot, { dimensions, rows })` | `parallelLayout` |

The layouts are exported so you can compute geometry without rendering — for
tests, for server-side work, or to draw it yourself.

`colors` accepts a palette name, an inline array, or anything registered with
`registerPalette`. Set `equalAspect: true` on the plot for the radial ones
(sunburst, chord, gauge) so they stay circular.
