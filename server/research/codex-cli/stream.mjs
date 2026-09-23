// `codex exec --json` → neutral `ResearchEvent`s, the Codex twin of `../claude-cli/stream.mjs`.
//
// PROVISIONAL until pinned to a captured run. The Claude reader was written from a recorded
// stream, not from documentation, and this one must be too before a Codex result is scored.
// Until then the mapping follows the `codex exec --json` event schema (codex-cli 0.155.1):
//
//   | exec JSON line                              | ResearchEventType     |
//   |---------------------------------------------|-----------------------|
//   | `thread.started`                            | run.started           |
//   | `item.started` `mcp_tool_call`/`web_search` | tool.called           |
//   | `item.completed` `mcp_tool_call`            | source.retrieved      |
//   | `item.completed` `agent_message`            | log / finding.created |
//   | `item.*` `command_execution`                | tool.called + log     |
//   | `turn.completed` (usage)                    | (usage, not an event) |
//   | `turn.failed` / `error`                     | (the caller's to classify) |
//
// A Codex web search returns nothing to the stream but its query: the results stay inside the
// model's context. So a search is a `tool.called` and never a `source.retrieved`, and the only
// way a web page becomes a checkable source is `fetch_source`, exactly as on the Claude side.
//
// Tool names are rewritten into the Claude form, `mcp__<server>__<tool>`, so the host-tool
// filter, the strike counter and the citation checks read one vocabulary for both CLIs.
//
// Pure: one parsed line in, zero or more `{type, data}` out. `toolCalls` is the caller's `Map`,
// keyed by item id, so a completion can be matched to its start and neither is counted twice.

import { isFinalAnswerText } from "../claude-cli/stream.mjs";

/** The Codex name for its native search, as the stream and the model both call it. */
export const CODEX_WEB_SEARCH_TOOL = "web_search";

/** The shell, which a research run has switched off. Reported under this name if it ever runs. */
export const CODEX_SHELL_TOOL = "shell";

export function codexToolName(item) {
  if (item?.type === "web_search") return CODEX_WEB_SEARCH_TOOL;
  if (item?.type === "command_execution") return CODEX_SHELL_TOOL;
  if (item?.type === "mcp_tool_call") {
    const server = String(item.server ?? "").trim();
    const tool = String(item.tool ?? item.name ?? "").trim();
    return server && tool ? `mcp__${server}__${tool}` : tool || "unknown";
  }
  return String(item?.type ?? "unknown");
}

export function codexSourceType(toolName) {
  return toolName === CODEX_WEB_SEARCH_TOOL ? "web" : "internal_record";
}

function toolInput(item) {
  if (item.type === "web_search") return { query: String(item.query ?? item.action?.query ?? "") };
  if (item.type === "command_execution") return { command: item.command ?? null };
  const args = item.arguments ?? item.args ?? item.input ?? {};
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
  }
  return args && typeof args === "object" ? args : {};
}

/** The text of an MCP result: `content` blocks joined, else the structured value, else the
 *  error. Bounded, because the full text is in the transcript. */
function resultText(item, limit = 2_000) {
  const result = item.result ?? {};
  const blocks = Array.isArray(result.content) ? result.content : Array.isArray(result) ? result : null;
  const text = blocks
    ? blocks.map((block) => (typeof block === "string" ? block : (block?.text ?? ""))).join("\n")
    : item.error
      ? String(item.error?.message ?? item.error)
      : result.structured_content != null
        ? JSON.stringify(result.structured_content)
        : typeof result === "string"
          ? result
          : JSON.stringify(result);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function mcpFailed(item) {
  return item.status === "failed" || item.error != null || item.result?.is_error === true;
}

function called(item, toolCalls) {
  const tool = codexToolName(item);
  const input = toolInput(item);
  toolCalls.set(item.id, { name: tool, input, announced: true });
  return { type: "tool.called", data: { toolUseId: item.id ?? null, tool, input } };
}

export function translateCodexLine(line, { toolCalls = new Map(), runId = null } = {}) {
  if (!line || typeof line !== "object") return [];

  if (line.type === "thread.started")
    return [{ type: "run.started", data: { sessionId: line.thread_id ?? null, tools: [], mcpServers: [] } }];

  const item = line.item;
  if (!item || !["item.started", "item.updated", "item.completed"].includes(line.type)) return [];
  const known = toolCalls.get(item.id);

  if (["mcp_tool_call", "web_search", "command_execution"].includes(item.type)) {
    const events = [];
    // A web search's query can arrive only on completion, so the call is announced on
    // whichever line comes first and refreshed on none: one search is one `tool.called`.
    if (!known?.announced) events.push(called(item, toolCalls));
    if (item.type === "command_execution" && !known)
      events.push({
        type: "log",
        data: {
          message: "Codex ran a shell command, which research runs switch off.",
          command: item.command ?? null,
        },
      });
    if (line.type !== "item.completed" || item.type !== "mcp_tool_call") return events;
    const call = toolCalls.get(item.id);
    const failed = mcpFailed(item);
    events.push({
      type: "source.retrieved",
      data: {
        source: {
          id: item.id ?? `tool-result-${toolCalls.size}`,
          sourceType: codexSourceType(call.name),
          title: call.name,
          retrievedAt: new Date().toISOString(),
          metadata: {
            tool: call.name,
            input: call.input,
            ...(failed ? { failed: true } : {}),
            ...(runId ? { runId } : {}),
          },
        },
        excerpt: resultText(item),
        failed,
      },
    });
    return events;
  }

  if (line.type === "item.completed" && item.type === "agent_message") {
    const text = String(item.text ?? item.content ?? "");
    if (!text.trim()) return [];
    return [{ type: isFinalAnswerText(text) ? "finding.created" : "log", data: { message: text } }];
  }

  // `reasoning` is dropped for the reason Claude's thinking blocks are: not evidence, not a
  // finding. An `error` item is a non-fatal notice; the fatal ones arrive as `turn.failed`.
  if (line.type === "item.completed" && item.type === "error")
    return [{ type: "log", data: { message: `codex: ${String(item.message ?? "").slice(0, 500)}` } }];

  return [];
}

/**
 * The neutral `ResearchUsage` for a Codex run. A ChatGPT plan reports tokens and no charge, so
 * the dollar figure is the rate card's, an API-rate estimate, and says so in `costBasis`.
 * `input_tokens` already includes the cached ones, which is how `priceUsage` reads it.
 */
export function usageFromCodexTurns(turns, { model, toolCalls = 0, searchCalls = 0, price = () => null } = {}) {
  const totals = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  for (const usage of turns) {
    totals.inputTokens += Number(usage?.input_tokens ?? 0);
    totals.cachedInputTokens += Number(usage?.cached_input_tokens ?? 0);
    totals.outputTokens += Number(usage?.output_tokens ?? 0);
  }
  const estimate = price(model, totals);
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cachedTokens: totals.cachedInputTokens,
    toolCalls,
    searchCalls,
    ...(estimate != null ? { estimatedCostUsd: estimate } : {}),
    costBasis: "api_rate_estimate",
    partial: false,
    byModel: {
      [model]: {
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        ...(estimate != null ? { estimatedCostUsd: estimate } : {}),
        priced: estimate != null,
      },
    },
  };
}
