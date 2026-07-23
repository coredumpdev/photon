import { describe, expect, it } from "vitest";
import { treemapLayout } from "../src/charts/treemap.js";
import { funnelLayout } from "../src/charts/funnel.js";
import { sunburstLayout } from "../src/charts/sunburst.js";
import { gaugeLayout } from "../src/charts/gauge.js";
import { sankeyLayout } from "../src/charts/sankey.js";
import { chordLayout } from "../src/charts/chord.js";
import { parallelLayout } from "../src/charts/parallel.js";

describe("chart layouts", () => {
  it("treemap: one cell per item, tiling the extent", () => {
    const cells = treemapLayout([{ label: "a", value: 3 }, { label: "b", value: 1 }, { label: "c", value: 1 }]);
    expect(cells.length).toBe(3);
    for (const c of cells) { expect(c.x1).toBeGreaterThan(c.x0); expect(c.y1).toBeGreaterThan(c.y0); }
    const area = cells.reduce((s, c) => s + (c.x1 - c.x0) * (c.y1 - c.y0), 0);
    expect(area).toBeCloseTo(1, 1); // fills the unit square
  });

  it("funnel: one trapezoid stage per item", () => {
    const stages = funnelLayout([{ label: "a", value: 100 }, { label: "b", value: 50 }]);
    expect(stages.length).toBe(2);
    expect(stages[0]!.poly.x.length).toBeGreaterThanOrEqual(3);
  });

  it("sunburst: an arc per node with valid radii", () => {
    const arcs = sunburstLayout({ name: "r", children: [{ name: "a", value: 1 }, { name: "b", value: 1 }] });
    expect(arcs.length).toBeGreaterThanOrEqual(2);
    for (const a of arcs) expect(a.r1).toBeGreaterThanOrEqual(a.r0);
  });

  it("gauge: background + value rings + needle polygons", () => {
    const g = gaugeLayout({ value: 50, min: 0, max: 100 });
    expect(g.bg.x.length).toBeGreaterThan(2);
    expect(g.value.x.length).toBeGreaterThan(2);
    expect(g.needle.x.length).toBeGreaterThanOrEqual(3);
  });

  it("sankey: a rect per node and a ribbon per link", () => {
    const r = sankeyLayout([{ name: "a" }, { name: "b" }, { name: "c" }], [
      { source: 0, target: 2, value: 5 }, { source: 1, target: 2, value: 3 },
    ]);
    expect(r.nodeRects.length).toBe(3);
    expect(r.ribbons.length).toBe(2);
  });

  it("chord: group arcs + ribbons from a matrix", () => {
    const r = chordLayout([[0, 1, 2], [1, 0, 3], [2, 3, 0]]);
    expect(r.groupArcs.length).toBe(3);
    expect(r.ribbons.length).toBeGreaterThanOrEqual(1);
  });

  it("parallel: an axis per dimension and a polyline per row", () => {
    const r = parallelLayout(["x", "y", "z"], [[0, 1, 2], [1, 0, 1], [0.5, 0.5, 0.5]]);
    expect(r.axes.length).toBe(3);
    expect(r.lines.length).toBe(3);
    expect(r.lines[0]!.x.length).toBe(3);
    for (const ln of r.lines) for (const y of ln.y) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1); }
  });
});
