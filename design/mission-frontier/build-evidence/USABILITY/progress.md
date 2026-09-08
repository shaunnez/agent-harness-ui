# Usability progress

Goal 4 started 9 September 2026. U0 baseline, U1 window implementation and U2 Watch implementation are built. The measured laptop targets pass: 457 px maximised task content and 244 px normal agent activity. Native 200% browser zoom remains pending; this is not yet a claim that every U1 acceptance item passed. Goals 5 and 6 have not started.

Source: PR #73, open at fdbe171a8545a6b9ae206b67ce01fe79606496f1. Isolated branch codex/mission-frontier-goal-4. Original dirty checkout and running services preserved.

- [Goal 4 acceptance, captures and limits](goal-4/acceptance.md)
- [Goal 4 handoff](goal-4/HANDOFF.md)
- [Automated checks](goal-4/checks.json)
- Local review: http://127.0.0.1:5204/?mode=fixture&art=cinematic#world

Paused at the user's request on 9 September 2026, with the checkpoint being committed and pushed to the separate Goal 4 branch. Chrome's native menu confirmed 200% zoom, but the destination walkthrough at that setting remains pending after page-control interruption. PR #73 remains unchanged.

Next on resumption: complete the native 200% destination walkthrough and restore normal preview zoom, then integrate the reviewed Goal 4 branch into the PR. Goal 5 is the separate next build: decision navigation, an accurate return briefing and watch pins, including UB1's bounded read contract.
