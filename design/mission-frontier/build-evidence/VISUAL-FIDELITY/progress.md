# Goal 3 — final checkpoint

Completed 6 September 2026. V0–V4 passed within the approved scope; published journal confirmed. The [final handoff](HANDOFF.md) is the current authority. Earlier checkpoint notes below are retained as history and may name rejected assets or work that was then pending.

| Checkpoint | Final state |
| --- | --- |
| V0 baseline / ownership | Complete; references, service owners, archive licences and before captures retained |
| V1 calibration | Complete; measured camera, anchors, alpha and worker contact integrated |
| V2 island | Complete; terrain, bridges, water, grove, HQ exterior and 12-frame worker across World/HQ/Agent |
| V3 refinement | Complete; dark grove, terrain shading, facade support, shadow/crop, bridge orientation and hit-area defects corrected |
| V4 qualification | Complete; 57 scoped tests, both builds/static checks, performance budgets, browser interactions and published journal |

Current review route: [cinematic World](http://127.0.0.1:5200/?mode=fixture&art=cinematic#world). Preview 5200 (PID 37795), development 5199 (PID 21424), deterministic API 4322 (PID 9629) and isolated API 4321 (PID 55812) retained. Recheck ownership before any restart. All production Blender renders completed. Temporary transfer probes 5201–5203 were stopped. Journal development is stopped after hosting. Astra is idle with its final source audit and metadata repair complete.

Asset revision `cinematic-v1-final`; 21 new entries; 35 base entries retained. Final wire transfer 18.6027 MiB, resident estimate 126.4375 MiB after lazy retained detail; normal 119.05 FPS / stress 113.64 FPS; selection p95 15.4 ms. Evidence and caveats are in [performance.md](performance.md). User review is still pending; no broad art replacement or new engine/progression work is authorized by completion of this goal.

Journal version 3 published to the same custom audience. Exact record: `journal-site/publication.json`. Original study and posts are preserved; no game commit, push or deployment. See [HANDOFF.md](HANDOFF.md) for current paths, tests and the next recommendation.

---

# Earlier checkpoint history

# Goal 3 — cinematic fidelity progress

Started 6 September 2026, approximately 21:47 Pacific/Auckland. Goal active. V0 complete; calibration integrated, visual refinement remains open. Scope is [the approved brief](../../VISUAL-FIDELITY-GOAL.md).

## Ownership and preserved state

- Checkout `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`, branch `codex/mission-frontier-first-playable`; remote `shaunnez/agent-harness-ui`. Preserve pre-existing tracked/untracked Goal 1/2 work. No game push/deploy or new paid backend workflow.
- Verified running: Vite 5199 PID21424; deterministic fixture API4322 PID9629; actual isolated API4321 PID55812, root `/var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-codex-5CMRsL`. All processes have this checkout as cwd. Recheck ownership before any later restart.
- Blender 5.2.1 LTS executable `/Applications/Blender.app/Contents/MacOS/Blender` verified.
- Reused Astra agent `asset_plan_review`; owns only `assets/staging/cinematic-v1/astra/` and `scripts/frontier/blender/astra_*.py`. Initial assignment: free pack acquisition, one HQ module, vegetation cluster and articulated worker calibration. Root owns renderer, runtime assets, browser, QA, integration and journal.
- Current browser: in-app browser ID2, game tab14. Viewport1568×1003 DPR1 verified. One initial CUA inventory timed out; direct browser selection succeeded. No persistent browser blocker.

## Checkpoints

| Checkpoint | State | Evidence / next work |
| --- | --- | --- |
| V0 baseline | Complete | All five selected references inspected; before/world-1568-fit.png, hq-1567.png, agent-1568.png; baseline hashes and source backup. Both free Standard packs acquired with publisher/licence/archive evidence. |
| V1 calibration | In progress | Blender island/water/bridge plus Astra roof/worker/tree integrated in explicit art=cinematic preview. calibration-world/hq/agent.png captures show anchors and tool contact; tree material and terrain detail need refinement. |
| V2 island | In progress | Authored irregular island, imported rock strata, meadow/gravel, periodic water and independent bridge. Retained v1 interior and stations with all three task states. |
| V3 refinement | Not started | Matched before/reference/after comparisons. |
| V4 qualification | Not started | Browser interactions, performance, tests, journal publication and handoff. |

## Baseline findings and implementation intent

Selected world and four HQ/Agent references inspected. Initial world capture followed a viewport resize without Fit world; do not treat its smaller composition as the default camera. The canonical fitted baseline is before/world-1568-fit.png. Material gaps: repeated coastline/tree silhouettes, thin roof massing, water repetition, limited worker articulation, and disconnected-looking route spans. Preserve operational layout and original art where it is stronger.
Keep existing task/attention projections and independently interactive objects. Add a versioned cinematic visual variant with lazy replacement assets and a prior-presentation fallback. Calibrate Blender exports before building the full island; do not hide mismatched projection behind arbitrary sprite distortion. Existing v1 art remains available for other projects until review.

## Integration and checks

- New asset-policy.ts keeps classic default and supports explicit art=cinematic; stable oldest project receives the island. Classic art is retained. Large old detail backdrop now loads on demand.
- Added a labelled review toggle; runtime semantics are unchanged. Build diagnostic links preserve the art variant.
- Versioned content-hash runtime assets generated by scripts/frontier/integrate-cinematic.mjs. Current manifest is calibration-only, nine entries. Root environment scripts and Astra editable blends retained outside payload.
- Worker creation extracted into world/workers.ts. Fixed feet, shadow, runtime-driven idle/work pose, source probe registered to station socket, independently selectable body; short calibration frames still provisional.
- Typecheck passed after nullable project timestamp fix and worker integration. Three new asset-policy tests passed. Full regression/performance gates not run yet.
- Environment r3 corrected radial shading with dense smooth continuous topology, added low meadow/gravel, replaced vertical beaded cliff outcrops with staggered stone strata. Current island preview source hash e9d6ebd18500405507884e0f1932da1434870fc7ba549baa80e09948d31e494b; render process5975 completed successfully in31s.
- Root asset render sessions57288/69751/89168/36383/5975 completed. Astra final worker production is active; same staging/script ownership. No service restart or paid backend workflow.

## Next action

Inspect r3 terrain and calibrated bridge in app; correct physical shore connections and scene scale. Astra produces a detailed worker with a smooth eight-to-twelve-frame work loop, retaining the verified anchors. New tree is too dark/blocky and roof still too plain; neither is visually accepted. Then finish coherent materials/lighting, test interactions and measure performance. Journal untouched in this run so far.

## V2/V3 checkpoint — 22:46 Pacific/Auckland

Production integration now has 21 cinematic entries beside the untouched 35-entry v1 manifest. Final environment uses 72-sample island/water/two physically rotated bridges; worker has 12 articulated 100ms frames, idle and matching portrait; brighter 64-sample grove r2 has an independent shadow; full 64-sample exterior uses 18 imported Sci-Fi modules and a terraced observatory. Initial dome/slab and dark grove were rejected and retained as iteration evidence. Full exterior replaces the open floating cavity, with a 30px top alpha margin. World labels moved above/alongside the featured HQ to reveal its silhouette.

Root environment warm-material render completed after correcting an invalid CLI argument (`--quality final` is the supported flag). Blender source/dimensions/anchors are unchanged. Both bridge orientations use actual geometry rotation rather than mirrored lighting. Water tile seam was corrected by rendering periodic material beyond the crop boundary. Grove wind is subtle anchored skew, while stopped workers stay in idle. Unrelated v1 interiors/stations/project islands remain intentionally retained.

Actual browser evidence: canvas HQ and worker picking, World→HQ→Agent, running/answer/repair drill-down, dependency S3 waiting on S2, locked historical versus mutable future role policies, task search, and Projects/Agents/Skills/Usage/Settings utility entry points. Actual in-app worker sample has 16 frames over 1.364s; motion-off captures are pixel-identical, with execution still shown as running. Source frames retain fixed feet and <=2.0611 logical pixel probe excursion.

Twenty SPA World/HQ/Agent round trips passed with 53 textures, 5 World scene entities and 2 ticker listeners before/after; original World camera restored exactly. Resident dimensional estimate 114.19MiB. This lifecycle sample used the geometrically identical 24-sample exterior candidate; final 64-sample asset is now integrated for final payload/frame qualification. Evidence: lifecycle-before.json, lifecycle-after.json, animation/.

Checks: test:frontier 45/45; test:frontier-api 8/8; focused asset contract tests 6/6 after final exports; typecheck/lint/format passed; both builds and Sites worker tests passed (see logs). Repeat final checks only for subsequent source changes. Build retains existing large-chunk warning. No paid backend workflow or game publication. Journal remains unedited so far; fresh Site read confirms same custom access with owner and 2 external viewers. Publication must retain that audience.

Next: measure normal/stress >=60s with final production build, selection latency, loaded detail memory, verify disconnected/approval/completed, responsive/camera/focus, prepare matched reference/baseline/current comparisons and design-qa.md, then journal publication and HANDOFF. Current game tab14 in browser2; QA route uses art=cinematic. All production renders have finished; Astra agent idle and available.
