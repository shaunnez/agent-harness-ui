import assert from "node:assert/strict";
import test from "node:test";
import { startPullRequestPolling } from "../server/pull-request-poller.mjs";

test("PR reconciliation is deferred until after startup and remains periodically scheduled", async () => {
  const scheduled = [];
  let polls = 0;
  const stop = startPullRequestPolling(
    { pollPullRequests: async () => { polls += 1; } },
    {
      intervalMs: 30_000,
      schedule: (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
      cancel: () => {},
      reportError: () => assert.fail("polling should not fail"),
    },
  );

  assert.equal(polls, 0);
  assert.equal(scheduled[0].delay, 0);
  await scheduled[0].callback();
  assert.equal(polls, 1);
  assert.equal(scheduled[1].delay, 30_000);
  stop();
});
