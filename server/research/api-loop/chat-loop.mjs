// One research run as a plain tool-calling loop over an OpenAI-compatible chat API: ask the model,
// run the tools it asks for through the run's host-tool socket, hand back the results, repeat
// until it answers. Returns the shape a driver returns, so `../engine/hosted-runtime.mjs`
// (queue, host session, citation checks, transcript scan) runs it unchanged.
//
// Measured on the OpenCode runs, 89% of a run is the model and 11% its tools, so the loop spends
// nothing it does not have to: tools a step asks for run concurrently, and nothing is spawned.
//
// Limits, all enforced here because this process owns the loop:
// - `maxRuntimeMs`, as the run's deadline; each request gets what is left of it.
// - `maxModelCalls` and `maxToolCalls` from the budget; `maxSearchCalls` is the web tools' own.
// - The soft tool budget the prompt states (about 50 calls). At it, the model is told to answer
//   and asked once more with no tools, so a run that cannot source its main cost says so rather
//   than searching until the deadline fails it.

import { randomUUID } from "node:crypto";
import { isFinalAnswerText } from "../engine/final-answer.mjs";
import { reviewMessage } from "../research-answer-review.mjs";
import { priceApiUsage, resolveApiModel } from "./providers.mjs";

export const API_LOOP_EMPTY_OUTPUT_ERROR_CODE = "api_loop_empty_output";
export const API_LOOP_PLAN_LIMIT_ERROR_CODE = "api_loop_plan_limit_reached";
export const API_LOOP_SOFT_TOOL_CALLS = 50;

const MAX_TOOL_RESULT_CHARACTERS = 60_000;
const REQUEST_TIMEOUT_MS = 180_000;
const RETRY_DELAYS_MS = [2_000, 5_000, 12_000];
const WRAP_UP =
  "You have used your tool budget. Give your final answer now, as the JSON object the instructions ask " +
  "for. If the main cost is still unsourced, set the band to null with resolved_from not_established.";

class ApiError extends Error {
  constructor(message, { status = null, retryable = false, code = null } = {}) {
    super(message);
    Object.assign(this, { status, retryable, code });
  }
}

/** `tools` is `[{ name, cliName, definition: { description, inputSchema } }]`. */
export async function runChatLoop({
  env,
  model,
  systemPrompt,
  objective,
  tools,
  host,
  timeoutMs,
  signal,
  ceilings = null,
  softToolCalls = API_LOOP_SOFT_TOOL_CALLS,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  onEvent = () => {},
  onRawLine = () => {},
  onCeiling = () => {},
  // `(text) => string[]`: the host's check of a final answer. Problems go back to the model once.
  reviewAnswer = null,
}) {
  const { provider, remoteModel } = resolveApiModel(model);
  const apiKey = env?.[provider.keyEnv];
  const headers = provider.sessionHeader ? { [provider.sessionHeader]: `research-${randomUUID()}` } : {};
  const deadline = now() + timeoutMs;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolDefinitions = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.definition.description,
      parameters: tool.definition.inputSchema,
    },
  }));
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: objective },
  ];
  const state = {
    modelCalls: 0,
    toolCallCount: 0,
    searchCallCount: 0,
    finalText: "",
    failure: null,
    planLimit: false,
    sawTurnCompleted: false,
    wrappedUp: false,
    reviewed: false,
    totals: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
  };
  let spawnError = null;
  const ceiling = (name, counts) => {
    onCeiling(name, counts);
    return true;
  };

  try {
    if (!apiKey)
      throw new ApiError(`${provider.label} needs ${provider.keyEnv} in the host's environment.`, {
        code: "missing_key",
      });
    onEvent("run.started", { sessionId: null, tools: tools.map((tool) => tool.cliName), mcpServers: [] });
    for (;;) {
      if (signal?.aborted) break;
      if (now() >= deadline)
        throw Object.assign(new Error(`The run exceeded ${Math.round(timeoutMs / 1000)} seconds.`), {
          code: "PROCESS_TIMEOUT",
        });
      if (ceilings?.maxModelCalls && state.modelCalls >= ceilings.maxModelCalls) {
        ceiling("maxModelCalls", { modelCalls: state.modelCalls, limit: ceilings.maxModelCalls });
        break;
      }
      const wrapUp = !state.wrappedUp && state.toolCallCount >= softToolCalls;
      if (wrapUp) {
        state.wrappedUp = true;
        messages.push({ role: "user", content: WRAP_UP });
      }
      const body = {
        model: remoteModel,
        messages,
        ...(state.wrappedUp ? {} : { tools: toolDefinitions, tool_choice: "auto" }),
      };
      const reply = await chat({ provider, apiKey, headers, body, fetchImpl, sleep, signal, deadline, now });
      state.modelCalls += 1;
      addUsage(state.totals, reply.usage);
      const choice = reply.choices?.[0] ?? {};
      const message = choice.message ?? {};
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      onRawLine(
        JSON.stringify({
          type: "response",
          step: state.modelCalls,
          finish_reason: choice.finish_reason ?? null,
          usage: reply.usage ?? null,
          content: message.content ?? "",
          tool_calls: calls.map((call) => ({
            id: call.id,
            name: call.function?.name,
            arguments: call.function?.arguments,
          })),
        }),
      );
      // Returned as sent, `reasoning_content` included: thinking models expect their own
      // reasoning back within a turn that calls tools.
      messages.push({
        role: "assistant",
        content: message.content ?? "",
        ...(calls.length ? { tool_calls: calls } : {}),
        ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
      });
      const text = String(message.content ?? "");
      if (!calls.length) {
        const problems = text.trim() && reviewAnswer && !state.reviewed ? reviewAnswer(text) : [];
        if (problems.length) {
          state.reviewed = true;
          onRawLine(JSON.stringify({ type: "host_review", problems }));
          onEvent("log", { message: `Host review: ${problems.length} problem(s) sent back.` });
          messages.push({ role: "user", content: reviewMessage(problems) });
          continue;
        }
        if (text.trim()) {
          state.finalText = text;
          state.sawTurnCompleted = true;
          onEvent(isFinalAnswerText(text) ? "finding.created" : "log", { message: text });
        }
        break;
      }
      if (text.trim()) onEvent("log", { message: text });
      if (ceilings?.maxToolCalls && state.toolCallCount + calls.length > ceilings.maxToolCalls) {
        ceiling("maxToolCalls", {
          toolCalls: state.toolCallCount + calls.length,
          limit: ceilings.maxToolCalls,
        });
        break;
      }
      const results = await Promise.all(
        calls.map(async (call) => {
          const name = call.function?.name ?? "";
          const tool = byName.get(name);
          let input = {};
          try {
            input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            return {
              call,
              content: JSON.stringify({
                error: { code: "invalid_arguments", message: "The tool arguments were not valid JSON." },
              }),
            };
          }
          state.toolCallCount += 1;
          if (name === "web_search") state.searchCallCount += 1;
          onEvent("tool.called", { toolUseId: call.id ?? null, tool: tool?.cliName ?? name, input });
          if (!tool)
            return {
              call,
              content: JSON.stringify({
                error: { code: "unknown_research_tool", message: `Tool "${name}" is not available.` },
              }),
            };
          const answer = await host.call(name, input);
          return {
            call,
            content: bounded(JSON.stringify(answer.ok ? answer.result : { error: answer.error })),
          };
        }),
      );
      for (const { call, content } of results) {
        messages.push({ role: "tool", tool_call_id: call.id, content });
        onRawLine(JSON.stringify({ type: "tool_result", id: call.id, content: content.slice(0, 2_000) }));
      }
    }
  } catch (error) {
    if (error instanceof ApiError) {
      state.failure = error.message;
      state.planLimit = error.code === "plan_limit";
    } else spawnError = error;
  }

  const priced = priceApiUsage(model, state.totals);
  return {
    args: [provider.label, remoteModel],
    outcome: spawnError ? null : { code: 0, signal: null },
    spawnError,
    resultLine: null,
    finalText: state.finalText,
    toolCallCount: state.toolCallCount,
    searchCallCount: state.searchCallCount,
    shellCallCount: 0,
    failure: state.failure,
    sawTurnCompleted: state.sawTurnCompleted,
    sawCeiling: state.planLimit,
    ceiling: state.planLimit ? { reason: "plan_rate_limit", message: state.failure } : null,
    usage: {
      inputTokens: state.totals.inputTokens,
      outputTokens: state.totals.outputTokens,
      cachedTokens: state.totals.cachedTokens,
      modelCalls: state.modelCalls,
      toolCalls: state.toolCallCount,
      searchCalls: state.searchCallCount,
      ...(priced != null ? { estimatedCostUsd: priced } : {}),
      costBasis: "api_rate_estimate",
      partial: false,
      byModel: {
        [model]: {
          inputTokens: state.totals.inputTokens,
          outputTokens: state.totals.outputTokens,
          ...(priced != null ? { estimatedCostUsd: priced } : {}),
          priced: priced != null,
        },
      },
    },
  };
}

/** One tools-less chat call, with the loop's retries, for a caller that needs a single reply (the
 *  scoping step). Returns `{text, usage}`; throws when the key is missing or the call fails. */
export async function chatOnceWithRetries({
  env,
  model,
  systemPrompt,
  prompt,
  timeoutMs,
  signal,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  const { provider, remoteModel } = resolveApiModel(model);
  const apiKey = env?.[provider.keyEnv];
  if (!apiKey)
    throw new ApiError(`${provider.label} needs ${provider.keyEnv} in the host's environment.`, {
      code: "missing_key",
    });
  const headers = provider.sessionHeader ? { [provider.sessionHeader]: `scope-${randomUUID()}` } : {};
  const reply = await chat({
    provider,
    apiKey,
    headers,
    body: {
      model: remoteModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    },
    fetchImpl,
    sleep,
    signal,
    deadline: now() + timeoutMs,
    now,
  });
  return { text: String(reply.choices?.[0]?.message?.content ?? ""), usage: reply.usage ?? null };
}

async function chat({ provider, apiKey, headers, body, fetchImpl, sleep, signal, deadline, now }) {
  for (let attempt = 0; ; attempt += 1) {
    const remaining = deadline - now();
    if (remaining <= 0)
      throw Object.assign(new Error("The run's deadline passed during a model call."), {
        code: "PROCESS_TIMEOUT",
      });
    try {
      return await chatOnce({
        provider,
        apiKey,
        headers,
        body,
        fetchImpl,
        signal,
        timeoutMs: Math.min(remaining, REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const retry = error instanceof ApiError ? error.retryable : true;
      if (!retry || attempt >= RETRY_DELAYS_MS.length) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(`${provider.label} could not be reached: ${error?.message ?? error}`, {
          code: "provider_unavailable",
        });
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function chatOnce({ provider, apiKey, headers = {}, body, fetchImpl, signal, timeoutMs }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(`${provider.endpoint}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await response.text();
  if (!response.ok) {
    const detail = text.slice(0, 300);
    if (response.status === 401 || response.status === 403)
      throw new ApiError(`${provider.label} refused the key (HTTP ${response.status}): ${detail}`, {
        status: response.status,
        code: "auth",
      });
    if (response.status === 402 || (response.status === 429 && /quota|limit|balance|credit/i.test(detail)))
      throw new ApiError(`${provider.label} usage limit (HTTP ${response.status}): ${detail}`, {
        status: response.status,
        code: "plan_limit",
      });
    throw new ApiError(`${provider.label} returned HTTP ${response.status}: ${detail}`, {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
      code: response.status >= 500 ? "provider_unavailable" : null,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(`${provider.label} returned a body that is not JSON.`, { retryable: true });
  }
}

function addUsage(totals, usage) {
  if (!usage) return;
  totals.inputTokens += Number(usage.prompt_tokens ?? 0);
  totals.outputTokens += Number(usage.completion_tokens ?? 0);
  totals.cachedTokens += Number(
    usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0,
  );
}

function bounded(text) {
  return text.length > MAX_TOOL_RESULT_CHARACTERS ? `${text.slice(0, MAX_TOOL_RESULT_CHARACTERS)}…` : text;
}

export function classifyApiLoopCall(call) {
  if (call.spawnError) {
    const timedOut = call.spawnError.code === "PROCESS_TIMEOUT";
    return {
      ok: false,
      timedOut,
      error: {
        code: timedOut ? "research_timeout" : "api_loop_failed",
        message: call.spawnError.message ?? String(call.spawnError),
      },
    };
  }
  if (call.sawCeiling)
    return {
      ok: false,
      planLimit: true,
      error: {
        code: API_LOOP_PLAN_LIMIT_ERROR_CODE,
        message: `The provider's usage limit stopped the run (${call.failure}). It produced nothing and must not be scored.`,
        retryable: false,
      },
    };
  if (call.failure)
    return {
      ok: false,
      error: {
        code: /could not be reached|HTTP 5\d\d/.test(call.failure)
          ? "provider_unavailable"
          : "api_loop_reported_error",
        message: call.failure,
      },
    };
  if (!call.sawTurnCompleted)
    return {
      ok: false,
      error: {
        code: API_LOOP_EMPTY_OUTPUT_ERROR_CODE,
        message: "The model finished without an answer. Retry.",
        retryable: true,
      },
    };
  return { ok: true, error: null };
}
