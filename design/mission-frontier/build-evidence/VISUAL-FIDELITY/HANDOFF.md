# Goal 3 — cinematic island handoff

Completed 6 September 2026. The one-island visual qualification passed and the journal milestone is published. Ready for Shaun's review; broader asset replacement should follow that review.

The [current project handoff](../../HANDOFF.md) combines Goals 1–3, the screenshot review, delivery risks and the recommended next milestone. This document retains the exact Goal 3 qualification and publication record.

## Open the result

- [World — cinematic preview](http://127.0.0.1:5200/?mode=fixture&art=cinematic#world)
- [PlanCheck headquarters](http://127.0.0.1:5200/?mode=fixture&art=cinematic#project/plancheck)
- [Watch the working agent](http://127.0.0.1:5200/?mode=fixture&art=cinematic#agent/PC-142/R-PC-142-implement-1)
- [Original presentation](http://127.0.0.1:5200/?mode=fixture&art=classic#world)
- [Published journal milestone](https://mission-frontier-journal.shaunnesbittuk.chatgpt.site/notes/one-island-with-depth/)

The production preview on 5200 remains running; game tab 14 is marked as a deliverable, fitted to the normal browser viewport, with temporary viewport overrides reset. The development preview on 5199 and both existing isolated APIs remain untouched. Routes are clearly labelled sample data. The cinematic query changes presentation only; the backend still owns execution and decisions. Select PlanCheck, enter its headquarters and use Watch agent, Inspect task or the next action. Utility controls remain available.

## Delivered

One irregular cliff island, periodic water, two correctly lit bridge orientations, brighter purple grove with independent contact shadow, a terraced observatory facade, and an articulated worker with a matching portrait. Astra produced the worker, grove and exterior; the main builder produced the environment and owned integration/qualification. Final exports are 64/72-sample Blender RGBA assets at twice logical resolution. Existing cutaway floor/back/front, task stations and other project islands remain deliberately retained.

The existing v1 management and workflow surfaces are preserved. Canvas interaction also uncovered and fixed transparent artifact/cargo hit bounds, so neighboring workers and evidence objects can be selected separately. Finished runs park; operator questions, repair, dependency waiting, approval and disconnection retain their distinct meanings. No paid backend workflow was launched for this art pass.

## Review evidence

| Scale | Matched baseline | Current | Combined comparison |
| --- | --- | --- | --- |
| World 1568×1003 | [Before](before/world-1568-fit.png) | [After](after/world-1568.png) | [Reference / before / after](comparisons/world-reference-before-after.jpg) |
| HQ 1567×1004 | [Before](before/hq-1567.png) | [After](after/hq-1567.png) | [Reference / before / after](comparisons/hq-reference-before-after.jpg) |
| Agent 1568×1003 | [Before](before/agent-1568.png) | [After](after/agent-1568.png) | [Reference / before / after](comparisons/agent-reference-before-after.jpg) |

Focused comparisons: [World](comparisons/world-focused.jpg), [HQ](comparisons/hq-focused.jpg), [Agent](comparisons/agent-focused.jpg). Motion: [actual in-app GIF](animation/in-app-worker.gif), [ordered strip](animation/in-app-worker-strip.png). Running, answer and repair are shown together at HQ and separately in the agent captures. Additional 1488×1058, 1280×720 and 390×844 screenshots remain under `after/`.

[Acceptance coverage](acceptance.md), [measured performance](performance.md), [asset sources and exact rebuild commands](assets.md), [latest Product Design QA](../../../../design-qa.md). The earlier source study is conceptual; fixture clock labels differ naturally. The baseline/current pairs hold viewport, task state and camera setup constant. Native browser limits and the lifecycle sample's identical-geometry calibration caveat are explicit in the performance record.

## Qualification

- `npm run test:frontier`: 45 passed, 0 failed, 0 skipped.
- `npm run test:frontier-api`: 8 passed, 0 failed, 0 skipped.
- `npm run test:sites`: 4 passed, 0 failed, 0 skipped.
- **57 distinct scoped tests passed**; [aggregate and source log hashes](qualification.json). Two cinematic asset tests were repeated after the final provenance-only correction; they are not double-counted.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build:frontier` and `npm run build` all passed. Logs are in this folder. The root build retains `dist/client/index.html`, `dist/server/index.js` and `dist/.openai/hosting.json`. Protected root files have zero diff.
- Normal: 10 projects / 100 tasks / 20 visible workers, 102.88 seconds with camera work; 119.05 median FPS, p95 frame time 11.7 ms.
- Busy: 50 projects / 1,000 tasks / 50 representative workers, 77.88 seconds; 113.64 median FPS, p95 frame time 11.9 ms. All records/action surfaces remain reachable through search/filter.
- Selection: p95 15.4 ms including an intervening paint. Twenty navigation round trips retained bounded listeners/textures/entities and restored the camera.
- Initial wire transfer 18.6027 MiB; estimated RGBA residency 114.1875 MiB initially and 126.4375 MiB after retained detail, within 20 MiB / 192 MiB gates.
- Explicit motion-off, stopped runs and disconnection were checked in the browser. Native hidden-page state and OS media preference switching could not be induced in this host; unit tests cover that lifecycle logic but are not native proof.

No unresolved P0/P1/P2 issue remains in the bounded island scope. P3: the study has denser atmosphere; new ground/robot materials are cleaner than retained interiors; a decorative portrait edge meets navigation at compact desktop size; existing main-chunk warning and empty favicon 404 remain. The earlier OS export receipt check and representative real implementation/repair/PR dogfood remain separate future work. M7's historical 1,040 tests are preserved, not claimed as rerun.

## Source ownership and rollback

Checkout `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`, branch `codex/mission-frontier-first-playable`, unchanged parent HEAD `e31566a36ed871cdb3743b8aaadaf08e7f19c6fd`. Existing Goal 1/2 dirty backend, frontend and design files were preserved. No root game commit, push, PR, merge or deployment occurred. Protected main.tsx, App.tsx, Vite and Sites files were verified unchanged. No dependency upgrade was made in this goal.

[Baseline delta](baseline-delta.json) identifies the ten changed pre-existing captured files; all captured original image bytes remain unchanged. New code is the cinematic selection policy, generated catalog, worker helper and visual-preview component; renderer/scene/routes/loader changes are limited to this art variant, lazy loading and diagnostics. Two new asset/policy test files cover contracts and frame registration. Root `design-qa.md` now prepends this review while preserving historical QA.

New asset manifest: `public/frontier/assets/cinematic/manifest.json`, revision `cinematic-v1-final`, 21 entries, [exact manifest hash](runtime-manifest.sha256). Sources, rejected iterations, licences and .blend files live in `design/mission-frontier/assets/staging/cinematic-v1/`; do not broadly stage those together with unrelated dirty work. Exact rebuild and packaging choices are in `assets.md`. `art=classic` is the immediate visual rollback without modifying any task state.

## Journal publication

The existing selected audience was preserved: custom access revision 3, owner plus 2 external viewers. No invites or public-access changes. New note 04 includes actual comparisons, the Blender/Astra approach, current measurements and limits. All 25 original design entries, three historical articles and old media metadata are preserved exactly. The source monitor snapshot reports no pending source change.

Journal checks: 5 content tests, typecheck, lint, formatting and build passed; 34 HTML files and 119 referenced resources checked, 0 missing. Desktop article/comparison and phone comparison/Now page checked in-browser. Published note 04 was opened successfully after deployment. The temporary journal development server is stopped after hosting; the game preview remains running.

Confirmed publication: version 3, journal source commit `868d28c8008581c69480f5d7e531703898f2d8e1`, deployment `appgdep_6a9d50661c9481918355df141dc6a3ac`, completed `2026-09-06T11:37:26.780682+00:00`. Full exact record: `journal-site/publication.json`. Version 3 refreshes the private source snapshot; its article and UI match the browser-verified version 2. The six-hour journal heartbeat remains unchanged.

**Next:** review the island's terrain, observatory and worker at all three scales. Agree any art refinements before extending this kit to every project or replacing the retained interiors.
