# Mission Frontier colony design pack — 16 September 2026

Design deliverable prepared from the accepted layout brief in [NEXT-PHASE-HANDOFF.md](../NEXT-PHASE-HANDOFF.md). No application code, no asset production and no build was started. Branch `claude/mission-frontier-colony-design-c7dcc1` from `f921571`; only `design/mission-frontier/` is touched.

## Read in this order

1. [COLONY-PLAN.md](COLONY-PLAN.md) and [colony-plan.svg](colony-plan.svg): hexagonal lattice of parcels, 108 m pitch, hub parcel at the centre, fixed fill order, positions never move, one 27 m bridge type everywhere.
2. [HQ-FLOOR-PLAN.md](HQ-FLOOR-PLAN.md), [hq-floor-plan.svg](hq-floor-plan.svg) and [hq-cutaway-composition.svg](hq-cutaway-composition.svg): 36 m hex, hub, six rooms with implementation double-width, dispatch bay, doors and clearances, 53 robot positions, cutaway groups and cameras.
3. [INPUT-CONTRACT.md](INPUT-CONTRACT.md) explaining the **frozen** [contract.json](../assets/staging/colony-hq-v1/contract.json) that the asset producer and terrain builder build against independently.
4. [TERRAIN-HOLES.md](TERRAIN-HOLES.md): the current holes are unclosed geometry inside the island asset, not tile seams; fix belongs to the terrain rebuild. Evidence in [build-evidence/COLONY-DESIGN/terrain-holes/](../build-evidence/COLONY-DESIGN/terrain-holes/).
5. [DELIVERY-SLICE.md](DELIVERY-SLICE.md): reuse, new art, backend, Goal 6 dependencies, slice 1 with ten acceptance criteria, prepared assignments, four decisions for Shaun.

## Decisions taken by the lead (within the brief)

- Colony is a hex lattice with a reserved central hub parcel (spaceport plaza), not a linear chain.
- Dispatch is a projecting front bay plus corridor; briefing keeps the front sector.
- Cutaway camera elevation rises to 40 degrees for HQ only; exterior and world keep 28.4 and the same azimuth.
- One shared HQ shell plus three crown files replaces three full building files.
- Every bridge is the same 27.0 m span; pads at r 32.5–40.5 make that true on every edge.

## Regenerate

```bash
python3 design/mission-frontier/colony/source/generate_colony_pack.py
```

Writes the contract JSON and the three SVGs from one set of constants.
