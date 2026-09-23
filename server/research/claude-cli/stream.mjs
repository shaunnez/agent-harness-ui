// Claude Code `--output-format stream-json --verbose` → neutral `ResearchEvent`s.
//
// `--output-format json` returns one blob at the end and nothing in between, so `events()`
// would have nothing to read; `stream-json` is what makes a live event stream possible, and
// `--verbose` is what makes `stream-json` emit the intermediate lines rather than only the
// terminal one. Both flags are required together.
//
// The mapping below is taken from a captured run, not from documentation:
//
//   | CLI stream line                 | ResearchEventType    |
//   |---------------------------------|----------------------|
//   | `system` / `init`               | run.started          |
//   | `assistant` block `tool_use`    | tool.called          |
//   | `user` block `tool_result`      | source.retrieved     |
//   | `assistant` block `text`        | log / finding.created|
//   | `rate_limit_event`              | budget.ceiling_hit   |
//   | `result` / `success`            | run.completed        |
//
// Two rules carried over from `claude-runtime.mjs`, both pinned to recorded output rather than
// to the docs: correlation is by `tool_use_id` alone (results arrive out of order), and
// success is `is_error !== true`, never `is_error === false` (a successful `Read` result omits
// the field entirely). Unknown top-level types and unknown `system` subtypes are tolerated —
// `rate_limit_event`, `system/post_turn_summary` and `system/thinking_tokens` all appear in
// recorded runs and none of them were documented.
//
// This module is pure: it turns one line into zero or more `{type, data}` pairs and holds no
// state beyond what the caller passes in. The runtime owns ordinals, ids and timestamps.

/** A `rate_limit_event` whose status is one of these is the plan actually saying stop. Any
 *  other status is routine telemetry the CLI emits on most turns, and reporting every one of
 *  them as a ceiling would make `budget.ceiling_hit` meaningless. */
const BLOCKING_RATE_LIMIT_STATUSES = new Set(["rejected", "blocked", "exhausted", "rate_limited"]);

/** The tools whose results are retrieved web content. Matched exactly, not by keyword: the
 *  local corpus tool is called `mcp__qv__search_qv`, and a pattern loose enough to catch a
 *  hypothetical MCP web-search server catches that too, turning every licensed catalogue row
 *  into a public web citation. Anything not named here is an internal record, which is the
 *  conservative direction — a corpus row is never a public citation, and a misfiled web result
 *  understates rather than overstates what may be published. */
const WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);

/** The fence the recipe's system prompt asks the model to finish with. Its presence in an
 *  assistant text block is what distinguishes a finding from running commentary. */
const JSON_FENCE = /```json\s*([\s\S]*?)```/;

export function isFinalAnswerText(text) {
  return JSON_FENCE.test(String(text ?? ""));
}

/** The last ```json fence in a body of text, parsed. Last rather than first: the model quotes
 *  the schema back at itself mid-run often enough that taking the first fence picks up a
 *  template instead of an answer. Returns null rather than throwing on malformed JSON — a
 *  malformed answer is a run that produced no band, not a runtime failure. */
export function parseFinalJsonFence(text) {
  const body = String(text ?? "");
  const fences = [...body.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let index = fences.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(fences[index][1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the fence before it: a truncated final fence should not hide a complete earlier one.
    }
  }
  return null;
}

export function sourceTypeForTool(toolName) {
  return WEB_TOOLS.has(String(toolName ?? "")) ? "web" : "internal_record";
}

/** Shorten a tool result for an event payload. The full text is in the transcript; this is the
 *  excerpt an operator reads in a feed, and an unbounded one would put a 60 KB corpus table
 *  into every event row. */
function excerptOf(content, limit = 2_000) {
  const text = Array.isArray(content)
    ? content.map((block) => (typeof block === "string" ? block : (block?.text ?? ""))).join("\n")
    : typeof content === "string"
      ? content
      : JSON.stringify(content ?? null);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Translate one parsed stream line.
 *
 * `toolCalls` is a `Map` the caller owns, keyed by `tool_use_id`, so a `tool_result` can name
 * the tool that produced it. Correlation has to survive out-of-order arrival, which is why it
 * is a map and not a "most recent call" variable.
 *
 * Returns `[]` for a line that carries nothing an operator needs — thinking blocks, unknown
 * types, routine rate-limit telemetry.
 */
export function translateStreamLine(line, { toolCalls = new Map(), runId = null } = {}) {
  if (!line || typeof line !== "object") return [];
  const events = [];
  const now = () => new Date().toISOString();

  if (line.type === "system") {
    if (line.subtype !== "init") return [];
    return [
      {
        type: "run.started",
        data: {
          sessionId: line.session_id ?? null,
          model: line.model ?? null,
          tools: Array.isArray(line.tools) ? line.tools : [],
          mcpServers: Array.isArray(line.mcp_servers) ? line.mcp_servers : [],
          permissionMode: line.permissionMode ?? null,
        },
      },
    ];
  }

  if (line.type === "assistant") {
    for (const block of line.message?.content ?? []) {
      if (block?.type === "tool_use") {
        toolCalls.set(block.id, { name: block.name, input: block.input ?? {} });
        events.push({
          type: "tool.called",
          data: { toolUseId: block.id, tool: block.name, input: block.input ?? {} },
        });
      } else if (block?.type === "text" && String(block.text ?? "").trim()) {
        events.push({
          // The final answer is the one text block that matters; everything else the model
          // says on the way is running commentary and is logged as such.
          type: isFinalAnswerText(block.text) ? "finding.created" : "log",
          data: { message: block.text },
        });
      }
      // `thinking` blocks are deliberately dropped: they are not evidence, they are not a
      // finding, and they are the largest thing in the stream.
    }
    return events;
  }

  if (line.type === "user") {
    for (const block of line.message?.content ?? []) {
      if (block?.type !== "tool_result") continue;
      const call = toolCalls.get(block.tool_use_id) ?? { name: "unknown", input: {} };
      // `is_error !== true`, never `is_error === false`: a successful result may omit the field.
      const failed = block.is_error === true;
      events.push({
        type: "source.retrieved",
        data: {
          source: {
            // Run-scoped by contract, so the CLI's own tool-use id is a perfectly good id and
            // needs no prefixing to stay unique.
            id: block.tool_use_id ?? `tool-result-${toolCalls.size}`,
            sourceType: sourceTypeForTool(call.name),
            title: call.name,
            retrievedAt: now(),
            metadata: {
              tool: call.name,
              input: call.input,
              ...(failed ? { failed: true } : {}),
              ...(runId ? { runId } : {}),
            },
          },
          excerpt: excerptOf(block.content),
          failed,
        },
      });
    }
    return events;
  }

  if (line.type === "rate_limit_event") {
    const info = line.rate_limit_info ?? {};
    if (!BLOCKING_RATE_LIMIT_STATUSES.has(String(info.status))) return [];
    return [
      {
        type: "budget.ceiling_hit",
        data: {
          reason: "plan_rate_limit",
          status: info.status ?? null,
          rateLimitType: info.rateLimitType ?? null,
          resetsAt: info.resetsAt ?? null,
        },
      },
    ];
  }

  if (line.type === "result") {
    const failed = line.is_error === true || line.subtype !== "success";
    return [
      {
        type: failed ? "run.failed" : "run.completed",
        data: {
          subtype: line.subtype ?? null,
          stopReason: line.stop_reason ?? null,
          numTurns: line.num_turns ?? null,
          durationMs: line.duration_ms ?? null,
          ...(line.api_error_status ? { apiErrorStatus: line.api_error_status } : {}),
        },
      },
    ];
  }

  return [];
}

/**
 * The neutral `ResearchUsage` a terminal `result` line carries.
 *
 * `usage.iterations` is diagnostic only and never summed — it does not reconcile with the
 * totals. `modelUsage` does, and it is the only place a per-model breakdown exists, so
 * `byModel` is built from it rather than inferred.
 */
export function usageFromResultLine(line, { toolCalls = 0, searchCalls = 0 } = {}) {
  const usage = line?.usage ?? {};
  const byModel = {};
  for (const [model, entry] of Object.entries(line?.modelUsage ?? {})) {
    byModel[model] = {
      inputTokens: Number(entry?.inputTokens ?? 0),
      outputTokens: Number(entry?.outputTokens ?? 0),
      modelCalls: 0,
      estimatedCostUsd: Number(entry?.costUSD ?? 0),
      // The CLI prices the call itself, so a figure here is never an unpriced estimate of ours.
      priced: entry?.costUSD != null,
    };
  }
  return {
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    cachedTokens: Number(usage.cache_read_input_tokens ?? 0),
    // The CLI counts assistant turns, not model calls; `num_turns` is the closest honest
    // measure and is reported as such rather than dressed up as an exact call count.
    modelCalls: Number(line?.num_turns ?? 0),
    toolCalls,
    searchCalls,
    estimatedCostUsd: Number(line?.total_cost_usd ?? 0),
    partial: false,
    ...(Object.keys(byModel).length ? { byModel } : {}),
  };
}
