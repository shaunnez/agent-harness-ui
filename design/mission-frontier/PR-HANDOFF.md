# Mission Frontier — PR handoff

Mission Frontier combines the strategy-game workspace, cinematic island, retained-package recovery, living-world motion/lighting and **Goal 4 laptop usability** for [PR #73](https://github.com/shaunnez/agent-harness-ui/pull/73). Goal 4 is based on the previously verified PR head `fdbe171`; its final application source is `77b04f4d834170eb3e5a0a5c76ae358445b8d8d9`. The user authorized updating the existing PR, with no merge or game deployment.

Goal 4 provides resizable remembered work windows, clearer scrolling and an activity-first Watch panel. Native 200% zoom is now qualified after correcting intermediate task-row overlap and a short-height Settings collapse. At 1280 × 720, maximised Task command retains 457 px of stage content and normal Watch retains 244 px of activity.

Final typing, lint, formatting, both builds and 78 targeted Frontier/API/Sites tests pass. The complete Goal 4 run recorded 1,064 passes and four unchanged orchestration timing failures; the implicated 121 tests pass in a sequential recheck. The older 1,060-test living-world result below remains historical, not the current full-suite verdict. [Goal 4 handoff and captures](build-evidence/USABILITY/goal-4/HANDOFF.md), [final source checks](build-evidence/USABILITY/goal-4/zoom-final-checks.json), [native zoom evidence](build-evidence/USABILITY/goal-4/native-zoom-200.json).

## Scope

The independent React/Pixi workspace provides World → Project headquarters → Watch an agent, task creation/listing, stage/package/artifact drill-down, project management, agent and skill model/reasoning policies, recorded usage and settings. The existing backend remains authoritative for execution, attention, candidate identity and approvals.

Included backend changes are canonical task attention, transactional project rename/archive/restore admission, validated per-role policy snapshots and candidate-bound repair/retry checks. The game uses 35 retained runtime asset entries, 21 cinematic entries and 25 living-world entries. The cinematic presentation is opt-in and features one authored island; other islands and interiors retain earlier art. Cinematic workers now use the articulated character across project bases.

See [source package boundaries](SOURCE-PACKAGE.md) for the included runtime assets, design study, scripts and provenance. Large Blender/source archives and raw runtime evidence remain in the original workspace. The independent journal repository is excluded from this public PR.

## Initial validation of the PR checkout

- A fresh lockfile installation completed.
- **1,041 distinct tests passed; zero failed, cancelled or skipped.** The focused 78-test run is a subset and is not added to that total.
- Typecheck, lint, formatting, original frontend build and Frontier build passed under Node 24.19.0.
- The original build produced all three protected Sites outputs before the combined suite exercised the worker tests.
- The cinematic manifest matches the previously qualified hash: `f517b44b9726712d60e115b782ee46a5277eaab303867d96c3c0d32855d626ca`.

[Exact commands, counts, log hashes and environment](build-evidence/PR/verification.json). Existing Vite large-chunk warnings remain. The fresh installation used the host Node 26.4.0/npm; tests and build commands used the bundled Node 24.19.0 runtime. No dependency version changed during PR preparation.

The retained browser qualification measured 119.05 median FPS normally, 113.64 under the representative stress fixture, and 15.4 ms selection p95. Those are Goal 3 observations on Shaun's Mac; they were not remeasured during packaging. [Performance details and caveats](build-evidence/VISUAL-FIDELITY/performance.md).

## Retained-package recovery update — 7 September 2026

A package stopped by the file-ownership guard can now use **Continue retained package**. One shared predicate keeps the API eligibility, server action and frontend command aligned. The existing retained-worktree identity checks and commit ownership guard still apply: out-of-scope changes must be removed before qualification. Already qualified dependency packages are retained, and unrelated failures do not become eligible for this action.

The updated PR source passed **1,047 tests**, with zero failures, cancellations or skips, using bounded test concurrency. Typing, lint, formatting and both builds passed. The regression cases cover preserved completed dependencies, retained package attempts, refusal of unresolved ownership violations and matching frontend/API actions. [Commands, counts and log hashes](build-evidence/PR/recovery-verification.json). The earlier 1,041-test result above is retained as the initial qualification.

This recovery patch does not make command telemetry incremental or replace the repository's explicit default test-file list; those remain separate follow-ups.

## Living-world integration — 9 September 2026

Idle robots patrol bounded routes with turns and pauses. Six role illustrations distinguish communication, scanning, console work, fabrication, diagnostics and inspection. A configurable world day defaults to 60 real minutes, with separate land/sea exposure, dawn and dusk hues, staged entrance lights and observatory windows. World time and idle roaming are browser-local settings.

Unassigned crew are scenery and never count as task execution. Waiting, blocked, failed, disconnected and historical workers remain parked. Active work illustrations require recorded active runs. The task workflow, evidence, model policies and usage remain authoritative.

Only `882e02b` and its evidence commit `7919147` were cherry-picked, becoming `5eaa8b6` and `efc0ba3`. The combined PR source passed **1,060 tests, zero failed, cancelled or skipped**, including all 13 new living-world tests. Typing, lint, formatting and both builds passed under Node 24.19.0. The previous PR suite had 1,047 tests; the earlier local 1,065-test result used a different base containing unrelated local work. No existing PR tests were removed or weakened.

The 122 files in the living-world source manifest still match their qualified hashes. All Frontier source, runtime art, asset scripts and Frontier tests are identical to the original visual build. This integration changed no backend code, dependency versions or protected Sites files. Full-suite Vite test fixtures emitted HMR port-collision warnings while passing; no new browser-console qualification is claimed.

[Exact commands, source identity, counts and log hashes](build-evidence/PR/living-world/verification.json). [Living-world design, captures and original visual measurements](build-evidence/LIVING-WORLD/HANDOFF.md). Those visual/performance measurements were retained, not rerun for this source integration.

## Review and open issues

- [World at dusk](build-evidence/LIVING-WORLD/after/world-dusk.png): inspect island, sea and entrance lighting.
- [Headquarters at night](build-evidence/LIVING-WORLD/after/headquarters-night.png): compare running work, parked attention states and ambient crew.
- [Agent communication](build-evidence/LIVING-WORLD/after/agent-communication-day.png): review the work illustration alongside recorded activity, policy and usage.

The cleaner worker/architecture and sparse terrain still differ from the weathered interiors and richer design study. The living-world cold-load measurement is 19.69 MiB against a 20 MiB gate; extra art should load on demand. This remains a 2D light pass over baked art, with short authored patrols and two mirrored facings. Review walking pace, work-effect intensity and night brightness during use.

Native background-tab suspension, OS reduced-motion preference switching and OS receipt of the JSON export remain unverified. A real Codex investigation exists, but a representative real implementation → repair → approval → PR journey remains the main functional follow-up. Deterministic workflow coverage must not be presented as that real delivery proof. Building placement, persistent worker names, upgrades and unlocks remain v2.

## Workspaces and running preview

- Current Goal 4 integration checkout: `/Users/shaun/.codex/worktrees/7237/mission-frontier-goal-4`. The earlier PR checkout path is historical.
- Original source/design workspace: `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`; its existing dirty files and the two pre-existing local commits were preserved. Those unrelated commits are excluded from the PR.
- [Current Goal 4 preview](http://127.0.0.1:5204/?mode=fixture&art=cinematic#world) uses the isolated Goal 4 checkout and disposable API4324. The earlier living-world preview is a historical build. Existing user companion processes were preserved; recheck listener ownership before any restart.
- [Published journal](https://mission-frontier-journal.shaunnesbittuk.chatgpt.site/) remains a separate Site with selected-audience access.

The original workspace is deliberately not made clean by this publication. Resume review/fixes on the PR checkout and synchronize any desired preview changes deliberately; do not broadly stage or reset the original workspace.

## Next

Review the updated PR. Start Goal 5 separately for cross-project decisions, return briefing and watch pins. Qualify a bounded real implementation workflow as a separate operational checkpoint using the existing decision/approval gates. Do not merge or publish the game merely because automated checks pass. The earlier [project handoff](HANDOFF.md) retains the full Goals 1–3 history and local evidence map.
