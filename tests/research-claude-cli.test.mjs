// The `claude-cli` research runtime, offline.
//
// Every test here replays a recorded CLI stream through an injected process runner. That is
// deliberate: the flags, the environment denylist, the subscription gate, the stream mapping
// and the three-run agreement are all things that must hold on a machine with no Claude CLI
// and no plan usage to spend. The live exit test — the 30 pinned scopes, three runs each —
// is `scripts/research-claude-cli-benchmark.mjs` and costs about $150, so it is not a test.
//
// The agreement maths is checked against the 90 recorded runs themselves, which is the
// strongest offline check available: if `agreement.mjs` reproduces 28 bands and 18 tight
// agreements from `17a-top30-results.json`, then a live benchmark that misses those numbers is
// telling us about the runs, not about the arithmetic.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compareWithBaseline,
  evaluateExitTest,
  RECORDED_BASELINE,
  runBenchmark,
} from "../scripts/research-claude-cli/benchmark.mjs";
import {
  loadPinnedScopes,
  loadRecordedBaseline,
  recordedKeyForScope,
} from "../scripts/research-claude-cli/scopes.mjs";
import {
  agreementCounts,
  agreementForRuns,
  TIGHT_HIGH_RATIO,
  TIGHT_LOW_RATIO,
} from "../server/research/claude-cli/agreement.mjs";
import {
  assertSubscriptionAuth,
  isSubscriptionAuth,
  REQUIRED_AUTH_METHOD,
  readSubscriptionAuth,
} from "../server/research/claude-cli/auth.mjs";
import { PLAN_LIMIT_ERROR_CODE } from "../server/research/claude-cli/cli-call.mjs";
import {
  findingsFromCostBand,
  parseCostBand,
  QV_ALLOWED_TOOLS,
  qvMcpConfig,
  resolveCorpusIndexPath,
} from "../server/research/claude-cli/qv-recipe.mjs";
import {
  CLAUDE_CLI_RESEARCH_RUNTIME_ID,
  ClaudeCliResearchRuntime,
  DEFAULT_CLAUDE_CLI_MODEL,
  EMPTY_OUTPUT_ERROR_CODE,
} from "../server/research/claude-cli/runtime.mjs";
import {
  parseFinalJsonFence,
  sourceTypeForTool,
  translateStreamLine,
  usageFromResultLine,
} from "../server/research/claude-cli/stream.mjs";
import { assertResearchRuntime } from "../server/research/research-runtime-registry.mjs";

const COST_BAND_ANSWER = {
  id: "channel-drain-installation-pinned",
  resolved_from: "qv",
  confidence: "medium",
  components: [
    {
      role: "Proprietary channel and grate",
      row_id: "abc:t1:r4",
      source: null,
      unit: "m",
      amount: { low: 300, high: 360 },
      centre: "Auckland",
      caveat: "Row is unreviewed.",
    },
    {
      role: "Stormwater connection",
      row_id: null,
      source: "https://supplier.example.test/connection",
      unit: "m",
      amount: { low: 280, high: 340 },
      centre: "Auckland",
      caveat: null,
    },
  ],
  band: { unit: "m", low: 580, high: 700, centre: "Auckland", basis: "QV rows plus one vendor page." },
  not_established: ["Traffic management is not priced."],
  qv_queries_tried: ["channel drain", "trench drain grate"],
};

/** A complete, recorded-shaped CLI stream for one successful run. */
function streamLines({ answer = COST_BAND_ANSWER, includeResult = true, isError = false } = {}) {
  const lines = [
    { type: "system", subtype: "init", session_id: "s-1", model: "claude-opus-5", tools: ["WebSearch"] },
    {
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "…", signature: "sig" }] },
    },
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "toolu_1", name: "mcp__qv__search_qv", input: { query: "channel drain" } },
        ],
      },
    },
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "toolu_2", name: "WebSearch", input: { query: "nz channel drain" } },
        ],
      },
    },
    // Out of order on purpose: correlation is by `tool_use_id`, never by arrival order.
    {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "a vendor page" }] },
    },
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "2 rows: …", is_error: false }],
      },
    },
    { type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour" } },
    { type: "assistant", message: { content: [{ type: "text", text: "Checking the catalogue first." }] } },
    {
      type: "assistant",
      message: {
        content: [{ type: "text", text: `Here is the band.\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` }],
      },
    },
  ];
  if (includeResult)
    lines.push({
      type: "result",
      subtype: isError ? "error_during_execution" : "success",
      is_error: isError,
      num_turns: 6,
      duration_ms: 42_000,
      total_cost_usd: 1.66,
      usage: { input_tokens: 63, output_tokens: 304, cache_read_input_tokens: 10_308 },
      modelUsage: { "claude-opus-5": { inputTokens: 63, outputTokens: 304, costUSD: 1.66 } },
    });
  return lines;
}

/** A process runner that replays lines and records exactly how it was invoked. */
function replayRunner(lines, { code = 0, signal = null, calls = [] } = {}) {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    for (const line of lines) options.onStdoutLine?.(JSON.stringify(line));
    return { code, signal, stdout: "", stderr: "" };
  };
}

const AUTHORISED = async () => ({
  binary: "/usr/local/bin/claude",
  probe: { loggedIn: true, authMethod: REQUIRED_AUTH_METHOD },
});

async function withRuntime(body, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-claude-cli-test-"));
  const runtime = new ClaudeCliResearchRuntime({
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      RESEARCH_QV_INDEX: path.join(directory, "capture.jsonl"),
    },
    transcriptDirectory: path.join(directory, "transcripts"),
    assertAuth: AUTHORISED,
    ...overrides,
  });
  try {
    return await body({ runtime, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function request(id, overrides = {}) {
  return {
    id,
    objective: "Price the pinned channel drain scope.",
    profile: "standard",
    context: [],
    budget: {
      maxRuntimeMs: 60_000,
      maxResearchers: 1,
      maxModelCalls: 50,
      maxToolCalls: 50,
      maxSearchCalls: 20,
      maxDepth: 1,
      maxConcurrentResearchers: 1,
    },
    ...overrides,
  };
}

async function drain(runtime, runId) {
  const events = [];
  for await (const event of runtime.events(runId)) events.push(event);
  return events;
}

// --- the contract -----------------------------------------------------------------------------

test("the runtime satisfies the neutral ResearchRuntime shape", () => {
  assertResearchRuntime(new ClaudeCliResearchRuntime());
  assert.equal(new ClaudeCliResearchRuntime().id, CLAUDE_CLI_RESEARCH_RUNTIME_ID);
});

// --- the subscription gate --------------------------------------------------------------------

test("a CLI that is not on the subscription refuses to start, naming the fix", async () => {
  for (const probe of [
    { loggedIn: false, authMethod: "claude.ai" },
    { loggedIn: true, authMethod: "apiKey" },
    { loggedIn: true, authMethod: null },
  ]) {
    assert.equal(isSubscriptionAuth(probe), false);
  }
  assert.equal(isSubscriptionAuth({ loggedIn: true, authMethod: REQUIRED_AUTH_METHOD }), true);
  // An unparseable probe is "not on a subscription", which refuses the run. Wrong in the safe
  // direction: a false negative costs a run, a false positive costs metered billing.
  assert.deepEqual(readSubscriptionAuth("not json"), {
    loggedIn: false,
    authMethod: null,
    subscriptionType: null,
    orgName: null,
  });

  await assert.rejects(
    assertSubscriptionAuth({
      binary: "/usr/local/bin/claude",
      run: async () => ({ stdout: JSON.stringify({ loggedIn: true, authMethod: "apiKey" }) }),
    }),
    (error) => {
      assert.equal(error.code, "claude_cli_not_on_subscription");
      assert.match(error.message, /claude login/);
      return true;
    },
  );
});

test("the child cannot inherit an API key, a token or a base URL", async () => {
  const calls = [];
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-CLI-ENV"));
      await drain(runtime, "RSCH-CLI-ENV");
      const { env } = calls[0].options;
      for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"])
        assert.equal(name in env, false, `${name} reached the child`);
    },
    {
      env: {
        PATH: process.env.PATH,
        HOME: os.tmpdir(),
        RESEARCH_QV_INDEX: "/tmp/capture.jsonl",
        ANTHROPIC_API_KEY: "sk-would-move-this-onto-metered-billing",
        ANTHROPIC_AUTH_TOKEN: "token",
        ANTHROPIC_BASE_URL: "https://elsewhere.example.test",
      },
      run: replayRunner(streamLines(), { calls }),
    },
  );
});

test("a run with no configured corpus fails rather than searching nothing", async () => {
  assert.throws(() => resolveCorpusIndexPath({}, null), /RESEARCH_QV_INDEX/);
  await withRuntime(
    async ({ runtime }) => {
      await assert.rejects(runtime.start(request("RSCH-CLI-NO-CORPUS")), /RESEARCH_QV_INDEX/);
    },
    { env: { PATH: process.env.PATH }, run: replayRunner(streamLines()) },
  );
});

// --- the six flags ----------------------------------------------------------------------------

test("the spawn is the six-flag configuration the 90 recorded runs used", async () => {
  const calls = [];
  await withRuntime(
    async ({ runtime }) => {
      const input = request("RSCH-CLI-FLAGS", { budget: { ...request("x").budget, maxUsd: 7.5 } });
      await runtime.start(input);
      await drain(runtime, input.id);
      const { args } = calls[0];
      assert.equal(args[0], "-p");
      assert.equal(args[1], input.objective);
      assert.equal(args[at(args, "--model") + 1], DEFAULT_CLAUDE_CLI_MODEL);
      assert.match(args[at(args, "--append-system-prompt") + 1], /ORDER OF RESORT/);
      assert.equal(args[at(args, "--allowed-tools") + 1], QV_ALLOWED_TOOLS.join(","));
      // `stream-json --verbose`, not `json`: `json` returns one blob at the end and `events()`
      // would have nothing to read.
      assert.equal(args[at(args, "--output-format") + 1], "stream-json");
      assert.ok(args.includes("--verbose"));
      assert.equal(args[at(args, "--max-budget-usd") + 1], "7.5");
      const config = JSON.parse(await readFile(args[at(args, "--mcp-config") + 1], "utf8"));
      assert.deepEqual(Object.keys(config.mcpServers), ["qv"]);
      assert.match(config.mcpServers.qv.args[0], /qv-corpus-server\.py$/);
    },
    { run: replayRunner(streamLines(), { calls }) },
  );
});

test("no budget ceiling in dollars means no --max-budget-usd", async () => {
  const calls = [];
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-CLI-NO-USD"));
      await drain(runtime, "RSCH-CLI-NO-USD");
      assert.equal(calls[0].args.includes("--max-budget-usd"), false);
    },
    { run: replayRunner(streamLines(), { calls }) },
  );
});

test("the MCP config carries the capture path rather than baking one in", () => {
  const config = qvMcpConfig({ pythonBin: "/usr/bin/python3", indexPath: "/captures/items.jsonl" });
  assert.equal(config.mcpServers.qv.command, "/usr/bin/python3");
  assert.equal(config.mcpServers.qv.args.at(-1), "/captures/items.jsonl");
});

// --- the stream mapping -----------------------------------------------------------------------

test("every stream line maps to the event type the captured run showed", () => {
  const toolCalls = new Map();
  const seen = [];
  for (const line of streamLines())
    for (const event of translateStreamLine(line, { toolCalls })) seen.push(event.type);
  assert.deepEqual(seen, [
    "run.started",
    "tool.called",
    "tool.called",
    "source.retrieved",
    "source.retrieved",
    "log",
    "finding.created",
    "run.completed",
  ]);
});

test("a tool result is attributed by tool_use_id, not by arrival order", () => {
  const toolCalls = new Map();
  for (const line of streamLines()) translateStreamLine(line, { toolCalls });
  const results = streamLines()
    .filter((line) => line.type === "user")
    .flatMap((line) => translateStreamLine(line, { toolCalls }));
  // `toolu_2` (WebSearch) arrives first even though it was called second.
  assert.equal(results[0].data.source.id, "toolu_2");
  assert.equal(results[0].data.source.title, "WebSearch");
  assert.equal(results[0].data.source.sourceType, "web");
  assert.equal(results[1].data.source.id, "toolu_1");
  assert.equal(results[1].data.source.sourceType, "internal_record");
});

test("a licensed local corpus row is never classed as a public web citation", () => {
  assert.equal(sourceTypeForTool("mcp__qv__get_qv_table"), "internal_record");
  assert.equal(sourceTypeForTool("mcp__qv__list_qv_sections"), "internal_record");
  assert.equal(sourceTypeForTool("WebSearch"), "web");
  assert.equal(sourceTypeForTool("WebFetch"), "web");
});

test("routine rate-limit telemetry is not reported as a ceiling; a block is", () => {
  const allowed = { type: "rate_limit_event", rate_limit_info: { status: "allowed" } };
  const blocked = {
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
  };
  assert.deepEqual(translateStreamLine(allowed), []);
  assert.deepEqual(
    translateStreamLine(blocked).map((event) => event.type),
    ["budget.ceiling_hit"],
  );
});

test("unknown line types and thinking blocks are tolerated and dropped", () => {
  assert.deepEqual(translateStreamLine({ type: "system", subtype: "post_turn_summary" }), []);
  assert.deepEqual(translateStreamLine({ type: "something_new", payload: 1 }), []);
  assert.deepEqual(
    translateStreamLine({ type: "assistant", message: { content: [{ type: "thinking", thinking: "x" }] } }),
    [],
  );
});

test("usage comes from modelUsage and num_turns, never from usage.iterations", () => {
  const line = streamLines().at(-1);
  line.usage.iterations = [{ input_tokens: 999_999 }];
  const usage = usageFromResultLine(line, { toolCalls: 2, searchCalls: 1 });
  assert.equal(usage.inputTokens, 63);
  assert.equal(usage.modelCalls, 6);
  assert.equal(usage.estimatedCostUsd, 1.66);
  assert.equal(usage.byModel["claude-opus-5"].priced, true);
});

// --- reading the answer -----------------------------------------------------------------------

test("the last valid json fence wins, so a quoted schema is not read as an answer", () => {
  const text =
    'Schema:\n```json\n{"band": null}\n```\nAnswer:\n```json\n{"band": {"low": 1, "high": 2}}\n```';
  assert.deepEqual(parseFinalJsonFence(text), { band: { low: 1, high: 2 } });
  // A truncated final fence must not hide a complete earlier one.
  assert.deepEqual(parseFinalJsonFence('```json\n{"a":1}\n```\n```json\n{"b":\n```'), { a: 1 });
  assert.equal(parseFinalJsonFence("no fence here"), null);
});

test("a band needs both ends, and no band is an ordinary outcome", () => {
  const halfOpen = parseCostBand(
    `\`\`\`json\n${JSON.stringify({ ...COST_BAND_ANSWER, band: { unit: "m", low: 580, high: null } })}\n\`\`\``,
  );
  assert.equal(halfOpen.band, null);
  const none = parseCostBand(
    `\`\`\`json\n${JSON.stringify({ resolved_from: "not_established", band: { low: null, high: null }, not_established: ["No published rate."] })}\n\`\`\``,
  );
  assert.equal(none.band, null);
  assert.deepEqual(none.notEstablished, ["No published rate."]);
  assert.equal(parseCostBand("the model never produced a fence"), null);
});

test("findings carry their evidence and say plainly that nobody has reviewed them", () => {
  const costBand = parseCostBand(`\`\`\`json\n${JSON.stringify(COST_BAND_ANSWER)}\n\`\`\``);
  const findings = findingsFromCostBand(costBand, { runId: "RSCH-1" });
  assert.equal(findings.length, 3);
  assert.equal(findings[0].evidence[0].sourceId, "abc:t1:r4");
  assert.equal(findings[0].evidence[0].sourceType, "internal_record");
  assert.equal(findings[0].evidence[0].quoteVerified, false);
  assert.equal(findings[1].evidence[0].url, "https://supplier.example.test/connection");
  assert.equal(findings.at(-1).producedBy, "synthesiser");
  assert.match(findings.at(-1).claim, /580–700 per m/);
  for (const finding of findings) {
    assert.equal(finding.verification.status, "unverified");
    assert.match(finding.verification.notes, /no quantity surveyor has checked this/);
  }
});

// --- the run lifecycle ------------------------------------------------------------------------

test("a successful run completes with findings, usage and a transcript artifact", async () => {
  await withRuntime(
    async ({ runtime }) => {
      const handle = await runtime.start(request("RSCH-CLI-OK"));
      assert.deepEqual(handle.model, {
        provider: CLAUDE_CLI_RESEARCH_RUNTIME_ID,
        model: DEFAULT_CLAUDE_CLI_MODEL,
        live: true,
      });
      const events = await drain(runtime, "RSCH-CLI-OK");
      assert.deepEqual(
        events.map((event) => event.type),
        [
          "run.started",
          "tool.called",
          "tool.called",
          "source.retrieved",
          "source.retrieved",
          "log",
          "finding.created",
          "run.completed",
        ],
      );
      assert.deepEqual(
        events.map((event) => event.ordinal),
        [1, 2, 3, 4, 5, 6, 7, 8],
      );

      const status = await runtime.status("RSCH-CLI-OK");
      assert.equal(status.status, "completed");
      assert.equal(status.usage.partial, false);
      assert.equal(status.budgetState.toolCallsUsed, 2);
      assert.equal(status.budgetState.searchCallsUsed, 1);

      const result = await runtime.result("RSCH-CLI-OK");
      assert.equal(result.findings.length, 3);
      assert.deepEqual(result.unresolvedQuestions, ["Traffic management is not priced."]);
      const transcript = result.artifacts.find((artifact) => artifact.kind === "claude-cli-transcript");
      assert.ok(transcript, "the raw stream is retained");
      const retained = (await readFile(transcript.contentRef, "utf8")).trim().split("\n");
      assert.equal(retained.length, streamLines().length);
      assert.equal(runtime.costBand("RSCH-CLI-OK").band.low, 580);
    },
    { run: replayRunner(streamLines()) },
  );
});

test("a clean exit with no result line is a retryable empty output, not a bad scope", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-CLI-EMPTY"));
      await drain(runtime, "RSCH-CLI-EMPTY");
      const status = await runtime.status("RSCH-CLI-EMPTY");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, EMPTY_OUTPUT_ERROR_CODE);
      assert.equal(status.error.retryable, true);
    },
    { run: replayRunner([], { code: 0 }) },
  );
});

test("a result line followed by a non-zero exit is a failure, not a completion", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-CLI-EXIT"));
      await drain(runtime, "RSCH-CLI-EXIT");
      const status = await runtime.status("RSCH-CLI-EXIT");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, "claude_cli_exited_abnormally");
    },
    { run: replayRunner(streamLines(), { code: 1 }) },
  );
});

test("a CLI that reports its own error fails the run", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-CLI-REPORTED"));
      await drain(runtime, "RSCH-CLI-REPORTED");
      assert.equal((await runtime.status("RSCH-CLI-REPORTED")).error.code, "claude_cli_reported_error");
    },
    { run: replayRunner(streamLines({ isError: true }), { code: 0 }) },
  );
});

test("spawns are capped, because eight at once produced six empty outputs out of seventy-two", async () => {
  let active = 0;
  let peak = 0;
  const gated = async (_command, _args, options) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const line of streamLines()) options.onStdoutLine?.(JSON.stringify(line));
    active -= 1;
    return { code: 0, signal: null, stdout: "", stderr: "" };
  };
  await withRuntime(
    async ({ runtime }) => {
      const ids = Array.from({ length: 8 }, (_unused, index) => `RSCH-CLI-CAP-${index}`);
      await Promise.all(ids.map((id) => runtime.start(request(id))));
      await Promise.all(ids.map((id) => drain(runtime, id)));
      assert.ok(peak <= 3, `peak concurrency was ${peak}`);
      for (const id of ids) assert.equal((await runtime.status(id)).status, "completed");
    },
    { run: gated, maxConcurrentRuns: 3 },
  );
});

test("a queued run can be cancelled before its child ever spawns", async () => {
  const started = [];
  const slow = async (_command, _args, options) => {
    started.push(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (const line of streamLines()) options.onStdoutLine?.(JSON.stringify(line));
    return { code: 0, signal: null, stdout: "", stderr: "" };
  };
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-CLI-RUNNING"));
      await runtime.start(request("RSCH-CLI-QUEUED"));
      await runtime.cancel("RSCH-CLI-QUEUED");
      await drain(runtime, "RSCH-CLI-QUEUED");
      assert.equal((await runtime.status("RSCH-CLI-QUEUED")).status, "cancelled");
      await drain(runtime, "RSCH-CLI-RUNNING");
    },
    { run: slow, maxConcurrentRuns: 1 },
  );
});

// --- agreement --------------------------------------------------------------------------------

test("agreement is the recorded arithmetic, at the recorded thresholds", () => {
  const tight = agreementForRuns([
    { run: "r1", band: { low: 100, high: 200, unit: "m", centre: "Auckland" } },
    { run: "r2", band: { low: 110, high: 230, unit: "m" } },
    { run: "r3", band: { low: 120, high: 260, unit: "m" } },
  ]);
  assert.equal(tight.status, "agreed");
  assert.equal(tight.agreement.lowRatio, 1.2);
  assert.equal(tight.agreement.highRatio, 1.3);
  // Consensus is the median of the lows and of the highs taken independently, which can name a
  // pair no single run proposed. That is `18f-build-review.py`'s behaviour and is correct for a
  // band: the two ends are separate estimates, not a unit.
  assert.deepEqual(tight.consensus, { low: 110, high: 230 });
  assert.deepEqual(tight.range, { min: 100, max: 260 });

  const loose = agreementForRuns([
    { run: "r1", band: { low: 100, high: 200 } },
    { run: "r2", band: { low: 100 * TIGHT_LOW_RATIO + 1, high: 200 } },
  ]);
  assert.equal(loose.status, "disputed");

  // A run with no band is counted in the total and excluded from the ratios: "two of three
  // found a band and they agree" is not "three runs agree".
  const partial = agreementForRuns([
    { run: "r1", band: { low: 100, high: 200 } },
    { run: "r2", band: null },
    { run: "r3", band: { low: 105, high: 210 } },
  ]);
  assert.equal(partial.status, "agreed");
  assert.deepEqual(partial.agreement.runsWithBand, 2);
  assert.deepEqual(partial.agreement.runsTotal, 3);

  assert.equal(agreementForRuns([{ run: "r1", band: null }]).status, "not_established");
  assert.ok(TIGHT_HIGH_RATIO > TIGHT_LOW_RATIO);
});

test("the agreement maths reproduces the 90 recorded runs exactly", async () => {
  const baseline = await loadRecordedBaseline();
  const records = [...baseline.entries()].map(([scenario, runs]) => ({
    scenario,
    ...agreementForRuns(runs),
  }));
  // The numbers the port has to reproduce live: 28 of 30 with a band, 18 of those tight.
  assert.deepEqual(agreementCounts(records), {
    scenarios: 30,
    agreed: RECORDED_BASELINE.agreed,
    disputed: 10,
    notEstablished: 2,
    // The recorded rows carry no run status, so none of them can be mistaken for a crash.
    incomplete: 0,
    withBand: RECORDED_BASELINE.withBand,
  });
  assert.deepEqual(
    records
      .filter((record) => record.status === "not_established")
      .map((record) => record.scenario)
      .sort(),
    [...RECORDED_BASELINE.noBandExpected].sort(),
  );
});

// --- the plan window --------------------------------------------------------------------------
//
// The first live 30-scope exit test hit the claude.ai five-hour limit at scenario 26. The
// harness scored the five dead scenarios as `not_established` and printed EXIT TEST FAILED —
// including for `switchboard-fault-rating-protection`, which the exit test requires to produce
// no band, so that check passed because the runs never happened. These four tests are that
// failure, written down.

/** The stream the CLI actually produced when the plan window was exhausted, trimmed. */
function planLimitLines() {
  return [
    {
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        rateLimitType: "five_hour",
        resetsAt: 1_790_081_400,
        overageStatus: "rejected",
        overageDisabledReason: "org_level_disabled",
      },
    },
    {
      type: "assistant",
      message: { content: [{ type: "text", text: "You've hit your session limit · resets 12:50am" }] },
    },
    {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      api_error_status: 429,
      num_turns: 1,
      duration_ms: 4_000,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  ];
}

test("an exhausted plan window is its own error code, not a generic CLI error", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-CLI-PLAN"));
      await drain(runtime, "RSCH-CLI-PLAN");
      const status = await runtime.status("RSCH-CLI-PLAN");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, PLAN_LIMIT_ERROR_CODE);
      // Not retryable by any loop running now: the quota is for the window, so every retry in
      // the next few seconds fails identically.
      assert.equal(status.error.retryable, false);
      assert.match(status.error.message, /five_hour/);
      assert.match(status.error.message, /must not be scored/);
    },
    { run: replayRunner(planLimitLines(), { code: 1 }) },
  );
});

test("a scenario whose runs failed is incomplete, never a scenario that found nothing", () => {
  const crashed = agreementForRuns([
    { run: "r1", status: "failed", band: null, error: { code: PLAN_LIMIT_ERROR_CODE } },
    { run: "r2", status: "failed", band: null, error: { code: PLAN_LIMIT_ERROR_CODE } },
    { run: "r3", status: "failed", band: null, error: { code: PLAN_LIMIT_ERROR_CODE } },
  ]);
  assert.equal(crashed.status, "incomplete");
  assert.equal(crashed.failedRuns.length, 3);
  assert.equal(crashed.failedRuns[0].errorCode, PLAN_LIMIT_ERROR_CODE);

  // The opposite claim, and it must stay reachable: three runs completed and none of them could
  // defend a band. That is a finding about the scope.
  const researched = agreementForRuns([
    { run: "r1", status: "completed", band: null },
    { run: "r2", status: "completed", band: null },
    { run: "r3", status: "completed", band: null },
  ]);
  assert.equal(researched.status, "not_established");

  // One dead run poisons the scenario even when the other two banded: three-run agreement over
  // two runs is a different measurement, and the recorded baseline is three.
  const partial = agreementForRuns([
    { run: "r1", status: "completed", band: { low: 100, high: 200 } },
    { run: "r2", status: "completed", band: { low: 105, high: 210 } },
    { run: "r3", status: "failed", band: null, error: { code: "claude_cli_failed" } },
  ]);
  assert.equal(partial.status, "incomplete");

  // An incomplete scenario is not counted as having produced a band.
  assert.deepEqual(agreementCounts([crashed, researched, partial]), {
    scenarios: 3,
    agreed: 0,
    disputed: 0,
    notEstablished: 1,
    incomplete: 2,
    withBand: 0,
  });
});

test("the benchmark stops at the plan window instead of scoring the scenarios after it", async () => {
  const scopes = ["one", "two", "three"].map((id) => ({ id, objective: `scope ${id}`, recordedKey: id }));
  const seen = [];
  const runtime = {
    async start() {},
    async *events() {},
    async status(id) {
      seen.push(id);
      return seen.length <= 3
        ? { status: "completed", usage: { estimatedCostUsd: 1 } }
        : { status: "failed", error: { code: PLAN_LIMIT_ERROR_CODE, message: "window exhausted" } };
    },
    costBand: () => ({ band: { low: 100, high: 200 } }),
  };
  const { records, aborted } = await runBenchmark({ runtime, scopes, budget: {} });
  assert.equal(records.length, 2, "it stops after the scenario that hit the wall, not at the end");
  assert.equal(aborted.reason, PLAN_LIMIT_ERROR_CODE);
  assert.equal(aborted.scenario, "two");
  assert.deepEqual(aborted.remaining, ["three"]);
  assert.equal(records[1].status, "incomplete");
});

test("the exit test refuses a verdict when any scenario did not complete its runs", async () => {
  const records = Array.from({ length: RECORDED_BASELINE.scenarios }, (_unused, index) => ({
    scenarioId: `scenario-${index}`,
    recordedKey: "channel-drain",
    status: index === 29 ? "incomplete" : "agreed",
    failedRuns: index === 29 ? [{ run: "r1", status: "failed", errorCode: PLAN_LIMIT_ERROR_CODE }] : [],
    consensus: { low: 580, high: 700 },
    agreement: { runsWithBand: 3, runsTotal: 3, lowRatio: 1.08, highRatio: 1.29 },
    runs: [],
    costUsd: 4.5,
  }));
  const comparison = await compareWithBaseline(records);
  const verdict = evaluateExitTest(comparison, { scenariosRun: RECORDED_BASELINE.scenarios });
  // All thirty ran, so the old guard would have scored this and failed the port on a quota wall.
  assert.equal(verdict.applicable, false);
  assert.equal(verdict.passed, null);
  assert.deepEqual(verdict.incomplete, ["scenario-29"]);
  assert.match(verdict.reason, /not evidence either way/);
});

// --- the pinned scopes ------------------------------------------------------------------------

test("all thirty pinned scopes load and map onto a recorded baseline row", async () => {
  const scopes = await loadPinnedScopes();
  const baseline = await loadRecordedBaseline();
  assert.equal(scopes.length, RECORDED_BASELINE.scenarios);
  for (const scope of scopes) {
    assert.ok(baseline.has(scope.recordedKey), `${scope.id} has no recorded row (${scope.recordedKey})`);
    assert.match(scope.objective, /SCENARIO/);
  }
  // The baseline's keys are the filenames with the first `p-` removed — a quirk of the shell
  // loop that produced the 90 runs, reproduced rather than renamed.
  assert.equal(recordedKeyForScope("acp-facade-cladding-install"), "acfacade-cladding-install");
  assert.equal(recordedKeyForScope("p-cable"), "cable");
});

test("the exit test declines a verdict on a partial run instead of scoring one", async () => {
  const records = [
    {
      scenarioId: "channel-drain",
      recordedKey: "channel-drain",
      status: "agreed",
      consensus: { low: 580, high: 700 },
      agreement: { runsWithBand: 3, runsTotal: 3, lowRatio: 1.08, highRatio: 1.29 },
      runs: [],
      costUsd: 4.5,
    },
  ];
  const comparison = await compareWithBaseline(records);
  assert.equal(comparison.scenarios[0].recordedStatus, "agreed");
  const partial = evaluateExitTest(comparison, { scenariosRun: 1 });
  assert.equal(partial.applicable, false);
  assert.equal(partial.passed, null);
  assert.match(partial.reason, /all 30 pinned scopes/);
});

function at(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `${flag} is missing from the spawn`);
  return index;
}
