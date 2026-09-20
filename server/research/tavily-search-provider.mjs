const DEFAULT_ENDPOINT = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 15_000;

export class TavilySearchProvider {
  #apiKey;
  #endpoint;
  #fetch;
  #timeoutMs;

  constructor({
    apiKey,
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    if (!apiKey) throw new Error("Tavily search requires TAVILY_API_KEY or RESEARCH_SEARCH_API_KEY.");
    this.#apiKey = apiKey;
    this.#endpoint = endpoint;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async search(query, { maxResults = 5, signal: callerSignal } = {}) {
    let response;
    try {
      const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: maxResults,
          topic: "general",
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_usage: true,
          safe_search: true,
        }),
        signal: callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal,
      });
    } catch (error) {
      throw new Error(`Tavily search failed: ${error?.message ?? String(error)}`, { cause: error });
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Tavily search returned HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error("Tavily search returned invalid JSON.", { cause: error });
    }
    return {
      results: (payload.results ?? []).slice(0, maxResults).map((result) => ({
        title: String(result.title ?? "Untitled result").slice(0, 500),
        url: String(result.url ?? ""),
        snippet: String(result.content ?? "").slice(0, 2_000),
        ...(result.published_date ? { publishedAt: String(result.published_date) } : {}),
      })),
      metadata: {
        provider: "tavily",
        ...(payload.request_id ? { requestId: String(payload.request_id) } : {}),
        ...(payload.response_time ? { responseTimeSeconds: Number(payload.response_time) } : {}),
        ...(payload.usage?.credits != null ? { credits: Number(payload.usage.credits) } : {}),
      },
    };
  }
}

export function resolveSearchProvider(env = process.env) {
  const provider = env.RESEARCH_SEARCH_PROVIDER ?? "tavily";
  if (provider !== "tavily") throw new Error(`Unsupported research search provider "${provider}".`);
  return new TavilySearchProvider({
    apiKey: env.RESEARCH_SEARCH_API_KEY ?? env.TAVILY_API_KEY,
    endpoint: env.RESEARCH_SEARCH_BASE_URL ?? DEFAULT_ENDPOINT,
  });
}
