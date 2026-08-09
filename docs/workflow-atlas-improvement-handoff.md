# Workflow Atlas improvement handoff

Updated: 2026-08-09

Use this document as the starting prompt for the next agent after the operator has reviewed the current Workflow Atlas. Paste the new review notes into the section immediately below before handing it over.

## Operator feedback for this pass

> Paste the next round of concrete visual, interaction, or workflow feedback here. Treat it as the highest-authority source for the pass.

## Mission

Improve the code-native **Courier Rooms** Workflow Atlas on Command Centre without weakening its real workflow semantics. The result must remain an interactive React/canvas implementation, not a static image or a screenshot embedded in the product.

The primary target is the desktop command-centre composition at approximately **1488 x 1058**. Do not spend the pass polishing phone-specific layout unless the operator explicitly adds mobile requirements above. Preserve a safe responsive fallback, but judge fidelity, hierarchy, density, and motion on desktop.

## Exact baseline at handoff creation

- Repository: `/Users/shaun/projects/agent-harness-ui`
- Branch: `main`
- Baseline commit: `2f3edb7391eaae0de6ff9a393e3f574751ff2cab`
- `origin/main` matched that commit when this document was written.
- Primary atlas refinement commit: `9876b69cc4a65e191d2de25245f4cd55a3b6b1ca`
- The main worktree was clean when this document was written.

Do not trust those facts blindly. Before editing, rerun:

```bash
git status --short --branch
git rev-parse HEAD
git worktree list --porcelain
```

If the checkout has moved or contains unrelated work, preserve it and report the new baseline. Prefer an isolated `codex/` worktree for the improvement pass. Do not merge or push unless the operator explicitly authorizes that delivery step.

## Sources of truth

Use these in order:

1. The new operator feedback pasted into this document.
2. Repository `AGENTS.md`, especially **Approved product-design direction** and **Durable workflow decisions**.
3. The selected visual reference:
   `/Users/shaun/.codex/generated_images/019fe023-68c5-7ab0-8069-2d72656a8908/exec-a18b3f7f-b1ce-4416-804f-ff6e1a2e75ad.png`
4. The current implementation and its persisted/runtime contracts.
5. `docs/workflow-product-contract.md`.
6. Historical and current visual QA in `design-qa.md`. Append a new section; do not replace its prior audit history.

Current comparison evidence:

- Final desktop capture:
  `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-final.png`
- Full source/implementation comparison:
  `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-comparison-final.png`
- Focused map comparison:
  `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-comparison-map.png`
- Focused support-row comparison:
  `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-comparison-support.png`
- Merged-main verification capture:
  `/Users/shaun/.codex/visualizations/2026/08/08/019fe023-68c5-7ab0-8069-2d72656a8908/atlas-v2-main-merged.png`

## Product model that must remain truthful

- There are ten canonical stages: Triage, Repo Scouts, Grill, Task Spec, Implementation Plan, Implement, Dev Review, Test, Final Review, and Human Approval.
- Command Centre opens on **Table**. The atlas is its secondary **Map** view. The dedicated Tasks page remains a table, not a second map.
- A courier pod represents a task.
- A signal core or worker drone represents an active agent, not generic decoration.
- A cargo crate represents a real persisted handoff. Do not add fake cargo or transition ticks to make the map look busy.
- Persisted task advancement may animate along a route. Merely changing a selected task or inspected stage must not imply workflow advancement.
- The selected task's current room has one unambiguous blue perimeter.
- A blocked task is sealed individually with a red crossbar, `BLOCKED`, and its persisted reason. Do not turn a shared room red when only one occupant is blocked.
- Dev Review and Test have an explicit red return-to-Implement repair road. The road shows the allowed repair route; it does not claim that a repair occurred.
- Implement is a dominant 1-N package hangar. Never regress to four fixed package slots.
- Work packages distinguish active, ready for integration, integrated, blocked, and queued. A green slice is not proof that the assembled candidate passed downstream gates.
- Multiple tasks in one stage must lay out predictably, with the same occupancy-counter treatment on every room.
- Dev Review uses nested task inspection bays. Implement uses nested package bays.
- The selected-task inspector is closeable, never covers a room, aligns with the bottom of Recent handoffs, exposes the persisted reason, and owns the next safe action.
- Blocked and human-input states must be actionable in the real runtime. Preview-only states must remain disabled and labelled as previews.
- Motion should make real activity legible: gentle occupied-room breathing, stronger active-agent motion, and explicit persisted handoff travel. Respect `prefers-reduced-motion`.

## Preview mode versus the real runtime

There are two related but distinct preview mechanisms. Recheck both before changing anything:

1. `?preview=atlas` loads the hosted illustrative task snapshot and sets Command Centre to read-only preview mode.
2. `AtlasStatePreview` provides Live, Running, Needs input, Blocked, Handoff, and Completed visual-QA states. It transforms only a cloned selected task and must never persist task changes.

Relevant flow:

- `src/hostedAtlasPreview.ts`
- `src/components/CommandCentre.tsx`
- `src/components/atlas/WorkflowAtlas.tsx`
- `src/components/atlas/WorkflowAtlasCanvas.tsx`

The operator intends to review the atlas and turn preview mode off before or during the next improvement pass. Establish what has actually changed at the start of the pass. Do not assume either preview mechanism still exists.

If the requested outcome is to remove preview controls from the normal product:

- `#/command` must still open on Table.
- The normal Map view must render only persisted runtime tasks and truthful Live/Updated metadata.
- `taskForAtlasPreview` must not be reachable from the normal runtime path.
- Prefer keeping visual-QA controls behind an explicit preview/development boundary if they are still useful; do not leave prototype controls in the production command header.
- Do not delete `hostedAtlasPreview.ts`, Sites packaging, or the hosted read-only artifact without confirming that broader scope. The hosted Sites build and the local Codex runtime are separate delivery surfaces.

## Current code map

| Area | Ownership |
| --- | --- |
| `src/components/CommandCentre.tsx` | Table/Map selection, compact map header, preview-state ownership, runtime versus hosted data |
| `src/components/atlas/WorkflowAtlas.tsx` | Overall atlas composition, Active tasks rail, selected task, inspector/workbench state, visual preview transformation |
| `src/components/atlas/WorkflowAtlasCanvas.tsx` | Canvas grid, physical roads, task-coloured routes, red repair roads, persisted and explicit-preview cargo animation |
| `src/components/atlas/AtlasRoomCard.tsx` | Room shells, stage labels, courier pods, function machinery, dynamic Implement packages, Dev Review bays |
| `src/components/atlas/AtlasSupport.tsx` | Legend, Recent handoffs, inspector facts/actions, close/reopen behavior |
| `src/components/atlas/atlasModel.ts` | World dimensions, room coordinates, canonical roads, repair-road geometry, task tones, package totals |
| `src/components/atlas/PackageWorkbench.tsx` | 1-N dependency workbench and package drill-down |
| `src/styles/courier-rooms-fidelity.css` | Source-matched layout, room scale, typography, support row, animation, desktop/short-height/responsive behavior |
| `src/styles/workflow-atlas.css` | Shared atlas component foundations |
| `src/assets/atlas/` | Transparent room shells, courier, worker, cargo, and function-specific machinery |

`courier-rooms-fidelity.css` is now large. Extract a cohesive stylesheet only if the requested change genuinely crosses a clear ownership boundary; do not turn the improvement pass into a cosmetic file split or broad design-system rewrite.

## Required working method

1. Restate the requested visual/behavioral outcome and distinguish required changes from optional follow-up.
2. Inspect the current implementation, runtime task contract, nearby tests, and `AGENTS.md` before editing.
3. Run the exact current app yourself and capture a clean baseline at 1488 x 1058.
4. Put the source reference and current implementation in the same comparison input. Review the full frame first, then focused map and support-row crops.
5. Make the smallest coherent code change. Preserve real task, candidate, gate, package, and handoff semantics.
6. Exercise the changed controls in the browser. Do not accept source inspection as proof of visual or interaction behavior.
7. Fix every P0, P1, and P2 finding discovered during the pass.
8. Append the comparison evidence, interaction coverage, console result, and verification record to `design-qa.md`.
9. Review the final diff for accidental changes and preserve unrelated work.

Use the in-app browser/Playwright workflow for visual QA. Do not judge fidelity from memory or from a single screenshot taken at a different viewport.

## Desktop acceptance checklist

- [ ] At roughly 1488 x 1058, the compact header, complete map, legend, Recent handoffs, and open inspector fit without document scrolling.
- [ ] All ten room labels are stacked as stage number, stage name, and functional room name immediately above the room footprint.
- [ ] Function machinery is large and visually distinct.
- [ ] Roads read as one physical network at a glance.
- [ ] Implement remains the dominant dynamic 1-N room.
- [ ] Multiple tasks and multiple packages remain readable without fixed-slot assumptions.
- [ ] The active task, active worker, needs-input state, blocked state, completed evidence, and handoff semantics are visually distinct.
- [ ] The red repair road is obvious without implying a repair already happened.
- [ ] Legend metadata and Recent handoffs remain at least 12 px and are not visually secondary to decoration.
- [ ] The inspector closes and reopens, does not sit under the canvas hit layer, and aligns with Recent handoffs.
- [ ] A real blocked task exposes its enabled recovery/open-task action and persisted reason.
- [ ] Human-input states expose the appropriate real action.
- [ ] Preview-only controls, if retained, are explicitly labelled and cannot mutate or open real actions.
- [ ] Table remains the Command Centre default and Map remains secondary.
- [ ] There are no browser console errors or warnings on a clean load.
- [ ] No P0-P2 visual or interaction findings remain.

Mobile-specific visual polish is explicitly out of scope for this pass unless the operator adds it to the feedback section. Do retain a non-destructive responsive fallback so the page does not become inaccessible at smaller sizes.

## Verification commands

Run the narrowest relevant checks first, then the complete gate:

```bash
npm run typecheck
npm run lint
node --test tests/atlas-model.test.mjs
npm test
npm run build
npm run test:sites
git diff --check
```

The build must still produce:

- `dist/client/index.html`
- `dist/server/index.js`
- `dist/.openai/hosting.json`

The Vite build currently emits a large-chunk advisory because of the existing application bundle and raster assets. Do not misreport that advisory as a failed build, but do not conceal any new build error.

## Completion handoff expected from the next agent

Report:

- exact branch and candidate SHA;
- what changed, mapped to the operator feedback;
- important visual or semantic decisions;
- full and focused comparison evidence paths;
- browser interactions and states exercised;
- console result;
- every command actually run and its outcome;
- remaining P3 or separate follow-up work;
- whether the result is only implemented, committed, merged, pushed, or deployed.

Do not call the work merged, published, or deployed unless that exact delivery step was explicitly authorized and completed.
