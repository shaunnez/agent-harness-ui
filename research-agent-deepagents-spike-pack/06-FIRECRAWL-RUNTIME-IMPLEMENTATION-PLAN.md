# Firecrawl runtime implementation plan

## Status

Planned, not implemented. This is the next bounded vertical slice after the search and capture benchmarks
recorded in `04-SEARCH-PROVIDER-BENCHMARK.md` and `05-CAPTURE-AND-PDF-BENCHMARK.md`. Public PDF activation is
gated on a corrected comparison with PlanCheck's current detection transcription path.

## Intended outcome

Enable the existing opt-in Deep Agents research runtime to discover and capture public PlanCheck research
sources through this route:

```text
research objective
  -> Firecrawl Search (NZ by default; AU or US when requested)
     -> Serper Search only when the primary search is unavailable or returns no usable results
  -> Firecrawl Scrape
     -> Firecrawl PDF Parse only after the current-PlanCheck replacement gate
     -> existing safe local fetch only as an HTML fallback
     -> fail closed for an uncaptured PDF
  -> owner-only extracted snapshot + SHA-256 + capture/page metadata
  -> host-verified exact quote on the cited page
  -> Deep Agents reasoning
```

Firecrawl is an implementation behind Eversor-owned boundaries, not part of the public research contract.
The child research process must never receive Firecrawl or Serper credentials and must not gain general HTTP,
shell, or filesystem access.

## Decision basis

The provider selection is based on the live benchmark evidence already retained in this worktree:

- Firecrawl was the only evaluated route that combined competitive public search, stable HTML capture, and
  physical PDF page mapping.
- Firecrawl matched the checked native-text PDF evidence and materially outperformed PlanCheck's legacy
  `run_check.py` assessment path on the degraded scanned plan, although its OCR was not perfect.
- Serper was slightly stronger for local NZ/AU discovery and is therefore the search fallback.
- Serper does not capture sources and is not a capture fallback.
- Exa Contents was fast and inexpensive but did not provide physical PDF page attribution.
- Private or customer PlanCheck documents are outside Firecrawl's self-service data-processing boundary.

The difficult-PDF benchmark did not exercise the current application's `run_tender_detection.py` path. That
path uses transcription-only vision, preserves physical-page identity, records per-page failures and
truncation, applies bounded concurrency, and caches successful page transcriptions. The existing gate cannot
support a Firecrawl-versus-current-PlanCheck performance or quality conclusion.

Firecrawl's current document parsing contract supports URL-based document detection from the extension or
content type and a configured PDF `maxPages` limit. The implementation should still treat the provider
response as untrusted and verify its page and completeness metadata before accepting it.

Provider references checked for this plan:

- [Firecrawl Search](https://docs.firecrawl.dev/features/search)
- [Firecrawl Document Parsing](https://docs.firecrawl.dev/features/document-parsing)

## Required PDF re-evaluation

Before implementing or activating Firecrawl as the default public-PDF route, run a replacement gate against
PlanCheck's current detection transcription path using the same degraded public scanned plan. Reuse the
existing checked terms and physical-page anchors and additionally record:

- complete, partial, failed, policy-blocked, and truncated pages;
- stable physical-page identity after any page failure;
- first-run and cache-replay latency;
- actual model usage and attributable transcription cost;
- Firecrawl credits and latency on the same page cap; and
- whether each required excerpt is present on the expected physical page.

This is a narrow correction to the comparison baseline. Do not repeat the search or broad HTML capture
benchmarks. The replacement run may incur PlanCheck model usage and requires separate execution approval.

## Scope

This slice includes:

1. Production Firecrawl search and capture adapters.
2. A production Serper search adapter.
3. Explicit, observable Firecrawl-to-Serper search fallback.
4. Public HTML capture and a provider-neutral public-PDF path through the existing host-owned `fetch_source`
   tool; Firecrawl PDF activation follows the replacement gate.
5. A hard Firecrawl credit ceiling per run and a hard PDF page cap per capture.
6. Content-addressed extracted snapshots, in-run URL deduplication, and physical-page evidence verification.
7. Deterministic tests plus one bounded live provider acceptance run.
8. A safe local launch path that loads ignored research credentials.

## Non-goals

Do not add any of the following in this slice:

- private/customer document upload or third-party processing;
- changes to PlanCheck's own PDF or vision extractor;
- subagents, RAG, embeddings, vector storage, or a new retrieval index;
- a research UI or changes to the SDLC task orchestrator;
- cross-run source caching or freshness policy;
- provider-generated answers, summaries, or reasoning;
- automatic paid retries;
- removal of the existing Tavily adapter;
- changing the application's default research runtime from `fake`;
- making `deepagents` the default runtime without a separate acceptance decision.

## Architectural boundaries

### 1. Provider-neutral host interfaces

Introduce narrow server-internal interfaces. These are JavaScript contracts enforced through tests; they do
not belong in `src/domain/research.ts` and must not expose Firecrawl vocabulary to the public API.

```ts
interface SearchProvider {
  search(
    query: string,
    options: {
      market: "NZ" | "AU" | "US" | "GLOBAL";
      maxResults: number;
      signal?: AbortSignal;
    },
  ): Promise<{ results: SearchResult[]; metadata: SearchMetadata }>;
}

interface CaptureProvider {
  capture(
    url: string,
    options: {
      maxPdfPages: number;
      signal?: AbortSignal;
    },
  ): Promise<{
    content: string;
    pages: Array<{ pageNumber: number; content: string }>;
    metadata: CaptureMetadata;
  }>;
}
```

`SearchMetadata` must identify the selected provider, each attempted provider, the fallback reason, request
identifier when available, latency, and actual or estimated credits. `CaptureMetadata` must carry the final
URL, title, content type, request identifier, total and parsed PDF pages, page-cap truncation, layout-block
coverage, latency, and actual or estimated credits.

### 2. Provider error classification

Normalize provider failures into an internal error with at least:

- provider;
- operation (`search` or `capture`);
- HTTP status when available;
- category (`configuration`, `authentication`, `quota`, `rate_limit`, `timeout`, `transient`, `invalid_response`,
  or `permanent`);
- whether fallback is eligible;
- a safe message that never contains credentials or the complete provider response.

This classification makes fallback policy deterministic and testable rather than dependent on message text.

### 3. Search fallback policy

Firecrawl Search is primary. Serper is attempted only when Firecrawl:

- times out or has a network failure;
- returns HTTP 402, 429, or 5xx;
- explicitly reports exhausted quota; or
- returns zero valid public HTTP/HTTPS results after normalization.

Do not fall back for missing configuration, invalid credentials, malformed requests, or other 4xx failures.
Those conditions must fail loudly so a broken production configuration cannot be hidden by Serper.

The host records both attempts and the reason Serper was selected. Search snippets remain discovery hints and
cannot be cited until `fetch_source` has retained the source.

### 4. Market selection

Extend the child-owned `web_search` tool input with an optional constrained market:

```ts
{ query: string; market?: "NZ" | "AU" | "US" | "GLOBAL" }
```

The host defaults an omitted market from `RESEARCH_DEFAULT_MARKET`, initially `NZ`. The prompt should tell the
researcher to select AU or US only when the objective requires it. The provider adapter translates the enum
to Firecrawl `location` and Serper `gl`/`hl` settings; the child never constructs provider-specific fields.

### 5. Capture policy

Firecrawl Scrape is the primary capture path for public HTML. Keep public PDFs behind the same capture
interface, but do not select Firecrawl PDF Parse as the default until the replacement gate passes. When
Firecrawl PDF Parse is selected, configure it for Markdown content in `auto` mode with:

- maximum 30 pages by default;
- physical pages returned;
- page markers returned;
- layout blocks returned;
- no provider summary, extraction schema, or LLM processing.

Firecrawl detects supported document types from the URL extension or response content type. The host must
still validate the reported content type and normalize the output into one source shape.

On an eligible Firecrawl capture failure:

- ordinary HTML/XHTML/plain-text sources may use the existing SSRF-safe, byte-bounded local fetch;
- PDF or other document capture fails closed;
- authentication, configuration, and invalid-request errors fail immediately;
- no paid provider retry occurs automatically.

Before either capture route, retain the existing public-URL validation: HTTP/HTTPS only, no embedded
credentials, and no loopback, link-local, or private-network address.

### 6. PDF completeness and page grounding

Accept a PDF capture only when:

- page numbers are positive, unique, ordered, and within the configured cap;
- every accepted page has usable content;
- `parsedPages` covers `min(totalPages, maxPdfPages)` when `totalPages` is known; and
- the returned content can be reconstructed with explicit physical-page markers.

If the source has more pages than the cap, retain it as deliberately truncated and expose that fact to the
researcher. Do not call a capped capture a complete document.

For PDF evidence, `submit_finding` must require `locator.page`. The exact excerpt must occur within that
physical page's retained text, not merely somewhere in the whole snapshot. The persistence-layer verification
must repeat the same page-specific check from the snapshot so a runtime cannot bypass it. A missing page map,
wrong page number, or excerpt on a different page is rejected.

HTML evidence keeps the existing exact-substring verification. Page locators on non-paginated content are
rejected rather than silently accepted.

### 7. Snapshot and deduplication policy

Continue storing normalized extracted content as owner-only
`.data/research-sources/<content-sha256>.txt`. For PDFs, include stable page markers in that snapshot. Persist
capture metadata through the existing `research_sources.metadata_json`; no database migration is required.

Within one run, normalize requested URLs and capture a URL only once. A repeated `fetch_source` call returns
the already retained source and does not spend another provider credit. All current and future workers in the
run therefore share the same source snapshot.

Do not add cross-run cache reuse yet. Product prices and technical documents have different freshness needs,
and using an old extraction without an explicit freshness policy would create a more serious evidence risk
than the saved credits.

### 8. Provider credit ceiling

Enforce `RESEARCH_FIRECRAWL_MAX_CREDITS_PER_RUN`, defaulting to 100, in an adapter-owned per-run ledger. Do not
add provider-specific credits to the neutral `ResearchBudget` and do not merge them into model
`estimatedCostUsd`.

Before a Firecrawl call, reserve the maximum charge the configured operation can incur:

- reserve the documented search charge for the requested result band;
- reserve `1 + maxPdfPages` for capture, because document detection can occur after the call starts.

Reject the operation before making the request when `used + reserved` exceeds the run ceiling. Reconcile the
reservation to provider-reported credits when available, otherwise to a documented estimate. Release the
reservation on a request that is confirmed not to have been accepted; retain usage as partial when charge
status is uncertain.

Record credit usage in structured search/capture metadata and host events. A later product slice may promote
external-service usage into a provider-neutral operator ledger; that UI/contract work is not required here.

## Configuration

The implementation should support these runtime settings:

```text
RESEARCH_SEARCH_PROVIDER=firecrawl
RESEARCH_SEARCH_FALLBACK=serper
RESEARCH_CAPTURE_PROVIDER=firecrawl
RESEARCH_DEFAULT_MARKET=NZ
RESEARCH_FIRECRAWL_MAX_PDF_PAGES=30
RESEARCH_FIRECRAWL_MAX_CREDITS_PER_RUN=100
FIRECRAWL_API_KEY=...
SERPER_API_KEY=...
```

Keep `TAVILY_API_KEY` and the Tavily adapter supported for explicit rollback or comparison. Do not silently
read benchmark configuration in the normal development command. Add a research-specific launch command that
loads an ignored `.env.research.local` file and document the required variable names without ever printing
their values.

The existing `fake` research runtime remains the application default. A caller must continue to request
`runtimeId: "deepagents"` explicitly during this slice.

## Implementation sequence

### S0 — Correct the public-PDF comparison baseline

Add a benchmark adapter for the EXTRACT portion of PlanCheck's current `run_tender_detection.py` path and run
the single degraded scanned-plan case against that adapter and Firecrawl. Do not reuse
`assessment_engine.extract_via_vision`, and do not label the legacy gate as the current application baseline.

This step requires explicit approval before making paid PlanCheck transcription or Firecrawl calls.

Exit condition: the report identifies both exact extractor routes, preserves page-level failures and usage,
and supports an evidence-based choice between Firecrawl PDF Parse and current local transcription.

### S1 — Internal provider contracts, errors, and spend ledger

Add the shared internal response shapes, error classification, provider resolver, and per-run Firecrawl credit
ledger. Keep the existing Tavily adapter functional through the new resolver.

Likely files:

- `server/research/research-provider-errors.mjs` (new)
- `server/research/research-provider-resolver.mjs` (new)
- `server/research/provider-credit-ledger.mjs` (new)
- `server/research/tavily-search-provider.mjs` (adapt resolver ownership only)

Exit condition: provider selection, error categories, and reservation/reconciliation are deterministic and
covered without network calls.

### S2 — Firecrawl primary search and Serper fallback

Implement normalized Firecrawl and Serper search adapters plus the fallback wrapper. Add the constrained market
input to the worker tool and update its prompt. Preserve the current five-result host bound unless a separate
requirement changes it.

Likely files:

- `server/research/firecrawl-research-provider.mjs` (new)
- `server/research/serper-search-provider.mjs` (new)
- `server/research/fallback-search-provider.mjs` (new)
- `server/research/deepagents/worker.mjs`
- `server/research/research-web-tools.mjs`

Exit condition: Firecrawl is selected normally, Serper is selected only for the approved cases, and metadata
shows the complete attempt chain.

### S3 — Firecrawl capture and page-aware evidence

Inject a capture provider into `ResearchWebTools`, route `fetch_source` through it, retain the safe local HTML
fallback, normalize HTML/PDF responses, deduplicate repeated URLs, and strengthen page-specific verification.

Likely files:

- `server/research/firecrawl-research-provider.mjs`
- `server/research/research-web-tools.mjs`
- `server/research/research-store.mjs`

No research schema migration should be necessary because source metadata is already JSON and evidence locators
already support physical page numbers.

Exit condition: a captured PDF produces a page-marked snapshot, and a quote is accepted only on its actual
retained page.

### S4 — Runtime wiring and operator-safe launch path

Resolve search and capture providers in the host adapter, give every run its own credit ledger, update the demo
preflight, and add the ignored local-env launch command. Confirm that child environment allowlisting still
excludes all provider keys.

Likely files:

- `server/research/deepagents/adapter.mjs`
- `server/research/deepagents/child-env.mjs` (test or allowlist confirmation; no keys added)
- `scripts/research-demo.mjs`
- `package.json`
- `research-agent-deepagents-spike-pack/00-START-HERE.md`

Exit condition: an explicitly selected Deep Agents run uses the new search and HTML route while default
application behavior is unchanged. Its public-PDF provider matches the S0 decision.

### S5 — Qualification and bounded live acceptance

Run deterministic provider, host-tool, adapter, store, route, type, format, and build checks first. Then run one
public-only acceptance bounded to at most 40 Firecrawl credits and one Serper search credit:

1. one NZ/AU HTML source;
2. one public PDF with a known physical-page excerpt;
3. one forced fallback case proving Serper selection and recorded reason;
4. repeated capture of the same URL proving no second provider call;
5. a mismatched PDF page citation proving fail-closed verification;
6. inspection proving neither provider key entered the child environment or persisted artifacts.

Retain the acceptance report under ignored, owner-only `.data/research-runtime-acceptance/<timestamp>/`. Record
requests without authorization headers, normalized outcomes, provider metadata, estimated credits, hashes,
and pass/fail assertions. Do not retain private material or secret values.

The live provider acceptance does not require a paid model call. Exercise the real host adapters directly and
the Deep Agents boundary with its deterministic fake model. A live model evaluation is a separate decision.

## Test plan

Add focused tests for:

- Firecrawl search request mapping, response normalization, cancellation, timeout, and safe errors;
- Serper market mapping and response normalization;
- every allowed and disallowed search fallback category;
- zero usable Firecrawl results falling back to Serper;
- Firecrawl HTML and PDF capture normalization;
- automatic document detection metadata and the 30-page cap;
- incomplete, duplicate, missing, or out-of-order PDF pages failing closed;
- local HTML fallback and PDF non-fallback;
- per-run credit reservation, reconciliation, uncertain usage, and ceiling rejection before a request;
- repeated-URL capture deduplication;
- exact whole-snapshot verification for HTML;
- exact physical-page verification for PDF;
- snapshot permissions and SHA-256 re-verification after persistence;
- cancellation of in-flight search and capture;
- provider credentials absent from child environment, events, errors, snapshots, and stored metadata;
- Tavily explicit selection still working;
- default `fake` runtime and existing research API behavior remaining unchanged.

Run, in order:

```sh
node --test tests/research-provider*.test.mjs tests/research-web-tools.test.mjs
node --test tests/research-deepagents-adapter.test.mjs tests/research-store.test.mjs tests/research-routes.test.mjs
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Only report a command as passing when it has actually completed successfully.

## Acceptance criteria

The slice is complete when all of the following are true:

1. An explicit `deepagents` run uses Firecrawl for public search and HTML capture when correctly configured.
2. Search market is explicit and constrained, defaulting to NZ.
3. Serper is used only for the documented fallback conditions, with the reason and both attempts recorded.
4. Firecrawl or Serper credentials never enter the child process or retained artifacts.
5. Public HTML uses Firecrawl capture. Public PDF behavior matches the S0 gate decision; if Firecrawl is
   selected, the host does not download or store original PDF bytes.
6. Every retained source has URL, retrieval time, media type, SHA-256, snapshot reference, provider metadata,
   and actual or estimated provider credits.
7. Every PDF additionally records total/parsed pages, cap truncation, and physical-page mapping.
8. PDF evidence requires a page locator and is verified against that exact retained page at submission and
   persistence time.
9. The 30-page capture cap and 100-credit run ceiling are hard limits; an over-ceiling request is not sent.
10. A repeated URL within a run reuses its retained source without another paid capture.
11. Firecrawl capture failure may fall back locally only for supported HTML/text; a failed PDF capture stops
    with an actionable error.
12. The deterministic research suite, full repository test suite, typecheck, lint, formatting, and build pass.
13. The bounded live acceptance passes and retains a secret-free owner-only report.
14. The application still defaults to the fake research runtime, Tavily remains explicitly selectable, and no
    private document path has been enabled.

## Rollout and rollback

Roll out only through explicit runtime configuration and `runtimeId: "deepagents"`. Do not switch existing
users or tasks implicitly. Start with public PlanCheck HTML research objectives. Enable the selected public-PDF
route only after S0, then review provider credit events and page-grounded citations after each run.

Rollback is configuration-only for search: explicitly select Tavily again. Capture rollback disables the
Firecrawl capture provider and restores the current HTML-only local path; PDF research then fails closed as it
does today. No source or evidence schema downgrade is required.

## Risks and follow-up gates

- **The old PDF comparison used the wrong current baseline.** It compared Firecrawl with the legacy assessment
  extractor, not the current application detection transcription worker. S0 must complete before public-PDF
  activation.
- **OCR is fallible.** Firecrawl missed one faint term and one expected page placement in the scanned-plan gate.
  Required terms and physical-page evidence must still be checked; provider success is not evidence success.
- **Provider credit reporting may be incomplete.** Mark estimates as estimates and partial/uncertain usage as
  such; never present it as a billing receipt.
- **A page cap can hide relevant evidence.** Surface truncation to the researcher and unresolved questions; do
  not imply that an entire long document was reviewed.
- **Cross-run reuse needs freshness policy.** Add it only after defining safe age rules for prices, technical
  documents, and regulatory sources.
- **Private documents remain blocked.** Enabling them requires an accepted DPA, retention, residency, deletion,
  and zero-data-retention decision plus a repaired local scanned-PDF path.
- **Default-provider activation is separate.** Promote Deep Agents or Firecrawl to an application default only
  after the bounded live acceptance and an explicit product decision.
