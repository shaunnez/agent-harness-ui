import assert from "node:assert/strict";
import test from "node:test";
import { checkCostBandCitations } from "../server/research/engine/citations.mjs";
import { unitMeasure } from "../server/research/research-question-record.mjs";
import {
  disclaimerFor,
  figuresSupport,
  locatePassage,
  parseFigures,
  statedQuantities,
  workingSupport,
} from "../server/research/research-quote-figures.mjs";

const values = (text) => parseFigures(text).map((figure) => figure.value);

test("figures are parsed as numbers: k, commas, ranges, entities and lengths", () => {
  assert.deepEqual(values("add $400–$1.1k per door"), [400, 1_100]);
  assert.deepEqual(values("three-phase $1,800–$2,300"), [1_800, 2_300]);
  assert.deepEqual(values("typically $20-30k"), [20_000, 30_000]);
  assert.deepEqual(values("Key cutting is usually $10&ndash;$20 per key"), [10, 20]);
  assert.deepEqual(values("a $1.2m contract"), [1_200_000]);
  // A length and a rating are not prices.
  assert.deepEqual(values("3.6 m wide, 14kVA"), []);
  assert.equal(
    parseFigures("$1,800–$2,300").every((figure) => figure.currency),
    true,
  );
});

test("a passage is found by its words, even when the model reformatted its figures", () => {
  const page = "Motor upgrades: three-phase high-cycle $1,800–$2,300, add $400–$1.1k per door for curtains.";
  const found = locatePassage(page, "add $400-$1,100 per door");
  assert.equal(found.text, "add $400–$1.1k per door");
  // The page's own words are returned, so what gets retained is the page, not the rewording.
  assert.ok(page.includes(found.text));
  assert.equal(locatePassage(page, "roofing membranes per square metre installed"), null);
  // Too few words to place by words alone.
  assert.equal(locatePassage(page, "$1,800"), null);
});

test("the figures on the page decide whether they give the component's amount", () => {
  const passage = "add $400–$1.1k per door";
  assert.equal(figuresSupport(passage, { low: 400, high: 1_100 }).support, "match");
  assert.equal(figuresSupport("three-phase $1,800–$2,300", { low: 2_000, high: 2_200 }).support, "within");
  // GST-inclusive on the page, exclusive in the answer.
  assert.equal(figuresSupport("$115.00 incl GST", { low: 100, high: 100 }).support, "match");
  // A stated quantity: 4 doors at $1,800–$2,300.
  assert.equal(
    figuresSupport("three-phase $1,800–$2,300", { low: 7_200, high: 9_200, context: "motors, 4 doors" })
      .support,
    "match",
  );
  // Two separately priced items, bundled.
  assert.equal(
    figuresSupport("Allow $140 for twin photo-eyes. Edge sensors ($180)", { low: 320, high: 320 }).support,
    "match",
  );
  // One end on the page, or a band set close around its one price.
  assert.equal(figuresSupport("$146.41", { low: 146.41, high: 201.69 }).support, "partial");
  assert.equal(figuresSupport("$310 per metre installed", { low: 280, high: 340 }).support, "partial");
  // Worked from the quote with the working shown.
  assert.equal(
    figuresSupport("$85.00 + GST an hour", { low: 9.38, high: 17.88, context: "amortised over 40" }).support,
    "derived",
  );
  // Other numbers and no working: the quote does not give it.
  assert.equal(
    figuresSupport("$207.00 – $247.25 incl GST", {
      low: 700,
      high: 900,
      context: "Mortice lockset, per leaf",
    }).support,
    "mismatch",
  );
  assert.equal(figuresSupport("Delivery is priced separately.", { low: 16, high: 22 }).support, "no_figures");
  // A component priced at nothing uses no figure.
  assert.equal(figuresSupport("About 7,400 homes were zoned red", { low: 0, high: 0 }).support, "match");
});

test("a quantity is a count or measure the component names, not a specification", () => {
  assert.deepEqual(
    statedQuantities("sum (60 panels, ~120 m2 array)").sort((a, b) => a - b),
    [60, 120],
  );
  assert.deepEqual(statedQuantities("CoC and ESC issue, amortised over 40"), [40]);
  assert.deepEqual(statedQuantities("6-pin cylinder, 4mm core, 2 pair 0.5mm2"), []);
});

test("the citation check keeps the page's words and labels what the figures give", async () => {
  const page = "Motor upgrades: three-phase high-cycle $1,800–$2,300, add $400–$1.1k per door.";
  const verified = [];
  const webTools = {
    verifyEvidence: (reference) => {
      if (!page.includes(reference.excerpt))
        throw Object.assign(new Error("not on page"), { code: "excerpt_not_found" });
      verified.push(reference.excerpt);
      return {
        sourceId: reference.sourceId,
        excerpt: reference.excerpt,
        quoteVerified: true,
        sourceType: "web",
      };
    },
    locateQuote: (_sourceId, excerpt) => {
      const found = locatePassage(page, excerpt);
      return found ? { page: null, text: found.text } : null;
    },
  };
  const component = (excerpt, low, high, role = "Motor") => ({
    role,
    basis: "web",
    sourceId: "source-1",
    source: "https://doors.test/",
    excerpt,
    low,
    high,
  });
  const checked = await checkCostBandCitations(
    {
      components: [
        component("add $400-$1,100 per door", 400, 1_100),
        component("three-phase high-cycle $1,800–$2,300", 1_900, 2_700),
        component("three-phase high-cycle $1,800–$2,300", 5_000, 6_000),
        component("gold-plated motors per door", 400, 1_100),
      ],
    },
    { rows: [], webTools },
  );
  assert.deepEqual(
    checked.components.map((item) => item.check),
    ["web-verified", "web-derived", "web-unsupported", "web-unverified"],
  );
  // The reworded quote was checked, and retained, as the page's own words.
  assert.equal(verified[0], "add $400–$1.1k per door");
  assert.match(checked.components[0].problems.join(" "), /Quoted as "add \$400-\$1,100 per door"/);
  assert.match(checked.components[2].problems.join(" "), /do not give the amount 5000–6000/);
  assert.equal(checked.summary.webVerified, 1);
  assert.equal(checked.summary.webDerived, 1);
  assert.equal(checked.summary.webUnsupported, 1);
});

test("a note in brackets does not change the unit a band is priced in", () => {
  assert.equal(unitMeasure("ea (one complete door, supplied, installed; also give x4 total)"), "each");
  assert.equal(unitMeasure("$/ea"), "each");
  assert.equal(unitMeasure("lump sum, 1200m²"), "total");
  assert.equal(unitMeasure("m² treated area (footprint plus 1-2m margin)"), "per m²");
});

test("stated working is checked on both halves: the rate against the page, the amount as rate × quantity", async () => {
  assert.deepEqual(
    workingSupport("roughly +NZ $45–$60 /m²", {
      rate: { low: 45, high: 60 },
      quantity: { low: 18, high: 18 },
      low: 810,
      high: 1_080,
    }),
    { rate: "match", figures: [45, 60], arithmetic: true, expected: { low: 810, high: 1_080 } },
  );
  const page =
    "Electrical Certificate: $30–$50 depending on job complexity. $85.00 + GST an hour after that.";
  const webTools = {
    verifyEvidence: (reference) => ({
      sourceId: reference.sourceId,
      excerpt: reference.excerpt,
      quoteVerified: true,
    }),
    locateQuote: (_sourceId, excerpt) => {
      const found = locatePassage(page, excerpt);
      return found ? { page: null, text: found.text } : null;
    },
  };
  const component = (rate, quantity, low, high) => ({
    role: "Certificates, shared across 40 fittings",
    basis: "web",
    sourceId: "source-1",
    source: "https://sparky.test/",
    excerpt: "Electrical Certificate: $30–$50 depending on job complexity",
    rate,
    quantity,
    low,
    high,
  });
  const checked = await checkCostBandCitations(
    {
      components: [
        component({ low: 30, high: 50 }, { low: 0.05, high: 0.05 }, 1.5, 2.5),
        component({ low: 30, high: 50 }, { low: 0.05, high: 0.05 }, 3, 5),
        component({ low: 70, high: 90 }, { low: 0.05, high: 0.05 }, 3.5, 4.5),
        // Half the rate on the page is what the same quote without working would get.
        component({ low: 50, high: 70 }, { low: 0.05, high: 0.05 }, 2.5, 3.5),
      ],
    },
    { rows: [], webTools },
  );
  assert.deepEqual(
    checked.components.map((item) => item.check),
    ["web-verified", "web-unsupported", "web-unsupported", "web-derived"],
  );
  assert.match(
    checked.components[1].problems.join(" "),
    /is not the rate 30–50 × the quantity 0.05–0.05 \(1.5–2.5\)/,
  );
  assert.match(checked.components[2].problems.join(" "), /do not give the rate 70–90/);
});

test("the answer's working is read when stated, and left out when not", async () => {
  const { parseCostBand } = await import("../server/research/engine/qv-recipe.mjs");
  const answer = (component) =>
    `\`\`\`json\n${JSON.stringify({ components: [component], band: { low: 1, high: 2, unit: "ea" } })}\n\`\`\``;
  const [worked] = parseCostBand(
    answer({
      role: "Powdercoat",
      amount: { low: 810, high: 1080 },
      rate: { low: 45, high: 60, unit: "per m2" },
      quantity: { value: 18, unit: "m2", basis: "curtain area" },
    }),
  ).components;
  assert.deepEqual(worked.rate, { low: 45, high: 60, unit: "per m2" });
  assert.deepEqual(worked.quantity, { low: 18, high: 18, unit: "m2", basis: "curtain area" });
  const [plain] = parseCostBand(answer({ role: "Door", amount: { low: 1, high: 2 } })).components;
  assert.equal("rate" in plain, false);
});

test("a percentage is a figure, read as written and as a multiplier", () => {
  assert.deepEqual(values("Price runs 10–15 % above Coloursteel"), [10, 15]);
  assert.equal(
    workingSupport("Price runs 10–15 % above Coloursteel", {
      rate: { low: 0.1, high: 0.15 },
      quantity: { low: 5_399, high: 5_399 },
      low: 540,
      high: 810,
    }).rate,
    "match",
  );
  const uplift = workingSupport("Insulated curtains add roughly 25–40 % over a single-skin door", {
    rate: { low: 25, high: 40 },
    quantity: { low: 4_583, high: 6_192 },
    low: 1_146,
    high: 2_477,
  });
  assert.equal(uplift.rate, "match");
  assert.equal(uplift.arithmetic, true);
});

test("a figure its own source says is not a price is caught, and a priced row beside a POA one is not", () => {
  const vector =
    "Development contribution … High voltage feeder Priced per job … Posted capacity rates ($ excl. GST per diversified kVA) For information purposes only … Distribution substation $176.67 $180.62";
  assert.match(
    disclaimerFor(vector, "Distribution substation $176.67"),
    /Priced per job|For information purposes/,
  );
  const guide = `1.4. The illustrated examples are intended to be realistic, but are indicative and should not be relied on as a guide to actual costs or charges.${" filler".repeat(800)} Rate ($ per kVA) 598.5`;
  assert.match(
    disclaimerFor(guide, "Rate ($ per kVA) 598.5"),
    /should not be relied on as a guide to actual costs/,
  );
  const supplier = "Large installed $9,800 $8,200 $11,000 Oversize 8 m+ turnkey POA $14,500 $17,800";
  assert.equal(disclaimerFor(supplier, "Large installed $9,800 $8,200 $11,000"), null);
  assert.equal(disclaimerFor("Prices are indicative only. Door from $3,000", "Door from $3,000"), null);
});
