#!/usr/bin/env python3
"""Generate Contract 2.0 for the Mission Frontier colony from one set of numbers.

Run from the repository root:
  python3 design/mission-frontier/colony/source/generate_colony_v2.py
Writes design/mission-frontier/assets/staging/colony-v2/contract.json.

Contract 1.0.1 (colony-hq-v1) stays on disk untouched as the record of the rejected direction
(circular parcel, ring road, literal hex shell). 2.0 keeps what still holds — slot ids and fill
order, the ground basis, the HQ floor plan, rooms, sockets, movement polygons, materials rules,
robot metrics and the 27 m bridge — and replaces the land, the shell envelope and the cameras.
Design tooling only; no application code.
"""
import json, math, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
V1 = os.path.join(ROOT, "design/mission-frontier/assets/staging/colony-hq-v1/contract.json")
OUT = os.path.join(ROOT, "design/mission-frontier/assets/staging/colony-v2/contract.json")

# ---------------------------------------------------------------- lattice (retained shape, tighter pitch)
D = 90.0                       # cell pitch (m); 1.0.1 used 108
U = (0.8, -0.6)                # colony ground axis u = screen-right on the ground (world x,z)
V = (-0.6, -0.8)               # colony ground axis v = screen-up / away from camera (world x,z)
EDGE_PHI = [30, 90, 150, 210, 270, 330]
LANDING_PHI = 30                                  # the landing terrace takes the top-right ring-1 cell
RING1_FILL = [330, 210, 150, 90, 270]             # P2..P6; P1 is the lattice centre so early colonies read as a chain
RING2_FILL = [(90, 2*D), (60, D*math.sqrt(3)), (120, D*math.sqrt(3)), (30, 2*D), (150, 2*D),
              (0, D*math.sqrt(3)), (180, D*math.sqrt(3)), (330, 2*D), (210, 2*D),
              (300, D*math.sqrt(3)), (240, D*math.sqrt(3)), (270, 2*D)]
# ---------------------------------------------------------------- land (runtime height field, no baked tiles)
PLATEAU_R = 20.0               # flat HQ ground at y 4.0 (eaves reach 17.1 + margin)
COURT_APRON = {"x": [-12.5, 12.5], "z": [14.0, 27.0]}   # flat court ground in front of the bay (court sockets and idle loop inside)
PAD = (27.5, 31.5); PAD_W = 6.0; SPUR_W = 5.0            # abutment pad along each built edge line
SPAN = D - 2 * PAD[1]          # 27.0: one bridge asset still fits every edge
COAST = {"min": 28.5, "typical": 33.5, "max": 37.0, "edgeCorridorMax": PAD[1], "edgeCorridorHalfAngleDeg": 10,
         "frontArcMin": 30.0, "frontArcDeg": [60, 120]}
RING_R, RING_W, RING_WOBBLE, RING_EDGE = 24.0, 4.0, 0.6, 1.0
# Ring road band: 24.0 +/- 0.6 wobble +/- 2.0 half-width +/- 1.0 soft edge = 20.4 .. 27.6.
# Bounded inside by the flat plateau the HQ needs (20.0) and outside by the narrowest coast (28.5).
CHANNEL_MIN = D - 2 * COAST["max"]                        # 16 m of open water at the narrowest
SEA, SEABED, GROUND, COURT, DECK, FLOOR = 0.0, -3.0, 4.0, 4.25, 4.25, 4.30
LABEL_Y = 19.5
assert abs(SPAN - 27.0) < 1e-9, SPAN
assert CHANNEL_MIN >= 16, CHANNEL_MIN

def rot(theta_deg, r):
    t = math.radians(theta_deg); return (r * math.cos(t), r * math.sin(t))
def colony_to_world(phi_deg, r):
    c, s = math.cos(math.radians(phi_deg)), math.sin(math.radians(phi_deg))
    return (round(r * (c * U[0] + s * V[0]), 2), round(r * (c * U[1] + s * V[1]), 2))
def world_angle_of_phi(phi):
    c, s = math.cos(math.radians(phi)), math.sin(math.radians(phi))
    x, z = c * U[0] + s * V[0], c * U[1] + s * V[1]
    return round(math.degrees(math.atan2(z, x)), 6)

v1 = json.load(open(V1))

hx, hz = colony_to_world(LANDING_PHI, D)
slots = [{"slot": "H", "ring": 1, "phi": LANDING_PHI, "world": [hx, hz],
          "role": "landing terrace: shared shuttle pad on a small rocky spit, off to the side like the reference (shuttle itself is Goal 6 scope)"},
         {"slot": "P1", "ring": 0, "phi": None, "world": [0.0, 0.0]}]
for i, phi in enumerate(RING1_FILL):
    x, z = colony_to_world(phi, D); slots.append({"slot": f"P{i+2}", "ring": 1, "phi": phi, "world": [x, z]})
for j, (phi, r) in enumerate(RING2_FILL):
    x, z = colony_to_world(phi, r); slots.append({"slot": f"P{7+j}", "ring": 2, "phi": phi, "radius": round(r, 2), "world": [x, z]})
edges = [{"edge": f"E{phi}", "phi": phi, "worldAngleDeg": world_angle_of_phi(phi),
          "abutmentFace": [round(v, 2) for v in rot(world_angle_of_phi(phi), PAD[1])],
          "padCentre": [round(v, 2) for v in rot(world_angle_of_phi(phi), (PAD[0] + PAD[1]) / 2)]} for phi in EDGE_PHI]

contract = {
    "name": "Mission Frontier colony contract",
    "version": "2.0.0",
    "status": "draft until the macro-composition visual gate passes; then frozen",
    "supersedes": {
        "contract": "colony-hq-v1/contract.json 1.0.1-frozen",
        "rejected": ["circular parcel with a flat plateau to r 34", "ring road as the main composition",
                     "literal regular-hexagon HQ shell", "large flat grass shoulders"],
        "retained": ["slot ids, fill order and ground basis", "HQ floor plan: hub, six rooms, sockets, doors, movement polygons",
                     "27 m bridge span and end assets", "materials rules and identity_* tinting", "robot metrics and label anchors",
                     "crown pipeline (re-fitted to the new roof)"],
    },
    "frozenOn": None,
    "authority": "Shaun's direction reset of 17 September 2026: premium rocky archipelago, hex logic as organisation only, tight cinematic framing",
    "generator": "design/mission-frontier/colony/source/generate_colony_v2.py",
    "units": "metres, glTF Y up",
    "axes": v1["axes"],
    "origins": {
        "colony": "world (0,0,0) = centre of the P1 parcel at sea level; the landing terrace is the ring-1 cell at phi 30",
        "hq": "HQ GLB root at the parcel centre (slot world XZ); HQ floor reference point is (0, 4.30, 0); no per-asset offsets",
        "terrain": "generated at runtime in world space from the occupied slot set; no parcel GLBs",
        "bridgeSpan": v1["origins"]["bridgeSpan"],
        "bridgeEnd": f"end GLB root at the pad centre (radius {(PAD[0]+PAD[1])/2} from the parcel centre), +X local pointing outward along the edge",
    },
    "levels": {**v1["levels"], "plateauGround": GROUND, "courtPaving": COURT, "hqFloor": FLOOR, "baseLabelAnchor": LABEL_Y},
    "colony": {
        "cellPitch": D,
        "groundBasis": v1["colony"]["groundBasis"],
        "worldPosition": v1["colony"]["worldPosition"],
        "slots": slots,
        "fillRule": "lowest free slot in table order the first time a project is seen (createdAt, then id); persisted; never reassigned. P1 is the centre cell, so one to three projects read as a chain P3-P1-P2 with the landing terrace off P1/P2, not spokes around a hub",
        "connectionRule": "a bridge between every pair of occupied lattice neighbours; the landing terrace counts as occupied",
        "edges": edges,
        "bridge": {"span": SPAN, "deckWidth": 4.0, "deckTop": DECK, "panelPitch": 1.5, "piers": 3, "pierPitch": SPAN / 4,
                   "assets": ["bridge-span-27.glb", "bridge-end.glb"], "note": "unchanged assets from 1.0.1"},
        "pads": {"radial": list(PAD), "width": PAD_W, "top": COURT, "rule": "only on built edges; the seaward face is vertical to the seabed"},
        "spurs": {"width": SPUR_W, "level": GROUND, "rampToPad": "4.0 to 4.25 over the last 2 m", "rule": "plateau edge to pad along the edge line, built edges only"},
        "ringRoad": {"radius": RING_R, "width": RING_W, "wobble": RING_WOBBLE, "edge": RING_EDGE,
                     "rule": "paved loop on the shoulder linking every built spur, so a parcel reads as connected on all sides; follows the contour at constant radius, seeded wobble per slot, project parcels only"},
    },
    "terrain": {
        "method": "runtime height field: h(x,z) = max over occupied parcels of the parcel profile; watertight by construction, no tile seams, no baked variants",
        "seed": "parcel profile seeded by slot id, so a parcel's land never changes while its slot is occupied",
        "plateau": {"flatRadius": PLATEAU_R, "level": GROUND, "courtApron": COURT_APRON, "blend": 3.5},
        "coast": {**COAST, "rule": "R(theta) = typical + noise in [min, max]; clamped to edgeCorridorMax within edgeCorridorHalfAngleDeg of every edge line so a bridge always fits; at least frontArcMin across the court arc"},
        "landing": {"coast": {"min": 18.0, "typical": 21.0, "max": 24.0}, "padRadius": 12.0, "padTop": COURT,
                    "rule": "land reaches the pad radius along built edges as rocky spits"},
        "relief": {
            "rearOutcrops": {"count": [2, 3], "worldAngleDeg": [190, 300], "radial": [22, 30], "height": [9.0, 14.0], "width": [8, 14]},
            "sideShelves": {"height": [1.5, 3.0], "worldAngleDeg": [0, 60], "note": "low wave-cut shelves in front-left before the drop"},
            "cliff": {"dropOver": 3.5, "toSeabed": SEABED, "jaggedness": "angular noise on the drop distance, 1 to 3 m", "strata": "shader bands every 1.4 m below the lip"},
            "channelMin": CHANNEL_MIN,
        },
        "surfaces": {"rule": "material weights by slope and height in the shader: plateau gravel-grass, worn basalt road on spurs and the court apron, stratified limestone on faces steeper than 50 deg, wet dark rock in the splash zone y < 1.2, shingle on shelves",
                     "textureSets": ["terrain_gravel_sand (Coast Land Rocks 01)", "terrain_stratified_warm_limestone (Seaside Rock)", "coastal_cliff_01", "coastal_cliff_02"],
                     "source": "exterior-bases/astra-kit/environment.glb embedded images (Poly Haven CC0), extracted to public assets"},
        "scatter": {"kit": "colony-v2/producer/scatter-kit.glb (environment pass; the 2A kit is its base)",
                    "rules": "trees on the shoulder between plateau+1.5 and coast-2.5, off spur corridors and the court arc; scanned cliff pieces hung from the lip clear of pads and falls; large rocks on the shoulder, medium at lips and outcrop feet, shoreline rocks in the toe water clear of bridge lines; scrub and grass sparse on the shoulder; reeds at pools and shelves; two to four crystal clusters at cliff shoulders, rocks and the spring pool; lanterns along built spurs and the court edge; vehicles on the court apron"},
        "water": {"chance": 0.6, "bands": [[13, 33], [133, 153]], "rule": "seeded per slot: spring pool at radial 24.6-27.6 on the highest ground of a camera-facing band, channel cut 0.65 m descending at least 6 cm/m to a fall at the lip 20 deg clear of every edge line; a right-flank stream replaces the wave-cut shelf"},
        "validation": ["height field is single-valued so it cannot leak", "every built pad is flat at 4.25 within 0.02 m", "plateau flat at 4.0 under the HQ footprint and court apron", "channel between neighbours >= channelMin at the bridge line", "no vertex above 15.0 (label anchor 19.5 stays clear)"],
    },
    "hq": {**v1["hq"],
           "courtSockets": [({**s, "xz": [-11.0 if s["xz"][0] < 0 else 11.0, 26.5]} if s["id"].startswith("court_edge") else s) for s in v1["hq"]["courtSockets"]],
           "footprint": {**v1["hq"]["footprint"], "shape": "six lobed bays on the retained hexagonal floor plan; the outer wall follows the lobes, not the hex flats",
                         "note": "corners, apothem, doors, partitions and rooms are unchanged; only the envelope reads differently"},
           "massing": {
               "principle": "hex-influenced organisation, not a hex block: six curved bays of different heights around a taller hub drum",
               "bays": {"radiusFromHubCentre": [16.6, 17.4], "parapets": [8.6, 8.9, 9.6, 10.6, 11.6], "tiers": "upper set-back tiers of 1.6 to 2.2 m on testing, planning and review", "implementationDoubleBay": "one wider, lower bay across 210-270",
                        "dispatchBay": "projecting front bay, recessed shutter entrance, apron canopy"},
               "hubDrum": {"radius": 9.0, "top": 13.8, "clerestory": "warm glass band 12.0 to 12.6"},
               "spines": "structural joints between bays at the corner radials, recessed 0.6 m, with service ladders and warm strip",
               "roofEquipment": "vent banks, hatches, antenna, tanks on the lower bays; nothing over the crown envelope",
               "windows": "framed bays of practical_warm_window_glass at 6.8 to 8.0 on every lobe; recessed 0.3 m",
               "eaves": 19.5,
               "envelope": {"maxRadius": 19.5, "crownFitRadius": 8.6, "crownBase": 13.85, "maxHeight": 18.5, "labelAnchor": LABEL_Y},
           }},
    "materials": v1["materials"],
    "cameras": {
        "type": v1["cameras"]["type"],
        "exterior": {"target": [0, 4.3, 5], "offset": [51, 46, 68], "verticalSpan": 46, "elevationDeg": 28.4,
                     "note": "tightened from 58: the HQ, court, pads and near cliffs fill the frame"},
        "cutaway": {"target": [0, 4.3, -1], "offset": [32.2, 45.0, 42.9], "verticalSpan": 40, "elevationDeg": 40,
                    "fit": "runtime: choose the span so the shell, bay and court apron fill 0.80 of the viewport height inside the HUD-safe box; 40 is the fallback"},
        "watch": v1["cameras"]["watch"],
        "world": {**v1["cameras"]["world"], "rule": "fit the union of occupied land (coast max 35) plus the landing terrace with a 6 m margin into the HUD-safe content box; keep the exterior azimuth and elevation"},
        "worldFitMargin": 6.0,
    },
    "interactionSockets": v1["interactionSockets"],
    "movement": {**{k: v for k, v in v1["movement"].items() if k not in ("ring_road",)},
                 "court": {"y": COURT, "polygon": [[-12.5, 15.59], [-5.4, 15.59], [-5.4, 21.6], [5.4, 21.6], [5.4, 15.59], [12.5, 15.59], [12.5, 27.0], [-12.5, 27.0]],
                           "note": "court apron x +-12.5, z 15.59 to 27 (was +-18 to 27.5 in 1.0.1); court_edge sockets moved inside"}},
    "budgets": {**v1["budgets"], "terrainTextures": "<= 6 MB total after extraction, 2048 max", "hqShell": {"triangles": 150000, "bytes": 8000000},
                "scatterKit": {"triangles": 90000, "bytes": 6000000, "note": "environment pass: trees, scrub, grass, reeds, three scanned cliff pieces, rocks, crystals, lantern, vehicles"},
                "colonyTotal": "<= 25 MB fetched for the colony set at any project count (shell, crowns, previews, bridge parts, scatter kit, terrain textures, worker)"},
    "deliverables": {
        "assetProducer": ["hq-shell.glb (new lobed envelope on the retained plan)", "crown-bastion/command/relay/foundry.glb re-fitted to the hub drum", "bridge-span-27.glb and bridge-end.glb unchanged", "hq-metadata.json", "editable .blend + scripts"],
        "runtime": ["terrain-field.ts (pure, tested)", "ColonyTerrain (mesh + shader)", "water from the field", "scatter rules for the new envelope", "camera fits"],
        "evidence": "build-evidence/COLONY-V2/: gate captures at 1568x1003 and 1280x720 after land + bridges, HQ massing and camera framing",
    },
    "reused": v1["reused"],
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(contract, f, indent=2); f.write("\n")
print("wrote", os.path.relpath(OUT, ROOT), "pitch", D, "span", SPAN, "channelMin", CHANNEL_MIN, "slots", len(slots))
