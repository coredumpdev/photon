/**
 * Capture the live gallery for the README.
 *
 * Prereqs: the example server running (`pnpm example`), plus:
 *   npm i -D playwright && npx playwright install chromium   # bundled chromium (swiftshader WebGL2)
 *   (ffmpeg on PATH for the GIF step)
 *
 * Usage:
 *   node scripts/capture-media.mjs
 *   # then, to make the GIF:
 *   ffmpeg -y -ss 1.5 -t 5 -i /tmp/photon-video/*.webm -vf "fps=18,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff" /tmp/pal.png
 *   ffmpeg -y -ss 1.5 -t 5 -i /tmp/photon-video/*.webm -i /tmp/pal.png -lavfi "fps=18,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse" assets/streaming.gif
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:5173";
const OUT = "assets";
const VIDEO = "/tmp/photon-video";
mkdirSync(VIDEO, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  recordVideo: { dir: VIDEO, size: { width: 1280, height: 900 } },
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "load" });
await page.waitForTimeout(6000); // headless swiftshader needs time to render
await page.screenshot({ path: `${OUT}/gallery-full.png`, fullPage: true });
await page.screenshot({ path: `${OUT}/streaming-still.png` });
await page.waitForTimeout(5000); // record streaming for the GIF
await ctx.close();
await browser.close();
console.log(`Captured to ${OUT}/ and video to ${VIDEO}/`);
