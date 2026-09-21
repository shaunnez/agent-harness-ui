import assert from "node:assert/strict";
import test from "node:test";
import { TavilySearchProvider } from "../server/research/tavily-search-provider.mjs";

test("the Tavily adapter sends one bounded bearer-authenticated search request", async () => {
  let observed;
  const provider = new TavilySearchProvider({
    apiKey: "tvly-test",
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Manufacturer guide",
              url: "https://manufacturer.example/guide",
              content: "Application instructions",
              published_date: "2026-09-20T00:00:00Z",
            },
          ],
          request_id: "request-1",
          response_time: "0.42",
          usage: { credits: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const response = await provider.search("NZ waterproofing", { maxResults: 3 });
  assert.equal(observed.url, "https://api.tavily.com/search");
  assert.equal(observed.options.headers.Authorization, "Bearer tvly-test");
  const body = JSON.parse(observed.options.body);
  assert.deepEqual(
    {
      query: body.query,
      depth: body.search_depth,
      maxResults: body.max_results,
      includeAnswer: body.include_answer,
      includeRawContent: body.include_raw_content,
      safeSearch: body.safe_search,
    },
    {
      query: "NZ waterproofing",
      depth: "basic",
      maxResults: 3,
      includeAnswer: false,
      includeRawContent: false,
      safeSearch: true,
    },
  );
  assert.deepEqual(response.results, [
    {
      title: "Manufacturer guide",
      url: "https://manufacturer.example/guide",
      snippet: "Application instructions",
      publishedAt: "2026-09-20T00:00:00Z",
    },
  ]);
  assert.deepEqual(response.metadata, {
    provider: "tavily",
    requestId: "request-1",
    responseTimeSeconds: 0.42,
    credits: 1,
  });
});

test("the Tavily adapter reports provider failures without exposing the credential", async () => {
  const provider = new TavilySearchProvider({
    apiKey: "tvly-sensitive",
    fetchImpl: async () => new Response('{"detail":"rate limited"}', { status: 429 }),
  });
  await assert.rejects(
    provider.search("test"),
    (error) => /HTTP 429/.test(error.message) && !error.message.includes("tvly-sensitive"),
  );
});
