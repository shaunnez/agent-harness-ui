# Mission Frontier — current handoff

**Publication update:** use [PR-HANDOFF.md](PR-HANDOFF.md) for the isolated PR checkout, freshly rerun 1,041-test qualification and current review status. The dated pre-publication record below retains the Goals 1–3 history and original local service/evidence locations.

Updated 6 September 2026, 23:48 NZST. Goals 1–3 are complete within their stated scopes. Goal 3 is ready for Shaun's visual review; that review has not yet happened. This is the current entry point for continuing the project. Earlier milestone records remain evidence of their own dates and scopes.

## What exists

Mission Frontier is an independent React/Pixi frontend over the existing local backend, APIs and event/state contracts. The game is the primary workspace: projects are bases, tasks have workers and stations, and the operator moves between World, Project headquarters and Watch an agent. Semantic overlays provide the task list, creation, project management, stage/package/agent drill-down, artifacts, model/reasoning policies, settings and recorded usage.

| Delivery | Result | Evidence |
| --- | --- | --- |
| Goal 1, M0–M3 | First playable; world/HQ/agent journey; shared attention semantics; one real Codex investigation | [Goal 1 handoff](build-evidence/M3/goal1-handoff.md) |
| Goal 2, M4–M7 | Full v1 management/workflow surfaces; 25 destinations; bounded backend support; original 35-entry art kit | [v1 handoff](build-evidence/HANDOFF.md), [screen coverage](build-evidence/M7/coverage.md) |
| Goal 3, V0–V4 | One cinematic island across all three scales; 21 additional runtime assets; source/rebuild and browser qualification | [Goal 3 handoff](build-evidence/VISUAL-FIDELITY/HANDOFF.md), [acceptance](build-evidence/VISUAL-FIDELITY/acceptance.md) |

Astra produced the articulated worker, matching portrait, purple grove and modular observatory exterior. The main builder produced the terrain, water and bridges, then integrated and qualified the assets in the actual renderer. Editable Blender scenes, approved source archives, licences and rejected iterations are retained. See [asset provenance and rebuild commands](build-evidence/VISUAL-FIDELITY/assets.md).

The new artwork is an explicit `art=cinematic` preview and currently features one project island. Other islands and the cutaway interiors/stations retain v1 art. `art=classic` restores the prior presentation. The fixture projects and activity are labelled sample data; viewing them does not execute real tasks.

## Review the result

1. [Cinematic World](http://127.0.0.1:5200/?mode=fixture&art=cinematic#world): select PlanCheck and inspect the island silhouette, observatory and bridge connections.
2. [PlanCheck headquarters](http://127.0.0.1:5200/?mode=fixture&art=cinematic#project/plancheck): compare Working, Needs your answer and Repair required; inspect the dependency waiting on the running package.
3. [Watch an agent](http://127.0.0.1:5200/?mode=fixture&art=cinematic#agent/PC-142/R-PC-142-implement-1): review worker scale, motion and character, then inspect the task, output and recorded policy/usage.
4. [Original presentation](http://127.0.0.1:5200/?mode=fixture&art=classic#world) is available for comparison.

These are actual in-app captures from the qualified build on 6 September, not generated mockups. They were reopened and visually inspected during this handoff refresh. The current asset manifest still matches the qualified SHA-256.

| Screen | Screenshot | Comparison |
| --- | --- | --- |
| World | [1568 × 1003](build-evidence/VISUAL-FIDELITY/after/world-1568.png) | [Study / before / after](build-evidence/VISUAL-FIDELITY/comparisons/world-reference-before-after.jpg) |
| Headquarters | [1567 × 1004](build-evidence/VISUAL-FIDELITY/after/hq-1567.png) | [Study / before / after](build-evidence/VISUAL-FIDELITY/comparisons/hq-reference-before-after.jpg) |
| Watch an agent | [1568 × 1003](build-evidence/VISUAL-FIDELITY/after/agent-1568.png) | [Study / before / after](build-evidence/VISUAL-FIDELITY/comparisons/agent-reference-before-after.jpg) |

[Actual worker animation](build-evidence/VISUAL-FIDELITY/animation/in-app-worker.gif), [needs-answer state](build-evidence/VISUAL-FIDELITY/after/agent-needs-answer.png) and [repair state](build-evidence/VISUAL-FIDELITY/after/agent-repair.png) supplement those three views. Smaller desktop and phone fallback captures are in the same `after/` directory.

## Checks and their limits

Goal 3 recorded **57 passing scoped tests, zero failures/skips**: 45 Frontier, 8 Frontier API and 4 Sites worker tests. Typecheck, lint, formatting and both builds passed. This handoff refresh checked the three test-log hashes against [qualification.json](build-evidence/VISUAL-FIDELITY/qualification.json); it did not rerun those suites. Goal 2's 1,040-test result is historical and must not be described as rerun for Goal 3.

Measured on Shaun's Mac in the embedded browser, using the production build:

- Normal: 10 projects, 100 tasks, 20 visible workers; **119.05 median FPS**, p95 frame time 11.7 ms.
- Busy: 50 projects, 1,000 tasks, 50 representative workers; **113.64 median FPS**, p95 frame time 11.9 ms. This is not 1,000 simultaneously animated workers.
- Selection p95 **15.4 ms** including an intervening paint; 20 navigation round trips retained bounded entities, textures and listeners.
- Initial transfer **18.60 MiB** against a 20 MiB gate; estimated decoded texture residency **126.44 MiB** after retained detail against a 192 MiB gate. The transfer budget leaves only about 1.4 MiB of headroom.

The [performance record](build-evidence/VISUAL-FIDELITY/performance.md) describes measurement methods and the identical-geometry calibration asset used for the lifecycle run. These are measured local results, not general hardware guarantees.

Manual motion-off, stopped runs, disconnection and retained-state behaviour were exercised. Native background-tab suspension and OS reduced-motion preference switching remain unverified because this host did not expose the required states. The earlier OS receipt of a JSON export also remains unverified. No native pass is inferred from unit tests.

## Issues and delivery risks

| Item | Assessment | Smallest useful next action |
| --- | --- | --- |
| Mixed visual materials | The new worker and architecture look cleaner than the retained weathered interiors; the new ground is sparse and the cliff shapes remain strongly stylised. The original study has richer atmosphere. This is a visible design gap, not an execution-state defect. | Review the three views with Shaun; tune ground dressing, contact/lighting and material consistency on this island before producing more islands. |
| Real delivery workflow not yet proved end to end | The actual Codex investigation is retained. Implementation, repair and PR paths have deterministic coverage, but a representative real task has not traversed all those boundaries through Frontier. | Make one small real implementation task the next functional milestone, using an isolated repository and explicit existing decision/approval gates. Retain exact candidate/run/PR evidence. |
| No root Git delivery checkpoint | All game work remains local and uncommitted alongside earlier dirty files. Goal completion is not a committed or released version. | Review ownership and produce a scoped source checkpoint, retaining licences/rebuild sources and keeping unrelated work and render scratch out of broad staging. Re-run affected gates on that checkpoint. |
| Asset growth | Current measured budgets pass, but cold transfer is close to its cap. A wholesale kit expansion could regress startup. | Keep lazy loading and measure bytes/textures after any new art; do not extrapolate the existing result. |
| Native integrations and compact polish | Native visibility/motion/export checks remain open. At compact desktop size, navigation grazes the decorative portrait edge; the existing large-chunk warning and empty favicon 404 remain. | Complete native checks in a browser that exposes those behaviours and address the small layout/build items in a bounded polish pass. |

The Goal 3 evidence records no unresolved P0/P1/P2 defect within its one-island scope. That qualification does not establish complete release readiness or visual parity with every generated design.

## Recommended order from here

1. Shaun reviews the island, observatory and worker character. Capture only concrete refinements; do not reopen the accepted game/overlay architecture.
2. Preserve a reviewed source checkpoint, then run one bounded real implementation through the full task workflow. Exercise repair/retry with retained candidate lineage, explicit final approval and GitHub delivery when authorized. Do not manufacture a model failure solely to obtain a repair screenshot; retain deterministic repair coverage where appropriate.
3. Complete the native checks and agreed visual polish. Re-measure transfer/frame/texture budgets after art changes.
4. Expand the reviewed kit to other project islands and interiors only after that review. Building placement, persistent worker names, upgrades, unlocks and economy stay in v2. A real-time 3D rewrite is outside the accepted approach.

This handoff recommends those next steps; it does not start another goal, a model run, a commit, PR or game publication.

## Checkout, runtime and journal

- Checkout: `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`
- Branch: `codex/mission-frontier-first-playable`; unchanged HEAD: `e31566a36ed871cdb3743b8aaadaf08e7f19c6fd`
- Remote: `https://github.com/shaunnez/agent-harness-ui.git`
- App entry: `src/frontier/`; integration: `src/frontier/world/`; runtime boundary: `src/frontier/runtime/`; fixture states: `src/frontier/fixtures/`; tests: `tests/frontier/`.
- Original frontend and protected Sites entry/build files remain separate. Mission Frontier's current redesign brief takes precedence over historical Evidence Gate/Courier Rooms visual guidance; retain backend semantics from those earlier contracts.

Listeners and command ownership were rechecked for this handoff:

| Service | Port / PID | Purpose |
| --- | --- | --- |
| Production preview | 5200 / 37795 | Qualified built artifact; HTTP 200 rechecked |
| Development preview | 5199 / 21424 | Frontier development server; live mode proxies to the isolated actual API |
| Actual isolated API | 4321 / 55812 | Existing real Codex investigation and retained evidence |
| Deterministic API | 4322 / 9629 | Injected provider/GitHub fixtures; not real model execution |

Services remain running. Revalidate ownership before restarting anything. Retain the actual disposable root `/var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-codex-5CMRsL` and its data; do not regenerate AH-001. Existing user-owned services are not part of this handoff's restart authority. Restart commands and fixture-root details are in the [v1 operation record](build-evidence/HANDOFF.md#local-operation-and-rollback).

The independent [project journal](https://mission-frontier-journal.shaunnesbittuk.chatgpt.site/notes/one-island-with-depth/) is published at version 3. Its publication record preserves selected-audience access and two external viewers; the six-hour update automation remains unchanged. The journal source commit is `868d28c8008581c69480f5d7e531703898f2d8e1`; exact deployment details are in `journal-site/publication.json`. Journal publication does not publish the game. This documentation-only handoff refresh does not change the journal article or deployed UI.

## Resume safely

Read this handoff, current `AGENTS.md`, [implementation plan](IMPLEMENTATION-PLAN.md), [build goals](BUILD-GOALS.md), [Goal 3 brief](VISUAL-FIDELITY-GOAL.md) and the relevant acceptance record. Inspect the actual checkout, dirty files, listener owners and runtime authority before changing anything. Keep all existing design decisions and user-owned work. Follow the next task Shaun explicitly requests; do not rerun completed goals or automatically launch another asset agent.
