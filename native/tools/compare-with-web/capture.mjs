/**
 * Render the web reference and write it to a PNG.
 *
 * Headless Chromium over SwiftShader, so it needs no GPU and can run in CI.
 * deviceScaleFactor is pinned to 1 because the native side is grabbed at dpr 1
 * and the whole point is to compare the same geometry.
 */

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "dist");
const out = process.argv[2] ?? path.join(here, "web.png");

if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("build it first: npx vite build --config " +
                path.relative(process.cwd(), path.join(here, "vite.config.mjs")));
  process.exit(1);
}

// Served rather than opened as a file: Chromium refuses to load an ES module
// over file://, which is how the bundle is loaded.
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((request, response) => {
  const name = request.url === "/" ? "/index.html" : decodeURI(request.url.split("?")[0]);
  const file = path.join(root, path.normalize(name).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(file, (error, body) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    response.end(body);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const page_url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 3200, height: 840 },
  deviceScaleFactor: 1,
});
page.on("console", (message) => {
  if (message.type() === "error") console.error("page:", message.text());
});
page.on("pageerror", (error) => console.error("page:", error.message));

await page.goto(page_url);
await page.waitForSelector("body[data-ready='1']", { state: "attached", timeout: 20000 });
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 3200, height: 840 } });
await browser.close();
server.close();
console.log("wrote " + out);
