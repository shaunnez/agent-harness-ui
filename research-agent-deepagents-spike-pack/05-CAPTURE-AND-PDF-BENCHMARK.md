# Capture and PDF benchmark

## Decision this supports

This benchmark decides the capture layer for the Deep Agents research vertical slice. It compares three
realistic routes over the same public NZ and Australian sources:

1. Serper discovery followed by local extraction.
2. Serper discovery followed by Firecrawl capture.
3. Exa discovery followed by Exa Contents.

The existing search benchmark already compares discovery quality. This run does not repeat that work or
ask providers to reason for us. It tests whether a managed service can replace most downloading, rendering,
PDF parsing, and page-cleaning work while still producing citation-grade evidence.

## What is measured

- Capture success and latency.
- Recovery of known terms from product pages and PDFs.
- Physical PDF page attribution for exact citations.
- Preservation of a dense technical table row.
- Public price signals on NZ and Australian retailer pages.
- Output stability over two captures.
- Provider credits and estimated marginal cost.
- Whether source bytes must be retained to make the result auditable.

The corpus is versioned in `scripts/research-retrieval-benchmark/cases.json`. It uses only public sources.
Do not add customer, tender, plan, or otherwise private documents without an explicit data-processing
decision.

## Storage model under test

Every route retains the extracted evidence snapshot, metadata, and SHA-256 hash. That is the material the
research agent quotes and the host verifies.

- The local route downloads the public source into a private temporary directory, hashes it, extracts it,
  and deletes the downloaded bytes.
- Firecrawl and Exa receive the public URL directly. The harness does not download or retain the original
  source bytes for those routes.

This directly tests the proposed simpler architecture. It also exposes the trade-off: without the original
bytes, we can prove what extracted snapshot an agent used, but cannot later re-render the exact historical
PDF if the public URL changes.

## Cost boundary

The default corpus and two repetitions have a preflight ceiling of 24 Firecrawl credits. The script refuses
to run above 50 credits unless the ceiling is deliberately changed. Firecrawl's published billing currently
charges a base scrape credit plus one credit per parsed PDF page; Exa Contents prices one text content type
per URL, including a PDF URL.

The benchmark records directional USD equivalents, but production cost must be projected from unique
source captures. All agents should share a content-addressed extraction snapshot so the same source is not
paid for repeatedly.

## Inspect without making provider calls

```sh
npm run benchmark:research-retrieval -- --dry-run
```

## Run the bounded comparison

```sh
RUN_RESEARCH_RETRIEVAL_BENCHMARK=1 npm run benchmark:research-retrieval
```

Credentials are read from the ignored local environment:

- `FIRECRAWL_API_KEY`
- `EXA_API_KEY`

Artifacts are owner-only under `.data/research-retrieval-benchmarks/<timestamp>/`. The report contains the
summary; `results.json` retains the extracted evidence snapshots for exact review.

## Decision rule

Prefer one managed capture provider when it succeeds across the representative source types, preserves the
physical-page evidence PlanCheck needs, and fits the expected unique-source volume. Retain a fallback when a
provider cannot retrieve a source, loses material table/layout content, or cannot support the required
citation provenance.

This benchmark does not yet test private-document data terms, zero-data-retention, scanned/OCR-heavy plans,
or very large documents. Those are explicit follow-up gates before routing customer material through a
third party.

## First run outcome — 21 September 2026

The full public-source run completed 24/24 captures successfully: four cases, three routes, and two
repetitions. The owner-only report is under
`.data/research-retrieval-benchmarks/2026-09-20T23-11-30-377Z/report.md`.

| Route | Successful | Median latency | Known terms | Physical page anchors | Dense table | Stable repeats | Estimated run usage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Local | 8/8 | 429 ms | 86% | 83% | 100% | 75% | no external fee |
| Firecrawl | 8/8 | 3,211 ms | 86% | 83% | 100% | 100% | 24 credits / about US$0.12 marginal equivalent |
| Exa Contents | 8/8 | 415 ms | 82% | 0% | 100% | 100% | about US$0.008 |

The local repeat difference was confined to a dynamic retailer page; both PDF snapshots were stable.
Firecrawl matched the local route's checked PDF evidence and returned physical pages and layout-block pages.
Exa recovered useful text and the checked table very cheaply, but it did not return physical page mapping.

All three routes captured the Australian retailer's current `$48.39` product price. All three also captured
the New Zealand retailer's explicit statement that no online price was available. A generic “price signal”
must therefore not be treated as proof that a usable price exists; downstream evidence rules must distinguish
an amount from an unavailable-price statement.

The live smoke test plus the full run used an estimated 27 Firecrawl credits and US$0.009 of Exa Contents.
The provider dashboards were not queried, so these remain rate-card estimates rather than billing receipts.

## Updated proposal after the broad capture run

Use Firecrawl as the provisional single-provider candidate for public web search and capture, behind the
existing Eversor-owned provider boundary:

```text
research objective
  -> Firecrawl Search
  -> Firecrawl Scrape / PDF Parse
  -> content-addressed extracted snapshot + URL + metadata + physical page map
  -> Deep Agents reasoning and exact-quote verification
```

Do not retain public original PDF bytes by default. Retain the extracted snapshot and its hash, the canonical
URL, capture time, provider metadata, total/parsed pages, and physical-page or layout grounding. This is enough
for the current research evidence loop, while avoiding a second public-document store. The limitation is
explicit: if a public source changes later, the historical extraction can be audited but the exact old PDF
cannot be re-rendered.

Keep two fallbacks rather than making Firecrawl an irreversible dependency:

- Serper remains the search fallback where NZ/AU ranking quality matters; it was slightly stronger for local
  top-five discovery in the search benchmark.
- Local PlanCheck extraction remains the capture fallback for private supplied documents, unsupported or
  failed captures, and any workflow whose data terms do not permit third-party processing.

Do not select Exa as the primary PDF route yet. Its cost and speed are excellent, but zero physical-page
attribution is a material gap for reviewable construction evidence. It remains a useful low-cost HTML or
non-page-cited fallback.

## Practical monthly cost bands

Firecrawl currently provides 1,000 free credits per month. Its paid Hobby plan provides 5,000 credits for
US$19 month-to-month or US$16/month billed annually. The observed mixed corpus averaged three credits per
source because PDF parsing was page-capped. On that mix:

- Free covers roughly 330 unique source captures per month.
- Hobby covers roughly 1,660 unique source captures per month.

Long PDFs change the calculation. A basic scrape plus a 20-page PDF parse is approximately 21 credits:

- Free covers roughly 47 unique 20-page PDFs per month.
- Hobby covers roughly 238 unique 20-page PDFs per month.

Search consumes two credits per ten results. As a rough workload example, 100 research jobs per month with
four searches and five mixed captures per job would consume about 2,300 credits and fit inside Hobby. One
20-page PDF plus four HTML captures and four searches per job would be about 3,300 credits for 100 jobs and
also fit inside Hobby. LLM reasoning is separate from these capture costs.

The architecture must deduplicate at the source-snapshot level. These numbers assume each source is captured
once and shared by every research agent; paying again for every agent would erase the cost advantage.

## Second PDF gate outcome — legacy PlanCheck baseline, 21 September 2026

The difficult public-PDF gate compared Firecrawl directly with PlanCheck's legacy assessment extractor:
`backend.engine.text_extraction.extract_pdf` plus `assessment_engine.extract_via_vision`, the path used by
`run_check.py`. It did not exercise the current application's detection transcription path in
`run_tender_detection.py`.

It used the first 30 pages of NZ H1/AS1, the first 30 pages of the diagram-heavy NZ E2/AS1, and the first
19 pages of an Australian heritage assessment containing a degraded 1951 building plan. The run made no
provider retries and sent no private or customer document to Firecrawl. The owner-only report is under
`.data/research-pdf-gates/2026-09-20T23-39-20-270Z/report.md`.

| Route | Complete | Partial | Native-text checks | Scanned-plan checks | Scanned-plan time | Estimated run usage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PlanCheck legacy assessment | 2/3 | 1 | 100% terms, anchors, and tables | 2/5 terms, 0/3 page anchors, 8/19 pages missing | 493 seconds | 19 attempted vision pages; 11 outputs returned |
| Firecrawl | 3/3 | 0 | 100% terms, anchors, and tables | 4/5 terms, 2/3 page anchors, all 19 pages returned | 13 seconds | 82 credits / about US$0.41 marginal equivalent |

The legacy PlanCheck assessment route was better for native-text PDFs: it completed both 30-page extracts in
about half a second each with every checked term, physical-page anchor, and table. Firecrawl returned the
same checked evidence, but took about 10 seconds for E2 and 52 seconds for H1.

Firecrawl clearly won the scanned-document comparison, but did not produce perfect OCR. It missed faint
`Plan of Garage` wording and did not keep `City of Perth` on the expected physical page. The research host
must therefore continue to validate required evidence and fail closed when page grounding or material text
is absent.

The legacy PlanCheck assessment scan path failed more seriously. It returned only 11 bodies from 19 attempted pages
after about eight minutes. Its merge step associates returned vision bodies with the requested pages by
list position even after per-page failures are swallowed, so page identities after the first failure may be
shifted. That partial output is not safe for citation or reasoning. The benchmark reports it as partial,
not successful. This is a finding about that legacy path, not the current application worker.

The gate also found that ordinary server-side downloads of both building.govt.nz PDFs were rejected in this
environment, although a browser and Firecrawl could retrieve them. A fully local public route would need a
browser or proxy fetch fallback as well as PDF extraction.

## Material correction — current application path was not benchmarked

The current PlanCheck application detection worker uses a different transcription route through
`run_tender_detection.py` and `backend/engine/geotech_vision_transcription.py`. That route:

- binds each result and failure to its physical page;
- records truncation, policy blocks, provider failures, and usage explicitly;
- uses bounded concurrency and reassembles results in page order; and
- caches successful transcriptions per content-addressed page.

The legacy gate therefore does **not** establish that Firecrawl outperforms current PlanCheck extraction on
scanned PDFs. Its Firecrawl measurements remain valid, and the broad public search/HTML findings remain
valid, but the local comparison baseline was wrong for the current application.

Before selecting a default public-PDF route, re-run the degraded scanned-plan case against the current
detection transcription path. Measure the same term recovery, physical-page anchors, completeness, latency,
provider/model cost, and cache behavior. This replacement gate may require paid transcription calls and needs
separate execution approval.

## Corrected recommendation

Use Firecrawl Search as the default public-source discovery route, with Serper as the NZ/AU search fallback.
Firecrawl remains the leading managed HTML capture candidate because the broad capture benchmark is
unaffected. Keep PDF capture behind the Eversor-owned provider boundary and treat Firecrawl PDF Parse as
provisional until the replacement current-PlanCheck gate is complete. Retain the extracted snapshot, its
SHA-256 hash, canonical URL, capture time, provider metadata, and page/layout grounding. Share that
content-addressed snapshot between agents so each unique source is captured once.

Do not send private PlanCheck material through Firecrawl's self-serve service. Its published standard
privacy terms permit caching/indexing and describe US storage, while zero-data-retention for parsed
documents is presented as an Enterprise control. A private-document route requires an explicitly accepted
DPA, retention, residency, and deletion arrangement. Until then:

- private native-text PDFs stay on the proven local PlanCheck path;
- private scanned PDFs stay on the current page-preserving local transcription path, subject to its normal
  completeness and coverage gates;
- public Firecrawl results fall back to local or a second extraction when pages, required terms, or citation
  grounding are incomplete.

This selects search and HTML capture candidates, not the final public-PDF default. It does not change the
research runtime from Tavily. The replacement PDF gate is the first step in the implementation plan before
activating a PDF route.
