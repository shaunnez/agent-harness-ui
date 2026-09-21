# Firecrawl research runtime — implementation plan v2

## 1. Status, authority, and how to use this plan

Updated 21 September 2026 after the corrected PDF evaluation at commit `2802ac9` on PR #110.
**This is an implementation handoff, not an instruction to start implementation or spend.**

The public-PDF provider decision is settled: use Firecrawl. Do not rerun the provider selection benchmark.
Read `07-CURRENT-PDF-REPLACEMENT-GATE.md` for its exact evidence. This document supersedes the previous
implementation sequence in this file, including its pending-S0 gate and unconditional PDF `auto` mode.
Historical benchmark reports remain historical; do not rewrite their results.

When implementation is explicitly started, complete S1–S7 in order. Each step names its outputs and exit
checks. S8 makes real provider calls and requires an explicit execution allowance; prior benchmark spend
permission does not carry forward. Do not add features to compensate for a failed gate.

Read first: repository `AGENTS.md`, this document, `07-CURRENT-PDF-REPLACEMENT-GATE.md`,
`RESEARCH-RUNTIME-VERTICAL-SLICE.md`, then the implementation files named below. Earlier spike documents
mention fan-out and alternative models; those are outside this slice. The kickoff prompt is
`prompts/05-IMPLEMENT-FIRECRAWL-RUNTIME.md`.

Implementation workspace at writing:
`/Users/shaun/.codex/worktrees/research-runtime-vertical-slice/agent-harness-ui`, branch
`codex/research-runtime-vertical-slice`, HEAD `2802ac9`. Recheck HEAD, worktree, dirty files, and applicable
instructions before editing. Preserve concurrent work and ignored evidence. Do not merge, rebase, push,
publish, or restart user services merely to implement this document.

## 2. Outcome and fixed scope

An explicitly selected Deep Agents run will use this host-owned route when configured:

```text
public research objective
  -> web_search: Firecrawl Search; at most one eligible Serper fallback
  -> fetch_source: Firecrawl URL scrape for public HTML/PDF
     -> at most one safe local HTML/text fallback on eligible failure
  -> validated, content-addressed extracted snapshot
  -> read_source: bounded reads from that same snapshot, without network access
  -> submit_finding: exact retained excerpt, mandatory physical page for PDFs
  -> persistence: independently re-hash and re-check the evidence
```

Keep the application default runtime `fake`. Keep unconfigured Deep Agents search on Tavily and capture on
local HTML/text. The new route requires explicit configuration; do not silently migrate existing runs.

Included: search/capture adapters, deterministic fallback, PDF coverage, retained-source reading, URL and
network checks, in-run deduplication, bounded external usage, safe launch/acceptance scripts, and tests.

Excluded: private-document integration, changes to PlanCheck extraction, original PDF storage, new UI,
SDLC orchestration changes, subagents, RAG, embeddings, cross-run capture reuse, general browser tools,
provider-generated answers/summaries, model/provider changes, automatic paid retries, durable run resume,
and default-runtime activation. Use existing dependencies or Node built-ins; do not add an SDK/framework.

### Settled PDF decision and its limits

| Measure | Current PlanCheck transcription | Retained Firecrawl OCR |
| --- | --- | --- |
| Returned physical pages | 19/19 within cap, out of 23 total | 19/19 within cap, out of 23 total |
| Checked terms / page anchors | 4/5 and 2/3 | 4/5 and 2/3 |
| Recorded initial latency | 33.6 seconds | 13.4 seconds |
| Usage | US$0.073567 attributable model cost | 20 estimated credits, about US$0.10 at benchmark rate |
| Warm replay | 19 cache hits, 3 ms, US$0 | Not measured |

Firecrawl was reused from prior retained output, not rerun head-to-head. Its cache state was not established;
do not describe the timing as a controlled fresh-versus-fresh comparison. The provider choice follows the
user's decision: tied checked evidence and one public search/capture integration. No claim of superior OCR.
Both missed faint page-19 text. The original-byte hash in that benchmark identifies its fixture; the runtime
cannot compute original-byte hashes without downloading original bytes.

PlanCheck's private-document path is locally managed but its cold vision transcription calls Anthropic.
Do not describe it as on-device/offline processing. Leave that existing application path unchanged; this
research runtime must reject private inputs rather than route them into a newly built local PDF adapter.

The reported 670 passed / zero failed / four cancelled tests are historical qualification with unresolved
cancellations, not a fully green suite. Investigate and account for cancellations in S7.

## 3. Configuration: exact supported combinations

Parse once at run start, validate before spawning the child, and freeze a secret-free configuration snapshot
in adapter-owned runtime metadata. Do not reread environment settings halfway through a run.

| Setting | Unset value | Allowed values / rule |
| --- | --- | --- |
| `RESEARCH_SEARCH_PROVIDER` | `tavily` | `tavily`, `firecrawl` |
| `RESEARCH_SEARCH_FALLBACK` | `none` | `none`, `serper`; Serper only with Firecrawl primary |
| `RESEARCH_CAPTURE_PROVIDER` | `local` | `local`, `firecrawl` |
| `RESEARCH_PDF_PROVIDER` | `disabled` | `disabled`, `firecrawl` |
| `RESEARCH_DEFAULT_MARKET` | `NZ` | `NZ`, `AU`, `US`, `GLOBAL` |
| `RESEARCH_FIRECRAWL_MAX_PDF_PAGES` | `30` | Integer 1–30; reject rather than clamp invalid input |
| `RESEARCH_FIRECRAWL_MAX_CREDITS_PER_RUN` | `100` | Integer 1–100; this slice supports lowering, not raising |
| `RESEARCH_SERPER_MAX_CALLS_PER_RUN` | `4` | Integer 1–4; further bounded by logical search budget |

Valid capture pairs are **local + disabled** and **firecrawl + firecrawl** only. Reject mixed pairs before
network activity. This deliberately omits an independent Firecrawl-HTML-only mode: a URL without a PDF
extension can return a PDF, and rejecting the result afterwards cannot prevent provider processing. To
disable PDF processing, select local capture. Do not use `parsers: []` as a PDF rejection mechanism.

The enabled research environment sets the following explicitly (these are configuration names and choices,
not credentials):

```text
RESEARCH_SEARCH_PROVIDER=firecrawl
RESEARCH_SEARCH_FALLBACK=serper
RESEARCH_CAPTURE_PROVIDER=firecrawl
RESEARCH_PDF_PROVIDER=firecrawl
RESEARCH_DEFAULT_MARKET=NZ
RESEARCH_FIRECRAWL_MAX_PDF_PAGES=30
RESEARCH_FIRECRAWL_MAX_CREDITS_PER_RUN=100
RESEARCH_SERPER_MAX_CALLS_PER_RUN=4
```

It also supplies host-only `FIRECRAWL_API_KEY` and
`SERPER_API_KEY`. Require the fallback key at startup if the fallback is configured. Preserve existing
Tavily credential aliases/explicit rollback configuration. Provider endpoints for the new adapters are
fixed HTTPS endpoints; injectable transport is for tests, not model-controlled endpoint overrides.

Initial PDF mode is fixed to **`ocr`**, matching the difficult-scan evidence used in the decision. Do not
expose `auto` as an operator or model option in this slice. This is a conservative initial policy, not proof
that OCR is preferable for all native-text PDFs. S8 must check a native-text PDF using this exact mode.
A later `auto` policy needs its own bounded qualification; no silent second pass or mode escalation.

## 4. Host contracts and ownership

Implement server-internal JSDoc contracts and runtime validation using existing patterns. Do not put
provider classes, credit units, SDK vocabulary, or parser options in `src/domain/research.ts`.

```ts
type Market = "NZ" | "AU" | "US" | "GLOBAL";

interface SearchProvider {
  search(query: string, options: {
    market: Market; maxResults: number; signal: AbortSignal;
  }): Promise<{ results: SearchResult[]; metadata: SearchMetadata }>;
}

interface CaptureProvider {
  capture(url: string, options: {
    maxPdfPages: number; signal: AbortSignal;
  }): Promise<{
    mediaType: "text/html" | "application/xhtml+xml" | "text/plain" | "application/pdf";
    content: string; // normalized text for non-PDF; host derives PDF text from pages
    pages: Array<{ pageNumber: number; content: string }>;
    metadata: CaptureMetadata;
  }>;
}
```

A single host run owns its configuration, credit ledger, abort/deadline signal, URL-attempt map, source IDs,
and retained snapshots. Providers perform transport/response normalization; host tools own admission,
deduplication, snapshotting and citation checks. Storage independently verifies cited bytes. Child schemas
improve tool usability but never replace host input validation.

Metadata must be explicitly constructed, not copied with a raw-response object spread:

- Each attempt: provider, operation, host attempt ID, optional bounded provider request ID, start/finish time,
  elapsed milliseconds, safe status/error category, reserved credits, known/estimated charge, certainty.
- Search: requested/effective market, selected provider, ordered attempts, fallback reason, result count.
- Capture: requested/final URL, title, upstream content type, capture provider, attempts, receipt time,
  upstream capture time if supplied, cache state or `unknown`, normalization version, configured parser
  mode/page cap, provider-reported page counts, verified page counts, coverage state, block coverage.
- Separate provider-reported fields from host-validated values. Unknown is `null`/explicitly unknown, not 0.
- Source `mediaType` describes the captured source, not the provider API's JSON response type.
- Keep model token/cost usage separate from external-service credits. Use existing structured `log` events
  and source metadata; do not invent new public event enums just for these adapters.
- Emit an attempt record even when no source is retained. Persist final ledger totals for success, failure,
  cancellation, and budget rejection. Redact before emitting, not only when writing the final report.

## 5. Public-source and transport policy

### Admission and confidentiality

This slice accepts operator-supplied **public-only objectives** and public URLs. Do not attach customer
briefs, tender documents, credentials, or resolved private context to this route. The research launcher
requires an explicit public-only acknowledgement and refuses non-empty document context for its public
acceptance/demo profile. The configured Firecrawl adapter must also reject non-empty `request.context`
before starting this public-only slice, so direct API invocation cannot bypass the launcher's restriction.
It must explain that queries as well as URLs leave the machine. Do not alter fake/Tavily context behaviour.

URL rules run before provider submission and before every local redirect:

1. HTTP/HTTPS only; no userinfo, local files, data URLs, localhost/local domains, private/link-local/reserved
   IP destinations, or non-global DNS answers. Use a maintained explicit IP policy with IPv4/IPv6 tests.
2. Reject known credential-bearing query keys case-insensitively: `token`, `access_token`, `api_key`,
   `apikey`, `authorization`, `signature`, `sig`, `x-amz-*`, `x-goog-*`, and Azure SAS credential combinations.
   Do not strip signatures and then fetch a different resource. Never log the rejected URL's secret values.
3. No caller/model-supplied headers, cookies, browser actions, uploads, proxy credentials, or provider options.
4. Validate the provider's final URL before retaining content. This is output validation, not proof of the
   provider's redirect/network behaviour. Document that remote fetching relies on Firecrawl's own network
   controls; do not claim host DNS checks constrain Firecrawl's connection.

Public routability and signature checks are not a complete confidentiality classifier. Obscure private
links and sensitive free-text queries cannot be reliably classified by regex. Public-only operator input
is a real precondition of this slice. Do not claim arbitrary private objectives are safe because a filter
exists. Prompt-injection tests prove bounded tools/no private context, not universal resistance to leakage.

### Local fetch transport

The current local fetch validates DNS then calls an independently resolving fetch. Close that gap: resolve
and validate all answers, then bind the actual HTTP(S) connection to a validated address using Node's
request lookup/agent facilities; preserve original Host/SNI and TLS verification. Revalidate and repin each
redirect, and do not reuse a socket across different validated origins. Honour cancellation during DNS,
connection, headers and body reads; a timed-out resolution must never subsequently start a request.

Keep a maximum of five redirects and a 1,000,000-byte local decoded body cap. Reject unsupported content
types before consuming bodies; reject missing/ambiguous type or PDF signatures masquerading as text.
A safe local HTML fallback is never an alternate PDF downloader/parser. Destroy/cancel disallowed bodies.

### Provider transport bounds

Use direct HTTP requests with injected transport for deterministic tests. One paid request per provider
attempt; disable application/SDK retries. A provider's internal handling is not a second host attempt.
Do not follow provider-API redirects with credentials. Treat an unexpected API redirect as invalid response.

Defaults: search timeout 20 seconds, capture timeout 120 seconds, always bounded by remaining run time.
All fallback attempts share the run deadline; cancellation and deadline expiry prevent fallback.
Bound response bodies while streaming, before JSON parsing: search 1 MiB, capture 8 MiB, and retained
normalized text 2 MiB per source. Oversized output fails without clipping it into apparently complete
content. Layout data shares the capture limit. Lower limits may be injected by tests; do not add tuning UI.

## 6. Search mapping and fallback — exact rules

`web_search` accepts `{ query: string, market?: Market }`, rejects extra/invalid fields at the host, trims
query edges, and limits query length to the existing 500 characters. Keep at most five valid results.

| Market | Firecrawl `location` | Serper `gl` / `hl` |
| --- | --- | --- |
| NZ | `New Zealand` | `nz` / `en` |
| AU | `Australia` | `au` / `en` |
| US | `United States` | `us` / `en` |
| GLOBAL | omit | omit `gl`, retain `hl=en` |

GLOBAL means no requested country bias, not a guarantee of geographically neutral ranking. Existing
Tavily behaviour must remain functional; record any unsupported market mapping instead of inventing it.

Firecrawl: POST `https://api.firecrawl.dev/v2/search`, bearer credential, query, `limit: 5`, `sources: ["web"]`.
No `scrapeOptions`, summaries, news/images, or research category. Normalize the documented `data.web`
response only; accept other shapes only if a recorded API fixture explicitly establishes that contract.
Serper: POST `https://google.serper.dev/search`, `X-API-KEY`, `q`, `num: 5`, market fields; normalize `organic`.

For each result, bound title/snippet/URL, validate URL policy, preserve provider order and remove duplicate
normalized URLs before returning up to five. Do not mutate useful path/query parameters. Search snippets
cannot be evidence. A valid response with zero usable results differs from malformed JSON/missing structure.

| Condition | Search fallback to Serper | Capture fallback to local |
| --- | --- | --- |
| Provider network failure, attempt timeout while run remains active | Once | Once; accept HTML/text only |
| Provider HTTP 402, 429, 5xx, explicit quota exhausted | Once | Once; accept HTML/text only |
| Valid search payload, zero valid results | Once | Not applicable |
| Configuration, authentication, malformed request, other provider 4xx | Never | Never |
| Invalid JSON/schema, unsupported type, oversized response, incomplete PDF | Never | Never |
| URL/privacy/security policy rejection | Never | Never |
| User cancellation, run deadline, local credit/call ceiling | Never | Never |
| Upstream source 404/403 or login/challenge page returned in a successful API envelope | Not a search failure | Fail with source error; no second route |

Distinguish provider API status from target-source status. An API credential failure must not be interpreted
as a target website challenge. On an eligible capture failure with unknown source type, a bounded local
request may inspect headers; it must stop before reading a PDF/document body. Known PDFs never fall back.

Internal error categories: configuration, authentication, quota, rate_limit, timeout, transient,
invalid_response, permanent, cancelled, deadline_exceeded, budget_exhausted, policy_rejected,
unsupported_media_type, source_http_error, source_incomplete. Use fixed safe messages. Raw provider errors,
URLs containing secrets and exception causes must not leak through host-tool responses or logs.

If Serper fails, return both safe attempt records and a terminal tool error; no Tavily fallback chain.
If both search providers return valid empty results, return `results: []` plus metadata; no invented answer.

## 7. Capture request, freshness and OCR

Firecrawl URL capture uses POST `https://api.firecrawl.dev/v2/scrape`, never file-upload `/parse`:

```json
{
  "url": "HOST_VALIDATED_PUBLIC_URL",
  "formats": ["markdown"],
  "onlyMainContent": true,
  "maxAge": 0,
  "storeInCache": false,
  "timeout": 120000,
  "parsers": [{
    "type": "pdf",
    "mode": "ocr",
    "maxPages": 30,
    "pages": true,
    "pageMarkers": true,
    "blocks": true
  }]
}
```

Substitute validated page cap and remaining timeout, not model-supplied options. Apply PDF parser bounds to
**every** capture, including extensionless URLs. Do not request JSON extraction, summaries, screenshots,
HTML/raw HTML, actions or inline/base64 original documents. OCR is allowed; provider-generated research
reasoning is not. Do not copy the provider's aggregate Markdown into a PDF snapshot.

`maxAge: 0` requests fresh capture. `storeInCache: false` avoids adding a reusable scrape cache entry; neither
is an assertion of contractual zero retention. These are request policies, not proof that a publisher's own
CDN is fresh. Record actual cache metadata when supplied. Unexpected provider cache hits violate the fresh
capture policy and cannot silently satisfy acceptance.

Only HTML/XHTML/plain text and PDF are accepted. Missing/contradictory type must fail closed unless an
explicitly tested provider document/page discriminator establishes PDF identity. Never infer HTML merely
because the URL lacks `.pdf`. Reject other documents without retaining/citing them; URL capture can still
cause the provider to process an unexpected document before it returns a type. This slice does not promise
pre-fetch MIME enforcement at the provider. Do not retain original document bytes if returned unexpectedly.

## 8. PDF validation and content-addressed snapshots

### Coverage algorithm

1. Validate `pages` is a non-empty array and physical page numbers are integers exactly `1..N`, in order,
   without duplicates/gaps, where `N <= configured cap`. Do not sort, renumber, or zip bodies to expected
   pages to conceal malformed page identities.
2. Validate provider `numPages` is an integer equal to `N`. If total pages are known, require positive
   integer `totalPages >= N` and `N === min(totalPages, cap)`. Contradictions are `source_incomplete`.
3. If total pages are unknown, accept a contiguous usable range only as `coverage: "unknown"`; record
   `totalPages: null` and `capTruncated: null`. Never infer completeness from hitting/not hitting the cap.
4. If total pages exceed the cap, coverage is `capped`, `capTruncated: true`. Otherwise coverage is
   `complete`, `capTruncated: false`. These describe represented pages, not OCR correctness.
5. Reject missing/failed pages. For an empty page body, do not invent "blank page" from absence of text.
   Initial policy is fail closed with `empty_page_unclassified`; only add blank-page acceptance if an
   authoritative provider field explicitly distinguishes genuine blank pages and has a fixture/test.
6. Validate block page IDs/status if blocks exist. Retain a bounded per-page coverage summary. Missing block
   geometry does not replace or invalidate an otherwise valid text page map, but must be recorded unknown.
   Explicit extraction failure/truncation metadata must not be ignored. Do not reuse aggregate Markdown
   offsets after normalization. No bounding-box citation feature is required.
7. Normalize each page deterministically: Unicode NFC and CRLF/CR to LF, preserving internal Markdown
   whitespace/table layout. No model cleanup, summarization, inferred text or invented headings.

### Snapshot format

Keep `.data/research-sources/<sha256>.txt`, `snapshotRef: sha256:<sha256>`, files mode 0600 and owned
source/acceptance directories mode 0700. Preserve legacy HTML plain-text snapshots and their verification.
For new PDFs, store a **versioned JSON text envelope**, not regex-split provider page markers:

```json
{
  "format": "research-pdf-v1",
  "normalizationVersion": 1,
  "totalPages": 23,
  "parsedPages": 19,
  "pageCap": 19,
  "coverage": "capped",
  "pages": [{ "pageNumber": 1, "content": "Normalized page text" }]
}
```

The example abbreviates `pages`; real snapshots contain all validated entries. Serialize properties in
this fixed order using compact `JSON.stringify` plus one final LF; hash exact UTF-8 bytes. PDF page identity
and coverage are inside the hashed envelope. Store `metadata.snapshotFormat = "research-pdf-v1"` alongside
capture metadata. This replaces the earlier loosely specified "page-marked text" with explicit structural
page labels; human-readable page markers may be rendered for the tool but are not the verification format.
JSON escaping prevents page text such as `<!-- page 7 -->` from becoming structural page identity.

`contentSha256` is the extracted-snapshot hash, never the source PDF-byte hash. Original-byte hashes are
unavailable for ordinary URL captures; do not synthesize them from the URL, ETag or extracted text. Any
independently supplied benchmark source hash must be labelled benchmark provenance, not host verification.
Record URL/receipt/capture metadata outside the content hash. No original PDF download is needed.

Create snapshots with exclusive writes; an existing same-hash file must match bytes and have owner-only
permissions before reuse. Reject symlinks/non-regular files. Never overwrite mismatched content. No
cross-run URL cache: identical content may share an immutable file only after that run performs its capture.

### In-run deduplication and failures

Use a Map from normalized requested URL to a promise/result **installed before the first await**. All
concurrent or later requests share the same paid attempt, source ID and snapshot. Normalize with URL parsing,
remove fragments/default ports; preserve path case, trailing slash and query ordering/values. Do not strip
tracking-looking parameters or trust HTML canonical links. Record validated final-URL aliases after success;
if two distinct URLs already started independently, do not claim they were deduplicated retrospectively.

Keep failed/uncertain capture entries for the run too. A repeated call returns the retained safe error and
must not submit another paid capture. A new operator-requested run is required for another attempt. Avoid
unhandled rejected promises. Repeated tool calls still consume maxToolCalls, but no external credits.

## 9. Reading retained sources and verifying findings

Keep `fetch_source({url})`. Return source identity, safe metadata, page inventory/coverage, and at most
50,000 characters of initial text, with explicit view truncation. PDF text must be labelled with physical
pages; never imply the initial preview contains every retained page.

Add `read_source` with this strict host/child input schema:

```ts
{ sourceId: string; page?: number; offset?: number; limit?: number }
```

For PDF, `page` is required and must be an actually retained physical page. For HTML/text, `page` is
forbidden. Offset defaults to 0; limit defaults to 12,000, allowed 1–50,000; both are integers. Offsets use
JavaScript string UTF-16 indices, documented consistently. Return source ID, page when applicable, offset,
content, `nextOffset` or null, total characters for that page/text, and coverage. An out-of-range offset/page
is an actionable error. Reads reverify the retained snapshot, count against maxToolCalls, require the source
belongs to this run, and perform no DNS/network/provider operation. Do not accept file paths from the child.

`submit_finding` must validate on the host:

- Source belongs to run; excerpt is non-empty and within the current 2,000-character limit.
- PDF requires a positive integer `locator.page`. Exact excerpt occurs in that page's normalized body.
- HTML/text forbids a page locator and uses its retained text. Preserve existing optional HTML locator
  labels for compatibility, but quote verification must not claim that a section/selector was validated.
  For new PDF evidence support physical page only; reject additional unvalidated coordinates rather than
  attach apparently verified positions.
- Generated markers and JSON envelope keys are not citable text. Cross-page concatenations are rejected.
- Verification is case-sensitive exact substring matching; no fuzzy OCR repair or whitespace-loosening.
- Model-supplied `quoteVerified` remains forbidden. Verification confirms a retained quotation, not source
  authority, claim entailment, complete reading, correct OCR, or accurate dimensions in a drawing.

Source records and verification flags must come from host capture/verification. Reject child attempts to
emit reserved host-owned `source.retrieved` events or substitute source metadata through a final result.
The store must independently reopen, hash, parse and validate the envelope and repeat the same page check.
A metadata page map alone is insufficient. A PDF missing its supported envelope/map remains unverified;
never fall back to a whole-snapshot substring check. Reject format/media inconsistencies. Legacy text
verification must not grant page verification to old sources. Preserve existing public result/store behaviour
for rejected evidence: unverified rows must remain `quote_verified=0`, never represented as verified findings.
The host tool itself rejects invalid submission; do not silently discard bad references and accept the rest.

Use the worker prompt to require `read_source` when the preview omits necessary pages and to report absent
required evidence as unresolved. Host-owned coverage warnings must be appended/deduplicated into final
`unresolvedQuestions` for capped/unknown sources even if the model omits them. Do not infer "not present in
the document" from a capped read. Known required-excerpt assertions belong in deterministic acceptance;
this slice does not magically derive a complete set of required terms from a free-text objective.

## 10. Credit reservations, call ceilings and termination

Use one synchronous per-run ledger before awaiting transport. Define
`committedUpperBound + activeReservations <= configuredCeiling` at every request dispatch.

- Search-only Firecrawl: reserve 2 credits for the fixed five-result band.
- Firecrawl capture: reserve `1 + pageCap`; URL auto-detection means HTML-looking URLs get the same bound.
- Serper: reserve one call against its independent per-run limit. It is not charged to Firecrawl's ledger.
- Reconcile to trustworthy finite nonnegative provider-reported operation credits when present. Otherwise
  retain the full reserved upper bound for enforcement and record a separate documented charge estimate.
  Never use an optimistic estimate to release uncertain spending capacity.
- Release a reservation only when the request is proved unsent/unaccepted and uncharged. A network error,
  timeout, cancellation after dispatch, malformed response, or source rejection is not proof of no charge.
- Exceeding the ceiling rejects before network dispatch. The child may inspect retained sources afterwards;
  budget rejection never triggers another paid provider. Do not add Firecrawl units to ResearchHardCeiling.
- If reported charge exceeds the reserved maximum, record the real report, stop subsequent paid operations,
  and fail qualification with `provider_charge_contract_violation`. Do not clamp/hide it or claim the hard
  billing guarantee held. The ceiling is a host dispatch bound under a verified provider charging contract.
- Freeze the rate assumptions/options in metadata and verify documentation before S8. If the maximum charge
  cannot be bounded for these options, do not run S8 or silently raise its allowance.

A logical `web_search` consumes one existing search budget slot; fallback attempt counts are separately
recorded. Search retries by the model remain bounded by maxSearchCalls and the provider ledgers. Capture
retries for the same URL are prohibited as specified above.

Cancellation is terminal, not a timeout eligible for fallback. On run termination abort outstanding I/O,
prevent new requests, conservatively settle outstanding reservations, and emit the final safe ledger before
closing the event stream. Prevent late results from publishing a source/finding or mutating the closed run.
No automatic replay/resume after process restart; durable ledger recovery is outside this slice.

## 11. Implementation sequence and file ownership

Use cohesive modules; `research-web-tools.mjs` is already close to the preferred 500-line limit. Do not put
all new code into it. File names below are the intended layout, not permission for a generic framework.

### S1 — Configuration, contracts and ledger

Create `server/research/research-provider-contracts.mjs`, `research-provider-errors.mjs`,
`research-provider-resolver.mjs`, and `provider-credit-ledger.mjs`. Move resolver ownership out of
`tavily-search-provider.mjs` with compatibility for existing imports/tests as needed.

Implement configuration matrix, validated metadata/error constructors, reservation accounting and injected
clock/transport seams. Keep resolver dispatch simple. Add `tests/research-provider-contracts.test.mjs` and
`tests/research-provider-credit-ledger.test.mjs`.

Exit: defaults unchanged; invalid combinations fail before child/network; parallel reservations cannot
overspend; uncertain charges retain the whole bound; actual-over-bound stops future paid calls.

### S2 — Public URL and local transport boundary

Extract `research-source-policy.mjs` and `research-source-fetch.mjs` from existing web tools. Implement the
pinned DNS/connection and bounded transport rules. Preserve existing HTML normalization behaviour.
Add `tests/research-source-policy.test.mjs`; extend web-tool tests for local capture.

Exit: private IPv4/IPv6, mapped forms, mixed DNS answers, credential-bearing URLs, rebinding attempts,
redirects, timeout during body reads, cancellation and oversized/disguised PDFs behave as specified.
No broad security refactor outside research.

### S3 — Search adapters and one-step fallback

Create `firecrawl-search-provider.mjs`, `serper-search-provider.mjs`, `fallback-search-provider.mjs` under
`server/research/`. Implement request mapping, response validation, bounded errors, attempt metadata,
credit reservations and the fallback table. Adapt Tavily through the common boundary without deleting it.
Add `tests/research-provider-search.test.mjs`; keep `tests/tavily-search-provider.test.mjs` passing.

Exit: every table row has a deterministic test; invalid responses cannot masquerade as empty results;
GLOBAL mapping is explicit; cancellation, local ceilings and credential failures cause no fallback.

### S4 — Capture normalization and snapshot codec

Create `firecrawl-capture-provider.mjs` and `research-source-snapshots.mjs`. Implement the exact request,
PDF validation, safe metadata, JSON-text PDF envelope, filesystem permissions and shared verifier.
Add `tests/research-provider-capture.test.mjs` and `tests/research-source-snapshots.test.mjs`.

Exit: valid native/scanned fixtures survive serialization and independent verification; wrong/missing pages,
forged markers, altered bytes, inconsistent metadata, empty unclassified pages and oversized bodies fail.
A 19-of-23 capture is capped, never complete. Legacy HTML evidence still verifies.

### S5 — Host tools, child tool schemas, storage and lifecycle

Update `research-web-tools.mjs`, `deepagents/worker.mjs`, `deepagents/adapter.mjs`, and
`research-store.mjs`. Wire providers/ledger per run, capture deduplication, `read_source`, page citations,
coverage warnings, final accounting and termination. Share the pure snapshot codec between host and store;
do not trust the host's prior boolean instead of rechecking bytes.

Update deterministic fake-model scenarios so PDF tests actually call read_source and submit a page locator.
Add tests to web tools, adapter, vertical slice and store. Extend child-env exclusion tests for Firecrawl,
Serper, Tavily and tracing credentials; keep child imports/tool capabilities constrained.

Exit: an end-to-end fake-model run captures, reads beyond 50,000 initial characters, cites the correct page,
and survives persistence; wrong-page citations cannot become verified. Concurrent duplicate calls spend
once. Cancellation leaves no late sources or unaccounted active reservation.

### S6 — Launch commands and acceptance runner (offline first)

Add `scripts/research-provider-acceptance.mjs` and a versioned public fixture manifest with expected URLs,
physical pages/excerpts, parser options and cost bounds. Add these commands to package.json:

- `research:demo:local`: load ignored `.env.research.local` using Node's env-file facility and invoke the
  existing live-model demo. Preserve its explicit live execution guard; update preflight for selected providers.
- `research:acceptance`: load the same ignored file and invoke the provider acceptance script, defaulting
  to `--dry-run` behaviour unless `RUN_RESEARCH_PROVIDER_ACCEPTANCE=1` is explicitly set.

A dry run validates configuration/manifest/upper bound without DNS, provider calls, model calls or secret
output. The runner forces deterministic fake model settings and rejects live-model selection, even if keys
exist in the environment. Ordinary `npm run dev`, tests and build must not read research/benchmark env files.

Use `.env.research.local` mode 0600. Document variable names/selections, never values. Do not create keys,
print dotenv contents or inherit provider credentials into the child. Update START-HERE with actual commands
and a short rollback recipe. Register all new deterministic tests in package.json's explicit `test` list;
merely naming tests `*.test.mjs` does not make this repository's npm test execute them.

Exit: dry run is network-free; keys absent from child/events/errors/artifacts; fake runtime and existing
Tavily/local mode work without new keys; new tests are included in repository qualification.

### S7 — Deterministic qualification and diff review

Run the narrow tests below first, then broader checks. Fix findings within scope and rerun affected checks.
Do not add skip flags or weaken assertions to make a run green.

```sh
node --test tests/research-provider*.test.mjs tests/research-source*.test.mjs tests/tavily-search-provider.test.mjs tests/research-web-tools.test.mjs
node --test tests/research-deepagents-adapter.test.mjs tests/research-deepagents-import-containment.test.mjs tests/research-store.test.mjs tests/research-routes.test.mjs tests/research-vertical-slice.test.mjs tests/research-contracts.test.mjs
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:sites
git diff --check
```

Retain per-command exit codes and passed/failed/cancelled/skipped counts. Four cancelled tests from earlier
work are not a baseline waiver. Inspect cancellations, determine whether relevant/new, and fix in-scope
causes. If an unrelated cancellation/failure remains, document the exact test and reason and leave full-suite
qualification incomplete; do not change unrelated workflows to conceal it. Exclude paid live tests from
normal test discovery. Preserve Sites build files and output structure.

Exit: intended diff only; deterministic suites have zero unexpected failures/cancellations; checks completed
successfully. Report code qualification separately from S8, provider activation and live-model quality.

### S8 — Bounded live provider acceptance, separately authorized

Prepare a reviewable dry-run manifest and upper-bound calculation before requesting execution authority.
Ceilings: **40 Firecrawl credits total and one Serper search request**, across the entire acceptance session,
not 40 per scenario or child run. Use one shared acceptance ledger/transport boundary so child scenarios
cannot reset the allowance. Use two captures with per-capture cap 3: one public HTML source and one short
native-text public PDF with a known exact page excerpt. Start the manifest from the existing corpus
`scripts/research-retrieval-benchmark/cases.json`: use `nz-dynamic-price-html` for HTML and
`au-hardie-table-pdf` for the PDF. For PDF success assert `THERMAL PERFORMANCE` on physical page 2; for a
negative citation, request page 3 when only two physical pages were retained. Use a deterministic fixture
for the separate case where an excerpt occurs on another existing page. For HTML assert product identity,
not a hard-coded live price; "no online price" is not a numeric price. Preserve the exact corpus URLs in
the manifest. If retained evidence shows the candidate excerpt is unsuitable, resolve that during offline
manifest preparation and document the change before live execution, not after a paid failure.

With two real Firecrawl searches, conservative bound
is `2 + 2 + (1+3) + (1+3) = 12` Firecrawl credits; reserve against the actual manifest, not assumed lower
observed charges. The unused allowance is not permission to retry failed requests.

Execute once:

1. A public NZ/AU Firecrawl search and HTML capture through host tools; inspect normalized outcome/cache data.
2. A deterministic fake-model child run through the actual Firecrawl host adapters against the short PDF:
   search, capture, read physical page, submit known excerpt, and independently verify via ResearchStore.
   A controlled fake model may select the manifest URL if search ranking changes; record that selection.
3. A forced eligible primary-search failure injected before transport, followed by exactly one real Serper
   request. Label the Firecrawl failure synthetic; this verifies fallback wiring, not a live outage.
4. Repeated fetch/read calls prove no additional paid capture. Wrong-page submission and cross-run source
   references fail; these checks reuse already retained content.
5. Owner-only report includes requests with secret fields removed, hashes, page coverage, parser/caching
   policy, ordered attempts, actual/estimated/uncertain credits and assertions. No authorization headers,
   original PDF bytes or private content. Scan artifacts/checkpoint material for synthetic sentinel secrets
   in deterministic tests and real credential values in-memory during acceptance without printing them.

Report under `.data/research-runtime-acceptance/<timestamp>/`. Do not download original PDFs to compute
source hashes. Public-source availability/content may change: missing expected evidence is a failed
acceptance requiring review, not permission to weaken the assertion or search repeatedly until green.
A failed session retains receipts and stops. Another paid session needs a new explicit allowance.

S8 tests the implemented provider/tool boundary with a fake model, not live reasoning quality or a general
OCR benchmark. Replay the retained degraded-scan output offline for known misses; do not spend again on S0.

## 12. Mandatory acceptance matrix

| ID | Required behaviour | Evidence |
| --- | --- | --- |
| A1 | Defaults remain fake runtime; explicit Tavily/local works | resolver + API/adapter regression tests |
| A2 | Explicit public Firecrawl search/HTML/PDF configuration works | deterministic fixtures + S8 |
| A3 | Every allowed/disallowed fallback matches section 6 | search/capture table-driven tests |
| A4 | No private destination, secret-bearing URL or arbitrary headers; local DNS connection pinned | source-policy/transport tests |
| A5 | No provider keys in child, events, errors, sources, checkpoints or reports | sentinel leak tests + S8 inspection |
| A6 | Page IDs/counts/coverage and fresh-capture policy are truthful | malformed/capped/unknown/empty fixtures |
| A7 | Correct PDF page required at tool and store boundaries | wrong-page, forged-marker, tamper, cross-run tests |
| A8 | Retained late-page text is readable without recapture | beyond-50,000-character fake-model test |
| A9 | Concurrent/repeated/failed URL captures never cause a second paid attempt | in-flight + failure dedup tests |
| A10 | Credit/call limits reject before dispatch; unknown spend retains upper bound | concurrent ledger + abort/timeout tests |
| A11 | Cancellation/deadline cannot start fallback or publish late results | adapter/transport lifecycle tests |
| A12 | Known OCR misses do not become verified evidence; truncation stays visible | retained scan replay + final-result warnings |
| A13 | Historical sources verify compatibly; PDF evidence never uses HTML verifier | codec/store regressions |
| A14 | All registered checks pass, with no unexpected cancelled tests | S7 receipts |
| A15 | One bounded real-provider acceptance passes with no live model | S8 report and shared ledger |

Do not mark the slice fully accepted until A1–A15 are satisfied. It is valid to report
"implementation and deterministic qualification complete; live provider acceptance awaiting authorization."
Do not claim production activation or research quality from that status.

## 13. Rollout, rollback and completion report

After qualification, activate only by explicit operator configuration and `runtimeId: "deepagents"`.
Do not modify the application's fake default, existing saved runs, private PlanCheck pipeline or UI.

Search rollback: `RESEARCH_SEARCH_PROVIDER=tavily`, `RESEARCH_SEARCH_FALLBACK=none`, valid Tavily credentials.
Capture rollback: `RESEARCH_CAPTURE_PROVIDER=local`, `RESEARCH_PDF_PROVIDER=disabled`.
Keep all retained snapshots and evidence; rollback requires no database downgrade. Do not recapture historical
sources or change their hashes/provider metadata. Running jobs keep their frozen configuration.

The implementing agent's final report must list completed S steps/A criteria, changed files, actual check
results including cancellations, live calls/credits or "not run", retained evidence paths, remaining limits,
and Git publication state. Never call local checks CI, and never call a prepared configuration activation.

## 14. Provider references and contract drift

Checked during plan revision; inspect current official contracts before S8, especially charge bounds.

- [Firecrawl Search](https://docs.firecrawl.dev/features/search): search-only response/request shape and result-band pricing.
- [Firecrawl Parse](https://docs.firecrawl.dev/features/parse): URL scrape PDF options and physical-page output; aggregate markers are not an authoritative page index.
- [Firecrawl Faster Scraping](https://docs.firecrawl.dev/features/fast-scraping): explicit freshness/cache controls.
- [Firecrawl Enhanced Mode](https://docs.firecrawl.dev/features/enhanced-mode): current internal proxy handling; do not implement host retry logic from old examples.
- Existing Serper benchmark request mapping: `scripts/research-search-benchmark/providers.mjs`.

If a live contract differs, stop the affected live gate and document the mismatch. Update the narrow adapter
and deterministic fixtures deliberately; do not broaden the response parser or weaken evidence checks just
to accept an unexpected payload.
