# Operator View artifact-to-production plan

## Authority and handoff

- Repository authority: `451682a` on `codex/operator-view-prototype-20260831`.
- Review artifact: `http://127.0.0.1:4175/?preview=atlas#/tasks/AH-003`.
- Durable artifact source: `src/components/operator/` plus `src/styles/operator-*.css`.
- Product contract: `docs/workflow-product-contract.md` and the current `AGENTS.md` workflow decisions.
- Review decision: the current Operator direction is suitable to promote. No unspecified visual redesign is part of this build.
- Build handoff: compact after this plan, then implement and qualify the slices below in the existing isolated worktree.

The current branch contains both the review prototype and an initial production-shaped draft. Treat those changes as candidate material, not proof of completion: every retained line must map to this plan and real persisted runtime state.

## Current draft audit

Present and reusable after review:

- Operator/Evidence selection in the real workspace shell.
- Typed briefing, health, handoff, stale-gate, and package-batch projection.
- Compact shared Operator surface and context rail.
- Zero/one/multi-batch package rendering.
- Focused tests for core state classification, all ten stage selectors, stale gates, and package grouping.
- A labelled read-only command surface for hosted preview fixtures.

Required before production acceptance:

- Complete the Final Review prior-stage summary contract.
- Confirm every stage-specific signal is sourced from authoritative persisted evidence, not a generic fallback where stronger structured data exists.
- Show retained-package continuation/requalification context and candidate repair lineage explicitly.
- Close every mutation path in hosted preview, including controls reachable through Evidence—not only the top command bar.
- Expand the error matrix tests to target drift, retry exhaustion, PR publication/identity drift, merge reconciliation, missing structured evidence, and malformed optional data.
- Re-run all gates and browser fixtures after the final code review; prior green results do not qualify the next revision.

## Outcome

Add a low-fatigue **Operator** view to the real task workspace. In one scan, every started stage must answer:

1. What state is this task or stage in?
2. Is anything unhealthy, blocked, stale, or incomplete?
3. What changed or was produced?
4. What decision or readiness signal matters now?
5. What is the next safe action?

The existing detailed workspace remains the neighbouring **Evidence** view. Operator is a compact projection of the same `RuntimeTask`; it is not a second workflow or a second source of action authority.

## Artifact promotion boundary

### Promote from the artifact

- Compact header with a clear Operator / Evidence switch.
- Existing ten-stage horizontal navigator and its past/current/future distinction.
- Five-cell operator briefing in a fixed, predictable order.
- One concise stage heading, one alert region, three primary stage signals, and a narrow context rail.
- Top command bar so the next safe action is not hidden below evidence.
- Package workbench that scales honestly from zero to 1–N persisted packages.
- Restrained blue, green, amber, and red state treatments on the warm Evidence Gate shell.
- Wide artifact and candidate-diff drill-down through the existing viewers.

### Do not promote into real task state

- Mock task IDs, dates, package names, counts, model usage, costs, or success claims.
- The prototype state switcher and its representative Running / Needs input / Blocked / Handoff / Completed overrides.
- Clickable future stages. A real future stage remains inert until durable evidence says it started.
- Prototype-only no-op action notices or actions that bypass runtime eligibility.
- Static scout, acceptance-criteria, review, test, or approval content from the mock artifact.
- Multi-package scheduling or candidate-assembly controls that the current backend does not support. The UI may summarize persisted packages; it must not imply unsupported orchestration.

Keep the standalone artifact route as a read-only review asset until production acceptance. Preview fixtures must be explicitly labelled and must not call local runtime mutations.

## Visual-to-runtime mapping

| Artifact element | Authoritative production data | Rule |
| --- | --- | --- |
| Current state | `task.status`, `task.currentStage`, active terminal/non-terminal run, `getStageTemporalState` | Running comes from a persisted active run; future and historical are never inferred from stage index alone. |
| Health | `task.blocker`, `task.error`, failed packages, candidate-bound freshness | Persisted blocker/error wins; do not invent a health score. |
| What changed | authoritative stage artifact, stage disposition, work-package state, candidate revision | Show the latest valid handoff for the viewed stage, not a speculative summary. |
| Decision/readiness | Grill questions, approval status, package qualification, gate freshness, candidate identity | Name the exact unresolved decision or exact candidate tuple. |
| Next safe action | existing command policy plus server `actionEligibility` | `RuntimeCommandBar` remains the only mutation surface. |
| Stage heading | `getRuntimeStageSummary` | Reuse and extend the current selector rather than duplicate stage truth in JSX. |
| Context rail | viewed/current stage, candidate identity, handoff state, artifact/diff availability | Compact context only; the universal inspector remains in Evidence. |
| Package flow | `RuntimeWorkPackage.batch`, `dependencies`, `status`, attempts, verification, files, error | Preserve ready-for-integration versus integrated. |
| Stale gates | server-owned gate freshness and repair invalidation | Prior evidence stays inspectable but reads `Rerun required`. |
| Cost and usage | recorded usage and identified rate card only | Never present an attributable ChatGPT-plan charge. |

## All-stage content contract

Each stage uses the shared shell and five-cell briefing, then adds only the following compact signals:

| Stage | Operator signals | Evidence escape hatch |
| --- | --- | --- |
| Triage | workflow, risk/profile, repository authority and selected revision | triage artifact and repository authority detail |
| Repo scouts | selected scout taxonomy, completed/failed/skipped counts, first material gap | scout artifacts and dispatch rationale |
| Grill | answered/total, current unresolved question, policy and recorded completion source | full one-question Stage Desk |
| Task specification | authoritative artifact, approval/readiness, recorded model and token use | rendered specification and raw source |
| Implementation plan | package count, dependency batches, verification and ownership summary | package drill-down and plan artifact |
| Implement | qualified/running/planned/failed counts, package flow, exact candidate and repair lineage | package detail, worktrees, inline diff |
| Dev Review | exact-candidate verdict, P0–P3 counts, blocking findings and freshness | full findings, file/line suggestions, retained prior review |
| Test | fresh/stale gate, passed/failed/skipped results, failed command or assertion | mixed result list with drill-down and return path |
| Final Review | **every prior stage** with state, recorded tokens, API-rate estimate when available, and key outcome; exact final verdict and freshness | full holdout artifact and retained stage evidence |
| Human Approval | candidate ID/revision/head, three candidate-bound gate states, PR publication/merge identity and blocker | candidate diff, approval evidence, GitHub lifecycle detail |

The bold Final Review row is a required build gap from the current draft and must be implemented before acceptance.

## Package topology contract

| Persisted package state | Required Operator treatment |
| --- | --- |
| No packages | Honest `Not produced` or `Unavailable`; include the plan/implement failure when persisted. |
| One package | One centred, wide package card; no arrows, empty columns, or implied parallelism. |
| Multiple packages in one batch | One centred batch with a clear parallel label and local overflow only when needed. |
| Multiple dependency batches | Ordered batch columns with connectors between batches; packages in one batch stack as parallel siblings. |
| Planned | Neutral, with dependencies and verification count. |
| Running | Strong live treatment, active run identity, and attempt count. |
| Ready for integration | Qualified slice; explicitly not integrated and not proof the task passed. |
| Failed | Persisted error plus retained-worktree/requalification context where available. |
| Integrated | Candidate membership shown separately from local package qualification. |
| Dense 1–N set | Local horizontal/vertical workbench overflow; never document-level horizontal scrolling. |

The UI must not assume four packages, contiguous batch numbers, or one package per batch. Package order within an equal batch remains stable from persisted order.

## State and failure matrix

| Condition | Required presentation and action boundary |
| --- | --- |
| queued | Waiting to start; only the existing eligible run action. |
| running | Active stage/run identity and live treatment; never show completed handoff copy. |
| cancelling | Terminating state; retries remain unavailable until process closure. |
| awaiting input/approval | Exact unresolved decision and existing eligible action. |
| task failed/cancelled | Persisted error, failed stage, retained evidence, and eligible retry only. |
| blocked | Persisted blocker code/detail and one server-authorized recovery action, if any. |
| exhausted allowance | No generic retry; show grant/recovery only when server eligibility permits it. |
| failed package | Failed package and exact error; other package states remain visible. |
| partial implementation | Qualified, running, failed, and planned counts stay distinct. |
| repair required/running | Candidate lineage, repair source gate, and downstream invalidation. |
| stale Dev Review/Test/Final Review | `Rerun required` with persisted reason; older evidence remains audit history. |
| missing authoritative summary | `Not started` or `No authoritative handoff`, never stale history. |
| target drift | Exact target/candidate mismatch and refresh/rebuild/restart action from existing policy only. |
| PR publishing/open/poll error | Exact PR identity and polling state; no second publication path. |
| PR closed or identity drift | Blocked with retained reason and reconciliation action only when supported. |
| merge reconciliation failure | Exact retained merge intent and reconciliation action; no local fast-forward alternative. |
| merged/completed | Terminal outcome and retained evidence; only a contract-supported continuation/promotion record. |
| closed/archived | Read-only retained history with no workflow mutation. |
| missing/malformed optional data | Safe unavailable copy; render the rest of the stage without crashing. |

## Production structure

Keep the change additive and below the repository's practical file-size boundary:

- `src/components/RuntimeTaskWorkspace.tsx`
  - Own viewed stage and Operator/Evidence selection.
  - Reuse the same navigator, overlays, footer, and runtime callbacks in both views.
- `src/components/runtime/operatorViewModel.ts`
  - Pure typed projection for briefing, health, handoff, stage facts, stale gates, and package batches.
  - No React, side effects, API calls, or action-policy duplication.
- `src/components/runtime/RuntimeOperatorWorkspace.tsx`
  - Shared Operator shell, command bar placement, stage signals, context rail, and drill-down callbacks.
- `src/components/runtime/RuntimeOperatorPackageFlow.tsx`
  - Zero/one/many package presentation and local overflow.
- `src/components/runtime/RuntimeOperatorFinalReview.tsx`
  - Prior-stage summary rows with state, usage, estimate, and key outcome. Extract rather than growing the shared workspace.
- `src/components/runtime/RuntimeTaskHeader.tsx` and `contracts.ts`
  - View switch and explicit read-only-preview boundary.
- `src/styles/operator-runtime.css`
  - Production-only Operator styles; reuse existing tokens and Evidence Gate foundations.
- `tests/operator-runtime-view.test.mjs`
  - Selector/state/package matrix and real workspace rendering tests.

Prototype components stay isolated under `src/components/operator/` and must not become the production data model.

## Work packages

Build dependency: `S1 → S2 + S3 → S4 + S5 → S6 → S7`

### S1 — Authority and selector contract

Owned files: `operatorViewModel.ts`, existing workflow selectors, focused tests.

- Select authoritative artifact/freshness without duplicating backend policy.
- Produce the five briefing cells, alert, handoff, stage facts, package batches, and stale gates.
- Test past/current/future, active run versus stale evidence, optional/malformed data, and terminal states.

Exit: the view model answers the whole state matrix without rendering React.

### S2 — Workspace shell and Evidence parity

Owned files: `RuntimeTaskWorkspace.tsx`, `RuntimeTaskHeader.tsx`, `contracts.ts`.

- Add explicit Operator/Evidence state; the real app opens Operator and deep evidence links open Evidence.
- Keep the existing navigator, artifact/diff overlays, run activity, footer, and all Evidence behaviour intact.
- Keep direct component consumers backward-compatible where required by existing tests.

Exit: switching views loses no stage selection, artifact access, or action eligibility.

### S3 — Shared Operator stage surface

Owned files: `RuntimeOperatorWorkspace.tsx`, `operator-runtime.css`.

- Implement briefing, command bar, concise heading, alert, three stage signals, rail, and handoff footer.
- Render truthful compact content for all ten stages.
- Keep the reference desktop free of document scrolling; use local overflow for dense content.

Exit: every started stage answers the five questions from real data.

### S4 — Package workbench

Owned files: `RuntimeOperatorPackageFlow.tsx`, package selectors/tests.

- Implement zero, centred single, one-batch parallel, and multi-batch layouts.
- Preserve dependencies, status, attempts, checks, files, errors, and integration distinction.
- Verify more than four packages and non-contiguous batches.

Exit: 0/1/N fixtures pass structural and browser checks without fixed slots.

### S5 — Candidate gates, repair, and Final Review

Owned files: final-review component, view-model stage selectors, focused tests.

- Show exact candidate identity and gate freshness in Dev Review, Test, Final Review, and Approval.
- Render repair lineage and invalidated downstream gates.
- Add the required prior-stage Final Review summary with recorded usage/cost semantics.
- Cover target drift, PR publication/merge, closed PR, identity drift, and reconciliation failures.

Exit: no stale or superseded verdict presents as current, and Final Review covers every prior stage.

### S6 — Artifact and preview boundary

Owned files: hosted preview routing/fixtures and prototype tests only where necessary.

- Keep the reviewed prototype available as a labelled, read-only artifact.
- Ensure preview actions cannot mutate local tasks.
- Keep prototype state controls out of real task routes.
- Retain the artifact URL and source until production acceptance; remove legacy paths only in a separate proven cleanup.

Exit: preview and production are visibly and behaviourally distinct.

### S7 — Qualification

- Focused selector/component tests first.
- Existing runtime workspace tests with Evidence as the compatibility surface.
- Full test suite.
- Typecheck, lint, and formatting.
- Production build and Sites worker contract tests.
- Browser QA at approximately 1488 × 1058 for:
  - one package;
  - multiple packages across dependency batches;
  - empty and partial package states;
  - failed and blocked;
  - repair and stale downstream gates;
  - completed/approval;
  - Operator/Evidence switching;
  - keyboard focus and local overflow;
  - no browser console errors.

## Acceptance criteria

- The real app opens a truthful Operator view; Evidence retains the complete existing workflow.
- All ten stages use real persisted data and started-stage temporal rules.
- Future stages stay inert and never show fabricated evidence.
- The five briefing questions are answered in a consistent order on every stage.
- Zero, single, parallel, and dependency-batched package paths satisfy the topology contract.
- Failed, blocked, partial, repair, stale, unattempted, PR/merge, and terminal states satisfy the matrix.
- Final Review summarizes every prior stage with state, recorded usage, approximate API-rate estimate when supportable, and key outcome.
- All mutations remain governed by the existing command policy and server eligibility.
- Preview fixtures are labelled read-only and cannot mutate real tasks.
- Artifacts and candidate diffs remain available in their wide read-only viewers.
- Full repository and visual qualification gates pass on the exact implementation revision.

## Risks and non-goals

- Do not change persistence, orchestration, candidate assembly, or action eligibility for this UI delivery.
- Do not present prototype-only multi-package orchestration as a live backend capability.
- Do not replace the universal Evidence inspector with another reduced inspector.
- Do not add invented health scores, success rates, costs, connection states, or semantic-use claims.
- Do not polish a phone-specific composition beyond a safe responsive fallback.
- The current generated JavaScript chunk warning is a separate performance concern unless this change materially worsens it.

## Rollback

The production change is additive and requires no data migration. Revert the real-app default to Evidence and remove the Operator branch from `RuntimeTaskWorkspace` to restore the prior workspace. Retain the reviewed artifact and implementation evidence until the rollback decision is recorded.
