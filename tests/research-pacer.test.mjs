// The research service's pacer (`engine/pacer.mjs`): how many runs call the model at once, grown
// while calls go through and halved when the provider throttles, with a shared hold after a 429.

import assert from "node:assert/strict";
import test from "node:test";
import { chatOnceWithRetries } from "@eversor/research-engine/api-loop/chat-loop.mjs";
import { AdaptivePacer } from "@eversor/research-engine/engine/pacer.mjs";

const FIREWORKS = "fireworks-us/accounts/fireworks/routers/deepseek-v4p1-flash-us";

function ok(text = "Done.") {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: {} }),
    { status: 200 },
  );
}

function throttled(retryAfter = null) {
  return new Response('{"error":{"message":"rate limit exceeded, please try again later"}}', {
    status: 429,
    headers: retryAfter ? { "retry-after": String(retryAfter) } : {},
  });
}

test("the pacer grows by one after a run of successes and halves on a throttle", () => {
  const changes = [];
  const pacer = new AdaptivePacer({ min: 1, max: 8, initial: 4, successesToGrow: 3 });
  pacer.onChange((limit) => changes.push(limit));
  for (let index = 0; index < 3; index += 1) pacer.succeeded();
  assert.equal(pacer.limit, 5);
  pacer.succeeded();
  pacer.succeeded();
  // A throttle resets the count, so two successes before it do not carry over.
  pacer.throttled();
  assert.equal(pacer.limit, 2);
  pacer.throttled();
  pacer.throttled();
  assert.equal(pacer.limit, 1, "never below the minimum");
  for (let index = 0; index < 60; index += 1) pacer.succeeded();
  assert.equal(pacer.limit, 8, "never above the maximum");
  assert.deepEqual(changes.slice(0, 3), [5, 2, 1]);
  assert.equal(pacer.snapshot().throttles, 3);
});

test("a throttle holds every caller until the provider's Retry-After", () => {
  let clock = 1_000;
  const pacer = new AdaptivePacer({ initial: 2, defaultCooldownMs: 5_000, now: () => clock });
  assert.equal(pacer.delayMs(), 0);
  pacer.throttled(12_000);
  assert.equal(pacer.delayMs(), 12_000);
  clock += 4_000;
  assert.equal(pacer.delayMs(), 8_000);
  // A shorter wait never shortens a longer one already asked for.
  pacer.throttled(1_000);
  assert.equal(pacer.delayMs(), 8_000);
  clock += 8_000;
  assert.equal(pacer.delayMs(), 0);
  pacer.throttled();
  assert.equal(pacer.delayMs(), 5_000, "no Retry-After: the default hold");
});

test("a model call reports its throttles and success to the pacer, and waits out its hold", async () => {
  let clock = 0;
  const waits = [];
  const pacer = new AdaptivePacer({ initial: 4, max: 4, now: () => clock });
  const replies = [throttled(3), ok()];
  const reply = await chatOnceWithRetries({
    env: { FIREWORKS_API_KEY: "test" },
    model: FIREWORKS,
    systemPrompt: "x",
    prompt: "y",
    timeoutMs: 600_000,
    fetchImpl: async () => replies.shift(),
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    pacer,
  });
  assert.equal(reply.text, "Done.");
  assert.equal(pacer.limit, 2, "halved by the throttle");
  assert.equal(pacer.snapshot().throttles, 1);
  // The call's own retry waited the Retry-After; the pacer's hold had passed by then.
  assert.deepEqual(waits, [3_000]);
});

test("a call made while another run's throttle is being waited out waits for it first", async () => {
  let clock = 0;
  const waits = [];
  const pacer = new AdaptivePacer({ initial: 2, now: () => clock });
  pacer.throttled(7_000);
  await chatOnceWithRetries({
    env: { FIREWORKS_API_KEY: "test" },
    model: FIREWORKS,
    systemPrompt: "x",
    prompt: "y",
    timeoutMs: 600_000,
    fetchImpl: async () => ok(),
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    pacer,
  });
  assert.deepEqual(waits, [7_000]);
});
