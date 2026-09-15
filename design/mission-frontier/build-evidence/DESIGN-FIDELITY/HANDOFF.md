> Follow-up: terrain, ground contact and vegetation refined after user review. See [grounding/HANDOFF.md](grounding/HANDOFF.md) for current evidence and remaining limits. Earlier first-pass evidence below is preserved.

# Original-design fidelity — review handoff

15 September 2026. The first scoped fidelity pass is implemented and locally qualified. Goal 6 has not started.

## Delivered

- A registered Astra-authored Blender room kit across the featured project's headquarters and Watch: floor, equipment walls, low foreground parapets and a separate practical-light layer. Workers, role stations, artifacts and status remain independent runtime objects.
- Coastal meadow/limestone materials and deeper blue water derived from retained Goal 3 Blender sources. An uninhabited forested islet adds depth in small worlds where it does not overlap a project; it has no task/project identity.
- Compact World / Tasks / Manage navigation, all five management destinations and shortcuts, and a readable three-item priority queue with explicit access to every decision.
- More compact desktop selection/minimap/action chrome. Normal laptop activity and window behavior retained. Empty completed-run activity no longer promises future run completion.

## Verification

83 Frontier tests and four Sites packaging tests pass. TypeScript, repository lint/format, both builds and diff whitespace check pass. Build logs retain the existing large-chunk warning. No new dependencies, backend changes, model calls, real task mutations, FPS benchmarks or extreme browser zoom work.

Browser checks used sample data at 1568×1003, headquarters 1567×1004, and 1280×720. World -> headquarters -> active and completed/repair Watch, project management, model/reasoning settings, task creation, all eight attention items, menu Escape dismissal, and night practical-light occlusion were inspected. The blocked Watch has 219px of scrollable activity at 1280×720, with its additional reason row; there is no document overflow. This is not native screen-reader or cross-browser qualification.

## Review these images

- after-world.png: World with coastal backdrop and compact HUD.
- after-hq.png: selected repair task among three independent rooms.
- after-watch-active.png and after-watch-blocked.png: active tool contact versus parked completed run.
- after-watch-night.png: physically registered lights behind runtime entities.
- laptop-watch-blocked.png and laptop-command-menu.png: normal laptop access.
- comparison-world.jpg, comparison-hq.jpg, comparison-watch.jpg: original study and implemented sample views at matching dimensions. See root design-qa.md for the visual judgment and acknowledged differences.

## Remaining artistic differences

The original study is still more weathered, asymmetric and densely composed. This pass adds coherent authored geometry and materials; it is not a pixel-identical reconstruction of the flattened concept. Other project islands retain their prior architecture. The robot model/motion remains the accepted living-world model; no new robotic animation claim is made. Lighting remains a 2D tint/emission system with baked shadows. Front practicals retain their base image illumination; the additional night layer boosts back-wall lights before workers/stations and does not shine through them.

The next art iteration should focus on architectural silhouette and restrained wear/prop density, using these comparisons for Shaun's judgment. Do not expand this room kit to every island before that review. Goal 6 is the separate incremental recorded-activity and meaningful event-feedback build; it needs its own start instruction.

## Checkout and preview

Branch codex/mission-frontier-design-fidelity is based on Goal 5 commit 263ae0d. Goal 5 PR #86 is still open; any fidelity PR must be stacked on codex/mission-frontier-goal-5-resumed until that merges. No PR merge or game publication occurred.

Preview: http://127.0.0.1:5206/?mode=fixture&scenario=workflow&art=cinematic#world
The owned Vite process is on 5206, proxying only the existing disposable API on 4325. Existing Goal 5 services and the old dirty prototype checkout remain untouched. node_modules is a local untracked symlink, not a deliverable.

Rebuild room assets using the Astra HANDOFF and environment assets using scripts/frontier/blender/fidelity_environment.py (island / water). Source .blend inputs, exported metadata and hashes are retained. Integrate with scripts/frontier/integrate-fidelity-assets.mjs and the three staging JSON inputs. Public filenames use content hashes. Classic comparison remains available; missing cinematic assets report an explicit load error instead of pretending to have loaded.
