# Hexagonal HQ — floor plan, clearances, cutaway and occupancy

16 September 2026. Design deliverable for review. Coordinates are parcel-local metres, glTF axes (X right, Y up, +Z front toward the camera and the court). Drawn in [hq-floor-plan.svg](hq-floor-plan.svg) and [hq-cutaway-composition.svg](hq-cutaway-composition.svg); numbers frozen in [contract.json](../assets/staging/colony-hq-v1/contract.json).

Authority: the accepted brief. Hexagonal footprint, central circulation hub, fixed rooms briefing, planning, implementation, review, testing and dispatch, implementation largest, identical plan for every project, busier rooms gain robots without changing the plan, three exterior identities preserved.

## Footprint

| Element | Value |
| --- | --- |
| Hex corner radius | 18.0 m (36.0 m corner to corner, 31.18 m flat to flat) |
| Flats face | 30, 90 (front), 150, 210, 270 (rear), 330 degrees |
| Outer wall | 0.6 m; partitions 0.3 m |
| Hub | hexagon, corner radius 6.0 m, six 0.6 m columns, 1.1 m parapets, central table r 1.5 m, one 2.4 m door per flat |
| Dispatch bay | projects from the front flat, outer 10.8 × 6.0 m (x −5.4..5.4, z 15.59..21.6), roof top 8.30 |
| Court | 36 m wide from the front flat to the ring road (z 15.59..27.5), paving 4.25 |
| Levels | ground 4.00, court 4.25, floor 4.30, clear ceiling 9.10, parapet 9.60, crown envelope ≤ 18.50, base label 19.50 |

The lead's decision on the seventh space: with six sectors, a hub and a double-width implementation there is no sector left for dispatch, so dispatch is a projecting front bay plus a 4 m corridor through the front sector. The alternative (splitting the front sector into dispatch and briefing halves) failed the loading-door and cargo clearances at the narrow hub end and was rejected.

## Rooms

Sectors are the triangles between corner radials; areas exclude the hub and walls.

| Room | Sector (flat) | Corner radials | Area | Sockets | Fixed equipment | Runtime stages |
| --- | --- | --- | --- | --- | --- | --- |
| Briefing | 90, left of x −2.3 | 60–120 | ≈ 42 m² | 3 | Q&A console, scout display, court door at x −6 | triage, scouts, grill |
| Dispatch | 90, right of x 2.3 + corridor + bay | 60–120 | ≈ 42 + 40 + 58 m² | 4 + 2 cargo pads | loading bay, crate pad, cart pad, delivery beacon | delivered, awaiting PR merge, completed but still shown |
| Planning | 150 | 120–180 | ≈ 108 m² | 6 | plan holo-table 3 × 2 at radial 9, wall consoles | specification, plan |
| Implementation | 210 + 270 (partition removed) | 180–300 | ≈ 220 m² | 12 | fabrication bench 6 × 1.6 on the 240 radial, tool racks, rear service door | implement |
| Review | 330 | 300–0 | ≈ 108 m² | 6 | wall screens, review dais r 1.6 at radial 9 | dev-review, final-review, approval |
| Testing | 30 | 0–60 | ≈ 108 m² | 6 | test rigs, diagnostic bench | test |
| Hub | centre | — | ≈ 78 m² | 6 overflow | table, columns, parapets | circulation; idle robots pass through |
| Court | outside | — | ≈ 400 m² | 10 | crates, cart, bollards, practical strips | idle roaming loop, overflow |

Socket geometry (all at floor 4.30): wall row at radial 13.4 with tangential offsets −5.1, −1.7, +1.7, +5.1 (3.4 m pitch), facing the wall; inner row at radial 9.0 with offsets ±2.0, facing the bench or table. Every socket keeps a 2.4 m lane free along the sector midline from the hub door to radial 9. Exact coordinates and facings are in the contract under `hq.rooms[*].sockets`.

Stage to room mapping replaces the current three-area mapping (`implement`/`review`/`answer`). Attention state does not move a robot: a task that needs an answer at grill stays in briefing with its attention marker; a repair-required task stays at its review socket, parked.

## Doors and clearances

| Door | Where | Width × clear height | Serves |
| --- | --- | --- | --- |
| door_hub_30 … door_hub_330 | centred on each hub flat, radius 5.2 | 2.4 × 3.8 | each room (210 and 270 both open into implementation) |
| door_front_bay | front flat, x 0 | 4.0 × 3.8 | corridor to bay |
| door_bay_court | bay front, z 21.6, x 0 | 4.0 × 4.0 | bay to court (cart and crates) |
| door_briefing_court | front flat, x −6 | 2.4 × 3.8 | arrivals to briefing |
| door_service_rear | rear flat (270), x 0 | 4.0 × 4.0 | implementation to rear yard |

Clearance rules: robot 3.1 m tall and about 1.2 m wide; minimum centre spacing 3.3 m (existing runtime rule); every lane at least 2.4 m; robots stay 0.6 m off walls, fixtures and cargo; hub ring between the table and the parapets is 3.4 m clear so two robots pass. The corridor is 4.0 m clear so a cart and a robot pass. Partitions are 1.2 m solid with glazed uppers so the plan stays readable in the cutaway.

## Routes

- Arrival template: pad → spur → ring road → court front edge (0, 27.5) → bay door → corridor → hub → room door → socket.
- Idle court loop (existing behaviour, translated): (−12, 24), (−4, 26.5), (4, 26.5), (12, 24) at y 4.25.
- Ring road loop at radius 30 for later parcel-scale ambient movement.
- Movement polygons for every space, the door segments and the bridge deck are listed under `movement` in the contract.

## Occupancy proposal

Typical load is under ten tasks per project, but parallel packages mean several robots per task, and larger workloads must work. Capacity before any crowd treatment: briefing 3, planning 6, implementation 12, review 6, testing 6, dispatch 4, hub 6, court 10 = **53 positions**.

Allocation order per room: primary sockets in listed order (wall row, then bench row) → the two hub overflow positions flanking that room's door → court sockets. Robots of one task's packages take adjacent sockets in the same room and share one task label with an "×N packages" suffix, so task count never masquerades as worker capacity.

Beyond that, the **overflow lane** is a proposal that needs Shaun's approval before build: a straight line of standing positions at 1.6 m pitch along the room's inner partition, 0.8 m off the wall, every robot still pickable, and the room label gains "+N". Nothing is dropped, no active worker becomes a queue graphic, and parked, blocked and historical workers stay parked at their own sockets. If the overflow lane is not wanted, the fallback is the court, which already holds ten.

## Cutaway composition

- Hidden in the cutaway: `MF_Roof` (including the crown variant) and `MF_ShellCutaway`, whose children are the outer walls of the two camera-facing flats (30 and 90), the bay's front and right walls, and all glazed partition uppers above 1.2 m. The hub has no upper wall, so it always reads.
- Cutaway camera: orthographic, same azimuth as the exterior, **40 degree elevation**, target (0, 4.3, −1), offset (32.2, 45.0, 42.9), vertical span 40 m. At 40 degrees a 1.2 m partition hides 1.4 m of floor behind it and the 4.8 m rear walls hide 5.7 m, which the rear rooms absorb because their sockets sit 1.6 m off the wall and face it. At the existing 31 degree cutaway camera the same partition would hide 2.0 m and the rear wall 8.0 m, which is why the elevation changes for HQ only.
- Exterior camera: target (0, 4.3, 6), offset (51, 46, 68), vertical span 58, elevation 28.4 degrees, unchanged azimuth so World, exterior and cutaway describe one place.
- Watch (agent view) uses the cutaway camera and then follows the watched robot at its socket; the right-hand Watch panel is accounted for by the existing 65 px view offset.
- Screen framing at 1280 × 800 is drawn on the right of the cutaway composition sheet with the HUD-safe zones: the hex spans about 570 px, the bay and court fall below centre, the base label stays under the top HUD.

## Crowns and identity

One shared shell, three roof variants that attach to the same hex: Command keeps the segmented circular crown over the hub drum with two curved bays over the 30 and 150 flats; Relay keeps the stepped tower and dish at the 330 corner with a lower wing over review; Foundry runs its barrel vault along the implementation double sector with rear silos and vents. All carry the identity disc and ring on the hub crown; `identity_*` materials stay neutral in source and are tinted at runtime. The envelope is nothing above y 18.5, nothing outside the hex plus 1.5 m eaves, nothing over the bay except its own roof.

## What changes from the current kit

- Two work areas become six rooms plus a hub; the court widens from 27 m to 36 m and gains a bay.
- Socket names change from `court_*` / `interior_*` to `hq_<room>_NN`, `hq_hub_NN`, `court_*`; the manifest parser needs a version 3 schema.
- The building GLB splits into one shared shell plus three crown files, so eight bases download one shell instead of eight full buildings.
