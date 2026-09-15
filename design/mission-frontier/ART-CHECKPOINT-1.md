# Art checkpoint 1 — connected coastal base

Prepared and explicitly started 15 September 2026. **Locally qualified; delivery packaging and artistic review pending** on `codex/mission-frontier-coastal-checkpoint-1`. This is a bounded art checkpoint before Goal 6. The separately assigned HUD simplification landed in PR #88 and is now merged into this checkpoint. The preparation-only instruction below is historical; Shaun has now started the run after compaction.

## Resume location and baseline

- Worktree: `/Users/shaun/.codex/worktrees/7237/mission-frontier-design-fidelity`
- Branch: `codex/mission-frontier-design-fidelity`
- Latest fetched main at preparation: `aca587e136301950c7e85f34ddeba00d05517163`.
- PR #86 merged at 2026-09-15T04:49:50Z; PR #87 merged at 04:50:28Z. Confirmed from GitHub.
- Main merged without conflicts at local merge commit `3bb7d72b61b66c86ebbdd5d1dc2d6448dd02334e` after preserving the pending review notes in commit `ee5ca7c`.
- `node_modules` is an intentional untracked local symlink. Preserve it and unrelated services/worktrees. The older `agent-harness-ui` checkout is not the implementation target.
- Earlier handoffs describing #86/#87 as open are historical. This checkpoint is new work after those merges. Do not push new implementation into the merged PR and imply it is under review there.

## Paste-to-run prompt

```text
Run Art checkpoint 1 from design/mission-frontier/ART-CHECKPOINT-1.md,
including one GPT-6 Astra asset producer. Create and execute a bounded goal
for this checkpoint. It is separate from Goal 6 and the Sol HUD assignment.

Resume /Users/shaun/.codex/worktrees/7237/mission-frontier-design-fidelity.
Inspect current Git state, applicable AGENTS.md and any concurrent work.
Fetch origin and integrate newer main only after preserving existing changes.
Create a new art-checkpoint branch from this prepared state because the previous
fidelity PR is merged. Preserve current HUD improvements if they have landed.
Do not overwrite or duplicate Sol's HUD work.

Read WORLD-DEPTH-AND-HUD.md, this checkpoint, ASSET-PRODUCTION.md,
LIVING-WORLD.md, and the latest DESIGN-FIDELITY/grounding handoff. Inspect
reference/selected-world.png and screens/project-base-attention-v1.1.png.
Those original scenes are the visual target. The current application is the
functional contract, not the final art-quality target.

Deliver one integrated, coherent exterior at the existing normal World camera:
a detailed featured-project base, a usable courtyard/loading apron, stepped
coastal terrain, one physically elevated road-to-bridge crossing, and a short
animated shoreline. All must be visible and believable together in the real
application. Do not satisfy this with disconnected asset previews, a recolour,
or a background picture containing baked workers and task state.

Use Blender as the assembled source of truth. Use existing owned/free assets
where useful. Agree a measured camera/registration/layer/socket contract before
Astra begins detailed production. One Astra producer owns only the designated
checkpoint staging directory. The builder owns renderer integration, browser
verification, task semantics, acceptance and publishing the journal.

First produce an assembled composition/blockout and inspect it at actual World
scale against the original. Correct footprint, height, courtyard access and
bridge connection before detailed materials. Then author the detailed base and
landscape, integrate registered layers, and add shoreline animation. Continue
through build/check/browser/fix until the scoped acceptance matrix passes.

Preserve React/Pixi, current camera behavior, project identity and positions,
selection, task drill-down, policy controls, current HUD, and all backend/run/
candidate/approval semantics. Keep workers, tasks, artifacts and semantic lights
separate. Terrain and bridge masks must occlude entities correctly. Preserve
existing HQ and Watch functionally; redesigning their architecture comes later.

Use terrain-derived water-depth/shore masks for dark offshore water, turquoise
shallows and subtle foam advancing/receding against rocks. Integrate this with
existing day/night and motion controls. No waves across dry land, through bridge
supports or as a uniform glowing island outline. A moving ocean texture alone
is not acceptance.

Do not depend on paid generation. Existing Meshy models may be evaluated, but
new credit-consuming Meshy jobs require the tool's stated cost approval; if no
approval exists, continue with Blender and available sources. Higgsfield is not
required and no Higgsfield generation is authorized by this run. No new robot
model, cargo/jetpack animation, seabird production batch, HQ/Watch rebuild,
backend activity persistence, progression or Goal 6 work in this checkpoint.

Run the local preview yourself using isolated sample data. Preserve existing
services; choose an available port if needed. Inspect actual World views at the
normal reference desktop size and 1280x720, using computer use. Compare the
original and actual captures together. Verify daylight, dusk, night, motion-off,
blocked/active selection, bridge endpoints, shore contact, depth ordering and
navigation into existing HQ/Watch. No extreme zoom or performance benchmark.

Run relevant Frontier and changed-contract tests, typecheck, lint, formatting,
main build, Sites packaging tests and Frontier build. Run builds sequentially
(main before Frontier). Inspect errors and fix affected behavior. Do not claim
unrun tests, CI, real execution or user artistic approval.

Retain source blends, reproducible scripts, measured exports, hashes/provenance,
acceptance results and browser images under this checkpoint's paths. Write a
handoff with delivered work, differences from the original and remaining limits.
Commit and push a dedicated branch and create a reviewable draft PR against
current main. Update the separate journal from verified evidence, preserving
its current audience and earlier history. Leave the game preview running and
open for review. Do not merge or publish the game.

Finish only after the technical and visual checks pass and the result is ready
for Shaun's artistic review. Stop at this first checkpoint; do not expand the
kit to other projects or start Goal 6 automatically.
```

## Measured production contract

Before the asset producer starts, the builder writes `contract.json` and a short assignment in `design/mission-frontier/assets/staging/coastal-checkpoint-1/`. Specify the camera projection/elevation, logical and source resolution, world footprint, ground and roof anchors, asset IDs, alpha convention, layer order, light direction, shore/depth mask encoding, and scene placement. Inspect the existing loader, feature-project policy and route endpoints; derive compatible numbers from code and reference calibration rather than guessing them.

Astra's disjoint ownership is `assets/staging/coastal-checkpoint-1/astra-scene/**`, including its source blend/scripts, renders, masks, export metadata and static QA. It must not edit public exports, shared manifests, application/backend files, journal files or original references. Builder owns the shared contract and public integration. Reuse one producer; do not fan out independent building, terrain and effect commissions.

Minimum scene outputs, with the exact layer partition agreed during calibration:

- Terrain with real authored elevation, cliff strata and a sheltered shoreline; contact surfaces calibrated to the building/road.
- Articulated ceramic-white/dark-steel building: stepped massing, recessed openings, facade depth, service details and warm practicals. Avoid a plain cylinder, simple box or flat facade texture as the hero building.
- Courtyard/apron and a continuous entrance route. Retain clear zones and sockets for live workers and possible future loading interactions; props alone do not prove task execution.
- Elevated crossing with deck thickness, rails, supports/abutments and contact shadows. Join actual scene endpoints without moving project bases or fabricating a workflow route. Preserve all other connections and variable project layouts.
- Depth/shore coverage masks registered with the land. Background water, submerged edges, foam, foreground occluders and practical lights remain independently controllable where needed.
- No baked task labels, worker agents, progress, cargo handoffs or unknown future task states. Existing ambient workers may populate the integrated clearing with their existing truthful behavior.

One assembled Blender preview establishes composition before export. The integrated browser scene is the final acceptance surface. Higher resolution or additional polygons alone are not evidence of improved fidelity.

## Acceptance matrix

| Check | Required evidence |
| --- | --- |
| Coherent composition | Whole featured base, court, crossing and shoreline read as one place at normal World scale; original/current comparison with explicit remaining differences. |
| Building quality | Visible silhouette/facade depth, entrance court, ground contact and compatible material/lighting treatment. |
| Terrain relief | Terraces and coves with believable changes in level, not a uniformly flat green slab. |
| Bridge/road contact | Road reaches court; elevated deck meets both abutments; no hanging road ribbons, terrain gaps or duplicate old road visible underneath. |
| Coastal depth and motion | Shallows transition to offshore depth; short ordered captures or a clip show foam advancing/receding at the authored shore, with stable land registration. |
| Lighting and motion controls | Day/dusk/night and motion-off captures; effect does not escape masks, illuminate dry ground or ignore motion preferences. |
| Runtime truth and access | Active/blocked/unknown-connection visuals remain truthful; labels and workers selectable; real UI navigation to existing HQ/Watch still works. |
| Export correctness | Common camera/anchors, measured alpha/footprint/mask metadata, content hashes, provenance, clean fallback/error behavior and reproducible source. |
| Regression checks | Relevant tests, types, lint, format and builds actually pass; historical or unrun checks distinguished. |
| Delivery | Dedicated branch/draft PR, dated handoff, journal update to existing audience, open local preview; no merge/game publication. |

Record evidence under `design/mission-frontier/build-evidence/COASTAL-CHECKPOINT-1/`. Preserve earlier fidelity captures and journals. If two targeted corrections fail to improve a particular art mechanism, retain the attempts, diagnose the cause and change the technique instead of repeating cosmetic regeneration. Report any unresolved acceptance item plainly; do not mark the goal complete merely because tests pass.
