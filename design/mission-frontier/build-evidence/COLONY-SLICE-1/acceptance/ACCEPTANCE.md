# Colony slice 1 — browser acceptance (16 September 2026)

Lead acceptance against the ten criteria in `design/mission-frontier/colony/DELIVERY-SLICE.md`. Captures were driven by headless Chromium 149 (SwiftShader WebGL) against this worktree's Frontier dev server at 1568 × 1003 and 1280 × 720, fixed world hour 11 so terrain and crowns are inspectable. Every number below is in `measurements.json`; every PNG in this directory is referenced from it.

Scenarios: `?mode=fixture&scenario=workflow&art=cinematic&renderer=3d` (three projects) and `scenario=colony-stress` (ten projects, PlanCheck carrying fourteen open implementation tasks, three with two parallel packages).

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Three projects at P1–P3 with three bridges; reload never moves a base | **Pass.** Slots P1/P2/P3 persisted browser-local; after reload every base label moved 0 px and the stored slots were byte-identical. Reorder/archive invariance is covered by `colony-runtime.test.mjs`. | `world-*.png`, `measurements.sizes.*.world.slots`, `.reload` |
| 2 | Ten projects fill P1–P10, no overlap, unconnected spurs hidden | **Pass.** Ten project labels, slots P1–P10 in createdAt order, no label overlaps; bridge table and spur hiding are asserted by `colony-runtime.test.mjs` ("three bases connect only to hub…", "every bridge reaches the opposite face within 5 cm"). | `stress-world-*.png`, `.stress.slots` |
| 3 | Six labelled rooms per HQ; robots in the stage's room; min spacing 3.3 m | **Pass.** All three HQs show Briefing, Planning, Implementation, Review, Testing, Dispatch; behaviours match fixture stages (PC-142 work, PC-148/PC-153 park, AH-054 work). Spacing and wall/bench clearance are asserted by "strict allocation fills implementation, hub then court" and "larger fixture crews stay clear of the analysis bench". | `cutaway-{plancheck,harness,mystrata}-1568x1003.png`, `cutaway-plancheck-1280x720.png` |
| 4 | Fourteen-task project fills implementation, hub, then court; every robot pickable; no task dropped | **Pass at 1568 × 1003, partial at 1280 × 720.** No task is dropped: fourteen robots stand in Implementation, on the hub and on the court/apron at both sizes, and fourteen cards render inside the viewport. At 1568 × 1003 no card covers a HUD panel or another card and clicking each card selected exactly that task (14/14). At 1280 × 720 fourteen 57 px cards do not fit above the back row: four (COL-001/002/003/007) fall back to the top edge, overlap each other and the header, and 8 of 14 cards were clickable by their centre. 3D ray picking is covered by the existing pick tests; the script's blind canvas clicks under each card anchor hit 3 of 14 robots at 1568 and 0 at 1280, which measures the click heuristic, not the picker. Follow-up recorded in HANDOFF.md. | `stress-cutaway-plancheck-*.png`, `.stress.domPickSummary`, `.stress.cutaway.cardPairsOverlapping`, `.cardsOverPanels` |
| 5 | Exterior → cutaway → Watch → exterior keeps identity; Watch active vs historical; motion-off freezes | **Pass.** Journey `#project/plancheck` → select PC-142 → `#agent/PC-142` → Exterior (`#world`, PC-142 still selected) → `#project/plancheck` (PC-142 selected). Watching AH-054's active run shows it working; watching its failed S2 run parks it. With motion off, three sampled canvas regions changed 0 pixels across two 1.2 s intervals; with motion on the room region changed 144–413 pixels. | `watch-*.png`, `.journey`, `.watchActive`, `.watchHistorical`, `.motion` |
| 6 | Ray-cast validator passes on parcel A and hub; no rim cavities at both sizes | **Pass.** Terrain builder's `export-raycast-validation.json`: 50,006 and 50,010 rays, zero see-through cells, zero back-face hits. Day captures at both sizes show continuous rims and coasts. | `terrain/export-raycast-validation.json`, `exterior-plancheck-*.png`, `world-*.png` |
| 7 | Cameras match the contract; labels clear the Needs-you panel and dock at both sizes | **Pass.** Cameras come from `contract.cameras` via `colony.ts`/`layout.ts` (tested). No project, task or room label intersected the Needs-you panel or the dock in any capture at either size. | `.world.overlapping`, `.exterior.overlapping`, `.cutaway.*.overlapping` (all empty) |
| 8 | Command crown tints in all four palettes; appearance persists, project-scoped | **Pass.** Blue, red, orange, purple each stored for PlanCheck and visible on the crown disc and ring; after reload PlanCheck kept purple, the other two projects' records were unchanged, and every slot was unchanged. | `palette-*-1568x1003.png`, `.palettes` |
| 9 | Colony assets ≤ 60 MB at three projects, ≤ 120 MB at ten | **Pass.** 15.35 MB of `/assets/3d-proof/` bytes fetched in both scenarios (shell 2.77, crown 1.71, span 0.99, end 0.43, parcel-hub 4.18, parcel-a 4.13, worker 1.12, manifest); shared geometry is fetched once. | `.world.assets`, `.stress.assets` |
| 10 | Existing tests plus new placement, allocation, manifest v3 and validator tests; typecheck, lint, format, builds | **Pass.** 139 Frontier tests (`npm run -s test:frontier`), `typecheck`, `lint`, `format:check`, `build:frontier` all pass on the final commit. | this branch |

## Defect found and fixed during acceptance

In the fourteen-task cutaway the label separator stacked cards upward without a viewport bound, so the back row's three cards sat above the top edge at 1568 × 1003 (invisible and unclickable) and more at 1280 × 720. `labels.ts` now stacks around pinned room names and the HUD panels, drops a card below its neighbours with an upward leader when the stack would leave the viewport, and carries a 0.01 px collision tolerance because a card stepped exactly one gap past a fractional-height room label re-collided through floating-point error and stalled. Tests: "crowded labels near the top edge drop below their neighbours…" and "a card walking below a fractional-height room name clears every later card too".

## Not covered here

- Live-mode behaviour (slice is fixture-only by design).
- Scene-click picking of every robot by an automated script; the picker is covered by unit tests and manual clicks.
- Relay and Foundry crowns, parcels B and C (slice 2).

## Reproduce

```sh
npm run dev:frontier -- --host 127.0.0.1 --port 5242 --strictPort
```

Then run the capture script recorded in `capture-acceptance.cjs` (Node, Playwright-core 1.61 from any local install) with `FRONTIER_BASE=http://127.0.0.1:5242/`.
