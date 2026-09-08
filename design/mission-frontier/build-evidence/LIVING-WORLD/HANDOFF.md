# Living world — review handoff

9 September 2026 · implemented and qualified locally, with the native-browser limits below.

The cinematic world now has idle patrols, six illustrative work rhythms, a configurable 60-minute day, separate land/sea lighting and staged warm lights. The design and implementation plan is [LIVING-WORLD.md](../../LIVING-WORLD.md). Application source is commit `882e02b6727116a4ad45008d39c89e82b709a076` on `codex/frontier-living-world`, based on the shared runtime `4c5ef6c`.

## Review it

- Development preview: http://127.0.0.1:5199/?mode=fixture&art=cinematic#world
- Built review artifact: http://127.0.0.1:5201/?mode=fixture&art=cinematic#world
- Select a base, **Enter base**, select a task, then **Watch agent**. The World time button opens lighting controls from every scale.
- Default day length is 60 real minutes; choose 10–240, or hold Dawn, Daylight, Dusk or Night. Preferences are local to each browser origin. World motion and Idle roaming are separate controls.
- [Daylight](after/world-daylight.png), [dusk](after/world-dusk.png), [night](after/world-night.png), [headquarters at night](after/headquarters-night.png), [communication](after/agent-communication-day.png), [diagnostics](after/agent-diagnostics-day.png), [completed run](after/agent-historical-parked.png).

These links show sample tasks. The companion on 4310 and original frontend on 4173 were stopped at the start of this pass and were not restarted. The development preview is configured to proxy 4310 when that companion is deliberately started; the production review server is for fixtures. No task execution, database change, backend/API change, paid asset purchase or game publication was performed.

## Behavior and implementation

Unassigned base crew follow bounded paths with articulated walking, turns and pauses. They have no task identity, selection ring, usage or execution count. World crew is capped at twelve bases; busy worlds use one per base. Explicitly idle task workers may roam; human input, approval, dependency waits, errors, repair and unknown connection remain parked. An active sibling package may keep working when another package fails. Historical and completed runs stay parked in their recorded room and have a parked label, even while the task has another active run.

| Recorded work | Illustration |
| --- | --- |
| Triage / Grill | Console taps and communication pulses |
| Scouts | Head/probe movement and a cyan scan field |
| Specification / design / Plan | Console taps and a projection |
| Implement / Repair | Fabrication tool and amber contact sparks |
| Dev Review / Final Review | Slower inspection sweep |
| Test | Diagnostic probe and scan |

These are role illustrations, not a replay of exact tools, files or tests. Runtime activity, candidate gates, model/reasoning policies and usage remain authoritative. Existing task management is unchanged.

The clock is deterministic and persisted, rebases speed changes without jumping, and uses separate smooth land/sea curves. Sea exposure falls further than architecture. Entrance pools and an authored additive observatory-window pass fade in at staggered thresholds. Foliage and water glints add quiet motion. Lighting updates at 8 Hz inside Pixi; it does not reconcile tasks each frame. Motion-off, reduced-motion admission, disconnection and visibility lifecycle stop the ticker; manual lighting controls still work.

The Astra asset agent produced three registered eight-frame Blender loops (walking, scanning, console taps). Builder integrated the frames, authored the matching light pass and owned browser acceptance. The added manifest has 25 hash-verified images totaling 2,258,977 bytes; only 1,129,069 bytes are admitted initially. Scan/type poses load when entering HQ or Watch. Sources and registration reports are in [the asset handoff](../../assets/staging/living-world/astra/README.md); normal builds use the committed runtime PNGs and do not require Blender. Large authoring artifacts remain local and ignored.

## Verified checks

- **1,065 tests passed; zero failed, skipped or cancelled**, using explicit discovery across root, Frontier and Frontier API tests. The 13 new living-world/asset tests are included; `test:frontier` passed 58 tests.
- TypeScript, full lint, formatting, diff checks and both frontend builds passed. The full suite includes all four protected Sites-worker tests. No real model or GitHub delivery was launched.
- Browser: 60-minute default, custom 120-minute duration and reload persistence; four fixed phases at World/HQ/Watch; six work families; parked history, repair and human waiting; motion-off with manual night selection; explicit fixture disconnect/reconnect; repeated navigation.
- Offline samples 31 seconds apart retained the same actor position/frame and world hour, with the ticker stopped. Motion-off samples also retained the same frame/position. Fixture connection failures in those logs are intentional.
- Twelve World/Watch round trips retained **78 textures, one scene entity, eight lighting surfaces and two ticker listeners** in the same detail view.
- Production normal sample: **10 projects / 100 tasks, 129.87 median FPS, 9.6 ms p95**, over 67.23 seconds. Stress: **50 / 1,000, 129.87 FPS, 9.5 ms p95**, over 63.03 seconds. These are measurements on this machine, not general device guarantees.
- Final cold-load probe: **20,648,400 response wire bytes / 19.69185 MiB**, 78 successful responses. It includes worker-owned image requests omitted by the window's Resource Timing API. Initial Pixi decoded textures: **126.19 MiB**; with activity loops: **135.19 MiB**, below 192 MiB. Exact reports and source hashes are retained in this directory.

## Limits and next steps

The in-app host still reports `document.hidden=false` when its browser is hidden. Actual native tab suspension and OS reduced-motion transitions remain unverified; lifecycle logic and the user motion switch pass. The browser cannot establish driver VRAM from texture dimensions.

This is a 2D lighting/art pass over authored Blender renders. Existing baked highlights/shadows remain, with no physically rotating sun/shadows. Patrols are small authored routes using two mirrored facings, with no navigation mesh or robot collision avoidance. The original comparison mode retains its classic worker art; new walk/pose assets are for cinematic mode. Dense all-station labels retain the v1 layout limitations. The main bundle warning remains, and cold-load headroom is only about 0.31 MiB.

Review the walking pace, amount of work effects and night brightness next. Then integrate the feature commit into the PR's isolated branch and rerun that branch's qualification. PR #73 was checked open at `02f6380` on 9 September; this living-world commit is local and is not yet on that PR. Do not push the whole shared-runtime branch over the PR: its base intentionally includes other local work. No v2 placement, names, upgrades or unlocks were introduced.

Implementation checkout: `/Users/shaun/.codex/worktrees/7237/mission-frontier-living-world`. The original dirty checkout is preserved. Runtime code and public assets are committed; this handoff/evidence is a separate documentation commit. Journal publication updates only the independent journal with its existing selected audience.
