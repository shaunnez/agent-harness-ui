import assert from "node:assert/strict";
import test from "node:test";
import { reviewCostBand, reviewMessage } from "../server/research/research-answer-review.mjs";
import { questionRecord } from "../server/research/research-question-record.mjs";

const answer = (band, components) => ({ band: { unit: "m2", ...band }, components });
const qv = (role, low, high) => ({ role, rowId: "row-1", low, high });
const web = (role, low, high, extra = {}) => ({
  role,
  sourceId: "source-1",
  source: "https://x.test/",
  low,
  high,
  ...extra,
});

test("the host's answer check catches the mistakes that split A8's runs, and passes clean answers", () => {
  // A hedge three times wide or more.
  assert.match(reviewCostBand(answer({ low: 30, high: 200 }, [qv("Removal", 30, 200)]))[0], /spans 6.7×/);
  assert.deepEqual(reviewCostBand(answer({ low: 60, high: 110 }, [qv("Removal", 60, 110)])), []);
  // A one-off cost inside a per-m² band, unless it is spread.
  const delivery = reviewCostBand(
    answer({ low: 744, high: 1048 }, [
      qv("Cladding", 520, 720),
      qv("Boom lift delivery and pickup", 400, 1200),
    ]),
  );
  assert.match(delivery[0], /reads as a one-off cost, but your band is per m²/);
  assert.deepEqual(
    reviewCostBand(
      answer({ low: 650, high: 760 }, [
        qv("Cladding", 640, 740),
        qv("Boom lift delivery, amortised over the area", 1, 2),
      ]),
    ),
    [],
  );
  // A change priced with no credit for what it removes.
  const switching =
    "Client wants to know the cost impact of switching the roof from long-run coloursteel to a membrane";
  assert.match(
    reviewCostBand(answer({ low: 222, high: 283 }, [qv("Membrane", 137, 186)]), switching)[0],
    /no credit/,
  );
  assert.deepEqual(
    reviewCostBand(
      answer({ low: 37, high: 174 }, [qv("Membrane", 97, 186), qv("Deleted Coloursteel", -141, -116)]),
      switching,
    ),
    [],
  );
  // The main cost from a web page with no word about QV, unless QV never publishes it.
  assert.match(
    reviewCostBand(
      answer({ low: 700, high: 1100, unit: "ea" }, [
        web("Mortice lockset kit", 248, 448),
        qv("Labour", 120, 200),
      ]),
    )[0],
    /Search QV for it/,
  );
  assert.deepEqual(
    reviewCostBand(
      answer({ low: 700, high: 1100, unit: "ea" }, [
        web("Mortice lockset kit", 248, 448, { caveat: "QV searches for lockset found no row" }),
      ]),
    ),
    [],
  );
  assert.deepEqual(
    reviewCostBand(
      answer({ low: 240000, high: 270000, unit: "sum" }, [
        web("Vector capital contribution", 179550, 182010),
      ]),
    ),
    [],
  );
  // A cross-check shown but not added is not the main cost.
  assert.deepEqual(
    reviewCostBand(
      answer({ low: 700, high: 900, unit: "ea" }, [
        web("Cross-check only (not summed): retail kit", 5000, 6000),
        qv("Lockset", 700, 900),
      ]),
    ),
    [],
  );
  assert.match(reviewMessage(["One.", "Two."]), /1\. One\.\n2\. Two\.[\s\S]*your next answer is final/);
});

test("with five runs the three closest are scored and the other two are kept, marked dropped", () => {
  const run = (label, low, high, status = "completed") => ({
    id: `q-${label}`,
    runLabel: label,
    status,
    updatedAt: "2026-09-25T00:00:00Z",
    outcome: { costBand: { band: low == null ? null : { low, high, unit: "m2" }, components: [] } },
  });
  const question = {
    id: "q",
    projectId: "p",
    title: "Q",
    objective: "Q",
    createdAt: "2026-09-25T00:00:00Z",
    runsPlanned: 5,
  };
  const record = questionRecord({
    question,
    runs: [
      run("r1", 100, 150),
      run("r2", 105, 155),
      run("r3", 300, 400),
      run("r4", 98, 160),
      run("r5", null, null),
    ],
  });
  assert.equal(record.status, "agreed");
  assert.deepEqual(
    record.runs.filter((entry) => entry.dropped).map((entry) => entry.run),
    ["r3", "r5"],
  );
  assert.equal(record.agreement.runsTotal, 3);
  // Three runs are never dropped from.
  const three = questionRecord({
    question,
    runs: [run("r1", 100, 150), run("r2", 105, 155), run("r3", 300, 400)],
  });
  assert.equal(three.status, "disputed");
  assert.equal(
    three.runs.some((entry) => entry.dropped),
    false,
  );
});
