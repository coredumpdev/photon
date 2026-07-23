import { describe, expect, it } from "vitest";
import { parseCSV } from "../src/data/csv.js";
import { lttb } from "../src/data/downsample.js";

describe("parseCSV", () => {
  it("parses headers + numeric columns", () => {
    const t = parseCSV("x,y\n1,2\n3,4\n5,6");
    expect(t.headers).toEqual(["x", "y"]);
    expect(t.length).toBe(3);
    expect(Array.from(t.numeric("y"))).toEqual([2, 4, 6]);
    expect(t.column("x")).toEqual(["1", "3", "5"]);
  });

  it("handles quoted fields, embedded commas, and escaped quotes", () => {
    const t = parseCSV('name,note\n"Doe, John","he said ""hi"""\nJane,ok');
    expect(t.column("name")).toEqual(["Doe, John", "Jane"]);
    expect(t.column("note")[0]).toBe('he said "hi"');
  });

  it("handles CRLF line endings and skips blank lines", () => {
    const t = parseCSV("a,b\r\n1,2\r\n\r\n3,4\r\n");
    expect(t.length).toBe(2);
    expect(Array.from(t.numeric(1))).toEqual([2, 4]);
  });

  it("non-numeric cells become NaN; headerless mode names columns", () => {
    expect(Number.isNaN(parseCSV("v\nx").numeric("v")[0]!)).toBe(true);
    const t = parseCSV("1,2\n3,4", { header: false });
    expect(t.headers).toEqual(["col0", "col1"]);
    expect(t.length).toBe(2);
  });
});

describe("lttb downsampling", () => {
  it("keeps first + last and reduces to the threshold", () => {
    const n = 1000;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 20));
    const d = lttb(x, y, 100);
    expect(d.x.length).toBe(100);
    expect(d.x[0]).toBe(0);
    expect(d.x[99]).toBe(n - 1);
  });

  it("returns a copy when the threshold is >= length", () => {
    const x = [0, 1, 2], y = [0, 1, 0];
    const d = lttb(x, y, 10);
    expect(Array.from(d.x)).toEqual([0, 1, 2]);
    expect(Array.from(d.y)).toEqual([0, 1, 0]);
  });

  it("preserves a sharp peak", () => {
    const n = 500;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = new Float64Array(n); y[250] = 100; // a lone spike
    const d = lttb(x, y, 50);
    expect(Math.max(...d.y)).toBeCloseTo(100); // the spike survives
  });
});
