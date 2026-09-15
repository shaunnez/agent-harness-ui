# Exterior base follow-up — 16 September 2026

final result: passed

Scope: the user-approved exterior extension to the accepted 3D proof, ready for artistic review. This does not declare the whole original generated study reproduced or approve a production renderer migration.

Source visuals: `design/mission-frontier/reference/exterior-base-details-annotated.jpg` and `selected-world.png`; the earlier accepted 3D proof is the implementation baseline. Actual implementation: fixture preview on 5207. Full views compared at 1568×1003; normal laptop checked at 1280×720. No extreme browser zoom.

The sources and current implementation were opened together in `build-evidence/EXTERIOR-BASES/comparison-world.jpg` and `comparison-details.jpg`. The details board compares annotated source, accepted earlier proof, current Command daylight and night. Crops are resized for object-scale comparison, not fabricated or retouched renders. `base-lineup.jpg` uses matching actual browser crops for Command, Relay and Foundry.

## Iterations and resolved findings

1. P1 — The initial selected-task dock obscured the front base on a laptop. The 3D overview now starts with no automatic task selection; normal camera placement keeps three bases visible. Selection/Inspect remain explicit. Final `world-laptop.png` and `browser-final.json` show all three identities.
2. P2 — The right project label intersected Needs you. Revised preview positions and horizontal framing clear that panel. Exterior task cards are one line; complete status/reason stays accessible and in the existing inspector. Final laptop and desktop worlds show all base labels clear of HUD.
3. P1 — Repeated same-stage workers crossed the analysis bench in the expanded headquarters. Extra positions now use clear floor sockets with clearance from other workers and reserved stations. Revised `relay-cutaway.png` and the larger-crew regression pass confirm the correction.
4. P2 — Headquarters' redundant base label collided with the clock. Headquarters keeps identity in project scope, without repeating the floating exterior base label.
5. P1 — Exterior focus could retain a previous project's identity when navigating between bases and Watch. Project route context now takes priority and leaving a world detail view clears stale focus. Verified Relay/Foundry exterior navigation and final Watch → World return.

## Fidelity surfaces

- Fonts/typography: existing Inter and compact semantic controls preserved. Picker labels are 12px minimum; normal project/control text remains 14–16px. Exterior cards are slimmer without dropping accessible state.
- Spacing/layout: one project/base across the same map; three choices live in a compact secondary panel. Desktop and laptop shots retain working task controls, minimap and precise drilling. Base/worker selection uses both DOM controls and actual model picking.
- Colours/tokens: Blue/Red/Orange/Purple change only project identity materials and its label. Task answer/repair/active status remains independent. Warm windows and neutral body materials retain their separate roles; dusk/night are visibly illuminated.
- Image quality: actual GLB silhouettes differ and remain coherent with the accepted lower architecture. Worker height increases 72%; crates and cart now read at useful relative scale. New roof, sensor/computer/marker detail is modelled. The original's dense connected terrain, realistic wear and richer roof iconography are still more detailed; the user-approved scope was the exterior follow-up to the accepted proof, not rebuilding the environment or matching every generated detail.
- Copy/content: project and task identities derive from fixture runtime records. All three projects are represented and their crews remain scoped. Appearance explains browser-local saving. Historical Watch explicitly reports completed/parked; live task state stays distinct from historical run state.

No remaining P0/P1/P2 acceptance gaps for this bounded exterior slice. User artistic approval remains the next gate. Terrain continuity/variety, material wear, richer courtyard props, bespoke characters, coastal life and live renderer adoption are documented follow-ups.

Checks: 101 Frontier tests, 4 Sites tests, typecheck, lint, formatting and both builds; actual day/dusk/night, appearance/reload, model picking, all three cutaways, active/historical Watch and laptop checks. Motion comparison shows changing roof/instrument pixels when enabled and zero pixel change in all sampled scene regions when disabled. Native OS reduced-motion and full recovery injection were not repeated here; retained proof evidence is dated separately.
