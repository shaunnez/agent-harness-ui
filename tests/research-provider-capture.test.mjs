import assert from "node:assert/strict";
import test from "node:test";
import { FirecrawlCaptureProvider } from "../server/research/firecrawl-capture-provider.mjs";
import { ProviderCreditLedger } from "../server/research/provider-credit-ledger.mjs";

const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];

test("Firecrawl capture sends the exact fresh OCR request for every URL", async () => {
  let request;
  const provider = captureProvider(async (_url, options) => {
    request = JSON.parse(options.body);
    return jsonResponse({
      success: true,
      data: {
        markdown: "# Product identity",
        metadata: {
          contentType: "text/html",
          sourceURL: "https://example.com/product",
          title: "Product",
          cacheState: "miss",
        },
      },
      creditsUsed: 1,
    });
  });
  const result = await provider.capture("https://example.com/product", { maxPdfPages: 3 });
  assert.deepEqual(request, {
    url: "https://example.com/product",
    formats: ["markdown"],
    onlyMainContent: true,
    maxAge: 0,
    storeInCache: false,
    timeout: 120000,
    parsers: [{ type: "pdf", mode: "ocr", maxPages: 3, pages: true, pageMarkers: true, blocks: true }],
  });
  assert.equal(result.mediaType, "text/html");
  assert.equal(result.metadata.cacheState, "miss");
});

test("capture timeout is bounded by the remaining run time", async () => {
  let request;
  const provider = captureProvider(async (_url, options) => {
    request = JSON.parse(options.body);
    return jsonResponse({
      success: true,
      data: {
        markdown: "fresh",
        metadata: { contentType: "text/html", sourceURL: "https://example.com/product" },
      },
    });
  });
  await provider.capture("https://example.com/product", { maxPdfPages: 3, remainingMs: 1_500 });
  assert.equal(request.timeout, 1_500);
});

test("native and scanned PDF fixtures retain structural physical pages", async () => {
  for (const label of ["native", "scanned"]) {
    const provider = captureProvider(async () =>
      jsonResponse({
        success: true,
        data: {
          pages: [
            { pageNumber: 1, markdown: `${label} page one` },
            { pageNumber: 2, markdown: "THERMAL PERFORMANCE" },
          ],
          blocks: [{ pageNumber: 2, status: "ok" }],
          metadata: {
            contentType: "application/pdf",
            sourceURL: "https://example.com/document.pdf",
            numPages: 2,
            totalPages: 2,
            cacheState: "miss",
          },
        },
      }),
    );
    const result = await provider.capture("https://example.com/document.pdf", { maxPdfPages: 3 });
    assert.equal(result.validatedPdf.pages[1].pageNumber, 2);
    assert.equal(result.validatedPdf.coverage, "complete");
  }
});

test("cache hits, unsupported types, target errors and malformed page maps fail without fallback eligibility", async () => {
  const fixtures = [
    {
      data: {
        markdown: "cached",
        metadata: { contentType: "text/html", sourceURL: "https://example.com", cacheHit: true },
      },
    },
    {
      data: {
        markdown: "doc",
        metadata: { contentType: "application/msword", sourceURL: "https://example.com/doc" },
      },
    },
    {
      data: {
        markdown: "forbidden",
        metadata: { contentType: "text/html", sourceURL: "https://example.com", statusCode: 403 },
      },
    },
    {
      data: {
        pages: [{ pageNumber: 2, markdown: "wrong" }],
        metadata: {
          contentType: "application/pdf",
          sourceURL: "https://example.com/doc.pdf",
          numPages: 1,
          totalPages: 1,
        },
      },
    },
  ];
  for (const fixture of fixtures) {
    const provider = captureProvider(async () => jsonResponse({ success: true, ...fixture }));
    await assert.rejects(
      provider.capture("https://example.com/source", { maxPdfPages: 3 }),
      (error) => !error.fallbackEligible,
    );
  }
});

function captureProvider(fetchImpl) {
  return new FirecrawlCaptureProvider({
    apiKey: "firecrawl-sentinel",
    ledger: new ProviderCreditLedger({ provider: "firecrawl", ceiling: 20 }),
    fetchImpl,
    lookup: PUBLIC_LOOKUP,
  });
}
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
