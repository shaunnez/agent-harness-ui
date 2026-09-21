# Meshy scatter kit — slice 1 evidence

Ten Meshy scans substituted into existing Contract 2.0 scatter slots, compressed with Draco geometry
and WebP textures. Item names, metre heights and anchors are unchanged, so `scatter.ts` placement
rules and the seeded per-project layout were not touched.

## Compression probe

One model (`tree.pinkCoastal.A`, the heaviest at 20.6 MB / 174,834 triangles) was exported across
four triangle targets, three texture sizes and both compression options, then rendered from a fixed
camera and compared by eye. Probe script: `assets/staging/meshy-kit/source/probe_one.py`.

| Setting | Bytes | Verdict |
| --- | --- | --- |
| Source, 4K maps, 174,834 tris | 20.60 MB | reference |
| 20k tris, 1024px, Draco + WebP | 1.14 MB | no visible difference |
| 20k tris, 512px, Draco + WebP | 0.52 MB | no visible difference at scatter camera range |
| 8k tris, 1024px, Draco + WebP | 0.96 MB | **rejected** — canopy develops holes, silhouette thins |

Textures dominate these files, so texture format is the larger lever: WebP alone takes the 20k/1024
export from 6.95 MB to 2.12 MB, and Draco halves it again to 1.14 MB. Foliage is the binding
constraint on decimation; solid rock and cliff bodies hold their form far lower, so those slots use
6k–12k.

## Kit result

| Measure | v2 kit (procedural) | v3 kit (scanned) | Budget |
| --- | --- | --- | --- |
| Bytes | 5,845,124 (5.57 MiB) | 4,191,976 (4.00 MiB) | 6,000,000 |
| Triangles | 58,750 | 157,306 | 90,000 → **exceeded** |
| Images | 6 | 40 | 8 per file → **exceeded** |

Cold transfer including the one-time Draco decoder (188 KB wasm + 56 KB wrapper, shared by every
compressed asset and served from `public/frontier/decoders/draco`, not a CDN):

- v2 kit: 5.573 MiB
- v3 kit + decoder: 4.238 MiB
- **Net −1.335 MiB**, measured uncached in the browser

Against the recorded 18.60 MiB cold load and its 20 MiB target, headroom moves from about 1.40 MiB
to about 2.74 MiB.

## Two budgets now exceeded

Both were written for authored procedural geometry and neither has a recorded rationale tied to a
device or a measurement:

- **Triangles, 157,306 against 90,000.** Scanned bodies legitimately need more geometry than
  parametric ones; decimating foliage far enough to fit visibly destroys it (see the 8k row). The
  validator gained a `scatterKitScanned` budget defaulting to 180,000 for this kind.
- **Images, 40 against 8.** Each scan carries its own baked PBR set and cannot share a UV layout
  with the others, so the shared-atlas assumption behind the ceiling does not hold. The ceiling is
  now per-kind, 48 for `scatter3`.

Neither is a resolved question. Atlasing the scanned set would address both and has not been
attempted.

## Measurements and their limits

- Dev build, embedded browser, Apple M5, 1440x900, dusk exterior: **59.7 FPS**, which is the vsync
  cap rather than a headroom figure.
- This is **not** the formal performance gate. That gate is a production build against the
  normal/stress fixtures, and it has not been re-run for this change.
- Texture residency was not re-estimated. 40 WebP images at 512px decode to roughly 40 MiB RGBA,
  which is new resident cost against the 192 MiB target and needs measuring before this is qualified.

## Checks

Typecheck, lint and format pass. 155 Frontier tests pass, zero failures. The v2 kit, HQ shell and
crowns still validate unchanged through the uncompressed path.

## Validator changes

- Draco primitives are accepted for scatter kinds only. glTF keeps `count` on the index accessor and
  `min`/`max` on POSITION when the bufferView is dropped, so triangle totals and bounds stay
  checkable without a decoder. The per-vertex sweep cannot run on compressed geometry, and the kinds
  that need it — shell, crown, parcel, bridge — still require uncompressed geometry.
- WebP dimension parsing added alongside PNG and JPEG (VP8, VP8L and VP8X).

---

# Slice 2 — the transport on the landing terrace

Contract 2.0 already reserved this spot: `interactionSockets.spaceport_pad` (centre [0, 4.25, 0],
radius 14) and slot H, "landing terrace: shared shuttle pad on a small rocky spit". Both notes add
"shuttle itself is Goal 6 scope", so placing it now is ahead of the contract's own staging. The pad
rendered as bare ground until this change — the greybox calls it `empty_landing_pad`.

`spaceship.transport.A` is a hero object, not a kit item: it is seen at close range from the exterior
camera, so it keeps 1024px maps where scatter pieces drop to 512, and it is published as its own GLB
rather than folded into the kit.

| Measure | Value |
| --- | --- |
| Source | 16.0 MB, 114,008 triangles, four 4K maps |
| Published | 0.89 MB, 24,000 triangles, four 1024px WebP maps, Draco geometry |
| Size | 11.98 m long, 7.52 m wide, 3.94 m tall |

Placement checks, read from the published GLB against the contract:

- Landing gear contact plane at y = 0.007, so it stands on `padTop` with no per-scene offset.
- Furthest extent 10.80 m from the pad centre against a 12 m pad radius, offset 3.2 m and turned
  −0.42 rad so it reads as parked rather than centred and square.

Scale was judged against a 1.8 m reference figure on a 12 m pad disc before the length was fixed.

The shuttle is scenery. It reads no task or run state, and nothing about it encodes status.

## Not done

- No close-up in-app capture of the shuttle on the terrace. The World view uses fixed framing and
  will not push the camera onto the hub parcel, and the hub is not a project so it has no exterior
  view. Placement above is verified numerically and in an isolated render, not in the running scene
  at close range.
- Texture residency still not re-estimated across both slices.
- The formal production-build performance gate has not been re-run.

---

# Slice 3 — review response

Seven items from Shaun's review of slices 1 and 2.

| # | Item | Change |
| --- | --- | --- |
| 1 | Shuttle too small | 12 m → 18 m nose to tail |
| 2 | Put it on a landing pad | Built one; there is no scanned pad in the Meshy set |
| 3 | Parked too close to a service truck | Hub vehicles moved off the pad and held clear of the hull |
| 4 | Shuttle needs lighting | Emissive pad beacons and strips, plus two warm point lights |
| 5 | Old trees still present, clustered too tightly | Four flat-card slots dropped, two more replaced, spacing raised |
| 6 | Crystals are poor | Three procedural crystals replaced with scans |
| 7 | Robots too large in World | `workerViewScale.world` 2.5 → 2.0 |

## The pad

No scanned landing pad exists in `meshy_output`, so it is built in `build_shuttle.py` in the same
deterministic Blender style as the rest of the colony kit: deck, graphite kerb, ochre ring and
touchdown cross, eight beacon posts and eight edge strips. It ships as a second root (`MF_Pad`) in
`shuttle.glb`, centred on the contract's `spaceport_pad`; the shuttle stands on it at an offset.

Beacon and strip materials use the colony's existing `practical_` naming, and the renderer marks
those `toneMapped = false` so they hold up at dusk. Two point lights carry the light the beacons
imply; the scene's lamp pool is untouched.

## Clustering

The copse density had a real bug. Minimum trunk spacing was 1.6 m, which was fine for the old
flat-card trees but not for scanned canopies spanning 5.3 m to 9.5 m — every cluster interlocked into
a single mass. Spacing is now 4.0 m, cluster size drops from 5–12 to 3–7, and the spread widens from
3–5.5 m to 4.5–7.5 m. Wider spacing rejects more candidate points, so the planting loop gets 16
tries per tree instead of 8; without that, tight parcels stopped carrying a copse at all and
`colony-scatter` caught it.

## Trees dropped

`MF_Tree_Purple_E`, `F`, `G` and `MF_Tree_Olive_A` are removed from the kit rather than refilled. E's
slot height is 9 m and the only unused scan is a coastal shrub, which stretches badly at that size.
Four scanned blossom silhouettes plus the bare evergreen now carry the planting.

## Crystals

`crystal.largeCluster.A`, `crystal_04_shard_formation` and `crystal_03_crystal_boulder` replace the
86–174 triangle procedural shards. They deliberately do **not** use the `crystal_glow` material name:
the runtime repaints anything with that name flat violet, which would discard the scan's own colour.
They carry `crystal_scan_*` names with emission baked from their base colour instead.

## Budgets raised

On Shaun's approval. They live in `validate-colony-assets.mjs`, not `contract.json`: the contract is
frozen and its sha256 is bound into the HQ producer receipt, so editing it to carry a budget breaks
the guard that catches the contract drifting from the geometry it produced. Triangles 200,000;
textures 64.

| Measure | Slice 1 | Now |
| --- | --- | --- |
| Kit bytes | 4.00 MiB | 4.74 MiB |
| Kit triangles | 157,306 | 182,775 |
| Kit images | 40 | 52 |
| Shuttle + pad | 0.89 MiB | 0.95 MiB |

Still below the 5.57 MiB v2 kit.

## Verification note

The shuttle's absence in early World-view captures was my misreading, not a defect: a 4× probe showed
its world bounds spanning 84 m across the terrace, and the pale mass I had read as bare pad was the
oversized hull. At true size it is visible on the terrace but small, as a 18 m object should be at
that framing. Probes were reverted; typecheck, lint, format and 155 Frontier tests pass.

Texture residency and the production performance gate remain unmeasured.

---

# Slice 4 — three water and pad defects

## Waterfall opacity seam

The curtain is sampled down the cliff radial, and each sample was clamped with `y = min(y, last)`.
Where the face juts outward, `face + 0.28` rose above the previous sample, so `y` held flat and the
strip folded into a horizontal sheet part way down. The fall material is `DoubleSide` with
`depthWrite: false`, so that sheet blended against itself and read as the hard-edged opacity step in
the review capture.

Each sample now drops by at least 0.22 m, floored at sea level, with the sample count raised from 10
to 14 so a tall face still resolves smoothly. The curtain can no longer fold.

## Pool perched on rock

Two causes, both fixed:

- The spring took the **highest** of seven candidate points, which put a flat disc of water on top of
  an outcrop. It now takes the third-highest of nine: still a source above the run, on ground that
  sits rather than crowns.
- The second pool sat at 55% along the run. It now sits at the head of the fall, set back by its own
  radius plus 0.6 m so the disc stays on land behind the edge rather than overhanging the face. The
  stream visibly gathers before going over.

## Landing pad flicker on zoom out

The deck is authored with its top face at y=0 and was placed at exactly `terrain.landing.padTop`,
so deck and terrain were coplanar. Coplanar surfaces z-fight, and depth precision coarsens with
distance, which is why it only showed when the world view pulled back. The pad group now sits 7 cm
above `padTop`; the kerb below stays buried in the ground, and the shuttle rides with it.

## Not done

The reeds, grass and scrub in the review captures are still the procedural pieces. Scrub could take
`tree_04_coastal_shrub_small_tree`, but there is no scanned grass or reed in `meshy_output` at all,
so that set cannot be finished from what exists today. Left for the next pass along with the four
remaining hero props and two unused crystal scans.

Typecheck, lint, format pass; 155 Frontier tests pass.

---

# Slice 5 — old cards deleted, snow ground, remaining crystal scans

## Deleted from the kit

`MF_Scrub_Purple_A/B`, `MF_Scrub_Olive_A`, `MF_Grass_A/B` and `MF_Reed_A/B` are removed, along with
the earlier `MF_Tree_Purple_E/F/G` and `MF_Tree_Olive_A`. Their geometry and textures are gone from
the GLB rather than left unreferenced, and their placement rules are gone from `scatter.ts`, so
nothing tries to position an item the kit no longer carries.

There is no scanned grass or reed in `meshy_output`, so this set cannot be refilled from what exists
today. Ground dressing returns when Shaun generates those scans.

## Snow

The terrain shader now lays snow over the existing ground blend. It keys on how squarely a surface
faces the sky, so the flat shoulder reads as a clean white field while the cliff faces stay bare
rock and the island keeps its relief. It thins over paving (spurs, pads, court apron) and stops
short of the splash zone where spray would wash it away, with a low-frequency drift break and a
sparkle term so it is not a flat white.

This also resolves the review note about the world reading busy: the removed flat-card vegetation
and the snow together leave the scanned trees, rock and crystals as the only ground detail.

## Remaining crystal scans

`crystal_01_large_cluster` and `crystal_02_embedded_vein` are added as `MF_Crystal_D` and
`MF_Crystal_E`. These are the first slots with no v2 ancestor, so the builder creates fresh roots and
scales each scan to a stated metre height rather than inheriting one. All five crystal slots are now
scanned.

| Measure | Slice 3 | Now |
| --- | --- | --- |
| Kit bytes | 4.74 MiB | 5.09 MiB |
| Kit triangles | 182,775 | 195,945 |
| Kit images | 52 | 57 |
| Kit items | 29 | 24 |

Still inside the raised 200,000 triangle / 64 texture budgets, and still under the 5.57 MiB v2 kit.

Typecheck, lint, format pass; 155 Frontier tests pass. The vegetation test now asserts scrub, grass
and reeds are never placed, rather than asserting they are.

# Slice 6 — the four hero props

`serviceRover.V2`, `planningHoloTable.V2`, `testingRig.V2` and `cargoBattery.V2` were the four scans
left unintegrated after slice 5. They divide into two different jobs.

## The rover was already a slot

`MF_Vehicle_Rover` has existed in the scatter kit since the 2A pass, at **132 triangles** — a box on
wheels with six cylinders. `scatter.ts` already parks one or two vehicles on each court apron, clear
of the bay doors and the robots' court sockets. So the rover is a substitution in the existing
builder, not new code: same slot, same 1.925 m height, same footprint radius, same seeded layout.

It is decimated to 4,000 rather than the 6–12k the rock slots get. A 2.5 m vehicle is instanced once
per parcel and is never the camera subject, and 4k keeps the kit inside its 200,000 triangle budget
with the rover in it. Its material is named `vehicle_meshy_*`: `rock_*` would have attached the
runtime's wet-rock shader to a painted hull.

## The three interior props ship as their own kit

`hq-shell.glb` carries an `MF_Props` root with no children — the plan always reserved these pieces
and the greybox stood in for them. They are **not** added to the shell, because the shell's producer
receipt is hash-bound: re-exporting it to carry three props would break the guard that catches the
shell drifting from the contract that produced it. They ship as `props-kit.glb` and the runtime
anchors each to the socket the contract already names.

Placement is read off the floor plan rather than invented. `generate_colony_pack.py` specifies the
planning room's equipment as a *"plan holo-table 3.0x2.0 at radial 9 on the 150 deg midline"*,
testing's as a *"diagnostic bench at radial 9"*, and dispatch's as a *"crate stack pad"* with a
1.6 × 1.6 footprint at (-4, 17). Each prop's authored height is chosen so the scan lands on those
numbers:

| Prop | Scan | Height | Footprint | Plan entry it fills |
| --- | --- | --- | --- | --- |
| `MF_Prop_PlanningTable` | planningHoloTable.V2 | 1.05 m | 3.05 × 3.06 | holo-table 3.0x2.0, radial 9 @ 150° |
| `MF_Prop_TestRig` | testingRig.V2 | 1.70 m | 3.51 × 3.20 | diagnostic bench, radial 9 @ 30° |
| `MF_Prop_CargoBattery` | cargoBattery.V2 | 1.06 m | 1.55 × 1.07 | crate stack pad 1.6 × 1.6 |

The inner-row sockets either side of radial 9 face inward at the prop, which is what those socket
pairs were for: `clearStandingPoint` already excludes a robot from standing on the furniture between
them. The props are also registered as `StandingObstacle`s, because the manifest's obstacle list was
authored before they existed.

Emissive parts are renamed into the colony's material conventions — `ambient_screen_service`,
`practical_console_cyan`, `practical_warm_strip` — so `ProofBase` drives them with the same dusk
response as the rest of the interior and the renderer needs no special case. Nothing here reads task
or run state: a prop is fixture, never status.

## Result

| Measure | Slice 5 | Now |
| --- | --- | --- |
| Scatter kit bytes | 5.09 MiB | 5.28 MiB |
| Scatter kit triangles | 195,945 | 199,561 |
| Scatter kit images | 57 | 61 |
| Props kit | — | 0.57 MiB, 16,999 triangles, 12 images |

The scatter kit stays inside its 200,000 triangle / 6 MB / 64 texture budgets. The props kit gets its
own budget in the validator (20,000 triangles, 2.5 MB, 16 textures) and a `props` asset kind with
required groups, so a future build cannot quietly drop one of the three.

Typecheck, lint, format pass; 155 Frontier tests pass. Verified in the running app: the holo table
stands in planning, the rig in testing, the battery on the bay pad, and the scanned rover parks on
the court.

## Not done

The greybox room equipment is still in the shell. It is merged per material into whole-room meshes
(`MF_Interior_planning__console_blue_glass` spans the entire room), so an individual console cannot
be hidden at runtime — removing it means rebuilding `hq-shell.glb`. That is the interior slice, not
this one.

# Slice 7 — the greybox room equipment removed from the shell

Slice 6 put the scanned props in the rooms, but the greybox pieces they replace were still standing
beside them: two consoles in planning, two in testing, a crate and a battery on the same cargo pad.
The interior meshes are merged per material into whole-room objects, so no individual console can be
hidden at runtime. The shell had to be rebuilt.

## Rebuilding was safe

The concern that stopped this in slice 6 was the contract-hash guard. It turns out to point the
other way: `hq-metadata.json` binds the sha256 of `contract.json`, and the contract is untouched
here, so a rebuild regenerates its own asset receipts and the guard stays satisfied. What would have
broken the guard is editing the contract — which is what happened when the scatter budget was first
raised, and why those budgets live in the validator instead.

## What was removed

`build_hq.py`'s `equipment()` authors all the room fixtures. The v1 producer directory is read-only
history, so `build_hq_v2.py` now calls `equipment_v2()`, which runs the shared recipe and then strips
the pieces the scans stand in for, by name:

| Removed | Replaced by |
| --- | --- |
| `planning_table`, `planning_table_surface` | `MF_Prop_PlanningTable` |
| `testing_table`, `testing_table_surface`, `testing_diagnostic_rig`, `testing_sensor_collar` | `MF_Prop_TestRig` |
| `cargo_crate`, `cargo_retaining_band`, `cargo_lid` | `MF_Prop_CargoBattery` |

Stripping after the recipe rather than forking it keeps one source of truth for everything that
stays, and means a future scan is added by name instead of by re-copying fifty lines. The obstacle
entries `planning_central_equipment`, `testing_central_equipment` and `cargo_crates` go with them,
because `prop-placement.ts` now publishes the scanned footprints and leaving the old boxes would keep
robots out of floor with nothing standing on it. The build asserts that it removed something and that
it dropped exactly three obstacles, so a rename upstream fails the build rather than silently leaving
the greybox in.

**Kept, because no scan exists for them yet:** the wall consoles in all four rooms, the review dais,
the implementation fabrication bench, the briefing Q&A console and the dispatch cart.

## A drift the removal exposed

The plan specifies the planning holo-table and the testing bench "at radial 9". The greybox authored
both at `radial(phi, 10.7)`. The scans are placed at radial 9, per the plan, which is also where the
inner-row sockets straddle the midline — so the props now sit between the two sockets that face them,
which is what those socket pairs were always for. The greybox was the thing that had drifted.

`room-clearance.ts` still carries a 2.2 m exclusion around the review dais at radial 9 while the dais
itself is built at 10.7. That is the same drift, on a piece this slice keeps, so it is left alone.

## Result

| Measure | Before | After |
| --- | --- | --- |
| `hq-shell.glb` | 6,806,112 B | 6,746,264 B |
| Triangles | — | 125,936 |
| Obstacles | 28 | 25 |

Inside the 8 MB / 150,000 triangle `hqShell` budget. The producer's own independent re-import
validator passes **191 checks**. Typecheck, lint, format pass; 155 Frontier tests pass.

Verified in the running app at noon and at dusk: planning holds the scanned holo-table alone, testing
the scanned rig alone, and the wall consoles, review dais and fabrication bench are undisturbed.

# Slice 9 — the wall row, the briefing desk and the review dais

Five scans arrived in `latest-mesh/meshy_output`, one for each greybox piece slice 7 listed as
"kept, because no scan exists for them yet". Three of them shipped. Two of them are unusable.

## Two of the five scans are blobs

`MF_Prop_FabCell` and `MF_Prop_ServiceCart` have crisp Meshy preview thumbnails and a mesh that is a
melted lump behind them — the cart has no wheels and no drawer edges, the fab cell is not
recognisable as a machine. Ruled out in turn, each by rebuilding and re-rendering:

| Suspected | Test | Result |
| --- | --- | --- |
| Decimation | rebuilt with targets above source, 0 triangles removed | unchanged |
| Draco | rebuilt with `export_draco_mesh_compression_enable=False` | unchanged |
| Metalness | forced `metallicFactor` to 0 | unchanged |
| Normal map | unlinked the normal input, then roughness too | unchanged |
| Texture resolution | swapped the embedded 1024 atlas for Meshy's own 4096 `texture_urls` PNG | unchanged |
| Geometry | rendered untextured in Workbench | **the lump is the mesh** |

The shipped scans are the control: `planningHoloTable.V2` is 114,091 source triangles and renders
crisp in the same probe. These five are 4,832–5,767 triangles *at source*. The earlier batch was
generated high-poly and decimated here; this batch came back already low-poly, and there is nothing
left to decimate from. Regenerating them is a Meshy job, not a pipeline job.

The implementation fabrication bench and the dispatch cart therefore stay greybox.

## Two builder bugs the new scans exposed

**Dequantization was being thrown away.** The later Meshy exports use `KHR_mesh_quantization`, which
carries its scale on the nodes above the mesh. `o.parent = None` drops that, and the height fit then
*overwrote* `o.scale` rather than multiplying into it — so the first build produced props 16,000 m
across and reported it as a size. The unparent now keeps the world matrix and bakes it, which leaves
`o.scale` at 1, which is what the fit assumes. The three shipped props are unaffected: their scans
are not quantized, so their scale was already 1.

**`is` never matches a Blender socket.** The metalness override looked like it worked and changed
nothing — `bsdf.inputs['Metallic']` hands back a fresh wrapper on every access, so
`link.to_socket is bsdf.inputs['Metallic']` is always false and the link survived the removal. The
tell was a byte-identical GLB. Matched by node and socket name instead.

## What the scans replace

| Scan | Contract `equipment` line | Greybox removed |
| --- | --- | --- |
| `MF_Prop_WallConsole` ×20 | "wall consoles behind the wall row" | `{room}_console_base/_console_top/_monitor_housing/_monitor/_console_key/_instrument_trace` in planning, implementation ×2, review, testing |
| `MF_Prop_IntakeDesk` | "Q&A console on the front wall" + "scout display" | `briefing_qa_console`, `_scout_display`, `_scout_panel`, `_console_control` |
| `MF_Prop_ReviewStation` | "circular review dais radius 1.6 at radial 9" | `review_dais`, `review_dais_light` |

Heights are solved backwards from the greybox each scan replaces, because the scan's aspect is fixed
and it is the *width* that has to keep the plan's spacing: the wall console at 2.75 m is 1.83 m wide
against the greybox's 1.86 m on a 3.4 m pitch; the intake desk at 2.40 m is 2.66 m wide, which is the
greybox scout display exactly; the review station at 1.36 m is 3.21 m across, which is the contract's
"radius 1.6".

The five keep their 1024 px textures where the first three were halved to 512. They are not the same
kind of map — Meshy tiles them 16× through `KHR_texture_transform`, so a 1024 atlas is already only
64 px per tile and halving it would show — and they are webp to begin with, at ~330 KB each.

## One node, twenty places

`PropPlacement.node` was the key, and the runtime moved the single kit object it named. The wall row
is one console standing in twenty places, so placements now carry their own `id` and `ColonyProps`
clones per placement rather than per node. The clones share the kit's geometry and material by
reference, so this is twenty transforms, not twenty meshes.

That change also fixed a latent bug: the unmount effect disposed the geometry under every clone,
which is the *kit's* geometry, shared across every base. Closing one base would have blanked the
props in every other one still on screen. Only the cloned materials belong to a base.

## Obstacles follow the prop, not its longest side

`propObstacles` squared each prop off on its largest dimension. That is fine for a holo-table and
far too greedy for a wall console, which is 1.83 m across and 0.72 m deep: squaring it reserves a
metre of floor behind the wall row that nothing stands on. The box is now the axis-aligned bound of
the prop's *rotated* plan size.

## A drift closed, and a socket recovered

`room-clearance.ts` already reserved 2.2 m at **radial 9** on the 330 midline for the review dais
while the greybox built it at 10.7 — recorded in slice 7 as a known drift, left alone because the
dais was still greybox. The scan goes where the plan says, so the drift is closed.

The briefing desk did *not* go on the greybox console's centre. Briefing is a wedge that narrows
toward the hub, and a 2.66 m desk on that centre puts its front corner through the partition — which
the first build did, visibly, in the app. Shifted right and back to `(-5.6, 14.4)`, where every
corner is inside the room's walkable polygon and **both** briefing sockets clear the footprint by the
0.6 m the clearance test wants. The greybox obstacle swallows `hq_briefing_02`; this does not.

## Tests

`tests/frontier/colony-props.test.mjs` is new — prop placement had no coverage at all, which is why
a desk through a wall had to be caught by eye. Seven tests: every placement names a root the built
kit carries *at the size the receipt states* (so a rebuild that resizes a prop fails here rather than
leaving robots standing inside it), ids are unique, the wall row keeps radial 15 and the 3.4 m pitch
and faces the room, no prop corner leaves the parapet (bay props are held to their frozen pad
instead), the intake desk clears all three briefing sockets, the only sockets any prop blocks are the
equipment sockets their own room's plan reserves, and the review station sits on the contract's own
reservation.

## Result

| Measure | Before | After |
| --- | --- | --- |
| `props-kit.glb` | 595,356 B / 16,999 tris / 12 images | 1,822,920 B / 24,997 tris / 24 images |
| `hq-shell.glb` | 7,058,852 B / 125,936 tris | 6,007,092 B / 108,404 tris |
| Shell obstacles | 25 | 0 greybox equipment obstacles left in the four wall rooms |
| Props standing per HQ | 3 | 25 |

Greybox removed from the shell: **222 meshes, 25 obstacles**. The props kit is inside its per-prop
budget (6 props × 8,000 tris / 350 KB / 5 textures). The producer's own independent re-import
validator passes **191 checks**. Typecheck, lint and format pass; **140 Frontier tests** and 535
repo tests pass.

Verified in the running app at noon and at dusk: the wall row stands in planning, implementation,
review and testing; the review station sits at radial 9 between the two sockets that face it; the
intake desk stands inside briefing with its screen band lit at dusk. Implementation still shows the
greybox fabrication bench and dispatch the greybox cart, which is what the two failed scans cost.

## Not done

- `MF_Prop_FabCell` and `MF_Prop_ServiceCart` need regenerating high-poly before the implementation
  bench and the dispatch cart can be replaced.
- Five superseded published GLBs predate this slice and are still tracked
  (`hq-shell.4b47f1786639`, four `crown-*`). Not this slice's to prune.
