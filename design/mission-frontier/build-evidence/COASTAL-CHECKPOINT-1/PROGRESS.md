# Coastal checkpoint 1 — running record

Started 15 September 2026 on `codex/mission-frontier-coastal-checkpoint-1`, in the preserved fidelity worktree. Origin/main was fetched and was already integrated (`aca587e`). Earlier PRs #86/#87 are merged; this will be a new draft PR.

## Build order

1. Measure existing camera, project placement, route connections and worker clearances. **Done.** Builder contract in the new staging directory. Astra owns only `astra-scene/**`.
2. Inspect assembled blockout at normal World scale, alongside original. **Done.** See BLOCKOUT-REVIEW.md and combined source/current evidence. Contract revision2 records the required geometry corrections.
3. Integrate detailed registered landscape/base/crossing, masks and day/night shoreline motion. **Astra detailed production in progress.** Synthetic shader qualification shows shoreward travel and reduced night exposure; actual terrain masks remain pending.
4. Run browser checks at 1568×1003 and 1280×720, correct visual findings, run required checks.
5. Commit/push draft PR, update the separate journal preserving current HUD history/audience, and leave the preview open.

## Current evidence

- `before-world.png`: actual current browser, 1568×1003, cinematic workflow fixture, daylight, normal Fit camera, no selected task. Normal camera is unchanged.
- `pre-art-tests.txt`: 85 Frontier tests passed, including 2 new actual-route compatibility tests. This is integration scaffolding verification, not final art acceptance.
- Typecheck and repository lint passed before art integration. Final evidence will be rerun after delivery assets.
- `api-tests.txt`: all18 isolated Frontier API tests passed. No backend files changed.
- `shader-qa.json`: synthetic data shader check, not final coastal acceptance; capture encoding/edge-compression limits recorded.

## Boundaries

New layout helper preserves the existing nearest-prior infrastructure graph. The authored crossing activates only when the measured real approach matches the kit. Other saved/variable layouts retain their existing scenery/routes, with no project relocation or fictional connection. This first checkpoint deliberately does not propagate a fixed scene to arbitrary topology.

The journal was independently updated by the HUD task and now points to `mission-frontier-hud`. Preserve this newer history; do not overwrite with the older journal snapshot. At completion, recheck main and journal before incorporating new art evidence.

No Goal 6, robot redesign/cargo/jetpack, seabird batch, HQ/Watch architecture redesign, paid generation, game publication or merge in this checkpoint.

## Journal preparation

The separate HUD task is still adding journal history. To avoid editing its active checkout, journal changes are prepared in an independent Git worktree `coastal-journal-review/journal-site`, branch `codex/coastal-checkpoint-journal`, based on journal commit `ae0f22e`. The original journal checkout remains untouched. A small explicit secondary-source mapping will import art captures and qualification while retaining HUD as the primary source; this does not imply the branches have been integrated. Before publication, merge newer journal/main commits and preserve the current audience. Current journal content has not been changed or published by this checkpoint yet.

## Final integration — 15 September 2026

Final Astra hashes frozen and integrated. Main #88 merged. 88 Frontier / 18 API / 4 Sites and all required source/build checks passed. Final day/dusk/night, laptop, shore/motion/connection and HQ/Watch evidence retained. See acceptance.md and HANDOFF.md for current status; earlier pending notes above are historical.

## Delivery complete

Draft PR #89 is open. Journal version 20 / article 21 is published with unchanged owner-only access and verified in the browser. All required checkpoint work is complete; artistic review is next. Preview port 5206 remains running.
