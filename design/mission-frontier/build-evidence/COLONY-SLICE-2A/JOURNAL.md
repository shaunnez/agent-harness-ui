# Colony slice 2A — journal

Overnight run, 16–17 September 2026, lead on Fable. Decisions are in `design/mission-frontier/colony/SLICE-2A-DESIGN.md` (final section). Evidence captures are produced by `capture-2a.cjs <step>` against a Frontier dev server on port 5243.

## Step 0 — flag gate `?colony=1`

- `colonyRequested(search)` and `withoutColony(manifest)` in `model.ts`: without the flag the published v3 manifest is consumed as v2 (colony section dropped, legacy `bases`/`scene` kept), so the asset requests, layout, cameras, lamps and workers all take the pre-colony path.
- `layout.ts` gained `archipelagoBases` (main's staggered coastal grid, no slots) and `viewCamera(..., legacy)` (manifest cameras plus the archipelago world fit). `ProjectBase.slot` is now optional; `occupiedSlots` filters it. `ProofCamera` keeps the archipelago minimap when legacy; `ProofLabels` takes the base label anchor as a prop (manifest socket for legacy, contract anchor for the colony).
- Test: "without ?colony=1 the v3 manifest is consumed as v2 and the archipelago layout is unchanged". 140 Frontier tests, typecheck, lint, format pass.
- Evidence: `step0-legacy-{world,exterior,cutaway}-*.png`, `step0-colony-world-*.png`, `measurements-step0.json`. Legacy fetches only the archipelago kit; the colony fetches shell, crown, bridges and parcels (15.35 MB).
- **Headless limitation:** the legacy Exterior view renders as a blank canvas under SwiftShader (world and cutaway render). Checked in the desktop browser: the exterior renders correctly with the island, base and workers. Recorded as a capture-tool artefact, not a defect.

## Assumptions

- Slot assignment still runs (and persists) without the flag; it is harmless in the archipelago and keeps a project's parcel stable when the flag is switched on later.
- The two dev servers left over from slice 1 (5241 stopped on its own; 5242 still running) were left alone per instructions; this run uses 5243.
