# Slice 2A design — four buildings, living islands, readable robots

16 September 2026. Proposal for Shaun's approval before any build. Guidance: the four reference renders (world, projects table, add-project, HQ interior). Goal: world, buildings, trees, land and robots read like a AAA game. The HUD is not touched. Interiors are deferred.

## 1. Four buildings in the picker (first)

**What you get.** The Appearance panel's Building row shows four tiles with rendered thumbnails: **Bastion** (the new hex HQ), **Command**, **Relay**, **Foundry** (the three existing buildings). Any project can pick any of the four; the choice persists per project with the palette and slot, exactly as today. New projects are spread across all four by default. Picking a building never moves a base.

**How the three existing buildings come back.**

- They are re-seated on the hex parcel plateau (r 34 at y 4.0) with their existing courts, so their footprint (27 × 22 m) sits inside the plateau with room for the ring road. Their front (bay and landing side) faces the E210 spur, the same edge the Bastion's dispatch bay faces, so bridges and arrivals read the same for every building.
- Their interiors stay as they are (two work areas plus court). Task placement maps the six stages onto them: briefing, planning and implementation → work area 1; review and testing → work area 2; grill/answer → the answer area; dispatch (delivered) → court. Overflow: court sockets, then the approved overflow lane with "+N" labels. Same rule as the Bastion, different table.
- Their cutaway keeps their own roof groups; the 40° cutaway camera applies to all four so switching buildings does not change how the cutaway feels.
- Palette tint works on all four (identity disc, ring and trim materials already exist on the three; the Bastion crown has them).

**What changes in code (runtime only, no HUD).** `BaseVariant` gains `bastion`; manifest v3 records a per-building socket table and cutaway groups; `rooms.ts` reads the table for the active building instead of assuming the hex; the picker renders four tiles from the manifest. Producer work: re-export the three kits with a parcel-local origin and the front facing E210 (a transform, not remodelling), plus four consistent thumbnails.

**Decision needed.** Names. I propose calling the hex **Bastion** so "Command" keeps meaning the existing round-crown building. Alternative: rename the hex "HQ".

## 2. Living islands (second)

**What you get.** Three parcel variants that read as different places, assigned per project so neighbours never match, all inside the frozen contract envelope (flat plateau r 34 at y 4.0, ring road, six spurs and pads, coast ≤ r 46, seabed −3, backdrop only on the rear arc):

| Variant | Character (from the reference renders) |
| --- | --- |
| **A Meadow terrace** (upgrade of today's tile) | worn grass with dirt paths and gravel aprons, grounded boulders, purple tree clusters on the rear arc, shingle beach on the front coast |
| **B River cut** | a stream leaves the plateau edge, drops through two rock pools and a waterfall over the rear cliff into the sea; wet dark rock, reeds, mist plane at the fall |
| **C Forest knoll** | dense purple canopy with a rock outcrop and mossy ground, lantern posts along the ring road, a small overlook platform on the rear arc |

Shared upgrades on all three and the hub: real cliff faces on the rim (34 → 46 m) with dirt strata, rock stacks and undercut edges instead of smooth slopes; baked ambient occlusion in the ground textures; two parked vehicles per parcel (the existing cart and crate props, plus one rover) on the ring road or pads; the hub gains a beacon mast and pad lights.

**Purple trees.** The Quaternius trees from the original environment return with the violet canopy material, in clusters of 5–12, only outside r 34 and clear of spur corridors, as the reference renders show.

**Assignment.** Variant = hash of the project key, stored in the browser-local appearance record as `parcel` so it never changes for a project. A "Ground" row with three tiles is added to the Appearance panel so you can override it (same panel, one more row; no HUD change elsewhere).

**Constraints kept.** ≤ 120k triangles / 12 MB per parcel, ≤ 8 textures at 2048², closed manifold core, single-sided terrain materials, the existing ray-cast and winding validators, shoreline loops ≤ 120 points. Slots, bridges, spurs and cameras are unchanged, so nothing in placement or the ten slice-1 criteria moves.

## 3. Robots you can see (third)

**What you get.** In the World view robots render at 2.5× (about 7.8 m, still under the building eaves); Exterior at 1.4×; Cutaway stays 1×. Attention rings, labels, picking and shadows follow the scale automatically because they read the robot's height. Walking speed in world units is unchanged, so the gait does not look slowed. The reference world render has robots roughly this size relative to the buildings.

**Not changed.** Behaviours, room allocation, minimum spacing (measured at 1× in the cutaway, where it matters), camera framing.

## 4. Polish that comes with it (sure things only)

- Night: window emissives and practicals already exist; the new parcels add pad lights and lantern posts to the lamp pool, not new light types.
- The minimap keeps rendering from the same scene, so it inherits the new terrain for free.

## Not in this slice

Interiors (rooms, equipment, materials), shuttle and arrivals, Goal 6, live adoption, crystals, robot travel between parcels, camera or HUD changes, the 1280 × 720 crowded-card follow-up (tracked separately).

## Acceptance (evidence into `build-evidence/COLONY-SLICE-2A/`)

1. Picker shows four buildings with thumbnails; each renders on a parcel with correct rooms, cutaway and palette tint in all four colours; switching building never moves a base.
2. Three fixture projects show three different parcel variants; the ten-project stress shows all three in use; the Ground override persists per project.
3. Ray-cast validator passes on all four parcels; no rim cavities in captures at 1568 × 1003 and 1280 × 720, day and night.
4. Purple canopy clusters present on every parcel; none inside r 34 or in a spur corridor.
5. Robots at 2.5× in World, 1.4× in Exterior, 1× in Cutaway; labels and picking follow.
6. Budgets met; existing 139 tests plus new picker, mapping-table and parcel-assignment tests pass; typecheck, lint, format, build.

## Estimate (working days, parallel)

| Role | Work | Days |
| --- | --- | --- |
| Producer | re-seat three buildings, four thumbnails, socket tables | 2 |
| Terrain | three parcel variants with cliffs, water, planting, props; hub upgrades | 6 |
| Runtime | four-variant picker and mapping tables, parcel assignment and Ground row, robot scale, tests | 3 |
| Lead | integration, captures, acceptance | 2 |

About seven calendar days with three builders in parallel. Robot scale alone is half a day and can ship first if you want a quick win.

## Decisions taken by Shaun, 16 September 2026 (supersede the proposal above)

1. **No legacy buildings in the picker.** The three 16–20 MB base kits break the shell budget and carry a different room table. Relay and Foundry become **crowns on the hex shell** through the crown-command pipeline; the existing base-relay / base-foundry rooflines are silhouette reference only. One shell, one room table, four looks (Bastion, Command, Relay, Foundry) for about 7.7 MB.
2. **The hex is named Bastion.**
3. **Flag gate first.** The colony renders only behind `?colony=1`; without it the archipelago on main is unchanged.
4. **No baked parcel variants.** One or two base parcel meshes with real cliff faces and baked AO, plus runtime instanced scatter (purple `MF_Planting` trees from the existing environment, boulders, vehicles, lantern posts) seeded from the project key. Variant B's stream, waterfall, pools and mist are cut from 2A.
5. **No "Ground" row** in the Appearance panel; scatter is seeded, not picked.
6. **Criterion 4 (1280 × 720 card pile-up) joins this slice:** compact dot markers for plain "Working" cards in crowded rooms.
7. **Budgets:** colony asset set ≤ 25 MB total; scatter kit ≤ 3 MB; per parcel ≤ 120k tris / 12 MB / 8 × 2048² textures.

Order of work: flag gate, robot scale, crowded cards, crowns and four-tile picker, cliffs + AO + scatter. Evidence in `build-evidence/COLONY-SLICE-2A/`.
