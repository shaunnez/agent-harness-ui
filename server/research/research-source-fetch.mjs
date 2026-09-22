import http from "node:http";
import https from "node:https";
import { ResearchProviderError, providerFailure } from "./research-provider-errors.mjs";
import { validatePublicSourceUrl } from "./research-source-policy.mjs";

export const DEFAULT_SOURCE_BYTE_LIMIT = 1_000_000;
export const DEFAULT_SOURCE_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const ALLOWED_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);

export async function fetchValidatedSource(requestedUrl, options = {}) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(new DOMException("Source timeout", "TimeoutError")),
    options.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS,
  );
  const timeoutSignal = timeoutController.signal;
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await fetchValidatedSourceWithSignal(requestedUrl, options, signal, timeoutSignal);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchValidatedSourceWithSignal(requestedUrl, options, signal, timeoutSignal) {
  let current = new URL(requestedUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let validated;
    try {
      validated = await validatePublicSourceUrl(current, {
        lookup: options.lookup,
        signal,
        allowPrivateNetwork: options.allowPrivateNetwork,
      });
    } catch (error) {
      if (options.signal?.aborted) throw transportError("cancelled");
      if (timeoutSignal.aborted) throw transportError("timeout");
      throw error;
    }
    const response = options.fetchImpl
      ? await fetchWithInjectedTransport(validated.url, { ...options, signal })
      : await requestPinned(validated, { signal });
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      response.destroy?.();
      if (redirects === MAX_REDIRECTS)
        throw toolError("too_many_redirects", "Source fetch exceeded the redirect limit.");
      current = new URL(response.headers.location, current);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      response.destroy?.();
      throw toolError("source_http_error", `Source fetch returned HTTP ${response.status}.`);
    }
    const rawType = response.headers["content-type"];
    if (!rawType || rawType.includes(",")) {
      response.destroy?.();
      throw toolError("unsupported_media_type", "Source media type was missing or ambiguous.");
    }
    const mediaType = rawType.split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
      response.destroy?.();
      throw toolError("unsupported_media_type", `Unsupported source media type "${mediaType}".`);
    }
    const declared = Number(response.headers["content-length"] ?? 0);
    const maxBytes = options.maxResponseBytes ?? DEFAULT_SOURCE_BYTE_LIMIT;
    if (Number.isFinite(declared) && declared > maxBytes) {
      response.destroy?.();
      throw toolError("source_too_large", `Source declares more than the ${maxBytes}-byte limit.`);
    }
    const body = await response.readBody(maxBytes, signal);
    if (Buffer.from(body).subarray(0, 5).toString("latin1") === "%PDF-")
      throw toolError(
        "unsupported_media_type",
        "A PDF response cannot use the local HTML/text capture path.",
      );
    return { url: current.toString(), mediaType, body: Buffer.from(body).toString("utf8") };
  }
  throw toolError("too_many_redirects", "Source fetch exceeded the redirect limit.");
}

async function requestPinned({ url, addresses }, { signal }) {
  const selected = addresses[0];
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: "GET",
      agent: false,
      family: selected.family,
      autoSelectFamily: false,
      headers: { "User-Agent": "EversorResearch/1.0 (+source-retention)" },
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      },
    });
    const onAbort = () =>
      request.destroy(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    request.once("response", (response) => {
      signal.removeEventListener("abort", onAbort);
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        destroy: () => response.destroy(),
        readBody: (limit, readSignal) => readNodeBody(response, limit, readSignal),
      });
    });
    request.once("error", (_error) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted)
        reject(transportError(signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled"));
      else
        reject(
          providerFailure({
            provider: "local",
            operation: "capture",
            category: "transient",
            fallbackEligible: false,
          }),
        );
    });
    request.end();
  });
}

async function fetchWithInjectedTransport(url, { fetchImpl, signal }) {
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "EversorResearch/1.0 (+source-retention)" },
    });
  } catch (_error) {
    if (signal.aborted) {
      const category = signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled";
      throw transportError(category);
    }
    throw providerFailure({ provider: "local", operation: "capture", category: "transient" });
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    destroy: () => response.body?.cancel?.().catch(() => undefined),
    readBody: (limit) => readFetchBody(response, limit),
  };
}

async function readFetchBody(response, limit) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw toolError("source_too_large", `Source exceeded the ${limit}-byte response limit.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function readNodeBody(stream, limit, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const onAbort = () =>
      stream.destroy(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    stream.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit)
        stream.destroy(toolError("source_too_large", `Source exceeded the ${limit}-byte response limit.`));
      else chunks.push(chunk);
    });
    stream.once("end", () => {
      signal.removeEventListener("abort", onAbort);
      resolve(Buffer.concat(chunks));
    });
    stream.once("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      if (error instanceof ResearchProviderError) reject(error);
      else if (signal.aborted)
        reject(transportError(signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled"));
      else reject(providerFailure({ provider: "local", operation: "capture", category: "transient" }));
    });
  });
}

function toolError(code, message) {
  const error = new ResearchProviderError({
    provider: "local",
    operation: "capture",
    category:
      code === "source_http_error"
        ? "source_http_error"
        : code === "unsupported_media_type"
          ? "unsupported_media_type"
          : "permanent",
    message,
  });
  error.code = code;
  return error;
}

function transportError(category) {
  const error = providerFailure({ provider: "local", operation: "capture", category });
  error.code = category === "timeout" ? "source_timeout" : "research_cancelled";
  return error;
}
