import { postProviderJson } from "./research-provider-http.mjs";
import { providerFailure } from "./research-provider-errors.mjs";
import { validateMarket } from "./research-provider-contracts.mjs";

const ENDPOINT = "https://google.serper.dev/search";
const MARKET = Object.freeze({
  NZ: { gl: "nz", hl: "en" },
  AU: { gl: "au", hl: "en" },
  US: { gl: "us", hl: "en" },
  GLOBAL: { hl: "en" },
});

export class SerperSearchProvider {
  constructor({
    apiKey,
    ledger,
    fetchImpl = globalThis.fetch,
    timeoutMs = 20_000,
    endpoint = ENDPOINT,
    maxResponseBytes = 1_048_576,
  }) {
    if (!apiKey) throw new Error("Serper fallback requires SERPER_API_KEY.");
    if (!ledger) throw new Error("Serper search requires a per-run call ledger.");
    Object.assign(this, { apiKey, ledger, fetchImpl, timeoutMs, endpoint, maxResponseBytes });
  }

  async search(query, { market = "NZ", maxResults = 5, signal, remainingMs } = {}) {
    const selectedMarket = validateMarket(market);
    const reservationId = this.ledger.reserve("search", 1);
    const request = { q: query, num: Math.min(5, maxResults), ...MARKET[selectedMarket] };
    const { payload, attempt } = await postProviderJson({
      provider: "serper",
      operation: "search",
      endpoint: this.endpoint,
      headers: { "X-API-KEY": this.apiKey },
      body: request,
      fetchImpl: this.fetchImpl,
      timeoutMs: boundedTimeout(this.timeoutMs, remainingMs),
      maxBytes: this.maxResponseBytes,
      signal,
      ledger: this.ledger,
      reservationId,
    });
    if (!Array.isArray(payload.organic))
      throw providerFailure({
        provider: "serper",
        operation: "search",
        category: "invalid_response",
        attempt,
      });
    const results = [];
    const seen = new Set();
    for (const item of payload.organic) {
      let url;
      try {
        url = new URL(String(item?.link ?? ""));
      } catch {
        continue;
      }
      if (!["http:", "https:"].includes(url.protocol)) continue;
      url.hash = "";
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      results.push({
        title: bounded(item?.title, 500, "Untitled result"),
        url: url.href,
        snippet: bounded(item?.snippet, 2_000),
      });
      if (results.length === 5) break;
    }
    return {
      results,
      metadata: {
        provider: "serper",
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
