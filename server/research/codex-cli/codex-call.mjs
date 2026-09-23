// One `codex exec` research call: the argv, the environment, and the stream drained into
// translated events. The Codex twin of `../claude-cli/cli-call.mjs`, returning the same shape
// so `runtime.mjs` cannot tell the two apart.
//
// Codex has no `--allowed-tools`. What stands in for it, each checked against codex-cli
// 0.155.1 with `codex mcp list`, which parses the same overrides without calling a model:
//
// - `--ignore-user-config`, so the operator's own MCP servers, plugins and instructions are
//   not loaded. (The Claude runtime still loads the operator's servers; they are uncallable
//   there, but they fill the tool list. Here they are simply absent.)
// - `mcp_servers.<name>.enabled_tools`, the per-server allowlist, built from the recipe's own
//   `mcp__<server>__<tool>` list. A server the list names no tool from is not passed at all.
// - `web_search="live"` only when the list names `WebSearch`; otherwise `"disabled"`.
// - `--disable shell_tool --disable unified_exec`, so the agent has no shell to `curl` with,
//   and `--sandbox read-only` with `approval_policy="never"` under that, which also denies the
//   network to anything that does run. `view_image` and `tool_suggest` are off for the same
//   reason: nothing a research run needs, and each is a way to reach outside the recipe.
//
// The system prompt goes in `developer_instructions`, which sits beside Codex's own base
// instructions the way `--append-system-prompt` sits beside Claude Code's. The objective is
// the prompt, on stdin.

import { buildCodexEnvironment } from "../../codex-runtime.mjs";
import { priceUsage } from "../../model-catalog.mjs";
import {
  CODEX_SHELL_TOOL,
  CODEX_WEB_SEARCH_TOOL,
  translateCodexLine,
  usageFromCodexTurns,
} from "./stream.mjs";

export const CODEX_RUN_LABEL = "Codex";

/** Features a research run turns off. Named in `codex features list`. */
export const CODEX_DISABLED_FEATURES = Object.freeze([
  "memories",
  "shell_tool",
  "unified_exec",
  "view_image",
  "tool_suggest",
]);

/** How long one MCP call may take. `fetch_source` reads a 20 MB PDF at worst. */
const MCP_TOOL_TIMEOUT_SEC = 180;
const MCP_STARTUP_TIMEOUT_SEC = 30;

/** A TOML value for `-c`. JSON's string and array syntax is valid TOML for everything this
 *  module writes: strings, and arrays of strings. */
const toml = (value) => JSON.stringify(value);

/** The recipe's allowlist, read as Codex configuration. Throws on a tool Codex has no
 *  equivalent for, rather than silently running a different recipe. */
export function codexToolPolicy(allowedTools, mcpServers) {
  const enabled = new Map();
  let webSearch = false;
  for (const tool of allowedTools) {
    if (tool === "WebSearch" || tool === CODEX_WEB_SEARCH_TOOL) {
      webSearch = true;
      continue;
    }
    const match = /^mcp__(.+?)__(.+)$/.exec(tool);
    if (!match) throw new Error(`Codex has no equivalent of the allowed tool "${tool}".`);
    const [, server, name] = match;
    if (!mcpServers?.[server]) throw new Error(`The allowed tool "${tool}" names no configured server.`);
    enabled.set(server, [...(enabled.get(server) ?? []), name]);
  }
  return { webSearch, enabled };
}

export function codexCallArgs({ model, reasoning, systemPrompt, mcpConfig, allowedTools, cwd }) {
  const servers = mcpConfig?.mcpServers ?? {};
  const policy = codexToolPolicy(allowedTools, servers);
  const serverArgs = [];
  for (const [name, tools] of policy.enabled) {
    const server = servers[name];
    const key = `mcp_servers.${name}`;
    serverArgs.push(
      "-c",
      `${key}.command=${toml(server.command)}`,
      "-c",
      `${key}.args=${toml(server.args ?? [])}`,
      "-c",
      `${key}.enabled_tools=${toml(tools)}`,
      "-c",
      `${key}.startup_timeout_sec=${MCP_STARTUP_TIMEOUT_SEC}`,
      "-c",
      `${key}.tool_timeout_sec=${MCP_TOOL_TIMEOUT_SEC}`,
    );
  }
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-c",
    'approval_policy="never"',
    "--model",
    model,
    ...(reasoning ? ["-c", `model_reasoning_effort=${toml(reasoning)}`] : []),
    "-c",
    `web_search=${toml(policy.webSearch ? "live" : "disabled")}`,
    "-c",
    `developer_instructions=${toml(systemPrompt)}`,
    ...serverArgs,
    "--cd",
    cwd,
    "-",
  ];
}

/** The recipe's prompt names Claude's search tool. Codex calls its own `web_search`, and a
 *  prompt telling the model to use a tool it does not have is a different recipe. */
export function codexSystemPrompt(prompt) {
  return String(prompt).replaceAll("WebSearch", CODEX_WEB_SEARCH_TOOL);
}

/** Run one call to completion. Returns what happened rather than throwing, as `runClaudeCall`
 *  does: the caller classifies. */
export async function runCodexCall({
  run,
  binary,
  env,
  cwd,
  objective,
  model,
  reasoning = null,
  systemPrompt,
  mcpConfig,
  allowedTools,
  timeoutMs,
  signal,
  // Codex reports no per-call count and no dollar charge, so `maxModelCalls` and `maxUsd`
  // cannot be enforced live here; `maxSearchCalls` can, and `maxRuntimeMs` is the timeout.
  ceilings = null,
  onCeiling = () => {},
  onEvent = () => {},
  onRawLine = () => {},
}) {
  const state = {
    toolCalls: new Map(),
    toolCallCount: 0,
    searchCallCount: 0,
    shellCallCount: 0,
    finalText: "",
    turns: [],
    failure: null,
    sawTurnCompleted: false,
  };
  let ceilingReported = false;
  const args = codexCallArgs({
    model,
    reasoning,
    systemPrompt: codexSystemPrompt(systemPrompt),
    mcpConfig,
    allowedTools,
    cwd,
  });
  const handleLine = (rawLine) => {
    onRawLine(rawLine);
    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      if (rawLine.trim()) onEvent("log", { message: `codex: ${rawLine.slice(0, 500)}` });
      return;
    }
    if (parsed.type === "turn.completed") {
      state.sawTurnCompleted = true;
      if (parsed.usage) state.turns.push(parsed.usage);
    }
    if (parsed.type === "turn.failed") state.failure = String(parsed.error?.message ?? "turn failed");
    if (parsed.type === "error") state.failure = String(parsed.message ?? "error");
    for (const event of translateCodexLine(parsed, { toolCalls: state.toolCalls })) {
      if (event.type === "tool.called") {
        state.toolCallCount += 1;
        if (event.data.tool === CODEX_WEB_SEARCH_TOOL) state.searchCallCount += 1;
        if (event.data.tool === CODEX_SHELL_TOOL) state.shellCallCount += 1;
      }
      if (event.type === "finding.created") state.finalText = String(event.data.message ?? "");
      onEvent(event.type, event.data);
    }
    if (!ceilingReported && ceilings?.maxSearchCalls && state.searchCallCount > ceilings.maxSearchCalls) {
      ceilingReported = true;
      onCeiling("maxSearchCalls", {
        searchCalls: state.searchCallCount,
        limit: ceilings.maxSearchCalls,
      });
    }
  };

  let outcome = null;
  let spawnError = null;
  try {
    outcome = await run(binary, args, {
      cwd,
      // Built up from an allowlist, so `OPENAI_API_KEY` and `CODEX_API_KEY` cannot reach the
      // child and move the call onto metered billing.
      env: buildCodexEnvironment(env, cwd),
      input: objective,
      signal,
      timeoutMs,
      label: CODEX_RUN_LABEL,
      onStdoutLine: handleLine,
    });
  } catch (error) {
    spawnError = error;
  }
  const planLimit = state.failure != null && isPlanLimitMessage(state.failure);
  return {
    args,
    outcome,
    spawnError,
    resultLine: null,
    finalText: state.finalText,
    toolCallCount: state.toolCallCount,
    searchCallCount: state.searchCallCount,
    shellCallCount: state.shellCallCount,
    failure: state.failure,
    sawTurnCompleted: state.sawTurnCompleted,
    sawCeiling: planLimit,
    ceiling: planLimit ? { reason: "plan_rate_limit", message: state.failure } : null,
    usage: state.turns.length
      ? usageFromCodexTurns(state.turns, {
          model,
          toolCalls: state.toolCallCount,
          searchCalls: state.searchCallCount,
          price: priceUsage,
        })
      : null,
  };
}

export const CODEX_PLAN_LIMIT_ERROR_CODE = "codex_cli_plan_limit_reached";
export const CODEX_EMPTY_OUTPUT_ERROR_CODE = "codex_cli_empty_output";

/** The ChatGPT plan saying stop, as the CLI words it ("You've hit your usage limit… try again
 *  at…"). Pinned to wording, so it errs towards classifying: a limit read as an ordinary error
 *  would be scored as a research failure, which is the worse mistake. */
export function isPlanLimitMessage(message) {
  return /usage limit|rate[ _-]?limit|quota|try again (?:at|in)/i.test(String(message ?? ""));
}

export function classifyCodexCall(call) {
  if (call.spawnError) {
    const timedOut =
      call.spawnError.code === "PROCESS_TIMEOUT" || /timeout/i.test(call.spawnError.name ?? "");
    return {
      ok: false,
      timedOut,
      error: {
        code: timedOut ? "research_timeout" : "codex_cli_failed",
        message: call.spawnError.message ?? String(call.spawnError),
      },
    };
  }
  if (call.sawCeiling)
    return {
      ok: false,
      planLimit: true,
      error: {
        code: CODEX_PLAN_LIMIT_ERROR_CODE,
        message:
          `The ChatGPT plan's usage window is exhausted (${call.failure}). ` +
          "This run produced nothing and must not be scored. Wait for the window and run it again.",
        retryable: false,
      },
    };
  if (call.outcome && call.outcome.code !== 0)
    return {
      ok: false,
      error: {
        code: "codex_cli_exited_abnormally",
        message:
          `The Codex CLI exited with code ${call.outcome.code}` +
          `${call.outcome.signal ? ` (signal ${call.outcome.signal})` : ""}` +
          `${call.failure ? `: ${call.failure}` : "."}`,
      },
    };
  if (call.failure)
    return { ok: false, error: { code: "codex_cli_reported_error", message: call.failure } };
  if (!call.sawTurnCompleted)
    return {
      ok: false,
      error: {
        code: CODEX_EMPTY_OUTPUT_ERROR_CODE,
        message: "The Codex CLI finished without completing its turn. Retry.",
        retryable: true,
      },
    };
  return { ok: true, error: null };
}
