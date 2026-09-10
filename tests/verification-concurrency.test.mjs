import assert from "node:assert/strict";
import test from "node:test";
import { VerificationSlots } from "../server/verification-concurrency.mjs";
import { runRepositoryVerification } from "../server/verification.mjs";

const MANIFEST = {
  version: 1,
  commands: [{ id: "test", title: "Tests", command: ["npm", "test"] }],
};

function candidate() {
  return { id: "C1", revisionNumber: 1, headRevision: "a".repeat(40) };
}

function deferred() {
  const box = {};
  box.promise = new Promise((resolve) => {
    box.resolve = resolve;
  });
  return box;
}

test("holds concurrent verification at the configured ceiling and releases in arrival order", async () => {
  const slots = new VerificationSlots(2);
  const started = [];
  const gates = [deferred(), deferred(), deferred()];

  const runs = [0, 1, 2].map(async (index) => {
    const release = await slots.acquire();
    started.push(index);
    await gates[index].promise;
    release();
  });

  // Two run; the third is queued behind them rather than oversubscribing the machine.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1]);
  assert.equal(slots.active, 2);
  assert.equal(slots.waiting, 1);

  gates[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(slots.active, 2);

  gates[1].resolve();
  gates[2].resolve();
  await Promise.all(runs);
  assert.equal(slots.active, 0);
  assert.equal(slots.waiting, 0);
});

test("never hands out more slots than the ceiling under a burst", async () => {
  const slots = new VerificationSlots(3);
  let peak = 0;
  await Promise.all(
    Array.from({ length: 25 }, async () => {
      const release = await slots.acquire();
      peak = Math.max(peak, slots.active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      release();
    }),
  );
  assert.equal(peak, 3);
  assert.equal(slots.active, 0);
});

test("reports the wait exactly once, and only to a caller that actually queues", async () => {
  const slots = new VerificationSlots(1);
  const waits = [];
  const onWait = async (detail) => {
    waits.push(detail);
  };

  const first = deferred();
  const held = slots.acquire({ onWait }).then(async (release) => {
    await first.promise;
    release();
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(waits, [], "a caller that takes a free slot is not reported as waiting");

  const queued = slots.acquire({ onWait }).then((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waits.length, 1);
  assert.deepEqual(waits[0], { limit: 1, active: 1, position: 1 });

  first.resolve();
  await Promise.all([held, queued]);
  assert.equal(waits.length, 1);
});

test("a cancelled task leaves the queue instead of holding the slot behind it", async () => {
  const slots = new VerificationSlots(1);
  const first = deferred();
  const held = slots.acquire().then(async (release) => {
    await first.promise;
    release();
  });

  const controller = new AbortController();
  const cancelled = slots.acquire({ signal: controller.signal });
  const following = slots.acquire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slots.waiting, 2);

  controller.abort(new Error("Task cancelled."));
  await assert.rejects(cancelled, /Task cancelled/);
  assert.equal(slots.waiting, 1);

  first.resolve();
  await held;
  (await following)();
  assert.equal(slots.active, 0);
});

test("an already-aborted caller never takes a slot", async () => {
  const slots = new VerificationSlots(1);
  const controller = new AbortController();
  controller.abort(new Error("Gone."));
  await assert.rejects(slots.acquire({ signal: controller.signal }), /Gone/);
  assert.equal(slots.active, 0);
});

test("verification binds evidence to the revision it ran at, not the one it queued at", async () => {
  const slots = new VerificationSlots(1);
  const heldByOther = await slots.acquire();
  const reads = [];
  const headRevision = "a".repeat(40);

  const waits = [];
  const run = runRepositoryVerification({
    worktreePath: "/tmp/does-not-matter",
    candidate: candidate(),
    manifest: MANIFEST,
    acquireSlot: (options) => slots.acquire(options),
    onQueueWait: async (detail) => {
      waits.push(detail);
    },
    readHeadRevision: async () => {
      reads.push(headRevision);
      return headRevision;
    },
    runCommand: async ({ command }) => ({
      id: command.id,
      title: command.title,
      command: "npm test",
      status: "passed",
      exitCode: 0,
      durationMs: 1,
      output: "",
      assertions: [],
      artifactReferences: [],
      failureDetails: null,
    }),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waits.length, 1, "the queued manifest records its wait");
  assert.deepEqual(reads, [], "the head is not read while the run is only queued");

  heldByOther();
  const result = await run;
  assert.equal(result.status, "passed");
  assert.equal(result.headRevision, headRevision);
  assert.equal(reads.length, 2, "the head is read once before the commands and once after");
  assert.equal(slots.active, 0, "the slot is returned once the commands finish");
});

test("a failing manifest still returns its slot", async () => {
  const slots = new VerificationSlots(1);
  await assert.rejects(
    runRepositoryVerification({
      worktreePath: "/tmp/does-not-matter",
      candidate: candidate(),
      manifest: MANIFEST,
      acquireSlot: (options) => slots.acquire(options),
      readHeadRevision: async () => "a".repeat(40),
      runCommand: async () => {
        throw new Error("spawn failed");
      },
    }),
    /spawn failed/,
  );
  assert.equal(slots.active, 0);
  assert.equal(slots.waiting, 0);
});
