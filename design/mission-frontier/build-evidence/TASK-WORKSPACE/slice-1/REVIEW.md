# Task workspace slice 1 review

> Superseded after Shaun rejected this checkpoint. Its claimed final/corrected screenshots are historical, not acceptance evidence. See [the subsequent correction record](refinement/REVIEW.md) and its new captures for the current review candidate. The fixed-width reference measurements and activity-disclosure deferral below are also superseded.

21 September 2026 · Shared shell and Implement · Awaiting Shaun's visual review

## Scope and identity

- Worktree: `/Users/shaun/.codex/worktrees/task-workspace-slice-1/agent-harness-ui`
- Branch: `codex/task-workspace-slice-1`
- Source commit: `48ca6b52e2fdb0872184fb16d9d6c827ee5603b4`
- Fixture preview: `http://127.0.0.1:5291/?mode=fixture&scenario=workflow#task/PC-142/implement`
- Frozen reference: `design/mission-frontier/reference/task-workspace-study-2026-09-21.html`
- Frozen reference SHA-256: `905e12d79d63cb1f63dd1ba15cff3125b1ab97e3742555c23b9d64450eccf812`
- Workshop source: user-supplied `Screenshot 2026-09-21 at 12.16.15 PM.png`, copied unchanged to `public/frontier/assets/mf.task-workspace.workshop.r1.png`
- Workshop asset SHA-256: `7cfcfb5d42e95193cb9b9990500778a74498d13fc8d970e35b1cb3c839efd90e`

The preview uses the in-memory fixture gateway. It does not call a model or a live mutation endpoint.

## Viewports and captures

The frozen study has a fixed 1277 px task-study content width at both requested browser sizes. Its full study height is 1691 px, so reference captures show the viewport rather than the complete document. The real app retains its resizable modal boundary and local scroll areas.

| Browser viewport | Real dialog | Real task content | Root overflow |
| --- | --- | --- | --- |
| 1280 × 900 | 1264 × 884 at 8,8 | 1262 × 795 | None; client and scroll width both 1262 |
| 1440 × 1000 | 1424 × 984 at 8,8 | 1422 × 895 | None; client and scroll width both 1422 |

Reference captures are in `reference/`. The review candidates are the `*-final.png` and `*-corrected.png` files in `implementation/`. Baseline, `-v1`, and unsuffixed implementation captures are retained as rejected historical evidence and must not be used for acceptance.

The initial browser pass was not an acceptable match. It turned every stage into a large card, kept duplicate status subtitles, used separate completion marks, and compressed the rest of the workspace. Shaun rejected it during visual review. The second pass re-compared the rendered application directly against the frozen study and replaced that structure before this report was finalized.

## Visual comparison

| Discrepancy from frozen study | Correction in the app | Result |
| --- | --- | --- |
| The left stage rail permanently reduced package and diff width. | Moved the same recorded/future stage controls into one full-width horizontal rail. | All ten labels remain visible at normal laptop and desktop sizes; recorded, current, rerun-required and future-disabled states stay distinct. |
| The rejected first pass presented every stage as a competing card with a second status line. | Matched the study's quiet rail: transparent stages, completed checks inside their circles, subdued future stages, and one blue bounded panel for the viewed stage. | The stage hierarchy now follows the frozen reference without changing clickability or current-stage derivation. |
| The initial app shell repeated the task heading and divided navigation, commands and content into unrelated blocks. | Reduced the inner header to repository context and utility actions, then gave the navigator and full-width stage command their own shared horizontal bands. | The visible hierarchy now reads task context → stage → current command → evidence while retaining the real modal chrome. |
| Selecting a package replaced the dependency overview. | Kept the dynamic batch plan and selected package detail side by side. | Package selection preserves graph context; one, three, four and twelve package shapes remain usable. |
| Package relationships were textual lists without a visual sequence. | Added bordered batches, inter-batch connectors, parallel grouping, exact dependency copy and selected-path emphasis. | The current `batch` and `dependencies` contracts drive the layout; no fixed four-package assumption was added. |
| Implement had little Mission Frontier identity. | Added the supplied workshop illustration and the existing standard worker portrait. | The art is explicitly labelled `Concept illustration`; recorded package and run state remains separate text. |
| The inspector repeated task identity and treated the worker as plain text. | Reduced the brief to outcome/context and added the existing worker portrait beside the recorded model/run status. | Task identity still lives in the modal heading; usage, safeguards, repository and evidence paging remain unchanged. |
| Candidate changes required leaving the stage. | Reused the existing checked `CandidateDiff` loader in an embedded presentation while retaining the full diff panel. | Candidate ID, revision and head mismatch checks, retry, truncation warning, raw source and file-grouped diff behavior are shared between both placements. |
| The study's sample values did not match fixture/runtime records. | Rendered actual fixture package counts, names, status, paths, revisions and available evidence. | Visual structure follows the study while values remain truthful to the current contracts. |

Intentional remaining differences:

- The product keeps the resizable modal header, fixture notice and window controls owned by `Modal`; the study has its own visualization chrome.
- The current evidence/activity tabs remain the retained access path. Consolidating them into the study's single collapsed activity disclosure belongs with the later evidence-stage migration because stage artifacts must not be hidden as telemetry.
- Package detail shows only fields present in `RuntimeWorkPackage`. It does not invent interfaces, risks or expected outputs from the illustrative study.

## Final comparison captures

- Frozen study, desktop: `reference/recheck-study-top-1440x1000.png`
- Corrected app, desktop: `implementation/implement-running-1440x1000-final.png`
- Frozen study, laptop: `reference/recheck-study-top-1280x900.png`
- Corrected app, laptop: `implementation/implement-running-1280x900-final.png`
- Corrected assembled-candidate state: `implementation/implement-assembled-1280x900-corrected.png` and `implementation/implement-assembled-1440x1000-corrected.png`
- Recorded-stage navigator check: `implementation/recheck-triage-nav-1280x900-final.png`

## Capability and interaction results

| Existing capability or safeguard | Result |
| --- | --- |
| Recorded/current/future stage access | Passed. Recorded Plan and Implement navigation works; future Dev review remains disabled for PC-142. |
| Historical stage versus active command | Passed. PC-148 shows recorded Implement content while the command remains bound to active Dev review and explicitly says repair is required. |
| Package selection memory | Passed. S3 remains selected across Plan → Implement navigation and after opening/returning from the full diff panel. |
| Dynamic package shapes | Passed with one package, PC-142's three packages, PC-148's four packages and MS-092's twelve packages over three batches. |
| Failure and repair state | Passed. AH-054 selects the failed S2 package; PC-148 retains stale/rerun-required review evidence and repair eligibility. |
| Candidate absent | Passed. PC-142 renders the existing honest no-candidate assembly state and no inline diff. |
| Exact candidate diff | Passed. PC-148 loads the exact checked diff inline and in the full panel; raw/file modes switch and return correctly. |
| Activity and evidence access | Passed. The existing Activity and Evidence tabs switch without losing package selection. |
| Window resizing and overflow | Passed at 1280 × 900 and 1440 × 1000 with no root or stage-navigation horizontal overflow. |
| Keyboard/accessibility boundary | Package cards remain labelled buttons with pressed state, the stage navigator uses `aria-current`, disabled stages remain non-actionable, and named scroll regions retain keyboard focus. |
| Disconnected action safety | Covered by the existing command-policy test; disconnected and busy commands remain disabled. The fixture page exposes no UI control that silently changes connection state. |

The final fresh browser tab produced no application error. It reports only the existing Three.js `THREE.Clock` deprecation warning from the world renderer.

## Checks run

- `tsc --noEmit`: passed.
- Focused workflow tests (`workflow`, `workflow-command`, `command-workflow`, `pages`, `window-layout`): 25 passed.
- Full Frontier suite: 145 passed.
- Changed-file Biome check: passed.
- Full repository Biome lint: passed.
- Full repository Biome format check: stopped on three pre-existing unformatted files: `server/research/deepagents/worker.mjs`, `src/research-budget-policy.ts`, and `tests/research-deepagents-live.test.mjs`. None differs from the source commit in this worktree.
- Frontier production build: passed. Vite retained its existing warning that the main generated chunk exceeds 500 kB.
- `git diff --check`: passed.

## Changed application files

- `src/frontier/views/TaskPanel.tsx`
- `src/frontier/views/WorkPackages.tsx`
- `src/frontier/views/CandidateDiff.tsx`
- `src/frontier/ui/frontier.css`
- `src/frontier/ui/task-workspace.css`
- `public/frontier/assets/mf.task-workspace.workshop.r1.png`

The worktree also carries the uncommitted task instructions, migration/evaluation documents and frozen reference required by the run brief. The original checkout was not modified by this implementation.

## Preview ownership and next step

The review preview is owned by this task's Vite process on `127.0.0.1:5291`. Keep the final browser tab open on PC-142 Implement for visual review. Stop here until Shaun accepts or revises the shell and Implement direction; Dev review, Test, Final review and Approval body migration remains outside slice 1.
