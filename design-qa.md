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

## Workflow Atlas bottom-drawer and motion refinement — 2026-08-09

### Review setup and source truth

- Highest-authority visual feedback: `/Users/shaun/.codex/attachments/501279fc-3e70-4693-8f6e-52d111a3e5f9/pasted-text.txt`.
- Selected visual source: `/Users/shaun/.codex/generated_images/019fe023-68c5-7ab0-8069-2d72656a8908/exec-a18b3f7f-b1ce-4416-804f-ff6e1a2e75ad.png`.
- Exact worktree preview: `http://127.0.0.1:5177/?preview=atlas#/command`.
- Primary collapsed implementation: `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-polish-final-map-1920x1080.png`.
- Primary expanded drawer: `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-polish-final-drawer-1920x1080.png`.
- Actual Chrome window: `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-live-return-no-synthetic-handoff.png` at 1920 x 873 CSS pixels.
- 1488 desktop fallback: `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-polish-final-1488x1058-v2.png` and `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-drawer-final-1488x1058-v3.png`.
- Source pixels were 1486 x 1059. The comparison normalized the source to 1488 x 1058; implementation captures matched their stated CSS viewport at DPR 1.
- Compared state: hosted illustrative Live map with AH-008 selected, plus explicit Running and Handoff previews. Preview controls changed cloned display state only.

### Combined comparison evidence

- Full frame: `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-polish-comparison-full.png`.
- Focused map and task rail: `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-polish-comparison-map.png`.
- Focused support treatment: `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-polish-comparison-support-drawer.png`.
- The support treatment intentionally differs from the older source frame: the latest operator feedback replaces the always-visible support row with a bottom-anchored drawer that overlays the map only while open.

### Required fidelity surfaces

- Typography: the 280 px primary task rail shows representative titles on two lines at 14 px; the 220 px 1488 fallback permits three lines. Implement and Dev Review use wider 220 px signs with unclipped stage and room names. Drawer metadata stays at the 12 px floor.
- Spacing and layout: the drawer is collapsed to a 44 px bottom handle, expands to 430 px at 1920 and 460 px at the 1488 fallback, and never changes the task-rail height. All ten rooms remain visible at 1488 x 1058 without document scrolling.
- Colors and tokens: the selected room retains the single blue perimeter and selected routes retain each task's persisted colour. Real running agents and active package machinery use a stronger orange glow; blocked and repair semantics stay red.
- Image quality and assets: existing transparent room shells, courier pods, signal cores, cargo crates, and function consoles remain sharp and correctly masked. The implementation adds motion to those real assets and existing icon-library glyphs rather than introducing substitute CSS or SVG artwork.
- Copy and content: `Atlas details`, the two-line `RETURN TO / IMPLEMENT` label, and `HANDOFF IN TRANSIT` are legible and do not collide with stage labels or occupancy counters. Persisted task, candidate, package, and handoff content remains unchanged.

### Comparison history and fixes

1. P1 — The 184 px task rail clipped multi-word titles and made active-task identity hard to scan. Increased the primary desktop rail to 280 px, used a 220 px 1488 fallback, and retained local scrolling plus the persistent View all tasks action.
2. P1 — Legend, handoffs, and inspector consumed a permanent lower row and pushed the map out of the normal Chrome viewport. Replaced that row with an accessible bottom drawer whose panel slides over the canvas and whose closed content is inert.
3. P2 — Empty-room machinery was static and a running worker did not read as stronger than ambient occupancy. Added function-specific idle loops for radar, drafting lines, route grid, consoles, and pulse machinery; running agents and active package machines now use the stronger orange treatment. Reduced motion disables all added loops.
4. P2 — Selecting a task lit a solid route that blended with the other task paths. The selected route now retains its task colour but uses a lightly animated dash, with a static dashed fallback under reduced motion.
5. P2 — Returning from a prototype state to Live could compare cloned and persisted stages and fabricate a noncanonical cross-map transition. Persisted tracking is now reseeded when Live resumes, and transition animation accepts only canonical adjacent or repair paths.
6. P2 — The Handoff label sat beneath room counters and the repair label sat over its road. Moved Handoff into the clear gap between the plan counter and Implement roof; moved Return to Implement above the red road and split it across two lines.
7. P2 — Implement and Dev Review dominated the canvas while their signs remained cramped. Reduced both footprints modestly, kept the implementation-to-review bridge shape, and enlarged the signs so both names fit cleanly.
8. P2 — The first 1488 drawer pass squeezed legend route labels and created a local scrollbar. Reflowed legend routes into three columns, reduced only the object art at that breakpoint, and increased the expanded drawer height to fit the complete support content.

### Interaction and responsive coverage

- Exercised Live, Running, Needs input, Blocked, Handoff, and Completed; each control reported pressed state and the selected task rendered the corresponding visual status.
- Captured explicit Handoff in transit at `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-handoff-actual-chrome.png`.
- Captured the orange running treatment at `/Users/shaun/.codex/visualizations/2026/08/09/019fe3d9-af0a-7d53-a410-7176962d9e0d/atlas-running-orange-actual-chrome.png`.
- Switched from Handoff directly to Live and confirmed no transit label or direct Human Gate-to-review path remained.
- Expanded and collapsed Atlas details; closed and reopened the selected-task inspector inside the drawer.
- Checked 1920 x 1080, the actual 1920 x 873 Chrome viewport, and 1488 x 1058. The final tab was left on Map with the drawer collapsed at the actual Chrome size.
- A clean reload and the complete exercised flow produced no console warnings or errors.

### Automated verification

- `npm run typecheck` — passed.
- `npm run lint` — passed across 78 source files.
- `node --test tests/atlas-model.test.mjs` — 3 passed, including canonical transition-path coverage.
- `npm test` — 333 passed.
- `npm run build` — passed; the existing large-chunk advisory remained non-fatal.
- `npm run test:sites` — 4 passed.
- `git diff --check` — passed.
- Required Sites artifacts exist: `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

### Remaining findings

- P0: none.
- P1: none after fixes.
- P2: none after fixes.
- P3: the collapsed drawer intentionally leaves more open ground at unusually tall desktop viewports than the older always-visible support composition.

final result: passed

## Courier Rooms workflow atlas fidelity rebuild — 2026-08-09

### Review setup and source truth

- Selected source: `/Users/shaun/.codex/generated_images/019fe023-68c5-7ab0-8069-2d72656a8908/exec-a18b3f7f-b1ce-4416-804f-ff6e1a2e75ad.png`
- Runnable local preview: `http://127.0.0.1:4174/#/command`
- Final map capture: `/Users/shaun/.codex/visualizations/2026/08/09/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-fidelity-pass-4.png`
- Single-package workbench capture: `/Users/shaun/.codex/visualizations/2026/08/09/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-workbench-single-final.png`
- The 1486 × 1059 source and implementation capture were opened together at original resolution in one comparison input after every material visual pass. The final comparison therefore uses the source viewport rather than a stretched or differently cropped frame.
- Browser state: Command Centre Map, with persisted blocked task `AH-004` selected in Dev Review. The reference selected `AH-006`; task identity, timestamps, statuses, packages, and handoff history remain truthful to the live local data.

### Required fidelity surfaces

- Typography: compact Inter UI type with monospaced task and candidate identifiers preserves the source hierarchy.
- Layout and spacing: compact Live/Updated header, 176px courier roster, investigation/delivery bands, dominant Implement hangar, two-bay Dev Review tower, and a non-overlapping support row match the selected composition.
- Colour: warm ink surfaces, one blue active-room perimeter, amber human-attention states, green retained evidence, and red blocked/repair semantics are restrained and unambiguous.
- Assets: transparent generated raster assets provide the source-matched graphite room shells, olive Implement hangar, two-bay review tower, courier pod, worker drone, cargo crate, and function-specific room machinery. Canvas renders only the meaningful road and live route layers; the source screenshot itself is never embedded.
- Content: room labels, counters, queued status, package states, block reasons, handoffs, and inspector facts come from the local task model rather than presentation-only fixtures.
- Interactions: Table is the Command Centre default, Map is the second Command Centre tab, Tasks stays table-only, the inspector closes and reopens, roster and room couriers select a task, the in-room Workbench action selects its task before opening, and the workbench supports a centered one-package state plus larger dependency graphs.

### Comparison history and fixes

1. P1 — The prior code-native rooms remained visibly unlike the selected mock. Replaced them with source-matched transparent 3D shells and apparatus assets while retaining semantic DOM content and real interaction targets.
2. P1 — Implement was undersized and assumed a fixed four-slot layout. Made it the dominant hangar and added auto-layout 1–N package bays that preserve active, ready-for-integration, integrated, queued, and blocked distinctions; a one-package task now occupies a coherent centered bay.
3. P1 — Dev Review could not represent multiple task occupants. Added two predictable review bays, consistent counters, overflow treatment, and per-task blocked seals with a concise persisted-reason projection.
4. P1 — Return-to-Implement behaviour was absent. Added explicit dashed repair roads from Dev Review and Test to Implement without decorating ordinary bridges with completion ticks.
5. P1 — The summary obscured rooms and Recent handoffs was missing. Moved the closeable inspector into the support row beside a real artifact-derived handoff list and a source-aligned boxed legend.
6. P2 — Map scope, default view, heading density, queued copy, and counter treatment did not match the requested behaviour. Table now opens first, Map appears second only on Command Centre, the header includes Live/Updated, and room counters use one consistent treatment.
7. P2 — The workbench summary columns misaligned and a single package looked stranded in a large graph. Aligned the five status totals, center-fit the package node, and reduced the one-package modal height while retaining pan, zoom, dependency batches, and package drill-down for larger plans.
8. P2 — Courier, agent, and cargo semantics were not visually legible at map and legend scale. Added dedicated assets, enlarged the operative silhouettes, and kept cargo exclusive to persisted handoffs or live persisted-state transitions.

### Remaining differences

- P0 findings: none.
- P1 findings: none after fixes.
- P2 findings: none after fixes.
- P3 — The live dataset contains seven tasks rather than the reference's four, so roster length, individual task titles, stage occupancy, and route colours intentionally differ.

### Verification

- `npm run typecheck` — passed.
- `npm test` — 320 passed, including the atlas road, repair-route, queued-state, and package-layout coverage.
- `npm run build` — passed; Sites artifacts were prepared.
- `npm run test:sites` — 4 passed.
- Targeted Biome format and lint for the atlas and touched integration files — passed after formatting.
- `git diff --check` — passed.
- Full `npm run lint` — blocked only by the unchanged duplicate `gap` declaration already present in `HEAD` at `src/styles/settings-changelog.css:28`; the atlas files produce no lint diagnostics.
- Browser interactions exercised in the selected in-app browser: Table/Map switching, Tasks route scope, room task selection, inspector close/reopen, in-room Workbench launch, single-package modal, and roster scrolling.

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

## Courier Rooms one-screen refinement — 2026-08-09

### Scope and evidence

- Source design: `/Users/shaun/.codex/generated_images/019fe023-68c5-7ab0-8069-2d72656a8908/exec-a18b3f7f-b1ce-4416-804f-ff6e1a2e75ad.png`
- Source pixels: 1486 x 1059, normalized to 1488 x 1058 for direct comparison.
- Implementation route: `http://127.0.0.1:4174/?preview=atlas&view=map#/command`
- Temporary public review route: `https://provincial-motel-symposium-gym.trycloudflare.com/?preview=atlas&view=map#/command`
- Implementation capture: `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-final.png`
- Public phone capture: `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-public-mobile.png`
- Browser viewport: 1488 x 1058 at device scale 1.
- Compared state: hosted illustrative Live map, AH-008 selected, inspector open.
- Full comparison: `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-comparison-final.png`
- Focused map comparison: `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-comparison-map.png`
- Focused support comparison: `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-comparison-support.png`

### Comparison history

1. The starting implementation was taller than the reference, clipped the evidence area, used small room art and typography, detached labels from room footprints, drew weak roads, had no visual-state controls, and allowed the inspector to overlap map content.
2. The first refinement introduced the 650-unit world, dominant Implement hangar, nested implementation and review bays, larger room art, physical roads, red repair roads, persistent occupancy counters, a boxed legend, Recent handoffs, and a bottom-aligned inspector.
3. Browser comparison found two remaining P1 issues: short desktop viewports compressed the support strip, and the canvas intercepted the inspector close control despite sitting visually behind it. The short-height layout now scrolls locally and the support grid owns the interaction layer.
4. The final pass increased stage, legend, and handoff typography; moved the preview switcher into the compact header; added truthful room, agent, and cargo motion; added a map-first phone layout; and suppressed synthetic transition animation unless the explicit Handoff preview is selected.

### Final visual checks

| Check | Evidence | Result |
| --- | --- | --- |
| One-screen desktop composition | Atlas top 56, bottom 1058; map top 108, bottom 693; support top 693, bottom 1057; document 1488 x 1058 with no overflow | Pass |
| Room hierarchy and labels | Every room stacks number, stage name, and functional name above its roof; Implement and Dev Review retain clear headers over their larger footprints | Pass |
| Room identity and scale | Function-specific apparatus is large; Implement is dominant; Implement packages and Dev Review tasks render as nested bays | Pass |
| Roads and repair route | Physical roads are continuous and high-contrast; Dev Review and Test return roads are thick red routes labelled `RETURN TO IMPLEMENT` | Pass |
| Active, blocked, and human states | Selected room uses one blue perimeter; blocked couriers have a red seal and persisted reason; attention tasks remain amber and individually actionable | Pass |
| Motion | Occupied shells breathe gently; a running courier and worker core use stronger hover motion; explicit Handoff draws a 1.25 second cargo transition; reduced-motion disables decorative animation | Pass |
| Task rail | Header is `Active tasks`, all cards remain visible in the rail, and `View all tasks` is persistent at the bottom | Pass |
| Legend and handoffs | Object art is 72 px; state rows use icons and labels; legend and handoff metadata use a 12 px or larger scale | Pass |
| Inspector placement | Recent handoffs and the inspector both end at y=1045; the inspector never covers a workflow room and its close control is the top hit target | Pass |
| Prototype states | Live, Running, Needs input, Blocked, Handoff, and Completed controls render representative visual states without mutating persisted data | Pass |

### Interaction and responsive checks

- Exercised every preview-state button. Running produced `atlas-room-breathe-active` on the active shell and `atlas-courier-hover` on the courier; the Handoff state rendered a cargo crate on the plan-to-Implement route.
- Closed and reopened the AH-003 selected-task inspector after correcting the canvas stacking issue.
- Selected real persisted blocked task AH-003 and verified the enabled `Resolve blocker` action plus its persisted `Route sealed` reason.
- Activated `View all tasks` from the map rail and verified navigation to `#/tasks`.
- Verified the real Command Centre still opens on Table and Map remains secondary.
- At 1280 x 800, the support area retains its full 364 px height and the app main region becomes locally scrollable instead of clipping it.
- At 390 x 844, preview controls wrap without horizontal document overflow, the map renders before the task rail, the page scrolls vertically, and the 1080 px world remains horizontally scrollable inside the map.
- The public Cloudflare preview returned HTTP 200, rendered the atlas at 390 x 844, and produced no public-origin console warnings or errors.
- A clean browser reload produced no console warnings or errors. A transient React dependency warning seen during hot-module replacement did not recur on reload.

### Code verification

- `npm run typecheck`
- `npm run lint`
- Focused Biome format check for all seven changed source files
- `node --test tests/atlas-model.test.mjs` (3 passed)
- `npm test` (333 passed)
- `npm run build`
- `npm run test:sites` (4 passed)
- Required Sites artifacts present: `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`

No actionable P0, P1, or P2 visual or interaction issues remain in the reviewed state.

final result: passed
