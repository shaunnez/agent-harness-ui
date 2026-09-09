# Mission Frontier — living world

Design and implementation plan · 9 September 2026

## Outcome

Make the accepted strategy world feel inhabited between decisions. Keep its architecture, navigation, task controls and evidence semantics. The environment may be playful; execution must remain factual.

## Design

**A small base crew explores the island.** Unassigned robots walk short, authored patrols, stop to look around, then return. Their paths stay on open ground outside buildings and never cross sea, workstations or task labels. They are explicitly ambient base crew, excluded from task counts, costs and execution. Existing task workers may wander only in an explicit idle state; human input, approval, dependency, failure, repair and unknown connection remain parked. Viewing a completed or historical run never makes that run animate as work.

**Rooms have different work rhythms.** Scouts scan with a moving probe and quiet cyan sweeps; planning/specification/design use a console and projection; Grill/triage use communication pulses; Implement/Repair use the fabrication tool with restrained amber contact sparks; Dev Review uses inspection scans; Test uses diagnostic sweeps; Final Review uses a slower inspection. These are illustrative role loops selected from recorded stage/role and active run identity, not claims that a particular file or test is executing. All work effects stop on loss of authority. Blue selection and existing attention labels remain independent.

**One real hour is a world day by default.** Smooth lighting passes through blue predawn, peach dawn, neutral daylight, honey golden hour, coral sunset, violet dusk and deep blue night. Sea and land have different exposure curves. Warm entrance and pathway light pools turn on in stages as daylight falls; work effects and selected/blocked states stay legible. Water glints and foliage provide low-key background motion. A compact World time control is available from World, headquarters and Watch an agent.

**Controls are local and immediate.** Cycle duration is configurable from 10–240 real minutes. Automatic cycle and fixed time are separate choices; a time slider and dawn/day/dusk/night presets make review easy. Changing speed preserves current world time. Preferences survive reload and navigation without touching task settings. World motion and system reduced motion stop continuous animation; fixed lighting can still be chosen. Hidden documents stop their ticker and reconnect never replays task handoffs.

## Implementation slices

1. Add a deterministic, validated clock/palette model and safe worker-behavior policy, with behavior tests.
2. Produce registered Blender walking, scan and console loops through the approved Astra asset workflow. Keep original art intact, source/QA in a separate staging directory and runtime assets under a new manifest. Load extra work poses only for headquarters/agent views.
3. Integrate lighting, bounded ambient paths and role-specific effects into the existing Pixi renderer. Preserve entity reconciliation and input hit targets. Keep animation clocks out of React's task refresh loop.
4. Add accessible World time/settings controls and a truthful illustrative-activity description in Watch an agent.
5. Verify controls, day/night transitions, motion, selection, all room families, stopped/historical/offline behavior, camera round trips and busy worlds in the actual browser. Run focused tests, typecheck, lint, formatting, both builds and the existing broader suite as appropriate.
6. Retain screenshots, animation evidence, measured resource/performance data and a precise handoff. Update the separate selected-audience project journal from this evidence.

## Acceptance

- Visible articulated walking with pauses and no rigid sliding, clipped sprites, floating contact or travel through buildings.
- At least three visibly distinct activity families, selected by recorded role/stage and active run; stopped/historical/blocked workers do not fabricate activity.
- Dawn, daylight, dusk and night visibly distinct in World, HQ and Watch; sea darkens more than architecture, lights increase toward night, HUD remains readable.
- Default 60-minute cycle; validated duration, fixed time, immediate scrubbing, speed-change continuity and reload persistence.
- Motion off/reduced motion/hidden-page lifecycle stop animation; selection, tasks, settings, model/reasoning controls remain usable.
- No backend API/schema change, new model execution, database mutation, paid asset purchase, progression system or game publication.
- Target retained initial transfer below 20 MiB and decoded textures below 192 MiB. Measure any deviation explicitly. Avoid duplicate tickers or unbounded entities after navigation; compare normal/stress performance to retained evidence without representing old numbers as new results.

Implementation checkout: `codex/frontier-living-world`, based on the qualified shared runtime `4c5ef6c`. The original dirty design checkout and existing live runtime are preserved. Final evidence belongs in `build-evidence/LIVING-WORLD/`.
