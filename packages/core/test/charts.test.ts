import { describe, expect, it } from "vitest";
import { checkAnnotation } from "../src/plot.js";
import type { Annotation } from "../src/plot.js";
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

describe("checkAnnotation", () => {
  const ok: Annotation[] = [
    { type: "span", dim: "y", value: 3 },
    { type: "band", dim: "x", from: 1, to: 2 },
    { type: "box", x: [0, 1], y: [0, 1] },
    { type: "label", x: 1, y: 2, text: "hi" },
    { type: "line", x0: 0, y0: 0, x1: 1, y1: 1 },
    { type: "ray", x0: 0, y0: 0, x1: 1, y1: 1 },
    { type: "fib", x0: 0, x1: 1, high: 9, low: 3 },
  ];

  it("passes every well-formed annotation", () => {
    for (const a of ok) expect(() => checkAnnotation(a)).not.toThrow();
  });

  it("names the fields the type actually wants", () => {
    // Each of these is a plausible misspelling that used to draw nothing at all.
    const wrong = [
      [{ type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }, /x0, y0/],
      [{ type: "fib", x0: 0, x1: 1, top: 9, bottom: 3 }, /high, low/],
      [{ type: "band", dim: "x", start: 1, end: 2 }, /from, to/],
      [{ type: "span", dim: "y" }, /value/],
      [{ type: "box", x: 0, y: 1 }, /ranges/],
    ] as const;
    for (const [a, re] of wrong) {
      expect(() => checkAnnotation(a as unknown as Annotation)).toThrow(re);
    }
  });

  it("rejects a coordinate that is present but not a number", () => {
    expect(() => checkAnnotation({ type: "line", x0: 0, y0: NaN, x1: 1, y1: 1 })).toThrow(/y0/);
  });
});
