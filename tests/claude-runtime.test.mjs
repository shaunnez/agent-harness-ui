import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildClaudeEnvironment,
  buildClaudeSpawn,
  CLAUDE_ENV_DENYLIST,
  CLAUDE_STDOUT_BUDGET,
  CLAUDE_SYSTEM_PROMPT,
  classifyClaudeSandboxCanary,
  classifyClaudeWriteCanary,
  claudeUsageFromResult,
  createClaudeStreamParser,
  extractClaudeFailure,
  runClaude,
  readClaudeAuthProbe,
} from "../server/claude-runtime.mjs";
import { buildCodexEnvironment } from "../server/codex-runtime.mjs";
import {
  assertSupportedReasoning,
  COST_DIVERGENCE_TOLERANCE,
  costDivergence,
  defaultRuntimeSettings,
  defaultStagePolicies,
  enrichUsage,
  MODEL_PRICING,
  NO_REASONING_EFFORT,
  priceModelUsage,
  priceUsage,
  policyIdForRun,
  providerForModelId,
  providerRuntimeDefaults,
  readExecutionProviderCatalog,
  readClaudeModelCatalog,
  resolveAgentPolicy,
} from "../server/model-catalog.mjs";
import { resolveExecutionProvider } from "../server/execution-providers.mjs";
import { readExecutionProvider } from "../server/run-activity.mjs";
import { JsonTaskStore } from "../server/store.mjs";

const FIXTURE_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "claude-cli");

async function replayFixture(name) {
  const raw = await readFile(path.join(FIXTURE_DIRECTORY, name), "utf8");
  const parser = createClaudeStreamParser();
  const events = [];
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) events.push(...parser.parse(line));
  return { events, lines, parsed: parser.result() };
}

function activities(events) {
  return events.filter((event) => event.type === "activity");
}

test("maps recorded Claude tool calls onto the internal event shape", async () => {
  const { events, parsed } = await replayFixture("stream-json-tool-calls.jsonl");

  assert.deepEqual(events.map((event) => event.type), [
    "activity", // system/init
    "activity", // rate_limit_event
    "activity", // Read started
    "activity", // Read completed
    "activity", // Bash: wc -l started
    "activity", // Bash: cat nonexistent started
    "activity", // Bash: cat nonexistent completed (out of order)
    "activity", // Bash: wc -l completed
    "message",
    "usage",
  ]);

  const [session, rateLimit] = events;
  assert.deepEqual(session, {
    type: "activity",
    tone: "info",
    title: "Agent session started",
    detail: "3286dcf3-1248-4751-907a-8071234b7835",
  });
  assert.equal(rateLimit.title, "Plan allocation available");
  assert.equal(rateLimit.tone, "info");

  // Read: a built-in tool, and its successful result omits is_error entirely.
  const readStarted = events[2];
  assert.equal(readStarted.toolCall.name, "Read");
  assert.equal(readStarted.toolCall.category, "builtin-tool");
  assert.equal(readStarted.toolCall.phase, "started");
  assert.match(readStarted.detail, /Read · .*a\.txt$/);
  const readCompleted = events[3];
  assert.equal(readCompleted.toolCall.id, readStarted.toolCall.id);
  assert.equal(readCompleted.title, "Tool completed");
  assert.equal(readCompleted.tone, "success");
  assert.equal(readCompleted.commandFailed, undefined, "a non-Bash tool must never set commandFailed");

  // Bash reuses Codex's identity so run-activity and the UI need no changes.
  const bashStarted = events.slice(4, 6);
  for (const event of bashStarted) {
    assert.equal(event.title, "Inspecting repository");
    assert.equal(event.toolCall.name, "command_execution");
    assert.equal(event.toolCall.category, "repository-command");
  }
  assert.deepEqual(bashStarted.map((event) => event.detail), ["wc -l a.txt", "cat nonexistent-file.txt"]);

  // Results arrive out of order: the second Bash call completes first. Correlation
  // is by tool_use_id, so a positional parser would mislabel both.
  const [firstCompletion, secondCompletion] = events.slice(6, 8);
  assert.equal(firstCompletion.detail, "cat nonexistent-file.txt");
  assert.equal(firstCompletion.toolCall.id, bashStarted[1].toolCall.id);
  assert.equal(firstCompletion.commandFailed, true);
  assert.equal(firstCompletion.tone, "warning");
  assert.equal(firstCompletion.title, "Repository command returned a warning");
  assert.equal(firstCompletion.runtimeScope, "candidate");
  assert.equal(firstCompletion.toolCall.result, "Exit code 1");

  assert.equal(secondCompletion.detail, "wc -l a.txt");
  assert.equal(secondCompletion.toolCall.id, bashStarted[0].toolCall.id);
  assert.equal(secondCompletion.commandFailed, false);
  assert.equal(secondCompletion.tone, "success");
  assert.equal(secondCompletion.toolCall.result, "Text result · 1 characters (content not retained)");

  assert.deepEqual(events.at(-2), { type: "message", text: "DONE" });
  assert.equal(parsed.finalText, "DONE");
  assert.equal(parsed.pendingToolCalls, 0);
  assert.equal(parsed.unmatchedToolResults, 0);
  assert.deepEqual(parsed.permissionDenials, []);
  assert.equal(extractClaudeFailure(parsed), null);
});

test("sums Anthropic input tokens across cache reads and cache creation", async () => {
  const { events, parsed } = await replayFixture("stream-json-tool-calls.jsonl");
  const usageEvents = events.filter((event) => event.type === "usage");

  // Exactly one usage event: result.usage is cumulative across all 4 turns and
  // equals modelUsage[primary]. Accumulating would double-count.
  assert.equal(usageEvents.length, 1);
  assert.deepEqual(usageEvents[0].usage, {
    inputTokens: 63 + 10_308 + 52_740,
    cachedInputTokens: 10_308,
    cacheWriteTokens: 52_740,
    outputTokens: 304,
    totalTokens: 63 + 10_308 + 52_740 + 304,
  });

  // Passing input_tokens straight through would under-report input ~1000x, because
  // Anthropic's input_tokens is the uncached remainder rather than the total prompt.
  assert.equal(usageEvents[0].usage.inputTokens, 63_111);
  assert.notEqual(usageEvents[0].usage.inputTokens, 63);

  // usage.iterations is diagnostic and reconciles with nothing; never sum it.
  assert.deepEqual(parsed.usage, usageEvents[0].usage);
  assert.equal(parsed.totalCostUsd, 0.32493540000000004);

  // modelUsage can name a model the harness never asked for.
  assert.deepEqual(Object.keys(parsed.modelUsage).sort(), ["claude-haiku-4-5-20251001", "claude-sonnet-5"]);
});

test("classifies a sandbox-denied write as an ordinary command failure", async () => {
  const { events, parsed } = await replayFixture("sandbox-denied-write.jsonl");
  const completions = activities(events).filter((event) => event.toolCall?.phase === "completed");
  assert.equal(completions.length, 1);
  const [denied] = completions;

  assert.equal(denied.commandFailed, true);
  // The seatbelt refusal carries the same "Exit code 1" prefix as any failing
  // command, because the shell exits non-zero when the syscall is refused. The
  // prefix therefore cannot classify why the command failed, and this parser does
  // not try: policy problems are detected via permission_denials and the harness's
  // own pre/post verification.
  assert.equal(denied.toolCall.result, "Exit code 1");
  assert.deepEqual(parsed.permissionDenials, []);
  assert.equal(extractClaudeFailure(parsed), null);
});

test("surfaces every recorded permission denial as a danger activity", async () => {
  const { events, parsed } = await replayFixture("sandbox-escape-denied.jsonl");
  const denials = activities(events).filter((event) => event.tone === "danger");

  assert.equal(denials.length, 2);
  assert.deepEqual(denials.map((event) => event.title), ["Permission denied", "Permission denied"]);
  assert.match(denials[0].detail, /^Bash · printf 'MUTATED' > guarded\.txt/);
  assert.equal(parsed.permissionDenials.length, 2);
  assert.equal(parsed.permissionDenials[0].tool_input.dangerouslyDisableSandbox, true);

  // A denial is a policy violation, not a failed verification command. Setting
  // commandFailed here would launder it into a REPAIR verdict.
  for (const event of denials) assert.equal(event.commandFailed, undefined);

  // The recorded tool_use command and the denial's tool_input disagree: an operator
  // PreToolUse hook rewrote the command after the event the harness would record.
  const started = activities(events).find((event) => event.toolCall?.phase === "started" && event.detail.includes("guarded.txt"));
  assert.ok(started);
  assert.notEqual(started.detail, parsed.permissionDenials[1].tool_input.command);
});

test("keeps the sandbox refusal under --safe-mode", async () => {
  const { events } = await replayFixture("safe-mode-sandbox.jsonl");
  const completions = activities(events).filter((event) => event.toolCall?.phase === "completed");
  assert.equal(completions.length, 1);
  assert.equal(completions[0].commandFailed, true);
  assert.match(completions[0].detail, /guarded\.txt/);
});

test("tolerates unknown event types, unknown system subtypes and malformed lines", () => {
  const parser = createClaudeStreamParser();
  const ignored = [
    "",
    "not json at all",
    "{",
    "[]",
    "null",
    "42",
    JSON.stringify({ type: "system", subtype: "thinking_tokens", tokens: 12 }),
    JSON.stringify({ type: "system", subtype: "post_turn_summary", status_category: "review_ready" }),
    JSON.stringify({ type: "system", subtype: "a_subtype_from_a_future_release" }),
    JSON.stringify({ type: "an_entirely_new_top_level_type", payload: { anything: true } }),
    JSON.stringify({ type: "rate_limit_event" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "" }] } }),
    JSON.stringify({ type: "assistant", message: {} }),
    JSON.stringify({ type: "assistant" }),
    JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hello" }] } }),
  ];
  for (const line of ignored) assert.deepEqual(parser.parse(line), [], line.slice(0, 40));
  assert.equal(parser.result().sawResult, false);
});

test("does not invent a tool call for an uncorrelated result", () => {
  const parser = createClaudeStreamParser();
  const orphan = parser.parse(JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_never_seen", content: "Exit code 1\nboom", is_error: true }] },
  }));

  // A truncated stream must not be reported as a failed verification command:
  // guessing the tool was Bash would fabricate a REPAIR verdict out of nothing.
  assert.deepEqual(orphan, []);
  assert.equal(parser.result().unmatchedToolResults, 1);
});

test("reports an unterminated tool call rather than silently closing it", () => {
  const parser = createClaudeStreamParser();
  parser.parse(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "toolu_open", name: "Bash", input: { command: "sleep 600" } }] },
  }));
  assert.equal(parser.result().pendingToolCalls, 1);
});

test("maps MCP tool names onto the Codex MCP tool-call shape", () => {
  const parser = createClaudeStreamParser();
  const [started] = parser.parse(JSON.stringify({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        id: "toolu_mcp",
        name: "mcp__notion__notion-fetch",
        input: { url: "https://example.invalid/page" },
      }],
    },
  }));
  assert.equal(started.toolCall.category, "mcp");
  assert.equal(started.toolCall.server, "notion");
  assert.equal(started.toolCall.name, "notion-fetch");

  const [completed] = parser.parse(JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_mcp", content: [{ type: "text", text: "ok" }] }] },
  }));
  assert.equal(completed.toolCall.category, "mcp");
  assert.equal(completed.toolCall.server, "notion");
  assert.equal(completed.toolCall.result, "Array result · 1 items (content not retained)");
  assert.equal(completed.commandFailed, undefined);
});

test("treats a successful Bash result and an absent is_error identically", () => {
  const parser = createClaudeStreamParser();
  parser.parse(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "true" } }] },
  }));
  const [explicitFalse] = parser.parse(JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "", is_error: false }] },
  }));

  parser.parse(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "true" } }] },
  }));
  const [absent] = parser.parse(JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "" }] },
  }));

  assert.equal(explicitFalse.commandFailed, false);
  assert.equal(absent.commandFailed, false);

  // Only `is_error === true` is a failure. `is_error === false` as the success test
  // would report every successful Read as failed, since Read omits the field.
  parser.parse(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t3", name: "Bash", input: { command: "false" } }] },
  }));
  const [failed] = parser.parse(JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t3", content: "Exit code 7\nnope", is_error: true }] },
  }));
  assert.equal(failed.commandFailed, true);
  assert.equal(failed.toolCall.result, "Exit code 7");
});

test("extracts a failure from the result line rather than stderr", () => {
  const parser = createClaudeStreamParser();
  parser.parse(JSON.stringify({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "Invalid API key · Please run /login",
    usage: { input_tokens: 0, output_tokens: 0 },
  }));
  assert.equal(extractClaudeFailure(parser.result()), "Invalid API key · Please run /login");

  const truncated = createClaudeStreamParser();
  truncated.parse(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: false, result: "" }));
  assert.equal(extractClaudeFailure(truncated.result()), "Claude ended with error_max_turns.");

  assert.equal(extractClaudeFailure(createClaudeStreamParser().result()), null);
});

test("falls back to the last assistant text when the result carries none", () => {
  const parser = createClaudeStreamParser();
  parser.parse(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "  buffered verdict  " }] },
  }));
  const events = parser.parse(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "" }));
  assert.deepEqual(events, [{ type: "message", text: "buffered verdict" }]);
  assert.equal(parser.result().finalText, "buffered verdict");
});

test("defaults missing usage counters to zero without producing NaN", () => {
  assert.deepEqual(claudeUsageFromResult({}), {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
  assert.deepEqual(claudeUsageFromResult({ input_tokens: "nope", output_tokens: 5 }), {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
    totalTokens: 5,
  });
});

test("excludes every API-key path from the Claude environment", () => {
  const environment = buildClaudeEnvironment({
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/Users/agent",
    USER: "agent",
    LANG: "en_GB.UTF-8",
    CLAUDE_CONFIG_DIR: "/Users/agent/.claude",
    // The three that would move execution off the local CLI session onto metered
    // API billing, or point it at a different endpoint entirely.
    ANTHROPIC_API_KEY: "sk-ant-secret",
    ANTHROPIC_AUTH_TOKEN: "oauth-bearer-secret",
    ANTHROPIC_BASE_URL: "https://proxy.invalid/v1",
    // Plus the usual unrelated credentials an allowlist must not admit.
    GH_TOKEN: "secret-github-token",
    AWS_SECRET_ACCESS_KEY: "secret-aws-key",
    OPENAI_API_KEY: "secret-openai-key",
    DATABASE_URL: "postgres://secret",
    ARBITRARY_SECRET: "secret-value",
  }, "/tmp/agent-harness-claude");

  assert.equal(environment.PATH, "/usr/local/bin:/usr/bin");
  assert.equal(environment.HOME, "/Users/agent");
  assert.equal(environment.USER, "agent");
  assert.equal(environment.TMPDIR, "/tmp/agent-harness-claude");
  assert.equal(environment.CLAUDE_CONFIG_DIR, "/Users/agent/.claude");

  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) {
    assert.equal(environment[name], undefined, `${name} must never reach a Claude spawn`);
  }
  assert.deepEqual(CLAUDE_ENV_DENYLIST, ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]);
  for (const name of ["GH_TOKEN", "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "DATABASE_URL", "ARBITRARY_SECRET"]) {
    assert.equal(environment[name], undefined, name);
  }

  // Case-insensitive matching must not become a bypass.
  const lowercase = buildClaudeEnvironment({ anthropic_api_key: "sk-ant-secret", PATH: "/usr/bin" }, "/tmp/x");
  assert.deepEqual(
    Object.keys(lowercase).filter((key) => key.toLowerCase().includes("anthropic")),
    [],
  );
});

test("guarantees the variables the Claude CLI cannot run without", () => {
  const bare = buildClaudeEnvironment({}, "/tmp/agent-harness-claude");
  assert.ok(bare.PATH, "a spawn with no PATH cannot resolve the CLI's own helpers");
  assert.ok(bare.HOME || bare.USERPROFILE);
  assert.ok(bare.USER || bare.USERNAME);
  assert.equal(bare.TMPDIR, "/tmp/agent-harness-claude");
  assert.equal(bare.TEMP, "/tmp/agent-harness-claude");
});

test("keeps the Codex environment allowlist untouched", () => {
  // The two allowlists are deliberately separate: Codex needs CODEX_HOME and must
  // not gain HOME, and neither should inherit the other's exclusions by accident.
  const codex = buildCodexEnvironment({
    PATH: "/usr/bin",
    CODEX_HOME: "/Users/agent/.codex",
    HOME: "/Users/agent",
    ANTHROPIC_API_KEY: "sk-ant-secret",
  }, "/tmp/codex");
  assert.equal(codex.CODEX_HOME, "/Users/agent/.codex");
  assert.equal(codex.HOME, undefined);
  assert.equal(codex.ANTHROPIC_API_KEY, undefined);
});

test("reads the auth probe as a hint without treating it as authority", () => {
  assert.deepEqual(
    readClaudeAuthProbe({ code: 0, stdout: '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"team"}' }),
    { authenticated: true, authMethod: "claude.ai · team" },
  );
  // Environment-supplied credentials report loggedIn:false for a usable CLI, which
  // is why the canary rather than this probe gates execution.
  assert.deepEqual(
    readClaudeAuthProbe({ code: 0, stdout: '{"loggedIn":false,"authMethod":"none"}' }),
    { authenticated: false, authMethod: "none" },
  );
  assert.deepEqual(
    readClaudeAuthProbe({ code: 0, stdout: "Logged in as agent@example.com", stderr: "" }),
    { authenticated: true, authMethod: null },
  );
  assert.deepEqual(
    readClaudeAuthProbe({ code: 1, stdout: "not json", stderr: "" }),
    { authenticated: false, authMethod: null },
  );
});

test("publishes a bundled Claude catalogue attributed to its provider", async () => {
  const catalog = await readClaudeModelCatalog();
  assert.equal(catalog.source, "Bundled Claude model catalog");
  assert.equal(catalog.fetchedAt, null);
  assert.deepEqual(catalog.models.map((model) => model.id), [
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-haiku-4-5",
  ]);
  for (const model of catalog.models) {
    assert.equal(model.provider, "claude", model.id);
    assert.equal(model.provenance, "bundled", model.id);
    assert.ok(model.pricing, `${model.id} must be priced`);
    // 1M-context models at standard rates: the >272k long-context branch must
    // never fire, so there is no long band to fire it.
    assert.equal(model.pricing.long, null, model.id);
  }

  // Haiku takes no --effort, so it carries the explicit "none" level: selectable as
  // a stage policy like any other model, and resolving to no --effort at spawn.
  const haiku = catalog.models.find((model) => model.id === "claude-haiku-4-5");
  assert.deepEqual(haiku.reasoningLevels, [NO_REASONING_EFFORT]);
  assert.equal(haiku.defaultReasoning, NO_REASONING_EFFORT);
  assert.equal(assertSupportedReasoning("claude-haiku-4-5", NO_REASONING_EFFORT), null);
  assert.throws(() => assertSupportedReasoning("claude-haiku-4-5", "high"), /does not support high/);
  // "none" is Haiku-only: no other model may silently drop its effort level.
  assert.throws(() => assertSupportedReasoning("claude-opus-5", NO_REASONING_EFFORT), /does not support none/);

  assert.equal(assertSupportedReasoning("claude-opus-5", "xhigh"), "xhigh");
  // Codex has `ultra`; Claude does not. An unsupported level refuses rather than
  // silently downgrading.
  assert.throws(() => assertSupportedReasoning("claude-opus-5", "ultra"), /does not support ultra/);
  assert.throws(() => assertSupportedReasoning("gpt-5.6-sol", "high"), /Unknown model/);
});

test("attributes model ids to providers and leaves unknown ids unattributed", () => {
  assert.equal(providerForModelId("claude-opus-5"), "claude");
  assert.equal(providerForModelId("claude-sonnet-5-20260101"), "claude");
  assert.equal(providerForModelId("gpt-5.6-luna"), "codex");
  assert.equal(providerForModelId("mistral-large"), null);
  assert.equal(providerForModelId(""), "codex", "the empty id normalizes to the Codex default");
  assert.deepEqual(providerRuntimeDefaults("claude"), { model: "claude-sonnet-5", reasoning: "xhigh" });
  assert.deepEqual(providerRuntimeDefaults("codex"), { model: "gpt-5.6-luna", reasoning: "xhigh" });
  assert.deepEqual(providerRuntimeDefaults(), { model: "gpt-5.6-luna", reasoning: "xhigh" });
  assert.throws(() => providerRuntimeDefaults("gemini"), /No runtime defaults/);
});

test("splits Claude stage policies without disturbing the Codex defaults", () => {
  const claude = defaultStagePolicies("claude");
  const deep = ["plan", "repair", "dev-review", "final-review"];
  for (const policyId of deep) {
    assert.deepEqual(claude[policyId], { model: "claude-opus-5", reasoning: "xhigh" }, policyId);
  }
  for (const policyId of ["triage", "scouts", "grill", "specification", "implement", "test"]) {
    assert.deepEqual(claude[policyId], { model: "claude-sonnet-5", reasoning: "high" }, policyId);
  }
  assert.deepEqual(defaultStagePolicies(), defaultStagePolicies("codex"));
  assert.equal(defaultStagePolicies().plan.model, "gpt-5.6-sol");
});

test("reproduces the CLI's own Sonnet 5 accounting from the bundled rate card", async () => {
  const { parsed } = await replayFixture("stream-json-tool-calls.jsonl");
  const sonnet = parsed.modelUsage["claude-sonnet-5"];

  // The rate card is validated against the CLI's own costUSD for the same run.
  // Cache write at 2x input (the 1-hour TTL multiplier) and Sonnet 5 at the
  // standard $3/$15 are what make these agree; the 5-minute 1.25x multiplier or
  // the introductory $2/$10 rate would not.
  const estimated = priceUsage("claude-sonnet-5", {
    inputTokens: sonnet.inputTokens + sonnet.cacheReadInputTokens + sonnet.cacheCreationInputTokens,
    cachedInputTokens: sonnet.cacheReadInputTokens,
    cacheWriteTokens: sonnet.cacheCreationInputTokens,
    outputTokens: sonnet.outputTokens,
  });
  assert.equal(estimated, 0.324281);
  assert.ok(Math.abs(estimated - sonnet.costUSD) < 1e-6, `${estimated} vs ${sonnet.costUSD}`);
  assert.equal(costDivergence(sonnet.costUSD, estimated).material, false);

  assert.deepEqual(MODEL_PRICING["claude-sonnet-5"].short, { input: 3, cachedInput: 0.3, cacheWrite: 6, output: 15 });
});

test("prefers the provider's reported cost over the bundled estimate", () => {
  const usage = { inputTokens: 63_111, cachedInputTokens: 10_308, cacheWriteTokens: 52_740, outputTokens: 304, totalTokens: 63_415 };
  const enriched = enrichUsage("claude-sonnet-5", usage, undefined, "2026-08-05", {
    reportedCost: 0.3249354,
    modelUsage: {
      "claude-haiku-4-5-20251001": { inputTokens: 579, outputTokens: 15, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, canonicalModel: "claude-haiku-4-5" },
      "claude-sonnet-5": { inputTokens: 63, outputTokens: 304, cacheReadInputTokens: 10_308, cacheCreationInputTokens: 52_740, canonicalModel: "claude-sonnet-5" },
    },
  });

  assert.equal(enriched.cost, 0.3249354, "the CLI's accounting is authoritative after a run");
  assert.equal(enriched.reportedCost, 0.3249354);
  // The cross-check prices every model the run actually used, so it includes the
  // Haiku work the harness never asked for.
  assert.equal(enriched.estimatedCost, 0.324935, "the rate card is retained as a cross-check");
  assert.equal(enriched.costBasis, "api-equivalent", "still not money leaving an account");
  // modelUsage can name a model the harness never asked for; recording the
  // breakdown is what makes that visible instead of mis-attributed.
  assert.deepEqual(Object.keys(enriched.modelUsage).sort(), ["claude-haiku-4-5-20251001", "claude-sonnet-5"]);
  assert.equal(enriched.credits, null, "Claude has no credit analogue");

  // Re-enriching a persisted record must not replace the reported cost with the
  // estimate: the store re-enriches every artifact on boot.
  const reenriched = enrichUsage("claude-sonnet-5", enriched, undefined, "2026-08-05");
  assert.equal(reenriched.cost, 0.3249354);
  assert.equal(reenriched.reportedCost, 0.3249354);
  assert.deepEqual(Object.keys(reenriched.modelUsage).sort(), ["claude-haiku-4-5-20251001", "claude-sonnet-5"]);
  assert.deepEqual(enrichUsage("claude-sonnet-5", reenriched, undefined, "2026-08-05"), reenriched);
});

test("leaves a Codex usage record byte-identical when nothing was reported", () => {
  const usage = { inputTokens: 1_000, cachedInputTokens: 800, cacheWriteTokens: 0, outputTokens: 500, totalTokens: 1_500 };
  const enriched = enrichUsage("gpt-5.6-sol", usage, undefined, "2026-08-02");
  assert.deepEqual(Object.keys(enriched), [
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteTokens",
    "outputTokens",
    "totalTokens",
    "cost",
    "credits",
    "pricingVersion",
  ]);
  assert.equal(enriched.reportedCost, undefined);
  assert.equal(enriched.costBasis, undefined);
  assert.equal(enriched.modelUsage, undefined);
});

test("flags material divergence between a reported cost and the rate card", () => {
  assert.equal(costDivergence(1, 1).material, false);
  assert.equal(costDivergence(1, 1.04).material, false);
  assert.equal(costDivergence(1, 1.5).material, true);
  assert.equal(costDivergence(1, 0).material, true);
  assert.equal(costDivergence(0, 0).material, false);
  assert.equal(costDivergence(1, null), null);
  assert.equal(costDivergence(null, 1), null);
  assert.ok(COST_DIVERGENCE_TOLERANCE > 0 && COST_DIVERGENCE_TOLERANCE < 1);
});

test("prices a zero-cost reported run as zero rather than falling back", () => {
  // A reported 0 is a real figure, not a missing one: `??` on a falsy cost would
  // silently substitute the rate-card estimate.
  const enriched = enrichUsage("claude-sonnet-5", { inputTokens: 100, outputTokens: 10 }, undefined, "2026-08-05", {
    reportedCost: 0,
  });
  assert.equal(enriched.cost, 0);
  assert.equal(enriched.reportedCost, 0);
  assert.ok(enriched.estimatedCost > 0);
});

test("survives a store boot without replacing a reported cost with an estimate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-claude-usage-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Retain reported cost",
      description: "The store re-enriches every artifact on boot; that must be idempotent.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const usage = enrichUsage(
      "claude-sonnet-5",
      { inputTokens: 63_111, cachedInputTokens: 10_308, cacheWriteTokens: 52_740, outputTokens: 304, totalTokens: 63_415 },
      undefined,
      "2026-08-05",
      {
        reportedCost: 0.3249354,
        modelUsage: {
          "claude-sonnet-5": { inputTokens: 63, outputTokens: 304, cacheReadInputTokens: 10_308, cacheCreationInputTokens: 52_740, canonicalModel: "claude-sonnet-5" },
        },
      },
    );
    await store.update(task.id, (draft) => {
      draft.artifacts.push({
        id: "claude-artifact",
        stage: "triage",
        name: "triage.md",
        kind: "markdown",
        content: "Recorded Claude usage",
        createdAt: new Date().toISOString(),
        model: "claude-sonnet-5",
        reasoning: "high",
        usage,
      });
    });

    const rebooted = new JsonTaskStore(path.join(directory, "tasks.json"));
    await rebooted.init();
    const [artifact] = (await rebooted.get(task.id)).artifacts;
    assert.equal(artifact.usage.reportedCost, 0.3249354);
    assert.equal(artifact.usage.cost, 0.3249354, "boot must not downgrade the CLI figure to the estimate");
    assert.equal(artifact.usage.estimatedCost, 0.324281);
    assert.equal(artifact.usage.costBasis, "api-equivalent");
    assert.deepEqual(Object.keys(artifact.usage.modelUsage), ["claude-sonnet-5"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps stage content on stdin and off the argv", () => {
  const prompt = "## Stage instructions\n\nReview the candidate and return <gate-evidence>.";
  const { args, stdin } = buildClaudeSpawn({
    cwd: "/tmp/worktree",
    prompt,
    model: "claude-opus-5",
    effort: "xhigh",
    sessionId: "11111111-2222-3333-4444-555555555555",
  });

  assert.equal(stdin, prompt, "the prompt reaches the CLI byte-for-byte");
  // Not merely an ARG_MAX preference: --tools is variadic, so a positional prompt is
  // consumed as another tool name and the CLI then fails outright.
  for (const arg of args) {
    assert.equal(arg.includes("Stage instructions"), false, `stage content leaked into argv: ${arg}`);
  }
  assert.equal(args.includes(prompt), false);

  assert.deepEqual(args.slice(0, 6), ["-p", "--output-format", "stream-json", "--verbose", "--model", "claude-opus-5"]);
  assert.ok(args.includes("--safe-mode"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(args.includes("--bare"), false, "--bare forces API-key auth and never reads the OAuth session");
  assert.equal(args.includes("--add-dir"), false, "the agent gets the stage cwd only");
  assert.equal(args.includes("--cd"), false, "there is no --cd; Claude inherits the spawn cwd");

  // Tools as one comma-separated value, the form the CLI's own help documents.
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Grep,Glob,Bash");
  for (const forbidden of ["Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task"]) {
    assert.equal(args[args.indexOf("--tools") + 1].includes(forbidden), false, forbidden);
  }
});

test("uses one fixed system prompt for every stage", () => {
  const stages = [
    "Triage this task.",
    "Produce the specification.",
    "Development review: return <gate-evidence>.",
    "Final review: return <gate-evidence>.",
  ];
  const systemPrompts = stages.map((prompt) => {
    const { args } = buildClaudeSpawn({
      cwd: "/tmp/x",
      prompt,
      model: "claude-sonnet-5",
      effort: "high",
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    return args[args.indexOf("--system-prompt") + 1];
  });

  // Stage instructions must never be split between --system-prompt and stdin: both
  // providers have to receive byte-identical stage content for their evidence to be
  // comparable, and Codex has no system-prompt channel at all.
  assert.equal(new Set(systemPrompts).size, 1);
  assert.equal(systemPrompts[0], CLAUDE_SYSTEM_PROMPT);
  for (const [index, stage] of stages.entries()) {
    for (const fragment of stage.split(" ")) {
      if (fragment.length < 5) continue;
      assert.equal(systemPrompts[index].includes(fragment), false, `${fragment} leaked into the system prompt`);
    }
  }
});

test("omits --effort for a model that takes none", () => {
  const withEffort = buildClaudeSpawn({
    cwd: "/tmp/x", prompt: "x", model: "claude-sonnet-5", effort: "high", sessionId: "s",
  }).args;
  assert.equal(withEffort[withEffort.indexOf("--effort") + 1], "high");

  const withoutEffort = buildClaudeSpawn({
    cwd: "/tmp/x", prompt: "x", model: "claude-haiku-4-5", effort: assertSupportedReasoning("claude-haiku-4-5", NO_REASONING_EFFORT), sessionId: "s",
  }).args;
  assert.equal(withoutEffort.includes("--effort"), false);
});

test("supplies a mandatory sandbox block through inline settings", () => {
  const { args } = buildClaudeSpawn({
    cwd: "/tmp/worktree", prompt: "x", model: "claude-sonnet-5", effort: "high", sessionId: "s",
  });
  const settings = JSON.parse(args[args.indexOf("--settings") + 1]);

  assert.equal(settings.sandbox.enabled, true);
  // Its documented default is false, and the documented false behaviour is that a
  // warning is shown and commands run unsandboxed. Omitting it means silent
  // unconfined execution on any host without the sandbox runtime.
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(settings.sandbox.filesystem.denyWrite, ["/tmp/worktree"]);
  assert.deepEqual(settings.sandbox.filesystem.allowWrite, []);
  // Codex read-only has no network; Claude needs it stated.
  assert.equal(settings.sandbox.network.strictAllowlist, true);
  assert.deepEqual(settings.sandbox.network.allowedDomains, []);

  // Inline JSON, so the operator's ~/.claude/settings.json is never touched.
  assert.equal(args[args.indexOf("--settings") + 1].startsWith("{"), true);
  assert.throws(() => buildClaudeSpawn({
    cwd: "/tmp/x", prompt: "x", sandbox: "danger-full-access", model: "claude-sonnet-5", sessionId: "s",
  }), /Unsupported Claude sandbox: danger-full-access/);

  // Read-only never gets a permission rule or acceptEdits, so the editing tools stay
  // unusable even if the tool allowlist were widened by mistake.
  assert.equal(JSON.parse(args[args.indexOf("--settings") + 1]).permissions, undefined);
  assert.equal(args.includes("--permission-mode"), false);
  assert.throws(
    () => buildClaudeSpawn({ cwd: "/tmp/x", prompt: "x", networkAccess: true, model: "claude-sonnet-5", sessionId: "s" }),
    /cannot be granted network access/,
  );
});

test("grants workspace-write through two gates and no ancestor denyWrite", () => {
  // Harness worktrees are nested inside the repository they operate on.
  const cwd = "/repo/.data/worktrees/AH-1/C1";
  const { args } = buildClaudeSpawn({
    cwd, prompt: "x", sandbox: "workspace-write", model: "claude-sonnet-5", effort: "high", sessionId: "s",
  });
  const settings = JSON.parse(args[args.indexOf("--settings") + 1]);

  assert.deepEqual(settings.sandbox.filesystem.allowWrite, [cwd]);
  // A repo-root denyWrite would be an ancestor of this allow and would defeat it
  // entirely, blocking legitimate writes. The sandbox is default-deny, so the allow
  // entry is necessary and sufficient.
  assert.equal(settings.sandbox.filesystem.denyWrite, undefined);
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);

  // Bash is confined by the OS sandbox; Write and Edit are gated by the permission
  // layer, and need BOTH the allow rule and acceptEdits. With the rule alone the tool
  // is still refused, because in -p there is nobody to approve it.
  assert.deepEqual(settings.permissions.allow, [`Write(${cwd}/**)`, `Edit(${cwd}/**)`]);
  assert.equal(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Grep,Glob,Bash,Write,Edit");
  for (const forbidden of ["NotebookEdit", "WebFetch", "WebSearch", "Task"]) {
    assert.equal(args[args.indexOf("--tools") + 1].includes(forbidden), false, forbidden);
  }

  // Network is always denied. Granting loopback binding costs the Bash auto-approval,
  // so a stage that needs network stays on Codex rather than running degraded, and the
  // provider advertises that rather than failing at spawn time.
  assert.deepEqual(settings.sandbox.network, { strictAllowlist: true, allowedDomains: [] });
  assert.equal(resolveExecutionProvider("claude").capabilities().grantsNetworkAccess, false);
  assert.equal(resolveExecutionProvider("codex").capabilities().grantsNetworkAccess, true);
  assert.throws(
    () => buildClaudeSpawn({ cwd, prompt: "x", sandbox: "workspace-write", networkAccess: true, model: "claude-sonnet-5", sessionId: "s" }),
    /cannot be granted network access/,
  );
});

test("fails the write canary closed unless writes work inside and nowhere else", () => {
  const good = { insideWritten: true, editToolWorked: true, escaped: [] };
  assert.equal(classifyClaudeWriteCanary(good).passed, true);

  // Any escape is the unambiguous failure.
  assert.equal(classifyClaudeWriteCanary({ ...good, escaped: ["sourceRoot"] }).passed, false);
  assert.deepEqual(classifyClaudeWriteCanary({ ...good, escaped: ["sibling"] }).escaped, ["sibling"]);

  // Inverted from read-only: a run that wrote nothing proves the stage is broken, not
  // that it is safe, so it must not pass.
  const nothingWritten = classifyClaudeWriteCanary({ ...good, insideWritten: false });
  assert.equal(nothingWritten.passed, false);
  assert.equal(nothingWritten.inconclusive, true);

  // Both write mechanisms are checked because they are gated by different layers.
  assert.equal(classifyClaudeWriteCanary({ ...good, editToolWorked: false }).passed, false);

  // A host that cannot start a shell is reported as such, not as a confinement
  // result, so nobody goes hunting the sandbox config for a fault that is not there.
  const shell = classifyClaudeWriteCanary({ ...good, insideWritten: false, shellFailed: true });
  assert.equal(shell.passed, false);
  assert.equal(shell.shellFailed, true);
  assert.match(shell.detail, /could not start a shell/);

  // An escape outranks a broken stage: report the confinement failure, not the noise.
  assert.match(
    classifyClaudeWriteCanary({ insideWritten: false, editToolWorked: false, escaped: ["sourceRoot"] }).detail,
    /escaped the worktree/,
  );
});

test("reports read-only confinement as layered and offers no workspace-write", () => {
  const claude = resolveExecutionProvider("claude");
  const capabilities = claude.capabilities();

  // The honest answer: there is no single Claude flag equivalent to
  // `codex exec --sandbox read-only`, so the harness's own verification is the
  // enforcement of record and this is what makes the orchestrator require it.
  assert.equal(capabilities.sandboxes["read-only"], "layered");
  assert.equal(capabilities.sandboxes["workspace-write"], "layered");
  assert.equal(capabilities.confinementVerifiedBy, "harness");
  // A posture the provider does not list is unavailable, not weakly available.
  assert.equal(capabilities.sandboxes["danger-full-access"], undefined);
  assert.equal(resolveExecutionProvider("codex").capabilities().sandboxes["workspace-write"], "os-enforced");
  assert.equal(capabilities.stdoutBudgetBytes, CLAUDE_STDOUT_BUDGET);
  assert.ok(capabilities.stdoutBudgetBytes > resolveExecutionProvider("codex").capabilities().stdoutBudgetBytes);
  assert.deepEqual(claude.defaults(), { model: "claude-sonnet-5", reasoning: "xhigh" });
});


test("fails the sandbox canary closed for anything short of a demonstrated refusal", () => {
  const refused = classifyClaudeSandboxCanary({ mutated: false, attempted: true, refused: true, refusedCommands: 2, escalationAttempts: 1 });
  assert.equal(refused.passed, true);
  assert.equal(refused.escalationBlocked, true);

  // A write that went through is the one unambiguous failure.
  assert.equal(classifyClaudeSandboxCanary({ mutated: true, attempted: true, refused: false }).passed, false);
  assert.equal(classifyClaudeSandboxCanary({ mutated: true, attempted: true, refused: true }).mutated, true);

  // Inconclusive is not a pass. An agent that declined to try teaches nothing, and
  // "configuration is not evidence" has to hold in that case too.
  const untried = classifyClaudeSandboxCanary({ mutated: false, attempted: false, refused: false });
  assert.equal(untried.passed, false);
  assert.equal(untried.inconclusive, true);

  const ambiguous = classifyClaudeSandboxCanary({ mutated: false, attempted: true, refused: false, permissionDenials: 0 });
  assert.equal(ambiguous.passed, false);
  assert.equal(ambiguous.inconclusive, true);

  // A permission-gate denial with the file intact is a genuine demonstration.
  assert.equal(
    classifyClaudeSandboxCanary({ mutated: false, attempted: true, refused: false, permissionDenials: 2 }).passed,
    true,
  );

  // Never claim the escalation path was blocked when it was never exercised.
  assert.equal(
    classifyClaudeSandboxCanary({ mutated: false, attempted: true, refused: true, escalationAttempts: 0 }).escalationBlocked,
    null,
  );
});

test("cross-checks a reported cost against the per-model breakdown", async () => {
  const { parsed } = await replayFixture("stream-json-tool-calls.jsonl");

  // Pricing the aggregate as if it were all the requested model is systematically
  // low, because the run also used Haiku. That is a false alarm on almost every run,
  // not a price change, so the cross-check must price each model it actually used.
  const perModel = priceModelUsage(parsed.modelUsage);
  const aggregate = priceUsage("claude-sonnet-5", parsed.usage);
  assert.ok(costDivergence(parsed.totalCostUsd, perModel).ratio < 0.0001, "per-model agrees to the cent");
  // The aggregate is systematically low because the unrequested model's work is
  // missing from it. In this fixture Haiku is only 0.2% of the run; in a shorter run
  // it is a much larger share and tips over the tolerance, which is the false alarm
  // this cross-check exists to avoid.
  assert.ok(aggregate < perModel, "pricing the aggregate as one model under-reports");
  assert.equal(
    costDivergence(0.01826, priceUsage("claude-sonnet-5", { inputTokens: 21_591, cachedInputTokens: 20_640, cacheWriteTokens: 947, outputTokens: 355 })).material,
    true,
    "observed live-run proportions false-alarm on the aggregate",
  );

  // `claude-haiku-4-5-20251001` is not a rate-card key; its canonicalModel is.
  assert.ok(Object.keys(parsed.modelUsage).includes("claude-haiku-4-5-20251001"));
  assert.equal(MODEL_PRICING["claude-haiku-4-5-20251001"], undefined);

  // A breakdown containing a model that cannot be priced yields null rather than a
  // partial sum silently compared against a complete total.
  assert.equal(priceModelUsage({ "some-future-model": { inputTokens: 10, outputTokens: 1 } }), null);
  assert.equal(priceModelUsage({}), null);
  assert.equal(priceModelUsage(null), null);

  // enrichUsage records the per-model sum as the cross-check figure.
  const enriched = enrichUsage("claude-sonnet-5", parsed.usage, undefined, "2026-08-05", {
    reportedCost: parsed.totalCostUsd,
    modelUsage: parsed.modelUsage,
  });
  assert.equal(enriched.estimatedCost, perModel);
  assert.notEqual(enriched.estimatedCost, aggregate);
});

test("refuses to run another provider's model", async () => {
  // A Claude task whose stage policy still names a GPT model must fail with a message
  // that says why, not with an opaque catalogue lookup error.
  await assert.rejects(
    () => runClaude({ cwd: "/tmp", prompt: "x", model: "gpt-5.6-luna", reasoning: "xhigh" }),
    /Claude cannot run gpt-5\.6-luna, which belongs to codex provider/,
  );
  await assert.rejects(
    () => runClaude({ cwd: "/tmp", prompt: "x", model: "mistral-large", reasoning: "high" }),
    /belongs to no known provider/,
  );
});

test("lets every stage pick its own provider, model and reasoning", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-provider-choice-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();

    // Codex at the gates, Claude implementing — the mix is the point, so it must not be
    // rejected or collapsed onto one runtime.
    const stagePolicies = {
      triage: { model: "claude-sonnet-5", reasoning: "high" },
      scouts: { model: "claude-haiku-4-5", reasoning: NO_REASONING_EFFORT },
      grill: { model: "claude-sonnet-5", reasoning: "high" },
      specification: { model: "claude-sonnet-5", reasoning: "high" },
      plan: { model: "gpt-5.6-sol", reasoning: "ultra" },
      implement: { model: "claude-opus-5", reasoning: "xhigh" },
      repair: { model: "claude-opus-5", reasoning: "max" },
      "dev-review": { model: "gpt-5.6-sol", reasoning: "high" },
      test: { model: "gpt-5.6-luna", reasoning: "xhigh" },
      "final-review": { model: "gpt-5.6-sol", reasoning: "ultra" },
    };
    const task = await store.create({
      title: "Mixed providers",
      description: "Each stage runs on the runtime its own model belongs to.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
      stagePolicies,
    });

    const expected = {
      triage: "claude", scouts: "claude", grill: "claude", specification: "claude",
      plan: "codex", implement: "claude", repair: "claude",
      "dev-review": "codex", test: "codex", "final-review": "codex",
    };
    for (const [policyId, provider] of Object.entries(expected)) {
      const resolved = resolveAgentPolicy(task, policyId);
      assert.equal(resolved.provider, provider, policyId);
      assert.equal(resolved.model, stagePolicies[policyId].model, policyId);
      assert.equal(resolved.reasoning, stagePolicies[policyId].reasoning, policyId);
    }

    // `ultra` exists on Codex and not on Claude; `none` only on Haiku. Each model's
    // levels are validated against its own catalogue entry.
    assert.equal(resolveAgentPolicy(task, "plan").reasoning, "ultra");
    assert.equal(resolveAgentPolicy(task, "scouts").reasoning, NO_REASONING_EFFORT);
    assert.equal(assertSupportedReasoning("claude-haiku-4-5", NO_REASONING_EFFORT), null);
    assert.throws(() => assertSupportedReasoning("claude-opus-5", "ultra"), /does not support ultra/);

    // `implement` is reached by two policies, so the kind decides which one owns the
    // provider for the attempt.
    assert.equal(policyIdForRun("implementation", "implement"), "implement");
    assert.equal(policyIdForRun("repair", "implement"), "repair");
    assert.equal(policyIdForRun("review", "dev-review"), "dev-review");

    // A model no provider claims falls back rather than being routed to a guess.
    assert.equal(providerForModelId("mistral-large"), null);
    assert.equal(
      resolveAgentPolicy({ agentConfig: { provider: "claude", stagePolicies: { plan: { model: "mistral-large", reasoning: "high" } } } }, "plan").provider,
      "claude",
    );
    assert.equal(resolveAgentPolicy({ agentConfig: {} }, "plan").provider, "codex");
    assert.equal(defaultRuntimeSettings().defaultProvider, "codex");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("offers both providers' models with their own reasoning levels", async () => {
  const catalog = await readExecutionProviderCatalog();
  const byId = new Map(catalog.models.map((model) => [model.id, model]));

  // Settings validation and task creation validate reasoning against the model's own
  // levels, so a single-provider catalogue would leave the other's models with none and
  // reject every value for them.
  assert.equal(byId.get("gpt-5.6-sol").provider, "codex");
  assert.equal(byId.get("claude-opus-5").provider, "claude");
  assert.ok(byId.get("gpt-5.6-sol").reasoningLevels.includes("ultra"));
  assert.equal(byId.get("claude-opus-5").reasoningLevels.includes("ultra"), false);
  assert.deepEqual(byId.get("claude-haiku-4-5").reasoningLevels, [NO_REASONING_EFFORT]);
  // Editable, so settings validation accepts them as selectable.
  for (const id of ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]) {
    assert.equal(byId.get(id).editable, true, id);
  }
  assert.equal(new Set(catalog.models.map((model) => model.id)).size, catalog.models.length, "no duplicate ids");
});

test("records the authorizing gate's provider on the candidate revision", () => {
  // The retry-grant path reconstructs a synthetic reservation from revision lineage
  // long after the real reservation was replaced. Without a recorded provider it has
  // to guess the default, which would fail every Claude gate that authorized a
  // repair on a task that never involved Codex.
  assert.equal(readExecutionProvider({ provider: undefined }), "codex");
  assert.equal(readExecutionProvider({ provider: "claude" }), "claude");
  assert.equal(readExecutionProvider({ provider: null }), "codex");
});

test("refuses to pass either canary when the OS sandbox never started", () => {
  // `sandbox.failIfUnavailable: true` does not abort the run — it surfaces per command
  // like any other tool error. So a dead sandbox still yields refused commands and an
  // untouched guarded file, which are exactly the observations a pass is built from.
  // Checking startup last would report agreement precisely when the mechanism being
  // verified is absent.
  const readOnlyLooksFine = { mutated: false, attempted: true, refused: true, refusedCommands: 2 };
  assert.equal(classifyClaudeSandboxCanary(readOnlyLooksFine).passed, true, "control: this shape passes");
  const readOnlyDead = classifyClaudeSandboxCanary({ ...readOnlyLooksFine, sandboxUnavailable: true });
  assert.equal(readOnlyDead.passed, false);
  assert.equal(readOnlyDead.sandboxUnavailable, true);
  assert.match(readOnlyDead.detail, /one layer instead of two/);

  const writeLooksFine = { insideWritten: true, editToolWorked: true, escaped: [] };
  assert.equal(classifyClaudeWriteCanary(writeLooksFine).passed, true, "control: this shape passes");
  const writeDead = classifyClaudeWriteCanary({ ...writeLooksFine, sandboxUnavailable: true });
  assert.equal(writeDead.passed, false);
  assert.equal(writeDead.sandboxUnavailable, true);

  // A dead sandbox outranks every other signal, including an escape: the escape is a
  // consequence, and reporting the cause is what sends someone to the right place.
  assert.equal(
    classifyClaudeWriteCanary({ insideWritten: true, editToolWorked: true, escaped: ["sourceRoot"], sandboxUnavailable: true }).sandboxUnavailable,
    true,
  );
});
