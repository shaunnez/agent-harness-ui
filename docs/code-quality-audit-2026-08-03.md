# Code-quality audit — 2026-08-03

## Audit basis

- Audited revision: `4c9d56813ae1787f9099d24efd5a8f67ed90234f` (`origin/codex/evidence-gate-ui-convergence`).
- Scope: frontend, local HTTP companion, orchestration, persistence, worktree/Git safety, prompts and context manifests, and tests.
- Method: static entry/import tracing, state-transition tracing, boundary review, test-to-contract comparison, and production/test file-size inventory.
- Change boundary: this report is the only repository change. Production code was not modified.

## Executive result

No P0 issue was found. Six P1 issues can violate the local security boundary, merge the wrong checkout, lose the authoritative workflow state, or advance a candidate on contradictory evidence. Nine P2 issues can strand workflows, show stale or false evidence, or undermine concurrency and reproducibility. Four P3 findings account for most of the maintenance cost and brittle coverage.

The most urgent sequence is:

1. Close the HTTP/Vite origin boundary and stop inheriting arbitrary environment secrets into agents.
2. Make merge approval branch-bound, idempotent, and recoverable across persistence failure.
3. Replace read/check/write action flows with atomic state transitions.
4. Make gate evidence a validated candidate-bound contract rather than reparsed prose.
5. Add the missing failure, concurrency, migration, and browser suites before deleting the proven prototype island.

## Production entry and deletion graph

The production entry is `src/main.tsx:7` → `src/App.tsx:53` → `src/components/RuntimeTaskWorkspace.tsx:40`. `App` imports only `RuntimeTaskWorkspace` for task workspaces at `src/App.tsx:24` and renders it at `src/App.tsx:193-241`.

The older prototype is a disconnected island:

```text
production
src/main.tsx
  └─ src/App.tsx
       └─ src/components/RuntimeTaskWorkspace.tsx
            └─ CandidateDiffViewer + CandidateDiffErrorViewer
               (the only production exports used from StageViews.tsx)

unreachable from production entry
src/components/TaskWorkspace.tsx
  ├─ src/components/LiveRun.tsx
  │    └─ domain.ts::baseEvents
  └─ StageViews.tsx::StageView
       ├─ domain.ts::acceptanceCriteria
       └─ prototype stage data/artifacts

test-only reachability
tests/runtime.test.mjs:743-816 → StageView
tests/runtime.test.mjs:967-968 → loads all of StageViews.tsx
```

Evidence:

- `src/components/TaskWorkspace.tsx:10` exports `TaskWorkspace`, but no production file imports it.
- `src/components/LiveRun.tsx:22` is imported only by `TaskWorkspace.tsx:4`.
- `src/components/StageViews.tsx:62` exports `StageView`, imported only by `TaskWorkspace.tsx:6` and loaded directly by the test helper.
- The live workspace imports only `CandidateDiffViewer` and `CandidateDiffErrorViewer` from `StageViews.tsx` at `src/components/RuntimeTaskWorkspace.tsx:37`; those exports occupy `src/components/StageViews.tsx:2286-2410`.
- `domain.ts::recentTasks` (`src/domain.ts:624-690`) has no consumer. The similarly named value in `CommandCentre.tsx:50` is a different local variable derived from real tasks.
- `domain.ts::baseEvents` (`src/domain.ts:692-812`) is consumed only by the disconnected `LiveRun`/`TaskWorkspace` island.
- `domain.ts::acceptanceCriteria` (`src/domain.ts:814-820`) is consumed only by the prototype `StageView` path.

This is sufficient source-level proof to extract the two candidate-diff viewers and delete `TaskWorkspace.tsx`, `LiveRun.tsx`, the remainder of `StageViews.tsx`, their prototype-only test, and the three prototype fixtures. CSS deletion still needs selector coverage and browser screenshots because dynamic class construction makes a string-only CSS scan non-authoritative.

## Size and concentration

| File | Lines | Audit consequence |
| --- | ---: | --- |
| `src/styles.css` | 7,336 | Live and prototype selectors are interleaved; safe deletion is unnecessarily expensive. |
| `src/components/StageViews.tsx` | 2,913 | About 125 lines are production-used diff viewers; the rest is prototype/test reachability. |
| `src/components/RuntimeTaskWorkspace.tsx` | 2,274 | Routing state, commands, every stage presentation, artifacts, worktrees, activity, and dialogs share one module. |
| `server/orchestrator.mjs` | 942 | Transition policy, parallel scheduling, agent execution, gate parsing, repair, usage, and persistence are coupled. |
| `src/domain.ts` | 820 | Runtime contracts, formatting, workflow metadata, and obsolete fixtures are mixed. |
| `server/api.mjs` | 643 | HTTP boundary, route policy, Git-backed reads, evaluation aggregation, and process helpers are coupled. |

## Findings

### P0

No P0 finding was established at the pinned revision.

### P1-1 — Browser and dev-server boundaries permit unauthorized local mutations

**Evidence.** `vite.config.mjs:11-19` binds the web server to `0.0.0.0` and proxies `/api` to the loopback companion. `package.json:8` exposes that configuration directly as `npm run dev:web`. The companion itself is loopback-bound (`server/index.mjs:19-20`), but `server/api.mjs:115-129` performs no `Host` or `Origin` validation. Its `OPTIONS` response lists one origin at `server/api.mjs:119-124`, but CORS only controls response visibility. `readJson` accepts JSON regardless of `Content-Type` (`server/api.mjs:19-29`), so a browser can send a simple `text/plain` no-CORS POST. State-changing actions, including merge approval, are reachable at `server/api.mjs:391-423`.

**Root cause.** Loopback binding and a CORS preflight response are treated as authorization. The Vite proxy also turns a network-visible frontend into a bridge to the loopback API.

**Impact.** A malicious web page, another local user context, or a client able to reach the Vite host can start agents, change settings, close tasks, or approve a Git merge without reading the response.

**Fix.** Bind Vite to `127.0.0.1` in configuration as well as the combined launcher; validate the exact `Host` and allowed `Origin` before every request; require `application/json` plus a per-process unguessable CSRF token for mutations; do not proxy the companion from a network-visible preview.

**Verification.** Add HTTP tests for foreign/missing `Origin`, hostile `Host`, and `text/plain` simple POSTs against `run`, `close`, settings, and `approve-merge`; assert rejection occurs before any store/orchestrator call. Add a launcher smoke test that observes only a loopback listener.

### P1-2 — Approval can fast-forward the wrong checked-out branch

**Evidence.** Candidate preparation records `baseBranch` at `server/git-worktree.mjs:43-44` and Human Approval displays it. Merge checks only cleanliness and `HEAD === candidate.baseRevision` at `server/git-worktree.mjs:137-147`, then executes `git merge --ff-only` at line 148. It never checks the current symbolic branch against `candidate.baseBranch`. The sole real Git test merges without switching branches (`tests/git-worktree.test.mjs:12-46`).

**Root cause.** Revision identity is enforced, but target-ref identity is not.

**Impact.** If the user checks out another branch that points at the same base commit after candidate creation, **Approve & merge** fast-forwards that other branch while the persisted approval record claims the original target was merged.

**Fix.** Immediately before merge, require a non-detached symbolic `HEAD` equal to the recorded target ref and re-check both branch and revision in the same guarded merge operation. Store a full ref (`refs/heads/...`), not only display text.

**Verification.** Extend `git-worktree.test.mjs` with sibling-branch-at-same-SHA, detached-HEAD, renamed-branch, dirty-target, and moved-target cases; all but the exact recorded ref/base pair must fail without changing any ref.

### P1-3 — Git merge and workflow persistence are a non-recoverable split transaction

**Evidence.** `TaskOrchestrator.approveMerge` mutates Git first at `server/orchestrator.mjs:237-243`, then writes candidate/task/approval state at `server/orchestrator.mjs:244-271`. `JsonTaskStore` writes only after cloning a mutation (`server/store.mjs:292-305`). A write error or process loss after line 243 leaves Git merged while the task remains `awaiting-human-approval`; retry then fails the old-base check at `server/git-worktree.mjs:140-143`. Startup recovery only translates tasks whose status is `running` (`server/store.mjs:266-280`); it does not reconcile merge intent or refs.

**Root cause.** An irreversible external side effect is performed before any durable intent record, with no idempotency/reconciliation protocol.

**Impact.** The repository and UI can permanently disagree about whether approval occurred. The operator may see a failed approval even though code is already on the target branch.

**Fix.** Persist an `approval-merging` intent containing task, candidate, exact head, target ref, and base; perform the guarded fast-forward; persist completion. On startup and retry, reconcile the target ref against the intent and finalize only the exact expected head. Keep the JSON store; this concrete cross-resource operation only needs a small recoverable transaction record, not a general event ledger.

**Verification.** Inject store failures before intent, after intent, and after Git merge; restart a fresh orchestrator/store and assert deterministic rollback-or-finalization with one approval record and no duplicate merge.

### P1-4 — Workflow checks and transitions race with close, run, and approval requests

**Evidence.** Close reads a task and checks `status` at `server/api.mjs:296-305`, then performs a later unconditional update at `server/api.mjs:310-324`. Action routes independently read at `server/api.mjs:394-400`, gate the stale snapshot at `server/api.mjs:462-504`, and start at line 505. The orchestrator's run then reads again and unconditionally sets `running` at `server/orchestrator.mjs:282-306`. Grill answer and finish have the same read-then-update pattern at `server/orchestrator.mjs:134-163` and `166-202`.

**Root cause.** The serialized store queue prevents torn JSON writes, but there is no atomic compare-and-transition operation. Business preconditions are evaluated outside the queued mutation.

**Impact.** Concurrent close/start requests can leave a closed task executing or resurrect it as running. Concurrent Grill finish/answer requests can start specification synthesis with one assumption and later overwrite the recorded decision. Duplicate approvals/events are also possible.

**Fix.** Add a store transition primitive that evaluates expected status/stage/version and applies the mutation inside one queued operation. Reserve a run durably before spawning it. Close must atomically reject an active reservation; Grill finish must atomically close the session and snapshot decisions.

**Verification.** Use barriers to issue `close + implement`, `close + run`, `finish + answer`, duplicate spec approval, and duplicate merge approval concurrently. Assert one legal terminal state, one event/approval, and no agent call after close.

### P1-5 — A candidate can advance while structured test evidence is failed, invalid, or bound elsewhere

**Evidence.** The gate verdict accepts prose `PASS` using only the first 1,000 characters (`server/orchestrator.mjs:892-900`). Test evidence defaults every unknown top-level status to `passed` at `server/structured-output.mjs:48-65` and every unknown row status to `passed` at `server/structured-output.mjs:179-212`. It never compares the reported candidate ID/revision with the actual candidate, and does not require a `passed` payload to have zero failed rows. The orchestrator stores that evidence and advances solely from the prose verdict at `server/orchestrator.mjs:658-699`. The existing fixture itself has top-level `passed` and a failed row (`tests/orchestrator.test.mjs:13`), while parser tests assert the failed row is accepted (`tests/orchestrator.test.mjs:98-109`).

**Root cause.** Narrative verdict, command telemetry, structured result, and candidate identity are independent inputs with no consistency validator.

**Impact.** Test can advance to Final Review and eventual merge while the displayed structured evidence contains a failing check, or while the structured evidence names another candidate/revision.

**Fix.** Persist an explicit gate result. Require the structured test block; reject unknown statuses; require parent and every row to match the active candidate/revision; derive overall status from rows and command results; permit `PASS` only when all required checks passed. Apply an equivalent candidate/verdict schema to Dev Review and Final Review, including P0/P1 blocking rules.

**Verification.** Add table tests for wrong candidate, wrong revision, unknown status, mixed rows with top-level pass, missing block, prose PASS plus command failure, prose PASS plus P0/P1, and a fully consistent pass.

### P1-6 — Agent subprocesses inherit unrelated credentials and secrets

**Evidence.** `runCodex` clones all of `process.env` at `server/codex-runtime.mjs:182` and removes only `OPENAI_API_KEY` and `CODEX_API_KEY` at lines 183-184. Both read-only and workspace-write agents receive that environment. Prompts ask the model not to access credentials (`server/prompts.mjs:90`, `132`, `182`), but this is not an enforcement boundary.

**Root cause.** Authentication convenience is implemented with a denylist over a broad inherited environment.

**Impact.** Repository prompt injection or an accidental diagnostic command can expose GitHub, cloud, database, package-registry, or CI secrets in retained output even when network access is restricted.

**Fix.** Build a minimal environment allowlist for process execution (OS essentials, PATH, temp, user/Codex home required for ChatGPT auth), explicitly exclude credential-pattern variables, and redact known secret patterns from persisted errors/events/artifacts as defense in depth.

**Verification.** Seed fake `AWS_SECRET_ACCESS_KEY`, `GH_TOKEN`, database URL, and arbitrary secret variables in a subprocess test; assert the child cannot observe them while Codex-home discovery and login status still work.

### P2-1 — Async frontend responses are not bound to the requested task or candidate

**Evidence.** `refreshActiveTask` always applies the first task response at `src/App.tsx:83-90`. Route changes start requests without an abort signal or generation token at `src/App.tsx:107-135`. A slow task A response can therefore overwrite task B after navigation. Candidate diff loading similarly applies any completed request at `src/components/RuntimeTaskWorkspace.tsx:148-160`, while the overlay labels it using the latest candidate props at `src/components/RuntimeTaskWorkspace.tsx:528-540` rather than the response identity.

**Root cause.** Async results are stored without request identity checks.

**Impact.** The URL/inspector can show the wrong task, or a repaired candidate can be labelled with an older diff until the user closes/refetches it.

**Fix.** Use an `AbortController` or monotonically increasing request ID per route/candidate request; apply only if route task ID and expected candidate head still match. Build overlay identity from the response and assert it matches the requested tuple.

**Verification.** Browser/component tests should deliberately resolve A after B and old candidate after repaired candidate; the stale responses must be ignored.

### P2-2 — Cancellation marks a run finished before the OS process is known to be dead

**Evidence.** On abort or timeout, `runProcess` calls `child.kill()` and immediately rejects via `finish` at `server/codex-runtime.mjs:269-283`; it does not await `close`, kill descendants, or verify termination. It also registers an abort listener at line 285 without first handling an already-aborted signal. The orchestrator removes the task from its active map when that promise settles (`server/orchestrator.mjs:104-110`), allowing a retry while the old process can still be terminating.

**Root cause.** Process termination is treated as synchronous and single-process.

**Impact.** A cancelled workspace-write agent can continue touching the candidate while a retry or recovery begins, especially through wrapper/child processes.

**Fix.** Reject immediately if `signal.aborted` before spawn; terminate the process tree/job; wait for `close` with a bounded escalation to force kill; settle the run only after termination. Keep the task in a `cancelling` reservation until then.

**Verification.** Spawn a fixture parent with a file-writing child, cancel and timeout it, and assert both processes exit and file writes stop before the orchestrator allows another run.

### P2-3 — Work-package ownership is advisory and overlap detection misses real collisions

**Evidence.** The parser detects only exact string equality between independent package paths (`server/structured-output.mjs:138-145`), so `src` and `src/App.tsx`, case variants on Windows, or equivalent normalized directory/file scopes can run in parallel. The prompt explicitly permits adjacent edits (`server/prompts.mjs:189-200`). Commit accepts every nonsensitive/non-generated changed file at `server/git-worktree.mjs:82-100`; the orchestrator does not compare `committed.files` with `ownedPaths` at `server/orchestrator.mjs:628-645`.

**Root cause.** Ownership is model guidance rather than a normalized scheduler/qualification contract.

**Impact.** Supposedly independent slices can edit overlapping surfaces, conflict at assembly, or silently exceed approved scope.

**Fix.** Canonicalize paths with repository/platform case rules; detect ancestor/descendant and glob overlap; qualify each package commit against its declared scope plus a small explicit approved-exception list; reject or route overlaps into dependency order.

**Verification.** Cover exact, hierarchical, separator, dot-segment, glob, symlink/reparse, and Windows case collisions; add a commit-scope failure test and an explicitly approved adjacent-edit case.

### P2-4 — Test-created dirt can permanently strand retry

**Evidence.** Test runs are upgraded to `workspace-write` and put temp under the candidate at `server/orchestrator.mjs:777-801`. Candidate cleanliness is checked after test at `server/orchestrator.mjs:658-665`. If that check fails, generic failure handling resets candidate status to `ready_for_test` (`server/orchestrator.mjs:317-333`). A retry begins with the same cleanliness check at line 661, while recovery is invoked only by Repair (`server/orchestrator.mjs:703-717`).

**Root cause.** The test stage is allowed to write but has no finally cleanup/reconciliation path for cancellation, failure, or generated output.

**Impact.** One interrupted or output-producing test can make every retry fail before an agent starts, requiring manual worktree cleanup.

**Fix.** Put harness temp outside the candidate; snapshot tracked/untracked state; run tests; retain evidence; clean only harness-owned paths in `finally`; if repository tests dirty other paths, surface a recoverable cleanup decision rather than looping on `ready_for_test`.

**Verification.** Exercise untracked output, ignored output, tracked modification, abort, timeout, and failed cleanup; retry must either start cleanly or present one explicit recoverable state.

### P2-5 — Context manifests overstate supplied task text

**Evidence.** Stage and execution prompts include at most 6,000 description characters (`server/prompts.mjs:94-102` and `134-143`). `makeContextManifest` reports up to 10,000 included characters and only marks descriptions over 10,000 as truncated (`server/prompts.mjs:299-310`).

**Root cause.** Prompt caps and manifest accounting use duplicated constants.

**Impact.** For descriptions of 6,001-10,000 characters, the UI claims text was supplied when it was not and says it was not truncated, violating the recorded context contract.

**Fix.** Construct prompt fragments and source accounting from the same capped value; test exact boundary values and include prefix/field accounting rules explicitly.

**Verification.** Assert manifests for 5,999, 6,000, 6,001, 10,000, and 10,001 characters match the actual substring embedded in each prompt type.

### P2-6 — Bundled fallback models are presented and accepted as locally discovered

**Evidence.** A missing/empty cache returns `FALLBACK_MODELS` with source `Bundled fallback catalog` (`server/model-catalog.mjs:96-118`). Settings nevertheless says all entries were “Discovered from the local Codex model catalog” and makes them selectable (`src/components/LibraryScreens.tsx:360-395`). API validation treats the fallback entries as known and executable (`server/api.mjs:143-164`, `248-259`). `RuntimeModelOption` has no configured/discovered/supported state (`src/domain.ts:387-400`).

**Root cause.** Catalog metadata conflates documentation fallback with runtime capability discovery.

**Impact.** Users can configure a model the local CLI did not report, and task execution then fails late. The UI makes an unsupported availability claim.

**Fix.** Carry per-model provenance/capability (`discovered`, `configured`, `fallback-unsupported`); permit execution settings only for discovered or separately verified models; label fallback entries as reference metadata.

**Verification.** Test missing cache, empty cache, stale configured model, and partially discovered catalogs through status, settings save, new-task creation, and UI copy.

### P2-7 — Persistence has no schema version or deterministic migration boundary

**Evidence.** The persisted root starts as `{ nextId, tasks, settings }` without a version (`server/store.mjs:6`). Init parses arbitrary JSON directly (`server/store.mjs:52-61`) and `recoverInterrupted` performs property/status heuristics in place (`server/store.mjs:153-283`). API advertises runtime schema version 3 (`server/api.mjs:10`, `130-140`), but that version is not tied to the file. Existing persistence coverage tests only a running-task restart (`tests/runtime.test.mjs:77-101`).

**Root cause.** Crash recovery, default filling, repricing, and migrations are combined without a persisted source-version contract.

**Impact.** Older or partially written shapes can be silently reinterpreted, fail startup, or lose reproducibility. There is no fixture-backed proof that each historical shape migrates once and preserves candidate/gate identity.

**Fix.** Add a persisted schema version, validate the root before use, run ordered idempotent migrations with a backup/temporary file, and keep interruption recovery separate from schema migration.

**Verification.** Maintain golden fixtures for every released shape, current round-trip, repeated migration, malformed/truncated JSON, failed rename, and candidate/approval/history preservation.

### P2-8 — Evaluation metrics reparse prose and can contradict actual gate behavior

**Evidence.** Gate execution accepts both leading `PASS` and a `## Verdict`/`PASS` form and forces test repair on command telemetry (`server/orchestrator.mjs:892-900`). Persisted artifacts do not carry an explicit verdict (`src/domain.ts:146-162`). The scorecard later calls only `/^\s*PASS/` on artifact prose (`server/api.mjs:517-578`), ignoring command failures and structured rows. Thus a heading-form pass is counted as repair, while `PASS` plus a failed command is counted as pass even though the orchestrator rejected it.

**Root cause.** The same semantic result is independently inferred from prose in two places.

**Impact.** Model comparison gate-pass and repair counts are not trustworthy.

**Fix.** Persist normalized gate outcome, candidate binding, blocking findings, and repair lineage when the gate runs; aggregate those fields only. Mark legacy prose-only artifacts `unknown`, not pass/repair.

**Verification.** Add scorecard tests for every accepted verdict syntax, command-failed override, failed structured row, repair revision, and legacy artifact.

### P2-9 — Candidate-bound artifact freshness is optimistic when binding is missing

**Evidence.** `isArtifactFresh` returns `true` whenever candidate ID/revision is absent (`src/components/RuntimeTaskWorkspace.tsx:586-592`), including Dev Review/Test/Final Review artifacts that must be candidate-bound. Stage summary also selects the newest structured test evidence without checking its candidate revision (`src/components/RuntimeTaskWorkspace.tsx:594-598`).

**Root cause.** “Unbound” is collapsed into “fresh” to support old artifacts.

**Impact.** Migrated or malformed gate artifacts can be labelled “Current evidence,” and stale test counts can appear after repair.

**Fix.** Define freshness by stage: pre-candidate artifacts may be unbound; candidate gates require exact ID/revision; missing binding is `unbound/legacy`, never fresh. Filter focused summaries by the exact current candidate.

**Verification.** Render current, stale, wrong-ID, wrong-revision, and unbound artifacts before and after repair; only exact candidate-bound gates should be fresh.

### P3-1 — The obsolete prototype remains a large maintenance and test surface

**Evidence.** The deletion graph above proves `TaskWorkspace.tsx` and `LiveRun.tsx` are unreachable and most of `StageViews.tsx` is retained only by a prototype-only test. Those files contain fabricated candidates, agents, tokens, costs, timestamps, artifacts, and providers (for example `src/components/LiveRun.tsx:194-281` and `src/components/StageViews.tsx:2420-2639`). `domain.ts` retains matching mock tasks/events/criteria at `src/domain.ts:624-820`.

**Root cause.** Runtime convergence added a second implementation without extracting the few shared viewers and deleting the old path.

**Impact.** Searches and reviews encounter two incompatible workflow truths; tests can stay green by exercising UI that users cannot reach; fabricated metrics remain one accidental import away from production.

**Fix and verification.** Follow the deletion sequence below and prove the production route/build, focused runtime tests, Sites packaging, selector coverage, and three browser widths after each deletion batch.

### P3-2 — Oversized modules duplicate contracts and make safe change isolation difficult

**Evidence.** The size table identifies five production modules over the roughly 500-line boundary. Workflow skill metadata is duplicated with different names in `src/domain.ts:563-620` and `src/components/RuntimeTaskWorkspace.tsx:549-560`; Library screens use the former (`src/components/LibraryScreens.tsx:163-220`) while the task inspector uses the latter (`src/components/RuntimeTaskWorkspace.tsx:351-376`). Status and stage presentation logic are similarly distributed across `domain.ts`, `RuntimeTaskWorkspace.tsx`, API action tables, and orchestrator transition branches.

**Root cause.** View composition, contracts, state policy, and formatting grew in place rather than around shared typed projections.

**Impact.** The same stage can display different capability names, and fixes require touching oversized files with broad regression risk.

**Fix.** Establish shared stage/status/gate contracts first, then split by cohesive feature as sequenced below; do not cosmetically split large files while leaving duplicated policy.

**Verification.** Contract tests should assert one metadata row per stage/role and exhaustively map every persisted status/action.

### P3-3 — The test and static-analysis gates miss the riskiest behavior

**Evidence.** `npm run lint` and Biome include only `src` (`package.json:10`, `biome.json:3-5`); TypeScript also includes only `src` and disallows JS (`tsconfig.json:6`, `21`), so `server`, `worker`, scripts, and tests receive neither type checking nor the configured lint rules. Runtime UI tests use `renderToStaticMarkup` (`tests/runtime.test.mjs:6-8` and all render cases), which does not run effects or clicks. The only direct `StageView` case tests unreachable prototype UI (`tests/runtime.test.mjs:743-816`). There is no browser dependency or browser test script in `package.json:21-35`.

**Root cause.** Happy-path Node integration and SSR string assertions substitute for boundary, concurrency, migration, and browser behavior tests.

**Impact.** Route/diff races, focus/keyboard behavior, responsive layout, CSRF, branch switching, transactional merge recovery, real process cancellation, and migration compatibility are untested.

**Fix.** Lint all JS/TS production and test sources; add `checkJs`/JSDoc or migrate server contracts incrementally; replace the dead prototype assertion; add a small real-browser suite and deterministic failure/concurrency fixtures.

**Verification.** CI should run lint, frontend typecheck, backend contract/typecheck, unit/integration, security/concurrency, browser at approximately 1440/1024/768, build, and Sites tests as separate named gates.

### P3-4 — Defaults, documentation, and dead helpers describe different runtimes

**Evidence.** `README.md:8`, `33`, and `41` and `docs/implementation-handoff.md:28` describe GPT-5.4-mini/low. Current policy defaults are Luna XHigh and Sol High (`server/model-catalog.mjs:44-75`), while `server/codex-runtime.mjs:12-13` still has GPT-5.4-mini/low fallback constants. `repriceTaskUsage` is defined but never called (`server/store.mjs:12-37`).

**Root cause.** Runtime policy moved without one canonical source or a documentation compatibility pass; abandoned pricing code remained.

**Impact.** Operators and maintainers cannot tell which default is authoritative, and dead code suggests pricing behavior that does not occur.

**Fix.** Import one canonical default/policy source, document configured versus stage-specific defaults, and delete the unused helper after confirming no intended migration call is missing.

**Verification.** Add a contract test that README-visible defaults (or generated docs data), runtime status, new task snapshots, and actual launched policies agree.

## Existing coverage worth retaining

- Real temporary Git happy-path assembly/merge, sensitive/generated-file rejection, and destructive candidate recovery: `tests/git-worktree.test.mjs:12-85`.
- Cancellation after a mocked implementation result returns: `tests/runtime.test.mjs:103-188`.
- Candidate diff head/worktree validation and truncation: `tests/api.test.mjs:406-448`, `588-676`.
- Mocked multi-package lifecycle including repair and final approval: `tests/orchestrator.test.mjs:333-495`.
- Store interruption translation: `tests/runtime.test.mjs:77-101`.
- Sites fallback/package boundary: `tests/sites-worker.test.mjs:6-68`.

These are useful regression foundations, but several are broad single tests. Split failure cases so one early assertion does not suppress later safety coverage.

## Required coverage additions

| Boundary | Missing tests |
| --- | --- |
| HTTP/security | Host/Origin/CSRF/content-type, Vite loopback listener, request-body abort/size, attachment partial failure. |
| Workflow concurrency | Atomic close/start, finish/answer, duplicate approvals, cancel/retry reservation, settings updates during task creation. |
| Git/worktrees | Target ref identity, detached head, source move between checks, persistence failure after merge, process loss/reconciliation, ownership hierarchy/case, cleanup failure. |
| Gates/prompts | Candidate/revision mismatch, contradictory structured rows, blocking findings plus PASS, context caps, missing/invalid structured payload, stale evidence. |
| Persistence/migrations | Versioned golden fixtures, malformed/truncated JSON, repeated migration, failed atomic rename, approval/candidate recovery. |
| Subprocess security | Environment allowlist, already-aborted signal, descendant process kill, timeout, output redaction/budget. |
| Browser | Hash-route back/forward and request race, action disable/loading/error, Grill submission race, candidate diff race, modal focus/Escape, Markdown/diff rendering, 1440/1024/768 layouts. |

## Sequenced modularization and deletion plan

### Batch 0 — Freeze safety behavior

1. Add failing regression tests for P1-1 through P1-6 before refactoring.
2. Add a persisted schema version and current-state fixture so later module moves cannot silently rewrite data.
3. Add one browser harness around `App` with controllable API promises; capture baseline screenshots at 1440, 1024, and 768.

### Batch 1 — Secure external boundaries

1. Extract `server/http-security.mjs` for host/origin/content-type/CSRF policy and body limits.
2. Bind every local dev entry to loopback and ensure Sites continues to reject `/api` writes.
3. Extract `server/process-runner.mjs` with minimal environment construction, redaction, process-tree termination, and cancellation lifecycle.

### Batch 2 — Make workflow transitions and merge durable

1. Add `store.transition(id, expected, updater)` (or task revision/CAS) inside the existing serialized JSON store.
2. Extract `server/workflow-state.mjs` for legal statuses/actions and use it from API, orchestrator, and UI projections.
3. Add branch-ref verification to `GitWorktreeManager.merge`.
4. Add the small merge-intent/reconciliation protocol, then inject persistence/process failures in tests.

### Batch 3 — Normalize candidate and gate contracts

1. Extract `server/contracts/gates.mjs` and `server/contracts/work-packages.mjs` from `structured-output.mjs`.
2. Persist normalized gate outcome and candidate binding; aggregate metrics from those fields only.
3. Canonicalize owned paths and enforce qualification scope against the committed file list.
4. Generate context manifests from the actual capped fragments.

### Batch 4 — Split orchestration by responsibility

Keep `TaskOrchestrator` as a thin coordinator and extract:

- investigation/scout runner;
- plan/package scheduler;
- candidate assembly/repair service;
- gate runner;
- artifact/usage retention service;
- approval/merge service.

Each extracted module should receive the store/worktree/runtime interfaces explicitly so unit tests can inject failures without a 942-line fixture.

### Batch 5 — Split API and live workspace

1. Split `server/api.mjs` into request/response utilities, task routes, runtime/settings routes, candidate/changelog routes, and evaluation projection.
2. Extract `useHashRoute`, `useRuntimeTask`, and request-generation helpers from `App.tsx`; bind all async results to route identity.
3. Split `RuntimeTaskWorkspace.tsx` into shell/navigator/inspector, command policy, stage presenters, artifact viewer, worktree inventory, focused-test evidence, and activity.
4. Replace duplicated `runtimeStageSkills`/agents/status labels with the shared workflow contract.

### Batch 6 — Remove the prototype island

1. Move `CandidateDiffViewer` and `CandidateDiffErrorViewer` (`StageViews.tsx:2286-2410`) into a focused `CandidateDiffViewer.tsx`; update the live import and candidate-diff tests.
2. Delete `TaskWorkspace.tsx` and `LiveRun.tsx`.
3. Delete the remaining `StageViews.tsx` and `tests/runtime.test.mjs:743-816`; stop loading `StageViews.tsx` in the helper at lines 967-968.
4. Delete `recentTasks`, `baseEvents`, `acceptanceCriteria`, `HarnessEvent`, and `EventCategory` once `rg` confirms no import remains.
5. Run production import tracing again; no deleted symbol/file may be reachable through a static or dynamic import.

### Batch 7 — Prune and modularize CSS with rendered evidence

1. Instrument selector coverage on every live screen/stage/state, including failure, repair, blocked, completed, and approval.
2. Remove selectors owned only by the deleted prototype in small groups.
3. Split the remaining stylesheet by tokens/base, shell/navigation, tables/library, workspace/stages, artifacts/diffs, and responsive rules.
4. After each group, run visual comparison at 1440/1024/768 plus keyboard/focus smoke. Do not delete a selector based only on source-string absence because classes such as `button--${tone}` are constructed dynamically.

## Completion criteria for the remediation program

- Local UI and companion are loopback-only and reject untrusted browser mutations.
- Every workflow action is an atomic legal transition; merge approval is exact-ref-bound and restart-safe.
- Every gate has one persisted normalized verdict tied to the exact candidate revision.
- Test cancellation/failure cannot leave an unretryable worktree.
- Context/model/cost/freshness labels distinguish discovered, configured, unavailable, stale, legacy, and estimated states truthfully.
- No production file is kept alive solely by obsolete prototype tests.
- Production modules are below roughly 500 lines where cohesive extraction is practical.
- Lint/type/contracts cover backend as well as frontend, and browser coverage exercises the real route and interactive state model.
