import assert from "node:assert/strict";
import test from "node:test";
import { refreshPage } from "../../src/frontier/runtime/pages.ts";

test("refresh preserves paged history, updates shared records, and closes a complete result", () => {
  const previous = {
    items: [
      { id: "b", state: "running" },
      { id: "a", state: "completed" },
    ],
    total: 3,
    nextCursor: "older-a",
  };
  const result = refreshPage(previous, {
    items: [{ id: "c" }, { id: "b", state: "completed" }],
    total: 4,
    nextCursor: "older-b",
  });
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["c", "b", "a"],
  );
  assert.equal(result.items[1].state, "completed");
  assert.equal(result.nextCursor, "older-a");
  assert.equal(refreshPage(previous, { items: [{ id: "b" }], total: 1, nextCursor: null }).items.length, 1);
});
test("refresh without overlap restarts from its leading cursor instead of skipping unknown records", () => {
  const latest = { items: [{ id: "d" }, { id: "c" }], total: 4, nextCursor: "older-c" };
  assert.deepEqual(refreshPage({ items: [{ id: "a" }], nextCursor: null, total: 1 }, latest), latest);
});
