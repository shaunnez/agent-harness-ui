import assert from "node:assert/strict";
import test from "node:test";
import { ShadowCadence } from "../../src/frontier/world-3d/shadow-cadence.ts";

/** Run a stretch of frames at a fixed cost, counting the ones that rebuild the shadow map. */
function frames(cadence, count, frameMs, start = 0) {
  let rebuilt = 0;
  for (let i = 0; i < count; i++) if (cadence.expired(start + i * frameMs)) rebuilt++;
  return rebuilt;
}

test("the first frame has no shadow map to keep", () => {
  assert.equal(new ShadowCadence().expired(0), true);
});

test("a comfortable frame refreshes shadows at the interval, not every frame", () => {
  const cadence = new ShadowCadence();
  cadence.expired(0);
  // One second of 60fps frames: fifteen refreshes, not sixty.
  const rebuilt = frames(cadence, 60, 1000 / 60, 1000 / 60);
  assert.ok(rebuilt >= 13 && rebuilt <= 16, `refreshed ${rebuilt} times in a second`);
});

test("a frame slower than the interval still defers shadows instead of refreshing every frame", () => {
  // The night scene measured 86.9ms a frame, which clears a 66.7ms wall-clock gate every time.
  const cadence = new ShadowCadence();
  cadence.expired(0);
  const rebuilt = frames(cadence, 40, 86.9, 86.9);
  assert.ok(rebuilt <= 40 / 4, `refreshed ${rebuilt} of 40 slow frames, so the throttle inverted under load`);
  assert.ok(rebuilt > 0, "shadows must still refresh, however slow the frame");
});

test("a fast display is held to the interval rather than to its frame count", () => {
  const cadence = new ShadowCadence();
  cadence.expired(0);
  // 120fps for a second: the frame gate alone would allow thirty refreshes.
  const rebuilt = frames(cadence, 120, 1000 / 120, 1000 / 120);
  assert.ok(rebuilt <= 16, `refreshed ${rebuilt} times, so the interval is not holding`);
});

test("no run of frames spends more than one in four on the shadow map", () => {
  for (const frameMs of [4, 8.3, 16.7, 33, 66.7, 86.9, 200]) {
    const cadence = new ShadowCadence();
    const rebuilt = frames(cadence, 100, frameMs);
    assert.ok(
      rebuilt <= 100 / 4 + 1,
      `${frameMs}ms frames refreshed ${rebuilt} of 100, which is not a throttle`,
    );
  }
});
