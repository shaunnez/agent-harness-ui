# Delivery slice proposal — reuse, new art, backend, Goal 6, acceptance

16 September 2026. Proposal for review; the build starts only on Shaun's request. Assignments are prepared here so two workstreams can begin the day the contract is approved.

## Reuse (no new production)

| Existing item | Reuse |
| --- | --- |
| `worker.glb` (hash aee069a9823b) with `worker_tool_work` | unchanged; runtime scale 3.1 m |
| `MF_Bridge` components in `exterior-bases/astra-kit/environment.blend` | deck panels, structural deck, piers, bearings, guardrail posts and rails, safety edge, bollards and caps become the 27 m span and the end asset |
| Material library and CC0 sources (Poly Haven cliffs, Quaternius planting) | same names, same provenance records |
| Crown components of Command, Relay, Foundry | re-seated on the hex shell; identity disc and ring unchanged |
| Props: crates (2 m), cart (1.35), consoles, bench, bollards, wall computers, sensors | dispatch bay, court, rooms |
| Runtime: `ProofWorld/Scene/Base/Camera/Labels/Worker`, appearance persistence, motion and connection gates, ray picking, minimap capture, shoreline water, day/night, label separation, `integrate-3d-proof.mjs` validation, 103 Frontier tests | extended, not replaced |
| Semantics: `worker-behavior.ts`, `presentation.ts` attention, task/run/package identity, Watch active/historical rules | untouched authority |

## New art genuinely required

| Item | Owner | Why it cannot be reused |
| --- | --- | --- |
| Hex HQ shell, hub, partitions, bay, doors, room equipment for six rooms | asset producer | the current shell is a 27 × 22 twin-bay plan with two work areas |
| Three crowns re-seated on the hex | asset producer | roofs are fitted to the old plan |
| Bridge span 27 m and end asset | asset producer | current bridge is one fixed 24 m base-to-landing piece |
| Parcel tiles hub, A, B, C with pads, spurs, ring road | terrain builder | the current island has no sockets, overlaps from project 4 and has the diagnosed rim gaps |
| Crystal scenery, richer materials (optional stretch) | terrain builder | listed by Shaun as ideas to develop; not needed for acceptance |

## Backend work

None for the slice. It stays fixture-only. For later live adoption the list is unchanged from the exterior handoff plus one item: persist project appearance **and colony slot** per project (backend project setting or per-user preference; decision pending), expose `createdAt` ordering (already available), keep archived flag semantics. No new transport is needed; task `currentStage` and status already drive room placement.

## Goal 6 (UB2 / U6) dependencies

- U6 stage-advance journeys need room anchors and door segments: this contract supplies `hq.rooms`, `hq.doors` and `movement`, so U6 can target the new rooms without a second design pass.
- The arrival sequence Shaun described (recorded task creation → shuttle at the hub pad → robot journey over the bridges to its project) needs: a recorded task-created observation (not in the current U6 event list, add it explicitly), the bridge route graph from `movement` (pad → spur → ring road → court → bay → hub → room), and the hub pad socket. Execution stays independent of animation timing; the sequence is feedback for a persisted fact.
- UB2 (incremental activity events) is not needed for layout or occupancy; it is needed only for tool-level feedback inside rooms.
- Reconcile before Goal 6 starts: U6's "journey between known room anchors" must use the hex rooms, not the old two areas; historical, waiting and blocked workers stay parked at their sockets.

## Slice 1 — one representative project journey in the colony

**Scope in**

1. Terrain: hub parcel plus parcel A, the 27 m span and end asset; all occupied slots use parcel A until B and C exist.
2. HQ: hex shell, hub, six rooms with equipment set v1, Command crown; Relay and Foundry crowns follow in slice 2 unless the producer finishes early.
3. Runtime: slot placement from the contract, stage-to-room mapping, socket allocation and overflow order (up to the court; the overflow lane waits for approval), cutaway groups, exterior/cutaway/world cameras, labels, minimap, bridge and spur visibility by occupancy, manifest v3 and validator extensions, tests.
4. Browser acceptance at 1568 × 1003 and 1280 × 720 with the 3-project workflow fixture, the 10-project stress fixture (rings 1 and 2 with hidden spurs) and one fixture project carrying 14 open tasks with parallel packages.

**Scope out**: shuttle and arrivals, Goal 6 events, live adoption and backend persistence, crystals, parcel variants B and C, robot travel between parcels, placement editor, upgrades, economy.

**Acceptance criteria** (each needs evidence in `build-evidence/COLONY-SLICE-1/`)

1. Three fixture projects appear at P1, P2, P3 around the hub with three bridges; reloading and reordering projects never moves a base.
2. Ten projects fill P1 to P10 with the bridge table from the colony plan; no parcel overlaps another; unconnected spurs and pads are hidden.
3. Every HQ shows six labelled rooms in the cutaway; each open task's robot stands in the room mapped from its stage; attention markers stay with the robot; no robot intersects a wall, bench, cargo pad or another robot (min 3.3 m).
4. A 14-task project with parallel packages fills implementation, then the hub overflow, then the court, with every robot pickable from both the DOM list and the 3D scene; no task is dropped.
5. Exterior → cutaway → Watch → exterior keeps project and task identity; Watch shows active versus historical correctly; motion-off freezes all sampled regions.
6. Ray-cast validator passes on parcel A and the hub (no see-through cells, upward winding); no visible cavities at the rim in browser captures at both sizes.
7. World, exterior and cutaway cameras match the contract; base labels clear the Needs-you panel and the dock at both sizes.
8. Command crown tints correctly in all four palettes; appearance choices persist and remain project-scoped.
9. Load: colony assets fetched at three projects ≤ 60 MB, at ten projects ≤ 120 MB (shared geometry instanced); no frame-time regression campaign is required, but obvious stalls are fixed.
10. 103 existing Frontier tests plus new placement, allocation, manifest v3 and validator tests pass; typecheck, lint, formatting, main build, Sites tests and Frontier build pass sequentially.

**Estimates** (working days, one person each, starting after approval): terrain builder 5 for hub + parcel A + metadata; asset producer 8 for shell, rooms, Command crown, bridge; runtime builder 6, of which 3 can run against contract-generated grey boxes before real assets land; lead integration and browser acceptance 3. Slice 2 (Relay and Foundry crowns, parcels B and C, crystals) about 6 producer/terrain days.

## Assignments prepared (not launched)

| Role | Worktree and ownership | Inputs | Output |
| --- | --- | --- | --- |
| Asset producer | new staging dir `assets/staging/colony-hq-v1/producer/**` only | contract.json, this pack, original World/HQ/Watch images, current EXTERIOR-BASES captures, `exterior-bases/astra-kit/*.blend` read-only | GLBs, metadata, blends, scripts, previews, provenance |
| Terrain builder | `assets/staging/colony-hq-v1/terrain/**` only | contract.json, TERRAIN-HOLES.md, original World image, Poly Haven / Quaternius sources | parcel GLBs, metadata, blends, scripts, provenance |
| UI / runtime builder | separate branch from the same checkpoint; files assigned by the lead inside `src/frontier/world-3d/`, `scripts/frontier/`, `tests/frontier/`, `public/frontier/assets/3d-proof/` | contract.json, grey-box placeholders | placement, rooms, allocation, cameras, manifest v3, tests |
| Lead | shared contract, integration, browser acceptance, journal | everything | acceptance matrix, handoff |

Concurrency note for today: two other agents are editing `src/frontier/world-3d/`. The runtime builder assignment must be rebased on their merged result; this design pack does not touch that directory.

## Risks and open decisions for Shaun

1. Overflow lane and "+N" room labels: approve, or keep the court as the only overflow.
2. Hub parcel shown from day one with an empty landing pad, or hidden until the shuttle exists (recommended: shown; it anchors the three-project composition).
3. Cutaway elevation 40 degrees for HQ only, while World and exterior stay at 28.4 (recommended; needed for room readability).
4. Colony slot persistence location for live mode (browser-local now, backend later).
