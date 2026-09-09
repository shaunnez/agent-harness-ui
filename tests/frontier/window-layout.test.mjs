import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultWindow,
  fitWindow,
  readWindowSizes,
  resizedWindow,
  saveWindowSizes,
  windowBounds,
  windowLayoutKey,
} from "../../src/frontier/app/window-layout.ts";
const laptop = { width: 1280, height: 720 };
test("window dimensions survive storage and remain independent by family", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  const sizes = { task: { width: 1100, height: 600 }, agent: { width: 580, height: 578 } };
  saveWindowSizes(storage, sizes);
  assert.deepEqual(readWindowSizes(storage), sizes);
  assert.deepEqual(Object.keys(JSON.parse(data.get(windowLayoutKey))).sort(), ["agent", "task"]);
});
test("unavailable or malformed storage falls back without affecting work", () => {
  assert.deepEqual(
    readWindowSizes({
      getItem: () => {
        throw new Error("denied");
      },
    }),
    {},
  );
  assert.doesNotThrow(() =>
    saveWindowSizes(
      {
        setItem: () => {
          throw new Error("full");
        },
      },
      {},
    ),
  );
  for (const text of [
    "{",
    "null",
    '{"task":{"width":-1,"height":600}}',
    '{"task":{"width":"1000","height":600}}',
    '{"agent":{"width":10001,"height":600}}',
  ])
    assert.deepEqual(readWindowSizes({ getItem: () => text }), {});
  assert.deepEqual(
    readWindowSizes({
      getItem: () =>
        '{"unknown":{"width":1000,"height":600},"task":{"width":1100,"height":600,"draft":"private"}}',
    }),
    { task: { width: 1100, height: 600 } },
  );
});
test("resize respects centred drag, viewport changes and a restorable normal size", () => {
  const normal = defaultWindow("task", laptop);
  assert.deepEqual(normal, { width: 1248, height: 672 });
  assert.deepEqual(windowBounds("task", laptop, true), { width: 1264, height: 704 });
  assert.deepEqual(resizedWindow(normal, "se", -40, -30, true), { width: 1168, height: 612 });
  assert.equal(resizedWindow({ width: 540, height: 578 }, "w", -80, 0, false).width, 620);
  assert.deepEqual(fitWindow({ width: 8000, height: 8000 }, "task", { width: 640, height: 360 }), {
    width: 608,
    height: 312,
  });
  assert.deepEqual(fitWindow(normal, "task", { width: 375, height: 720 }), { width: 343, height: 672 });
  assert.deepEqual(
    normal,
    { width: 1248, height: 672 },
    "clamping and maximising cannot overwrite the remembered restore dimensions",
  );
});
