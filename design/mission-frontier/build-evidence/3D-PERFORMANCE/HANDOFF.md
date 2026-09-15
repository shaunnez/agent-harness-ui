# 3D performance repair — 16 September 2026

The fixture-only 3D preview now meets this pass's measured 30 FPS target in World, headquarters and Watch at normal laptop scale. The accepted geometry, textures, camera, DPR 1.5 cap and full-resolution GTAO/bloom are retained. No live renderer migration or new scenery is included.

Implementation branch: `codex/mission-frontier-3d-performance`, based on merged main `82ecc7196d025773de6758c6384f0184335b346b` (PRs #90 and #89). Review preview: `http://127.0.0.1:5208/?mode=fixture&scenario=workflow&art=cinematic&renderer=3d#world`. The user's main checkout and existing services remain separate; port 5199 does not contain this unmerged branch.

## What changed

- Pack the worker's 80 rigid mesh parts into six material batches with named bones. Original animation tracks, geometry, normals, UVs and independently selected workers remain intact. A behavioral test compares animated vertices against the actual original GLB, across four poses and two independent worker instances.
- Reject offscreen labels before raycasts, reuse stable visibility, recheck moving labels at most every 100ms, ignore hidden cutaway walls and stop at the first obstruction before a worker. Projection still updates every frame.
- Refresh the 4096px sun shadow map at 15Hz while worker motion remains full-rate. This also avoids the original duplicate shadow render in the GTAO normal pass.
- Keep daylight instrument emissions but omit the negligible physical point lights until dusk. All night point lights remain active.
- Calculate coastline distance with one square root per sample, and stop retaining the default drawing buffer. Minimap and HQ images already use explicit render targets.
- Provide opt-in, fixture-only `&profile=1` diagnostics, absent from ordinary UI.

## Controlled comparison

Same Apple M5 / ANGLE Metal renderer, Codex in-app browser, 1280 × 800 CSS viewport, DPR 1.5, fixed noon, motion enabled, workflow fixtures, one foreground 3D tab. Each result is one warmed ten-second sample, using the same probe on original main and this branch. Both are development builds. The baseline checkout contains only the probe, not optimizations.

| View | Before FPS | After FPS | Before p95 frame | After p95 frame |
| --- | ---: | ---: | ---: | ---: |
| World | 26.0 | 79.2 | 42.7ms | 14.1ms |
| Headquarters | 21.2 | 83.4 | 50.9ms | 13.6ms |
| Watch | 21.3 | 81.6 | 51.0ms | 15.0ms |

World CPU submission fell from 37.98ms to 1.83ms on average; label processing from 4.71ms to 0.06ms. Average renderer calls fell from 4,358 to 616. Shadow refresh frames have more calls than reused-shadow frames. Submitted triangles include all passes and are not unique asset polygon counts.

Night World, with all base lights active, measured 30.0 FPS (p95 36.9ms). It remains the heavier view. This pass does not claim GPU timing, a sustained thermal test, a larger 3D colony benchmark, or equivalent performance on another device. Large asset delivery also remains: the same five GLBs total 114,471,420 decoded bytes (109.17 MiB). Startup entries have different cache conditions and are not a controlled load-time comparison.

Use `controlled-baseline-*.json` versus `after-{world,hq,watch}.json`. Earlier `baseline-*` and `iteration-*` receipts are retained but not used for the speedup: initial measurements had a second 3D tab rendering, and some intermediate experiments reduced DPR/AO resolution. Those reductions were reverted before the controlled final measurements. Foreground IAB screenshots can have whole-page compositor scaling; `review-world.png` and `review-watch.png` are clean captures at the same CSS viewport, without diagnostics.

## Acceptance and checks

| Requirement | Evidence | Result |
| --- | --- | --- |
| Measurable improvement at normal scale | Controlled samples above | Pass |
| Existing art and ordinary camera preserved | Before/review World and Watch captures; original render settings restored | Pass |
| Independent animation and selection | Actual GLB vertex-equivalence test; active PC-142 selected in Watch | Pass |
| Waiting, repair and historical workers parked | Browser data attributes: PC-153/PC-148 parked; historical PC-142 Plan parked; active Implement resumed | Pass |
| Motion preference respected | Motion off made every exposed worker `data-moving=false`; restoring motion admitted only active work | Pass |
| Pan, zoom, framing and appearance | Normal drag and + changed projected anchors; minimap reframed; Command/Purple selected then original Foundry/Orange restored | Pass |
| Context loss and minimap recovery | QA loss showed actionable fallback; Retry returned ready=true, no alert, 400px rendered minimap | Pass |
| Frontend qualification | 103 Frontier tests, four Sites tests, typecheck, lint, format, main build and Frontier build | Pass |

`frontier-tests.txt` is the retained test receipt. `qualification.json` records checks and browser observations; `source-manifest.json` hashes the relevant source and asset manifest. Builds retain the existing large-chunk warnings. No backend suite, fresh live model execution, remote CI, game deployment or main merge is claimed. The browser motion preference was checked; an OS-level reduced-motion change was not repeated in this pass.

## Next

Review this branch at port 5208 before merging it. After that, resume the agreed colony and hexagonal headquarters layout discussion in `NEXT-PHASE-HANDOFF.md`: connected land/bridges, richer terrain, fixed rooms with variable robot occupancy, and a shared spaceport. Those are separate design/build slices. Asset compression and night-light culling can be scoped later if actual usage warrants them.

Delivery is pending: the configured 1Password SSH signer returned `failed to fill whole buffer`, so no performance commit or PR was created. Changes remain staged, and the user's signing preference has not been overridden. Resume the scoped commit and push after signing is available; do not merge main automatically.

The independent journal's article 25, current status, source snapshot and three fresh captures are prepared in the existing journal checkout. Its five tests, typecheck, lint and 54-route build passed. Publication is pending the signed source commit/push; the live journal is still version 23. Preserve its verified owner-only audience. Publishing that journal never publishes the game.
