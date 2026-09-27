# Research batch throughput plan

**27 September 2026 — plan for the next implementation turn.** This document does not start a paid run or deploy the service.

## Outcome and acceptance

Research a PlanCheck batch of **100 or more distinct questions**, with the existing three-run first stage and up to five runs per question. Every item must settle to a graded answer, which may legitimately be `no_price` or `review`; infrastructure failures remain visible and fail acceptance. A batch is not complete while items are queued or running. Target **100 items in 30 minutes or less**, accept **under 60 minutes**, and treat **15 minutes** as a stretch target to qualify only if the provider and host sustain it. Measure from accepted batch request to the last item settling. Report pricing quality and citation checks alongside speed; a faster batch with more unassessed or incorrect prices does not pass.

Keep the current research boundary: API loop only, DeepSeek 4.1 Flash through the selected approved provider, host-checked citations, PlanCheck QV, Parallel search, research-only image. Do not silently change the three-then-two decision rule, grading, prompt, per-run ceilings, or provider while measuring throughput. No production deployment or catalogue publishing is part of this plan.

## Current baseline and capacity model

- `apps/research-service` accepts up to 200 items in one authenticated batch and persists them in Postgres. The local service uses PGlite; production-like qualification needs Postgres.
- Its DeepInfra pacer starts at three active runs and is capped at six by local configuration (`RESEARCH_INITIAL_CONCURRENT_RUNS=3`, `RESEARCH_MAX_CONCURRENT_RUNS=6`). The current learned limit was four on 27 September. It grows after 20 clean model calls, halves on a 429, and obeys `Retry-After`.
- `BatchWorker.tick()` calls `#ask()` sequentially. An external question first makes a tools-less model call to scope it; one slow scope therefore holds back admission of the next item. `questionLimit` divides run slots by five even though a staged five-run question starts only three runs. The worker and research runtime are still in one process.
- The earlier two-item Fireworks/PlanCheck check finished in 82 seconds. There is no successful 100-item DeepInfra batch and no completed local DeepInfra question to use as a throughput claim. The failed asbestos question was caused by PlanCheck's local API being stopped; its three spent calls remain recorded and are not a valid latency sample.

At a **four-minute average elapsed time per question** with concurrent runs, the minimum number of questions in flight is `ceil(100 × 4 / target_minutes)`:

| Batch time | Questions in flight | Three-run first-stage slots | If all five run at once |
| --- | ---: | ---: | ---: |
| 60 min | 7 | 21 | 35 |
| 30 min | 14 | 42 | 70 |
| 15 min | 27 | 81 | 135 |

This is scheduling arithmetic, not a promise. Six-minute items, staged extensions, tails, slow scoping, host memory, PlanCheck, Parallel, provider output throughput and 429s can raise the required capacity. The reported DeepInfra **200 concurrent requests** is a user-supplied account figure to verify before scaling; it is neither a 200-question quota nor proof of 200 useful research runs.

## Implementation slices

### 1. Make admission concurrent and bounded

In `apps/research-service/src/batches.mjs`, scope/ask several claimed items concurrently under an explicit small scoper limit, without allowing the tick loop to overlap itself. Keep item claiming idempotent under `FOR UPDATE SKIP LOCKED`, reuse existing questions for repeated source IDs, and preserve item order and failure records. Admit enough questions to fill **three initial run slots per staged question**, with a bounded spare window; account for queued and active runs so the extra two runs can still start when needed. A slow or failing scope must not block unrelated items. Scoping calls must share the provider's actual in-flight request allowance with research calls; the present pacer mainly limits active research runs and delays calls after a throttle.

Keep the durable batch queue rather than creating hundreds of in-memory research runs at submission. Confirm restart recovery for claimed-but-unasked items, runs queued before start, and partially completed staged questions. Do not automatically replay runs that already spent model calls.

### 2. Raise capacity with measured controls

Expose a configurable per-provider run target and separate bounded limits for scoping and search/QV I/O. Start the qualification ladder at **12, 24, 48, then 64 active runs**, keeping additive growth, 429 reduction and `Retry-After`. Avoid setting 200 merely because DeepInfra advertises that account ceiling. Keep the model choice pinned to each question and its later runs.

First try one service process with Postgres. Observe RSS/heap, CPU, event-loop lag, HTTP connection use and PlanCheck response time. If it cannot sustain the run target, separate batch workers from the HTTP service and run multiple workers against the existing Postgres claim queue; the provider-wide pacer must divide the account allowance across workers. This scale-out step is conditional on evidence, not a prerequisite abstraction.

### 3. Make batch performance and spend visible

For each batch, record accepted, scoped, queued, running, completed, failed and review-needed counts; queue age; scope, run and total latency distributions; three-to-five extension rate; in-flight calls and runs; DeepInfra 429s and retry time; Parallel and PlanCheck calls, errors and latency; provider-reported model cost, API-rate estimate, and an estimated Parallel search cost. Expose an operator-readable batch summary without logging credentials or unnecessary tender text.

Add an admission guard for a paid qualification batch: stop starting new items when measured spend plus an explicit allowance for already-active items reaches its approved cap. This is a **soft scheduling guard** because provider usage arrives after calls; do not describe it as an exact billing cap. Retain all incomplete items in the queue with a visible reason. Use the provider's own account controls for any hard financial ceiling.

### 4. Verify without provider spend

Use a fake delayed DeepInfra transport, Parallel transport and PlanCheck rate library against **real Postgres**, with 100 and 200-item batches. Check throughput/admission, no duplicate questions, 429/cooldown, slow/failing scopes, QV outage, staged extensions, restart and multiple-worker claims. Keep the same grading and evidence checks; compare representative recorded answers before and after. Run the relevant research service tests, engine question/boundary tests, typecheck, lint, research console build and production image contents check. Do not weaken tests to make a higher limit pass.

### 5. Paid qualification, after a concrete spend approval

Use representative synthetic or approved scrubbed items with both QV-heavy and web-heavy work. Run distinct **10-item and 25-item pilots**, then a **fresh 100-item batch submitted at once**. No item ID or identical ask may be reused for the timed 100-item acceptance run: reuse would make throughput look better without doing the work. This is up to **135 paid items** in all. Record the selected model, code SHA, question set, rate-card snapshot, concurrency settings and each item's start/end/grade/cost. Compare at 12/24/48/64 only as needed; do not rerun an entire paid window for each setting. After the 25-item pilot, extrapolate from provider-reported cost and measured search use before authorizing the fresh 100-item batch.

Stop and diagnose if the PlanCheck/Parallel dependency is unhealthy, provider 429s persist, citation/grade quality regresses, a run starts on the wrong model, measured spend approaches the cap, or memory threatens the service. A 100-item result passes the delivery gate only when every item settles without infrastructure failure, total time is under 60 minutes, and answer quality has not regressed. Thirty minutes is the target for tuning; fifteen minutes is attempted only after the 30-minute gate is stable and the required capacity is supported by measurements.

## Cost estimate and funding recommendation

The **15 recorded F10 held-out questions** contain 75 Fireworks runs through this same API loop. They are a workload-shape proxy, **not measured DeepInfra billing**. Averaged per question, their first three runs used about **1.025 million input tokens** (798,000 cached), **51,000 output tokens**, **30 model calls** and **12 Parallel searches**. All five used about **1.760 million input tokens** (1.377 million cached), **90,000 output tokens**, **51 model calls** and **20 searches**. The local DeepInfra provider's deliberately conservative estimate uses **$0.20 input / $0.60 output / $0.006 cached per million**; [DeepInfra's current model page](https://deepinfra.com/deepseek-ai/DeepSeek-V4.1-Flash) advertises a promotional **$0.14 / $0.42 / $0.004**. Recheck the live rate before any paid run.

The code uses Parallel Search **advanced** mode. [Parallel lists it at $5 per 1,000 requests](https://parallel.ai/products/search), with a public Search rate limit of 600 requests/minute; the actual account allowance and credits must be checked. Assume no free credits and no cache benefit for this estimate.

| 100 distinct items | DeepInfra at promotional rate | DeepInfra at conservative rate | Parallel advanced search | Combined conservative estimate |
| --- | ---: | ---: | ---: | ---: |
| Three runs each | ~$5.65 | ~$8.09 | ~$6.10 | ~$14.19 |
| Five runs each | ~$9.69 | ~$13.88 | ~$9.95 | ~$23.83 |

The actual staged batch should fall between those rows if the sample predicts its token and search use. Scoping, retries, harder items, provider rate changes, additional captured-page charges if a provider changes, and repeat test windows add cost. These figures exclude Azure/host costs and are **not a quote or a hard ceiling**.

**Recommendation:** the existing **$5 DeepInfra balance** should cover a 10-item pilot and likely a 25-item pilot, subject to live usage. Before the fresh 100-item batch, bring the DeepInfra balance to **$30 total** (add about **$25**), and reserve **$20 of Parallel credit** if the account has no usable free allowance. All three windows (135 distinct items) project to about **$8–$19 DeepInfra**, depending on price and three versus five runs, and up to **$13.45 Parallel** at the recorded token/search shape. The balances leave room for harder items and retries; they are not hard guarantees. Do not top up or run a paid batch merely because this plan exists. After the 25-item pilot, replace the proxy with actual DeepInfra `providerReportedCostUsd` and Parallel usage, then request a revised cap if the forecast exceeds these amounts.

## Ownership, gates and continuation

- Research service owns admission, shared provider pacing, batch metrics and recovery. Research engine retains run lifecycle, stage decision, citations and model usage. PlanCheck remains the QV rate-library owner and batch client; no PlanCheck pricing or catalogue logic changes here.
- Preserve the current dirty `main` checkout and its uncommitted DeepInfra picker/provider work. Before editing, record branch/HEAD/status and inspect the current diff; make only intended changes. Do not create a PR, deploy to Azure, alter production credentials, top up accounts or submit a paid run without a separate request covering that action.
- Implementation is authorized for the continuation after compaction. Finish the code, deterministic tests and production-like nonpaid qualification first. Present the exact pilot items, environment, model, estimated cap and stop rules for the separate paid-run approval.

**Continuation prompt:** In `/Users/shaun/projects/agent-harness-ui`, execute `research-agent-deepagents-spike-pack/33-RESEARCH-BATCH-THROUGHPUT-PLAN.md` through slices 1–4. Preserve the existing dirty DeepInfra provider and console work. Confirm repository status and the current service code, implement bounded concurrent admission and scaled pacing, add focused observability and spend guard, then qualify 100/200 items without provider spend against Postgres. Run the named checks and inspect the final diff. Report the measured nonpaid capacity, remaining risks and a concrete paid pilot proposal. Stop before a paid DeepInfra/Parallel run, account top-up, PR, merge or deployment unless explicitly authorized.
