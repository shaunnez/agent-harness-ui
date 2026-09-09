import assert from "node:assert/strict";
import test from "node:test";
import { AnimationVisibility } from "../../src/frontier/world/visibility.ts";

class TestDocument extends EventTarget {
  hidden = false;
  hide(value) {
    this.hidden = value;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

test("document backgrounding stops animation and returning respects motion and connection", () => {
  const document = new TestDocument();
  const changes = [];
  const lifecycle = new AnimationVisibility(document, (running) => changes.push(running));
  lifecycle.update(true, true);
  assert.equal(changes.at(-1), true);
  document.hide(true);
  assert.equal(changes.at(-1), false);
  lifecycle.update(true, true);
  assert.equal(changes.at(-1), false, "a background refresh must not restart the ticker");
  document.hide(false);
  assert.equal(changes.at(-1), true);
  lifecycle.update(false, true);
  document.hide(true);
  document.hide(false);
  assert.equal(changes.at(-1), false, "reduced motion must survive returning to the page");
  lifecycle.update(true, false);
  document.hide(true);
  document.hide(false);
  assert.equal(changes.at(-1), false, "offline workers remain parked after returning");
  lifecycle.update(true, true);
  assert.equal(changes.at(-1), true);
  lifecycle.dispose();
  const disposedChanges = changes.length;
  document.hide(true);
  document.hide(false);
  assert.equal(changes.length, disposedChanges, "disposed worlds cannot resume from document events");
  assert.equal(changes.at(-1), false);
});
