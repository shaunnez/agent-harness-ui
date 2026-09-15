# Goal 5 handoff — paused, servers stopped

10 September 2026. Goal 5 implements decision navigation, a return briefing and watch pins, with bounded retained history. It is **not accepted as complete**. Shaun requested stopping the server and then a handoff. Do not restart services or resume implementation until asked.

## Source to continue

- Worktree: `/Users/shaun/.codex/worktrees/7237/mission-frontier-goal-5`
- Branch: `codex/mission-frontier-goal-5`
- HEAD / verified integration base: `dcd474eace2e43ac1f25b248e1aa57af708a0c85`
- Remote: `origin`, `https://github.com/shaunnez/agent-harness-ui.git`
- Local main at handoff: `04517df238ea04dacb07dc5f11d20d3b51ff19fb`, **one commit ahead of this worktree**: `fix: recover stale approval authority`. It has not been integrated here. Recheck it before approval acceptance; it changes action eligibility, recovery, task actions and related contracts/tests.
- GitHub main was read directly at `0bf77b0f598b06e6fc7a2f3d36ab4f2ce706620f`. Local main is five commits ahead. Recheck publication state before a Goal 5 PR so other local commits are not accidentally included or described as Goal 5 changes.

The implementation was recovered from cleanup snapshot `2fa9e616636ba92094c01372039888c391bff041`, then replayed without committing onto the local main available at synchronization. No conflicts remain. Goal 5 changes are staged from recovery; the lint fix, documentation follow-ups and new evidence also have unstaged/untracked changes. **Both index and working-tree content matter. Do not discard or broadly restore either.** No Goal 5 commit, push or PR has been created.

[main-sync-source-manifest.json](main-sync-source-manifest.json) binds 36 changed implementation files and four check outputs to the named integration base. All 40 hashes matched during this handoff. It is a delta manifest, not final browser acceptance. The original dirty checkout, the user's main checkout and journal repo were preserved. No application code changed in this handoff turn.

## Implemented behavior

- **Decision navigation:** stable Needs you sessions across projects, recorded task/stage/reason/next actor, Previous/Next, new-item indication and retained unsubmitted drafts. Navigation uses existing action eligibility and does not submit decisions.
- **Return briefing:** deterministic grouping of retained changes and open decisions; closing keeps unread state. Mark reviewed acknowledges only the fully loaded captured upper bound. Retention gaps require acknowledgement. Completed-run usage avoids task/run double counting and invented interval spend.
- **Watch pins:** up to four task or exact-run pins, scoped to the source database and synchronized between browser tabs. Finished runs become historical; missing/offline records are explicit. World/HQ use one compact row.
- **Retained history / API:** SQLite schema 3 adds a transactional typed read projection capped at 5,000 material observations, with source identity, ordered cursors, captured upper bounds and explicit coverage. No guessed backfill; legacy JSON catch-up is unavailable explicitly. Exact-run pin responses exclude transcripts and prompts.
- **Refresh and source changes:** shared polling, bounded concurrency and task-version reuse. Source changes invalidate old pins, drafts, cached reads and pending results. Web Locks serialize browser-memory updates; simultaneous writes without Web Locks remain unqualified.

The accepted world, artwork and recorded-state rules are preserved. Goal 6 has not started; no asset agent is needed for Goal 5. [The original handoff](HANDOFF-2026-09-09.md) contains the detailed implementation and earlier browser observations.

## Verified checks and known issues

These checks ran after synchronization, on Node 24.19.0. They were not rerun for this documentation-only handoff.

| Check | Evidence / result |
| --- | --- |
| Relevant Frontier/API, SQLite/store, orchestration, projections, settings and gate policy tests | [262 tests: 261 pass, one fail, zero skipped](main-sync-tests.txt). This is not the complete root suite. |
| Failing test | `tests/candidate-gate-policy.test.mjs:22` expects the previous instruction wording. The same failure [reproduced on main](main-baseline-test.txt); its test and implementation were unchanged by Goal 5. Reassess after the next main sync before fixing it. |
| Typecheck / lint | Passed. The original Goal 5 assignment-in-expression lint error in the retained measurement script is fixed. |
| Formatting | Three files unchanged from the synchronized main fail formatting: `server/claude-runtime.mjs`, `tests/sqlite-store.test.mjs`, `tests/workflow-profiles.test.mjs`. Not corrected during synchronization or handoff. |
| Builds | [Frontier](main-sync-frontier-build.txt) and [root](main-sync-root-build.txt) passed. Existing bundle warnings remain. |
| Sites packaging tests | Four passed. These validate the game prototype's protected packaging, not publication of the separate journal. |
| Source integrity | All 36 implementation / four evidence hashes matched. `git diff --check HEAD` passed; no unmerged entries. |

The earlier 225-pass result remains a dated record in [verification.json](verification.json). Its `.log` file was excluded from the cleanup snapshot and is no longer available. Use the fresh `.txt` outputs above. The test run logged an occupied Vite WebSocket port; the associated test passed and the original services were left alone.

## Remaining acceptance and delivery

1. On an explicit resume, preserve the current staged/unstaged changes and synchronize with the latest authoritative main. The additional stale-approval recovery commit is particularly relevant. Do not assume the recorded refs are still current.
2. Resolve the inherited stale test expectation and formatting if still present. Repeat affected checks on the integrated source and retain honest failures; do not weaken action or candidate assertions.
3. Complete a focused browser walkthrough with isolated fixtures: cross-project answer → repair → approval; draft preservation after navigation/failed actions; candidate replacement while confirmation is open; another client resolving/deleting the selected decision; Back/keyboard/context restoration; pins and briefings across reconnects, missing records and source changes; interrupted history paging and multiple-tab checkpoints. Include usable laptop scrolling and native 200%/narrow reflow.
4. Review the final diff, write the acceptance record and current source manifest, then prepare a focused Goal 5 commit and PR when ready. PR #73 is already merged. Check the extra local-main commits before publishing a branch.
5. Update the separate journal from verified results. Its last access lookup was blocked; this is a separate publication issue and should not hold up preparation of the game PR. Do not broaden journal access or publish the game.

**Shaun waived further performance benchmarking on 10 September.** Do not run more FPS, request-volume or payload benchmarks as a completion gate. Retain bounded refresh behavior and existing correctness tests; the old [request-volume report](request-volume.json) is historical evidence. Revisit performance only if an actual regression is observed. Preserve this steering over the older goal text and historical handoff requirements.

## Browser evidence already available

All captures below are dated **sample / isolated-fixture evidence**, not live deliveries or final acceptance of the merged source.

- [Draft retained through decision navigation](decision-draft-laptop.png)
- [Maximized task at laptop size](task-max-laptop.png) and [normal Watch panel](watch-normal-laptop.png)
- [Return briefing from the isolated API](briefing-api-laptop.png) and [explicit retention gap](retention-gap-laptop.png)
- [Four offline pins](four-pins-offline-laptop.png)
- [1440 desktop](world-1440.png) and [1488 desktop](world-1488.png)

`briefing-laptop.png` predates a CSS fix; prefer `briefing-api-laptop.png`. Reaching native 200% zoom was recorded previously, but the full Goal 5 flow at that zoom was not accepted. No new browser walkthrough ran during synchronization.

## Services and restart boundary

**Stopped at Shaun's request.** No listeners remain on Goal 5 ports **5205** (frontend) or **4325** (isolated API). The frontend process, npm parent and esbuild child have exited. No Goal 5 acceptance/test process remains running. Former exec session `83474` and prior process IDs are historical, not running services. The browser may still contain the old preview URL; it is offline.

Do not restart from an automation or because an old instruction says to leave a preview running. On an explicit resume, use Node from `/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` and start a **fixture** API with `FRONTIER_QA_PORT=4325 node scripts/frontier/qa-server.mjs` from this worktree. Omitting `--codex` selects the deterministic provider. It creates an isolated repository/database and prints their paths. Then start the frontend with `AGENT_HARNESS_API=http://127.0.0.1:4325 npm run dev:frontier -- --port 5205` and open `http://127.0.0.1:5205/?mode=fixture&art=cinematic#world` when appropriate. Use live mode only against the verified isolated fixture API for API-backed acceptance.

The old temporary fixture marker still exists, but its database/runtime were not revalidated. Prefer a fresh isolated fixture over reusing undocumented temporary state. Preserve user services and databases; never use them for acceptance or launch paid model workflows.

## Journal

Separate clean repo: `/Users/shaun/.codex/worktrees/7237/agent-harness-ui/journal-site`, local commit `b179997def57be78138560eb83466faa5ff38714`. The receipt records version 10, before Goal 4's merge and before Goal 5. No journal update has been published for this checkpoint.

The last Sites lookup returned `project_not_found` for existing project `appgprj_6a9d2e96e0248191a66ccefcaad237d3`; discovery listed no accessible Sites. This is not proof the site was deleted. Verify the owning account/workspace connection and existing audience before publishing. Reuse the existing identity, preserve selected viewers, and follow `journal-site/AGENTS.md`. Do not expose this internal handoff's local paths/process details in the published journal.

## Suggested continuation prompt

```text
Resume Goal 5 in /Users/shaun/.codex/worktrees/7237/mission-frontier-goal-5.
Read design/mission-frontier/build-evidence/USABILITY/goal-5/HANDOFF.md first.
Preserve staged and unstaged work. Reconcile current main, including the newer
stale-approval recovery changes, then finish functional/browser acceptance and
the remaining code checks. Restart only isolated fixture services needed for
that work. Performance benchmarking is waived. Prepare the focused Goal 5 PR;
keep the journal publication issue separate. Do not start Goal 6, merge a PR,
publish the game, broaden journal access or run paid/live user workflows.
```
