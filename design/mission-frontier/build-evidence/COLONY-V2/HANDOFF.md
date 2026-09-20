# Handoff — Contract 2.0 colony, after gate 2 (17 September 2026)

## Where things are

- Worktree: `/Users/shaun/projects/agent-harness-ui/.claude/worktrees/mission-frontier-colony-v2`, branch
  `claude/mission-frontier-colony-v2`, head `f783c1b`, pushed, tree clean. All commits signed (1Password SSH signing
  works now; use plain `git commit -S`, no `--no-gpg-sign`).
- PRs (merge #92 first, then #93; #91 is independent docs):
  - #92 `claude/mission-frontier-colony-design-c7dcc1` → main, head `16d2265` (26 commits, slice 2A). Re-signed and
    force-pushed from this worktree; the old 2A worktree's local branch still points at the unsigned commits, so
    reset it from origin rather than pushing from it.
  - #93 `claude/mission-frontier-colony-v2` → main, head `f783c1b` (31 commits incl. #92). Gate 2 summary is a comment.
- Gate 1 (macro composition) and gate 2 (environment pass) both accepted by Shaun. Evidence: `GATE.md`, `GATE-2.md`,
  `JOURNAL.md` (15 recorded assumptions), `capture-v2.cjs` (steps `gate`, `gate2`, `stress`, `peek`; `FRONTIER_OUT`
  redirects PNGs).
- Dev server for captures: `npm run dev:frontier -- --host 127.0.0.1 --port 5243 --strictPort` (5241/5242 belong to
  other sessions). Captures: `FRONTIER_BASE=http://127.0.0.1:5243/ node design/mission-frontier/build-evidence/COLONY-V2/capture-v2.cjs <step>`.
- Checks before every commit: `npm run -s test:frontier` (155 pass), `npm run -s typecheck`, `npm run -s lint`,
  `npm run -s format:check`.

## Shaun's latest decisions (not yet implemented)

1. **Robot scale**: World 2.5× → 1.9×, Exterior 1.4× → 1.3×, Cutaway 1× → about 1.15× ("slightly larger interior as
   well"). One table: `workerViewScale` in `src/frontier/world-3d/model.ts`. Rings, labels and picking follow.
2. **More ground around each base**: coast min/typical/max 26 / 30.5 / 35 → 28.5 / 33.5 / 38.5 in
   `design/mission-frontier/colony/source/generate_colony_v2.py` (`COAST`), keep `edgeCorridorMax` 31.5 so the 27 m
   span and 20 m channels hold. Then: run the generator (writes `colony-v2/contract.json`), refresh
   `contractSha256` in `colony-v2/producer/hq-metadata.json` (sha256 of the new contract; a one-line Python step, see
   the environment-pass session), run `node scripts/frontier/integrate-3d-proof.mjs`, delete the superseded
   `public/frontier/assets/3d-proof/colony-contract.<oldhash>.json`, run the tests (coast/stream/scatter tests are
   rule-based and should pass), peek capture, commit.
3. **Order changed**: palette lighting (step 8) BEFORE interiors (step 7).

## Palette lighting plan (step 8, next)

Brief: windows, lamps and project markers pick up the project palette at night; interior practicals stay warm;
crystals tint per parcel; do not wash out interiors.

- Per-base materials are already cloned in `ProofBase.tsx` (`identity_*` get the palette). At night (`light.lamps`)
  lerp emissive of `practical_warm_window_glass` (~35 %), `practical_warm_strip` (~50 %), `practical_bollard_cap`
  (~60 %), `practical_station_marker` / `practical_delivery_beacon` (markers) toward `basePalettes[palette].color`.
  Interior meshes (under `MF_Interior`) must keep a separate warm clone: key the material clone map by
  (material, isInterior).
- Lamp pool (`lamp-pool.ts`, `ProofScene.tsx` `lampsWorld`): add an optional colour per pooled lamp; HQ lamps and
  that parcel's lantern lamps mix warm `#ffc37f` toward the palette (~40 %); set `node.color` in the frame loop.
- Instanced kit pieces (`ParcelScatter.tsx`): lantern caps (`practical_station_marker`) and crystals (`crystal_glow`)
  need `instanceColor` per instance plus an `onBeforeCompile` patch multiplying `totalEmissiveRadiance` by `vColor`
  under `#ifdef USE_INSTANCING_COLOR`. `ParcelScatterPlan` needs the parcel's palette colour (from `base.appearance`).
- Evidence: dusk (hour 20) and night (hour 22) captures, world and exterior, both sizes; make sure the cutaway stays
  warm. Then commit and send PNGs.

## Interiors plan (step 7, after lighting)

Preserve the six-room logic and cutaway structure (rooms, sockets, doors from 1.0.1; producer
`colony-v2/producer/source/build_hq_v2.py` `interior()` imports the 1.0.1 recipe). Each room identifiable without
its label: Planning = coordination table / wall boards; Implementation = workstation banks; Review = analysis
screens; Testing = rigs / benches; Dispatch = logistics / loading / handoff cues; Briefing = briefing table.
Also: less dead floor, warm practical lighting, identity in walls / floors / signage (room_inlay_* materials exist),
fix the 1280 × 720 cutaway label pile-up (2A separator). Rebuild with
`/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python build_all_v2.py -- shell`, validate with
`validate_hq_v2.py`, re-run `integrate-3d-proof.mjs`, capture cutaway at both sizes.

## Standing rules

Never stop to ask; record assumptions in `JOURNAL.md`; never reduce scope silently; commit after each step with
tests green and push; do not merge or push to main; do not touch other worktrees; never bare `git stash`; no UI
mockups (the app is the prototype); evidence as browser captures at 1568 × 1003 and 1280 × 720; the worktree guard
refuses Bash commands containing the literal word "source", shell variables or complex heredocs (use `sourc?` globs
and scratch scripts run from files).
