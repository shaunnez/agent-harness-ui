// How the API loop talks to its provider: streamed replies assembled into the reply a plain call
// returns, a stalled stream retried, the provider's own cost recorded beside ours, reasoning levels
// per call, and a question's later runs held until the first has warmed the prompt cache. Stub
// endpoints only; nothing here reaches a provider.

import assert from "node:assert/strict";
import test from "node:test";
import { chatOnceWithRetries, runChatLoop } from "@eversor/research-engine/api-loop/chat-loop.mjs";
import { openingKey, PrefixWarmer } from "@eversor/research-engine/api-loop/prefix-warmer.mjs";
import { API_LOOP_PROVIDERS, reasoningSettings } from "@eversor/research-engine/api-loop/providers.mjs";

const DEEPINFRA = "deepinfra/deepseek-ai/DeepSeek-V4.1-Flash";
const ENV = { DEEPINFRA_API_KEY: "test" };

/** A server-sent-events body from chunk objects, ending in [DONE] unless told not to. */
function sse(chunks, { done = true } = {}) {
  const text = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}${done ? "data: [DONE]\n\n" : ""}`;
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

test("a streamed answer is assembled into the same reply, reasoning and tool calls included", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return sse([
      { id: "c1", choices: [{ index: 0, delta: { reasoning_content: "Think" } }] },
      { choices: [{ index: 0, delta: { reasoning_content: "ing." } }] },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, id: "call-1", function: { name: "search_qv", arguments: '{"que' } }],
            },
          },
        ],
      },
      {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"drain"}' } }] } },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 900 },
          estimated_cost: 0.00005,
        },
      },
    ]);
  };
  const calls = [];
  let turn = 0;
  const result = await runChatLoop({
    env: ENV,
    model: DEEPINFRA,
    systemPrompt: "system",
    objective: "Price a drain.",
    tools: [
      { name: "search_qv", cliName: "mcp__qv__search_qv", definition: { description: "d", inputSchema: {} } },
    ],
    host: {
      call: async (name, input) => {
        calls.push({ name, input });
        return { ok: true, result: "1 rows" };
      },
    },
    timeoutMs: 60_000,
    fetchImpl: async (url, init) => {
      turn += 1;
      if (turn === 1) return fetchImpl(url, init);
      bodies.push(JSON.parse(init.body));
      return sse([
        { choices: [{ index: 0, delta: { content: "Done" } }] },
        { choices: [{ index: 0, delta: { content: "." }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 1100, completion_tokens: 5, estimated_cost: 0.00002 } },
      ]);
    },
  });
  assert.deepEqual(calls, [{ name: "search_qv", input: { query: "drain" } }]);
  assert.equal(result.finalText, "Done.");
  assert.equal(bodies[0].stream, true);
  assert.deepEqual(bodies[0].stream_options, { include_usage: true });
  // The thinking goes back within the turn, as the provider sent it.
  assert.equal(bodies[1].messages[2].reasoning_content, "Thinking.");
  assert.equal(result.usage.cachedTokens, 900);
  assert.equal(result.usage.providerReportedCostUsd, 0.00007);
  assert.equal(typeof result.usage.estimatedCostUsd, "number");
});

test("a stream that ends before the answer does, or fails mid-answer, is retried", async () => {
  let attempt = 0;
  const waits = [];
  const reply = await chatOnceWithRetries({
    env: ENV,
    model: DEEPINFRA,
    systemPrompt: "x",
    prompt: "y",
    timeoutMs: 60_000,
    sleep: async (ms) => waits.push(ms),
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1)
        return sse([{ choices: [{ index: 0, delta: { content: "Hal" } }] }], { done: false });
      if (attempt === 2) return sse([{ error: { message: "replica restarted" } }]);
      return sse([{ choices: [{ index: 0, delta: { content: "Whole." }, finish_reason: "stop" }] }]);
    },
  });
  assert.equal(reply.text, "Whole.");
  assert.equal(attempt, 3);
  assert.equal(waits.length, 2);
});

test("a plain JSON reply is still read, for a provider that does not stream", async () => {
  const reply = await chatOnceWithRetries({
    env: ENV,
    model: DEEPINFRA,
    systemPrompt: "x",
    prompt: "y",
    timeoutMs: 60_000,
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Plain." }, finish_reason: "stop" }] }), {
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(reply.text, "Plain.");
});

test("reasoning levels: DeepInfra's high by default, max or off on request; other providers unchanged", async () => {
  const deepinfra = API_LOOP_PROVIDERS.deepinfra;
  assert.deepEqual(reasoningSettings(deepinfra, null), {});
  assert.deepEqual(reasoningSettings(deepinfra, "max"), { reasoning_effort: "max" });
  assert.deepEqual(reasoningSettings(deepinfra, "off"), { reasoning_effort: "none" });
  assert.deepEqual(reasoningSettings(API_LOOP_PROVIDERS.baseten, "off"), {});

  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return sse([{ choices: [{ index: 0, delta: { content: "{}" }, finish_reason: "stop" }] }]);
  };
  const ask = (reasoning) =>
    chatOnceWithRetries({
      env: ENV,
      model: DEEPINFRA,
      systemPrompt: "x",
      prompt: "y",
      timeoutMs: 60_000,
      fetchImpl,
      reasoning,
    });
  await ask(null);
  await ask("off");
  await ask("max");
  assert.deepEqual(
    bodies.map((body) => body.reasoning_effort),
    ["high", "none", "max"],
  );
});

test("the scoper asks DeepInfra for no thinking and records that it did", async () => {
  const { ResearchScoper } = await import("@eversor/research-engine/research-scope.mjs");
  const bodies = [];
  const scope = {
    item: "Roof",
    measure: "per m²",
    includes: [],
    excludes: [],
    assumptions: [],
    clarifications: [],
  };
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(scope) }, finish_reason: "stop" }] }),
      { headers: { "content-type": "application/json" } },
    );
  };
  const scoper = new ResearchScoper({ env: ENV, model: DEEPINFRA, fetchImpl });
  const drafted = await scoper.scope({ objective: "Roof?" }).catch((error) => error);
  assert.equal(bodies[0].reasoning_effort, "none");
  if (!(drafted instanceof Error)) assert.equal(drafted.scopedBy.reasoning, "off");
});

test("the warmer holds a later run until the first run's call starts answering", async () => {
  const warmer = new PrefixWarmer({ maxWaitMs: 5_000 });
  const release = await warmer.enter("opening");
  let entered = false;
  const second = warmer.enter("opening").then(() => {
    entered = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(entered, false);
  release();
  await second;
  assert.equal(entered, true);
  // A different opening never waits, and once warm an opening lets later runs straight through.
  await warmer.enter("another");
  await warmer.enter("opening");
});

test("the warmer never holds a run longer than its limit, nor past cancellation", async () => {
  const warmer = new PrefixWarmer({ maxWaitMs: 30 });
  await warmer.enter("slow");
  const started = Date.now();
  await warmer.enter("slow");
  assert.ok(Date.now() - started < 1_000);

  const patient = new PrefixWarmer({ maxWaitMs: 60_000 });
  await patient.enter("held");
  const controller = new AbortController();
  const waiting = patient.enter("held", { signal: controller.signal });
  controller.abort();
  await waiting;
});

test("the runs of a question share an opening; a different question does not", () => {
  const base = { endpoint: "e", model: "m", tools: [{ a: 1 }] };
  const one = openingKey({
    ...base,
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "q" },
    ],
  });
  const same = openingKey({
    ...base,
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "q" },
    ],
  });
  const other = openingKey({
    ...base,
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "r" },
    ],
  });
  assert.equal(one, same);
  assert.notEqual(one, other);
});

test("two runs of one question: the second's first call is sent only after the first's has begun", async () => {
  const order = [];
  let releaseFirst;
  const firstAnswering = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;
  const fetchImpl = async () => {
    const index = ++calls;
    order.push(`sent ${index}`);
    if (index === 1) await firstAnswering;
    return sse([{ choices: [{ index: 0, delta: { content: "Done." }, finish_reason: "stop" }] }]);
  };
  const warmer = new PrefixWarmer({ maxWaitMs: 5_000 });
  const run = () =>
    runChatLoop({
      env: ENV,
      model: DEEPINFRA,
      systemPrompt: "system",
      objective: "Same question.",
      tools: [],
      host: { call: async () => ({ ok: true, result: "" }) },
      timeoutMs: 60_000,
      fetchImpl,
      warmer,
    });
  const first = run();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ["sent 1"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["sent 1", "sent 2"]);
});
