// Colony slice 1 browser acceptance captures. Drives the running dev server on 5241 with headless Chromium
// (SwiftShader WebGL) and writes PNG evidence plus measurements.json for the ten DELIVERY-SLICE criteria.
const { chromium } = require("/Users/shaun/projects/eversor-mystrataassist/e2e/node_modules/playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = "/Users/shaun/projects/agent-harness-ui/.claude/worktrees/mission-frontier-colony-design-c7dcc1";
const OUT = path.join(ROOT, "design/mission-frontier/build-evidence/COLONY-SLICE-1/acceptance");
const BASE = process.env.FRONTIER_BASE ?? "http://127.0.0.1:5242/";
const SIZES = [
  { w: 1568, h: 1003, tag: "1568x1003" },
  { w: 1280, h: 720, tag: "1280x720" },
];
const PREFS_KEY = "mission-frontier.preferences.v1";
const APPEARANCE_KEY = "mission-frontier.3d-project-appearance.v1";
// Fixed late-morning light so rim geometry and crown tints are inspectable; the world clock does not advance.
const DAY = { environment: { mode: "fixed", dayMinutes: 60, hour: 11, anchorMs: 0 } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (scenario, hash = "world") => `${BASE}?mode=fixture&scenario=${scenario}&art=cinematic&renderer=3d#${hash}`;
const measurements = { capturedAt: new Date().toISOString(), chromium: null, sizes: {} };
fs.mkdirSync(OUT, { recursive: true });

function intersects(a, b) {
  return a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
async function rects(page, selector) {
  return page.$$eval(selector, (els) =>
    els.filter((el) => !el.hidden).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-proof-id"),
        text: el.textContent?.trim().replace(/\s+/g, " ") ?? "",
        aria: el.getAttribute("aria-label"),
        behavior: el.getAttribute("data-behavior"),
        occluded: el.getAttribute("data-occluded"),
        selected: el.classList.contains("selected"),
        x: r.x, y: r.y, width: r.width, height: r.height,
      };
    }),
  );
}
async function rect(page, selector) {
  return (await rects(page, selector))[0] ?? null;
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
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await sleep(settle);
}
async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return `${name}.png`;
}
function storage(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);
}
function setPrefs(page, prefs) {
  return page.evaluate(([k, p]) => localStorage.setItem(k, JSON.stringify(p)), [PREFS_KEY, prefs]);
}
function trackAssets(page) {
  const seen = new Map();
  page.on("response", async (response) => {
    const u = response.url();
    if (!u.includes("/assets/3d-proof/")) return;
    try { seen.set(u, (await response.body()).length); } catch {}
  });
  return () => {
    let total = 0;
    const files = {};
    for (const [u, bytes] of seen) { total += bytes; files[u.split("/").pop()] = bytes; }
    return { totalBytes: total, totalMB: +(total / 1e6).toFixed(2), files };
  };
}
async function hudCheck(page, labelSelector, size) {
  const labels = await rects(page, labelSelector);
  const needsYou = await rect(page, ".attention-stack");
  const dock = await rect(page, ".world-actions");
  const overlapping = labels.filter((l) => intersects(l, needsYou) || intersects(l, dock)).map((l) => l.text);
  const outsideViewport = labels.filter((l) => l.y < 0 || l.x < 0 || l.y + l.height > size.h || l.x + l.width > size.w).map((l) => l.id ?? l.text);
  return {
    labels: labels.map((l) => ({ id: l.id, text: l.text, x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.width), h: Math.round(l.height) })),
    needsYou: needsYou && { x: Math.round(needsYou.x), y: Math.round(needsYou.y), width: Math.round(needsYou.width), height: Math.round(needsYou.height) },
    dock: dock && { x: Math.round(dock.x), y: Math.round(dock.y), width: Math.round(dock.width), height: Math.round(dock.height) },
    overlapping,
    outsideViewport,
  };
}

// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) for pixel comparisons.
function decodePNG(buffer) {
  let offset = 8;
  const idat = [];
  let width = 0, height = 0, colorType = 6;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0, pos = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}
function changedPixels(a, b, region) {
  const A = decodePNG(a), B = decodePNG(b);
  let changed = 0;
  for (let y = region.y; y < region.y + region.height; y++)
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * A.width + x) * A.channels;
      for (let c = 0; c < Math.min(3, A.channels); c++) if (Math.abs(A.data[i + c] - B.data[i + c]) > 2) { changed++; break; }
    }
  return changed;
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  measurements.chromium = browser.version();
  for (const size of SIZES) {
    const M = (measurements.sizes[size.tag] = {});
    const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
    await context.addInitScript(([k, p]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(p)); }, [PREFS_KEY, DAY]);
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const assets = trackAssets(page);
    page.on("pageerror", (e) => (M.pageErrors ??= []).push(String(e)));

    // Criterion 1 + 7 + 9: three projects, labels clear HUD, load budget.
    await page.goto(url("workflow"));
    await ready(page, 6000);
    M.world = { shot: await shot(page, `world-${size.tag}`), ...(await hudCheck(page, ".world-label.project", size)) };
    const slotsBefore = await storage(page, APPEARANCE_KEY);
    M.world.slots = Object.fromEntries(Object.entries(slotsBefore?.projects ?? {}).map(([k, v]) => [k, v.slot]));
    M.world.assets = assets();
    await page.reload();
    await ready(page, 5000);
    const after = await hudCheck(page, ".world-label.project", size);
    const slotsAfter = await storage(page, APPEARANCE_KEY);
    M.reload = {
      slotsUnchanged: JSON.stringify(slotsBefore?.projects) === JSON.stringify(slotsAfter?.projects),
      labelDrift: after.labels.map((l) => {
        const before = M.world.labels.find((b) => b.id === l.id);
        return { id: l.id, dx: before ? l.x - before.x : null, dy: before ? l.y - before.y : null };
      }),
    };

    // Exterior of PlanCheck.
    await page.click('[data-proof-id="base:plancheck"]');
    await sleep(800);
    await page.click("nav.proof-navigation button:has-text('Exterior')");
    await sleep(3500);
    M.exterior = {
      shot: await shot(page, `exterior-plancheck-${size.tag}`),
      exteriorPressed: await page.getAttribute("nav.proof-navigation button:has-text('Exterior')", "aria-pressed"),
      hash: await page.evaluate(() => location.hash),
      ...(await hudCheck(page, ".world-label.project, .world-label.task", size)),
    };

    // Criterion 3 + 7: cutaway for every project.
    M.cutaway = {};
    for (const id of ["plancheck", "harness", "mystrata"]) {
      if (size.tag !== "1568x1003" && id !== "plancheck") continue;
      await goHash(page, `project/${id}`, 4000);
      const rooms = await rects(page, ".proof-room-label");
      const workers = await rects(page, ".world-label.task");
      const hud = await hudCheck(page, ".world-label.task, .proof-room-label", size);
      M.cutaway[id] = {
        shot: await shot(page, `cutaway-${id}-${size.tag}`),
        rooms: rooms.map((r) => r.text),
        workers: workers.map((w) => ({ id: w.id, aria: w.aria, behavior: w.behavior, occluded: w.occluded })),
        overlapping: hud.overlapping,
        outsideViewport: hud.outsideViewport,
      };
    }

    // Criterion 5: exterior -> cutaway -> watch -> exterior keeps identity.
    await goHash(page, "project/plancheck", 3000);
    const firstWorker = (await rects(page, ".world-label.task"))[0];
    const journey = [{ step: "cutaway", hash: await page.evaluate(() => location.hash) }];
    await page.click(`[data-proof-id="${firstWorker.id}"]`);
    await sleep(1000);
    journey.push({ step: "select", hash: await page.evaluate(() => location.hash), selected: (await rects(page, ".world-label.task")).filter((w) => w.selected).map((w) => w.id) });
    await goHash(page, `agent/${firstWorker.id}`, 4000);
    journey.push({
      step: "watch",
      hash: await page.evaluate(() => location.hash),
      selected: (await rects(page, ".world-label.task")).filter((w) => w.selected).map((w) => w.id),
      workers: (await rects(page, ".world-label.task")).map((w) => ({ id: w.id, behavior: w.behavior })),
      shot: await shot(page, `watch-${firstWorker.id}-${size.tag}`),
    });
    await page.click("nav.proof-navigation button:has-text('Exterior')");
    await sleep(3000);
    journey.push({
      step: "exterior",
      hash: await page.evaluate(() => location.hash),
      exteriorPressed: await page.getAttribute("nav.proof-navigation button:has-text('Exterior')", "aria-pressed"),
      projectLabels: (await rects(page, ".world-label.project")).map((l) => l.id),
      selectedTask: (await rects(page, ".world-label.task")).filter((w) => w.selected).map((w) => w.id),
    });
    await page.click("nav.proof-navigation button:has-text('Cutaway')");
    await sleep(3000);
    journey.push({ step: "cutaway-again", hash: await page.evaluate(() => location.hash), selected: (await rects(page, ".world-label.task")).filter((w) => w.selected).map((w) => w.id) });
    M.journey = { firstWorker: firstWorker.id, steps: journey };

    // Historical watch: AH-054 carries a failed S2 run alongside its active implementation run.
    if (size.tag === "1568x1003") {
      await goHash(page, "project/harness", 3000);
      const harnessWorkers = await rects(page, ".world-label.task");
      const target = harnessWorkers.find((w) => w.id === "AH-054") ?? harnessWorkers[0];
      await goHash(page, `agent/${target.id}`, 4000);
      M.watchActive = {
        task: target.id,
        hash: await page.evaluate(() => location.hash),
        shot: await shot(page, `watch-${target.id}-active-${size.tag}`),
        workers: (await rects(page, ".world-label.task")).map((w) => ({ id: w.id, behavior: w.behavior, selected: w.selected, aria: w.aria })),
      };
      await goHash(page, `agent/${target.id}/R-AH-054-S2-failed`, 4000);
      M.watchHistorical = {
        task: target.id,
        hash: await page.evaluate(() => location.hash),
        shot: await shot(page, `watch-${target.id}-historical-${size.tag}`),
        workers: (await rects(page, ".world-label.task")).map((w) => ({ id: w.id, behavior: w.behavior, selected: w.selected, aria: w.aria })),
      };
    }

    // Criterion 5: motion off freezes the scene. HUD and labels hidden; three regions sampled twice.
    const regions = [
      { name: "hub", x: Math.round(size.w * 0.38), y: Math.round(size.h * 0.35), width: Math.round(size.w * 0.2), height: Math.round(size.h * 0.2) },
      { name: "rooms", x: Math.round(size.w * 0.25), y: Math.round(size.h * 0.15), width: Math.round(size.w * 0.45), height: Math.round(size.h * 0.18) },
      { name: "court", x: Math.round(size.w * 0.1), y: Math.round(size.h * 0.6), width: Math.round(size.w * 0.3), height: Math.round(size.h * 0.25) },
    ];
    async function motionSample(motion) {
      await setPrefs(page, { ...DAY, motion, labels: false });
      await page.goto(url("workflow", "project/plancheck"));
      await page.reload(); // a hash-only goto keeps the previous document and its injected style
      await ready(page, 4000);
      await page.addStyleTag({ content: ".panel, .attention-stack, .world-actions, header, .proof-navigation, .world-labels { visibility: hidden !important; }" });
      await sleep(500);
      const a = await page.screenshot();
      await sleep(1200);
      const b = await page.screenshot();
      await sleep(1200);
      const c = await page.screenshot();
      return Object.fromEntries(regions.map((r) => [r.name, { ab: changedPixels(a, b, r), bc: changedPixels(b, c, r) }]));
    }
    M.motion = { regions, off: await motionSample(false), on: await motionSample(true) };
    await setPrefs(page, DAY);
    await page.reload();

    // Criterion 8: palettes on the Command crown, persisted and project scoped.
    if (size.tag === "1568x1003") {
      await page.goto(url("workflow"));
      await ready(page, 4000);
      await page.click('[data-proof-id="base:plancheck"]');
      await sleep(600);
      await page.click("nav.proof-navigation button:has-text('Exterior')");
      await sleep(2500);
      await page.click("nav.proof-navigation button:has-text('Appearance')");
      await sleep(800);
      const pressed = await page.$$eval(".proof-appearance button[aria-pressed]", (els) => els.map((e) => [e.textContent.trim(), e.getAttribute("aria-pressed")]));
      const command = await page.$(".proof-appearance button:has-text('Command')");
      if (command) { await command.click(); await sleep(1500); }
      const before = await storage(page, APPEARANCE_KEY);
      M.palettes = { initialPressed: pressed, shots: {}, stored: {} };
      for (const palette of ["blue", "red", "orange", "purple"]) {
        await page.click(`.proof-palette-options button:has-text('${palette[0].toUpperCase() + palette.slice(1)}')`);
        await sleep(2000);
        M.palettes.shots[palette] = await shot(page, `palette-${palette}-${size.tag}`);
        const stored = await storage(page, APPEARANCE_KEY);
        M.palettes.stored[palette] = Object.fromEntries(Object.entries(stored?.projects ?? {}).filter(([k]) => k.startsWith("plancheck")));
      }
      await page.reload();
      await ready(page, 3000);
      const persisted = await storage(page, APPEARANCE_KEY);
      const others = Object.fromEntries(Object.entries(persisted?.projects ?? {}).filter(([k]) => !k.startsWith("plancheck")));
      const othersBefore = Object.fromEntries(Object.entries(before?.projects ?? {}).filter(([k]) => !k.startsWith("plancheck")));
      M.palettes.afterReload = persisted?.projects;
      M.palettes.otherProjectsUnchanged = JSON.stringify(others) === JSON.stringify(othersBefore);
      M.palettes.slotUnchanged = Object.entries(persisted?.projects ?? {}).every(([k, v]) => v.slot === before?.projects?.[k]?.slot);
    }
    await context.close();

    // Criterion 2 + 4 + 9: colony stress, ten projects, fourteen-task HQ.
    const ctx2 = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
    await ctx2.addInitScript(([k, p]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(p)); }, [PREFS_KEY, DAY]);
    const page2 = await ctx2.newPage();
    page2.setDefaultTimeout(60000);
    const assets2 = trackAssets(page2);
    page2.on("pageerror", (e) => (M.pageErrors ??= []).push(String(e)));
    await page2.goto(url("colony-stress"));
    await ready(page2, 8000);
    const stressSlots = await storage(page2, APPEARANCE_KEY);
    M.stress = {
      world: { shot: await shot(page2, `stress-world-${size.tag}`), ...(await hudCheck(page2, ".world-label.project", size)) },
      slots: Object.fromEntries(Object.entries(stressSlots?.projects ?? {}).map(([k, v]) => [k, v.slot])),
      assets: assets2(),
    };
    await goHash(page2, "project/plancheck", 5000);
    const rooms = await rects(page2, ".proof-room-label");
    const workers = await rects(page2, ".world-label.task");
    const hud2 = await hudCheck(page2, ".world-label.task, .proof-room-label", size);
    M.stress.cutaway = {
      shot: await shot(page2, `stress-cutaway-plancheck-${size.tag}`),
      rooms: rooms.map((r) => r.text),
      workerCount: workers.length,
      workers: workers.map((w) => ({ id: w.id, aria: w.aria, occluded: w.occluded, x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.width), h: Math.round(w.height) })),
      overlapping: hud2.overlapping,
      outsideViewport: hud2.outsideViewport,
    };
    // Card hygiene: no card covers a HUD panel, no two cards overlap.
    const panels = await page2.$$eval(".panel, .attention-stack", (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, x: r.x, y: r.y, width: r.width, height: r.height }; }).filter((r) => r.width > 0));
    const cards = await rects(page2, ".world-label.task");
    M.stress.cutaway.cardsOverPanels = cards.filter((c) => panels.some((p) => intersects(c, p))).map((c) => c.id);
    M.stress.cutaway.cardPairsOverlapping = cards.flatMap((a, i) => cards.slice(i + 1).filter((b) => intersects(a, b)).map((b) => `${a.id}~${b.id}`));
    // Robot screen anchors from each card's leader line (anchor sits 1.1 m above the robot's head).
    const anchors = await page2.$$eval(".world-label.task", (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const leader = Number.parseFloat(el.style.getPropertyValue("--proof-leader")) || 0;
      const up = el.dataset.leader === "up";
      return { id: el.getAttribute("data-proof-id"), x: r.x + r.width / 2, y: up ? r.y - leader : r.bottom + leader };
    }));
    // DOM pick: clicking every worker card selects that task (motion off so the cards hold still).
    await setPrefs(page2, { ...DAY, motion: false });
    await page2.reload();
    await ready(page2, 4000);
    const domPicks = [];
    for (const w of workers) {
      const error = await page2.click(`[data-proof-id="${w.id}"]`, { timeout: 5000 }).then(() => null, (e) => e.message.split("\n")[0]);
      await sleep(400);
      const selected = (await rects(page2, ".world-label.task")).filter((x) => x.selected).map((x) => x.id);
      domPicks.push({ id: w.id, selected, ok: selected.length === 1 && selected[0] === w.id, ...(error ? { error } : {}) });
    }
    M.stress.domPicks = domPicks;
    M.stress.domPickSummary = { total: workers.length, ok: domPicks.filter((p) => p.ok).length };
    // 3D pick: labels hidden, click the robot body below each anchor.
    await setPrefs(page2, { ...DAY, labels: false, motion: false });
    await page2.reload();
    await ready(page2, 5000);
    const scenePicks = [];
    for (const a of anchors) {
      let hit = null;
      for (const dy of [40, 55, 25, 70, 12]) {
        const x = a.x;
        const y = a.y + dy;
        if (y > size.h - 4 || y < 4 || x > size.w - 4 || x < 4) continue;
        await page2.mouse.click(x, y);
        await sleep(400);
        const selected = await page2.$$eval(".world-label.task.selected", (els) => els.map((e) => e.getAttribute("data-proof-id")));
        if (selected[0] === a.id) { hit = { x: Math.round(x), y: Math.round(y) }; break; }
      }
      scenePicks.push({ id: a.id, anchor: { x: Math.round(a.x), y: Math.round(a.y) }, hit });
    }
    M.stress.scenePicks = scenePicks;
    M.stress.scenePickSummary = { total: scenePicks.length, hits: scenePicks.filter((p) => p.hit).length };
    await ctx2.close();
    fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(measurements, null, 2));
    console.log(`done ${size.tag}`);
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(measurements, null, 2));
}
run().catch((e) => { console.error(e); fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify({ ...measurements, error: String(e) }, null, 2)); process.exit(1); });
