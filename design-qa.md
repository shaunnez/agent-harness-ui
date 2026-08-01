# Design QA

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
