# Calm Operator pass — implementation plan

## Authority and starting point

- Worktree: `/Users/shaun/projects/.worktrees/agent-harness-operator-view-prototype-20260831`
- Branch: `codex/operator-view-prototype-20260831`
- Baseline revision: `451682a7fa8a14f834bffeaf38f5b6d3c638b3d9`
- Review route: `/?preview=atlas#/tasks/AH-003`
- Product contract: `AGENTS.md` and `docs/workflow-product-contract.md`
- Existing Operator implementation and its uncommitted tests are the build starting point. Preserve unrelated user-owned changes.

## Outcome

Reduce the attention required to supervise a task without removing evidence. At the reference desktop viewport, an operator should answer these questions in roughly five seconds:

1. What is happening now?
2. Is anything wrong or waiting on me?
3. What changed or was produced?
4. Is the exact candidate ready for the next gate?
5. What is the one next safe action?

Operator remains a projection of persisted runtime state. Evidence remains the complete drill-down and source-of-truth surface.

## Product decisions

- Do not add dashboard charts. Use compact counts, status marks, and dependency lanes only where they improve scanning.
- Replace the five equally weighted briefing cells with a two-tier summary: dominant **Now** and **Next**, followed by compact **Output**, **Candidate**, and **Gate** signals.
- Make Operator exception-first. Healthy or unavailable signals stay quiet; blockers, errors, stale gates, failed packages, and human decisions expand automatically.
- Give each fact one canonical location. Do not repeat state, candidate identity, handoff readiness, error copy, or unavailable telemetry across the header, briefing, body, inspector, and footer.
- Keep all mutations in the existing runtime command bar and server-owned eligibility policy.
- Keep future stages inert and preserve past/current/future semantics.
- Keep hosted preview fixtures explicitly read-only, but reduce the full-width preview notice to a compact persistent label.

## Smallest coherent build

Dependency order: `S1 → S2 → S3 + S4 → S5 → S6`

### S1 — Calm projection contract

Owned surface: `operatorViewModel.ts`, `operatorStageFacts.ts`, focused selector tests.

- Project one primary `now` signal, one `next` action, up to three secondary signals, and an ordered exception list.
- Define canonical ownership for task state, stage state, candidate, handoff, and telemetry availability.
- Omit neutral health and unsupported pricing from stage-level summaries.
- Preserve authoritative blockers, errors, failed package details, stale reasons, and exact candidate bindings.
- Cover missing and malformed optional data without fabricating healthy state.

Exit: every supported runtime state produces a deterministic, de-duplicated calm summary before React rendering.

### S2 — Briefing, shell, and stage navigator

Owned surface: `RuntimeOperatorWorkspace.tsx`, `RuntimeTaskHeader.tsx`, `RuntimeTaskWorkspace.tsx`, `operator-runtime.css`.

- Render dominant **Now** and **Next** cells with one-line supporting copy.
- Render **Output**, **Candidate**, and **Gate** as compact secondary signals; omit empty or healthy noise.
- Reduce the Operator context rail to viewed/current stage distinction, exact candidate identity, and Evidence/artifact actions.
- Remove the duplicate Operator handoff footer when the same handoff is already represented above.
- Keep the task-global status pill in the header, but do not restate its description elsewhere.
- Compact completed stages and ensure the selected/current stage is fully visible, including Human Approval at stage 10.
- Preserve accessible text labels, focus order, and inert future stages.

Exit: task state, exception, and next action dominate the first viewport without losing navigation or drill-down.

### S3 — Proportional package workbench

Owned surface: `RuntimeOperatorPackageFlow.tsx`, package selectors, focused tests and styles.

- Zero packages: show one honest empty/error state with the authoritative reason.
- One package: show one compact delivery-slice row; remove unused dependency chrome and redundant legend content.
- Multiple packages: retain dependency batches, but reduce each package to ID, status, title, and dependency cue.
- Expand only the failed, blocked, actively running, or explicitly selected package to show attempts, checks, files, and error detail.
- Bring the first actionable exception into view without hiding sibling package states.
- Preserve ready-for-integration versus integrated and local overflow for large 1–N sets.

Exit: the simple path is visibly simple, while multi-package dependencies and failures remain truthful.

### S4 — Final Review and Human Approval

Owned surface: `RuntimeOperatorFinalReview.tsx`, `operatorFinalReviewModel.ts`, stage facts and focused tests.

- Final Review shows all eight prior stages as compact rows with stage, state, tokens, and key outcome.
- Summarize API-rate availability once; do not repeat `Unavailable` per row.
- Compress successful/fresh rows and emphasize only failed, stale, missing, or disputed evidence.
- Make each row open the corresponding Evidence stage when that stage is inspectable.
- Human Approval becomes a compact decision receipt: exact candidate/head, target branch, three gate states, PR state, and one eligible action.
- Remove duplicated candidate and handoff copy from the approval body and rail.

Exit: a reviewer can see the full retained journey and make the approval decision without reading eight paragraphs.

### S5 — Evidence legibility and accessibility repair

Owned surface: `operator-evidence-view.css` and the shared read-only preview label only where required.

- Fix the collapsed preview command-bar copy in Evidence at the reference desktop viewport.
- Use 14px for meaningful body/control copy; reserve 12px for metadata.
- Replace mouse-only truncation with two-line clamping or keyboard-accessible detail where the full value matters.
- Ensure local overflow has a visible affordance and keyboard access.
- Confirm state is communicated with text/iconography as well as colour.
- Respect reduced motion and retain existing semantic regions and control labels.

Exit: the drill-down remains dense by design but is legible, navigable, and free of visibly broken layout.

### S6 — Qualification and final diff review

- Run focused Operator selector and rendering tests first.
- Run the full repository test suite, typecheck, lint, formatting, production build, and Sites worker contract tests.
- Browser QA at approximately `1488 × 1058` for:
  - zero packages and missing structured evidence;
  - one completed package;
  - multi-batch packages with running, planned, ready, integrated, and failed states;
  - blocked/error and retry-exhausted states;
  - repair lineage with stale downstream gates;
  - Final Review with all eight prior stages;
  - Human Approval, PR publication/identity drift, merged, and terminal states;
  - Operator/Evidence switching, keyboard focus, local overflow, and console errors.
- Review the final diff for accidental changes and files growing beyond the repository's practical size boundary.

## Acceptance criteria

- **Glanceability:** Now, the most important exception, and Next are visible above the fold at the reference viewport.
- **De-duplication:** task-global status may remain in the header, but descriptive state, candidate, handoff, and error copy each have one canonical workspace location.
- **Exception-first:** healthy stages do not render a `No recorded issue` card; unavailable pricing is summarized once.
- **Simple path:** a single package renders as one compact slice without empty lanes or irrelevant legend noise.
- **Multi-package path:** arbitrary persisted 1–N packages preserve dependency batches, stable order, and ready-versus-integrated semantics.
- **Failures:** blockers, package failures, stale gates, repair lineage, target/PR drift, and malformed data remain explicit and actionable only through existing eligibility.
- **All steps:** Final Review includes every prior stage, and each inspectable row can reach its retained Evidence.
- **Navigation:** the current stage is fully visible; future stages remain disabled until authoritative evidence exists.
- **Evidence:** all prior detailed functionality remains available, and the preview banner no longer collapses.
- **Accessibility:** core copy meets the 14px body/control target, labels do not rely on colour alone, keyboard focus remains visible, and overflow is keyboard reachable.
- **Truthfulness:** no invented health score, cost, availability, success rate, action, or backend capability is introduced.
- **Verification:** all checks listed in S6 pass on the exact final revision, or any unverified gate is reported explicitly.

## Non-goals

- No persistence, orchestration, candidate-assembly, action-policy, or GitHub lifecycle changes.
- No new analytics dashboard or decorative charts.
- No Evidence inspector redesign beyond the concrete legibility repair.
- No phone-specific polish pass beyond retaining a safe responsive fallback.
- No removal of prototype routes or artifacts during this slice.

## Rollback

The pass is presentation and projection only. Revert to the existing five-cell Operator composition and package/final-review renderers without changing task data or Evidence. Keep the pre-pass tests and prototype artifact until the calm view is accepted.
