const MARKETS = Object.freeze(["NZ", "AU", "US", "GLOBAL"]);

export const DEFAULT_RESEARCH_PROVIDER_CONFIG = Object.freeze({
  searchProvider: "tavily",
  searchFallback: "none",
  captureProvider: "local",
  pdfProvider: "disabled",
  defaultMarket: "NZ",
  maxPdfPages: 30,
  maxFirecrawlCredits: 100,
  maxSerperCalls: 4,
});

export function parseResearchProviderConfig(env = {}) {
  const config = {
    searchProvider: choice(
      env.RESEARCH_SEARCH_PROVIDER,
      "tavily",
      ["tavily", "firecrawl"],
      "RESEARCH_SEARCH_PROVIDER",
    ),
    searchFallback: choice(
      env.RESEARCH_SEARCH_FALLBACK,
      "none",
      ["none", "serper"],
      "RESEARCH_SEARCH_FALLBACK",
    ),
    captureProvider: choice(
      env.RESEARCH_CAPTURE_PROVIDER,
      "local",
      ["local", "firecrawl"],
      "RESEARCH_CAPTURE_PROVIDER",
    ),
    pdfProvider: choice(
      env.RESEARCH_PDF_PROVIDER,
      "disabled",
      ["disabled", "firecrawl"],
      "RESEARCH_PDF_PROVIDER",
    ),
    defaultMarket: marketChoice(env.RESEARCH_DEFAULT_MARKET),
    maxPdfPages: boundedInteger(
      env.RESEARCH_FIRECRAWL_MAX_PDF_PAGES,
      30,
      1,
      30,
      "RESEARCH_FIRECRAWL_MAX_PDF_PAGES",
    ),
    maxFirecrawlCredits: boundedInteger(
      env.RESEARCH_FIRECRAWL_MAX_CREDITS_PER_RUN,
      100,
      1,
      100,
      "RESEARCH_FIRECRAWL_MAX_CREDITS_PER_RUN",
    ),
    maxSerperCalls: boundedInteger(
      env.RESEARCH_SERPER_MAX_CALLS_PER_RUN,
      4,
      1,
      4,
      "RESEARCH_SERPER_MAX_CALLS_PER_RUN",
    ),
  };
  if (config.searchFallback === "serper" && config.searchProvider !== "firecrawl")
    throw new Error("RESEARCH_SEARCH_FALLBACK=serper requires RESEARCH_SEARCH_PROVIDER=firecrawl.");
  const pair = `${config.captureProvider}+${config.pdfProvider}`;
  if (pair !== "local+disabled" && pair !== "firecrawl+firecrawl")
    throw new Error("Capture must be configured as local+disabled or firecrawl+firecrawl.");
  return Object.freeze(config);
}

export function validateMarket(value, fallback = "NZ") {
  const market = value ?? fallback;
  if (!MARKETS.includes(market)) throw new Error(`Unsupported research market "${market}".`);
  return market;
}

export function publicProviderConfigSnapshot(config) {
  return {
    ...config,
    firecrawlPdfMode: "ocr",
    firecrawlFreshness: { maxAge: 0, storeInCache: false },
  };
}

function choice(value, fallback, allowed, name) {
  const selected = value == null || value === "" ? fallback : String(value).toLowerCase();
  if (!allowed.includes(selected)) throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  return selected;
}

function marketChoice(value) {
  const selected = value == null || value === "" ? "NZ" : String(value).toUpperCase();
  if (!MARKETS.includes(selected))
    throw new Error(`RESEARCH_DEFAULT_MARKET must be one of: ${MARKETS.join(", ")}.`);
  return selected;
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(String(value)))
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  return parsed;
}
