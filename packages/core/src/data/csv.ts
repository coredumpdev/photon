/**
 * A tiny dependency-free CSV parser + typed-array column access — the common
 * "load a CSV and plot a column" path. Handles quoted fields, escaped quotes
 * (`""`), and `\n` / `\r\n` line endings.
 */

export interface CSVOptions {
  /** Field delimiter. Default `","`. */
  delimiter?: string;
  /** Treat the first row as headers. Default `true`. */
  header?: boolean;
  /** Drop blank lines. Default `true`. */
  skipEmpty?: boolean;
}

/** A parsed CSV: header names + string rows, with typed column accessors. */
export interface Table {
  headers: string[];
  rows: string[][];
  /** Number of data rows. */
  readonly length: number;
  /** A column's raw string values (by name or index). */
  column(name: string | number): string[];
  /** A column parsed to a `Float64Array` (non-numeric cells become `NaN`). */
  numeric(name: string | number): Float64Array;
}

function tokenize(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; }
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Parse CSV text into a {@link Table}. */
export function parseCSV(text: string, opts: CSVOptions = {}): Table {
  const delim = opts.delimiter ?? ",";
  const useHeader = opts.header !== false;
  let all = tokenize(text, delim);
  if (opts.skipEmpty !== false) all = all.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));

  let headers: string[];
  let dataRows: string[][];
  if (useHeader && all.length) { headers = all[0]!.map((h) => h.trim()); dataRows = all.slice(1); }
  else { const n = all[0]?.length ?? 0; headers = Array.from({ length: n }, (_, i) => `col${i}`); dataRows = all; }

  const idx = (name: string | number): number => (typeof name === "number" ? name : headers.indexOf(name));
  return {
    headers,
    rows: dataRows,
    get length() { return dataRows.length; },
    column(name) {
      const i = idx(name);
      return dataRows.map((r) => r[i] ?? "");
    },
    numeric(name) {
      const i = idx(name);
      const out = new Float64Array(dataRows.length);
      for (let k = 0; k < dataRows.length; k++) out[k] = Number.parseFloat(dataRows[k]![i] ?? "");
      return out;
    },
  };
}
