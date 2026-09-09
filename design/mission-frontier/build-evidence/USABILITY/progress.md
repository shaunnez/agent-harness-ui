# Usability progress

**Goal 4 U0–U2 complete — 9 September 2026.** Laptop window and Watch targets pass: 457 px maximised task content and 244 px normal agent activity at 1280 × 720. Native Chrome 200% zoom is qualified across the required destinations after fixing task-row overlap and the short-height Settings editor. Chrome is back at 100%. Goals 5 and 6 have not started.

Isolated branch `codex/mission-frontier-goal-4` starts from PR #73 source `fdbe171`. The user resumed after the earlier commit/push/pause checkpoint and authorized finishing acceptance, PR integration and the journal update. Goal 4 has been pushed into the existing open PR #73. Original dirty files and user services were preserved.

- [Acceptance, captures and limits](goal-4/acceptance.md)
- [Handoff](goal-4/HANDOFF.md)
- [Final checks](goal-4/zoom-final-checks.json)
- [Native zoom walkthrough](goal-4/native-zoom-200.json)
- [Local review](http://127.0.0.1:5204/?mode=fixture&art=cinematic#world)

Final typing, lint, formatting, both builds and 78 targeted tests pass. The earlier full suite retains 1,064 passes and four orchestration timing failures; all 121 implicated tests passed the sequential recheck. That full run was not repeated for the final CSS-only fix.

Next is Goal 5: decision navigation, an accurate return briefing and watch pins with UB1's bounded read contract. It requires its own start instruction. Goal 6 and the real delivery-workflow checkpoint remain separate.
