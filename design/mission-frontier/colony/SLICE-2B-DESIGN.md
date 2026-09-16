# Slice 2B — direction reset: Contract 2.0 colony

17 September 2026. Supersedes the earlier 2B proposal (palette lighting, cutaway fit, HUD rail, interiors on the 2A
shell), which assumed the 2A world was the right target. Shaun's review: the circular island, ring road and literal
hexagon HQ are a visual regression; the Astra proof (rocky parcel, bridge, water edge, rounded modular base) is the
closer structural direction. "More hexagon" was interpreted too literally: hex is organisational logic, not a giant
clean hexagon on a circular island.

Confirmed decisions: Contract 2.0 is a new file (`assets/staging/colony-v2/contract.json`); 1.0.1 stays untouched as
the record of the rejected direction. The legacy archipelago on `main` stays behind its flag; the `?colony=1` world is
replaced by the 2.0 colony. Astra is reference, not something to restore literally; anything technically better in the
current implementation is kept where it does not compromise the new look.

## Priority order

1. **World composition.** Irregular rocky parcels, cliffs, elevation change, water between parcels, bridges, tighter
   framing. No circular island, ring road or open grass. Built as a runtime height field (`terrain-field.ts`).
2. **HQ exterior.** Modular sci-fi command base on hex-influenced organisation: curved stepped bays, hub drum,
   recessed entrances, attached service wing, facade rhythm, roof equipment, warm windows. Built by
   `colony-v2/producer/source/build_hq_v2.py`; crowns re-fitted by `build_crowns_v2.py`.
3. **Camera and framing.** Base and surroundings dominate; cutaway fills about 80 % of frame height.
4. **Interior cutaway.** Six rooms with clear identity through props, layout, lighting, wall treatment and
   equipment; less dead floor; room naming in the environment.
5. **Palette-aware lighting.** Windows, lamps and project markers pick up the project palette at night; interior
   practicals stay warm.

Lower priority afterwards: crystals and rock accents, shoulder relief, tree variety, optional water features
(stream, pool, waterfall, mist), ambient vehicles.

**Visual gate** after 1–3: `build-evidence/COLONY-V2/GATE.md`. Passed 17 September 2026: world layout, HQ massing,
bridge logic and camera framing frozen.

## Environment pass (after gate 1)

Shaun's second brief, in order: water polish (foam, depth colour, movement, optional stream / pool / waterfall /
mist), cliff and terrain dressing (scanned pieces with undercuts, rock clusters, wet rock), vegetation (silhouette
variants, a bare tree, sparse scrub, grass, reeds), crystals (reusable clusters, subtle glow, later palette tint); then
interiors (room identity in the environment, less dead floor, warm practicals, the 1280 label pile-up); then palette
lighting. **Gate 2** after water, cliffs, vegetation and crystals: `build-evidence/COLONY-V2/GATE-2.md`.

## Preserved

Product structure; World, Exterior and Cutaway modes; agent and task state logic; project colour identity; the six-room
organisational layout (rooms, sockets, doors, movement polygons are 1.0.1's); robot scale and crowded-card work from
2A; slot ids and the fill rule.

## Stopped

Circular island as core layout; ring road as main composition; literal hexagon architecture; large flat grass areas;
baked parcel tiles.

## Evidence

`build-evidence/COLONY-V2/`: `JOURNAL.md` (steps, assumptions, blockers), `GATE.md`, `capture-v2.cjs`, gate PNGs at
1568 × 1003 and 1280 × 720, day and dusk.
