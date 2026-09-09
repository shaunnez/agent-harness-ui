# Goal 1 acceptance — M0–M3

6 September 2026. First playable qualified for Shaun's game-feel review. This is not full v1 acceptance and does not approve the visual design on Shaun's behalf.

| Gate | Result | Evidence |
| --- | --- | --- |
| M0 repository and isolation | Pass | progress.md; original frontend and protected Sites files unchanged; marked disposable repositories/stores on4321/4322 |
| Independent frontend/build | Pass | legacy-build-final.log; frontier-build-final.log; dist/client, dist/server, dist/.openai and dist/frontier outputs coexist |
| Origin, CSRF, stale commands | Pass | api-final.log:2 tests, no failures/skips |
| M1 compatible world/HQ/detail | Pass | ../M1/fidelity-gate.md; integrated-motion-comparison.png; accepted A0 registration and alpha checks |
| A1 complete first-playable kit | Pass | asset-audit.json:25 IDs,32 referenced PNGs; checksum/dimension/provenance/QA verified |
| M2 selection and navigation | Pass | ../M2/interaction-qa.md; journal-selection.json; capsule-evidence.png; navigation-soak.json |
| Task/run attention agreement | Pass | HQ + needs-answer/repair comparisons; failed-package-worker.png;22 pure contract tests |
| Finished and historical workers | Pass | Actual retained run IDs and durations; parked motion comparison; failed S2 and active S1 inspected separately |
| Dependency waits and operator counts | Pass | PC-142 shows S2 running/S3 dependency;6 sample needs-you items exclude dependency, queued and external waits |
| M3 actual CLI journey | Pass | actual-cli-journey.md, actual-runs.json, actual-task-core-final.json;1 actual investigate-only task |
| Create versus start, answer, specification approval | Pass | Actual journey and deterministic API fixtures; persisted result after reload/restart |
| Offline draft/reconnect | Pass | Actual API disconnect with retained draft, disabled submit, reconnect and retained operator answer; fixture overlay rerun; transition replay test |
| Keyboard/compact/mobile fallback | Pass | ../M2/world-1280.png, hq-1280.png, agent-1280.png, journal-390.png, decision-390.png; J/Tab/Enter/Escape flow |
| Camera/minimap/occlusion | Pass | Worker and capsule picks; route-maximum-zoom.png; minimum zoom/fixed detail bounds; room labels compact at wide zoom |
| Visual comparison | Pass for first-playable scope | world/hq/agent-answer/agent-repair-comparison.png; design-qa.md; no unresolved P0/P1/P2 observed |
| Performance and stress | Pass | normal-performance.json; selection-performance.json; stress-reachability.json; navigation-soak.json |
| Motion/background lifecycle | Pass with browser limitation documented | motion-off-final.json; visibility.test.mjs exercises hide/show, offline, reduced motion and disposal; IAB could not produce real hidden-page state |
| Final automated checks | Pass with parallel-run caveat |22 Frontier +2 API +484 serial repository +4 Sites tests; lint/format/type/build checks |

The unchanged default parallel repository command hit its existing250ms polling assumption in orchestrator-investigation-grill.test.mjs (483 pass,1 failure). The unchanged focused file passed10/10, and `npm test -- --test-concurrency=1` passed484/484. The test was not weakened. This is retained as a test-harness reliability note, not a fabricated green parallel run.

M4–M7 remain unimplemented: complete project administration, per-role policy editing, full candidate/review/test/PR delivery commands, agent/skill/settings/usage destinations and A2 artwork. The current task inspector supports the evidence and actions needed for M0–M3; it does not imply those later screens are complete.
