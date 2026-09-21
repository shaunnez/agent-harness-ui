const DEFAULT_TIMEOUT_MS = 20_000;

const MARKET_SETTINGS = Object.freeze({
  NZ: {
    countryCode: "NZ",
    countryName: "new zealand",
    location: "New Zealand",
  },
  AU: {
    countryCode: "AU",
    countryName: "australia",
    location: "Australia",
  },
  US: {
    countryCode: "US",
    countryName: "united states",
    location: "United States",
  },
});

function marketSettings(market) {
  const settings = MARKET_SETTINGS[market];
  if (!settings) throw new Error(`Unsupported benchmark market "${market}".`);
  return settings;
}

function cleanResult(result, rank) {
  return {
    rank,
    title: String(result.title ?? "Untitled result").slice(0, 500),
    url: String(result.url ?? ""),
    snippet: String(result.snippet ?? "").slice(0, 2_000),
    ...(result.publishedAt ? { publishedAt: String(result.publishedAt) } : {}),
    ...(result.category ? { category: String(result.category) } : {}),
    ...(Number.isFinite(Number(result.score)) ? { score: Number(result.score) } : {}),
  };
}

function boundedResults(results, maxResults) {
  return results.slice(0, maxResults).map((result, index) => cleanResult(result, index + 1));
}

async function postJson({ fetchImpl, endpoint, headers, body, timeoutMs, callerSignal }) {
  const startedAt = performance.now();
  let response;
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal,
    });
  } catch (error) {
    throw new Error(`Request failed: ${error?.message ?? String(error)}`, { cause: error });
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error("Provider returned invalid JSON.", { cause: error });
  }
  return { durationMs, payload, status: response.status };
}

class BenchmarkSearchProvider {
  constructor({ name, apiKey, endpoint, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.name = name;
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request({ body, headers = {}, signal }) {
    return postJson({
      fetchImpl: this.fetchImpl,
      endpoint: this.endpoint,
      headers,
      body,
      timeoutMs: this.timeoutMs,
      callerSignal: signal,
    });
  }
}

export class SerperBenchmarkProvider extends BenchmarkSearchProvider {
  constructor({ apiKey, endpoint = "https://google.serper.dev/search", fetchImpl, timeoutMs }) {
    if (!apiKey) throw new Error("Serper benchmark requires SERPER_API_KEY.");
    super({ name: "serper", apiKey, endpoint, fetchImpl, timeoutMs });
  }

  async search({ query, market, maxResults, signal }) {
    const settings = marketSettings(market);
    const request = {
      q: query,
      gl: settings.countryCode.toLowerCase(),
      hl: "en",
      num: maxResults,
      autocorrect: true,
    };
    const response = await this.request({
      body: request,
      headers: { "X-API-KEY": this.apiKey },
      signal,
    });
    return {
      provider: this.name,
      request,
      results: boundedResults(
        (response.payload.organic ?? []).map((result) => ({
          title: result.title,
          url: result.link,
          snippet: result.snippet,
          publishedAt: result.date,
        })),
        maxResults,
      ),
      metadata: { durationMs: response.durationMs, httpStatus: response.status, estimatedCredits: 1 },
      rawResponse: response.payload,
    };
  }
}

export class TavilyBenchmarkProvider extends BenchmarkSearchProvider {
  constructor({ apiKey, endpoint = "https://api.tavily.com/search", fetchImpl, timeoutMs }) {
    if (!apiKey) throw new Error("Tavily benchmark requires TAVILY_API_KEY.");
    super({ name: "tavily", apiKey, endpoint, fetchImpl, timeoutMs });
  }

  async search({ query, market, maxResults, signal }) {
    const settings = marketSettings(market);
    const request = {
      query,
      search_depth: "basic",
      max_results: maxResults,
      topic: "general",
      country: settings.countryName,
      language: "en",
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_usage: true,
      safe_search: true,
    };
    const response = await this.request({
      body: request,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });
    return {
      provider: this.name,
      request,
      results: boundedResults(
        (response.payload.results ?? []).map((result) => ({
          title: result.title,
          url: result.url,
          snippet: result.content,
          publishedAt: result.published_date,
          score: result.score,
        })),
        maxResults,
      ),
      metadata: {
        durationMs: response.durationMs,
        httpStatus: response.status,
        ...(response.payload.request_id ? { requestId: String(response.payload.request_id) } : {}),
        ...(response.payload.usage?.credits != null
          ? { estimatedCredits: Number(response.payload.usage.credits) }
          : { estimatedCredits: 1 }),
      },
      rawResponse: response.payload,
    };
  }
}

export class ExaBenchmarkProvider extends BenchmarkSearchProvider {
  constructor({ apiKey, endpoint = "https://api.exa.ai/search", fetchImpl, timeoutMs }) {
    if (!apiKey) throw new Error("Exa benchmark requires EXA_API_KEY.");
    super({ name: "exa", apiKey, endpoint, fetchImpl, timeoutMs });
  }

  async search({ query, market, maxResults, signal }) {
    const settings = marketSettings(market);
    const request = {
      query,
      numResults: maxResults,
      type: "auto",
      userLocation: settings.countryCode,
      moderation: true,
    };
    const response = await this.request({
      body: request,
      headers: { "x-api-key": this.apiKey },
      signal,
    });
    return {
      provider: this.name,
      request,
      results: boundedResults(
        (response.payload.results ?? []).map((result) => ({
          title: result.title,
          url: result.url,
          snippet: result.text ?? result.summary ?? "",
          publishedAt: result.publishedDate,
          score: result.score,
        })),
        maxResults,
      ),
      metadata: {
        durationMs: response.durationMs,
        httpStatus: response.status,
        estimatedCostUsd: 0.007,
      },
      rawResponse: response.payload,
    };
  }
}

export class FirecrawlBenchmarkProvider extends BenchmarkSearchProvider {
  constructor({ apiKey, endpoint = "https://api.firecrawl.dev/v2/search", fetchImpl, timeoutMs } = {}) {
    super({ name: "firecrawl", apiKey, endpoint, fetchImpl, timeoutMs });
  }

  async search({ query, market, maxResults, signal }) {
    const settings = marketSettings(market);
    const request = {
      query,
      limit: maxResults,
      sources: ["web"],
      location: settings.location,
    };
    const response = await this.request({
      body: request,
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      signal,
    });
    const data = response.payload.data;
    const webResults = Array.isArray(data) ? data : (data?.web ?? response.payload.web ?? []);
    return {
      provider: this.name,
      request,
      results: boundedResults(
        webResults.map((result) => ({
          title: result.title,
          url: result.url,
          snippet: result.description,
          category: result.category,
        })),
        maxResults,
      ),
      metadata: {
        durationMs: response.durationMs,
        httpStatus: response.status,
        estimatedCredits: 2 * Math.ceil(maxResults / 10),
        keyless: !this.apiKey,
      },
      rawResponse: response.payload,
    };
  }
}

export function resolveBenchmarkProviders(env = process.env, options = {}) {
  const providers = new Map();
  const skipped = [];
  const shared = { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs };

  if (env.SERPER_API_KEY) {
    providers.set(
      "serper",
      new SerperBenchmarkProvider({
        ...shared,
        apiKey: env.SERPER_API_KEY,
        endpoint: env.SERPER_SEARCH_BASE_URL,
      }),
    );
  } else {
    skipped.push({ provider: "serper", reason: "SERPER_API_KEY is not configured" });
  }

  if (env.TAVILY_API_KEY) {
    providers.set(
      "tavily",
      new TavilyBenchmarkProvider({
        ...shared,
        apiKey: env.TAVILY_API_KEY,
        endpoint: env.TAVILY_SEARCH_BASE_URL,
      }),
    );
  } else {
    skipped.push({ provider: "tavily", reason: "TAVILY_API_KEY is not configured" });
  }

  if (env.EXA_API_KEY) {
    providers.set(
      "exa",
      new ExaBenchmarkProvider({
        ...shared,
        apiKey: env.EXA_API_KEY,
        endpoint: env.EXA_SEARCH_BASE_URL,
      }),
    );
  } else {
    skipped.push({ provider: "exa", reason: "EXA_API_KEY is not configured" });
  }

  providers.set(
    "firecrawl",
    new FirecrawlBenchmarkProvider({
      ...shared,
      apiKey: env.FIRECRAWL_API_KEY,
      endpoint: env.FIRECRAWL_SEARCH_BASE_URL,
    }),
  );
  return { providers, skipped };
}
