// Contract 2.0 colony evidence. Drives a Frontier dev server with headless Chromium (SwiftShader WebGL) and
// writes PNGs plus measurements-<step>.json. Usage: FRONTIER_BASE=http://127.0.0.1:5243/ node capture-v2.cjs <step>
// Steps: gate (world / exterior / cutaway, day and dusk, both sizes), stress (ten-project world),
// peek (world and exterior by day at 1568 only; set FRONTIER_OUT to keep the PNGs out of the evidence folder).
const { chromium } = require("/Users/shaun/projects/eversor-mystrataassist/e2e/node_modules/playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const OUT = process.env.FRONTIER_OUT ?? __dirname;
const BASE = process.env.FRONTIER_BASE ?? "http://127.0.0.1:5243/";
const SIZES = [
  { w: 1568, h: 1003, tag: "1568x1003" },
  { w: 1280, h: 720, tag: "1280x720" },
];
const PREFS_KEY = "mission-frontier.preferences.v1";
const hour = (h) => ({ environment: { mode: "fixed", dayMinutes: 60, hour: h, anchorMs: 0 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (scenario, hash = "world", extra = "") =>
  `${BASE}?mode=fixture&scenario=${scenario}&art=cinematic&renderer=3d&colony=1${extra}#${hash}`;

async function rects(page, selector) {
  return page.$$eval(selector, (els) =>
    els
      .filter((el) => !el.hidden)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent?.trim().replace(/\s+/g, " ") ?? "", x: r.x, y: r.y, width: r.width, height: r.height };
      }),
  );
}
async function ready(page, settle = 4000) {
  await page.waitForSelector("nav.proof-navigation", { timeout: 120000 });
  await page.waitForSelector(".proof-loading", { state: "detached", timeout: 180000 });
  const problem = await page.$(".proof-error");
  if (problem) throw new Error(`scene problem: ${await problem.textContent()}`);
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await sleep(settle);
}
async function goHash(page, hash, settle = 3500) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
  await sleep(settle);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  return `${name}.png`;
}
const setPrefs = (page, prefs) => page.evaluate(([k, p]) => localStorage.setItem(k, JSON.stringify(p)), [PREFS_KEY, prefs]);
/** Bounding box of non-background canvas pixels, to measure how much of the frame the scene fills. */
async function canvasFill(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return null;
    const w = gl.drawingBufferWidth,
      h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let minX = w,
      maxX = -1,
      minY = h,
      maxY = -1,
      lit = 0;
    // Background sea is dark blue-teal; land, buildings and cliffs are brighter and warmer.
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        const r = px[i],
          g = px[i + 1],
          b = px[i + 2];
        if (r > 70 && r + g > b * 1.4) {
          lit++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    return { width: w, height: h, box: { minX, maxX, minY: h - 1 - maxY, maxY: h - 1 - minY }, litFraction: (lit * 4) / (w * h) };
  });
}

async function run(step) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const measurements = { step, capturedAt: new Date().toISOString(), base: BASE, shots: {} };
  try {
    for (const size of step === "peek" ? SIZES.slice(0, 1) : SIZES) {
      const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error("pageerror", error.message));
      const scenario = step === "stress" ? "colony-stress" : "workflow";
      await page.goto(url(scenario, "world"));
      await setPrefs(page, hour(11));
      await page.reload();
      await ready(page);
      measurements.shots[`${step}-world-day-${size.tag}`] = {
        file: await shot(page, `${step}-world-day-${size.tag}`),
        fill: await canvasFill(page),
        labels: await rects(page, ".world-label"),
      };
      if (step === "peek") {
        await goHash(page, "project/plancheck");
        await page.click("button:has-text('Exterior')").catch(() => {});
        await sleep(3000);
        measurements.shots[`peek-exterior-day-${size.tag}`] = { file: await shot(page, `peek-exterior-day-${size.tag}`) };
      }
      if (step === "gate") {
        await goHash(page, "project/plancheck");
        await page.click("button:has-text('Exterior')").catch(() => {});
        await sleep(3000);
        measurements.shots[`gate-exterior-day-${size.tag}`] = {
          file: await shot(page, `gate-exterior-day-${size.tag}`),
          fill: await canvasFill(page),
        };
        await page.click("button:has-text('Cutaway')").catch(() => {});
        await sleep(3000);
        measurements.shots[`gate-cutaway-day-${size.tag}`] = {
          file: await shot(page, `gate-cutaway-day-${size.tag}`),
          fill: await canvasFill(page),
          labels: await rects(page, ".world-label"),
        };
        await setPrefs(page, hour(20));
        await page.goto(url(scenario, "world"));
        await page.reload();
        await ready(page);
        measurements.shots[`gate-world-dusk-${size.tag}`] = { file: await shot(page, `gate-world-dusk-${size.tag}`) };
        await goHash(page, "project/plancheck");
        await page.click("button:has-text('Exterior')").catch(() => {});
        await sleep(3000);
        measurements.shots[`gate-exterior-dusk-${size.tag}`] = { file: await shot(page, `gate-exterior-dusk-${size.tag}`) };
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, `measurements-${step}.json`), `${JSON.stringify(measurements, null, 2)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(measurements.shots).map(([k, v]) => [k, v.fill ?? null])), null, 1));
}
run(process.argv[2] ?? "gate").catch((error) => {
  console.error(error);
  process.exit(1);
});
