# Implement the bounded Firecrawl research runtime slice

Use this prompt only when Shaun explicitly starts implementation. The existence of this file is not a
start instruction or spending permission.

## Your task

Implement `research-agent-deepagents-spike-pack/06-FIRECRAWL-RUNTIME-IMPLEMENTATION-PLAN.md` (v2), steps S1–S7.
Read the entire plan before editing. It is the implementation contract; this prompt is its checklist.

Work in the research runtime worktree, not the dirty main checkout. At handoff it is:
`/Users/shaun/.codex/worktrees/research-runtime-vertical-slice/agent-harness-ui`, branch
`codex/research-runtime-vertical-slice`, base evidence commit `2802ac9`, PR #110.
Check current branch/HEAD/status before changing anything. Do not reset or discard other work. If this
worktree moved, locate the existing research branch rather than building against an unrelated checkout.

## Read and inspect

1. Applicable `AGENTS.md`.
2. The full v2 plan and `07-CURRENT-PDF-REPLACEMENT-GATE.md`.
3. `RESEARCH-RUNTIME-VERTICAL-SLICE.md`.
4. Existing host tools, Tavily provider, Deep Agents adapter/worker/child environment, research store,
   matching tests, package scripts, and benchmark request fixtures.

Then state a short plan for S1–S7 and implement in the specified order. Do not reopen the provider choice.
Do not launch subagents or create a new architecture. Use existing patterns and keep modules cohesive.

## Fixed decisions you must not reinterpret

- Firecrawl is selected for public search, HTML and PDF capture. Serper is only the specified search fallback.
- Private PDFs stay in the existing PlanCheck application. Do not build a private/local PDF adapter here.
  PlanCheck's cold transcription calls Anthropic; it is not on-device vision.
- Application default remains `fake`. Unconfigured Deep Agents retains Tavily/local HTML behaviour.
- Enabled capture is `firecrawl + firecrawl`; rollback is `local + disabled`. Reject mixed capture/PDF modes.
- Initial PDF parsing is forced `ocr`, with page cap at most 30. Do not silently switch to `auto` or retry.
- Capture uses URL `/v2/scrape`, with `maxAge: 0` and `storeInCache: false`. No original PDF downloads/uploads.
- New PDF snapshots are the plan's hashed, versioned JSON text envelopes, with structural physical-page IDs.
  Do not split provider aggregate Markdown with a page-marker regex. Preserve legacy HTML snapshots.
- Add bounded `read_source` so the model can read beyond the initial 50,000-character preview without recapture.
- Verify PDF quotations on the specified physical page at both host-tool and persistence boundaries.
- Deduplicate in-flight, successful and failed captures per run. Unknown charges retain their full reservation.
- Cancelled/deadline/budget/policy failures never trigger fallback. No SDK/application paid retries.
- Quote matching does not prove correct OCR, source authority, or that a claim follows from the excerpt.
- Do not add UI, RAG, subagents, default activation, cross-run caching, durable resume or SDLC changes.

## Execute and qualify

Complete each S-step's exit conditions before moving on. Use injected transports and fixture responses for
all development tests. Register the new tests in the explicit package.json test list. A new test file is
not automatically part of `npm test` in this repository.

Run the exact S7 checks. Inspect failures and cancelled tests; do not suppress, skip or weaken assertions.
The historical four cancelled tests are not permission to call a new suite green. If a failure is unrelated,
record the exact test/error and leave that qualification incomplete without rewriting unrelated workflows.

Build the S8 acceptance script and dry-run manifest, but do not make real provider/model calls unless Shaun
has separately authorized that execution in this session. Its allowance is 40 Firecrawl credits and one
Serper request for the entire session, shared across scenarios; it is not a reusable per-run grant.
No live model is required for S8. Do not rerun the completed PDF benchmark.

Do not print credentials, open environment files into tool output, modify historical benchmark reports,
publish, push, merge, or activate the route without the corresponding user instruction. Existing grants in
the active conversation take precedence; do not ask again for an action already explicitly authorized.

## Final handoff

Report S1–S8 and A1–A15 separately as passed, failed, not run or blocked, with evidence. Include:

- What changed and the important implementation decisions.
- Exact tests/checks actually run, including failed/cancelled/skipped counts.
- Live calls/usage, or explicitly that no live calls occurred.
- Paths to deterministic qualification and acceptance artifacts.
- Any unresolved contract mismatch or limitation.
- Local commit/PR/push/activation state without conflating them.

If S1–S7 are complete and live execution has not been authorized, leave the dry-run manifest ready for review
and report: "Implementation and deterministic qualification complete; live provider acceptance not run."
Do not claim the full slice is accepted before S8 passes.
