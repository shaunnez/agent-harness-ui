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

## Updated proposal

Use Firecrawl as the provisional single-provider default for public web search and capture, behind the
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

## Remaining gate before production selection

Run one second, deliberately difficult corpus before replacing the runtime's current provider:

1. A scanned or image-only building document to exercise OCR.
2. A 20–100 page technical specification with a strict page cap.
3. A diagram or drawing-heavy PDF where layout blocks and bounding boxes matter.
4. A blocked or JavaScript-heavy NZ/AU product page.
5. A data-governance review covering retention, customer documents, DPA availability, and failure handling.

That second gate should compare Firecrawl with the existing PlanCheck text-plus-vision path, not rerun every
provider. The current evidence is already enough to narrow the managed candidate to Firecrawl.
