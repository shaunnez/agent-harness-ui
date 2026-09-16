// Colony slice 2A browser evidence. Drives a Frontier dev server with headless Chromium (SwiftShader WebGL)
// and writes PNGs plus measurements-<step>.json. Usage: FRONTIER_BASE=http://127.0.0.1:5243/ node capture-2a.cjs <step>
const { chromium } = require("/Users/shaun/projects/eversor-mystrataassist/e2e/node_modules/playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const OUT = __dirname;
const BASE = process.env.FRONTIER_BASE ?? "http://127.0.0.1:5243/";
const SIZES = [
  { w: 1568, h: 1003, tag: "1568x1003" },
  { w: 1280, h: 720, tag: "1280x720" },
];
const PREFS_KEY = "mission-frontier.preferences.v1";
const APPEARANCE_KEY = "mission-frontier.3d-project-appearance.v1";
const DAY = { environment: { mode: "fixed", dayMinutes: 60, hour: 11, anchorMs: 0 } };
const NIGHT = { environment: { mode: "fixed", dayMinutes: 60, hour: 23, anchorMs: 0 } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (scenario, hash = "world", colony = true, extra = "") =>
  `${BASE}?mode=fixture&scenario=${scenario}&art=cinematic&renderer=3d${colony ? "&colony=1" : ""}${extra}#${hash}`;

function intersects(a, b) {
  return a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
async function rects(page, selector) {
  return page.$$eval(selector, (els) =>
    els
      .filter((el) => !el.hidden)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute("data-proof-id"),
          text: el.textContent?.trim().replace(/\s+/g, " ") ?? "",
          compact: el.getAttribute("data-compact"),
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        };
      }),
  );
}
async function ready(page, settle = 3500) {
  await page.waitForSelector("nav.proof-navigation", { timeout: 120000 });
  await page.waitForSelector(".proof-loading", { state: "detached", timeout: 180000 });
  const problem = await page.$(".proof-error");
  if (problem) throw new Error(`scene problem: ${await problem.textContent()}`);
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await sleep(settle);
}
async function goHash(page, hash, settle = 3000) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
  await sleep(settle);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  return `${name}.png`;
}
function setPrefs(page, prefs) {
  return page.evaluate(([k, p]) => localStorage.setItem(k, JSON.stringify(p)), [PREFS_KEY, prefs]);
}
function setAppearance(page, value) {
  return page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [APPEARANCE_KEY, value]);
}
function storage(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);
}
function trackAssets(page) {
  const seen = new Map();
  page.on("response", async (response) => {
    const u = response.url();
    if (!u.includes("/assets/3d-proof/")) return;
    try {
      seen.set(u, (await response.body()).length);
    } catch {}
  });
  return () => {
    let total = 0;
    const files = {};
    for (const [u, bytes] of seen) {
      total += bytes;
      files[u.split("/").pop()] = bytes;
    }
    return { totalBytes: total, totalMB: +(total / 1e6).toFixed(2), files };
  };
}
/** Card overlaps, viewport-edge overflow and HUD coverage for the task cards. */
async function cardCheck(page, size) {
  const cards = await rects(page, ".proof-labels .world-label.task");
  const panels = await rects(page, ".panel, .attention-stack");
  const pairs = [];
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++)
      if (intersects(cards[i], cards[j])) pairs.push([cards[i].id, cards[j].id]);
  const overPanels = cards.filter((c) => panels.some((p) => intersects(c, p))).map((c) => c.id);
  const outside = cards
    .filter((c) => c.y < 0 || c.x < 0 || c.y + c.height > size.h || c.x + c.width > size.w)
    .map((c) => c.id);
  return {
    cards: cards.map((c) => ({
      id: c.id,
      compact: c.compact,
      x: Math.round(c.x),
      y: Math.round(c.y),
      w: Math.round(c.width),
      h: Math.round(c.height),
    })),
    count: cards.length,
    compactCount: cards.filter((c) => c.compact === "true").length,
    pairsOverlapping: pairs,
    overPanels,
    outsideViewport: outside,
  };
}
/** Click every card at its centre and confirm exactly that task becomes selected. */
async function pickAll(page) {
  const ids = (await rects(page, ".proof-labels .world-label.task")).map((c) => c.id);
  const results = [];
  for (const id of ids) {
    const card = (await rects(page, `.proof-labels .world-label.task[data-proof-id="${id}"]`))[0];
    if (!card) {
      results.push({ id, ok: false, reason: "hidden" });
      continue;
    }
    await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
    await sleep(350);
    const selected = await page.$$eval(".proof-labels .world-label.task.selected", (els) =>
      els.map((el) => el.getAttribute("data-proof-id")),
    );
    results.push({ id, ok: selected.length === 1 && selected[0] === id, selected });
  }
  return { ok: results.filter((r) => r.ok).length, total: results.length, results };
}
async function openPage(browser, size) {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  return { context, page };
}
async function prime(page, target, prefs, appearance) {
  await page.goto(target);
  await page.waitForSelector("nav.proof-navigation", { timeout: 120000 }).catch(() => {});
  await setPrefs(page, { motion: false, labels: true, ...prefs });
  if (appearance) await setAppearance(page, appearance);
  await page.reload();
  await ready(page);
}

const steps = {
  /** Step 0: without ?colony=1 the archipelago is unchanged; with it the colony renders. */
  async step0(browser, out) {
    for (const size of SIZES) {
      const { context, page } = await openPage(browser, size);
      const assets = trackAssets(page);
      await prime(page, url("workflow", "world", false), DAY);
      const shots = { world: await shot(page, `step0-legacy-world-${size.tag}`) };
      const legacyLabels = await rects(page, ".proof-labels .world-label.project");
      await page.click("nav.proof-navigation button:has-text('Exterior')");
      await sleep(3000);
      shots.exterior = await shot(page, `step0-legacy-exterior-${size.tag}`);
      await goHash(page, "project/plancheck", 3500);
      shots.cutaway = await shot(page, `step0-legacy-cutaway-${size.tag}`);
      const rooms = await rects(page, ".proof-room-label");
      const legacyAssets = assets();
      await context.close();
      const colony = await openPage(browser, size);
      const colonyAssets = trackAssets(colony.page);
      await prime(colony.page, url("workflow", "world", true), DAY);
      shots.colonyWorld = await shot(colony.page, `step0-colony-world-${size.tag}`);
      const colonyLabels = await rects(colony.page, ".proof-labels .world-label.project");
      await colony.context.close();
      out[size.tag] = {
        shots,
        legacy: {
          projectLabels: legacyLabels.map((l) => l.text),
          roomLabels: rooms.length,
          assets: legacyAssets,
        },
        colony: { projectLabels: colonyLabels.map((l) => l.text), assets: colonyAssets() },
      };
    }
  },
};

(async () => {
  const step = process.argv[2];
  if (!steps[step]) throw new Error(`unknown step ${step}; known: ${Object.keys(steps).join(", ")}`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const out = { capturedAt: new Date().toISOString(), base: BASE, chromium: browser.version() };
  try {
    await steps[step](browser, out);
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, `measurements-${step}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
