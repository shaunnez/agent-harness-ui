# World depth and quieter controls

15 September 2026. Follow-up design brief from Shaun's review of the grounding correction. Planning record; no new implementation run has started. This is the recommended next fidelity slice before Goal 6, not a redefinition or completion of Goal 6.

## Source and diagnosis

Use the original World and project headquarters references, reaffirmed by the three user-supplied images, with the enlarged selected-task HUD as anatomy guidance. The current application is cleaner and grounded, but remains a set of regular modules on flat islands. The original has connected landscape relief, buildings with articulated facades and courtyards, elevated crossings, sheltered inlets and purposeful exterior work areas. Further palette changes alone cannot deliver that difference.

Retain reference/selected-world.png and screens/project-base-attention-v1.1.png as the composition sources. Implement truthful current task data rather than reproducing historical mock descriptions or invented metrics.

## Confirmed HUD steering

- Move While you were away into Manage; retain its existing briefing and history boundaries.
- Remove the standalone Watch list control and empty-state surface. Keep saved pins and pin/unpin actions. Render a Pinned section directly beneath Needs you only when at least one pin exists, including when there are no current decisions.
- Needs you becomes compact action rows: task identity, a short state/action, project where useful, and an action arrow. Detailed reasons and wait metadata move to the selected-task surface and inspector. Keep distinct repair, human input, dependency and connection states visible; every decision remains reachable.
- Floating labels: task ID and stage, plus one short state line. No task description or explanatory paragraph. Project labels remain distinct from worker/task labels. Accessible names can retain useful context without expanding visible cards.
- Bottom-centre HUD: one selected-task dock. Small portrait; task/stage and state; one primary eligible action plus Inspect; one compact usage/model row. Existing artifacts are compact links or an optional detail section, not permanent empty cards. Full blocker reason is available on selection, with long text in inspection. The dock appears only on selection and is dismissible. Do not shrink controls below the existing readable type and hit-target floor.

## Proposed art and motion delivery

### 1. Prove one connected exterior

Author one coherent Blender scene around the featured project: stepped cliffs and terraces, shallow coves, an articulated base with an entrance court, a loading/work apron, and one road-to-bridge crossing. Model thickness, supports, rails, abutments and shadows; a flat path texture cannot stand in for an elevated bridge. Make the road physically reach the courtyard.

Use an assembled scene as the authoring source, then export registered layers for the current React/Pixi renderer. Keep terrain, architecture, foreground occluders, water masks, lights, stations and workers separately controllable. Export usable anchors for doorways, loading areas, bridge endpoints and flight pads. No arbitrary 3D-camera rewrite or baked task entities.

Review this complete scene against the original at the normal World camera before producing more isolated assets. Geometry, composition and material contrast are the acceptance target, not raw polygon count.

### 2. Carry the architecture into HQ and Watch

Use the same facade language, chamfered corners, wall depth, restrained wear and practical lights in headquarters. Arrange functional spaces around a courtyard/service route rather than letting identical square room tiles define the whole facility. Preserve dynamic 1–N task sites and selectable workers. Explicitly test empty, opening trio and growing task sets; do not hard-code the three rooms shown in the study.

Watch retains its useful activity panel and an unobstructed station/worker area. Prove continuity across all three views before expanding the kit to other projects.

### 3. Add quiet coastal life

Layer dark offshore water, turquoise shallows, submerged-edge shading and restrained reflected light. Use shoreline/depth masks derived from the terrain to animate foam approaching and receding at rocks. Avoid uniform white outlines or waves crossing dry ground. Add a few slow seabird paths with modest wing cycles and variation; keep them away from important labels.

Robot transport and jetpack movement are a later bounded motion slice once loading pads, paths and destinations exist. Ambient crew may move scenery props without implying task progress. A task artifact delivery or agent transition must follow a recorded event; blocked, waiting and historical workers remain parked. Preserve motion-off, reduced-motion and day/night behavior.

## Execution order and ownership

First implement the approved HUD simplification as a small reviewable slice. In the larger art slice, one Astra producer owns the connected Blender scene and measured staging exports; the builder owns application composition, interaction, source-state semantics and visual acceptance. Do not fan out disconnected asset requests. Blender plus existing owned/free sources are sufficient to start; Higgsfield remains excluded.

Acceptance checkpoints: (1) quieter HUD with all decisions/pins/briefing accessible; (2) one cohesive exterior at normal World scale; (3) matching HQ/Watch; (4) shoreline and ambient life; (5) recorded operational transport only where the event contract supports it. Keep each checkpoint independently reviewable.

Verify actual browser scenes at normal desktop and 1280x720 laptop sizes, together with the original references. Check occlusion, ground contact, bridge endpoints, shoreline masks, selected/blocked states, keyboard access and local scroll behavior. Run relevant contracts, typing, lint and builds. No performance benchmarking or extreme-zoom acceptance gate; the user explicitly waived them.

Goal 6 remains bounded incremental operational activity persistence and meaningful recorded-event feedback. Its events can later drive deliveries and transitions. It does not replace the art-direction work above. Building placement, upgrades, unlocks and persistent names remain v2.


## HUD checkpoint — 15 September 2026

The user subsequently started only Confirmed HUD steering. Its local implementation and acceptance are in `build-evidence/HUD/HANDOFF.md`. The proposed art and motion sections above remain planning; this HUD slice does not start them or Goal 6.
