# Goal 2 — complete v1

**9 September living-world update:** Idle robot patrols, six role animations and the configurable day/night cycle are implemented and qualified in an isolated review checkout. See [the living-world handoff](LIVING-WORLD/HANDOFF.md) for the design, 1,065-test qualification, fresh captures and performance, preview links and explicit browser limits. This visual pass does not restart the companion or change the live database. The earlier checkpoints below remain historical.

Goal 3 is complete and ready for review; its final checkpoint is [VISUAL-FIDELITY/progress.md](VISUAL-FIDELITY/progress.md). The completed Goal 2 record below remains historical.

**Complete: M4–M7.** Shaun accepted the first playable on 6 September 2026, said current feedback can wait, and requested continuing. Preserve the accepted visual direction. No v2 features or publication.

## Authority and baseline

- Checkout `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`, origin `https://github.com/shaunnez/agent-harness-ui.git`, branch `codex/mission-frontier-first-playable`, HEAD `e31566a36ed871cdb3743b8aaadaf08e7f19c6fd` verified unchanged at Goal 2 start.
- Preserve all uncommitted Goal 1 code/assets and the pre-existing design pack/AGENTS.md. Goal 1 evidence is retained in M0–M3, HANDOFF.md and M3/progress-complete.md.
- One existing GPT-6 Astra agent (`asset_plan_review`) owns each assigned A2 staging directory only. Builder owns code, manifests, dependencies, runtime and browser.
- Verified Node 24 runtime: `/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`.
- Actual paid CLI journey AH-001 is complete; retain its evidence and do not repeat it. Use isolated deterministic provider/GitHub fixtures for Goal 2 exhaustive checks.

## Milestones

| Milestone | State | Evidence |
| --- | --- | --- |
| M0–M3 | Passed; accepted by Shaun | M3/acceptance.md and retained Goal 1 handoff |
| M4 | Passed | M4/acceptance.md |
| M5 | Passed | M5/acceptance.md and design-qa.md |
| M6 | Passed with stated native-host verification limits | M6/acceptance.md and design-qa.md |
| M7 | Complete | M7/acceptance.md, coverage.md, performance.md, assets.md |

## Final checkpoint

1,040 tests pass, both builds/Sites packaging pass, final source builds in an independent lockfile installation, all 25 destinations have evidence, A2 assets are qualified, and the local preview is open. AH-001 real CLI evidence is retained without rerunning it. Native OS background visibility/download receipt remain explicitly unverified in IAB; minor visual changes remain P3. No publication or normal-user runtime mutation occurred. See HANDOFF.md for complete operating boundaries. The checkpoints below are historical notes, superseded by this final checkpoint.

## Current checkpoint

- B1 adds validated canonical role overrides across every snapshotted profile, with inherited/override provenance. Legacy blanket requests remain supported and cannot mix with the new matrix.
- B2 adds rename/archive/restore, keeping repository identity immutable. Archive admission and task creation share each store's transaction; archive cannot hide unresolved tasks, active work or an open/publishing PR.
- Existing store/SQLite/first-playable API targeted suite passed after these changes; new contract tests and UI integration are next. Final M4 acceptance is not yet claimed.
- Astra is producing only `mf.station.intake` r1 in A2 for Triage; awaiting asset handoff and integrated review.

## Services and next action

Ports were inspected at start: web5199 PID21424, isolated actual API4321 PID55786, deterministic API4322 PID9629. Recheck ownership before any restart. Retained roots are in M3/progress-complete.md. User runtime4310 and design gallery5198 remain untouched.

Next: finish B1/B2 admission/parity/race tests, add Projects/setup and full task brief/policies/review with deep-link navigation. Extend fixtures independently of live commands, then run computer-use against matched M4 references. Continue through M5–M7 after qualified slices; no further routine approval is needed.

### Goal 2 checkpoint — M4 management built, qualification active

- B1/B2 backend and full management UI implemented; focused combined suite is **54 passing**, zero failed/skipped (`M4/management-suite.log`). Typecheck and scoped lint passed before the latest visual correction; final M4 regression pending.
- Projects: register/validate, readiness, explicit verification proposal approval, rename, archive/restore. Task brief: both workflows, profile resolution, attachments, separate design policies, ten-role policy matrix, review/create separation. Journal: project/stage/state/search/sort, retained dates, selectable inspector. Task policies use the same pure lifecycle rules as server; cancel/close/archive are separate reviewable actions.
- Navigation now has deep-linkable overlays and a session-only panel cache for journal/project search/filter selection. Escape returns one nested panel; close returns to the world. Task brief remains in the app across navigation/errors.
- Browser exercised project create/validation/proposal/approval/rename, blocked archive, per-role task create, future-role update, close with note, closed journal and back navigation. All sample mode; screenshots in M4. Real API browser against updated backend remains pending.
- First combined visual comparison found P2 header/scroll/density and missing thumbnail problems. Corrections made; recapture/review pending. See M4/design-qa.md; M4 is NOT passed yet.
- A2 integrated pending in-app qualification: intake, survey, projection, blueprint, planning, diagnostics, delivery-inspection, launchpad. Planning bench measured 45.25 logical vs approx40 target; accepted as modest architectural variation for integrated reach check. Launchpad footprint237x102 vsapprox230x120; central dock clearance retained. Astra is producing only mf.vehicle.shuttle next.
- Assets are served from **public/frontier/assets**, URL /assets/. Main generated a registered base-layer DOM thumbnail via scripts/frontier/project-thumbnail.py. It is derivative of accepted art, not new architecture.
- Services unchanged: web5199→actual4321; old actual and deterministic companion modules still running. Recheck ownership/retained state, export disposable store before restart. No paid CLI repeat.

### Goal 2 checkpoint — M4 qualified; M5 active

- M4 desktop management gate passed; see M4/acceptance.md and design-qa.md. The actual API was safely refreshed after checking no active runs and backing up the disposable database. Web5199 still proxies4321; actual server session84416, root mission-frontier-codex-5CMRsL. AH-001 retained; AH-002 is a closed zero-run browser QA task with retained attachment/policies. Project archived/restored using its same identity.
- A2 production complete: 35 runtime assets. Shuttle and compatible observatory roof integrated after combined visual review; all A2 assets await in-app qualification. No additional assets assigned.
- M5 implementation in progress: current-state action reviews, exact candidate diff, gate/repair lineage, test result drill-down, dependency batches, scout/design views, evidence paging and recorded journeys. Full workflow fixture is explicitly selected by scenario=workflow. No M5 pass claimed.
- Found and fixed initial fixture deep-link selection being replaced by the default sample task. Browser recapture pending.
