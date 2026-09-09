import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { RefreshCoordinator } from "../../src/frontier/runtime/coordinator.ts";

async function until(predicate) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Expected refresh state was not reached");
}

test("an obsolete selection response never replaces the current inspector", async () => {
  const gateway = createFixtureGateway();
  const core = gateway.core;
  let release;
  gateway.core = async (id) => {
    if (id === "PC-153")
      await new Promise((resolve) => {
        release = resolve;
      });
    return core(id);
  };
  const runtime = new RefreshCoordinator(gateway);
  try {
    runtime.start();
    await until(() => runtime.getSnapshot().connection === "connected");
    runtime.select("PC-153");
    await until(() => Boolean(release));
    runtime.select("PC-148");
    release();
    await until(() => runtime.getSnapshot().selected?.core.id === "PC-148");
    assert.equal(runtime.getSnapshot().selectedId, "PC-148");
  } finally {
    runtime.stop();
  }
});

test("offline refresh retains last-known records and recovers without duplicate owners", async () => {
  const gateway = createFixtureGateway();
  const status = gateway.status;
  const runtime = new RefreshCoordinator(gateway);
  try {
    runtime.start();
    await until(() => runtime.getSnapshot().tasks.length === 12);
    gateway.status = async () => {
      throw new Error("Test disconnect");
    };
    runtime.retry();
    await until(() => runtime.getSnapshot().connection === "offline");
    assert.equal(runtime.getSnapshot().tasks.length, 12);
    assert.match(runtime.getSnapshot().error, /disconnect/);
    gateway.status = status;
    runtime.retry();
    await until(() => runtime.getSnapshot().connection === "connected");
    assert.equal(runtime.getSnapshot().tasks.length, 12);
  } finally {
    runtime.stop();
  }
});

test("fixture answers have no network side effects and reject a stale second answer", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Fixture attempted network access");
  };
  try {
    const gateway = createFixtureGateway();
    await gateway.answer("PC-153", "Q2", "Normalise labels");
    assert.equal((await gateway.core("MS-086")).grillSession.questions[0].answer, null);
    await assert.rejects(gateway.answer("PC-153", "Q2", "Different answer"), /already answered/);
    await gateway.finishGrill("PC-153");
    assert.equal((await gateway.core("PC-153")).status, "awaiting-spec-approval");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a command synchronization waits beyond the in-flight stale refresh", async () => {
  const gateway = createFixtureGateway();
  const originalCore = gateway.core;
  let release;
  gateway.core = async (id) => {
    const captured = await originalCore(id);
    if (!release)
      await new Promise((resolve) => {
        release = resolve;
      });
    return captured;
  };
  const runtime = new RefreshCoordinator(gateway);
  try {
    runtime.start();
    await until(() => runtime.getSnapshot().tasks.length === 12);
    runtime.select("PC-153");
    await until(() => Boolean(release));
    await gateway.answer("PC-153", "Q2", "Normalise labels");
    let synchronized = false;
    const barrier = runtime.synchronize().then(() => {
      synchronized = true;
    });
    assert.equal(synchronized, false);
    release();
    await barrier;
    assert.equal(runtime.getSnapshot().selected.core.grillSession.questions[1].answer, "Normalise labels");
  } finally {
    runtime.stop();
  }
});
