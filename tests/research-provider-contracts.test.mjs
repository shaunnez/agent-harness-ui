import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RESEARCH_PROVIDER_CONFIG,
  parseResearchProviderConfig,
  publicProviderConfigSnapshot,
} from "@eversor/research-engine/research-provider-contracts.mjs";

test("provider defaults preserve Tavily plus local HTML and disabled PDF", () => {
  assert.deepEqual(parseResearchProviderConfig({}), DEFAULT_RESEARCH_PROVIDER_CONFIG);
});

test("only the two supported capture/PDF pairs and Serper pairing are accepted", () => {
  assert.throws(
    () =>
      parseResearchProviderConfig({
        RESEARCH_CAPTURE_PROVIDER: "firecrawl",
        RESEARCH_PDF_PROVIDER: "disabled",
      }),
    /local\+disabled or firecrawl\+firecrawl/,
  );
  assert.throws(
    () => parseResearchProviderConfig({ RESEARCH_SEARCH_FALLBACK: "serper" }),
    /requires RESEARCH_SEARCH_PROVIDER=firecrawl/,
  );
  const enabled = parseResearchProviderConfig({
    RESEARCH_SEARCH_PROVIDER: "firecrawl",
    RESEARCH_SEARCH_FALLBACK: "serper",
    RESEARCH_CAPTURE_PROVIDER: "firecrawl",
    RESEARCH_PDF_PROVIDER: "firecrawl",
    RESEARCH_DEFAULT_MARKET: "AU",
    RESEARCH_FIRECRAWL_MAX_PDF_PAGES: "19",
    RESEARCH_FIRECRAWL_MAX_CREDITS_PER_RUN: "40",
    RESEARCH_SERPER_MAX_CALLS_PER_RUN: "1",
  });
  assert.deepEqual(publicProviderConfigSnapshot(enabled), {
    ...enabled,
    firecrawlPdfMode: "ocr",
    firecrawlFreshness: { maxAge: 0, storeInCache: false },
  });
});

test("numeric bounds reject instead of clamping", () => {
  for (const value of ["0", "31", "2.5", "not-a-number"])
    assert.throws(
      () => parseResearchProviderConfig({ RESEARCH_FIRECRAWL_MAX_PDF_PAGES: value }),
      /integer from 1 to 30/,
    );
  assert.throws(
    () => parseResearchProviderConfig({ RESEARCH_FIRECRAWL_MAX_CREDITS_PER_RUN: "101" }),
    /integer from 1 to 100/,
  );
});
