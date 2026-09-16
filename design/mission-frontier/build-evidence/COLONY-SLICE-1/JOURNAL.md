# Colony slice 1 — lead journal

## 16 September 2026 — kickoff

- Shaun approved the four decisions (overflow lane, hub parcel visible, 40° cutaway, browser-local slots) and started slice 1 with the lead on Fable.
- Design branch merged with main e6f783c (minimap scoping/zoom clamp, procedural walk, held occlusion buffer) as 2e3667c; clean merge, 111 Frontier tests pass.
- Three workstreams dispatched against the frozen contract `assets/staging/colony-hq-v1/contract.json`:
  1. Terrain builder → `assets/staging/colony-hq-v1/terrain/` (parcel-hub, parcel-a, metadata, validator with ray-cast and winding checks).
  2. Asset producer → `assets/staging/colony-hq-v1/producer/` (hq-shell, crown-command, bridge-span-27, bridge-end, metadata; relay/foundry crowns if time allows).
  3. Runtime builder → separate worktree/branch from 2e3667c (colony.ts slots, rooms.ts allocation, grey boxes, manifest v3, fixtures, tests, browser captures under `runtime-greybox/`).
- Lead integration follows: merge runtime branch, run `integrate-3d-proof.mjs` with real assets, browser acceptance against the ten criteria in DELIVERY-SLICE.md.

## 16 September 2026 — stopped

- Shaun stopped the build. All three agents killed; no servers or Blender jobs left running.
- Runtime branch `worktree-agent-aa898a862c65647f8` has two commits (colony loader, slot placement) and an uncommitted `rooms.ts`. Producer has a script scaffold only. Terrain has nothing.
- Main moved to `6773f41` (shadow cadence, lamp pool). Merge it before resuming world-3d work.
- Resume from `HANDOFF.md` in this directory.

## 16 September 2026 — resumed

- Shaun requested resuming the committed handoff. Existing lead and runtime worktrees retained; runtime branch is now named `claude/mission-frontier-colony-runtime-slice1`.
- Lead merged main `6773f41` cleanly before integration. All 122 baseline Frontier tests and typecheck passed. Runtime preserved interrupted `rooms.ts` as a WIP commit and merged the same main revision.
- Runtime, HQ producer and terrain work resumed under the handoff's disjoint ownership. Preview uses port 5241; other user services remain untouched.
- **Contract defect corrected to 1.0.1-frozen through the generator:** edge angles previously came from unit-vector coordinates rounded to two decimals before `atan2`. At the 108 m parcel pitch this created up to 0.30 m transverse error between a 27 m bridge and its far abutment. Edge angles now derive from unrounded trigonometry and retain six decimals. Parcel slots, HQ geometry, levels, approved overflow ordering and camera decisions are unchanged. Both producers and runtime were notified to consume the regenerated contract.

## 16 September 2026 — lead integration and acceptance

- Resumed from HANDOFF.md after the producer, terrain builder and runtime builder had all delivered: `hq-shell`, `crown-command`, `bridge-span-27`, `bridge-end` (producer, 187 validator checks), `parcel-hub`, `parcel-a` (terrain, zero see-through cells over 100k rays), runtime branch merged twice into this branch. Committed the integration output as `d1be129` (six GLBs in the public manifest v3, cutaway hiding both `MF_Roof` roots).
- Browser acceptance at 1568 × 1003 and 1280 × 720 with headless Chromium: `acceptance/ACCEPTANCE.md`, `measurements.json`, 21 captures, and the capture script. Nine criteria pass at both sizes; criterion 4 passes at 1568 × 1003 and is partial at 1280 × 720 (see below).
- **Defect found:** task cards in the fourteen-task cutaway stacked upward off the top of the viewport (three tasks unclickable at 1568 × 1003). Fixed in `0f99c01`: cards stack around pinned room names and HUD panels, drop below neighbours when a stack would leave the viewport, and the collision test carries a 0.01 px tolerance after a floating-point stall on a fractional-height room label was traced with a live-input replay. Two new tests; 139 Frontier tests, typecheck, lint, format and Frontier build pass.
- **Known limitation:** at 1280 × 720 fourteen full-size cards cannot all fit above the back row; four fall to the top edge and overlap. Options for the next slice are in HANDOFF.md.
- A second Frontier dev server was started on port 5242 for the captures; the earlier agent's server on 5241 was left running.
