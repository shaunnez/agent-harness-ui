// One chat-completions call to an OpenAI-compatible provider, with the loop's retries: throttles
// waited out, the pacer told of each throttle and success, a stalled stream retried, and the
// provider's refusals sorted into auth, plan limit and outage. `chat-loop.mjs` owns the loop.

import { readChatReply, StreamError } from "./stream.mjs";

/** A call that does not stream: the most it may take. A streaming call has no such cap, only the
 *  run's deadline and `STREAM_IDLE_MS` of silence. */
const REQUEST_TIMEOUT_MS = 180_000;
/** Silence on a streaming call that means it is stuck: a thinking model sends tokens throughout. */
const STREAM_IDLE_MS = 90_000;
const RETRY_DELAYS_MS = [2_000, 5_000, 12_000];
/** A provider that throttles (Fireworks answers 429 "rate limit exceeded" when a minute's token
 *  budget is spent) is waited out rather than failed: the budget refills within the minute. */
const THROTTLE_DELAYS_MS = [5_000, 15_000, 30_000, 45_000, 60_000];

export class ApiError extends Error {
  constructor(message, { status = null, retryable = false, code = null, retryAfterMs = null } = {}) {
    super(message);
    Object.assign(this, { status, retryable, code, retryAfterMs });
  }
}

export async function chat({
  provider,
  apiKey,
  headers,
  body,
  fetchImpl,
  sleep,
  signal,
  deadline,
  now,
  pacer = null,
  onFirstChunk = () => {},
}) {
  for (let attempt = 0; ; attempt += 1) {
    const hold = pacer?.delayMs() ?? 0;
    if (hold > 0) await sleep(Math.min(hold, Math.max(0, deadline - now())));
    const remaining = deadline - now();
    if (remaining <= 0)
      throw Object.assign(new Error("The run's deadline passed during a model call."), {
        code: "PROCESS_TIMEOUT",
      });
    try {
      const reply = await chatOnce({
        provider,
        apiKey,
        headers,
        body,
        fetchImpl,
        signal,
        remainingMs: remaining,
        onFirstChunk,
      });
      pacer?.succeeded();
      return reply;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error?.code === "throttled") pacer?.throttled(error.retryAfterMs ?? null);
      const retry = error instanceof ApiError ? error.retryable : true;
      const delays = error?.code === "throttled" ? THROTTLE_DELAYS_MS : RETRY_DELAYS_MS;
      if (!retry || attempt >= delays.length) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(`${provider.label} could not be reached: ${error?.message ?? error}`, {
          code: "provider_unavailable",
        });
      }
      await sleep(Math.min(error?.retryAfterMs ?? delays[attempt], Math.max(0, deadline - now())));
    }
  }
}

/** One id for every call of a run, on each header the provider routes by. */
export function sessionHeaders(provider, id) {
  return Object.fromEntries((provider.sessionHeaders ?? []).map((name) => [name, id]));
}

/** `Retry-After` in seconds or as a date, in milliseconds, capped at a minute; null when absent. */
function retryAfterOf(response) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60_000) : null;
}

async function chatOnce({
  provider,
  apiKey,
  headers = {},
  body,
  fetchImpl,
  signal,
  remainingMs,
  onFirstChunk,
}) {
  const streaming = provider.stream !== false;
  // Streaming: no cap but the run's deadline and silence. Otherwise the old per-call cap.
  const timeout = AbortSignal.timeout(streaming ? remainingMs : Math.min(remainingMs, REQUEST_TIMEOUT_MS));
  const idle = idleTimer(streaming ? STREAM_IDLE_MS : null);
  try {
    const response = await fetchImpl(`${provider.endpoint}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...headers },
      // A provider's own request settings (DeepInfra's reasoning) go under the call's, so every call
      // on that provider, the loop's and the scoper's alike, is made the same way.
      body: JSON.stringify({
        ...provider.requestDefaults,
        ...body,
        ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
      }),
      signal: AbortSignal.any([timeout, idle.signal, ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw await responseError(provider, response);
    try {
      return await readChatReply(response, { onFirstChunk, idle });
    } catch (error) {
      if (idle.signal.aborted)
        throw new ApiError(`${provider.label} sent nothing for ${STREAM_IDLE_MS / 1000} seconds.`, {
          retryable: true,
        });
      if (error instanceof StreamError)
        throw new ApiError(`${provider.label}: ${error.message}`, { retryable: error.retryable });
      throw error;
    }
  } finally {
    idle.stop();
  }
}

/** Aborts after `ms` without a `reset()`; null never aborts. */
function idleTimer(ms) {
  const controller = new AbortController();
  let timer = null;
  const arm = () => {
    if (ms == null) return;
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error("The provider went silent.")), ms);
  };
  arm();
  return { signal: controller.signal, reset: arm, stop: () => clearTimeout(timer) };
}

async function responseError(provider, response) {
  const text = await response.text().catch(() => "");
  const detail = text.slice(0, 300);
  if (response.status === 401 || response.status === 403)
    return new ApiError(`${provider.label} refused the key (HTTP ${response.status}): ${detail}`, {
      status: response.status,
      code: "auth",
    });
  // A per-minute rate limit is a throttle, not a spent plan: wait and try again.
  if (response.status === 429 && /rate limit|too many requests|slow down/i.test(detail))
    return new ApiError(`${provider.label} is throttling (HTTP 429): ${detail}`, {
      status: 429,
      retryable: true,
      code: "throttled",
      retryAfterMs: retryAfterOf(response),
    });
  if (response.status === 402 || (response.status === 429 && /quota|limit|balance|credit/i.test(detail)))
    return new ApiError(`${provider.label} usage limit (HTTP ${response.status}): ${detail}`, {
      status: response.status,
      code: "plan_limit",
    });
  return new ApiError(`${provider.label} returned HTTP ${response.status}: ${detail}`, {
    status: response.status,
    retryable: response.status === 429 || response.status >= 500,
    code: response.status >= 500 ? "provider_unavailable" : null,
  });
}
