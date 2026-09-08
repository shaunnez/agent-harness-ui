# Goal 4 handoff

9 September 2026 · Application commit `b8f6915169f9bf9232b05f02946d193973893bb9` · branch `codex/mission-frontier-goal-4`.

Laptop windows and the activity-first agent view are implemented and ready to review. **Native 200% zoom remains an open acceptance item**, because native Chrome control was interrupted. The complete U0–U2 gate is therefore not marked passed. See the [acceptance table, screenshots and exact test results](acceptance.md).

## Review it

- [Local world](http://127.0.0.1:5204/?mode=fixture&art=cinematic#world)
- [Task command](http://127.0.0.1:5204/?mode=fixture&art=cinematic#task/PC-142)
- [Watch agent](http://127.0.0.1:5204/?mode=fixture&art=cinematic#agent/PC-142/R-PC-142-implement-1)
- [Extended sample workflow](http://127.0.0.1:5204/?mode=fixture&art=cinematic&scenario=workflow#task/MS-092)

The running preview belongs to `/Users/shaun/.codex/worktrees/7237/mission-frontier-goal-4`. Its disposable API is on 4324, with no paid model dispatch. The main application's original servers and database were not restarted or changed. Browser creation/approval interactions were explicitly labelled sample actions.

## What changed

Work windows have bounded edge/corner resizing, keyboard size controls, maximise/restore/reset, and dimensions saved separately for tasks, evidence, forms, management and Watch. Text stays readable; scroll regions and overflow cues keep long content reachable. The task header is compact, actions remain visible and the always-open inspector is preserved. Implement first reveals its failed or running package; later refresh does not replace the selected package.

Watch puts identity, task/run state, the next action, elapsed time, recorded usage and event age above Activity. Output, Context, historical runs and future role policies remain accessible. Completed and historical workers stay parked. Current tool labels require an identified tool on the exact active run. New activity follows only at the end; otherwise the reader retains their position and gets a jump control.

At 1280 × 720, normal Task command has 425 px of stage reading space; maximised has **457 px**, against a 420 px target. Normal Watch has **244 px** of activity, against a 240 px target. Matched 1440 × 900, desktop 1488 × 1058 and narrow captures are retained.

## Checks and limits

Typing, lint, formatting and both builds pass. The complete 1,068-test run had 1,064 passes and four existing timing failures; all 121 tests in the implicated orchestration files pass in a sequential recheck. The original combined failure is preserved. All 74 final Frontier/API tests pass; its log and the source manifest are in this folder.

Native 200% zoom is pending. Narrow 375 × 720 and 640 × 360 reflow were tested, but are not substituted for native zoom. OS scrollbar dragging, screen readers and native background/motion lifecycle are not claimed. The existing large-chunk warning remains. No new performance claim, live incremental-event claim or real implementation-to-PR proof is made.

## Ownership and next work

This branch starts from the verified open PR #73 head `fdbe171a8545a6b9ae206b67ce01fe79606496f1`; the implementation is a separate local commit and has **not been pushed to PR #73**. The root hosting identity, backend, dependency files and artwork remain unchanged. No database migration or asset agent was needed.

Complete native zoom when Chrome is available. Then review or transfer this commit into the PR through a separate explicit integration step. Goal 5 is the next independently started build: decision navigation, a return briefing and up to four pins, including UB1's bounded retained-history read contract. Goal 6 owns incremental recorded activity and meaningful world feedback. Neither has started.

Rollback is selecting the existing PR build; Goal 4 has no backend migration or server compatibility requirement. If resuming, inspect ownership of ports 5204/4324 before starting anything, retain this worktree and continue from the open check instead of rebuilding U0–U2.
