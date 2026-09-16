# Frozen input contract — colony parcels and hexagonal HQ (v1.0.0)

Frozen 16 September 2026. The machine-readable contract is [assets/staging/colony-hq-v1/contract.json](../assets/staging/colony-hq-v1/contract.json); this page explains how to read it. The JSON wins over prose. The asset producer and the terrain builder build against it independently; the lead integrates. **Changes go through the lead, bump the version, and both sides re-read the file before continuing.**

## Shared basics

| Topic | Value |
| --- | --- |
| Units | metres, degrees, seconds |
| glTF axes | X right, Y up, +Z front (toward the viewer). Every HQ front and court faces +Z in every parcel. |
| Blender axes | X right, Y back, Z up; front = −Y; exporter maps (x, y, z) to (x, z, −y) |
| Angles | world XZ angles with x = cos, z = sin; colony angles `phi` use the ground basis u = (0.8, 0, −0.6), v = (−0.6, 0, −0.8) |
| Origins | colony (0,0,0) = hub parcel centre at sea level; each parcel root at its cell centre, unrotated; HQ root at the parcel origin with the floor reference at (0, 4.30, 0); span root at the "from" abutment face on the deck centreline with +X along the span; end root at the pad centre (r 36.5) with +X outward |
| Levels | sea 0.00 · seabed −3.00 · plateau 4.00 · court, deck, pads 4.25 · HQ floor 4.30 · ceiling 9.10 · parapet 9.60 · bay roof 8.30 · crown max 18.50 · base label 19.50 |
| Robot | reuse `worker.glb`, 1.8 m source scaled to 3.1 m at runtime, feet at origin, +Z forward, label 3.6 m above feet |

## Who consumes which section

| Section | Asset producer (HQ, crowns, bridge) | Terrain builder (parcels) | Lead / runtime |
| --- | --- | --- | --- |
| `colony.slots`, `fillRule`, `connections` | read for context | read for context | implement placement |
| `colony.edges`, `landRules`, `roads` | edges fix bridge origins | **build to these** | validate |
| `colony.bridge` | **build to these** from `MF_Bridge` | pads must meet the abutment face at r 40.5 | place spans |
| `hq.*` (footprint, hub, bay, rooms, sockets, doors, groups, crowns) | **build to these** | plateau must be flat under r 34 | sockets, cutaway, cameras |
| `materials` | naming and portability | terrain naming, single-sided | tinting and pulse |
| `cameras` | producer QA renders only | producer QA renders only | **implement** |
| `interactionSockets`, `movement` | export socket empties | export pad centres, shoreline loops, road polylines | routes, picking |
| `budgets`, `deliverables` | own list | own list | integration script |

## Asset producer checklist

1. One `hq-shell.glb` containing the hex shell, hub, partitions, bay, doors, court paving, room equipment, props, practicals and socket empties, in the named groups `MF_BaseFixed`, `MF_ShellCutaway` (with `_FrontFlats`, `_PartitionGlass`), `MF_Interior` (with one child per room), `MF_Court`, `MF_Props`, `MF_Practicals`, `MF_Sockets`.
2. Three crown files `crown-command.glb`, `crown-relay.glb`, `crown-foundry.glb` whose root is `MF_Roof`, inside the envelope, each carrying `identity_roof_inset`, `identity_roof_ring`, `identity_trim` neutral.
3. `bridge-span-27.glb` (18 panels, 3 piers, bearings, rails, safety edge) and `bridge-end.glb` (kerb 4.0→4.25, abutment block, two bollards with practical caps), authored from the existing `MF_Bridge` components.
4. `hq-metadata.json`: bounds per group, light positions, exported socket coordinates, door frames, triangle counts, hashes.
5. Editable `.blend` files, rebuild and export scripts, provenance; portable PBR only; nothing baked that belongs to runtime (identity, status, actors).

## Terrain builder checklist

1. `parcel-hub.glb`, `parcel-a.glb`, `parcel-b.glb`, `parcel-c.glb`, each rooted at its cell centre: plateau flat at 4.0 to r 34, ring road annulus 27.5–32.5, six spurs and six pads on the edge lines at world angles −67.0, −126.9, 173.1, 113.0, 53.1, −6.9 degrees, abutment faces at exactly r 40.5, coast never beyond r 46, seabed flat at −3.0 under the channels, rear backdrop only in the 200–340 degree arc.
2. Groups `MF_Terrain`, `MF_Planting`, `MF_Road_Ring`, `MF_Road_Spur_E30…E330`, `MF_Pad_E30…E330`, `MF_Scenery_Crystal` (optional in slice 1), `MF_Practicals`.
3. Closed manifold land core, outward normals, single-sided terrain materials; scan shells are detail on a solid, never the only surface.
4. `parcel-metadata.json`: closed `shorelineXZ` loops (≤ 120 points each, ≤ 0.15 m simplification error), plateau polygon, road polylines, pad centres, planting exclusion, light positions, bounds, triangle counts, hashes.
5. Budgets: ≤ 120k triangles and ≤ 12 MB per parcel, ≤ 8 textures at ≤ 2048².

## Lead validation before integration

The integration script gains these checks; a failure blocks the asset, not the contract.

- Required groups and material names present; no unknown `identity_*` or `practical_*` roles.
- Bounds inside the envelopes (hex + 1.5 m eaves, crown ≤ 18.5, parcel ≤ r 46, pads at r 32.5–40.5 ± 0.05).
- Socket empties match the contract coordinates within 0.05 m.
- Horizontal terrain and road faces wind upward (vertex normal agrees with winding, y > 0).
- Ray-cast from the exterior camera direction on a 0.5 m grid inside each shoreline loop: no cell reaches sea level inside land.
- Triangle and byte budgets; textures embedded and portable; shoreline loops closed.
