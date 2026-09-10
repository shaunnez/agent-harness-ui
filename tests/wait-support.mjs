import assert from "node:assert/strict";

/**
 * Shared polling helpers for the orchestrator-backed suites.
 *
 * These suites drive a real state machine and observe it through the store, so every
 * wait is a race between the poll and the transition. Two habits made them flaky on a
 * loaded machine — several harness tasks running `npm test` at once is enough — and both
 * are fixed here:
 *
 * 1. **Attempt counts are not budgets.** `400 * 5ms` is 2s only when the machine is idle;
 *    every `await` in the loop stretches under contention. Budgets are wall-clock.
 * 2. **A terminal-looking status is not a stopped run.** A task legitimately passes
 *    through `blocked`, `failed` and `repair-required` on its way somewhere else, so
 *    failing on the first sighting reports a transition as an outcome. A stop is only
 *    real once the task has gone quiet.
 */

/** Wall-clock budget for a single wait. Raise it for slow or heavily loaded machines. */
export const TEST_WAIT_TIMEOUT_MS = Number(process.env.AGENT_HARNESS_TEST_WAIT_MS ?? 30_000);

/** How long a terminal status must hold, unchanged, before it counts as a stop. */
const TERMINAL_SETTLE_MS = 750;

const TERMINAL_STATUSES = ["failed", "blocked", "cancelled", "repair-required"];

const POLL_INTERVAL_MS = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Everything a still-moving task changes as it advances. */
function progressSignature(task) {
  return [task.status, task.updatedAt ?? "", task.events?.length ?? 0, task.revision ?? ""].join("|");
}

/** Poll `predicate` until it is truthy, then return its value. */
export async function waitUntil(predicate, describe = "condition", { timeoutMs = TEST_WAIT_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) assert.fail(`Timed out after ${timeoutMs}ms waiting for ${describe}.`);
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Poll the store until `id` reaches `expected`, failing early only on a settled stop. */
export async function waitForTaskStatus(store, id, expected, { timeoutMs = TEST_WAIT_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let settledSignature = null;
  let settledSince = 0;
  let last = null;
  for (;;) {
    const task = await store.get(id);
    last = task;
    if (task?.status === expected) return task;
    if (task && TERMINAL_STATUSES.includes(task.status)) {
      const signature = progressSignature(task);
      if (signature !== settledSignature) {
        settledSignature = signature;
        settledSince = Date.now();
      } else if (Date.now() - settledSince >= TERMINAL_SETTLE_MS) {
        assert.fail(`Task stopped at ${task.status}: ${task.error ?? "no error"}`);
      }
    } else {
      settledSignature = null;
    }
    if (Date.now() >= deadline) {
      assert.fail(
        `Task did not reach ${expected} within ${timeoutMs}ms. Last status ${last?.status ?? "unknown"}: ${last?.error ?? "no error"}`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
