// One `claude -p` call: the argv, the environment, and the stream drained into translated
// events. Both runtimes go through here.
//
// That shared path is the point. Phase 2 asks whether four roles beat one agent, and the
// answer only means something if the two are the same CLI invocation with different prompts.
// Two copies of the flag list would drift — a stray `--strict-mcp-config` on one side, a
// different `--output-format` on the other — and the measurement would quietly become a
// comparison of two harnesses rather than of two prompt structures.

import { buildClaudeEnvironment, CLAUDE_RUN_LABEL } from "../../claude-runtime.mjs";
import { sourceTypeForTool, translateStreamLine, usageFromResultLine } from "./stream.mjs";

/**
 * Build the argv for one call. Exported so a test can assert the six flags without spawning.
 *
 * `--output-format stream-json --verbose` rather than `json`: `json` returns one blob at the
 * end, and a runtime whose `events()` had nothing to yield until the run was over would be a
 * batch job wearing a stream's interface.
 */
export function claudeCallArgs({
  objective,
  model,
  systemPrompt,
  mcpConfigPath,
  allowedTools,
  maxUsd = null,
}) {
  return [
    "-p",
    objective,
    "--model",
    model,
    "--append-system-prompt",
    systemPrompt,
    "--mcp-config",
    mcpConfigPath,
    "--allowed-tools",
    allowedTools.join(","),
    "--output-format",
    "stream-json",
    "--verbose",
    // Absent unless the budget names a dollar ceiling: a default would cap runs nobody asked
    // to cap, and the recorded baseline was produced without one.
    ...(maxUsd ? ["--max-budget-usd", String(maxUsd)] : []),
  ];
}

/**
 * Run one call to completion, translating its stream as it arrives.
 *
 * Returns what happened rather than throwing on a failed run: a non-zero exit, an empty output
 * and a CLI-reported error are all outcomes the caller classifies, and the caller is the only
 * thing that knows whether this call was the whole run or one role in a sequence.
 */
export async function runClaudeCall({
  run,
  binary,
  env,
  cwd,
  objective,
  model,
  systemPrompt,
  mcpConfigPath,
  allowedTools,
  maxUsd = null,
  timeoutMs,
  signal,
  // The budget lines this call is held to while it runs. The CLI enforces none of them: the
  // Deep Agents worker had them as graph middleware, and here they are counted off the stream
  // and reported once, the first time one is crossed, so the caller can stop the child.
  ceilings = null,
  onCeiling = () => {},
  onEvent = () => {},
  onRawLine = () => {},
}) {
  const modelMessages = new Set();
  let ceilingReported = false;
  const checkCeilings = () => {
    if (!ceilings || ceilingReported) return;
    const crossed =
      ceilings.maxModelCalls && modelMessages.size > ceilings.maxModelCalls
        ? "maxModelCalls"
        : ceilings.maxSearchCalls && state.searchCallCount > ceilings.maxSearchCalls
          ? "maxSearchCalls"
          : null;
    if (!crossed) return;
    ceilingReported = true;
    onCeiling(crossed, {
      modelCalls: modelMessages.size,
      searchCalls: state.searchCallCount,
      limit: ceilings[crossed],
    });
  };
  const state = {
    toolCalls: new Map(),
    toolCallCount: 0,
    searchCallCount: 0,
    finalText: "",
    resultLine: null,
    sawCeiling: false,
    ceiling: null,
  };
  const args = claudeCallArgs({ objective, model, systemPrompt, mcpConfigPath, allowedTools, maxUsd });
  const handleLine = (rawLine) => {
    onRawLine(rawLine);
    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      // Not a stream line — a warning the CLI wrote to stdout, or a partial write. Surfaced
      // rather than dropped, because a silent drop is how a real failure hides.
      if (rawLine.trim()) onEvent("log", { message: `claude: ${rawLine.slice(0, 500)}` });
      return;
    }
    if (parsed.type === "result") state.resultLine = parsed;
    // One model response can arrive as several `assistant` lines, one per content block, all
    // carrying the same message id; counting lines would count blocks, not calls.
    if (parsed.type === "assistant")
      modelMessages.add(parsed.message?.id ?? `line-${modelMessages.size + 1}`);
    for (const event of translateStreamLine(parsed, { toolCalls: state.toolCalls })) {
      if (event.type === "tool.called") {
        state.toolCallCount += 1;
        // Classified the same way the events are, so a licensed corpus lookup is never counted
        // as a web search against `maxSearchCalls`.
        if (sourceTypeForTool(event.data.tool) === "web") state.searchCallCount += 1;
      }
      if (event.type === "budget.ceiling_hit") {
        state.sawCeiling = true;
        state.ceiling = event.data;
      }
      // The last text block carrying a fence wins: the prompt asks the model to finish with
      // one, and a fence quoted mid-run is a template rather than an answer.
      if (event.type === "finding.created") state.finalText = String(event.data.message ?? "");
      // Terminal states are the caller's to decide. A `result` line followed by a non-zero exit
      // is a failed call, and trusting the line would call it complete.
      if (event.type === "run.completed" || event.type === "run.failed") continue;
      onEvent(event.type, event.data);
    }
    checkCeilings();
  };

  let outcome = null;
  let spawnError = null;
  try {
    outcome = await run(binary, args, {
      cwd,
      // Built up from an allowlist, so `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and
      // `ANTHROPIC_BASE_URL` cannot reach the child and move the call onto metered billing.
      env,
      // An empty, closed stdin is what makes `-p` non-interactive — the shell script's
      // `< /dev/null`.
      input: "",
      signal,
      timeoutMs,
      label: CLAUDE_RUN_LABEL,
      onStdoutLine: handleLine,
    });
  } catch (error) {
    spawnError = error;
  }
  return {
    args,
    outcome,
    spawnError,
    resultLine: state.resultLine,
    finalText: state.finalText,
    toolCallCount: state.toolCallCount,
    searchCallCount: state.searchCallCount,
    sawCeiling: state.sawCeiling,
    ceiling: state.ceiling,
    usage: state.resultLine
      ? usageFromResultLine(state.resultLine, {
          toolCalls: state.toolCallCount,
          searchCalls: state.searchCallCount,
        })
      : null,
  };
}

/**
 * The plan said stop. Distinct from every other failure because it is not about this call: the
 * quota is exhausted for the window, so the next call fails too, and a benchmark that keeps
 * going records failures as research results.
 *
 * The first run of the 30-scope exit test learned this the hard way — five scenarios were
 * scored `not_established` at $0.00 and one turn each, and one of them was a scenario the exit
 * test requires to produce no band, so it "passed" its load-bearing check by never running.
 */
export const PLAN_LIMIT_ERROR_CODE = "claude_cli_plan_limit_reached";

/** True when a failed call failed because the claude.ai plan window is exhausted: a blocking
 *  `rate_limit_event`, or a `result` line carrying the API's own 429. */
function planLimitReached(call) {
  if (call.sawCeiling) return true;
  return Number(call.resultLine?.api_error_status) === 429;
}

/** Classify one completed call. Shared so a role in a sequence and a whole single-agent run
 *  fail for the same reasons under the same codes. */
export function classifyCall(call, options) {
  const verdict = classifyOutcome(call, options);
  if (verdict.ok || !planLimitReached(call)) return verdict;
  const resetsAt = Number(call.ceiling?.resetsAt) || null;
  return {
    ok: false,
    timedOut: verdict.timedOut ?? false,
    planLimit: true,
    error: {
      code: PLAN_LIMIT_ERROR_CODE,
      message:
        `The Claude subscription's ${call.ceiling?.rateLimitType ?? "plan"} usage window is exhausted` +
        `${resetsAt ? `; it resets at ${new Date(resetsAt * 1000).toISOString()}` : ""}. ` +
        "This run produced nothing and must not be scored. Wait for the window and run it again.",
      // Retryable in principle, but not by any retry loop that runs now: `trio.mjs` retries
      // within seconds, and every one of those retries would fail the same way.
      retryable: false,
    },
  };
}

function classifyOutcome(call, { emptyOutputCode }) {
  if (call.spawnError) {
    const timedOut =
      call.spawnError.code === "PROCESS_TIMEOUT" || /timeout/i.test(call.spawnError.name ?? "");
    return {
      ok: false,
      timedOut,
      error: {
        code: timedOut ? "research_timeout" : "claude_cli_failed",
        message: call.spawnError.message ?? String(call.spawnError),
      },
    };
  }
  if (call.outcome && call.outcome.code !== 0)
    return {
      ok: false,
      error: {
        code: "claude_cli_exited_abnormally",
        message: `The Claude CLI exited with code ${call.outcome.code}${call.outcome.signal ? ` (signal ${call.outcome.signal})` : ""}.`,
      },
    };
  if (!call.resultLine)
    // The failure mode the 90 recorded runs actually hit: a clean exit with nothing on stdout.
    // It correlated with spawn concurrency, never with the scope, so it is retryable and says
    // so in a code rather than leaving a caller to guess from the message.
    return {
      ok: false,
      error: {
        code: emptyOutputCode,
        message: "The Claude CLI produced no result line. Retry: this correlates with spawn concurrency.",
        retryable: true,
      },
    };
  if (call.resultLine.is_error === true || call.resultLine.subtype !== "success")
    return {
      ok: false,
      error: {
        code: "claude_cli_reported_error",
        message: `The Claude CLI ended with subtype ${call.resultLine.subtype ?? "unknown"}${call.resultLine.api_error_status ? ` (${call.resultLine.api_error_status})` : ""}.`,
      },
    };
  return { ok: true, error: null };
}

export { buildClaudeEnvironment };
