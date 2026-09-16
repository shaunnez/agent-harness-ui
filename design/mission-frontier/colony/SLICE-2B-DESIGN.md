# Slice 2B design — interiors worth looking at, colour that reaches the lights, a cutaway that fills the screen

17 September 2026. Proposal for Shaun's approval before any build. Builds on slice 2A (PR #92: flag gate, four crowns, living islands, robot scale, crowded cards). Goal: the cutaway stops being the weakest view. Every room reads as a place with its own job, the palette a project picks shows in its lights and not only its trim, and the interior uses the screen instead of a patch in the middle of it.

What the capture shows today (`build-evidence/COLONY-SLICE-2A/step2-after-cutaway-1568x1003.png`): the hex fills about 60 % of the frame height with empty meadow around it; six rooms share one grey floor and one console model; room names float as pills; the interior is lit flat. Contract equipment exists for four items only (review dais, testing rigs, fabrication bench, floor inlays), and the inlays are all one material.

## 0. Palette-driven lighting (first, half a day, runtime only)

**What you get.** Pick red in the Appearance panel and the island glows red at night: the HQ's practical lamps, the lantern caps on the ring road and the pad lights take the palette colour. In the World view at hour 23 you can tell projects apart by colour before you can read a label. Interior warm strips stay warm so the cutaway does not turn monochrome.

**How.** Today `basePalettes[palette].color` reaches only `identity_*` materials (colour + emissive) in `ProofBase.tsx`. Extend:

- `PooledLamp` gains `color`; the base's `hqLightPositions` lamps and its lantern lamps carry the palette colour; the `LampPool` slot lerps colour with level. Eight lights, no new light types, no shader recompiles.
- Scatter lantern caps use `InstancedMesh.instanceColor` (per-parcel colour, one draw call still).
- Window glass (`practical_warm_window_glass`) blends 35 % toward the palette at night, 0 % by day, so windows still read as warm interiors with a colour cast.
- Robot rings **stay status-coloured**; nothing that encodes task state changes.

**Test.** Palette → lamp colour table; night captures of the four palettes at both sizes; day captures unchanged (pixel diff against 2A day captures below 0.5 %).

## 1. Cutaway that fills the frame (second, one day)

**What you get.** In the cutaway the hex, bay and court fill about 80 % of the frame height at 1568 × 1003 and 1280 × 720, with the base label still under the top HUD and the bay above the bottom HUD. Same azimuth and 40° elevation, so nothing about how the cutaway feels changes; it is closer.

**How.** The contract cutaway camera (`verticalSpan 40`, target `(0, 4.3, −1)`) stays frozen. The runtime applies a cutaway fit: project the shell footprint (eaves r 17.1, bay to z 21.6, court to z 27) into the HUD-safe content box for the current viewport and choose the span, the same rule the World view already uses for parcels. Expected span about 31 at 1568 × 1003, 34 at 1280 × 720. `hudSafeInsets` for both sizes are measured from the live DOM (`.panel`, `.attention-stack`, `.world-clock`, `.proof-actions`), not hard-coded.

**Card density follows.** Closer camera means bigger sockets on screen, so the crowded-room rule (more than four cards → dot markers) is re-measured; the expectation is that Implementation with twelve robots still collapses and the six-socket rooms no longer need to.

**Not changed.** Exterior and World cameras, contract file, minimap.

## 2. Screen real estate in the cutaway HUD (third, one day, HUD touch — decision 2 below)

**What you get.** The bottom-right 2 × 2 action grid (New task / Agent roster / Skills / Settings, about 340 × 230 px) collapses to a 56 px icon rail on the right edge with tooltips, only while the 3D view is showing. The freed bottom-right corner and the empty left side are used for a **room roster**: six rows (room name, robot count, attention count) that highlight the room under the cursor and click-to-focus the camera on that room. Data already exists in `compactWorkerLabels` and `roomForTask`; nothing new is computed.

**Why it belongs here.** The cutaway fit in step 1 is bounded by the HUD-safe box; the action grid is the largest single inset. Shrinking it is worth about 8 % more frame for the building.

**Not changed.** 2D world, Tasks, Manage, the Needs-you panel, the selection HUD content, keyboard shortcuts.

## 3. Rooms that read as rooms (fourth, producer three days, runtime one day)

One interior serves all four crowns; everything below goes into `hq-shell.glb`. Equipment follows the frozen contract's per-room equipment list, which is already the specification.

| Room | Floor inlay | Wall treatment | Equipment (contract) | Practical light |
| --- | --- | --- | --- | --- |
| **Briefing** | pale ceramic with a dark threshold band at the court door | Q&A console wall with three tall screens, scout display | Q&A console, scout display, court door frame | cool cyan console strip |
| **Planning** | dark graphite with an ochre centre ring under the table | pinboard wall band, wall consoles behind the wall row | plan holo-table 3.0 × 2.0 at radial 9, holo volume (ambient_screen) | warm strip over the table |
| **Implementation** | worn basalt with two ochre service-route strips and floor markings | tool racks on both outer walls, rear service door on the 270 flat | fabrication bench (exists) plus two module crates, overhead gantry beam | warm strips along the racks, one cyan bench light |
| **Review** | brushed-titanium disc under the dais, dark floor around | review wall screens (three wide panels) | dais (exists) with seat ring, lectern | dais ring (exists) plus screen glow |
| **Testing** | grid-marked concrete with a caution border | test rigs against the outer wall with cable trays | rigs (exists) plus diagnostic bench at radial 9, rig status lamps (ambient, never status) | cyan bench light |
| **Dispatch** | painted bay markings, crate pad and cart pad outlines | bay shutters, marshalling chevrons | crate stack, cart, delivery beacon (exists as practical) | delivery beacon plus bay flood |

Plus, for all rooms: a **painted room name on the floor** at the hub-door threshold (baked, neutral text, one shared alpha texture), skirting and wall bands in `structure_graphite_joints`, ceiling-clear practicals as emissive strips, and an AO bake into `COLOR_0` like the parcels so corners darken.

**Runtime.** Floating room-name pills are removed in the cutaway when the painted names are visible (they stay in Exterior and World where the roof hides the floor). Robots keep their sockets; the two new obstacles (gantry crates, lectern) are declared as `MF_Obstacle_*` empties so `room-clearance.ts` picks them up with no code change.

**Budgets.** Shell ≤ 8 MB / ≤ 90k triangles (contract allows 15 MB / 150k; 8 MB keeps the colony set ≤ 25 MB with 2A's 18.34 MB). Textures: the existing library plus one 1024² floor-name alpha and one 2048² floor-marking atlas, eight total. Producer validator extended: every room has an inlay with its own material, a painted name, at least one practical, and no equipment inside a socket's 0.9 m clearance.

## 4. Polish that comes with it (sure things only)

- Night cutaway: practicals already pulse; with per-room practicals and AO the interior reads lit-from-within.
- Watch view inherits the closer camera (it is the cutaway camera plus follow).
- The four crown previews are re-rendered only if the shell silhouette changes (it should not).

## Candidates for 2C (not in this slice unless pulled in)

Ranked by payoff per day, from the 17 September review:

1. Crystals and rock formations on the shoulder and lip, emissive and palette-tinted, seeded like the trees (one day).
2. Shoulder relief: seeded vertex offsets on the 34–42 m shoulder at load, so islands have different silhouettes (one day plus validator).
3. Two more tree species and a bare variant in the scatter kit (half a day).
4. Rovers driving the spurs on a loop, ambience only (one to two days, needs a path system).
5. Water as a seeded per-parcel option: stream and pool from the cut variant B (two days).

## Not in this slice

Interiors for anything other than the six rooms and bay, arrivals and shuttle, Goal 6, live adoption, robot travel between parcels, any change to task or attention semantics, 2D world, the legacy archipelago.

## Decisions needed

1. **Palette reach.** Proposal: HQ lamps, lantern caps, pad lights and a 35 % window cast take the palette; robot rings and interior warm strips do not. Alternative: everything including interior strips (cheaper to read, worse cutaway).
2. **HUD touch.** Step 2 changes the bottom-right action grid to an icon rail while the 3D view is showing, and adds a room roster. This is the first HUD change in the colony work. Alternative: skip step 2, accept about 70 % frame fill instead of 80 %.
3. **Cutaway fit lives in the runtime**, the contract camera stays frozen at 1.0.1. Alternative: contract 1.0.2 with the new span baked in (needs the contract owner).
4. **Painted floor names replace floating pills in the cutaway only.** Alternative: keep both.
5. **Shell budget 8 MB** for this slice, below the contract's 15 MB, to hold the 25 MB colony total. Alternative: raise the colony total to 30 MB.
6. **Order:** 0 palette lighting, 1 cutaway fit, 2 HUD rail and roster, 3 interiors, then acceptance. Palette lighting first because it is half a day and visible in every view.

## Acceptance (evidence into `build-evidence/COLONY-SLICE-2B/`)

1. Four palettes at night: HQ lamps, lantern caps and windows carry the palette on World and Exterior at both sizes; day captures within 0.5 % of 2A's; robot ring colours unchanged (test).
2. Cutaway at 1568 × 1003 and 1280 × 720: shell plus bay plus court occupy ≥ 78 % of frame height, base label clear of the top HUD, bay clear of the bottom HUD, minimap and Needs-you untouched (measured from DOM rects).
3. Fourteen-task cutaway at 1280 × 720: every card clickable, zero overlaps, zero over panels (re-run of 2A criterion 6 with the closer camera).
4. Each of the six rooms has a distinct floor material, a painted name, room-specific equipment and at least one practical; robots reach every socket with the new obstacles present (room-clearance test); no equipment inside a socket clearance (producer validator).
5. Room roster shows six rows with counts that match the fixture; clicking a row focuses the camera on that room; the action rail exposes the same four actions with the same shortcuts.
6. Shell ≤ 8 MB / 90k triangles; colony set ≤ 25 MB reported; existing 148 Frontier tests plus new lamp-colour, cutaway-fit, roster and clearance tests pass; typecheck, lint, format, build.
7. Day and night cutaway captures for all four crowns at both sizes.

## Estimate (working days)

| Role | Work | Days |
| --- | --- | --- |
| Runtime | palette lamps and instance colours, cutaway fit, action rail and roster, pill removal, tests | 3 |
| Producer | six room interiors, painted names, practicals, AO bake, validator rules | 3 |
| Lead | integration, captures at both sizes day and night, acceptance | 1 |

About five calendar days with runtime and producer in parallel; steps 0 to 2 are visible after day two.
