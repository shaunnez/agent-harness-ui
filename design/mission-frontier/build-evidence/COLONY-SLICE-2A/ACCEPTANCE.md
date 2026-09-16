# Colony slice 2A — acceptance matrix (17 September 2026)

Lead acceptance against the revised matrix in Shaun's slice 2A brief. Captures are headless Chromium 149 (SwiftShader WebGL) against this worktree's Frontier dev server on port 5243 at 1568 × 1003 and 1280 × 720, fixed world hour 11 (day) or 23 (night), motion off. Numbers are in `measurements-<step>.json`; every PNG referenced is in this directory; `capture-2a.cjs <step>` reproduces each set.

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Four crowns render on one shell; palette tint works on all four; switching building never moves a base; one room table serves all four | **Pass.** Bastion, Command, Relay and Foundry each render on PlanCheck's parcel from the four-tile picker (thumbnails present on every tile at both sizes). Tint captured on all four crowns across the four palettes (Foundry red/purple, Bastion orange/red in step 3; Command and Relay in all four colours in the acceptance pass). Stored slots stayed P1/P2/P3 through every switch and the base label x anchors were identical before and after. Room allocation has no variant input (`one room table serves every crown` test). | `step3-picker-*.png`, `step3-exterior-{bastion,command,relay,foundry}-*.png`, `step3-palette-*.png`, `acceptance-palette-{command,relay}-{blue,red,orange,purple}-1568x1003.png`, `measurements-step3.json` (`tiles`, `stored`, `basesMoved`) |
| 2 | Ten stress-fixture projects show ten visibly distinct scatter layouts, stable across reload for a given project | **Pass.** `colony-scatter.test.mjs` asserts ten distinct fingerprints and byte-identical re-generation. In the browser the ten-parcel world shows different copses per island; two fresh loads of the stress world differ in 5 of 526,400 scene pixels (< 0.001 %, SwiftShader sampling noise); PlanCheck's and Agent Harness's exteriors differ in 98,392 of the same 526,400 pixels. | `step4-stress-world-day-*.png`, `acceptance-stress-world-pass{1,2}-1568x1003.png`, `measurements-acceptance.json` (`stability`, `distinctParcels`) |
| 3 | Ray-cast validator passes on all parcels; no rim cavities in captures at both sizes, day and night | **Pass.** Builder grid and export re-import: 50,006 (hub) and 50,010 (A) rays, zero see-through cells, zero back-face hits, zero boundary / non-manifold / downward-exposed core faces. Day and night exteriors and stress worlds at both sizes show continuous stratified rims and the wave-cut notch with no holes. | `terrain/export-raycast-validation.json`, `terrain/export-validation.json`, `step4-exterior-{day,night}-*.png`, `step4-stress-world-{day,night}-*.png` |
| 4 | Purple clusters present on every parcel; none inside r 34 or in a spur corridor | **Pass.** Test: every stress project has a copse with purple trees, every tree at r ∈ [34, 41.5], ≥ 7 m from every spur centre line, outside the 50–130° front arc. Captures show copses on the rear and side arcs of every island. | `colony-scatter.test.mjs`, `step4-world-day-1568x1003.png`, `step4-exterior-harness-day-1568x1003.png` |
| 5 | Robots at 2.5× / 1.4× / 1×; labels and picking follow | **Pass.** `workerViewScale` test; world robots read as figures beside the HQ, exterior robots about a storey tall, cutaway unchanged. Labels sit above the scaled head; ring and body scale together so ray picking follows. Standing positions unchanged (test). | `step1-{world,exterior,cutaway}-*.png`, `measurements-step1.json` |
| 6 | At 1280 × 720 with 14 tasks: no card overlaps the viewport edge, every task is clickable at its centre | **Pass.** Before: 5 overlapping pairs, one card over a panel, 8/14 clickable. After: 0 overlaps, 0 over panels, 0 outside the viewport, **14/14 clickable** at 1280 × 720 and 14/14 at 1568 × 1003, each click made with the selection panel open. | `step2-before-cutaway-*.png`, `step2-after-cutaway-*.png`, `measurements-step2before.json`, `measurements-step2.json` |
| 7 | `?colony=1` absent → old archipelago look unchanged | **Pass.** Without the flag the v3 manifest is consumed as v2: island tiles with purple trees, three legacy buildings, archipelago camera and minimap; only the legacy kit is fetched. Cutaway and world captured headless; the legacy Exterior view renders correctly in the desktop browser (blank under SwiftShader, a capture-tool artefact recorded in the journal). | `step0-legacy-{world,cutaway}-*.png`, `step0-colony-world-*.png`, `measurements-step0.json` |
| 8 | Colony asset set total reported and ≤ 25 MB | **Pass.** Published colony set (contract, shell, four crowns, four previews, bridges, two parcels, scatter kit): **18.34 MB**; 19.46 MB with the shared worker. Fetched by the ten-project stress world: 18.21 MB. | `JOURNAL.md` (Housekeeping), `measurements-step4.json` (`assets`) |
| 9 | Existing tests plus new picker, room-table, scatter-seed and card-density tests pass; typecheck, lint, format, build | **Pass.** 148 Frontier tests (`3d-proof`, `colony-runtime`, `colony-scatter`, `colony-assets`, `colony-cutaway` and the rest), `typecheck`, `lint`, `format:check`, `build:frontier`. Producer validator 241 checks; terrain audits pass. | this branch at `6d11c3d` and later |

## Not covered

- Scene-click picking of every robot by an automated script (unchanged from slice 1; the DOM cards are clicked and the 3D picker is unit-tested).
- Interiors, slice 2B, crystals, arrivals: out of scope by instruction.

## Reproduce

```sh
npm run dev:frontier -- --host 127.0.0.1 --port 5243 --strictPort
```

```sh
FRONTIER_BASE=http://127.0.0.1:5243/ node design/mission-frontier/build-evidence/COLONY-SLICE-2A/capture-2a.cjs step4
```

Steps: `step0`, `step1`, `step2before`, `step2`, `step3`, `step4`, `acceptance`.
