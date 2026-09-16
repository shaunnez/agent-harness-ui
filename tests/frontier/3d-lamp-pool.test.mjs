import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { LampPool, lampBudget } from "../../src/frontier/world-3d/lamp-pool.ts";

/** Lamps in a line along +X, so distance order is the same as the order they are built in. */
function line(count, spacing = 10) {
  return Array.from({ length: count }, (_, index) => ({
    key: `lamp-${index}`,
    position: [index * spacing, 0, 0],
  }));
}
/** Settle the pool at one viewpoint, long enough for every fade to finish. */
function settle(pool, lamps, viewer, seconds = 2) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) pool.update(lamps, viewer, 1 / 60);
}
const lit = (pool) => pool.slots.filter((slot) => slot.level > 0);

test("the station's lamps outnumber the lights the pool will ever run", () => {
  // The manifest gives three bases seven lamps each, plus two environment lamps apiece.
  assert.ok(lampBudget < 27, "the budget has to be a cut, or night pays for every lamp");
  assert.equal(new LampPool().slots.length, lampBudget);
});

test("the light count never changes, because it is a shader define", () => {
  const pool = new LampPool(4);
  const lamps = line(20);
  const viewer = new Vector3(0, 0, 0);
  for (let i = 0; i < 300; i++) {
    viewer.x = Math.sin(i / 17) * 200;
    pool.update(lamps, viewer, 1 / 60);
    assert.equal(pool.slots.length, 4);
  }
});

test("the lamps nearest the viewer are the ones given a light", () => {
  const pool = new LampPool(3);
  const lamps = line(10);
  settle(pool, lamps, new Vector3(0, 0, 0));
  assert.deepEqual(pool.slots.map((slot) => slot.key).sort(), ["lamp-0", "lamp-1", "lamp-2"]);
  // Walk to the far end and the far lamps take over.
  settle(pool, lamps, new Vector3(90, 0, 0));
  assert.deepEqual(pool.slots.map((slot) => slot.key).sort(), ["lamp-7", "lamp-8", "lamp-9"]);
  for (const slot of pool.slots) assert.equal(slot.level, 1);
});

test("a slot dims out before it is handed to another lamp, so neither one pops", () => {
  const pool = new LampPool(1);
  const lamps = line(2);
  settle(pool, lamps, new Vector3(0, 0, 0));
  assert.equal(pool.slots[0].key, "lamp-0");
  const far = new Vector3(10, 0, 0);
  let handed = false;
  for (let i = 0; i < 120; i++) {
    const before = { ...pool.slots[0] };
    pool.update(lamps, far, 1 / 60);
    const after = pool.slots[0];
    if (after.key !== before.key) {
      handed = true;
      assert.equal(after.level, 0, "the new lamp came in already lit");
    }
    // Whatever the slot is doing, its brightness only ever moves by one step of the fade.
    assert.ok(
      Math.abs(after.level - before.level) <= 1 / 60 / 0.35 + 1e-9,
      `brightness jumped from ${before.level} to ${after.level}`,
    );
  }
  assert.ok(handed, "the pool never moved its light to the nearer lamp");
  assert.equal(pool.slots[0].key, "lamp-1");
  assert.equal(pool.slots[0].level, 1);
});

test("a slot with no lamp to light holds nothing and stays dark", () => {
  const pool = new LampPool(6);
  const lamps = line(2);
  settle(pool, lamps, new Vector3(0, 0, 0));
  assert.equal(lit(pool).length, 2);
  for (const slot of pool.slots)
    if (slot.key === null) assert.equal(slot.level, 0);
    else assert.equal(slot.level, 1);
});

test("no lamps at all leaves every slot dark rather than throwing", () => {
  const pool = new LampPool(3);
  settle(pool, [], new Vector3(0, 0, 0));
  assert.equal(lit(pool).length, 0);
  assert.deepEqual(
    pool.slots.map((slot) => slot.key),
    [null, null, null],
  );
});
