# Colony slice 1 — lead journal

## 16 September 2026 — kickoff

- Shaun approved the four decisions (overflow lane, hub parcel visible, 40° cutaway, browser-local slots) and started slice 1 with the lead on Fable.
- Design branch merged with main e6f783c (minimap scoping/zoom clamp, procedural walk, held occlusion buffer) as 2e3667c; clean merge, 111 Frontier tests pass.
- Three workstreams dispatched against the frozen contract `assets/staging/colony-hq-v1/contract.json`:
  1. Terrain builder → `assets/staging/colony-hq-v1/terrain/` (parcel-hub, parcel-a, metadata, validator with ray-cast and winding checks).
  2. Asset producer → `assets/staging/colony-hq-v1/producer/` (hq-shell, crown-command, bridge-span-27, bridge-end, metadata; relay/foundry crowns if time allows).
  3. Runtime builder → separate worktree/branch from 2e3667c (colony.ts slots, rooms.ts allocation, grey boxes, manifest v3, fixtures, tests, browser captures under `runtime-greybox/`).
- Lead integration follows: merge runtime branch, run `integrate-3d-proof.mjs` with real assets, browser acceptance against the ten criteria in DELIVERY-SLICE.md.
