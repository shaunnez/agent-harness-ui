// The API-loop runtime: a thin tool-calling loop over an OpenAI-compatible chat API that runs the
// model's tool calls through the run's host session, so QV comes from PlanCheck's library (a local
// stand-in here), web search is the host's (a stub provider), and the answer's citations are
// checked like any other runtime's. A scripted chat endpoint stands in for the model; nothing here
// reaches a provider, and no key appears in the transcript.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runChatLoop } from "../server/research/api-loop/chat-loop.mjs";
import { priceApiUsage, resolveApiModel } from "../server/research/api-loop/providers.mjs";
import { ApiLoopResearchRuntime, apiLoopSystemPrompt } from "../server/research/api-loop/runtime.mjs";
import { ParallelSearchProvider } from "../server/research/parallel-search-provider.mjs";
import { assertResearchRuntime } from "../server/research/research-runtime-registry.mjs";

const SHA = "a".repeat(64);
const ROW_ID = `${SHA}:t3:r2`;
const ROW = {
  id: "uuid-row",
  trade: "Drainage",
  section: "Channel drains",
  group_label: "Proprietary channel",
  description: "Channel and grate, 150mm",
  unit: "m",
  regional_values: { Auckland: { low: 330, high: 330 } },
  provenance: { url: "https://costbuilder.qv.co.nz/drainage/", snapshot_sha256: SHA, source_rows: [ROW_ID] },
  review_status: "unreviewed",
};
const ANSWER = {
  id: "loop-test",
  resolved_from: "qv",
  confidence: "medium",
  components: [
    { role: "Channel and grate", basis: "qv", row_id: ROW_ID, unit: "m", amount: { low: 330, high: 330 } },
    { role: "Sundries", basis: "allowance", row_id: null, unit: "m", amount: { low: 20, high: 40 } },
  ],
  band: { unit: "m", low: 350, high: 370, centre: "Auckland", basis: "QV row plus a small allowance." },
  not_established: [],
  qv_queries_tried: ["channel drain"],
};
const KEY = "sk-test-opencode-key-1234567890";

const reply = (message, usage = { prompt_tokens: 1000, completion_tokens: 100 }) => ({
  choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
  usage,
});
const toolCall = (id, name, args) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

/** A scripted chat endpoint: each call returns the next reply and records the request body. */
function scriptedChat(replies) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = replies.shift();
    if (!next) return new Response("{}", { status: 500 });
    if (next.status) return new Response(next.body ?? "{}", { status: next.status });
    return Response.json(next);
  };
  return { fetchImpl, requests };
}

async function withPlanCheck(body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-api-loop-"));
  const tokenFile = path.join(directory, "token");
  await writeFile(tokenFile, "test-token\n");
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("content-type", "application/json");
    if (url.pathname.endsWith("/facets")) return response.end(JSON.stringify({ sections: [] }));
    response.end(JSON.stringify({ rows: [ROW], next_cursor: null }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await body({ directory, tokenFile, api: `http://127.0.0.1:${server.address().port}` });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test("models route to their provider, DeepSeek's own API is not one, and usage is priced from the rate card", () => {
  assert.deepEqual(
    { ...resolveApiModel("opencode-go/deepseek-v4.1-flash"), provider: undefined },
    { providerId: "opencode-go", provider: undefined, remoteModel: "deepseek-v4.1-flash" },
  );
  assert.equal(
    resolveApiModel("baseten/deepseek-ai/DeepSeek-V4.1-Flash").remoteModel,
    "deepseek-ai/DeepSeek-V4.1-Flash",
  );
  assert.throws(() => resolveApiModel("deepseek/deepseek-flash"), /names no API-loop provider/);
  // Fireworks' US-only endpoint, keyed separately, with its model path kept whole.
  const fireworks = resolveApiModel("fireworks-us/accounts/fireworks/routers/deepseek-v4p1-flash-us");
  assert.equal(fireworks.provider.endpoint, "https://us.api.fireworks.ai/inference/v1");
  assert.equal(fireworks.provider.keyEnv, "FIREWORKS_API_KEY");
  assert.equal(fireworks.remoteModel, "accounts/fireworks/routers/deepseek-v4p1-flash-us");
  assert.deepEqual(fireworks.provider.sessionHeaders, ["x-session-affinity", "x-multi-turn-session-id"]);
  assert.equal(
    priceApiUsage("fireworks-us/accounts/fireworks/routers/deepseek-v4p1-flash-us", {
      inputTokens: 2e6,
      cachedTokens: 1e6,
      outputTokens: 1e6,
    }),
    2.259,
  );
  // 1M uncached in at $0.15, 1M cached at $0.003, 1M out at $0.60.
  assert.equal(
    priceApiUsage("opencode-go/deepseek-v4.1-flash", {
      inputTokens: 2e6,
      cachedTokens: 1e6,
      outputTokens: 1e6,
    }),
    0.753,
  );
  const prompt = apiLoopSystemPrompt(
    "Use mcp__qv__search_qv, then WebSearch, then mcp__research__fetch_source.",
  );
  assert.match(prompt, /Use search_qv, then web_search, then fetch_source\./);
  assert.match(prompt, /ONE continuous passage/);
  assert.match(prompt, /about 50 tool calls/);
  assert.match(prompt, /For a PDF, "page" is required/);
  assert.doesNotMatch(prompt, /several tools in one step/);
});

test("the loop runs a step's tool calls through the host and returns the answer, usage and counts", async () => {
  const { fetchImpl, requests } = scriptedChat([
    reply({
      content: "Searching.",
      reasoning_content: "Think first.",
      tool_calls: [
        toolCall("c1", "search_qv", { query: "channel drain" }),
        toolCall("c2", "web_search", { query: "channel drain NZ" }),
      ],
    }),
    reply(
      { content: `Done.\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\`` },
      { prompt_tokens: 3000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 1000 } },
    ),
  ]);
  const calls = [];
  const host = {
    call: async (tool, input) => {
      calls.push({ tool, input });
      return { ok: true, result: `${tool} ok` };
    },
  };
  const events = [];
  const call = await runChatLoop({
    env: { OPENCODE_API_KEY: KEY },
    model: "opencode-go/deepseek-v4.1-flash",
    systemPrompt: "Recipe.",
    objective: "Price a channel drain.",
    tools: [
      {
        name: "search_qv",
        cliName: "mcp__qv__search_qv",
        definition: { description: "QV", inputSchema: { type: "object" } },
      },
      {
        name: "web_search",
        cliName: "mcp__research__web_search",
        definition: { description: "Web", inputSchema: { type: "object" } },
      },
    ],
    host,
    timeoutMs: 60_000,
    fetchImpl,
    onEvent: (type, data) => events.push({ type, data }),
  });
  assert.equal(requests[0].url, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(requests[0].headers.Authorization, `Bearer ${KEY}`);
  // OpenCode Go routes by session: one id for every call of a run.
  assert.match(requests[0].headers["x-opencode-session"], /^research-/);
  assert.equal(requests[1].headers["x-opencode-session"], requests[0].headers["x-opencode-session"]);
  assert.equal(requests[0].body.model, "deepseek-v4.1-flash");
  assert.deepEqual(
    requests[0].body.tools.map((tool) => tool.function.name),
    ["search_qv", "web_search"],
  );
  // The second request carries the assistant turn back, reasoning included, and both results.
  const turn = requests[1].body.messages;
  assert.equal(turn[2].reasoning_content, "Think first.");
  assert.deepEqual(
    turn.slice(3).map((message) => [message.role, message.tool_call_id]),
    [
      ["tool", "c1"],
      ["tool", "c2"],
    ],
  );
  assert.deepEqual(
    calls.map((entry) => entry.tool),
    ["search_qv", "web_search"],
  );
  assert.match(call.finalText, /"loop-test"/);
  assert.equal(call.sawTurnCompleted, true);
  assert.equal(call.toolCallCount, 2);
  assert.equal(call.searchCallCount, 1);
  assert.deepEqual(
    [call.usage.inputTokens, call.usage.cachedTokens, call.usage.outputTokens, call.usage.modelCalls],
    [4000, 1000, 300, 2],
  );
  assert.ok(events.some((event) => event.type === "tool.called" && event.data.tool === "mcp__qv__search_qv"));
  assert.ok(events.some((event) => event.type === "finding.created"));
});

test("at the soft tool budget the model is asked once more with no tools; errors and a missing key fail cleanly", async () => {
  const many = Array.from({ length: 3 }, (_, index) =>
    toolCall(`c${index}`, "search_qv", { query: `q${index}` }),
  );
  const { fetchImpl, requests } = scriptedChat([
    reply({ content: "", tool_calls: many }),
    reply({ content: "No band." }),
  ]);
  const call = await runChatLoop({
    env: { OPENCODE_API_KEY: KEY },
    model: "opencode-go/deepseek-v4.1-flash",
    systemPrompt: "Recipe.",
    objective: "Price it.",
    tools: [
      {
        name: "search_qv",
        cliName: "mcp__qv__search_qv",
        definition: { description: "QV", inputSchema: {} },
      },
    ],
    host: { call: async () => ({ ok: true, result: "rows" }) },
    timeoutMs: 60_000,
    softToolCalls: 3,
    fetchImpl,
  });
  assert.equal(requests[1].body.tools, undefined);
  assert.match(requests[1].body.messages.at(-1).content, /used your tool budget/);
  assert.equal(call.finalText, "No band.");

  const refused = scriptedChat([{ status: 401, body: '{"error":"bad key"}' }]);
  const denied = await runChatLoop({
    env: { OPENCODE_API_KEY: KEY },
    model: "opencode-go/deepseek-v4.1-flash",
    systemPrompt: "x",
    objective: "x",
    tools: [],
    host: { call: async () => ({ ok: true }) },
    timeoutMs: 60_000,
    fetchImpl: refused.fetchImpl,
  });
  assert.match(denied.failure, /refused the key \(HTTP 401\)/);

  const flaky = scriptedChat([{ status: 503 }, reply({ content: "ok" })]);
  const retried = await runChatLoop({
    env: { OPENCODE_API_KEY: KEY },
    model: "opencode-go/deepseek-v4.1-flash",
    systemPrompt: "x",
    objective: "x",
    tools: [],
    host: { call: async () => ({ ok: true }) },
    timeoutMs: 60_000,
    fetchImpl: flaky.fetchImpl,
    sleep: async () => {},
  });
  assert.equal(retried.finalText, "ok");
  assert.equal(flaky.requests.length, 2);

  const keyless = await runChatLoop({
    env: {},
    model: "baseten/deepseek-ai/DeepSeek-V4.1-Flash",
    systemPrompt: "x",
    objective: "x",
    tools: [],
    host: { call: async () => ({ ok: true }) },
    timeoutMs: 60_000,
    fetchImpl: async () => assert.fail("no request without a key"),
  });
  assert.match(keyless.failure, /needs BASETEN_API_KEY/);
});

test("a full run: PlanCheck rows through the host socket, host web search, a checked answer and no key in the transcript", async () => {
  await withPlanCheck(async ({ directory, tokenFile, api }) => {
    const { fetchImpl } = scriptedChat([
      reply({
        content: "",
        tool_calls: [
          toolCall("c1", "search_qv", { query: "channel drain" }),
          toolCall("c2", "web_search", { query: "channel drain" }),
        ],
      }),
      reply({ content: `\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\`` }),
    ]);
    const searches = [];
    const runtime = new ApiLoopResearchRuntime({
      env: {
        OPENCODE_API_KEY: KEY,
        RESEARCH_QV_SOURCE: "plancheck",
        RESEARCH_PLANCHECK_API: api,
        RESEARCH_PLANCHECK_TOKEN_FILE: tokenFile,
      },
      fetchImpl,
      webToolsOptions: {
        searchProvider: {
          search: async (query) => {
            searches.push(query);
            return { results: [], metadata: { provider: "stub" } };
          },
        },
      },
      transcriptDirectory: path.join(directory, "transcripts"),
      sourceSnapshotDirectory: path.join(directory, "sources"),
    });
    assertResearchRuntime(runtime);
    const handle = await runtime.start({
      id: "RSCH-LOOP-1",
      objective: "Price a channel drain.",
      profile: "standard",
      context: [],
      budget: { maxRuntimeMs: 60_000, maxModelCalls: 10, maxToolCalls: 20, maxSearchCalls: 5 },
    });
    assert.equal(handle.runtimeId, "api-loop");
    for await (const _event of runtime.events("RSCH-LOOP-1"));
    const status = await runtime.status("RSCH-LOOP-1");
    assert.equal(status.status, "completed", JSON.stringify(status.error));
    assert.deepEqual(searches, ["channel drain"]);
    const outcome = runtime.outcome("RSCH-LOOP-1");
    assert.deepEqual(outcome.costBand.band, ANSWER.band);
    assert.deepEqual(outcome.citations.checks, ["qv-found", "allowance"]);
    assert.equal(status.usage.estimatedCostUsd > 0, true);
    const transcript = await readFile(
      path.join(directory, "transcripts", "api-loop", "RSCH-LOOP-1", "stream.jsonl"),
      "utf8",
    );
    assert.match(transcript, /"type":"response"/);
    assert.equal(transcript.includes(KEY), false);
  });
});

test("Parallel search is called with the key on the host and its excerpts become snippets", async () => {
  let seen = null;
  const provider = new ParallelSearchProvider({
    apiKey: "par-key",
    fetchImpl: async (url, init) => {
      seen = { url, headers: init.headers, body: JSON.parse(init.body) };
      return Response.json({
        search_id: "s1",
        results: [{ url: "https://x.test/a", title: "A", excerpts: ["one", "two"] }],
      });
    },
  });
  const found = await provider.search("channel drain price");
  assert.equal(seen.url, "https://api.parallel.ai/v1/search");
  assert.equal(seen.headers["x-api-key"], "par-key");
  assert.deepEqual(seen.body.search_queries, ["channel drain price"]);
  assert.equal(seen.body.mode, "advanced");
  assert.equal(
    seen.body.objective,
    "Find current New Zealand prices (NZD, GST exclusive) for: channel drain price",
  );
  assert.deepEqual(found.results, [{ title: "A", url: "https://x.test/a", snippet: "one … two" }]);
  assert.throws(() => new ParallelSearchProvider({}), /PARALLEL_API_KEY/);
});

test("a PDF quote without a page is checked on the page the host finds it on, and only there", async () => {
  const { checkCostBandCitations } = await import("../server/research/engine/citations.mjs");
  const seen = [];
  const webTools = {
    locatePdfPage: (_sourceId, excerpt) => (excerpt === "Butt Joint $40" ? 7 : null),
    verifyEvidence: (reference) => {
      seen.push(reference.locator ?? null);
      if (reference.locator?.page !== 7)
        throw Object.assign(new Error("PDF page required"), { code: "pdf_page_required" });
      return { sourceId: reference.sourceId, sourceType: "web", quoteVerified: true, authority: "secondary" };
    },
  };
  const component = (excerpt) => ({
    role: "Joint",
    basis: "web",
    sourceId: "source-1",
    source: "https://x.test/c.pdf",
    excerpt,
    low: 40,
    high: 40,
  });
  const checked = await checkCostBandCitations(
    { components: [component("Butt Joint $40"), component("A made-up line")] },
    { rows: [], webTools },
  );
  assert.deepEqual(
    checked.components.map((item) => item.check),
    ["web-verified", "web-unverified"],
  );
  assert.deepEqual(seen, [{ page: 7 }, null]);
});

test("the host checks a final answer once and hands its problems back before accepting it", async () => {
  const answer = (band) =>
    `\`\`\`json\n${JSON.stringify({ ...ANSWER, band: { ...ANSWER.band, ...band } })}\n\`\`\``;
  const { fetchImpl, requests } = scriptedChat([
    reply({ content: answer({ low: 30, high: 200 }) }),
    reply({ content: answer({ low: 60, high: 90 }) }),
  ]);
  const reviewed = [];
  const call = await runChatLoop({
    env: { OPENCODE_API_KEY: KEY },
    model: "opencode-go/deepseek-v4.1-flash",
    systemPrompt: "Recipe.",
    objective: "Price a soffit.",
    tools: [],
    host: { call: async () => ({ ok: true, result: "" }) },
    timeoutMs: 60_000,
    fetchImpl,
    reviewAnswer: (text) => {
      reviewed.push(text);
      return ["Too wide."];
    },
  });
  // Reviewed once; the second answer is final whatever it says.
  assert.equal(reviewed.length, 1);
  assert.equal(requests.length, 2);
  const feedback = requests[1].body.messages.at(-1);
  assert.equal(feedback.role, "user");
  assert.match(feedback.content, /1\. Too wide\./);
  assert.match(call.finalText, /"low":60/);
});

test("an API-loop run without its keys fails before it starts, naming the keys", async () => {
  const { ApiLoopResearchRuntime } = await import("../server/research/api-loop/runtime.mjs");
  const request = {
    id: "RSCH-KEYS",
    objective: "Concrete paving slab, per m2.",
    researchPolicy: { runtime: "api-loop", model: "baseten/deepseek-ai/DeepSeek-V4.1-Flash" },
  };
  await assert.rejects(
    new ApiLoopResearchRuntime({ env: {} }).start(request),
    /BASETEN_API_KEY and PARALLEL_API_KEY/,
  );
  await assert.rejects(
    new ApiLoopResearchRuntime({ env: { BASETEN_API_KEY: "test" } }).start(request),
    /needs PARALLEL_API_KEY in the companion's environment/,
  );
});

test("a provider's per-minute rate limit is waited out, not scored as a spent plan", async () => {
  let calls = 0;
  const waits = [];
  const fetchImpl = async () => {
    calls += 1;
    if (calls <= 2)
      return new Response(
        '{"error":{"code":"invalid_request_error","message":"rate limit exceeded, please try again later"}}',
        { status: 429, headers: calls === 2 ? { "retry-after": "2" } : {} },
      );
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "Done." }, finish_reason: "stop" }], usage: {} }),
      { status: 200 },
    );
  };
  const { chatOnceWithRetries } = await import("../server/research/api-loop/chat-loop.mjs");
  const reply = await chatOnceWithRetries({
    env: { FIREWORKS_API_KEY: "test" },
    model: "fireworks-us/accounts/fireworks/routers/deepseek-v4p1-flash-us",
    systemPrompt: "x",
    prompt: "y",
    timeoutMs: 600_000,
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal(reply.text, "Done.");
  // The throttle schedule (5 s first), then the provider's own Retry-After (2 s).
  assert.deepEqual(waits, [5_000, 2_000]);
});
