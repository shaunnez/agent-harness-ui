# Design QA

> **Triage note (2026-08-05, #26):** Entirely historical. Every pass recorded in this
> file ends "final result: passed" with zero open P0-P2 findings at the time it was
> written. No action taken during triage.

## Review setup

- Local implementation: `http://127.0.0.1:4173/`
- Source visual truth: `C:\Users\nimbl\projects\agent-harness-ui\design\reference-grill-approved.png`
- Primary implementation evidence: `C:\Users\nimbl\projects\agent-harness-ui\output\playwright\workflow-refinement\grill-unified-inspector-1440x1024.png`
- Full-view comparison: `C:\Users\nimbl\projects\agent-harness-ui\output\playwright\workflow-refinement\comparison-grill-source-implementation.png`
- Primary viewport: 1440 x 1024 CSS pixels at DPR 1
- Responsive viewport: 768 x 900 CSS pixels at DPR 1
- Source dimensions: 1487 x 1058 pixels
- Implementation dimensions: 1440 x 1024 pixels (matching CSS viewport at DPR 1)
- Comparison image dimensions: 1464 x 562 pixels
- Reviewed state: Grill with docs, plus mixed Test results, repair flow, repaired Dev Review, Plan history, Implement packages/diff, and Final Review

## Visual comparison

The implementation preserves the approved Option 3 Evidence Gate shell and Option 2 answer-driven Grill anatomy: dark operational chrome, amber active-question treatment, recommendation and evidence rows, explicit answer choices, and a dense event ledger. The right sidebar intentionally differs from the source because the approved IA replaces the one-off Grill panel with the universal task inspector. It retains Stage context and Execution metadata while adding the Decision frontier and drillable Living artifacts.

The side-by-side comparison was reviewed as a complete frame. The full-resolution Grill screenshot was then used as the focused-region check for question hierarchy, evidence treatment, answer selection, and the universal inspector. No raster product imagery is used in the interface, so image asset fidelity is not applicable. Phosphor icons and the existing Inter/monospace type system remain consistent.

## Interaction and state coverage

- Grill: adaptive question, evidence, recommended answer, alternatives, decision frontier, and drillable living artifacts.
- Plan: dependency batches, explicit arrows, parallel work, package accordions, inputs, outputs, verification, model/agent, token and cost estimates.
- Implement: package overview, package detail, eight-part self-review rubric, repair context, and inline diff with file/scope navigation.
- Dev Review: fresh-context review, P0-P3 severity summary, file/line feedback, bounded revision allowance, and repair lineage.
- Tests: passing and failing suites together, accessible suite drill-downs, a clear Back to test list control, and gate-level repair actions outside the accordions.
- Repair: failure packet routes to a repair package; previewing the patch proceeds to Dev Review with the prior repair visible.
- Final Review: every previous stage is summarized with status, tokens, approximate cost, and a key outcome.
- Historical stages: the selected stage remains blue while the actual active stage stays green/amber and is stated explicitly in the inspector.
- Responsive: the 768 x 900 Grill view keeps the complete question and answer set visible before the inspector continues below.
- Browser console: no errors and no warnings during the exercised flows.

## Comparison history and fixes

1. P2 - Expanding the failed API test originally pushed the gate-level repair actions below the first fold. Moved the actions directly beneath the Test header and kept them outside every test accordion. Verified in `failed-tests-actions-visible-1440x1024.png`.
2. P2 - At widths of 850px and below, the fixed two-row workspace height compressed the Grill content into a nested scroll area and hid choices. Changed the workspace to natural height with visible stage overflow. Verified in `grill-unified-inspector-768x900-revised.png`.
3. P2 - A repair toast could remain visible after advancing into Dev Review. The stage transition now clears stale toast state before rendering the next stage.
4. P3 - Final Review is intentionally a dense audit ledger and requires stage-pane scrolling on desktop. This is acceptable because all rows remain structured and the global event ledger stays visible.

## Remaining findings

- P0: none.
- P1: none.
- P2: none.
- P3: the accepted Final Review density noted above.

## Automated verification

- `npx biome check --write src`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:sites` (4 tests passed)

## Candidate lifecycle refinement — 2026-08-01

### Evidence

- Approved pre-change Implement screen: `C:\Users\nimbl\projects\agent-harness-ui\output\audit\slice-review-merge\01-implement-slices.png`
- Clean updated Implement screen: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\01-implement-candidate-clean.png`
- Combined visual comparison: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\comparison-before-after.png`
- Candidate drill-down: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\02-candidate-detail.png`
- Fresh-context Dev Review: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\03-dev-review.png`
- Failed Test and global repair action: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\04-test-failure.png`
- Repaired candidate with stale-verdict lineage: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\05-repair-candidate.png`
- Clean Human Approval: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\06-human-approval-clean.png`
- Expanded scoped Run activity: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\07-run-activity-clean.png`
- Compact in-app browser panel: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\08-responsive-compact.png`

### Visual and interaction result

The updated screens preserve the approved Evidence Gate visual system and density. The former fourth “Integrate and verify” work package is now a visibly different integration boundary: three isolated slices qualify, then candidate `C1` assembles with an explicit merge queue, revision, conflict count, and merged diff. Top command bars make the next action clear without moving global actions below long content.

The exercised workflow was Implement overview → candidate detail → Dev Review → running Test → mixed failed Test → repair packet → new candidate `C2` → Human Approval. Candidate identity, revision, worktree, gate freshness, usage, cost, and artifacts stay coherent across the main canvas and inspector. The approval action explicitly says `Approve & merge C2` and shows target branch, merge method, and current gate count.

Run activity is collapsed by default and opens into a low-height chronological table with Activity, Agent runs, Test runs, and Decisions filters. Its columns make scope, provider/model or deterministic runner, tokens/cost, duration, and artifact explicit. It does not duplicate the stage canvas.

Responsive checks used the user's in-app browser at full width, an approximately 1,050px panel, and an approximately 820px compact panel. At compact width the product sidebar becomes icon-only, the inspector moves beneath the stage canvas, actions remain reachable, and the horizontal stage navigator remains scrollable.

### Fixes made during this pass

1. P2 — The prototype-state details menu stayed open after switching states and obscured content. Added a controlled ref so selecting a state closes the menu immediately.
2. P2 — The previous event ledger competed with stage content and repeated an “Events” filter. Replaced it with a collapsed Run activity summary and scoped telemetry filters.
3. P2 — Slice success could be interpreted as task-level success. Changed slice status language to `ready for integration` and made the versioned candidate the sole downstream gate subject.
4. P2 — Repairs did not make prior verdict validity clear. New candidate revisions now display repair lineage and explicitly stale prior candidate gates.
5. P2 — Human approval did not communicate the repository mutation contract. Added candidate revision, target branch, merge method, current gate count, and an explicit approve-and-merge action.

### Final verification

- `npx biome check --write src` — passed
- `npm run lint` — passed
- `npm run typecheck` — passed
- `npm run build` — passed
- `npm run test:sites` — 4 passed
- P0 findings: none
- P1 findings: none
- P2 findings: none after fixes

final result: passed

## Real runtime Evidence Gate convergence — 2026-08-02

### Review setup and source truth

- Local implementation: `http://127.0.0.1:4173/`
- Product contract: `C:\Users\nimbl\projects\agent-harness-ui\docs\workflow-product-contract.md`
- Approved Grill source: `C:\Users\nimbl\projects\agent-harness-ui\design\reference-grill-approved.png`
- Approved workflow sources: `C:\Users\nimbl\projects\agent-harness-ui\output\playwright\workflow-refinement\`
- Approved candidate-lifecycle sources: `C:\Users\nimbl\projects\agent-harness-ui\output\design-qa\candidate-lifecycle\`
- Baseline real-runtime captures: `C:\Users\nimbl\projects\agent-harness-ui\output\ui-convergence-audit\current\`
- Final implementation captures: `C:\Users\nimbl\projects\agent-harness-ui\output\ui-convergence-qa\`
- Same-input comparison sheets: `C:\Users\nimbl\projects\agent-harness-ui\output\ui-convergence-qa\comparisons\`
- Viewports: 1440 × 1024, 1024 × 768, and 768 × 900 CSS pixels
- Browser: the user's selected in-app browser

The reference and runtime screenshots were joined into the same comparison inputs for Implement, repaired Dev Review, Final Review, and Human Approval. The comparison judged the complete frame first, then the command bar, candidate desk, content hierarchy, inspector, and footer as focused regions. The runtime intentionally carries denser persisted evidence than the clean prototype states, but it now uses the same Evidence Gate shell, warm ink surfaces, compact typography, semantic colour, stage rail, candidate anatomy, and low-height activity treatment.

### States and interactions exercised

- Command Centre: real task list, attention rows, usage, loading, no persisted tasks, and disconnected companion.
- All ten stages: selected through the real `AH-015` navigator without changing task state.
- Grill Me: completed question history, reopened answer, repository evidence, recommendation, visible keyboard focus, 1024px, and 768px layouts.
- Implement: dependency batches, qualified package detail, exact candidate/revision, repair-required blocked task `AH-007`, and stale retained evidence.
- Dev Review: exact candidate context, review artifact, and two-revision repair lineage.
- Test: structured success list, result drill-down, assertions, artifact references, Back to test list, and global historical-action suppression. A current structured failure was not persisted, so failure behavior remains render-test/reference coverage rather than fabricated runtime evidence.
- Final Review: real stage states, summed token usage, `Plan included`, durable artifact outcomes, candidate freshness, and repair lineage.
- Human Approval: repository, target branch, fast-forward-only method, required gates, derived exact-revision freshness, residual-risk handoff, approval artifact, and merged state.
- Viewers: artifact open/copy/close and exact candidate diff. Dialog close receives focus, Escape is supported, and closing restores the invoking button.
- Run activity: collapsed by default, expanded ledger, and Activity/Agent runs/Test runs/Decisions filters.
- Responsive: no document-level horizontal overflow at 1440, 1024, or 768; the stage rail alone remains intentionally horizontally scrollable; the inspector stacks below the main canvas at compact width.
- Console: a clean real-runtime reload and exercised flows produced no application errors or warnings after the HMR timestamp used for the final pass.

### Findings and fixes

1. P1 — Historical stages exposed mutations belonging to the active stage. Replaced those controls with a read-only retained-evidence command bar and an explicit route back to the active stage.
2. P1 — The runtime rendered several stages as generic Markdown and exposed raw focused-test JSON in the Test canvas. Added typed stage presentations and retained the machine payload only in the full artifact viewer.
3. P1 — Candidate identity, target, freshness, and repair lineage were scattered. Added one shared candidate desk across Implement, Dev Review, Test, Final Review, and Human Approval.
4. P1 — Empty and disconnected states could fall back to prototype fixtures. Removed the fallback and added explicit loading, empty, and disconnected presentations backed by request state.
5. P2 — Long attention evidence widened the Command Centre. Added bounded columns and safe wrapping; final document and grid widths match the viewport.
6. P2 — Test results lacked a clean list/detail hierarchy. Added row drill-down, expected/actual assertions, artifact references, duration/failure detail, and two explicit return controls.
7. P2 — Run activity hid persisted telemetry. Added the four approved filters while leaving unrecorded run/model/token linkage explicitly unavailable.
8. P2 — Dialogs did not return keyboard focus to the opener. Added close-button autofocus, Escape dismissal, and opener focus restoration for artifact and candidate-diff viewers.
9. P2 — Approval facts truncated repository and gate text. Allowed evidence facts to wrap without widening the workspace.
10. P3 — Final Review remains intentionally dense and scrolls within its stage canvas. This is acceptable because the command bar, candidate identity, inspector, and global activity/footer remain fixed and reachable.

### Final evidence

- Command Centre: `18-command-centre-final-1440x1024.png`
- Final Review: `19-final-review-final-1440x1024.png`
- Human Approval: `20-human-approval-final-1440x1024.png`
- Loading / empty / disconnected: `21-loading-1440x1024.png`, `22-empty-1440x1024.png`, `23-disconnected-1440x1024.png`
- Compact approval: `24-approval-1024x768.png`, `25-approval-768x900.png`
- Exact diff and activity: `11-candidate-diff-1440x1024.png`, `12-run-activity-test-filter-1440x1024.png`
- Blocked repair and Grill: `13-blocked-repair-1440x1024.png` through `17-grill-768x900.png`

### Remaining findings

- P0: none.
- P1: none.
- P2: none after fixes.
- P3: accepted Final Review density and intentional horizontal stage-rail scrolling at 768px.

Runtime capability caps are tracked separately in `docs/ui-capability-gaps.md`; they are not presented as completed interactions or invented data.

final result: passed
