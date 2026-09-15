# Usability progress

**Current checkpoint — 10 September 2026: paused, servers stopped at Shaun's request.** Goal 5 is restored on `dcd474e`, with staged/unstaged uncommitted work and no PR. Local main advanced one further commit to `04517df` (stale approval authority); integrate it on the next explicit resume. [Current handoff, screenshots and continuation](goal-5/HANDOFF.md). The synchronized-source selection reports 261 passes / one inherited main failure; typing, lint, both builds and four Sites tests pass. Formatting flags three unchanged main files. Further performance benchmarking is waived. The journal connection could not resolve the existing Site at its last check. Goal 6 has not started.

## Retained 9 September pause

**Goal 5 U3–U5 / UB1 implemented, paused before acceptance — 9 September 2026.** The user requested a handoff. The goal is paused and application changes remain uncommitted in `codex/mission-frontier-goal-5`, based on merged PR #73 (`196ec7d`). Goal 6 has not started.

- [Goal 5 handoff, screenshots and exact next steps](goal-5/HANDOFF.md)
- The handoff recorded 225 passing relevant tests; its `.log` was not retained by cleanup. Use [the new test output](goal-5/main-sync-tests.txt) for the synchronized source.
- [Normal/stress gateway read measurements](goal-5/request-volume.json)
- [Implementation snapshot](goal-5/source-manifest.json)
- Historical sample preview used port 5205; it is now stopped.

Final typecheck passed. Final lint failed on one assignment-in-expression in `scripts/frontier/measure-command-refresh.mjs:31`; formatting, both builds and Sites tests were not reached in that final chain. Native 200%/narrow flow acceptance, stale-approval/navigation browser checks, matched performance evidence and the journal update remain open. Chrome is restored to 100%; the in-app viewport override is reset. See the handoff before resuming or making completion claims.

## Goal 4 retained checkpoint

**Goal 4 U0–U2 complete — 9 September 2026.** Laptop window and Watch targets passed: 457 px maximised task content and 244 px normal agent activity at 1280 × 720. Native Chrome 200% zoom was qualified across the required destinations after fixing task-row overlap and the short-height Settings editor. These are Goal 4 measurements, not new Goal 5 acceptance.

Isolated branch `codex/mission-frontier-goal-4` started from PR #73 source `fdbe171`. The user resumed after the earlier commit/push/pause checkpoint and authorized finishing acceptance, PR integration and the journal update. Goal 4 was pushed into PR #73, which has since merged. Original dirty files and user services were preserved.

- [Acceptance, captures and limits](goal-4/acceptance.md)
- [Handoff](goal-4/HANDOFF.md)
- [Final checks](goal-4/zoom-final-checks.json)
- [Native zoom walkthrough](goal-4/native-zoom-200.json)
- [Local review](http://127.0.0.1:5204/?mode=fixture&art=cinematic#world)

Final typing, lint, formatting, both builds and 78 targeted tests pass. The earlier full suite retains 1,064 passes and four orchestration timing failures; all 121 implicated tests passed the sequential recheck. That full run was not repeated for the final CSS-only fix.

Goal 5 was subsequently authorized and started; use its paused handoff above. Goal 6 and the real delivery-workflow checkpoint remain separate.
