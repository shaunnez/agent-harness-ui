# Task workspace UI migration

21 September 2026 · Implementation proposal · Application implementation not started

## Outcome and boundary

Bring the existing Mission Frontier task workspace across to the reviewed design study while preserving its workflow behavior, evidence access and operational safeguards. Shaun's latest preference is a UI lift and shift wherever possible. The current implementation governs data and action semantics; the study governs the proposed visual treatment. Old reference images provide visual inspiration only.

The code was re-inspected on local `main` at `48ca6b5`. The working tree already contained edits to `AGENTS.md` and `TASK-WORKSPACE-EVALUATION.md`; those are preserved. The study runs at `http://127.0.0.1:5279/` and uses fictional records and simulated interactions. It has not demonstrated live runtime parity.

Target a frontend presentation migration with no new API endpoints, persistence fields, orchestration rules, model policies or candidate lifecycle changes. Some React composition and local interaction work is necessary; CSS alone cannot move Grill into the common shell, keep a package diagram beside its detail, or place the exact diff inline. If a requested panel needs unavailable information, use retained evidence or an honest absent-data state and identify any proposed contract work separately.

## Existing code to carry forward

| Responsibility | Existing implementation | Migration treatment |
| --- | --- | --- |
| Overlay navigation, task loading, callbacks and return paths | `src/frontier/app/OverlayHost.tsx` | Preserve host behavior, window controls, command wrapper and source/task identity. Recompose task content without a second application shell. |
| Ten stages, inspector and stage composition | `src/frontier/views/TaskPanel.tsx` | Introduce the study's consistent header, stage navigation, command region, bordered panels and open inspector. Keep stage selection based on recorded evidence. |
| Stage state, gate freshness and eligible next action | `src/frontier/runtime/workflow.ts`, `src/components/runtime/runtimeCommandPolicy.ts` | Continue using existing selectors and backend eligibility. Do not duplicate their rules in new cards or diagrams. |
| Command dispatch, note, connection/busy checks and candidate binding | `src/frontier/views/WorkflowCommand.tsx` | Restyle and reposition first, retaining the action identity check and candidate scope at dispatch. Keep current confirmation behavior in the first migration slice. |
| Package selection, batches, dependencies, qualification and worker access | `src/frontier/views/WorkPackages.tsx`, `src/frontier/runtime/presentation.ts` | Present existing records as connected batches with adjacent selected detail. Reuse package status derivation and watch callbacks. |
| Candidate identity, revision history, tests and delivery | `src/frontier/views/CandidateEvidence.tsx` | Recompose existing evidence into stage-specific panels. Preserve prior attempts, provenance, stale evidence and exact PR identity. |
| Findings, scouts, artifacts, activity and pagination | `src/frontier/views/StageEvidence.tsx` | Separate stage work from the collapsed activity region without losing any evidence tab, artifact or earlier-record loader. |
| Grill answers and drafts | `src/frontier/views/Grill.tsx`, `src/frontier/app/OverlayHost.tsx` | Place the existing form in the shared visual shell; keep host-owned drafts, answer callbacks, recommendation acceptance and specification eligibility. |
| Rendered artifacts and exact candidate diffs | `src/frontier/views/ArtifactViewer.tsx`, `CandidateDiff.tsx`, `DiffDocument.tsx` | Preserve wide viewers, raw source, context manifests and return paths. Reuse the checked diff loader/rendering for an inline placement. |
| Local panel memory | `src/frontier/app/panel-state.tsx` | Preserve task-scoped selection and command drafts through navigation and evidence inspection. Do not replace with global application state. |
| Styling, icon and art assets | `src/frontier/ui/`, `@phosphor-icons/react`, existing worker portrait assets | Scope the new task styles. Use the installed icon family to match the study's outline treatment; no icon dependency is needed. Retain image provenance and label the supplied workshop image as illustration. |

The runtime's `TaskEvidence` and `FrontierGateway` contracts remain the connection between the existing application and the new presentation. Extract small display components when they have a clear purpose. Do not introduce another gateway, parallel workflow model or general design-system package.

## Differences to resolve during implementation

1. **The study is a set of examples, not a complete state specification.** Its four-package diagram must become a dynamic 1–N package view using recorded batches and dependency IDs. Prove one package, uneven batches and more than four packages. Ready for integration must remain distinct from integrated.
2. **Some attractive detail is unstructured.** `RuntimeWorkPackage` has description, paths, dependencies and verification, but no dedicated interface, risk or expected-output fields. Gate findings have detail, file/line, reproduction evidence and acceptance linkage, but no dedicated suggested-diff field. Render these details only when present in retained artifacts; do not manufacture structure or code suggestions from sample content. Keep a full artifact available when it cannot be safely split into fields.
3. **Specification content is a retained document.** Use its actual Markdown and headings, with the original content/source accessible. Icons and numbered markers must not depend on one exact generated document shape or replace it with hard-coded study copy.
4. **Inline diff needs composition work, not a new diff API.** The existing `CandidateDiff` rejects a response whose candidate ID, revision or head differs from the requested identity. Retain that behavior, loading/error/retry, truncation warning and raw source in both placements. Use the full recorded file list, not the study's two-file excerpt. Do not imply a package-specific diff exists.
5. **Test rows and test summaries have boundaries.** Structured row status is currently `passed | failed`. Preserve retained log evidence and previous attempts; do not add invented skipped rows or count unloaded attempts as complete coverage. A failed execution is not automatically a candidate defect or permission to repair.
6. **Final Review needs careful aggregation.** Frontier's current `JourneyEvidence` uses loaded runs and exposes the loaded count. The older `buildOperatorFinalReviewRows` implements an eight-stage summary against `RuntimeTask`, which is not a drop-in replacement for paged `TaskEvidence`. Reuse applicable calculations with an explicit adapter only where needed; preserve partial/unavailable usage, avoid double counting and distinguish summed agent runtime from task wall time. Do not fabricate whole-task totals from loaded pages.
7. **Approval presentation is proposed, not already implemented.** The current command offers Proceed / Proceed with reason; the study presents a consolidated review form. First retain the existing interaction with the new appearance. A later frontend change may consolidate it while preserving explicit operator submission, optional note, eligibility and identity revalidation. The action remains Approve & raise PR for the exact candidate, followed by Awaiting PR merge. UI migration does not authorize a real approval or publication.
8. **Historical stage and active command are distinct.** The current command operates on the active task even when the user inspects an earlier stage. Label that context explicitly or return to the active stage for action. Never retarget a mutation to the historical artifact being viewed. Future stages stay inert in the product; the study's unrestricted Screen selector remains a preview control only.
9. **Navigation remains a design choice.** Horizontal navigation is the recommendation because it returns width to plans and diffs; Shaun has not explicitly selected it. Do not create a permanent top/side settings feature solely because the study offers a comparison.

These limits also qualify older design prose describing skipped results, structured rubric scores or a universal one-revision allowance. Current contracts and configured runtime limits take precedence, as Shaun requested. Absent information does not justify backend scope expansion.

## Delivery slices

### 1. Shared shell and Implement

Before editing, refresh the checkout state and inspect the applicable tests. Inventory every existing field, control, artifact access and exceptional state, giving each a destination in the new layout. Record normal laptop and desktop baseline views using existing fixtures and current code.

Implement the task-scoped visual treatment, common header/navigation/command/inspector, portrait and icon treatment, then connected package batches and adjacent package detail. Reuse the existing exact diff loader for inline candidate inspection. Preserve the current window host, model policies, Manage, Pin, Watch, activity/evidence access and all command safeguards.

Acceptance: the same supplied task evidence produces the same eligible actions, gate states, package states, candidate identity and available evidence. Prove running packages, no assembled candidate, assembled candidate, failed qualification and repair-required/stale downstream gates. Establish the layout against real contracts before extending it to every stage.

### 2. Earlier stages and input

Apply the shell and shared panel treatment to Triage, Scouts, Grill, Specification and Plan, plus optional Design review. Move existing forms/viewers through their current callbacks. Use the same dynamic package diagram for Plan, with state taken from the applicable records and clearly identified historical context.

Acceptance: selected/skipped scouts and individual run state remain accurate; Grill drafts survive artifact inspection and return; answering/accepting recommendations and specification/plan approval keep their existing conditions. Documents remain accessible when structured sections are absent or loading fails.

### 3. Review, Test, Final Review and Approval

Restyle findings and test list/detail, candidate history, gate evidence, the prior-stage journey and delivery panels. Place global repair/retry actions in the stable command region. Implement any approved confirmation-form consolidation separately from the first visual change so its behavioral effect can be reviewed directly.

Acceptance: stale or mismatched evidence cannot read as current clearance; previous test attempts remain inspectable; repair and unchanged-candidate retry retain different eligibility; fresh approval references the exact head; closed-unmerged and identity-drifted PRs remain blocked and incomplete. Missing structured findings/results retain an artifact/log route.

### 4. Integrated parity and visual qualification

Use existing fixture scenarios and add bounded cases only for uncovered behavior. Inspect live recorded tasks read-only for representative data shape and refresh behavior. Do not start agents or create a real PR as part of UI acceptance.

Check normal laptop and desktop overlay sizes, maximize/restore, long titles, long output, many packages, local scrolling, keyboard/focus and return paths. Include active, human-input, dependency-waiting, failed, repair-required, stale, disconnected, loading/error, partial evidence, historical, not-required and completed states. A finished run awaiting human input must not be depicted as executing. Healthy rows stay compact; exceptions remain visible.

Deliver the migration as reviewable slices in an isolated checkout when implementation is started. Retain the original study as the visual comparison. No enduring second UI mode is required; source control provides rollback for a presentation-only change. Preserve unrelated dirty files and running services.

## Verification plan

- Establish the focused baseline with `tests/frontier/workflow.test.mjs`, `workflow-command.test.mjs`, `command-workflow.test.mjs`, `pages.test.mjs` and `window-layout.test.mjs`. These already cover fixture workflow, candidate drift, repair/retry history, command disabled states, paging, pins and window behavior; they are not a substitute for browser interaction checks.
- Extend behavior tests only where composition changes expose an untested contract: same command payload and candidate scope, stale confirmation blocked after refresh, no duplicate submission, retained drafts, exact diff mismatch handling and prior-attempt access. Keep server tests authoritative for server rules.
- Run the broader `test:frontier`, typecheck, lint/format and relevant build checks after focused validation. For the integrated app, run `npm run build`; if handing the build to Sites, also run `npm run test:sites` and verify the required output files. Expand API/backend checks if implementation unexpectedly touches those boundaries.
- Browser-check real rendered components and interactions using fictional fixture tasks, then compare selected read-only live records. Document visual acceptance and behavioral acceptance separately.
- Review the final diff against the retained capability register in `TASK-WORKSPACE-EVALUATION.md`. No current capability may disappear merely because it was omitted from an illustrative screenshot.

## This planning pass

Inspected the current React views, overlay wiring, local state, contracts, selectors, relevant test coverage and package scripts. Recorded the migration preference in `AGENTS.md`. No application source, runtime data, live workflow state or preview design was changed. Application tests/build and live task parity were not run during this planning pass; they remain implementation acceptance work.
