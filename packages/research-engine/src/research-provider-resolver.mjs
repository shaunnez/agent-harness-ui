import { FirecrawlCaptureProvider } from "./firecrawl-capture-provider.mjs";
import { FirecrawlSearchProvider } from "./firecrawl-search-provider.mjs";
import { FallbackSearchProvider } from "./fallback-search-provider.mjs";
import { ProviderCreditLedger } from "./provider-credit-ledger.mjs";
import { parseResearchProviderConfig } from "./research-provider-contracts.mjs";
import { SerperSearchProvider } from "./serper-search-provider.mjs";
import { TavilySearchProvider } from "./tavily-search-provider.mjs";

export function resolveResearchProviders(env = process.env, options = {}) {
  const config = options.config ?? parseResearchProviderConfig(env);
  const firecrawlLedger = new ProviderCreditLedger({
    provider: "firecrawl",
    ceiling: config.maxFirecrawlCredits,
  });
  const serperLedger = new ProviderCreditLedger({ provider: "serper", ceiling: config.maxSerperCalls });
  let searchProvider;
  if (config.searchProvider === "tavily") {
    searchProvider = new TavilySearchProvider({
      apiKey: env.RESEARCH_SEARCH_API_KEY ?? env.TAVILY_API_KEY,
      ...(env.RESEARCH_SEARCH_BASE_URL ? { endpoint: env.RESEARCH_SEARCH_BASE_URL } : {}),
      ...options.tavily,
    });
  } else {
    const primary = new FirecrawlSearchProvider({
      apiKey: env.FIRECRAWL_API_KEY,
      ledger: firecrawlLedger,
      ...options.firecrawlSearch,
    });
    if (config.searchFallback === "serper") {
      const fallback = new SerperSearchProvider({
        apiKey: env.SERPER_API_KEY,
        ledger: serperLedger,
        ...options.serper,
      });
      searchProvider = new FallbackSearchProvider({ primary, fallback });
    } else searchProvider = primary;
  }
  const captureProvider =
    config.captureProvider === "firecrawl"
      ? new FirecrawlCaptureProvider({
          apiKey: env.FIRECRAWL_API_KEY,
          ledger: firecrawlLedger,
          ...options.firecrawlCapture,
        })
      : null;
  return { config, searchProvider, captureProvider, firecrawlLedger, serperLedger };
}

export function resolveSearchProvider(env = process.env, options = {}) {
  return resolveResearchProviders(env, options).searchProvider;
}
