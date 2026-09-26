# Age of Agents — handoff (26 September 2026)

## Where it stands

- **Branch:** `claude/age-of-empires-ui-prototype-ldvr0t`
- **PR:** [#144](https://github.com/shaunnez/agent-harness-ui/pull/144). It is open with no merge conflicts, has no CI checks configured, and has no reviews yet.
- **What it is:** an Age of Empires look-and-feel prototype of the Harness command centre. It is a separate Vite entry over Frontier's fixture data, and the live Frontier app is untouched.
- **Checks:** `tsc --noEmit`, `biome lint src`, `biome format`, `npm run build:empire` and `npm run test:empire` (7 replay tests) all pass on the last commit.

```
npm install
npm run dev:empire      # http://127.0.0.1:5198   ?skip = no title screen, ?skip&replay = start the replay
npm run test:empire
npm run build:empire    # dist/empire
```

## What was built

1. **First pass:**
   - A procedural isometric realm: kingdoms as projects, campaigns as tasks, ten stage buildings in four ages, package yards, the Grand Market (Linear), the GitHub Capital, and the walled research realm.
   - The AoE HUD: resources, the current age, "Awaiting your decree", the herald, a command grid and a minimap.
   - Screens: Chronicle, Muster, Tech Tree, Diplomacy, Found a Kingdom, Ledger and Raise a Campaign.
2. **Second pass (Shaun's steps 2, 3 and 4):**
   - A labelled sample replay (MS-100) through all ten buildings, including the repair road, a stale verdict and the envoy to GitHub.
   - Building interiors, and Watch a crew.
   - Barracks tabs: Special corps and Standing orders.
   - Day and night.
   - The renderer split so no file passes 500 lines, and the terrain cache at 0.75 scale.
3. **HUD tidy:**
   - A shorter bottom panel.
   - A command grid with no empty slots, larger buttons and hotkeys on them.

The mapping and the list of screenshots are in `README.md`. Screenshots `01`–`19` are in this folder.

## Code map (`src/empire/`)

| Area | Files |
| --- | --- |
| Data | `realm.ts`: kingdoms, campaigns from `sampleTasks()` (Frontier fixtures plus `enrichWorkflowScenarios`), units and ranks, ages and buildings |
| Map | `map/world.ts` (generation, roads, yards, sea lane), `terrain.ts` (bake), `buildings*.ts`, `units.ts`, `draw.ts` (primitives), `overlays.ts`, `layers.ts` (all drawables and hits), `lighting.ts` (day and night), `march.ts` (routes), `scene.ts` (camera, input, loop) |
| Replay | `replay/script.ts` (steps), `engine.ts` (pure `replayFrame`), `controller.ts`; tests in `tests/empire/replay.test.mjs` |
| HUD | `hud/TopBar`, `Decrees`, `Herald`, `ReplayBar`, `WatchPanel`, `BottomPanel` with `hud/cards/*`, `Minimap`, `Portrait` |
| Screens | `screens/*` with `screens/interior/*` and `screens/muster/*`, `parts.tsx` (Council, Yards, Scrolls) |
| Styles | `empire.css`, `empire-hud.css`, `empire-views.css` |

## Rules to keep (also in AGENTS.md)

- Squads, yards, fires and ships come only from recorded task, run and package state, or from the replay. The replay is always labelled "Replay · sample".
- Townsfolk, caravans, lanterns, clouds and gulls are scenery.
- Every command shows a notice and changes nothing. Live wiring needs Shaun's go-ahead.

## Possible next steps (not started)

- Centre the realm overview card when nothing is selected. It is the only card with spare space.
- Show the Chronicle's age medals inside interiors, and link interior scrolls to the Chronicle.
- A second replay script, for example a Grill-only investigate campaign or a research question marching through the Starwatch.
- Shaun's floated idea: one large research base with robots mining and exploring. It is a design idea only and not authorized for build.
- Live data, read-only first, through Frontier's `FrontierGateway`. Needs a go-ahead.

## Housekeeping

- A self check-in on PR #144 is scheduled hourly (routine "Re-check PR #144"). It re-arms itself until the PR is merged or closed. Ask to stop it if it isn't wanted.
