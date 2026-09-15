# Mission Frontier HUD simplification — 15 September 2026

## Result and source

Implemented only the confirmed HUD steering on `codex/mission-frontier-hud`, in a separate worktree from verified fidelity revision `c5a8f0c46550ba952c8ce35d88384f0da2ff4599`. The uncommitted AGENTS, BUILD-GOALS and WORLD-DEPTH-AND-HUD brief were copied and read before edits; the original checkout and its services were preserved. The original fidelity branch advanced independently to `b431fc34fed68016a630aabd2784f310c607fe67` during this task. Its intervening changes affect planning documents only, including ART-CHECKPOINT-1; no application-source drift was found. That art work remains outside this slice.

- While you were away is in Manage, with its retained-history boundaries, update indicator and review checkpoint intact.
- The standalone Watch list and empty state are removed. Source-scoped task and exact-run pins retain their existing persistence and pin/unpin actions.
- Pinned appears directly beneath Needs you only when pins exist, independently of decision count.
- Needs you has task ID/stage, project, short state and arrow. Show all decisions and local scrolling preserve complete access. Recorded reasons, next actor and waits are available through selection and full inspection.
- Floating task labels have ID/stage and one state line. Project labels remain distinct. Blocked tasks cannot inherit a stale package's running label.
- Selection has a small portrait, task/stage/state, one primary eligible action, Inspect and recorded model/reasoning/tokens. Existing artifacts open from optional links; there are no empty placeholders. Clear selection and Escape dismiss it.

No backend, approval, policy, usage or persistence contracts were changed. Scenery, assets, robot animation, camera source and lighting controls remain unchanged. Goal 6 was not started. No game push, PR, merge or publication was performed by this task. PRs #86 and #87 were independently merged; their current state was verified, not changed here.

## Running preview

Sample world: http://127.0.0.1:5207/?mode=fixture&scenario=workflow&art=cinematic#world

HUD worktree: `/Users/shaun/.codex/worktrees/7237/mission-frontier-hud`.
Vite is running on 5207 with the isolated deterministic companion on 4327. Both were started by this task. Existing 5205/5206 and other user services were left alone. The temporary companion is explicitly labelled an isolated API fixture and never invokes Codex or uses the real database. Its retained tasks were completed for zero-decision acceptance; use the sample-world URL above to review running and repair states.

## Qualification

- `npm run test:frontier`: 84 passed, 0 failed/skipped.
- `npm run test:frontier-api`: 18 passed, 0 failed/skipped.
- `npm run test:sites`: 4 passed, 0 failed/skipped.
- Typecheck, lint, formatting, Frontier build, root build and final diff whitespace check passed. Both builds retain their existing bundle-size warnings.
- Root build contains `dist/client/index.html`, `dist/server/index.js` and `dist/.openai/hosting.json`. Protected hosting, worker and Sites packaging sources are unchanged.
- Computer-use acceptance and before/after captures are recorded in [acceptance.md](acceptance.md). Logs and source hashes are retained alongside this file.

These are focused local checks. The full repository suite, remote CI, real model execution, execution-to-PR delivery, native screen-reader/OS lifecycle and performance benchmarks were not run. No extreme-zoom experiments were performed.

## Separate journal

The independent journal is updated from this exact source and selected sample/isolated captures through its existing workflow. Its hosting identity and owner-only audience are preserved; publication is separate from the game. The confirmed journal publication receipt is maintained in that repository's `publication.json`.
