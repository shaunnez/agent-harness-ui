// One `opencode run` research call: the configuration, the environment, and the stream drained
// into translated events. Returns the shape `../codex-cli/codex-call.mjs` returns, so
// `../claude-cli/runtime.mjs` cannot tell the CLIs apart.
//
// OpenCode has no `--allowed-tools`. What stands in for it, each checked against opencode v2.0.15:
//
// - The whole configuration arrives in `OPENCODE_CONFIG_CONTENT`, with project config disabled,
//   so the operator's own servers and agents are not what the run gets.
// - One primary agent, `research`, whose permissions deny every action and then allow exactly
//   `execute` (Code Mode, the only way v2 exposes MCP tools), each configured server's tools
//   (`<server>_*`: without it a denied server's tools never enter the Code Mode catalogue) and,
//   when the recipe allows web search, `websearch`. Shell, edit, write, read, webfetch, the browser and subagents are denied.
//   Verified: with this policy the model's Code Mode catalogue held only the configured servers'
//   tools, and browser and shell calls were refused as unknown.
// - Only the servers the recipe names a tool from are configured; the relay itself serves only
//   the tools it was started with.
//
// MCP servers join the catalogue a few seconds after the session starts, so a first call can
// find a tool unknown; the prompt says to retry once rather than conclude the tool is absent.
//
// What it cannot do: Code Mode scripts may make HTTP requests of their own. A page read that way
// was never retained by the host, so a figure quoted from it fails the citation check; the
// prompt says so and names `fetch_source` as the only way to read a page that can be cited.

import os from "node:os";
import {
  OPENCODE_CODE_MODE_TOOL,
  OPENCODE_WEB_SEARCH_TOOL,
  translateOpenCodeLine,
  usageFromOpenCodeMessages,
} from "./stream.mjs";

export const OPENCODE_RUN_LABEL = "OpenCode";

/** The call budget the prompt states. Soft: the model is told it, the host does not count Code
 *  Mode's inner calls. It exists so a run that cannot source its main cost says so, rather than
 *  searching until the hard cap below fails it (Shaun, 24 September: fifty). */
export const OPENCODE_SOFT_TOOL_CALLS = 50;

/** The hard cap on one OpenCode run, below the shared `standard` budget's 20 minutes: completed
 *  DeepSeek runs took 3–4 minutes typically and 9 at most, and the runs that reached 20 were
 *  still hunting for a source. A run that hits it fails (Shaun, 24 September: fifteen minutes). */
export const OPENCODE_MAX_RUNTIME_MS = 15 * 60_000;
export const OPENCODE_AGENT = "research";

/** Pinned rather than "random" (Shaun, 24 September: "pin parallel"). Across DeepSeek's first 369
 *  searches through the Go plan's providers, Parallel returned results on 91 of 91; Firecrawl
 *  returned none on 43 of 91, and "random" keeps one provider for a whole session. */
export const OPENCODE_WEB_SEARCH_PROVIDER = "parallel";

const EXPORT_TIMEOUT_MS = 30_000;

/** Built up from an allowlist. `HOME` stays, because the Go plan login lives under it; no
 *  provider key does. */
export function buildOpenCodeEnvironment(source, runtimeTemp, configContent = null) {
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TERM",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "XDG_DATA_HOME",
    "XDG_CONFIG_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
  ];
  const environment = {};
  for (const name of allowed) {
    const value = source?.[name];
    if (value != null && value !== "") environment[name] = value;
  }
  environment.HOME ??= os.homedir();
  Object.assign(environment, {
    TEMP: runtimeTemp,
    TMP: runtimeTemp,
    TMPDIR: runtimeTemp,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_FILEWATCHER: "1",
  });
  if (configContent) environment.OPENCODE_CONFIG_CONTENT = configContent;
  return environment;
}

/** The recipe's allowlist, read as OpenCode configuration. Throws on a tool OpenCode has no
 *  equivalent for, rather than silently running a different recipe. */
export function openCodeToolPolicy(allowedTools, mcpServers) {
  const servers = new Set();
  let webSearch = false;
  for (const tool of allowedTools) {
    if (tool === "WebSearch" || tool === OPENCODE_WEB_SEARCH_TOOL) {
      webSearch = true;
      continue;
    }
    const match = /^mcp__(.+?)__(.+)$/.exec(tool);
    if (!match) throw new Error(`OpenCode has no equivalent of the allowed tool "${tool}".`);
    if (!mcpServers?.[match[1]]) throw new Error(`The allowed tool "${tool}" names no configured server.`);
    servers.add(match[1]);
  }
  return { webSearch, servers: [...servers] };
}

/** The recipe prompt in OpenCode's vocabulary: Code Mode calls and its own search tool. */
export function openCodeSystemPrompt(prompt) {
  const body = String(prompt)
    .replace(/mcp__([A-Za-z0-9_-]+?)__([A-Za-z0-9_]+)/g, "tools.$1.$2")
    .replace(/\bWebSearch\b|\bweb_search\b/g, OPENCODE_WEB_SEARCH_TOOL);
  return (
    "TOOLS: the QV and research tools are Code Mode tools. Call them from the `execute` tool, as " +
    "`await tools.qv.search_qv({...})`, `await tools.research.fetch_source({...})` and so on; " +
    "return the results you need from the script. The tools join the catalogue a few seconds after " +
    "the run starts: if one is reported unknown, call `search({})` and retry it; they are there. " +
    "Fetch one page per fetch_source call, never several in one Promise.all: one failing page " +
    "then rejects the others, and fetching a failed URL again stops the run. " +
    "Use `websearch` directly to search the web. Read a web page " +
    "only with tools.research.fetch_source: a page read any other way was not retained, so a " +
    "figure quoted from it fails the citation check. An excerpt is ONE continuous passage copied " +
    "character for character from the fetched text: never join separate passages with '...', never " +
    "write escape sequences such as \\n, and keep it to the sentence or table row that states the " +
    "figure. Before finishing, check the largest component: if it rests on no cited QV row, close " +
    "proxy or fetched quote, the band is not established. You have about " +
    `${OPENCODE_SOFT_TOOL_CALLS} tool calls in total (QV lookups, page fetches and web searches ` +
    "together, whether direct or inside one execute script): if the main cost is still unsourced " +
    "by then, finish with not established rather than keep searching.\n\n" +
    body
  );
}

export function openCodeConfig({ systemPrompt, mcpConfig, allowedTools }) {
  const available = mcpConfig?.mcpServers ?? {};
  const policy = openCodeToolPolicy(allowedTools, available);
  const servers = {};
  for (const name of policy.servers) {
    const server = available[name];
    servers[name] = {
      type: "local",
      command: [server.command, ...(server.args ?? [])],
      // No `timeout`: v2.0.15 rejects a number there and then silently drops the whole server
      // ("skipped malformed recognized value"), which leaves the run with no QV tools at all.
    };
  }
  const permissions = [
    { action: "*", resource: "*", effect: "deny" },
    ...(policy.servers.length ? [{ action: OPENCODE_CODE_MODE_TOOL, resource: "*", effect: "allow" }] : []),
    ...policy.servers.map((name) => ({ action: `${name}_*`, resource: "*", effect: "allow" })),
    ...(policy.webSearch ? [{ action: OPENCODE_WEB_SEARCH_TOOL, resource: "*", effect: "allow" }] : []),
  ];
  return {
    mcp: { servers },
    ...(policy.webSearch ? { websearch: { provider: OPENCODE_WEB_SEARCH_PROVIDER } } : {}),
    agents: {
      [OPENCODE_AGENT]: {
        description: "Cost research: QV rows, web search and fetched pages, nothing else.",
        mode: "primary",
        system: openCodeSystemPrompt(systemPrompt),
        permissions,
      },
    },
    default_agent: OPENCODE_AGENT,
  };
}

export function openCodeCallArgs({ model, objective }) {
  return ["run", "--standalone", "--format", "json", "--agent", OPENCODE_AGENT, "-m", model, objective];
}

/** The plan saying stop. Pinned to wording, erring towards classifying, as on Codex. */
export function isOpenCodePlanLimitMessage(message) {
  return /usage limit|rate[ _-]?limit|quota|try again (?:at|in)|insufficient (?:balance|credits)/i.test(
    String(message ?? ""),
  );
}

/** Run one call to completion. Returns what happened rather than throwing: the caller classifies. */
export async function runOpenCodeCall({
  run,
  binary,
  env,
  cwd,
  objective,
  model,
  systemPrompt,
  mcpConfig,
  allowedTools,
  timeoutMs,
  signal,
  // OpenCode reports usage per step, and the last step's only in the export, so `maxUsd` and
  // `maxModelCalls` are not enforced live; `maxSearchCalls` is, and `maxRuntimeMs` is the timeout.
  ceilings = null,
  onCeiling = () => {},
  onEvent = () => {},
  onRawLine = () => {},
}) {
  const state = {
    started: false,
    sessionId: null,
    toolCallCount: 0,
    searchCallCount: 0,
    finalText: "",
    lastText: "",
    failure: null,
    steps: 0,
  };
  let ceilingReported = false;
  const configContent = JSON.stringify(openCodeConfig({ systemPrompt, mcpConfig, allowedTools }));
  const childEnv = buildOpenCodeEnvironment(env, cwd, configContent);
  const args = openCodeCallArgs({ model, objective });
  const handleLine = (rawLine) => {
    onRawLine(rawLine);
    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      if (rawLine.trim()) onEvent("log", { message: `opencode: ${rawLine.slice(0, 500)}` });
      return;
    }
    state.sessionId ??= parsed.sessionID ?? null;
    if (parsed.type === "step_finish") state.steps += 1;
    if (parsed.type === "error") state.failure = String(parsed.error?.message ?? "error");
    if (parsed.type === "text" && String(parsed.part?.text ?? "").trim())
      state.lastText = String(parsed.part.text);
    for (const event of translateOpenCodeLine(parsed, state)) {
      if (event.type === "tool.called") {
        state.toolCallCount += 1;
        if (event.data.tool === OPENCODE_WEB_SEARCH_TOOL) state.searchCallCount += 1;
      }
      if (event.type === "finding.created") state.finalText = String(event.data.message ?? "");
      onEvent(event.type, event.data);
    }
    if (!ceilingReported && ceilings?.maxSearchCalls && state.searchCallCount > ceilings.maxSearchCalls) {
      ceilingReported = true;
      onCeiling("maxSearchCalls", { searchCalls: state.searchCallCount, limit: ceilings.maxSearchCalls });
    }
  };

  let outcome = null;
  let spawnError = null;
  try {
    outcome = await run(binary, args, {
      cwd,
      env: childEnv,
      signal,
      timeoutMs,
      label: OPENCODE_RUN_LABEL,
      onStdoutLine: handleLine,
    });
  } catch (error) {
    spawnError = error;
  }
  const messages = state.sessionId
    ? await exportMessages({ run, binary, cwd, env: childEnv, sessionId: state.sessionId })
    : null;
  const planLimit = state.failure != null && isOpenCodePlanLimitMessage(state.failure);
  return {
    args: args.slice(0, -1),
    outcome,
    spawnError,
    resultLine: null,
    finalText: state.finalText || state.lastText,
    toolCallCount: state.toolCallCount,
    searchCallCount: state.searchCallCount,
    shellCallCount: 0,
    failure: state.failure,
    sawTurnCompleted: Boolean(state.lastText),
    sawCeiling: planLimit,
    ceiling: planLimit ? { reason: "plan_rate_limit", message: state.failure } : null,
    usage: messages
      ? usageFromOpenCodeMessages(messages, {
          model,
          toolCalls: state.toolCallCount,
          searchCalls: state.searchCallCount,
        })
      : null,
  };
}

/** The session's messages, which carry every step's tokens and cost. Null when the export fails:
 *  usage is then unavailable, never guessed. */
async function exportMessages({ run, binary, cwd, env, sessionId }) {
  let text = "";
  try {
    const result = await run(binary, ["session", "export", "--standalone", sessionId], {
      cwd,
      env,
      timeoutMs: EXPORT_TIMEOUT_MS,
      label: OPENCODE_RUN_LABEL,
      onStdoutLine: (line) => {
        text += `${line}\n`;
      },
    });
    if (!text && result?.stdout) text = result.stdout;
    return JSON.parse(text).messages ?? null;
  } catch {
    return null;
  }
}

export const OPENCODE_PLAN_LIMIT_ERROR_CODE = "opencode_cli_plan_limit_reached";
export const OPENCODE_EMPTY_OUTPUT_ERROR_CODE = "opencode_cli_empty_output";

export function classifyOpenCodeCall(call) {
  if (call.spawnError) {
    const timedOut =
      call.spawnError.code === "PROCESS_TIMEOUT" || /timeout/i.test(call.spawnError.name ?? "");
    return {
      ok: false,
      timedOut,
      error: {
        code: timedOut ? "research_timeout" : "opencode_cli_failed",
        message: call.spawnError.message ?? String(call.spawnError),
      },
    };
  }
  if (call.sawCeiling)
    return {
      ok: false,
      planLimit: true,
      error: {
        code: OPENCODE_PLAN_LIMIT_ERROR_CODE,
        message:
          `The OpenCode Go plan refused the call (${call.failure}). ` +
          "This run produced nothing and must not be scored. Wait for the window and run it again.",
        retryable: false,
      },
    };
  if (call.outcome && call.outcome.code !== 0)
    return {
      ok: false,
      error: {
        code: "opencode_cli_exited_abnormally",
        message:
          `The OpenCode CLI exited with code ${call.outcome.code}` +
          `${call.outcome.signal ? ` (signal ${call.outcome.signal})` : ""}` +
          `${call.failure ? `: ${call.failure}` : "."}`,
      },
    };
  if (call.failure)
    return { ok: false, error: { code: "opencode_cli_reported_error", message: call.failure } };
  if (!call.sawTurnCompleted)
    return {
      ok: false,
      error: {
        code: OPENCODE_EMPTY_OUTPUT_ERROR_CODE,
        message: "The OpenCode CLI finished without an answer. Retry.",
        retryable: true,
      },
    };
  return { ok: true, error: null };
}
