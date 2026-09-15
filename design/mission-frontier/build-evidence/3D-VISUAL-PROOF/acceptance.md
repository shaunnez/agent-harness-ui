# 3D proof acceptance — 16 September 2026

Status: **pass for the bounded local proof; ready for Shaun's artistic review.** This qualifies a renderer/scene experiment and material improvement over the previous PlanCheck base. It does not claim that the original study's finish is matched, that Shaun approved the art, or that the whole frontend should migrate.

Final scene: `a69efbdd9ca192ae5044ee0604d8aa7e02b46a6b2e2cb30f306ab1f4e7ecee40`. Final public worker: `aee069a9823b79f201ba7a615313acea18ac83e5844a8f7b3149190262aa370a`.

| Check | Status | Evidence and qualification |
| --- | --- | --- |
| Overall improvement | pass | `final-comparison.jpg`: original, previous browser and proof, with enlarged comparable-base crops. Curved segmented bays, recessed court, photographic coast, physical light and shared cutaway replace the previous stacked box/green slab. Original remains richer in wear, asymmetry and dressing. |
| Base and court | pass | `world-day.jpg`, `world-laptop.jpg`: stepped rounded bays, roof services, framed recesses, grounded feet, props and clear court. The useful prop vocabulary includes consoles, storage, utility equipment, antenna, cart and lights. First generic export was rejected. |
| Connected landscape | pass | Final front/right solid contact volumes replace rejected boundary fins. Court, bridge deck, rails/supports and far landing meet; irregular elevations and scanned outcrops replace the repeated boulder ring. Broad backing surfaces and scan transitions remain art-polish limits. |
| Same-building cutaway | pass | `cutaway-day.jpg`, `cutaway-laptop.jpg`, `watch-active.jpg`, `browser-checks.json`: exterior → cutaway → PC-142 active Watch → exterior keeps task identity. Named roof/shell visibility changes the same GLB; two representative work areas, not all workflow rooms. |
| Exported materials | pass | `asset-inventory.json`, `final-assets-tests.txt`, producer `validation.json` / `packaging-report.json`: 21 embedded scene images, PBR normals/roughness, practical material names and no external texture dependency. Actual browser views inspected, not inferred from Blender. |
| Water and time | pass | `world-day.jpg`, `world-dusk.jpg`, `world-night.jpg`; actual ordered `shore-final-*.jpg` with timestamp manifest and `shore-final-check.json`. Shallow/offshore contrast, short wash beside rocks, darker night sea and practical lighting. Water is a shoreline-distance approximation, not bathymetry or fluid simulation. |
| Agent truth | pass | Eight narrow tests plus `browser-checks.json`: working PC-142, PC-153 answer, PC-148 repair, completed historical Watch, missing run and disconnected admission. Active siblings survive blocked-task state. `motion-check.json` shows active worker motion, parked repair and exact motion-off freeze. No backend writes or task execution. |
| Normal screens | pass | Final 1568×1003 desktop and 1280×720 laptop captures at normal zoom. Labels avoid each other and the clock; task controls and local window scrolling remain usable. The accepted dock can cover lower scenery; Escape clears it. No extreme-zoom redesign. |
| Access and recovery | pass | Keyboard Tab/Enter, Escape, arrows, Space, drag and wheel verified. Actual forced WebGL context loss and missing GLB show explicit recovery with Retry/Return to existing world. Motion-off freezes pixels; system reduced-motion input is reused and reviewed, but OS preference switching/native screen-reader testing was not performed. |
| Regression | pass | Browser verifies default Pixi return, MyStrataAssist project fallback, PlanCheck return, Inspect/Watch, policy controls, usage, minimap and laptop New task. Geometry and accessible labels select the same tasks. New task opened but was not submitted. |
| Maintainability | pass | Shared metre/axis/camera/socket contract, measured bounds, editable `.blend`, retained sources/provenance and reproducible scripts. Independent rebuild matches geometry/material/count/contract data and byte length; exported byte hash differs and is recorded, so byte-identical rebuild is not claimed. |

## Local checks

- `npm run test:frontier`: **96 passed**, 0 failed, 0 skipped (`frontier-tests.txt`).
- Final frozen asset recheck `node --test tests/frontier/3d-proof.test.mjs`: **8 passed** (`final-assets-tests.txt`). Included in the 96-test suite; not 104 independent tests.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed, logs alongside this file.
- After final asset integration, sequential `npm run build` → `npm run test:sites` (**4 passed**) → `npm run build:frontier`: passed.
- Retained warnings: Vite chunk-size advisory; upstream R3F `THREE.Clock` deprecation under Three 0.186. Neither is claimed resolved. Expected error-injection messages are recorded separately from normal rendering.

No shared backend/fixture contract was changed, so Frontier API/full backend tests were not rerun. No remote CI, real model run, approval, benchmark campaign, game PR/push/merge/publication, native accessibility audit or full 3D world qualification.
