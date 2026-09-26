import { postProviderJson } from "./research-provider-http.mjs";
import { providerFailure } from "./research-provider-errors.mjs";
import { validateMarket } from "./research-provider-contracts.mjs";

const ENDPOINT = "https://api.firecrawl.dev/v2/search";
const LOCATIONS = Object.freeze({ NZ: "New Zealand", AU: "Australia", US: "United States" });

export class FirecrawlSearchProvider {
  constructor({
    apiKey,
    ledger,
    fetchImpl = globalThis.fetch,
    timeoutMs = 20_000,
    endpoint = ENDPOINT,
    maxResponseBytes = 1_048_576,
  }) {
    if (!apiKey) throw new Error("Firecrawl search requires FIRECRAWL_API_KEY.");
    if (!ledger) throw new Error("Firecrawl search requires a per-run credit ledger.");
    Object.assign(this, { apiKey, ledger, fetchImpl, timeoutMs, endpoint, maxResponseBytes });
  }

  async search(query, { market = "NZ", maxResults = 5, signal, remainingMs } = {}) {
    const selectedMarket = validateMarket(market);
    const reservationId = this.ledger.reserve("search", 2);
    const request = {
      query,
      limit: Math.min(5, maxResults),
      sources: ["web"],
      ...(LOCATIONS[selectedMarket] ? { location: LOCATIONS[selectedMarket] } : {}),
    };
    const { payload, attempt } = await postProviderJson({
      provider: "firecrawl",
      operation: "search",
      endpoint: this.endpoint,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: request,
      fetchImpl: this.fetchImpl,
      timeoutMs: boundedTimeout(this.timeoutMs, remainingMs),
      maxBytes: this.maxResponseBytes,
      signal,
      ledger: this.ledger,
      reservationId,
    });
    if (payload.success === false)
      throw providerFailure({
        provider: "firecrawl",
        operation: "search",
        category: "invalid_response",
        attempt,
      });
    const web = payload.data?.web;
    if (!Array.isArray(web))
      throw providerFailure({
        provider: "firecrawl",
        operation: "search",
        category: "invalid_response",
        attempt,
      });
    const results = normalizeResults(web, (item) => ({
      title: bounded(item?.title, 500, "Untitled result"),
      url: bounded(item?.url, 4_000),
      snippet: bounded(item?.description ?? item?.snippet, 2_000),
    }));
    return {
      results,
      metadata: {
        provider: "firecrawl",
        requestedMarket: selectedMarket,
        effectiveMarket: selectedMarket,
        attempts: [attempt],
        fallbackReason: null,
        resultCount: results.length,
      },
    };
  }
}

function boundedTimeout(configured, remaining) {
  return Number.isFinite(remaining) ? Math.max(1, Math.min(configured, remaining)) : configured;
}

function bounded(value, limit, fallback = "") {
  return String(value ?? fallback).slice(0, limit);
}
function normalizeResults(items, map) {
  const results = [];
  const seen = new Set();
  for (const item of items) {
    const result = map(item);
    let url;
    try {
      url = new URL(result.url);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) continue;
    url.hash = "";
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ ...result, url: key });
    if (results.length === 5) break;
  }
  return results;
}
