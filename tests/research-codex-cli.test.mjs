// The `codex-cli` research runtime: the claude-cli recipe and harness with Codex underneath.
//
// As in `research-claude-cli-host-tools.test.mjs`, the CLI is an injected runner that spawns
// the real MCP relay from the argv it was given and calls `fetch_source` through it, so the
// real bridge, `ResearchWebTools` and citation checks run. Only the model and the network are
// fake. The stream lines follow the `codex exec --json` schema; they are not yet a capture.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { priceUsage } from "../server/model-catalog.mjs";
import { QV_ALLOWED_TOOLS } from "../server/research/claude-cli/qv-recipe.mjs";
import {
  assertChatGptAuth,
  isChatGptAuth,
  readCodexAuth,
  REQUIRED_CODEX_AUTH,
} from "../server/research/codex-cli/auth.mjs";
import {
  CODEX_DISABLED_FEATURES,
  CODEX_EMPTY_OUTPUT_ERROR_CODE,
  CODEX_PLAN_LIMIT_ERROR_CODE,
  codexCallArgs,
  codexSystemPrompt,
  codexToolPolicy,
} from "../server/research/codex-cli/codex-call.mjs";
import {
  CODEX_CLI_RESEARCH_RUNTIME_ID,
  CodexCliResearchRuntime,
  DEFAULT_CODEX_CLI_MODEL,
} from "../server/research/codex-cli/runtime.mjs";
import { translateCodexLine } from "../server/research/codex-cli/stream.mjs";
import { assertResearchRuntime } from "../server/research/research-runtime-registry.mjs";

const ROW_ID = `${"c".repeat(64)}:t2:r3`;
const PAGE_URL = "https://supplier.example.test/connection";
const PAGE_TEXT = "Standard stormwater connection: $310 per metre installed, excluding traffic management.";
const FIXTURE_WEB = Object.freeze({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  fetchImpl: async () =>
    new Response(`<html><head><title>Supplier rates</title></head><body><p>${PAGE_TEXT}</p></body></html>`, {
      headers: { "content-type": "text/html" },
    }),
});
const BUDGET = Object.freeze({
  maxRuntimeMs: 30_000,
  maxResearchers: 1,
  maxConcurrentResearchers: 1,
  maxDepth: 1,
  maxModelCalls: 20,
  maxToolCalls: 20,
  maxSearchCalls: 10,
});

// --- the ChatGPT gate ------------------------------------------------------------------------

test("only a ChatGPT login passes the gate, and an API-key login is refused without echoing it", async () => {
  assert.deepEqual(readCodexAuth("Logged in using ChatGPT\n"), {
    loggedIn: true,
    authMethod: REQUIRED_CODEX_AUTH,
  });
  assert.equal(isChatGptAuth(readCodexAuth("Logged in using an API key - sk-proj-***abcd")), false);
  assert.equal(isChatGptAuth(readCodexAuth("Not logged in")), false);
  assert.equal(isChatGptAuth(readCodexAuth("")), false);

  const probe = (stdout, code = 0) => async () => ({ code, stdout, stderr: "" });
  const passed = await assertChatGptAuth({ binary: "/bin/codex", run: probe("Logged in using ChatGPT") });
  assert.equal(passed.binary, "/bin/codex");
  await assert.rejects(
    assertChatGptAuth({ binary: "/bin/codex", run: probe("Logged in using an API key - sk-proj-SECRET") }),
    (error) => {
      assert.equal(error.code, "codex_cli_not_on_chatgpt");
      assert.doesNotMatch(error.message, /SECRET|sk-/);
      assert.match(error.message, /codex login/);
      return true;
    },
  );
  // A zero exit is required as well as the sentence.
  await assert.rejects(
    assertChatGptAuth({ binary: "/bin/codex", run: probe("Logged in using ChatGPT", 1) }),
    /not signed in with ChatGPT/,
  );
});

// --- the command line ------------------------------------------------------------------------

test("the recipe's allowlist becomes per-server enabled tools, web search and no shell", () => {
  const mcpConfig = {
    mcpServers: {
      qv: { command: "python3", args: ["/srv/qv.py", "/data/index.jsonl"] },
      research: { command: "/usr/bin/node", args: ["/srv/relay.mjs", "/tmp/s.sock", "fetch_source,read_source"] },
      unused: { command: "never", args: [] },
    },
  };
  const args = codexCallArgs({
    model: "gpt-6-sol",
    reasoning: "high",
    systemPrompt: 'Use "WebSearch".\nThen stop.',
    mcpConfig,
    allowedTools: QV_ALLOWED_TOOLS,
    cwd: "/tmp/work",
  });
  const config = configOverrides(args);

  assert.deepEqual(args.slice(0, 5), ["exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules"]);
  for (const feature of ["shell_tool", "unified_exec"]) assert.ok(CODEX_DISABLED_FEATURES.includes(feature));
  for (const feature of CODEX_DISABLED_FEATURES) assert.ok(hasPair(args, "--disable", feature), feature);
  assert.ok(hasPair(args, "--sandbox", "read-only"));
  assert.ok(hasPair(args, "--model", "gpt-6-sol"));
  assert.equal(config.approval_policy, "never");
  assert.equal(config.model_reasoning_effort, "high");
  assert.equal(config.web_search, "live");
  assert.deepEqual(config["mcp_servers.qv.enabled_tools"], ["search_qv", "get_qv_table", "list_qv_sections"]);
  assert.deepEqual(config["mcp_servers.research.enabled_tools"], ["fetch_source", "read_source"]);
  assert.deepEqual(config["mcp_servers.research.args"], mcpConfig.mcpServers.research.args);
  // A server the allowlist names no tool from is not reachable at all.
  assert.ok(!Object.keys(config).some((key) => key.startsWith("mcp_servers.unused")));
  assert.equal(config.developer_instructions, 'Use "WebSearch".\nThen stop.');
  assert.deepEqual(args.slice(-3), ["--cd", "/tmp/work", "-"]);
  // Nothing on the command line can move the call onto an API key.
  assert.ok(!args.some((arg) => /api[_-]?key|OPENAI/i.test(arg)));

  const noSearch = configOverrides(
    codexCallArgs({ model: "m", systemPrompt: "", mcpConfig, allowedTools: ["mcp__qv__search_qv"], cwd: "/w" }),
  );
  assert.equal(noSearch.web_search, "disabled");
  assert.throws(() => codexToolPolicy(["WebFetch"], mcpConfig.mcpServers), /no equivalent/);
  assert.throws(() => codexToolPolicy(["mcp__missing__x"], mcpConfig.mcpServers), /no configured server/);
  assert.equal(codexSystemPrompt("Only then WebSearch, and only…"), "Only then web_search, and only…");
});

test("the child's environment carries no OpenAI or Codex API key", async () => {
  let seen = null;
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-CODEX-ENV"));
      await drain(runtime, "RSCH-CODEX-ENV");
    },
    {
      env: { OPENAI_API_KEY: "sk-live-1", CODEX_API_KEY: "sk-live-2", OPENAI_BASE_URL: "https://x" },
      run: async (_binary, _args, options) => {
        seen = options.env;
        for (const line of codexLines({ answer: answerJson([]) })) options.onStdoutLine(JSON.stringify(line));
        return { code: 0, signal: null, stdout: "", stderr: "" };
      },
    },
  );
  assert.ok(seen.PATH);
  for (const name of ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"]) assert.equal(seen[name], undefined);
});

// --- a run end to end --------------------------------------------------------------------------

test("a Codex run fetches through the host, and its citations check out as on the Claude side", async () => {
  await withRuntime(async ({ runtime }) => {
    const handle = await runtime.start(runRequest("RSCH-CODEX-CITES"));
    assert.equal(handle.runtimeId, CODEX_CLI_RESEARCH_RUNTIME_ID);
    assert.deepEqual(handle.model, { provider: "codex-cli", model: DEFAULT_CODEX_CLI_MODEL, live: true });
    assert.equal(handle.runtimeMetadata.costBasis, "api_rate_estimate");

    const events = await drain(runtime, "RSCH-CODEX-CITES");
    const status = await runtime.status("RSCH-CODEX-CITES");
    assert.equal(status.status, "completed", JSON.stringify(status.error));

    // One `tool.called` per call, whether the stream announces it on start, completion or both.
    const called = events.filter((event) => event.type === "tool.called").map((event) => event.data.tool);
    assert.deepEqual(called, ["mcp__qv__search_qv", "web_search", "mcp__research__fetch_source"]);

    // The host's retained page (announced when the relay fetched it, before the fake CLI
    // printed anything), the corpus call as an internal record, and the checked row. The
    // stream's own copy of the fetch result is dropped.
    const sources = events.filter((event) => event.type === "source.retrieved").map((event) => event.data.source);
    assert.deepEqual(
      sources.map((source) => [source.id, source.sourceType]),
      [
        ["source-1", "web"],
        ["item_0", "internal_record"],
        [`qv:${ROW_ID}`, "internal_record"],
      ],
    );

    const result = await runtime.result("RSCH-CODEX-CITES");
    const [row, web, unfetched] = result.findings;
    assert.equal(row.evidence[0].quoteVerified, true);
    assert.equal(web.evidence[0].quoteVerified, true);
    assert.equal(unfetched.evidence[0].quoteVerified, false);
    assert.deepEqual(runtime.citationSummary("RSCH-CODEX-CITES"), {
      rowsCited: 1,
      rowsFound: 1,
      rowsMissing: 0,
      rowsUnpriced: 0,
      webCited: 2,
      webVerified: 1,
      webNotFetched: 1,
      webExcerptRejected: 0,
    });

    // Tokens are real; the dollar figure is the rate card's, and says so.
    const tokens = { inputTokens: 1_200, cachedInputTokens: 800, outputTokens: 300 };
    assert.equal(result.usage.inputTokens, tokens.inputTokens);
    assert.equal(result.usage.cachedTokens, tokens.cachedInputTokens);
    assert.equal(result.usage.costBasis, "api_rate_estimate");
    assert.equal(result.usage.estimatedCostUsd, priceUsage(DEFAULT_CODEX_CLI_MODEL, tokens));
    assert.equal(result.usage.byModel[DEFAULT_CODEX_CLI_MODEL].priced, true);
    assert.equal(result.usage.searchCalls, 1);
    assert.equal(result.usage.toolCalls, 3);
    assert.equal(result.artifacts[0].kind, "codex-cli-transcript");
  });
});

// --- failures ----------------------------------------------------------------------------------

test("an exhausted ChatGPT plan fails the run as not run, never as a finding", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-CODEX-LIMIT"));
      await drain(runtime, "RSCH-CODEX-LIMIT");
      const status = await runtime.status("RSCH-CODEX-LIMIT");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, CODEX_PLAN_LIMIT_ERROR_CODE);
      assert.equal(status.error.retryable, false);
      assert.match(status.error.message, /must not be scored/);
    },
    {
      run: linesRunner(
        [
          { type: "thread.started", thread_id: "t-1" },
          { type: "turn.started" },
          { type: "turn.failed", error: { message: "You've hit your usage limit. Try again at 3:05 PM." } },
        ],
        1,
      ),
    },
  );
});

test("a clean exit that never completed its turn is the retryable empty output", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-CODEX-EMPTY"));
      await drain(runtime, "RSCH-CODEX-EMPTY");
      const status = await runtime.status("RSCH-CODEX-EMPTY");
      assert.equal(status.error.code, CODEX_EMPTY_OUTPUT_ERROR_CODE);
      assert.equal(runtime.emptyOutputCode, CODEX_EMPTY_OUTPUT_ERROR_CODE);
      assert.equal(status.error.retryable, true);
    },
    { run: linesRunner([{ type: "thread.started", thread_id: "t-1" }]) },
  );
});

test("crossing the search ceiling stops the run and names the ceiling", async () => {
  const search = (id, query) => ({
    type: "item.completed",
    item: { id, type: "web_search", query },
  });
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-CODEX-SEARCH", { maxSearchCalls: 1 }));
      const events = await drain(runtime, "RSCH-CODEX-SEARCH");
      const status = await runtime.status("RSCH-CODEX-SEARCH");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, "research_ceiling_exceeded");
      assert.equal(status.budgetState.ceilingHit, "maxSearchCalls");
      assert.equal(events.at(-1).data.truncatedBy, "maxSearchCalls");
    },
    {
      run: linesRunner([
        { type: "thread.started", thread_id: "t-1" },
        search("ws_1", "stormwater connection cost"),
        search("ws_2", "stormwater connection cost nz"),
        { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } },
      ]),
    },
  );
});

test("a shell command, which research runs switch off, is reported rather than passed over", () => {
  const toolCalls = new Map();
  const started = translateCodexLine(
    { type: "item.started", item: { id: "c1", type: "command_execution", command: "curl https://x" } },
    { toolCalls },
  );
  assert.deepEqual(
    started.map((event) => event.type),
    ["tool.called", "log"],
  );
  assert.equal(started[0].data.tool, "shell");
  assert.match(started[1].data.message, /switch off/);
  // Its completion is neither a second call nor a source.
  assert.deepEqual(
    translateCodexLine(
      { type: "item.completed", item: { id: "c1", type: "command_execution", exit_code: 1 } },
      { toolCalls },
    ),
    [],
  );
});

test("the runtime satisfies the research contract", () => {
  assertResearchRuntime(new CodexCliResearchRuntime());
  assert.equal(new CodexCliResearchRuntime().id, CODEX_CLI_RESEARCH_RUNTIME_ID);
  assert.equal(new CodexCliResearchRuntime({ env: { RESEARCH_CODEX_CLI_MODEL: "gpt-6-luna" } }).id, "codex-cli");
});

// --- helpers -----------------------------------------------------------------------------------

/** The `-c key=value` overrides, values parsed as the JSON this module writes them as. */
function configOverrides(args) {
  const config = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "-c") continue;
    const pair = args[index + 1];
    const at = pair.indexOf("=");
    config[pair.slice(0, at)] = JSON.parse(pair.slice(at + 1));
  }
  return config;
}

function hasPair(args, flag, value) {
  return args.some((arg, index) => arg === flag && args[index + 1] === value);
}

function answerJson(components) {
  return {
    id: "fixture",
    resolved_from: "qv+web",
    confidence: "medium",
    components: components.map((component) => ({ unit: "m", centre: "Auckland", ...component })),
    band: { unit: "m", low: 600, high: 740, centre: "Auckland", basis: "Fixture." },
    not_established: [],
    qv_queries_tried: ["channel drain"],
  };
}

function codexLines({ answer, fetchResult = "{…}" }) {
  const fence = `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``;
  return [
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    {
      type: "item.started",
      item: { id: "item_0", type: "mcp_tool_call", server: "qv", tool: "search_qv", arguments: { query: "channel" }, status: "in_progress" },
    },
    {
      type: "item.completed",
      item: {
        id: "item_0",
        type: "mcp_tool_call",
        server: "qv",
        tool: "search_qv",
        arguments: { query: "channel" },
        result: { content: [{ type: "text", text: `${ROW_ID} Proprietary channel and grate` }] },
        status: "completed",
      },
    },
    { type: "item.started", item: { id: "ws_0", type: "web_search", query: "" } },
    { type: "item.completed", item: { id: "ws_0", type: "web_search", query: "stormwater connection rate" } },
    {
      type: "item.completed",
      item: {
        id: "item_1",
        type: "mcp_tool_call",
        server: "research",
        tool: "fetch_source",
        arguments: { url: PAGE_URL },
        result: { content: [{ type: "text", text: fetchResult }] },
        status: "completed",
      },
    },
    { type: "item.completed", item: { id: "item_2", type: "reasoning", text: "Checking the page." } },
    { type: "item.completed", item: { id: "item_3", type: "agent_message", text: fence } },
    { type: "turn.completed", usage: { input_tokens: 1_200, cached_input_tokens: 800, output_tokens: 300 } },
  ];
}

function linesRunner(lines, code = 0) {
  return async (_binary, _args, options) => {
    for (const line of lines) options.onStdoutLine(JSON.stringify(line));
    return { code, signal: null, stdout: "", stderr: "" };
  };
}

/** Stands in for `codex exec`: reads the relay's command and args from the `-c` overrides it
 *  was given, calls `fetch_source` through the real relay, then answers citing what it got. */
function fetchingRunner() {
  return async (_binary, args, options) => {
    const config = configOverrides(args);
    const client = await startMcpClient(config["mcp_servers.research.command"], config["mcp_servers.research.args"]);
    let fetched;
    try {
      fetched = await client.call("fetch_source", { url: PAGE_URL });
    } finally {
      client.close();
    }
    const sourceId = fetched.isError ? null : JSON.parse(fetched.content[0].text).source.id;
    const answer = answerJson([
      { role: "Channel and grate", row_id: ROW_ID, amount: { low: 300, high: 360 } },
      {
        role: "Stormwater connection",
        source: PAGE_URL,
        source_id: sourceId,
        excerpt: "$310 per metre installed",
        amount: { low: 280, high: 340 },
      },
      { role: "Traffic management", source: "https://unfetched.example.test/tm", amount: { low: 20, high: 40 } },
    ]);
    for (const line of codexLines({ answer, fetchResult: fetched.content[0].text }))
      options.onStdoutLine(JSON.stringify(line));
    return { code: 0, signal: null, stdout: "", stderr: "" };
  };
}

async function startMcpClient(command, args) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  let sequence = 0;
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    call: (name, input) => request("tools/call", { name, arguments: input }),
    close: () => child.stdin.end(),
  };
}

async function withRuntime(body, { run, env = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rcx-"));
  await writeFile(
    path.join(directory, "capture.jsonl"),
    `${JSON.stringify({
      id: ROW_ID,
      description: "Proprietary channel and grate",
      headings: [{ text: "Drainage" }],
      unit_normalised: "m",
      regional_values: { Auckland: { scalar: "330.00" } },
    })}\n`,
  );
  const runtime = new CodexCliResearchRuntime({
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      RESEARCH_QV_INDEX: path.join(directory, "capture.jsonl"),
      ...env,
    },
    transcriptDirectory: path.join(directory, "transcripts"),
    sourceSnapshotDirectory: path.join(directory, "sources"),
    assertAuth: async () => ({ binary: "/usr/local/bin/codex", probe: { authMethod: REQUIRED_CODEX_AUTH } }),
    run: run ?? fetchingRunner(),
    webToolsOptions: FIXTURE_WEB,
  });
  try {
    await body({ runtime, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runRequest(id, budget = {}) {
  return {
    id,
    objective: "Price the pinned stormwater scope.",
    profile: "standard",
    context: [],
    budget: { ...BUDGET, ...budget },
  };
}

async function drain(runtime, runId) {
  const events = [];
  for await (const event of runtime.events(runId)) events.push(event);
  return events;
}
