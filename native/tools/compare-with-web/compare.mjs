/**
 * Compare a native grab against the web reference.
 *
 * Not a pixel diff, and it cannot be one. Two things differ by design and will
 * never match byte for byte:
 *
 *   - **Text.** The web core draws with Canvas2D and the system UI font; the
 *     native core rasterizes an embedded Inter subset through an SDF. That is
 *     deliberate — DESIGN.md explains why a system font would make the two
 *     layouts disagree — so the glyphs differ even where the positions do not.
 *   - **Antialiasing.** Different GL implementations round edge coverage
 *     differently, and headless Chromium runs on SwiftShader.
 *
 * What *must* match is the geometry, because that is what the port reproduces
 * number for number: the plot region, and every grid line inside it. Those are
 * extracted from both images and compared position by position. A single pixel
 * of drift means the layout ports diverged.
 *
 *   node compare.mjs native.png web.png [--out diff.png]
 */

import fs from "node:fs";
import zlib from "node:zlib";

// ---------------------------------------------------------------------------
// A PNG reader, for the two shapes these two producers emit: 8-bit RGB or RGBA,
// no interlacing. Anything else is refused rather than guessed at.
// ---------------------------------------------------------------------------

function readPng(file) {
  const png = fs.readFileSync(file);
  let at = 8;
  let width = 0, height = 0, channels = 0;
  const parts = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colour = body[9];
      if (depth !== 8 || body[12] !== 0) {
        throw new Error(`${file}: only 8-bit non-interlaced PNGs are read`);
      }
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
      if (!channels) throw new Error(`${file}: colour type ${colour} is not read`);
    } else if (type === "IDAT") {
      parts.push(body);
    }
    at += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const guess = a + b - c;
        const da = Math.abs(guess - a), db = Math.abs(guess - b), dc = Math.abs(guess - c);
        line[x] = (line[x] + (da <= db && da <= dc ? a : db <= dc ? b : c)) & 255;
      }
    }
    line.copy(pixels, y * stride);
    previous = line;
  }
  return { width, height, channels, pixels };
}

/** Minimal PNG writer, for the difference image. RGB, no filtering. */
function writePng(file, width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "ascii");
    body.copy(out, 8);
    out.writeInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), body])), body.length + 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const at = (image, x, y) => {
  const i = (y * image.width + x) * image.channels;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
};

const near = (pixel, target, tolerance) =>
  Math.abs(pixel[0] - target[0]) <= tolerance &&
  Math.abs(pixel[1] - target[1]) <= tolerance &&
  Math.abs(pixel[2] - target[2]) <= tolerance;

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

/** The plot region's fill, #0f172a, against the page's #0d1117. */
const REGION = [15, 23, 42];
/**
 * A dark-theme grid line: rgba(148,163,184,0.16) over the region fill. The
 * numbers come out of resolveAxisStyle, not out of a screenshot.
 */
const GRID = [
  Math.round(0.16 * 148 + 0.84 * 15),
  Math.round(0.16 * 163 + 0.84 * 23),
  Math.round(0.16 * 184 + 0.84 * 42),
];

/** The largest rectangle of region fill inside a cell, in cell coordinates. */
function findRegion(image, ox, oy, width, height) {
  let left = Infinity, right = -1, top = Infinity, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!near(at(image, ox + x, oy + y), REGION, 2)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Columns (and rows) that are mostly grid colour: the grid lines themselves. */
function findGrid(image, ox, oy, region) {
  const columns = [];
  for (let x = region.left; x < region.left + region.width; x++) {
    let hits = 0;
    for (let y = region.top; y < region.top + region.height; y++) {
      if (near(at(image, ox + x, oy + y), GRID, 6)) hits++;
    }
    if (hits > region.height * 0.5) columns.push(x);
  }
  const rows = [];
  for (let y = region.top; y < region.top + region.height; y++) {
    let hits = 0;
    for (let x = region.left; x < region.left + region.width; x++) {
      if (near(at(image, ox + x, oy + y), GRID, 6)) hits++;
    }
    if (hits > region.width * 0.5) rows.push(y);
  }
  return { columns, rows };
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const diffFile = outIndex >= 0 ? args[outIndex + 1] : null;
// Without `--out`, outIndex is -1 and outIndex + 1 is 0 — which would drop the
// first positional argument. Hence the explicit guard rather than the shorter
// arithmetic.
const [nativeFile, webFile] = args.filter((a, i) =>
  a !== "--out" && (outIndex < 0 || i !== outIndex + 1));
if (!nativeFile || !webFile) {
  console.error("usage: node compare.mjs native.png web.png [--out diff.png]");
  process.exit(2);
}

const nativeImage = readPng(nativeFile);
const webImage = readPng(webFile);
if (nativeImage.width !== webImage.width || nativeImage.height !== webImage.height) {
  console.error(`size mismatch: ${nativeImage.width}x${nativeImage.height} vs ` +
                `${webImage.width}x${webImage.height}`);
  process.exit(1);
}

const PANELS = [
  ["Waves", 0, 0], ["Log decay", 640, 0], ["Scatter", 1280, 0], ["Streaming", 1920, 0],
  ["Revenue", 2560, 0],
  ["Funnel", 0, 420], ["Share", 640, 420], ["Impulse", 1280, 420], ["Yield", 1920, 420],
  ["Latency", 2560, 420],
  // Field's heatmap covers its whole region, so no grid line is visible in
  // either image and there is nothing to compare. Worse than nothing: the two
  // GL implementations resolve the quad's edge column differently, and the
  // native blend lands within a level of the grid colour. Comparing the region
  // still means something here; comparing "grid lines" does not.
  ["Field", 0, 840, { grid: false }],
  ["Sprite", 640, 840], ["Candles", 1280, 840], ["Bars", 1920, 840],
  ["Density", 2560, 840],
  ["Flow", 0, 1260], ["Contour", 640, 1260], ["Network", 1280, 1260],
  ["Signals", 1920, 1260], ["Fit", 2560, 1260],
  ["Spectrum", 0, 1680],
];
const CELL_WIDTH = 640, CELL_HEIGHT = 420;

let failures = 0;
const complain = (message) => {
  console.log(`  MISMATCH ${message}`);
  failures++;
};

for (const [name, ox, oy, opts] of PANELS) {
  const nativeRegion = findRegion(nativeImage, ox, oy, CELL_WIDTH, CELL_HEIGHT);
  const webRegion = findRegion(webImage, ox, oy, CELL_WIDTH, CELL_HEIGHT);
  if (!nativeRegion || !webRegion) {
    complain(`${name}: no plot region found (native=${!!nativeRegion} web=${!!webRegion})`);
    continue;
  }

  const same = ["left", "top", "width", "height"]
    .filter((key) => nativeRegion[key] !== webRegion[key]);
  if (same.length) {
    complain(`${name}: region ${JSON.stringify(nativeRegion)} vs ${JSON.stringify(webRegion)}`);
  }

  if (opts?.grid === false) {
    console.log(`  ${name.padEnd(10)} region ${nativeRegion.left},${nativeRegion.top} ` +
                `${nativeRegion.width}x${nativeRegion.height}  grid not comparable`);
    continue;
  }

  const nativeGrid = findGrid(nativeImage, ox, oy, nativeRegion);
  const webGrid = findGrid(webImage, ox, oy, webRegion);
  for (const axis of ["columns", "rows"]) {
    const a = nativeGrid[axis].join(",");
    const b = webGrid[axis].join(",");
    if (a !== b) complain(`${name}: grid ${axis}\n    native [${a}]\n    web    [${b}]`);
  }

  console.log(`  ${name.padEnd(10)} region ${nativeRegion.left},${nativeRegion.top} ` +
              `${nativeRegion.width}x${nativeRegion.height}  ` +
              `${nativeGrid.columns.length} grid columns, ${nativeGrid.rows.length} rows`);
}

if (diffFile) {
  // Amplified, because what is left after the geometry matches is text and
  // antialiasing — both a handful of levels. Black means identical.
  const rgb = Buffer.alloc(nativeImage.width * nativeImage.height * 3);
  for (let y = 0, i = 0; y < nativeImage.height; y++) {
    for (let x = 0; x < nativeImage.width; x++, i += 3) {
      const a = at(nativeImage, x, y);
      const b = at(webImage, x, y);
      for (let k = 0; k < 3; k++) rgb[i + k] = Math.min(255, Math.abs(a[k] - b[k]) * 4);
    }
  }
  writePng(diffFile, nativeImage.width, nativeImage.height, rgb);
  console.log(`  wrote ${diffFile}`);
}

if (failures === 0) {
  console.log("\nlayout matches the web core exactly");
} else {
  console.log(`\n${failures} mismatch(es)`);
}
process.exit(failures === 0 ? 0 : 1);
