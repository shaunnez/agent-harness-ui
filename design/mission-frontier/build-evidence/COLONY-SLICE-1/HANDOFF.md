# Colony slice 1 — handoff (integrated and accepted, 16 September 2026)

Slice 1 is built, integrated and browser-accepted on branch `claude/mission-frontier-colony-design-c7dcc1`. A pull request to `main` carries it. Read this file, then `acceptance/ACCEPTANCE.md`, then `JOURNAL.md`.

## Authority

- Frozen contract: `design/mission-frontier/assets/staging/colony-hq-v1/contract.json`, version **1.0.1-frozen** (1.0.1 corrected edge angles derived from rounded unit vectors; slots, HQ geometry, levels and decisions unchanged). Never edit it; change `design/mission-frontier/colony/source/generate_colony_pack.py`, regenerate, bump the version, record why in `JOURNAL.md`.
- Design pack: `design/mission-frontier/colony/` (COLONY-PLAN, HQ-FLOOR-PLAN, INPUT-CONTRACT, DELIVERY-SLICE with the ten acceptance criteria, TERRAIN-HOLES).
- Decisions already taken by Shaun (do not re-ask): overflow lane with "+N" labels; hub parcel visible from day one with an empty pad; cutaway 40° for HQ only; slot persistence browser-local with the appearance record, backend later.

## Branches and worktrees

| Role | Path | Branch | State |
| --- | --- | --- | --- |
| Lead / design / integration | `/Users/shaun/projects/agent-harness-ui/.claude/worktrees/mission-frontier-colony-design-c7dcc1` | `claude/mission-frontier-colony-design-c7dcc1` | everything below; PR open to `main` |
| Runtime builder | `/Users/shaun/projects/agent-harness-ui/.claude/worktrees/agent-aa898a862c65647f8` | `claude/mission-frontier-colony-runtime-slice1` | fully merged into the lead branch; clean; can be removed after the PR merges |
| main | `/Users/shaun/projects/agent-harness-ui` | `main` at `6773f41` | local main carries `1c7abde` and `6773f41` (shadow cadence, lamp pool) that are **not on origin/main** (`e6f783c`); the lead branch includes them, so the PR shows them until their owner pushes main |

Ports 5199, 5207, 5218, 5219 belong to other people's Frontier servers. Two servers from this worktree may still be running: 5241 (started by the previous agent) and 5242 (started for the acceptance captures). Stop whichever you do not need.

## What was delivered

- **Assets** (`assets/staging/colony-hq-v1/`): producer `hq-shell.glb` (45,468 tris), `crown-command.glb`, `bridge-span-27.glb`, `bridge-end.glb`, `hq-metadata.json`, validator with 187 checks, previews, `HANDOFF.md`, `PROVENANCE.json`; terrain `parcel-hub.glb`, `parcel-a.glb`, `parcel-metadata.json`, export and ray-cast validators (zero see-through cells), previews, `HANDOFF.md`, `provenance.json`. Sources (`.blend`, scripts) are committed alongside, matching the existing kit practice.
- **Runtime** (`src/frontier/world-3d/`): `colony.ts` (contract loader, slot fill rule, bridges, persistence), `rooms.ts` (stage-to-room, socket allocation with overflow order), `layout.ts` slot placement and contract cameras, `cutaway.ts` (hides every `MF_Roof` root plus `MF_ShellCutaway`), `labels.ts` bounded card stacking, manifest v3 in `model.ts` (v2 still parses), `scripts/frontier/integrate-colony-assets.mjs` and `validate-colony-assets.mjs`, fixtures `colony-stress` (ten projects, fourteen-task HQ). Public GLBs are hash-named under `public/frontier/assets/3d-proof/`.
- **Tests**: 139 Frontier tests including `colony-runtime`, `colony-assets`, `colony-cutaway` and the label-stacking tests. `typecheck`, `lint`, `format:check`, `build:frontier` pass.
- **Evidence**: `acceptance/ACCEPTANCE.md` (ten-criteria matrix), `acceptance/measurements.json`, 21 PNGs at both sizes, `acceptance/capture-acceptance.cjs`; earlier `resume/` and `runtime-greybox/` captures.

## Open items for the next agent

1. **Card overflow at 1280 × 720 with fourteen tasks** (criterion 4 partial). Fourteen 57 px cards cannot all fit above the back row; four fall to the top edge and overlap. Preferred fix: when a room holds more cards than fit, collapse cards without attention (plain "Working") to compact dot markers in the cutaway, as `visibleWorkerLabels` already does for the world view, keeping full cards for answer/repair/blocked/selected. Alternative: a denser card style above ~8 workers. Re-run `acceptance/capture-acceptance.cjs` and expect `cardPairsOverlapping` and `cardsOverPanels` empty at both sizes and `domPickSummary.ok` 14/14.
2. **Scene-click verification.** The capture script's blind canvas clicks are not a reliable picker test; either read robot screen positions from the scene (expose a QA-only hook under `?qa=1`) or keep relying on the unit tests.
3. **After the PR merges**: remove the runtime worktree and branch, stop the 5241/5242 servers, and start slice 2 (Relay and Foundry crowns, parcels B and C, crystals) from `DELIVERY-SLICE.md`.
4. **origin/main lag.** If `1c7abde`/`6773f41` are pushed to main by their owner before review, the PR diff shrinks to this branch's own commits; nothing to do otherwise.

## Commands

```sh
npm run -s test:frontier && npm run -s typecheck && npm run -s lint && npm run -s format:check && npm run -s build:frontier
```

```sh
npm run dev:frontier -- --host 127.0.0.1 --port 5242 --strictPort
```

URLs: `http://127.0.0.1:5242/?mode=fixture&scenario=workflow&art=cinematic&renderer=3d#world` and `…scenario=colony-stress…#project/plancheck`.

```sh
node scripts/frontier/integrate-3d-proof.mjs
```

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python <script.py>
```

## Rules carried over

- Producer writes only under `producer/`, terrain only under `terrain/`; the lead commits their work.
- Never bare `git stash` / `git stash pop` (shared stash stack); use a WIP commit.
- Nothing runtime-owned is baked into assets; `identity_*` materials stay neutral in source.
- Do not re-ask the four decisions above.
