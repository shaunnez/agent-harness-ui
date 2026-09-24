// `opencode run --format json` → neutral `ResearchEvent`s, the OpenCode twin of
// `../codex-cli/stream.mjs`. Pinned to captured runs of opencode v2.0.15 with DeepSeek 4.1 Flash:
//
//   | JSON line (`type`)        | ResearchEventType                         |
//   |---------------------------|-------------------------------------------|
//   | first line of a session   | run.started                               |
//   | `tool_use` `websearch`    | tool.called (a search)                    |
//   | `tool_use` `execute`      | tool.called (a Code Mode script)          |
//   | `text`                    | log / finding.created                     |
//   | `step_finish`             | (usage, not an event)                     |
//   | `error`                   | (the caller's to classify)                |
//
// OpenCode v2 exposes MCP tools through Code Mode: the model writes a short script for its
// `execute` tool that calls `tools.<server>.<tool>(…)`. The individual QV and fetch calls are
// therefore not on this stream; the host sees and records every one of them on the relay, which
// is where the citation checks read the rows a run was shown and the pages it fetched.
//
// Pure: one parsed line in, zero or more `{type, data}` out.

import { isFinalAnswerText } from "../claude-cli/stream.mjs";

export const OPENCODE_WEB_SEARCH_TOOL = "websearch";
export const OPENCODE_CODE_MODE_TOOL = "execute";

export function translateOpenCodeLine(line, state = { started: false }) {
  if (!line || typeof line !== "object") return [];
  const events = [];
  if (!state.started && line.sessionID) {
    state.started = true;
    events.push({ type: "run.started", data: { sessionId: line.sessionID, tools: [], mcpServers: [] } });
  }
  const part = line.part ?? {};

  if (line.type === "tool_use") {
    const tool = String(part.tool ?? "unknown");
    const input = part.state?.input && typeof part.state.input === "object" ? part.state.input : {};
    events.push({ type: "tool.called", data: { toolUseId: part.callID ?? part.id ?? null, tool, input } });
    if (part.state?.status === "error")
      events.push({
        type: "log",
        data: { message: `opencode: ${tool} failed: ${String(part.state.error ?? "").slice(0, 500)}` },
      });
    return events;
  }

  if (line.type === "text") {
    const text = String(part.text ?? "");
    if (text.trim())
      events.push({ type: isFinalAnswerText(text) ? "finding.created" : "log", data: { message: text } });
    return events;
  }

  return events;
}

/**
 * The neutral `ResearchUsage` for an OpenCode run, from its exported messages (the stream omits
 * the last step's usage, the export does not). OpenCode's `tokens.input` excludes cache reads, so
 * they are added back: `inputTokens` includes the cached ones, as on the other runtimes. The
 * dollar figure is OpenCode's own price for the model, an API-rate estimate on a flat plan.
 */
export function usageFromOpenCodeMessages(messages, { model, toolCalls = 0, searchCalls = 0 } = {}) {
  const totals = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0, priced: false };
  for (const message of messages ?? []) {
    const info = message?.info ?? message ?? {};
    const tokens = info.tokens;
    if (!tokens) continue;
    const cached = Number(tokens.cache?.read ?? 0);
    totals.inputTokens += Number(tokens.input ?? 0) + cached;
    totals.cachedTokens += cached;
    totals.outputTokens += Number(tokens.output ?? 0) + Number(tokens.reasoning ?? 0);
    if (Number.isFinite(Number(info.cost))) {
      totals.costUsd += Number(info.cost);
      totals.priced = true;
    }
  }
  const estimate = totals.priced ? Math.round(totals.costUsd * 1e6) / 1e6 : null;
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cachedTokens: totals.cachedTokens,
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
