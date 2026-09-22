# Current PlanCheck versus Firecrawl PDF replacement gate

## Outcome

The corrected gate supports Firecrawl PDF Parse as the default public-source PDF route behind Eversor's owned
capture boundary. This is not because it produced better OCR: Firecrawl and PlanCheck's current transcription
worker tied on every checked quality measure. Firecrawl is selected because it matched the local result, was
faster cold, avoids a second public capture integration, and can search, render HTML, and parse public PDFs
through one provider.

Private or customer PDFs remain on PlanCheck's local extraction and transcription paths. The self-service
Firecrawl data-processing terms are not accepted for that material.

## Exact run boundary

- Run time: 21 September 2026.
- Source: public Australian heritage assessment and scanned 1951 building plan.
- Source SHA-256: `179b7a508e405cef8bf1091c6ed9d01fecd1d33c4320784ba308ffc39868c84f`.
- Pages: physical pages 1–19 of 23, matching the retained Firecrawl result.
- PlanCheck route: EXTRACT from `run_tender_detection.py` through
  `backend/engine/geotech_vision_transcription.py`.
- Primary model: `claude-haiku-4-5`; escalation model: `claude-sonnet-5`.
- Spend allowance: US$1; measured attributable cost: US$0.073567.
- Cache: isolated benchmark-only `PageTranscriptionCache`, deleted after the process.
- Firecrawl: retained prior output; zero new provider calls and credits.
- Private/customer material: none.

The owner-only result and extracted text are retained under
`.data/research-current-pdf-gates/2026-09-21T00-58-43-628Z/`.

## Results

| Route | Complete within cap | Terms | Page-19 anchors | Cold latency | Cost | Replay |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| PlanCheck current transcription | 19/19 pages | 4/5 | 2/3 | 33.6 s | US$0.073567 | 19/19 cache hits, 3 ms, US$0 |
| Firecrawl OCR | 19/19 pages | 4/5 | 2/3 | 13.4 s | 20 credits / about US$0.10 at the benchmark rate | not measured |

PlanCheck recorded 19 returned calls, 35,207 input tokens and 7,672 output tokens. There were no provider
failures, policy fallbacks, policy blocks, truncated pages, missing pages, or escalations. Every cold output
was reproducible and all 19 pages replayed from cache without a provider call.

## Visual and evidence review

Both routes found:

- `HERITAGE ASSESSMENT`;
- `Appendix 2: Plans`;
- `City of Perth`; and
- `Building Licence Plans dated March 1951`.

Both missed the faint `Plan of Garage` wording. Neither retained `City of Perth` on physical page 19, although
the phrase appeared elsewhere in each extracted document. Visual inspection of page 19 confirms that the
garage label and city stamp are present but degraded inside the drawing.

The tie is therefore meaningful but narrow: both routes completed the document and preserved the same checked
evidence, while neither is sufficient for exact faint drawing text. A successful provider response must never
be treated as proof that required evidence was captured.

## Runtime decision

Use:

- Firecrawl Search for primary public discovery;
- Serper only for the documented search fallback conditions;
- Firecrawl Scrape for public HTML;
- Firecrawl PDF Parse for public PDFs, with physical-page maps and completeness checks; and
- PlanCheck local text extraction/transcription for private PDFs.

For every public PDF, retain extracted page-marked text, source URL, source/content hashes, retrieval time,
provider metadata, page counts, truncation state, and credits. Require a physical-page locator for PDF evidence
and verify the exact excerpt on that retained page. Missing pages, incorrect page maps, absent required text,
or a citation that resolves only somewhere else in the document must fail closed.

This result authorizes the implementation plan's public-PDF choice. It does not activate Firecrawl, change the
application's default runtime, send private documents externally, or prove either OCR route on every document
class.
