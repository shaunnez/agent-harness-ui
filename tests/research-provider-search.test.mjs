import assert from "node:assert/strict";
import test from "node:test";
import { FallbackSearchProvider } from "../server/research/fallback-search-provider.mjs";
import { FirecrawlSearchProvider } from "../server/research/firecrawl-search-provider.mjs";
import { ProviderCreditLedger } from "../server/research/provider-credit-ledger.mjs";
import { ResearchProviderError } from "../server/research/research-provider-errors.mjs";
import { SerperSearchProvider } from "../server/research/serper-search-provider.mjs";

test("Firecrawl and Serper map markets without requesting provider-generated content", async () => {
  let firecrawlRequest;
  const firecrawl = new FirecrawlSearchProvider({
    apiKey: "fc-sentinel",
    ledger: new ProviderCreditLedger({ provider: "firecrawl", ceiling: 10 }),
    fetchImpl: async (_url, options) => {
      firecrawlRequest = { headers: options.headers, body: JSON.parse(options.body) };
      return jsonResponse({
        success: true,
        data: { web: [{ title: "One", url: "https://example.com/a", description: "A" }] },
        creditsUsed: 2,
      });
    },
  });
  const result = await firecrawl.search("products", { market: "NZ" });
  assert.deepEqual(firecrawlRequest.body, {
    query: "products",
    limit: 5,
    sources: ["web"],
    location: "New Zealand",
  });
  assert.equal(firecrawlRequest.headers.Authorization, "Bearer fc-sentinel");
  assert.equal(result.results.length, 1);

  let serperRequest;
  const serper = new SerperSearchProvider({
    apiKey: "serper-sentinel",
    ledger: new ProviderCreditLedger({ provider: "serper", ceiling: 4 }),
    fetchImpl: async (_url, options) => {
      serperRequest = { headers: options.headers, body: JSON.parse(options.body) };
      return jsonResponse({ organic: [] });
    },
  });
  await serper.search("global", { market: "GLOBAL" });
  assert.deepEqual(serperRequest.body, { q: "global", num: 5, hl: "en" });
  assert.equal(serperRequest.headers["X-API-KEY"], "serper-sentinel");
});

test("eligible failure and valid empty results fall back exactly once", async () => {
  for (const primary of [
    {
      search: async () => {
        throw providerError("timeout", true);
      },
    },
    { search: async () => ({ results: [], metadata: { attempts: [{ provider: "firecrawl" }] } }) },
  ]) {
    let fallbacks = 0;
    const provider = new FallbackSearchProvider({
      primary,
      fallback: {
        async search() {
          fallbacks += 1;
          return {
            results: [{ url: "https://example.com", title: "ok", snippet: "" }],
            metadata: { attempts: [{ provider: "serper" }] },
          };
        },
      },
    });
    const result = await provider.search("q");
    assert.equal(fallbacks, 1);
    assert.equal(result.metadata.selectedProvider, "serper");
  }
});

test("the HTTP fallback table allows quota, rate-limit and transient failures only", async () => {
  for (const [status, eligible] of [
    [400, false],
    [401, false],
    [403, false],
    [402, true],
    [429, true],
    [503, true],
  ]) {
    let fallbacks = 0;
    const primary = new FirecrawlSearchProvider({
      apiKey: "fc-sentinel",
      ledger: new ProviderCreditLedger({ provider: "firecrawl", ceiling: 10 }),
      fetchImpl: async () => jsonResponse({ error: "safe" }, status),
    });
    const provider = new FallbackSearchProvider({
      primary,
      fallback: {
        async search() {
          fallbacks += 1;
          return { results: [], metadata: { attempts: [] } };
        },
      },
    });
    if (eligible) await provider.search("q");
    else await assert.rejects(provider.search("q"));
    assert.equal(fallbacks, eligible ? 1 : 0, `HTTP ${status}`);
  }
});

test("provider timeout may fall back, but cancellation and run deadline never do", async () => {
  for (const scenario of [
    { label: "provider timeout", providerTimeoutMs: 10, fallback: true },
    { label: "cancellation", abortReason: new DOMException("cancelled", "AbortError"), fallback: false },
    {
      label: "run deadline",
      abortReason: new DOMException("deadline", "TimeoutError"),
      fallback: false,
    },
  ]) {
    let fallbacks = 0;
    const controller = new AbortController();
    const primary = new FirecrawlSearchProvider({
      apiKey: "fc-sentinel",
      ledger: new ProviderCreditLedger({ provider: "firecrawl", ceiling: 10 }),
      timeoutMs: scenario.providerTimeoutMs ?? 1_000,
      fetchImpl: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });
    const provider = new FallbackSearchProvider({
      primary,
      fallback: {
        async search() {
          fallbacks += 1;
          return { results: [], metadata: { attempts: [] } };
        },
      },
    });
    const pending = provider.search("q", { signal: controller.signal });
    if (scenario.abortReason) controller.abort(scenario.abortReason);
    if (scenario.fallback) await pending;
    else await assert.rejects(pending);
    assert.equal(fallbacks, scenario.fallback ? 1 : 0, scenario.label);
  }
});

test("authentication, invalid responses, cancellation, deadline, policy and local ceilings never fall back", async () => {
  for (const category of [
    "authentication",
    "invalid_response",
    "cancelled",
    "deadline_exceeded",
    "policy_rejected",
    "budget_exhausted",
  ]) {
    let fallbacks = 0;
    const provider = new FallbackSearchProvider({
      primary: {
        search: async () => {
          throw providerError(category, false);
        },
      },
      fallback: {
        search: async () => {
          fallbacks += 1;
          return { results: [], metadata: {} };
        },
      },
    });
    await assert.rejects(provider.search("q"), (error) => error.category === category);
    assert.equal(fallbacks, 0, category);
  }
});

test("invalid search response structure is not mistaken for empty results or leaked", async () => {
  const provider = new FirecrawlSearchProvider({
    apiKey: "credential-must-not-leak",
    ledger: new ProviderCreditLedger({ provider: "firecrawl", ceiling: 10 }),
    fetchImpl: async () => jsonResponse({ success: true, data: { results: [] } }),
  });
  await assert.rejects(
    provider.search("q"),
    (error) => error.category === "invalid_response" && !error.message.includes("credential-must-not-leak"),
  );
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function providerError(category, fallbackEligible) {
  return new ResearchProviderError({
    provider: "firecrawl",
    operation: "search",
    category,
    fallbackEligible,
    message: `safe ${category}`,
  });
}
