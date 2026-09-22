import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// This is a behavior check, not the full repository/browser acceptance gate.
// Keep it outside the candidate and provide no reference implementation.
const [repository, outputPath] = process.argv.slice(2);
if (!repository || !outputPath) throw new Error("Usage: m01.mjs <candidate-checkout> <new-receipt.json>");
const temporary = await mkdtemp(path.join(os.tmpdir(), "eval-m01-"));
const checks = [];
try {
  const bundle = path.join(temporary, "calendar.mjs");
  await build({
    entryPoints: [path.resolve(repository, "frontend/src/features/obligations/calendar/model.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
    logLevel: "silent",
  });
  const model = await import(pathToFileURL(bundle).href);
  const today = "2026-09-15";
  const item = (overrides = {}) => ({
    key: "fixture",
    openId: "fixture",
    name: "Fixture",
    dueDate: "2026-09-10",
    bucket: "overdue",
    positionLabel: "Overdue",
    detail: null,
    actionLabel: "Open",
    accent: "red",
    scopeLine: "Scheme",
    scopeLevel: "site",
    buildingId: null,
    ...overrides,
  });
  const check = (id, run) => {
    try {
      run();
      checks.push({ id, passed: true });
    } catch (error) {
      checks.push({ id, passed: false, detail: error.message });
    }
  };
  check("overdue-task-date", () => {
    for (const completed of [false, true]) {
      const placed = model.placeItem(item({ kind: "task", completed }), today);
      assert.equal(placed.cellDate, "2026-09-10");
      assert.equal(placed.originalDueDate, null);
    }
  });
  check("task-today-future-and-year-boundary", () => {
    for (const dueDate of ["2025-12-31", today, "2026-12-31"]) {
      assert.equal(model.placeItem(item({ kind: "task", dueDate }), today).cellDate, dueDate);
    }
  });
  check("obligation-sweep", () => {
    for (const kind of [undefined, "obligation"]) {
      const placed = model.placeItem(item({ kind }), today);
      assert.equal(placed.cellDate, today);
      assert.equal(placed.originalDueDate, "2026-09-10");
    }
  });
  check("mixed-grid-placement", () => {
    const { placed } = model.partitionItems(
      [item({ key: "task", kind: "task" }), item({ key: "obligation" })],
      today,
    );
    const byDate = model.itemsByDate(placed);
    assert.deepEqual(
      byDate.get("2026-09-10").map((value) => value.key),
      ["task"],
    );
    assert.deepEqual(
      byDate.get(today).map((value) => value.key),
      ["obligation"],
    );
  });
  check("task-excluded-from-obligation-tally", () => {
    const items = [item({ kind: "task" }), item()];
    assert.equal(model.tallyBuckets(items).find((value) => value.bucket === "overdue").count, 1);
    const { placed } = model.partitionItems(items, today);
    assert.equal(model.overdueItems(placed).length, 1);
    assert.equal(model.overdueItems(placed)[0].kind, undefined);
  });
  check("undated-preserved", () => {
    const source = item({ kind: "task", dueDate: null });
    const result = model.partitionItems([source], today);
    assert.equal(result.placed.length, 0);
    assert.deepEqual(result.undated, [source]);
  });
  const result = {
    caseId: "M01",
    graderVersion: "m01-model-v2",
    repository: path.resolve(repository),
    scope: "calendar-model-only",
    passed: checks.every((check) => check.passed),
    checks,
    inferenceCalls: 0,
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(result));
  process.exitCode = result.passed ? 0 : 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
