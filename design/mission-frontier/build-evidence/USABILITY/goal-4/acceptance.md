# Goal 4 — laptop usability checkpoint

9 September 2026. **Goal 4 U0–U2 acceptance is complete.** Native Chrome 200% zoom was confirmed and exercised across Task, Watch, New task, Projects, Settings/policies, approvals, artifacts and diffs. The walkthrough found and fixed task-row overlap and a collapsed Settings editor; short-height task setup also gained a compact step bar. Chrome was restored to 100%. Goals 5 and 6 have not started.

## Source and isolation

- Verified starting authority: open, unmerged [PR #73](https://github.com/shaunnez/agent-harness-ui/pull/73), `codex/mission-frontier-v1`, `fdbe171a8545a6b9ae206b67ce01fe79606496f1`.
- Implementation branch: `codex/mission-frontier-goal-4` in `/Users/shaun/.codex/worktrees/7237/mission-frontier-goal-4`. The original dirty design/application checkout remains separate.
- Application commit: `77b04f4d834170eb3e5a0a5c76ae358445b8d8d9`. [Source manifest](source-manifest.json) binds the 97 Frontier source files used for qualification.
- Dedicated frontend: `http://127.0.0.1:5204`; deterministic API: `http://127.0.0.1:4324`. The API owns a disposable `mission-frontier-fixture-RzHhMU` store and repository. Existing user listeners were preserved.
- Browser evidence uses `mode=fixture&art=cinematic`; extended dependency/candidate cases use `scenario=workflow`. These records and submitted sample actions remain in the browser. No paid model run, user-task resumption or user-companion restart occurred.
- Fresh before captures use the same retained PR source and fixture definitions. Recorded timestamps and the local lighting phase naturally differ between captures. The earlier laptop review rounded the stage baseline to 308 px; this fresh measurement is 307 px client height (307.16 px bounding rectangle).

## Measured layout

| Check | Before | After | Result |
| --- | ---: | ---: | --- |
| Task main stage, normal window, 1280 × 720 | 307 px | 425 px | More work visible without maximising |
| Task main stage, maximised, 1280 × 720 | — | **457 px** | Pass: target ≥420 px |
| Watch activity, normal panel, 1280 × 720 | Activity began at y≈600 and extended below the panel | **244 px**, beginning at y≈427 | Pass: target ≥240 px, fully within panel |
| Desktop document vertical overflow | — | 0 px | Local scrolling retained |

Measurements are client heights of the actual reading regions, not outer-window heights. Normal Watch remains 540 px wide with the selected robot and room beside it. Maximise is an explicit reading mode; Restore returns to the remembered normal size.

[Baseline JSON](baseline.json), [after measurements](measurements.json), [browser check record](browser-checks.json).

## Acceptance coverage

| Requirement | Evidence / outcome |
| --- | --- |
| Edge/corner resizing; equivalent keyboard controls | Pointer resized task 1248 × 672 → 1128 × 632 and Watch 620 → 560 px. Keyboard size controls, maximise, restore and reset exercised. Normal agent dimensions restored to 540 px. |
| Remember dimensions, clamp, safe storage | Browser reopening and reload retained chosen task/agent widths. 375 px and 640 × 360 reflow remained within usable bounds. Unit checks cover invalid/unavailable storage, family separation and bounded resize. Only dimensions are stored. |
| Compact task layout and open inspector | All ten stage controls retain recorded/current/not-started semantics; future stages are disabled. Current action remains above the main scroll area. Inspector panels stay open, including safeguards and repository context. |
| Reveal important package, preserve selection | PC-142 opens S2 running; AH-054 opens S2 failed beside its running sibling. Back to packages exposes dependency batches; the 12-package plan remains reachable. Duplicate workbenches caused by colliding React keys were fixed; one workbench remained after refresh. |
| Clear local scrolling | Main stage and inspector have stable gutters, named keyboard reading regions and overflow cues. Settings and general form windows also expose a cue when more content exists. Keyboard PageDown/Home and wheel scrolling exercised; the 375 px task reaches the bottom of its inspector while Close stays fixed. |
| Resize does not move the world | [Recorded camera check](camera-resize.json): actual task resize reduced width by 80 px and height by 40 px; camera stayed x=87, y=247, zoom=0.3. |
| Modal navigation and drafts | Escape, reverse/forward Tab containment, focus return to Inspect task, nested diff Back → Open exact diff, and nested project setup Back → Add project pass. New-task title/description survived nested setup. |
| Management and policy controls | Sample project validation/creation and empty-project controls exercised. Sample task creation retained an explicit Sol/High role override in review. Settings, future-role controls, approvals, repair confirmation, artifact and exact candidate diff remain available. No real approvals or provider calls used. |
| Activity-first Watch | Identity, task/run state, next action, elapsed/usage availability and event age appear above the 244 px activity viewport. Activity, Output, Context, run selector and future-policy entry remain accessible. Arrow/Home/End tab navigation verified. |
| Truthful work and telemetry | Exact active-run/tool identity and terminal precedence have behavior tests. Completed historical run stays parked while its task executes; completed Grill run stays parked while the task needs an answer. Failure, repair and offline reasons remain distinct. Missing active usage reads Not yet reported; recorded zero stays 0. Unsupported cost is Unavailable, with the explanation accessible in Context. |
| Follow new activity without stealing reading position | Bounded sample-event controls exercised in explicit QA mode. At the end, appended activity follows. After Home, an append preserved scrollTop 0 and offered New activity; clicking it resumed following. Earlier-page anchoring and exact-run event filtering have deterministic tests. |
| Native 200% browser zoom | **Passed after corrections.** Native Chrome reports 200%; the real Retina window provides a 756 × 370 CSS viewport at DPR 4, without viewport emulation. All required destinations support input, scroll and action access. Task inspector, final policy rows, approval confirmation, artifact source and final diff file are reachable. Escape restores Open exact diff focus. [Native matrix](native-zoom-200.json), [native setting](native-zoom-setting.txt). |

The raw browser record retains three unsuccessful test interactions: a pointer target outside the visible rounded corner grip, an immediate scroll measurement taken before it settled, and Control+Home on macOS. Retargeting the visible grip, checking the settled scroll, and using Home produced the corresponding passes. These are retained rather than silently rewriting the record.

## Screenshots

| State | Before | After |
| --- | --- | --- |
| Task, 1280 × 720 | [Before](1280-task-before.png) | [Normal](1280-task-after.png) · [Maximised](1280-task-maximised.png) |
| Watch, 1280 × 720 | [Before](1280-agent-before.png) | [After](1280-agent-after.png) |
| New task, 1280 × 720 | [Before](1280-new-task-before.png) | [After](1280-new-task-after.png) |
| Evidence, 1280 × 720 | [Before](1280-artifact-before.png) | [After](1280-artifact-after.png) |
| Task, 1440 × 900 | [Before](1440-task-before.png) | [After](1440-task-after.png) |
| Watch, 1440 × 900 | [Before](1440-agent-before.png) | [After](1440-agent-after.png) |
| New task, 1440 × 900 | [Before](1440-new-task-before.png) | [After](1440-new-task-after.png) |
| Evidence, 1440 × 900 | [Before](1440-artifact-before.png) | [After](1440-artifact-after.png) |

Additional captures: [repair](1280-repair-after.png), [waiting task / completed run](1280-waiting-after.png), [historical run](1280-agent-historical.png), [execution failure](1280-agent-failed.png), [failed package](1280-failed-package-after.png), [approval](1280-approval-after.png), [12 packages](1280-multiple-batches-after.png), [exact diff](1280-diff-after.png), [new activity](1280-agent-new-activity.png), [offline](1280-agent-disconnected.png), [empty project](1280-empty-project-after.png), [375 px task](375-task-after.png), [inspector end](375-task-inspector-bottom.png), [375 px Watch](375-agent-after.png), [640 × 360 reflow](640x360-agent-reflow.png), [1488 × 1058 task](1488-task-after.png) and [desktop Watch](1488-agent-after.png).

## Native zoom follow-up

The first native walkthrough exposed two CSS failures: an intermediate-width grid let task content overlap its inspector, and short-height Settings could collapse its inner editor to zero height. Natural grid rows and block content now put the inspector after the complete stage. Short Settings windows scroll the whole form; the task wizard step bar becomes one compact row. The original failed Settings observations remain labelled in the native record.

Final captures: [task inspector](native-200-task-inspector.png), [Watch activity](native-200-agent-activity.png), [task policy](native-200-new-task-policy-final.png), [project management](native-200-project-management.png), [Settings](native-200-settings-models-final.png), [approval](native-200-approval.png), [artifact](native-200-artifact-source.png), [last diff file](native-200-diff-final-file.png). A 1024 × 720 regression shows a 12 px gap between stage and inspector. The 375 px view has no document horizontal overflow and reaches the inspector end. At 1280 × 720, the original 425 / 457 / 244 px measurements were reproduced after the corrections.

## Automated qualification

Typing, lint, formatting and both builds passed on the implementation source. The complete root/Frontier/API suite recorded **1,064 passes and four failures**, with no cancellations or skips, in [checks.json](checks.json) and [complete-tests.log](complete-tests.log). All four failures were existing orchestration wait limits: two instances of the investigation handoff's 50 × 5 ms loop and two real-Git package qualifications using the shared 400 × 5 ms wait. The backend and those tests are byte-identical to the starting PR source.

All **121 tests** in the three implicated orchestration files passed when rerun sequentially: [orchestration-recheck.log](orchestration-recheck.log). This supports a load-sensitive timing diagnosis; it does not turn the original combined run into a clean pass. No backend or test timeout was changed to hide the result. All **74 final Frontier/API tests passed**, with zero failures or skips, as retained in [final-frontier-tests.log](final-frontier-tests.log). The earlier 73-test checkpoint preceded the final small accessibility and fixture checks.

Protected Sites files, package manifest/lockfile, backend code, accepted art and world renderer were not changed. Both builds retain the existing large-chunk warning. Passing root UI fixtures can report development WebSocket port collisions; do not confuse those warnings with application runtime failures.

The final CSS source also passed typing, lint, formatting, both builds and **78 targeted Frontier/API/Sites tests**, zero failures/cancellations/skips: [follow-up checks](zoom-final-checks.json). The full suite was not repeated for this CSS-only correction; its original result remains above.

## Remaining limits

- Native OS scrollbar-thumb dragging, screen-reader behavior, background-tab suspension and operating-system motion transitions were not qualified in this run. Pointer wheel, keyboard scrolling, explicit overflow cues and the existing deterministic lifecycle tests are separate evidence.
- No new performance, texture or cold-load qualification is claimed. These are frontend work-window changes with unchanged artwork and renderer; later Goals 5/6 own the expanded performance gates.
- Live incremental event persistence remains Goal 6. The new view displays recorded activity; role animation and a quiet stream do not prove tool execution or failure.
- The real implementation → repair → approval → PR journey remains a separate operational checkpoint. Goal 4 did not execute that workflow, merge PR #73 or publish the game. PR delivery is recorded separately from UI acceptance.
