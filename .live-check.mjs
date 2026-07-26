/** Check the deployed live demo: every panel drew, no console errors, docs load. */
import { chromium } from "playwright";

const SITE = "https://coredumpdev.github.io/photon/";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });

async function inkReport(page, selector) {
  return page.evaluate((sel) => {
    const out = [];
    for (const p of document.querySelectorAll(sel)) {
      const groups = new Map();
      const canvases = [...p.querySelectorAll("canvas")];
      for (const host of p.querySelectorAll("*")) {
        if (host.shadowRoot) canvases.push(...host.shadowRoot.querySelectorAll("canvas"));
      }
      for (const c of canvases) {
        if (!groups.has(c.parentElement)) groups.set(c.parentElement, []);
        groups.get(c.parentElement).push(c);
      }
      const inks = [...groups.values()].map((cs) => {
        const t = cs.length >= 3 ? cs[1] : cs[0];
        try {
          const img = t.getContext("2d").getImageData(0, 0, t.width, t.height).data;
          let d = 0; for (let i = 3; i < img.length; i += 4) if (img[i] > 8) d++;
          return +((d / (img.length / 4)) * 100).toFixed(2);
        } catch { return -1; }
      });
      out.push({ title: (p.querySelector("h2")?.textContent ?? "?").slice(0, 44), inks });
    }
    return out;
  }, selector);
}

// --- the gallery, tab by tab -------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  page.on("requestfailed", (r) => errs.push(`404? ${r.url()}`));

  const resp = await page.goto(SITE, { waitUntil: "networkidle", timeout: 60000 });
  console.log(`gallery HTTP ${resp.status()}`);
  await page.waitForTimeout(7000);

  for (const tab of ["static", "dynamic", "finance", "ml"]) {
    if (tab !== "static") {
      await page.click(`.tab[data-tab="${tab}"]`);
      await page.waitForTimeout(6000);
    }
    const r = await inkReport(page, `#grid-${tab} .panel`);
    const bad = r.filter((x) => !x.inks.length || x.inks.some((i) => i <= 0));
    console.log(`  ${tab.padEnd(8)} ${String(r.length).padStart(2)} panels, ${bad.length} blank`);
    for (const b of bad) console.log("      BLANK " + JSON.stringify(b));
  }
  const real = [...new Set(errs)].filter((e) => !/favicon/i.test(e));
  if (real.length) console.log("  ERRORS:\n    " + real.slice(0, 8).join("\n    "));
  await page.screenshot({ path: process.argv[2] + "/live-gallery.png", fullPage: true });
  await page.close();
}

// --- docs, playground, llms ---------------------------------------------------
for (const [name, url, check] of [
  ["docs", SITE + "docs/", "h1"],
  ["docs 2d", SITE + "docs/charts/2d.html", "h1"],
  ["docs python", SITE + "docs/python/", "h1"],
  ["playground", SITE + "playground/", "canvas"],
  ["llms-full", SITE + "llms-full.txt", null],
]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(check === "canvas" ? 6000 : 1500);
    let extra = "";
    if (check) {
      const n = await page.locator(check).count();
      extra = `${check}=${n}`;
      if (check === "canvas") {
        const ink = await inkReport(page, "body");
        extra += ` ink=${ink[0]?.inks.join(",") ?? "-"}`;
      }
    }
    console.log(`${name.padEnd(12)} HTTP ${resp.status()}  ${extra}${errs.length ? "  ERR: " + errs[0] : ""}`);
  } catch (e) {
    console.log(`${name.padEnd(12)} FAILED ${e.message.slice(0, 80)}`);
  }
  await page.close();
}

await browser.close();
