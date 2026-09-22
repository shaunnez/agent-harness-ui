# Research Runtime — Vertical Slice: One Useful Research Agent

**Date:** 21 September 2026
**Branch:** `codex/research-runtime-vertical-slice`
**Scope:** one Deep Agents researcher with host-owned web search, bounded source fetching,
content-addressed snapshots and exact-excerpt evidence verification. No subagents, Qwen, RAG,
browser automation, UI expansion or production scheduling.
**Status:** deterministic implementation and durable evidence loop complete; live Tavily demo not
run because this environment has no Tavily credential.

## 1. Search provider

The first provider is Tavily Search through its HTTP API. It was chosen because one bounded POST
returns titles, URLs and discovery snippets, the API accepts a bearer credential, and the adapter
needs no SDK or new repository dependency.

Configuration:

- `TAVILY_API_KEY` or `RESEARCH_SEARCH_API_KEY`
- optional `RESEARCH_SEARCH_BASE_URL`
- optional `RESEARCH_SEARCH_PROVIDER=tavily`

The search key remains in the Eversor companion. It is never copied into the Deep Agents child.
Search snippets are discovery hints only and cannot become verified evidence.

## 2. Tool contracts

The worker can request four named tools over the existing NDJSON process channel:

1. `read_context({})`
2. `web_search({ query })`
3. `fetch_source({ url })`
4. `submit_finding({ claim, evidence, confidence?, assumptions? })`

`server/process-runtime.mjs` keeps stdin open only when explicitly requested. The research adapter
sends the initial worker configuration as the first NDJSON line, receives `tool_request` messages
on stdout, executes them in the parent and sends `tool_response` messages on stdin. Existing Codex
and Claude process calls retain the prior write-and-close behavior.

The child has no generic HTTP, shell or host-filesystem tool. Its only web-capable operations are
the four parent-dispatched contracts above.

## 3. Fetch security boundary

`fetch_source` is implemented by the parent and applies:

- HTTP/HTTPS scheme allowlisting;
- hostname resolution before each request;
- loopback, link-local, private, carrier-grade NAT, benchmark and multicast address rejection;
- redirect-by-redirect validation with a five-redirect maximum;
- a 15-second default timeout;
- a 1,000,000-byte default response limit, enforced from both `Content-Length` and the stream;
- HTML, XHTML and plain-text media-type allowlisting;
- non-executing HTML normalization with script, style, noscript and SVG removal;
- bounded content returned to the model.

This reduces SSRF exposure for the spike. It is not an OS network sandbox and does not eliminate
the DNS change between resolution and connection; production isolation remains later hardening.

## 4. Source snapshot format

Normalized source text is hashed with SHA-256 and written once to:

```text
.data/research-sources/<sha256>.txt
```

Files are mode `0600` and created with exclusive-write semantics. A pre-existing path is accepted
only if its content is byte-identical. The source event and database row carry:

```text
run-scoped source id
URL and title
retrieval timestamp
media type
normalized content byte count
content SHA-256
snapshotRef = sha256:<digest>
```

The API exposes metadata, not retained source bodies.

## 5. Evidence verification flow

1. The agent searches for candidate URLs.
2. The agent asks the host to fetch one URL.
3. The host validates the URL, fetches and normalizes it, writes the snapshot and announces
   `source.retrieved`.
4. The agent submits a claim, source id and literal excerpt.
5. The host rejects unknown/cross-run sources and any excerpt that is not an exact substring of
   the retained normalized content.
6. The worker receives a normalized finding carrying `quoteVerified: true`.
7. On durable result ingestion, `ResearchStore` distrusts that flag, reopens the file identified
   by the run's source row, recomputes its SHA-256 and repeats the substring test.
8. Only that independent host check writes `research_evidence.quote_verified = 1`.

The tool schema and parent validator both reject a model-supplied `quoteVerified` field.

## 6. Budget accounting

The parent owns one aggregate counter across all four tools. It enforces `maxToolCalls` before
dispatch and increments `maxSearchCalls` only for accepted `web_search` calls. The per-tool-name
LangChain middleware limits were removed because they did not form a true aggregate ceiling.

The final normalized usage includes:

- model calls;
- input and output tokens;
- aggregate tool calls;
- search calls;
- elapsed time;
- per-model usage where the provider reports it.

Tavily usage credits are retained in adapter-side search metadata. They are not converted to a
dollar figure because this implementation has no verified Tavily rate-card snapshot.

## 7. Demo command

The live command is deliberately opt-in because it can consume model and search-provider credits:

```bash
RUN_RESEARCH_DEMO=1 npm run research:demo
```

It requires an approved model credential plus `TAVILY_API_KEY` or `RESEARCH_SEARCH_API_KEY`. An
objective may be supplied after `--`; otherwise it uses the agreed New Zealand Sika waterproofing
question. It prints status, duration, retained source metadata, verified findings and usage.

## 8. Demonstrated output

The deterministic service-level acceptance run completed this path:

```text
Deep Agents model
  -> web_search (host)
  -> fetch_source (host)
  -> SHA-256 snapshot
  -> submit_finding with exact excerpt
  -> host verification
  -> durable source/finding/evidence rows
  -> quoteVerified: true after store re-verification
```

Its observed counts were one search call, three aggregate tool calls, one retained source and one
verified finding. This uses a local provider/source fixture and therefore proves behavior and
persistence, not live search quality.

## 9. Tests

Deterministic coverage includes:

- successful durable evidence loop;
- search ceiling and aggregate cross-tool ceiling;
- fetch timeout and streamed oversize response;
- unsupported URL scheme and private/loopback rejection;
- stable SHA-256 and immutable snapshot reuse;
- matching excerpt acceptance;
- non-matching excerpt rejection;
- cross-run source rejection;
- model self-verification rejection;
- store-side hash and excerpt re-verification;
- explainable search-provider failure;
- existing cancellation, checkpoint, failure-isolation and containment checks.

The live demo was not run: `ANTHROPIC_API_KEY` is available, but no Tavily credential is present.
No provider spend was attempted and no live cost/time result is claimed.

Final local qualification:

- focused research tests: 50 passed;
- full repository test suite: 621 passed;
- TypeScript type check: passed;
- Biome lint and formatting checks: passed;
- production build and Sites-build preparation: passed;
- `git diff --check`: passed.

## 10. Limitations

1. HTML and plain text only; PDFs and browser-rendered pages are deferred.
2. Tavily is the only search provider.
3. DNS validation reduces but does not fully eliminate rebinding risk.
4. Snapshot and checkpoint retention policies are still absent.
5. Companion-restart orphan reaping remains open.
6. Model dollar cost remains unavailable without a verified rate card.
7. Search-provider credits are observed but not translated into dollars.
8. This is one agent only; no fan-out or synthesis topology exists.

## 11. Exact next seam for bounded subagents

After one live demo is manually accepted, bounded fan-out stays inside `worker.mjs`:

- configure at most three named researcher subagents;
- keep `generalPurposeAgent: false`;
- omit delegation tools from children so depth remains structurally one;
- retain the same host tool channel, source store and verification path;
- share the parent-owned aggregate search/tool counters across every worker;
- add worker lifecycle events and partial-worker failure handling.

No change is required to `ResearchRuntime`, the database ownership split or the public routes.
