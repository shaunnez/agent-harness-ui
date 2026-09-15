# 3D preview performance repair

16 September 2026. User-reported severe slowness after PRs #90/#89 merged; explicitly authorized performance work. Source: main `82ecc7196d025773de6758c6384f0184335b346b`. Isolated implementation: `codex/mission-frontier-3d-performance`, preview port 5208. Preserve the user's main checkout and services.

## Bounded plan

1. Measure the unchanged renderer with a fixture-only diagnostic probe at 1280 × 800, DPR 1.5, fixed daylight, motion on. Record World, HQ and Watch separately. Frame intervals and CPU submission are measured; GPU time is not inferred.
2. Address observed submission cost and repeated work first: combine robot geometry while retaining independently animated parts, bound/cull label occlusion checks, and reduce shoreline setup work. Keep existing artwork, shapes, textures, lighting, selection and workflow state.
3. Re-measure, tune additional rendering costs only where evidence warrants it, compare day/night and close-up views, and verify World/HQ/Watch, appearance, parked vs active workers, reduced motion and recovery.
4. Run focused behavioral checks and normal frontend checks/builds, record source-bound evidence, update the project journal, and leave a working review preview.

## Acceptance

- Clearly improved measured laptop interaction; aim for at least 30 FPS in the measured World/HQ/Watch samples and report device/browser limits and any remaining misses.
- Preserve the accepted exterior/cutaway appearance and cameras at ordinary laptop scale. Do not meet timing targets by hiding tasks, disabling all animation, or removing the accepted world art.
- Each task retains independent worker selection, animation admission and status; blocked/historical workers remain parked.
- No live-renderer adoption, backend changes, new scenery, paid generation, main-checkout mutation or game deployment.
- Diagnostics remain opt-in and absent from ordinary UI.

The baseline diagnostic is the only renderer change before the first measurements. Raw sample receipts and comparisons are retained here. This record does not claim remote CI, GPU profiling or acceptance on every device.
