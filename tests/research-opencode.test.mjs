// The `opencode-cli` research runtime: the Go plan gate, a child environment with no provider
// key, a configuration that allows only Code Mode over the recipe's servers and web search, and
// a stream and usage reader pinned to opencode v2.0.15's JSON. A stub process runner only:
// nothing here calls a model.

import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOpenCodeGoAuth,
  isOpenCodeGoModel,
  readOpenCodeAuth,
} from "../server/research/opencode-cli/auth.mjs";
import {
  buildOpenCodeEnvironment,
  classifyOpenCodeCall,
  openCodeConfig,
  openCodeSystemPrompt,
  runOpenCodeCall,
} from "../server/research/opencode-cli/opencode-call.mjs";
import { openCodeCliDriver } from "../server/research/opencode-cli/runtime.mjs";
import { translateOpenCodeLine, usageFromOpenCodeMessages } from "../server/research/opencode-cli/stream.mjs";

const MCP = {
  mcpServers: {
    qv: { command: "node", args: ["relay.mjs", "/tmp/s.sock", "search_qv"] },
    research: { command: "node", args: ["relay.mjs", "/tmp/s.sock", "fetch_source"] },
  },
};
const TOOLS = ["mcp__qv__search_qv", "mcp__research__fetch_source", "WebSearch"];

test("the Go plan gate asks the CLI, with no provider key in its environment", async () => {
  assert.deepEqual(
    readOpenCodeAuth("Anthropic  ANTHROPIC_API_KEY  environment\nOpenCode Console  Personal  stored\n"),
    {
      goPlan: true,
    },
  );
  assert.equal(readOpenCodeAuth("Anthropic  ANTHROPIC_API_KEY  environment\n").goPlan, false);
  assert.ok(isOpenCodeGoModel("opencode-go/deepseek-v4.1-flash"));
  assert.ok(!isOpenCodeGoModel("anthropic/claude-opus-5-5"));

  let probedEnv = null;
  const run = async (_binary, args, options) => {
    probedEnv = options.env;
    assert.deepEqual(args, ["auth", "list"]);
    return { code: 0, stdout: "Anthropic  ANTHROPIC_API_KEY  environment\n" };
  };
  await assert.rejects(
    assertOpenCodeGoAuth({
      binary: "opencode",
      env: { HOME: "/h", ANTHROPIC_API_KEY: "sk-x" },
      run,
      buildEnv: buildOpenCodeEnvironment,
    }),
    { code: "opencode_cli_not_on_go_plan" },
  );
  assert.equal(probedEnv.ANTHROPIC_API_KEY, undefined);
});

test("the child environment is an allowlist: no provider key reaches it", () => {
  const env = buildOpenCodeEnvironment(
    { PATH: "/bin", HOME: "/h", OPENCODE_API_KEY: "k1", ANTHROPIC_API_KEY: "k2", OPENAI_API_KEY: "k3" },
    "/tmp/run",
    "{}",
  );
  assert.equal(env.PATH, "/bin");
  assert.equal(env.HOME, "/h");
  assert.equal(env.TMPDIR, "/tmp/run");
  assert.equal(env.OPENCODE_CONFIG_CONTENT, "{}");
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
  for (const key of ["OPENCODE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"])
    assert.equal(env[key], undefined);
});

test("the configuration denies everything but Code Mode over the recipe's servers and web search", () => {
  const config = openCodeConfig({
    systemPrompt: "Use mcp__qv__search_qv, then WebSearch.",
    mcpConfig: MCP,
    allowedTools: TOOLS,
  });
  assert.deepEqual(Object.keys(config.mcp.servers), ["qv", "research"]);
  assert.deepEqual(config.mcp.servers.qv, {
    type: "local",
    command: ["node", "relay.mjs", "/tmp/s.sock", "search_qv"],
  });
  assert.deepEqual(config.websearch, { provider: "parallel" });
  const agent = config.agents.research;
  assert.equal(config.default_agent, "research");
  assert.deepEqual(agent.permissions, [
    { action: "*", resource: "*", effect: "deny" },
    { action: "execute", resource: "*", effect: "allow" },
    { action: "qv_*", resource: "*", effect: "allow" },
    { action: "research_*", resource: "*", effect: "allow" },
    { action: "websearch", resource: "*", effect: "allow" },
  ]);
  assert.match(agent.system, /tools\.qv\.search_qv/);
  assert.match(agent.system, /then websearch\./);
  assert.doesNotMatch(agent.system, /mcp__/);

  const noSearch = openCodeConfig({
    systemPrompt: "x",
    mcpConfig: MCP,
    allowedTools: ["mcp__qv__search_qv"],
  });
  assert.equal(noSearch.websearch, undefined);
  assert.deepEqual(Object.keys(noSearch.mcp.servers), ["qv"]);
  assert.throws(
    () => openCodeConfig({ systemPrompt: "x", mcpConfig: MCP, allowedTools: ["Bash"] }),
    /no equivalent/,
  );
  assert.match(openCodeSystemPrompt("x"), /fetch_source/);
  assert.match(openCodeSystemPrompt("x"), /about 50 tool calls/);
  assert.match(openCodeSystemPrompt("x"), /ONE continuous passage/);
});

test("the stream reader announces tools and the final answer; usage comes from the export", () => {
  const state = { started: false };
  const start = translateOpenCodeLine({ type: "step_start", sessionID: "ses_1", part: {} }, state);
  assert.equal(start[0].type, "run.started");
  const tool = translateOpenCodeLine(
    {
      type: "tool_use",
      sessionID: "ses_1",
      part: { tool: "websearch", callID: "c1", state: { status: "completed", input: { query: "q" } } },
    },
    state,
  );
  assert.deepEqual(tool, [
    { type: "tool.called", data: { toolUseId: "c1", tool: "websearch", input: { query: "q" } } },
  ]);
  const answer = translateOpenCodeLine(
    { type: "text", part: { text: 'Done.\n```json\n{"band":null}\n```' } },
    state,
  );
  assert.equal(answer[0].type, "finding.created");

  const usage = usageFromOpenCodeMessages(
    [
      { info: { role: "user" } },
      {
        info: {
          cost: 0.001,
          tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 400, write: 0 } },
        },
      },
      {
        info: { cost: 0.002, tokens: { input: 50, output: 20, reasoning: 0, cache: { read: 0, write: 0 } } },
      },
    ],
    { model: "opencode-go/deepseek-v4.1-flash", toolCalls: 2, searchCalls: 1 },
  );
  assert.equal(usage.inputTokens, 550);
  assert.equal(usage.cachedTokens, 400);
  assert.equal(usage.outputTokens, 35);
  assert.equal(usage.estimatedCostUsd, 0.003);
  assert.equal(usage.costBasis, "api_rate_estimate");
});

test("a run drains the stream, exports the session for usage, and classifies", async () => {
  const lines = [
    { type: "step_start", sessionID: "ses_9", part: {} },
    {
      type: "tool_use",
      sessionID: "ses_9",
      part: { tool: "execute", state: { status: "completed", input: { code: "x" } } },
    },
    { type: "step_finish", sessionID: "ses_9", part: {} },
    { type: "text", sessionID: "ses_9", part: { text: '```json\n{"band":{"low":1,"high":2}}\n```' } },
  ];
  const calls = [];
  const run = async (_binary, args, options) => {
    calls.push({ args, env: options.env });
    if (args[0] === "session") {
      options.onStdoutLine(
        JSON.stringify({ messages: [{ info: { cost: 0.01, tokens: { input: 10, output: 1 } } }] }),
      );
      return { code: 0 };
    }
    for (const line of lines) options.onStdoutLine(JSON.stringify(line));
    return { code: 0 };
  };
  const call = await runOpenCodeCall({
    run,
    binary: "opencode",
    env: { PATH: "/bin", HOME: "/h", OPENCODE_API_KEY: "secret" },
    cwd: "/tmp/run",
    objective: "Price it",
    model: "opencode-go/deepseek-v4.1-flash",
    systemPrompt: "Use mcp__qv__search_qv.",
    mcpConfig: MCP,
    allowedTools: ["mcp__qv__search_qv"],
    timeoutMs: 1000,
  });
  assert.deepEqual(calls[0].args.slice(0, 7), [
    "run",
    "--standalone",
    "--format",
    "json",
    "--agent",
    "research",
    "-m",
  ]);
  assert.deepEqual(calls[1].args, ["session", "export", "--standalone", "ses_9"]);
  assert.equal(calls[0].env.OPENCODE_API_KEY, undefined);
  assert.ok(!call.args.includes("Price it"));
  assert.match(call.finalText, /"low":1/);
  assert.equal(call.toolCallCount, 1);
  assert.equal(call.usage.estimatedCostUsd, 0.01);
  assert.deepEqual(classifyOpenCodeCall(call), { ok: true, error: null });

  const limited = classifyOpenCodeCall({ ...call, sawCeiling: true, failure: "usage limit reached" });
  assert.equal(limited.error.code, "opencode_cli_plan_limit_reached");
  assert.equal(
    classifyOpenCodeCall({ ...call, sawTurnCompleted: false }).error.code,
    "opencode_cli_empty_output",
  );
});

test("an OpenCode run is capped at fifteen minutes, below the shared budget, and only on the Go plan", async () => {
  const driver = openCodeCliDriver();
  let timeoutMs = null;
  const run = async (_binary, args, options) => {
    if (args[0] === "run") timeoutMs = options.timeoutMs;
    return { code: 0 };
  };
  const base = {
    run,
    binary: "opencode",
    env: { HOME: "/h" },
    workingDirectory: "/tmp/run",
    objective: "x",
    systemPrompt: "x",
    mcpConfig: MCP,
    allowedTools: ["mcp__qv__search_qv"],
  };
  await driver.call({
    ...base,
    model: "opencode-go/deepseek-v4.1-flash",
    budget: { maxRuntimeMs: 20 * 60_000 },
  });
  assert.equal(timeoutMs, 15 * 60_000);
  await driver.call({
    ...base,
    model: "opencode-go/deepseek-v4.1-flash",
    budget: { maxRuntimeMs: 5 * 60_000 },
  });
  assert.equal(timeoutMs, 5 * 60_000);
  assert.throws(
    () => driver.call({ ...base, model: "anthropic/claude-opus-5-5", budget: null }),
    /not an OpenCode Go plan model/,
  );
});
