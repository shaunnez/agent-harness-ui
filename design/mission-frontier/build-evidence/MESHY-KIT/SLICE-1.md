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
