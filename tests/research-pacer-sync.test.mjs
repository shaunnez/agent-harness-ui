// Pacing shared across the research service's workers (`engine/pacer-sync.mjs`): the account-wide
// limit is learned from every worker's calls and divided among the workers still running, a burst
// of throttles halves it once, a 429 holds everyone, and a worker alone keeps the whole limit.
// Postgres is PGlite in memory.

import assert from "node:assert/strict";
import test from "node:test";
import { AdaptivePacer } from "@eversor/research-engine/engine/pacer.mjs";
import { PacerSync } from "@eversor/research-engine/engine/pacer-sync.mjs";
import { PgPacerStore } from "@eversor/research-engine/pg/pacer-store.mjs";
import { migrateResearchSchema } from "@eversor/research-engine/pg/schema.mjs";
import { openDatabase } from "@eversor/research-service/src/db.mjs";

async function withDb(body) {
  const db = await openDatabase("pglite:memory");
  try {
    await migrateResearchSchema(db);
    return await body(db);
  } finally {
    await db.close();
  }
}

function worker(db, id, clock, settings = {}) {
  const pacer = new AdaptivePacer({
    min: 1,
    max: 12,
    initial: 6,
    successesToGrow: 4,
    now: () => clock.now,
    ...settings,
  });
  const sync = new PacerSync({
    pacer,
    store: new PgPacerStore(db, { key: "deepinfra" }),
    workerId: id,
    now: () => clock.now,
  });
  return { pacer, sync };
}

test("one worker alone keeps the whole limit, and grows it as before", async () => {
  await withDb(async (db) => {
    const clock = { now: 1_000_000 };
    const a = worker(db, "a", clock);
    await a.sync.sync();
    assert.equal(a.pacer.limit, 6);
    for (let index = 0; index < 4; index += 1) a.pacer.succeeded();
    await a.sync.sync();
    assert.equal(a.pacer.limit, 7);
    assert.deepEqual(a.sync.snapshot(), { limit: 7, share: 7, workers: 1, cooldownUntil: 0 });
  });
});

test("two workers split the limit and learn it from both their calls", async () => {
  await withDb(async (db) => {
    const clock = { now: 1_000_000 };
    const a = worker(db, "a", clock);
    const b = worker(db, "b", clock);
    await a.sync.sync();
    await b.sync.sync();
    await a.sync.sync();
    assert.equal(a.pacer.limit, 3);
    assert.equal(b.pacer.limit, 3);
    // Two clean calls each make four together: the shared limit grows by one.
    for (const { pacer } of [a, b]) {
      pacer.succeeded();
      pacer.succeeded();
    }
    await a.sync.sync();
    const shared = await b.sync.sync();
    assert.equal(shared.limit, 7);
    assert.equal(b.pacer.limit, 3);
  });
});

test("throttles from several workers halve the limit once, and hold every worker", async () => {
  await withDb(async (db) => {
    const clock = { now: 1_000_000 };
    const a = worker(db, "a", clock, { max: 12, initial: 8 });
    const b = worker(db, "b", clock, { max: 12, initial: 8 });
    await a.sync.sync();
    await b.sync.sync();
    a.pacer.throttled(10_000);
    b.pacer.throttled(10_000);
    await a.sync.sync();
    const shared = await b.sync.sync();
    assert.equal(shared.limit, 4, "halved once for one burst, not once per worker");
    assert.equal(shared.cooldownUntil, clock.now + 10_000);
    await a.sync.sync();
    assert.ok(a.pacer.delayMs() > 0 && b.pacer.delayMs() > 0);
  });
});

test("a worker that stops or goes quiet gives its share back", async () => {
  await withDb(async (db) => {
    const clock = { now: 1_000_000 };
    const a = worker(db, "a", clock);
    const b = worker(db, "b", clock);
    await a.sync.sync();
    await b.sync.sync();
    await a.sync.sync();
    assert.equal(a.pacer.limit, 3);
    await b.sync.stop();
    await a.sync.sync();
    assert.equal(a.pacer.limit, 6);

    const c = worker(db, "c", clock);
    await c.sync.sync();
    await a.sync.sync();
    assert.equal(a.pacer.limit, 3);
    clock.now += 20_000;
    await a.sync.sync();
    assert.equal(a.pacer.limit, 6, "a worker not heard from in 15 seconds no longer counts");
  });
});
