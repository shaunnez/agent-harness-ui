import {
  classifyProviderStatus,
  providerFailure,
  ResearchProviderError,
} from "./research-provider-errors.mjs";

export async function postProviderJson(options) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(new DOMException("Provider timeout", "TimeoutError")),
    options.timeoutMs,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  try {
    return await postProviderJsonWithSignal(options, signal, timeoutController.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postProviderJsonWithSignal(options, signal, timeoutSignal) {
  const {
    provider,
    operation,
    endpoint,
    headers,
    body,
    fetchImpl = globalThis.fetch,
    maxBytes,
    signal: callerSignal,
    ledger,
    reservationId,
  } = options;
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (_error) {
    const attempt = ledger.settle(reservationId, { certainty: "unknown_after_dispatch" });
    throw transportFailure({ provider, operation, callerSignal, timeoutSignal, attempt });
  }
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel?.().catch(() => undefined);
    const attempt = ledger.settle(reservationId, { certainty: "unknown_after_dispatch" });
    throw providerFailure({
      provider,
      operation,
      category: "invalid_response",
      status: response.status,
      attempt,
    });
  }
  let text;
  try {
    text = await readBoundedResponse(response, maxBytes);
  } catch (error) {
    const attempt = ledger.settle(reservationId, { certainty: "unknown_after_dispatch" });
    if (callerSignal?.aborted || timeoutSignal.aborted)
      throw transportFailure({ provider, operation, callerSignal, timeoutSignal, attempt });
    if (error instanceof ResearchProviderError) {
      error.attempt = attempt;
      throw error;
    }
    throw providerFailure({ provider, operation, category: "invalid_response", attempt });
  }
  if (!response.ok) {
    const attempt = ledger.settle(reservationId, { certainty: "unknown_after_dispatch" });
    throw classifyProviderStatus(provider, operation, response.status, attempt);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const attempt = ledger.settle(reservationId, { certainty: "unknown_after_dispatch" });
    throw providerFailure({ provider, operation, category: "invalid_response", attempt });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const attempt = ledger.settle(reservationId, { certainty: "unknown_after_dispatch" });
    throw providerFailure({ provider, operation, category: "invalid_response", attempt });
  }
  const reportedCharge = finiteNonnegative(
    payload.creditsUsed ?? payload.credits_used ?? payload.usage?.credits,
  );
  const attempt = ledger.settle(reservationId, {
    reportedCharge,
    estimate: reportedCharge,
    certainty: reportedCharge == null ? "upper_bound" : "reported",
  });
  if (attempt.contractViolation)
    throw providerFailure({ provider, operation, category: "budget_exhausted", attempt });
  return { payload, response, attempt: { ...attempt, elapsedMs: Date.now() - startedAt } };
}

async function readBoundedResponse(response, maximum) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) {
    await response.body?.cancel?.().catch(() => undefined);
    throw providerFailure({
      provider: "provider",
      operation: "response",
      category: "invalid_response",
    });
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximum) {
      await reader.cancel().catch(() => undefined);
      throw providerFailure({
        provider: "provider",
        operation: "response",
        category: "invalid_response",
      });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function transportFailure({ provider, operation, callerSignal, timeoutSignal, attempt }) {
  if (callerSignal?.aborted)
    return providerFailure({
      provider,
      operation,
      category: callerSignal.reason?.name === "TimeoutError" ? "deadline_exceeded" : "cancelled",
      attempt,
    });
  if (timeoutSignal.aborted)
    return providerFailure({
      provider,
      operation,
      category: "timeout",
      fallbackEligible: true,
      attempt,
    });
  return providerFailure({
    provider,
    operation,
    category: "transient",
    fallbackEligible: true,
    attempt,
  });
}

function finiteNonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
