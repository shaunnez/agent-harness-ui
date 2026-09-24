// Parallel's Search API as a host-side `web_search` provider (https://docs.parallel.ai), for the
// API-loop runtime. The key stays in the host process; the model only sees results.
//
// Pinned for research after DeepSeek's OpenCode runs: across 369 searches Parallel returned
// results on 91 of 91 while Firecrawl came back empty on 43 of 91 (`29-EVAL-PREREGISTRATION.md`).

const DEFAULT_ENDPOINT = "https://api.parallel.ai/v1/search";
const DEFAULT_TIMEOUT_MS = 20_000;
/** "fast" (~700 ms) rather than "advanced" (~3 s): a run makes about six searches, and the
 *  model, not search, is where its time goes. */
const DEFAULT_MODE = "fast";

export class ParallelSearchProvider {
  #apiKey;
  #endpoint;
  #fetch;
  #timeoutMs;
  #mode;

  constructor({
    apiKey,
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    mode = DEFAULT_MODE,
  }) {
    if (!apiKey) throw new Error("Parallel search requires PARALLEL_API_KEY.");
    this.#apiKey = apiKey;
    this.#endpoint = endpoint;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
    this.#mode = mode;
  }

  async search(query, { maxResults = 5, signal: callerSignal } = {}) {
    let response;
    try {
      const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "x-api-key": this.#apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ objective: query, search_queries: [query], mode: this.#mode }),
        signal: callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal,
      });
    } catch (error) {
      throw new Error(`Parallel search failed: ${error?.message ?? String(error)}`, { cause: error });
    }
    const text = await response.text();
    if (!response.ok)
      throw new Error(`Parallel search returned HTTP ${response.status}: ${text.slice(0, 300)}`);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error("Parallel search returned invalid JSON.", { cause: error });
    }
    return {
      results: (payload.results ?? []).slice(0, maxResults).map((result) => ({
        title: String(result.title ?? "Untitled result").slice(0, 500),
        url: String(result.url ?? ""),
        snippet: (Array.isArray(result.excerpts) ? result.excerpts.join(" … ") : "").slice(0, 2_000),
        ...(result.publish_date ? { publishedAt: String(result.publish_date) } : {}),
      })),
      metadata: {
        provider: "parallel",
        ...(payload.search_id ? { requestId: String(payload.search_id) } : {}),
      },
    };
  }
}
