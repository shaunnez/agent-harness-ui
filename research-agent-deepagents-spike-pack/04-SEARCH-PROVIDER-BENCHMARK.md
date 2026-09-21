# Search provider benchmark

## Decision this supports

This benchmark compares public-web discovery for PlanCheck before selecting a default search provider. It
does not change the research runtime's configured provider and does not approve a paid account.

The first comparison is deliberately search-only:

- Serper, Tavily, Exa, and Firecrawl receive the same public-information query intent.
- Each provider receives the closest available NZ, AU, or US location setting.
- No provider-generated answer, full-page content, or bundled scrape is requested.
- Raw responses, normalized results, timing, errors, and estimated usage are retained locally.
- Automated signals help triage results, but a human reviews the top results before any vendor decision.

Firecrawl's scrape and PDF handling belong in a later retrieval-fallback comparison. Combining those
features with its search result would not be a fair discovery comparison with the other providers.

## Corpus

The versioned corpus is `scripts/research-search-benchmark/cases.json`. Its six starting cases cover:

1. An exact New Zealand product price.
2. New Zealand category and supplier discovery.
3. An exact Australian product price.
4. A manufacturer technical or installation document.
5. A United States comparison price.
6. An ambiguous New Zealand construction-product description.

Replace or extend these with real, non-sensitive PlanCheck examples before treating the result as a
production decision. Do not send customer, tender, or private project details through free-tier APIs.

## Configure free-tier credentials

Keep credentials in the local shell or another ignored local environment file. Do not commit them or paste
them into benchmark artifacts.

Supported environment variables:

- `SERPER_API_KEY`
- `TAVILY_API_KEY`
- `EXA_API_KEY`
- `FIRECRAWL_API_KEY` (optional for the documented low-rate keyless path)

Keep pay-as-you-go disabled in each provider dashboard during the free-tier evaluation. The harness cannot
determine whether a provider account has exhausted free credits before making a request.

## Inspect the plan without making calls

```sh
npm run benchmark:research-search -- --dry-run
```

Missing keyed providers are reported and skipped. Firecrawl remains runnable without a key.

## Run the bounded comparison

```sh
RUN_RESEARCH_SEARCH_BENCHMARK=1 npm run benchmark:research-search
```

The default is six cases, two repetitions, ten results, and every available provider. Use a smaller run while
checking a credential or endpoint:

```sh
RUN_RESEARCH_SEARCH_BENCHMARK=1 npm run benchmark:research-search -- \
  --providers=firecrawl \
  --case=nz-exact-price \
  --repetitions=1 \
  --max-results=5
```

Artifacts are written with owner-only permissions under
`.data/research-benchmarks/<timestamp>/results.json` and `report.md`. `.data/` is ignored by Git.

## Review before deciding

For each case, check:

- Was an authoritative manufacturer or standards source in the top five?
- Were NZ or AU suppliers actually local and was the currency correct?
- Was the price public, current, for the exact product, and not a misleading snippet?
- Were technical documents authoritative and current?
- Could the evidence page be retrieved, or was it a PDF/dynamic page requiring another retrieval path?
- Did duplicate, dead, or irrelevant results consume the useful result slots?

Select a provider only after reviewing the raw top results. A small benchmark can produce a shortlist; it
cannot prove production reliability or privacy suitability.
