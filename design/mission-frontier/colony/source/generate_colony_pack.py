#!/usr/bin/env python3
"""Generate the frozen colony/HQ input contract and the review diagrams from one set of numbers.

Run from the repository root:
  python3 design/mission-frontier/colony/source/generate_colony_pack.py
Writes design/mission-frontier/assets/staging/colony-hq-v1/contract.json and the SVGs in design/mission-frontier/colony/.
Design tooling only; no application code.
"""
import json, math, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
OUT_CONTRACT = os.path.join(ROOT, "design/mission-frontier/assets/staging/colony-hq-v1/contract.json")
OUT_DIR = os.path.join(ROOT, "design/mission-frontier/colony")

# ---------------------------------------------------------------- constants (frozen)
D = 108.0                      # cell pitch between neighbouring parcel centres (m)
U = (0.8, -0.6)                # colony ground axis u = screen-right on the ground (world x,z)
V = (-0.6, -0.8)               # colony ground axis v = screen-up / away from camera (world x,z)
EDGE_PHI = [30, 90, 150, 210, 270, 330]          # edge directions in the (u,v) basis
RING1_FILL = [210, 330, 90, 150, 30, 270]        # slot fill order, ring 1 (colony angle phi)
RING2_FILL = [(90, 2*D), (60, D*math.sqrt(3)), (120, D*math.sqrt(3)), (30, 2*D), (150, 2*D),
              (0, D*math.sqrt(3)), (180, D*math.sqrt(3)), (330, 2*D), (210, 2*D),
              (300, D*math.sqrt(3)), (240, D*math.sqrt(3)), (270, 2*D)]
PLATEAU_R = 34.0; SHOULDER_R = 42.0; COAST_MAX_R = 46.0
RING_ROAD = (27.5, 32.5); PAD = (32.5, 40.5); PAD_W = 6.0; SPUR_W = 5.0
SPAN = 27.0; PANEL = 1.5; DECK_W = 4.0; PIER_PITCH = SPAN / 4
SEA, SEABED, GROUND, COURT, DECK, FLOOR = 0.0, -3.0, 4.0, 4.25, 4.25, 4.30
CEIL, PARAPET, BAY_ROOF, CROWN_MAX, LABEL_Y = 9.10, 9.60, 8.30, 18.50, 19.50
R_HEX, WALL, R_HUB, PART = 18.0, 0.6, 6.0, 0.3
APOTHEM = R_HEX * math.cos(math.radians(30)); INNER = APOTHEM - WALL
HUB_APOTHEM = R_HUB * math.cos(math.radians(30))
ROBOT_H, ROBOT_CLEAR, SOCKET_PITCH, DOOR_H = 3.10, 3.3, 3.4, 3.8
WALL_ROW_R, INNER_ROW_R = 13.4, 9.0
BAY = {"x": (-5.4, 5.4), "z": (APOTHEM, 21.6), "wall": 0.3}
CORRIDOR_X = (-2.0, 2.0)

def rot(theta_deg, r):
    t = math.radians(theta_deg); return (r * math.cos(t), r * math.sin(t))
def colony_to_world(phi_deg, r):
    c, s = math.cos(math.radians(phi_deg)), math.sin(math.radians(phi_deg))
    return (round(r * (c * U[0] + s * V[0]), 2), round(r * (c * U[1] + s * V[1]), 2))
def world_angle_of_phi(phi):   # world XZ angle (x=cos, z=sin) of colony direction phi
    # Derive the unit direction before rounding positions. Rounding at radius 1
    # introduced up to 0.30 m transverse error across a 108 m colony edge.
    c, s = math.cos(math.radians(phi)), math.sin(math.radians(phi))
    x, z = c * U[0] + s * V[0], c * U[1] + s * V[1]
    return round(math.degrees(math.atan2(z, x)), 6)
def sector_point(theta, radial, tangential):
    n = rot(theta, 1.0); t = (-n[1], n[0])
    return (round(radial * n[0] + tangential * t[0], 2), round(radial * n[1] + tangential * t[1], 2))
def hex_corners(r, start=0):
    return [tuple(round(v, 3) for v in rot(start + 60 * i, r)) for i in range(6)]

# ---------------------------------------------------------------- colony slots
slots = [{"slot": "H", "ring": 0, "phi": None, "world": [0.0, 0.0], "role": "hub parcel: shared spaceport plaza (reserved; shuttle is Goal 6 scope)"}]
for i, phi in enumerate(RING1_FILL):
    x, z = colony_to_world(phi, D); slots.append({"slot": f"P{i+1}", "ring": 1, "phi": phi, "world": [x, z]})
for j, (phi, r) in enumerate(RING2_FILL):
    x, z = colony_to_world(phi, r); slots.append({"slot": f"P{7+j}", "ring": 2, "phi": phi, "radius": round(r, 2), "world": [x, z]})
edges = [{"edge": f"E{phi}", "phi": phi, "worldAngleDeg": world_angle_of_phi(phi),
          "abutmentFace": [round(v, 2) for v in rot(world_angle_of_phi(phi), PAD[1])],
          "padCentre": [round(v, 2) for v in rot(world_angle_of_phi(phi), (PAD[0] + PAD[1]) / 2)]} for phi in EDGE_PHI]

# ---------------------------------------------------------------- HQ rooms and sockets
rooms = {}
def wall_row(theta, ts=(-5.1, -1.7, 1.7, 5.1)):
    return [sector_point(theta, WALL_ROW_R, t) for t in ts]
def inner_row(theta, ts=(-2.0, 2.0)):
    return [sector_point(theta, INNER_ROW_R, t) for t in ts]
def named(prefix, pts, facing):
    return [{"id": f"{prefix}_{i+1:02d}", "xz": list(p), "y": FLOOR, "facingDeg": facing(p)} for i, p in enumerate(pts)]
outward = lambda theta: (lambda p: theta)
inward = lambda theta: (lambda p: (theta + 180) % 360)
rooms["planning"] = {"sector": [150], "cornerRadials": [120, 180], "hubDoorFlat": 150, "stages": ["specification", "plan"],
    "equipment": ["plan holo-table 3.0x2.0 at radial 9 on the 150 deg midline", "wall consoles behind the wall row"],
    "sockets": named("hq_planning", wall_row(150), outward(150)) + named("hq_planning_table", inner_row(150), inward(150))}
rooms["implementation"] = {"sector": [210, 270], "cornerRadials": [180, 300], "hubDoorFlat": [210, 270], "stages": ["implement"],
    "equipment": ["fabrication bench 6.0x1.6 along the 240 deg radial from radial 8 to 14 (partition removed)", "tool racks on both outer walls", "rear service door on the 270 flat"],
    "sockets": named("hq_implement_a", wall_row(210), outward(210)) + named("hq_implement_b", wall_row(270), outward(270))
               + named("hq_implement_bench_a", inner_row(210), inward(210)) + named("hq_implement_bench_b", inner_row(270), inward(270))}
rooms["review"] = {"sector": [330], "cornerRadials": [300, 0], "hubDoorFlat": 330, "stages": ["dev-review", "final-review", "approval"],
    "equipment": ["review wall screens", "circular review dais radius 1.6 at radial 9 (reference HQ)"],
    "sockets": named("hq_review", wall_row(330), outward(330)) + named("hq_review_dais", inner_row(330), inward(330))}
rooms["testing"] = {"sector": [30], "cornerRadials": [0, 60], "hubDoorFlat": 30, "stages": ["test"],
    "equipment": ["test rigs against the outer wall", "diagnostic bench at radial 9"],
    "sockets": named("hq_testing", wall_row(30), outward(30)) + named("hq_testing_bench", inner_row(30), inward(30))}
rooms["briefing"] = {"sector": [90], "region": "front sector, x < -2.3", "cornerRadials": [60, 120], "hubDoorFlat": 90, "stages": ["triage", "scouts", "grill"],
    "equipment": ["Q&A console on the front wall", "scout display", "court door on the front flat at x=-6"],
    "sockets": [{"id": "hq_briefing_01", "xz": [-4.2, 13.4], "y": FLOOR, "facingDeg": 90}, {"id": "hq_briefing_02", "xz": [-6.9, 13.4], "y": FLOOR, "facingDeg": 90},
                {"id": "hq_briefing_03", "xz": [-4.4, 9.0], "y": FLOOR, "facingDeg": 180}]}
rooms["dispatch"] = {"sector": [90], "region": "front sector x > 2.3 (marshalling) + corridor x in [-2,2] + front bay", "cornerRadials": [60, 120], "hubDoorFlat": 90,
    "stages": ["delivered / awaiting PR merge / completed-not-archived"],
    "equipment": ["loading bay 10.8x5.4 interior", "crate stack pad", "cart pad", "delivery beacon (practical)"],
    "sockets": [{"id": "hq_dispatch_01", "xz": [4.2, 13.4], "y": FLOOR, "facingDeg": 90}, {"id": "hq_dispatch_02", "xz": [4.4, 9.0], "y": FLOOR, "facingDeg": 0},
                {"id": "hq_dispatch_bay_01", "xz": [-2.6, 18.6], "y": FLOOR, "facingDeg": 180}, {"id": "hq_dispatch_bay_02", "xz": [2.6, 18.6], "y": FLOOR, "facingDeg": 0}],
    "cargoPads": [{"id": "cargo_crates", "xz": [-4.0, 17.0], "footprint": [1.6, 1.6]}, {"id": "cargo_cart", "xz": [4.0, 20.2], "footprint": [2.6, 1.7]}]}
hub_overflow = [{"id": f"hq_hub_{i+1:02d}", "xz": [round(v, 2) for v in rot(60 * i, 4.0)], "y": FLOOR, "facingDeg": (60 * i + 180) % 360} for i in range(6)]
court_sockets = ([{"id": f"court_side_{i+1:02d}", "xz": [x, 19.0], "y": COURT, "facingDeg": 270} for i, x in enumerate([-12.0, -8.0, 8.0, 12.0])]
                 + [{"id": f"court_front_{i+1:02d}", "xz": [x, 25.0], "y": COURT, "facingDeg": 270} for i, x in enumerate([-9.5, -3.5, 3.5, 9.5])]
                 + [{"id": f"court_edge_{i+1:02d}", "xz": [x, 27.0], "y": COURT, "facingDeg": 270} for i, x in enumerate([-14.0, 14.0])])
doors = [
  {"id": f"door_hub_{f}", "kind": "hub", "flat": f, "centre": [round(v, 2) for v in rot(f, HUB_APOTHEM)], "width": 2.4, "clearHeight": DOOR_H} for f in [30, 90, 150, 210, 270, 330]
] + [
  {"id": "door_front_bay", "kind": "hex-to-bay", "centre": [0.0, round(APOTHEM, 3)], "width": 4.0, "clearHeight": DOOR_H},
  {"id": "door_bay_court", "kind": "bay-to-court", "centre": [0.0, 21.6], "width": 4.0, "clearHeight": 4.0},
  {"id": "door_briefing_court", "kind": "hex-to-court", "centre": [-6.0, round(APOTHEM, 3)], "width": 2.4, "clearHeight": DOOR_H},
  {"id": "door_service_rear", "kind": "hex-to-yard", "centre": [0.0, round(-APOTHEM, 3)], "width": 4.0, "clearHeight": 4.0},
]
# movement polygons (parcel-local XZ)
def sector_poly(radials, r_in=HUB_APOTHEM + PART, r_out=INNER):
    a, b = radials
    if b < a: b += 360
    steps = max(1, int((b - a) / 60))
    outer = [rot(a + (b - a) * i / steps, r_out / math.cos(math.radians(30))) for i in range(steps + 1)]  # to corners (inner face)
    inner = [rot(a + (b - a) * i / steps, r_in / math.cos(math.radians(30))) for i in range(steps + 1)]
    return [[round(x, 2), round(z, 2)] for x, z in outer + inner[::-1]]
movement = {
  "hub_floor": {"y": FLOOR, "polygon": [[round(x, 2), round(z, 2)] for x, z in hex_corners(R_HUB - PART / math.cos(math.radians(30)))], "hole": {"centre": [0, 0], "radius": 1.5, "note": "central holo-table"}},
  "corridor_dispatch": {"y": FLOOR, "polygon": [[-2.0, round(HUB_APOTHEM, 2)], [2.0, round(HUB_APOTHEM, 2)], [2.0, round(INNER, 2)], [-2.0, round(INNER, 2)]]},
  "room_planning": {"y": FLOOR, "polygon": sector_poly((120, 180))},
  "room_implementation": {"y": FLOOR, "polygon": sector_poly((180, 300))},
  "room_review": {"y": FLOOR, "polygon": sector_poly((300, 360))},
  "room_testing": {"y": FLOOR, "polygon": sector_poly((0, 60))},
  "room_briefing": {"y": FLOOR, "polygon": [[-2.3, round(HUB_APOTHEM + PART, 2)], [-2.3, round(INNER, 2)], [-8.65, round(INNER, 2)], [round(-(HUB_APOTHEM + PART) / math.sqrt(3), 2), round(HUB_APOTHEM + PART, 2)]]},
  "room_dispatch_marshalling": {"y": FLOOR, "polygon": [[2.3, round(HUB_APOTHEM + PART, 2)], [round((HUB_APOTHEM + PART) / math.sqrt(3), 2), round(HUB_APOTHEM + PART, 2)], [8.65, round(INNER, 2)], [2.3, round(INNER, 2)]]},
  "bay": {"y": FLOOR, "polygon": [[-5.1, round(APOTHEM, 2)], [5.1, round(APOTHEM, 2)], [5.1, 21.3], [-5.1, 21.3]]},
  "court": {"y": COURT, "polygon": [[-18.0, round(APOTHEM, 2)], [-5.4, round(APOTHEM, 2)], [-5.4, 21.6], [5.4, 21.6], [5.4, round(APOTHEM, 2)], [18.0, round(APOTHEM, 2)], [18.0, 27.5], [-18.0, 27.5]]},
  "ring_road": {"y": GROUND, "annulus": {"inner": RING_ROAD[0], "outer": RING_ROAD[1]}, "note": "48-segment polygon acceptable"},
  "spurs": [{"edge": e["edge"], "y": GROUND, "fromRadius": RING_ROAD[1], "toRadius": PAD[0], "width": SPUR_W, "worldAngleDeg": e["worldAngleDeg"]} for e in edges],
  "pads": [{"edge": e["edge"], "y": DECK, "fromRadius": PAD[0], "toRadius": PAD[1], "width": PAD_W, "worldAngleDeg": e["worldAngleDeg"]} for e in edges],
  "bridge_deck": {"y": DECK, "length": SPAN, "walkableWidth": 3.2, "note": "0.4 m inside each guardrail"},
  "routes": {
    "court_idle_loop": [[-12.0, COURT, 24.0], [-4.0, COURT, 26.5], [4.0, COURT, 26.5], [12.0, COURT, 24.0]],
    "ring_road_loop": {"radius": 30.0, "y": GROUND, "direction": "clockwise viewed from above"},
    "arrival_path_template": "pad(E) -> spur(E) -> ring road -> court front edge at (0, 27.5) -> bay door (0, 21.6) -> corridor -> hub -> room door"
  },
  "rules": ["Robots keep 0.6 m from every polygon edge and fixture footprint.", "Rooms connect only through listed doors.", f"Minimum robot spacing {ROBOT_CLEAR} m centre to centre.", "No robot path crosses the hub table, benches or cargo pads."]
}

contract = {
  "name": "Mission Frontier colony + hexagonal HQ input contract",
  "version": "1.0.1-frozen",
  "frozenOn": "2026-09-16",
  "status": "FROZEN. Changes go through the lead, are versioned here, and both workstreams re-read this file before continuing.",
  "authority": "design/mission-frontier/NEXT-PHASE-HANDOFF.md (accepted layout brief) and design/mission-frontier/colony/*.md",
  "generator": "design/mission-frontier/colony/source/generate_colony_pack.py",
  "units": "metres, seconds, degrees",
  "axes": {"gltf": "X right, Y up, Z toward the viewer (front). Base fronts and courts face +Z in every parcel.",
           "blender": "X right, Y back, Z up; front = -Y. Blender (x,y,z) exports to glTF (x,z,-y).",
           "angles": "world XZ angles: x = cos, z = sin, degrees; colony angles phi use the (u,v) basis below"},
  "origins": {"colony": "world (0,0,0) = centre of the hub parcel at sea level",
              "parcel": "each parcel GLB root at its cell centre, sea level y=0, unrotated; runtime places it at slots[].world",
              "hq": "HQ GLB root at the parcel origin; HQ floor reference point is (0, 4.30, 0); no per-asset offsets",
              "bridgeSpan": "span GLB root at the 'from' abutment face, deck centreline, y=0; +X local runs along the span toward the neighbour",
              "bridgeEnd": "end GLB root at the pad centre (radius 36.5 from the parcel centre), +X local pointing outward along the edge"},
  "levels": {"sea": SEA, "channelSeabed": SEABED, "plateauGround": GROUND, "courtPaving": COURT, "bridgeDeckTop": DECK, "abutmentPadTop": DECK,
             "hqFloor": FLOOR, "hqCeilingClear": CEIL, "hqParapet": PARAPET, "bayRoofTop": BAY_ROOF, "crownEnvelopeMax": CROWN_MAX, "baseLabelAnchor": LABEL_Y,
             "robotHeight": ROBOT_H, "robotLabelAnchorAboveFeet": 3.6, "worker": {"sourceHeight": 1.8, "runtimeHeight": ROBOT_H, "runtimeScale": ROBOT_H / 1.8, "origin": "feet, +Z forward"}},
  "colony": {
    "cellPitch": D, "groundBasis": {"u_screenRight": [U[0], 0, U[1]], "v_screenUp": [V[0], 0, V[1]]},
    "worldPosition": "world (x,z) = r * (cos(phi) * u + sin(phi) * v); the camera looks from world direction (+51,+46,+68), so screen-right is +u and screen-up is +v",
    "slots": slots,
    "fillRule": "A project takes the lowest free project slot P1, P2, ... at first sighting (fixture: sorted by createdAt then id). The slot is persisted browser-local with the project appearance record (backend later) and never reassigned while the project exists. Archived projects keep their slot; their base is shown dormant. Beyond P18, continue ring 3 clockwise from phi=90 at 3D.",
    "edges": edges,
    "landRules": {"plateauFlatRadius": PLATEAU_R, "plateauLevel": GROUND, "shoulderRadius": SHOULDER_R, "shoulderHeightRange": [2.0, 7.0], "coastMaxRadius": COAST_MAX_R,
                  "rearBackdrop": "cliffs up to y=9.0 allowed only in the world angle arc 200-340 deg, radius 36-46, never within 4 m of a spur or pad",
                  "spurCorridor": "flat at y=4.0, 7 m wide including shoulders, from the ring road to each pad",
                  "pads": "flat at 4.25 from radius 32.5 to 40.5, 6 m wide, on all six edges; seaward face vertical to the seabed",
                  "channel": "min 16 m of open water between neighbouring coasts; seabed flat at -3.0 under every span",
                  "geometry": "closed manifold land core with outward normals; scanned detail shells may sit on it but never form the only surface; no reliance on double-sided materials for terrain",
                  "minimumOccupiedSlotsShown": "always render the hub parcel plus every occupied slot; unoccupied ring-1 slots show open sea"},
    "roads": {"ringRoad": {"innerRadius": RING_ROAD[0], "outerRadius": RING_ROAD[1], "level": GROUND}, "spurWidth": SPUR_W, "spurs": "six, one per edge, delivered as separately hideable groups MF_Road_Spur_E<phi>",
              "visibility": "runtime shows a spur, pad and span only when the neighbouring cell is occupied (or is the hub)"},
    "bridge": {"span": SPAN, "panels": int(SPAN / PANEL), "panelPitch": PANEL, "deckWidth": DECK_W, "deckTop": DECK, "structuralDeck": [3.49, 4.17], "guardrailTop": 5.35, "railHeightAboveDeck": 1.05,
               "piers": {"count": 3, "pitch": PIER_PITCH, "footprint": [1.2, 3.0], "from": SEABED, "to": 3.9}, "bearings": "1.8 x 3.8 x 0.4 at each pier as in MF_Bridge",
               "source": "MF_Bridge components in assets/staging/exterior-bases/astra-kit/environment.blend: bridge_deck_panel, bridge_structural_deck, bridge_reinforced_pier, bridge_bearing, bridge_guardrail_post, bridge_continuous_rail, bridge_safety_edge, path_bollard + practical_bollard_cap",
               "ends": "one abutment end asset used on both sides: pad kerb 4.0->4.25, abutment block 6.0 wide x 2.0 deep from -3.0 to 4.25, two bollards with practical caps"},
    "connections": "every occupied ring-1 slot connects to the hub; adjacent occupied ring-1 slots connect to each other; a ring-2 slot connects to every occupied lattice neighbour (at least one). Bridges only between lattice neighbours (pitch 108).",
    "current3ProjectState": "P1 (phi 210, screen bottom-left), P2 (phi 330, bottom-right), P3 (phi 90, top) around the hub"
  },
  "hq": {
    "footprint": {"shape": "regular hexagon", "cornerRadius": R_HEX, "apothem": round(APOTHEM, 3), "flatsFace": [30, 90, 150, 210, 270, 330], "corners": hex_corners(R_HEX),
                  "frontFlat": 90, "outerWall": WALL, "partition": PART, "partitionLowerSolid": 1.2, "partitionUpper": "glazed 1.2 to 4.8, group MF_ShellCutaway_PartitionGlass"},
    "hub": {"cornerRadius": R_HUB, "apothem": round(HUB_APOTHEM, 3), "columns": "6 columns 0.6 dia at hub corners", "parapet": "1.1 m benches/parapets between doors, no upper hub wall", "table": {"centre": [0, 0], "radius": 1.5, "top": FLOOR + 0.9},
            "doors": "one 2.4 m door per hub flat; flats 210 and 270 both open into implementation"},
    "bay": {"outerX": list(BAY["x"]), "z": [round(BAY["z"][0], 3), BAY["z"][1]], "wall": BAY["wall"], "roofTop": BAY_ROOF, "interior": "10.8 x 5.4", "purpose": "dispatch loading bay and arrivals airlock"},
    "corridor": {"x": list(CORRIDOR_X), "from": "hub front door", "to": "bay door", "dividers": "0.3 walls at x=-2.3..-2.0 and 2.0..2.3, 1.2 solid + glazed upper"},
    "rooms": rooms,
    "hubOverflowSockets": hub_overflow,
    "courtSockets": court_sockets,
    "doors": doors,
    "stageToRoom": {"triage": "briefing", "scouts": "briefing", "grill": "briefing", "specification": "planning", "plan": "planning", "implement": "implementation",
                    "dev-review": "review", "test": "testing", "final-review": "review", "approval": "review",
                    "delivered|awaiting-pr-merge|completed(not archived, still open in HUD)": "dispatch", "idle roaming (no active run, idle attention)": "court_idle_loop then hub"},
    "occupancy": {"socketPitch": SOCKET_PITCH, "minRobotSpacing": ROBOT_CLEAR,
                  "allocation": ["1. room primary sockets in listed order (wall row first, then bench/inner row)",
                                 "2. hub overflow sockets adjacent to that room's hub door (the two hub corners flanking the door)",
                                 "3. court sockets (court_side, court_front, court_edge)",
                                 "4. overflow lane: a straight line of standing positions at 1.6 m pitch along the room's inner partition, 0.8 m off the wall, every robot still pickable; room label gains '+N' (approved 16 September 2026)"],
                  "workersPerTask": "one robot per running work package; packages of one task take adjacent sockets in the same room and share one task label with 'xN packages'",
                  "capacityPerHq": {"briefing": 3, "planning": 6, "implementation": 12, "review": 6, "testing": 6, "dispatch": 4, "hub": 6, "court": 10, "total": 53},
                  "neverDo": "never drop a task, hide a worker or turn an active worker into a queue graphic; parked/blocked/historical workers stay parked at their socket"},
    "groups": {"base": ["MF_BaseFixed", "MF_ShellCutaway", "MF_ShellCutaway_FrontFlats (flats 30 and 90 + bay front/right walls)", "MF_ShellCutaway_PartitionGlass", "MF_Roof", "MF_Roof_Crown (variant file)",
                        "MF_Interior", "MF_Interior_<briefing|planning|implementation|review|testing|dispatch>", "MF_Court", "MF_Props", "MF_Practicals", "MF_Sockets (empties, not exported as meshes)"],
               "cutawayHides": ["MF_Roof", "MF_ShellCutaway (and children)"],
               "parcel": ["MF_Terrain", "MF_Planting", "MF_Road_Ring", "MF_Road_Spur_E30..E330", "MF_Pad_E30..E330", "MF_Scenery_Crystal", "MF_Practicals"],
               "bridge": ["MF_Bridge (span)", "MF_Bridge_End"]},
    "crowns": {"shared": "identity disc + ring on the hub crown top; label anchor above at y=19.5",
               "command": "segmented circular crown over the hub drum, two curved bays over the 30 and 150 flats",
               "relay": "asymmetric stepped tower at the 330 corner with dish, lower service wing over review",
               "foundry": "segmented barrel vault along the implementation double sector (210-270), rear utility silos, roof vents",
               "envelope": f"nothing above y={CROWN_MAX}; nothing outside the hex footprint plus 1.5 m eaves; nothing over the bay except its own roof"}
  },
  "materials": {
    "structure": ["structure_ivory_ceramic", "structure_graphite_joints", "brushed_titanium", "console_blue_glass", "glass_partition (alpha blend, no tint)"],
    "identityTinted": ["identity_roof_inset", "identity_roof_ring", "identity_trim"],
    "ambientPulse": ["ambient_screen_*", "ambient_sensor_*", "ambient_crystal_* (scenery crystals, same slow pulse rule, never status)"],
    "practical": ["practical_warm_strip", "practical_warm_window_glass", "practical_station_marker", "practical_console_cyan", "practical_bollard_cap", "practical_delivery_beacon"],
    "ground": ["court_weathered_basalt", "road_basalt_worn", "road_marking_ochre", "pad_landing_concrete", "utility_ochre"],
    "terrain": ["terrain_plateau_gravel", "terrain_shoulder_rock", "terrain_stratified_warm_limestone", "coastal_cliff_01", "coastal_cliff_02", "terrain_seabed"],
    "roomInlays": "room_inlay_<room>: neutral floor inlay per room; runtime may not tint them with task status",
    "rules": ["Portable PBR only: base colour, roughness, normal, emissive as embedded textures; no Blender-only effects.", "Task status, project identity, fixture ids and progress are never baked into any asset.",
              "Materials named identity_* are neutral in source and tinted at runtime.", "Terrain and road materials are single-sided; normals face outward/up."]
  },
  "cameras": {
    "type": "orthographic, azimuth fixed from world direction (+51, +46, +68) for exterior/world; same azimuth, 40 deg elevation for cutaway",
    "exterior": {"target": [0, FLOOR, 6], "offset": [51, 46, 68], "verticalSpan": 58, "elevationDeg": 28.4},
    "cutaway": {"target": [0, FLOOR, -1], "offset": [32.2, 45.0, 42.9], "verticalSpan": 40, "elevationDeg": 40},
    "watch": "cutaway camera, then follow the watched worker",
    "world": {"rule": "fit the union of occupied parcel discs (radius 46) plus the hub with a 10 m margin into the HUD-safe content box, keep the azimuth/elevation of exterior, verticalSpan = fitted ground extent / cos... (builder: project the bounding points and fit)",
              "hudSafeInsets1280x800": {"topLeft": [520, 150], "topRight": [340, 300], "bottomRight": [340, 260], "bottomLeft": [250, 250], "bottomCentreDockWhenSelected": [900, 140]},
              "labelClearance": "base labels must not overlap Needs you or the dock; the far slot P3 (phi 90) is framed below the top HUD by the 10 m margin plus label height; the near slot P6 (phi 270) is filled last so the dock area stays clear in small colonies"},
    "minimap": {"type": "top-down orthographic", "centre": "colony centroid", "span": "2 x (max occupied slot radius + 46 + 20)", "size": 400},
    "projectPreviewCard": "cutaway camera, 540x300, roof and shell hidden (existing headquartersPreview)"
  },
  "interactionSockets": {
    "pick_base": "HQ shell bounds (hex + bay); click selects the project",
    "pick_worker": {"radius": 1.0, "note": "existing"},
    "pick_room": "room floor polygons (movement.room_*) reserved for later room selection; not in slice 1",
    "base_label": [0, LABEL_Y, 0],
    "room_label_anchors": {name: [round(sum(p[0] for p in r["sockets"]) / len(r["sockets"]), 2), CEIL, round(sum(p[1] for p in r["sockets"]) / len(r["sockets"]), 2)] for name, r in
                           ((k, {"sockets": [s["xz"] for s in v["sockets"]]}) for k, v in rooms.items())},
    "arrival_socket": "pad centre of the edge facing the hub (the edge whose phi = slot phi + 180)",
    "spaceport_pad": {"centre": [0, DECK, 0], "radius": 14.0, "note": "hub parcel; shuttle touchdown point for Goal 6"}
  },
  "movement": movement,
  "budgets": {"parcel": {"triangles": 120000, "bytes": 12000000}, "hqShell": {"triangles": 150000, "bytes": 15000000}, "crown": {"triangles": 40000, "bytes": 5000000},
              "bridgeSpan": {"triangles": 15000, "bytes": 2000000}, "textures": "2048 max, shared library, no more than 8 per file", "colonyTotalAt8Projects": "<= 120 MB fetched, shared geometry instanced per parcel"},
  "deliverables": {
    "assetProducer": ["hq-shell.glb (shell, hub, partitions, bay, doors, court paving, room equipment, props, practicals, socket empties)", "crown-command.glb", "crown-relay.glb", "crown-foundry.glb",
                      "bridge-span-27.glb", "bridge-end.glb", "hq-metadata.json (bounds per group, light positions, sockets as exported, door frames)", "editable .blend files + rebuild/export scripts + provenance"],
    "terrainBuilder": ["parcel-hub.glb", "parcel-a.glb", "parcel-b.glb", "parcel-c.glb", "parcel-metadata.json (shorelineXZ loops <=120 points each, plateau polygon, road polylines, pad centres, planting exclusion, light positions, bounds, triangle counts)",
                       "editable .blend files + rebuild/export scripts + provenance"],
    "leadIntegration": ["scripts/frontier/integrate-3d-proof.mjs extension", "manifest v3", "layout/slots/rooms/allocation code", "tests", "browser acceptance"]
  },
  "reused": ["worker.glb (aee069a9823b) unchanged", "MF_Bridge components", "existing material library and Poly Haven / Quaternius CC0 sources", "planting set", "props: crates, cart, bollards, consoles, bench", "practical light roles"]
}
os.makedirs(os.path.dirname(OUT_CONTRACT), exist_ok=True)
json.dump(contract, open(OUT_CONTRACT, "w"), indent=1)
print("contract written", OUT_CONTRACT)

# ---------------------------------------------------------------- SVG helpers
def svg_header(w, h, title):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="Inter, Helvetica, Arial, sans-serif">',
            f'<title>{title}</title><rect width="{w}" height="{h}" fill="#0f2a33"/>',
            '<style>text{fill:#e6eef2} .dim{fill:#9fc3d0;font-size:11px} .k{font-size:12px} .h{font-size:18px;font-weight:600}</style>']

# ---------------------------------------------------------------- colony plan SVG (top-down, world XZ, north = -z up)
def colony_svg():
    Wd, Hd = 1400, 1000; sc = 1.75; cx, cz = 700, 500
    P = lambda x, z: (cx + x * sc, cz + z * sc)
    s = svg_header(Wd, Hd, "Mission Frontier colony plan, top-down")
    s.append(f'<text class="h" x="20" y="30">Colony plan, top-down (world XZ, +X right, +Z down = toward the camera). Cell pitch {D:.0f} m, hexagonal lattice, hub parcel at the centre.</text>')
    s.append('<text class="k" x="20" y="52">Solid: parcels occupied at 3 projects (P1-P3). Dashed: growth slots P4-P8 with their bridges. Dotted: further slots. Land discs show plateau (r34), coast max (r46) and abutment pads.</text>')
    # camera direction arrow
    ax, az = P(-260, 250); s.append(f'<line x1="{ax}" y1="{az}" x2="{ax-51*1.2}" y2="{az-68*1.2}" stroke="#ffd37f" stroke-width="2" marker-end="url(#a)"/>')
    s.append('<defs><marker id="a" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#ffd37f"/></marker></defs>')
    s.append(f'<text class="k" x="{ax-150}" y="{az+18}" fill="#ffd37f">camera looks along (-51,-46,-68); screen-right = u, screen-up = v</text>')
    def parcel(slot, style):
        x, z = slot["world"]; px, pz = P(x, z)
        dash = {"solid": "", "dashed": ' stroke-dasharray="8 6"', "dotted": ' stroke-dasharray="2 5"'}[style]
        s.append(f'<circle cx="{px}" cy="{pz}" r="{COAST_MAX_R*sc}" fill="{"#3b5a3a" if style=="solid" else "none"}" fill-opacity="0.45" stroke="#8fd08a" stroke-width="1.5"{dash}/>')
        s.append(f'<circle cx="{px}" cy="{pz}" r="{PLATEAU_R*sc}" fill="none" stroke="#cbb88a" stroke-width="1"{dash}/>')
        s.append(f'<circle cx="{px}" cy="{pz}" r="{RING_ROAD[0]*sc}" fill="none" stroke="#777" stroke-width="{(RING_ROAD[1]-RING_ROAD[0])*sc}" stroke-opacity="{0.9 if style=="solid" else 0.35}"/>')
        if slot["slot"] == "H":
            s.append(f'<circle cx="{px}" cy="{pz}" r="{14*sc}" fill="#556" stroke="#ffd37f" stroke-width="1.5"/>')
            s.append(f'<text class="k" x="{px}" y="{pz+4}" text-anchor="middle">Spaceport plaza (hub)</text>')
        else:
            # hex HQ footprint + bay + court
            pts = " ".join(f"{P(x+cxh, z+czh)[0]:.1f},{P(x+cxh, z+czh)[1]:.1f}" for cxh, czh in hex_corners(R_HEX))
            s.append(f'<polygon points="{pts}" fill="#d9d4c7" fill-opacity="{0.95 if style=="solid" else 0.35}" stroke="#333"/>')
            s.append(f'<rect x="{P(x-18, z+APOTHEM)[0]:.1f}" y="{P(x-18, z+APOTHEM)[1]:.1f}" width="{36*sc}" height="{(27.5-APOTHEM)*sc}" fill="#8a8f96" fill-opacity="{0.9 if style=="solid" else 0.3}"/>')
            s.append(f'<text class="k" x="{px}" y="{pz-2}" text-anchor="middle" font-weight="600">{slot["slot"]}</text>')
            s.append(f'<text class="dim" x="{px}" y="{pz+12}" text-anchor="middle">phi {slot["phi"]} r {slot.get("radius", D):.0f}</text>')
        for e in edges:
            a = math.radians(e["worldAngleDeg"]); p1 = P(x + PAD[0]*math.cos(a), z + PAD[0]*math.sin(a)); p2 = P(x + PAD[1]*math.cos(a), z + PAD[1]*math.sin(a))
            s.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#bbb" stroke-width="{PAD_W*sc}" stroke-opacity="{0.9 if style=="solid" else 0.3}"/>')
    occupied = {"H": "solid", "P1": "solid", "P2": "solid", "P3": "solid"}
    for k in ["P4", "P5", "P6", "P7", "P8"]: occupied[k] = "dashed"
    def bridge(a, b, style):
        (x1, z1), (x2, z2) = a["world"], b["world"]; dx, dz = x2 - x1, z2 - z1; L = math.hypot(dx, dz)
        if abs(L - D) > 0.5: return
        ux, uz = dx / L, dz / L; p1 = P(x1 + ux*PAD[1], z1 + uz*PAD[1]); p2 = P(x2 - ux*PAD[1], z2 - uz*PAD[1])
        dash = "" if style == "solid" else ' stroke-dasharray="6 5"'
        s.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#e8e8e8" stroke-width="{DECK_W*sc}"{dash}/>')
    bys = {sl["slot"]: sl for sl in slots}
    for sl in slots:
        st = occupied.get(sl["slot"], "dotted"); parcel(sl, st)
    keys = list(bys)
    for i in range(len(keys)):
        for j in range(i+1, len(keys)):
            a, b = bys[keys[i]], bys[keys[j]]
            sa, sb = occupied.get(a["slot"], "dotted"), occupied.get(b["slot"], "dotted")
            if "dotted" in (sa, sb): continue
            bridge(a, b, "solid" if sa == sb == "solid" else "dashed")
    # legend/scale
    s.append(f'<line x1="40" y1="960" x2="{40+100*sc}" y2="960" stroke="#fff" stroke-width="3"/><text class="k" x="40" y="950">100 m</text>')
    s.append(f'<text class="k" x="{Wd-560}" y="{Hd-60}">Fill order: P1 phi210, P2 phi330, P3 phi90, P4 phi150, P5 phi30, P6 phi270; ring 2 from P7 at phi90 (2D) outward.</text>')
    s.append(f'<text class="k" x="{Wd-560}" y="{Hd-40}">Every bridge is the same 27.0 m span (18 deck panels) between abutment faces at r 40.5 of neighbouring cells.</text>')
    s.append(f'<text class="k" x="{Wd-560}" y="{Hd-20}">All HQ fronts face +Z (toward the camera). Roads: ring road r 27.5-32.5 and six spurs to the pads.</text>')
    s.append('</svg>'); return "\n".join(s)

# ---------------------------------------------------------------- HQ floor plan SVG (parcel-local XZ, +z down)
def floor_svg():
    Wd, Hd = 1400, 1300; sc = 22; cx, cz = 700, 530
    P = lambda x, z: (cx + x * sc, cz + z * sc)
    s = svg_header(Wd, Hd, "Hexagonal HQ floor plan")
    s.append(f'<text class="h" x="20" y="30">Hexagonal HQ floor plan (parcel-local, +X right, +Z down = front/court). Corner radius {R_HEX} m, apothem {APOTHEM:.2f} m, floor y {FLOOR}.</text>')
    s.append('<text class="k" x="20" y="52">Rooms: briefing, planning, implementation (double sector), review, testing, dispatch (marshalling + corridor + bay). Hub = circulation. Dots = robot sockets (3.4 m pitch). Grey = court/bay paving.</text>')
    # court
    cp = movement["court"]["polygon"]; s.append('<polygon points="' + " ".join(f"{P(x,z)[0]:.1f},{P(x,z)[1]:.1f}" for x, z in cp) + '" fill="#6f747b" stroke="#aaa"/>')
    # ring road edge
    s.append(f'<line x1="{P(-24,27.5)[0]}" y1="{P(-24,27.5)[1]}" x2="{P(24,27.5)[0]}" y2="{P(24,27.5)[1]}" stroke="#444" stroke-width="{5*sc}" stroke-opacity="0.6"/>')
    s.append(f'<text class="dim" x="{P(20,30)[0]}" y="{P(20,30)[1]}">ring road r 27.5-32.5 (level 4.0)</text>')
    # hex outer + inner
    for r, col, wdt in ((R_HEX, "#d9d4c7", 0), (INNER / math.cos(math.radians(30)), "#1b2f38", 0)):
        pts = " ".join(f"{P(x,z)[0]:.1f},{P(x,z)[1]:.1f}" for x, z in hex_corners(r)); s.append(f'<polygon points="{pts}" fill="{col}" stroke="#eee" stroke-width="1"/>')
    # room fills
    cols = {"room_planning": "#2f4f6f", "room_implementation": "#6f4f2f", "room_review": "#4f2f6f", "room_testing": "#2f6f5f", "room_briefing": "#6f5f2f", "room_dispatch_marshalling": "#3f3f3f", "bay": "#3f3f3f", "corridor_dispatch": "#555"}
    for k, col in cols.items():
        poly = movement[k]["polygon"]; s.append('<polygon points="' + " ".join(f"{P(x,z)[0]:.1f},{P(x,z)[1]:.1f}" for x, z in poly) + f'" fill="{col}" fill-opacity="0.85" stroke="#cfd8dc" stroke-width="1"/>')
    # partitions radials
    for th in (0, 60, 120, 180, 300):
        a, b = rot(th, R_HUB), rot(th, INNER / math.cos(math.radians(30))); s.append(f'<line x1="{P(*a)[0]:.1f}" y1="{P(*a)[1]:.1f}" x2="{P(*b)[0]:.1f}" y2="{P(*b)[1]:.1f}" stroke="#eee" stroke-width="{PART*sc}"/>')
    # hub
    pts = " ".join(f"{P(x,z)[0]:.1f},{P(x,z)[1]:.1f}" for x, z in hex_corners(R_HUB)); s.append(f'<polygon points="{pts}" fill="#233a44" stroke="#eee" stroke-width="{PART*sc}"/>')
    s.append(f'<circle cx="{cx}" cy="{cz}" r="{1.5*sc}" fill="#3a6a7a" stroke="#9fe"/><text class="dim" x="{cx}" y="{cz+4}" text-anchor="middle">hub table</text>')
    for c in hex_corners(R_HUB): s.append(f'<circle cx="{P(*c)[0]:.1f}" cy="{P(*c)[1]:.1f}" r="{0.3*sc}" fill="#eee"/>')
    # bay outline
    bx, bz = BAY["x"], BAY["z"]; s.append(f'<rect x="{P(bx[0],bz[0])[0]:.1f}" y="{P(bx[0],bz[0])[1]:.1f}" width="{(bx[1]-bx[0])*sc}" height="{(bz[1]-bz[0])*sc}" fill="none" stroke="#eee" stroke-width="{0.3*sc}"/>')
    # doors
    for d in doors:
        x, z = d["centre"]; w = d["width"]; px, pz = P(x, z)
        if d["kind"] == "hub":
            a = math.radians(d["flat"]); t = (-math.sin(a), math.cos(a)); p1 = P(x - t[0]*w/2, z - t[1]*w/2); p2 = P(x + t[0]*w/2, z + t[1]*w/2)
        elif d["kind"] == "hex-to-yard" or d["kind"] in ("hex-to-bay", "bay-to-court", "hex-to-court"):
            p1 = P(x - w/2, z); p2 = P(x + w/2, z)
        s.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#ffd37f" stroke-width="{0.5*sc}"/>')
        s.append(f'<text class="dim" x="{px+8}" y="{pz-6}" fill="#ffd37f">{d["id"] if d["kind"]!="hub" else ""} {w} m</text>')
    # sockets
    def dot(sk, col):
        px, pz = P(*sk["xz"]); s.append(f'<circle cx="{px:.1f}" cy="{pz:.1f}" r="{0.6*sc}" fill="{col}" stroke="#000"/>')
        f = math.radians(sk["facingDeg"]); s.append(f'<line x1="{px:.1f}" y1="{pz:.1f}" x2="{px+math.cos(f)*0.9*sc:.1f}" y2="{pz+math.sin(f)*0.9*sc:.1f}" stroke="#000" stroke-width="2"/>')
    for name, r in rooms.items():
        for sk in r["sockets"]: dot(sk, "#ffffff")
        for cp_ in r.get("cargoPads", []):
            px, pz = P(*cp_["xz"]); w, h = cp_["footprint"]; s.append(f'<rect x="{px-w/2*sc:.1f}" y="{pz-h/2*sc:.1f}" width="{w*sc}" height="{h*sc}" fill="#c9a24d" stroke="#000"/>')
    for sk in hub_overflow: dot(sk, "#9fc3d0")
    for sk in court_sockets: dot(sk, "#cfcfcf")
    # equipment sketches
    s.append(f'<rect x="{P(-3.0,-11.5)[0]-0.8*sc:.1f}" y="{P(0,0)[1]-0}" width="0" height="0"/>')
    # room labels
    labels = {"planning": (150, 11.2), "implementation": (240, 12.0), "review": (330, 11.2), "testing": (30, 11.2)}
    for name, (th, r) in labels.items():
        x, z = rot(th, r); s.append(f'<text class="k" x="{P(x,z)[0]:.1f}" y="{P(x,z)[1]-16:.1f}" text-anchor="middle" font-weight="600">{name}</text>')
        s.append(f'<text class="dim" x="{P(x,z)[0]:.1f}" y="{P(x,z)[1]+28:.1f}" text-anchor="middle">{", ".join(rooms[name]["stages"])}</text>')
    s.append(f'<text class="k" x="{P(-5.6,7.6)[0]:.1f}" y="{P(-5.6,7.6)[1]:.1f}" text-anchor="middle" font-weight="600">briefing</text>')
    s.append(f'<text class="k" x="{P(5.6,7.6)[0]:.1f}" y="{P(5.6,7.6)[1]:.1f}" text-anchor="middle" font-weight="600">dispatch</text>')
    s.append(f'<text class="k" x="{P(0,19.0)[0]:.1f}" y="{P(0,19.0)[1]-14:.1f}" text-anchor="middle" font-weight="600">dispatch bay</text>')
    s.append(f'<text class="k" x="{P(0,24.5)[0]:.1f}" y="{P(0,24.5)[1]:.1f}" text-anchor="middle">court (paving 4.25)</text>')
    s.append(f'<text class="dim" x="{P(0,11)[0]:.1f}" y="{P(0,11)[1]:.1f}" text-anchor="middle">corridor 4.0</text>')
    # dimension lines
    def dim(x1, z1, x2, z2, text, dx=0, dz=0):
        p1, p2 = P(x1, z1), P(x2, z2); s.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#9fc3d0" stroke-width="1"/>')
        s.append(f'<text class="dim" x="{(p1[0]+p2[0])/2+dx:.1f}" y="{(p1[1]+p2[1])/2+dz:.1f}" text-anchor="middle">{text}</text>')
    dim(-18, -17.5, 18, -17.5, "36.0 m corner to corner", 0, -6)
    dim(20.5, -APOTHEM, 20.5, APOTHEM, "31.18 m flat to flat", 62, 0)
    dim(-21, APOTHEM, -21, 27.5, f"court {27.5-APOTHEM:.2f} m", -50, 0)
    dim(7.0, APOTHEM, 7.0, 21.6, "bay 6.0", 36, 0)
    s.append(f'<text class="k" x="20" y="{Hd-82}">Hub: 12.0 m corner to corner, 10.39 m flat to flat, six 2.4 m doors, central table radius 1.5, six columns, 1.1 m parapets.</text>')
    s.append(f'<text class="k" x="20" y="{Hd-62}">Clearances: doors 2.4 m (personnel) / 4.0 m (loading), 3.8 m clear height; robot 3.1 m tall, min spacing 3.3 m; every route lane >= 2.4 m; robots stay 0.6 m off walls and fixtures.</text>')
    s.append(f'<text class="k" x="20" y="{Hd-42}">Cutaway hides MF_Roof + MF_ShellCutaway: flats 30 and 90 outer walls, bay front/right walls, all glazed partition uppers (above 1.2 m). Hub has columns and 1.1 m parapets only.</text>')
    s.append(f'<text class="k" x="20" y="{Hd-22}">Capacity: briefing 3, planning 6, implementation 12, review 6, testing 6, dispatch 4, hub overflow 6, court 10 = 53 robot positions before the overflow-lane proposal applies.</text>')
    s.append('</svg>'); return "\n".join(s)

# ---------------------------------------------------------------- cutaway composition SVG (section + screen framing)
def cutaway_svg():
    Wd, Hd = 1400, 1000; s = svg_header(Wd, Hd, "HQ cutaway composition")
    s.append('<text class="h" x="20" y="30">HQ cutaway composition: section through the hex (left) and screen framing at 1280x800 (right).</text>')
    # section: x axis = world z (front to the right), y = height. scale 14 px/m
    sc = 14; ox, oy = 60, 600
    Q = lambda z, y: (ox + (z + 25) * sc, oy - y * sc)
    for y, name, col in ((SEA, "sea 0.0", "#3aa"), (SEABED, "seabed -3.0", "#578"), (GROUND, "ground 4.0", "#cbb88a"), (COURT, "court/deck 4.25", "#999"), (FLOOR, "floor 4.30", "#eee"),
                         (CEIL, "ceiling 9.10", "#eee"), (PARAPET, "parapet 9.60", "#eee"), (BAY_ROOF, "bay roof 8.30", "#bbb"), (CROWN_MAX, "crown max 18.50", "#ffd37f"), (LABEL_Y, "label 19.50", "#ffd37f")):
        p1, p2 = Q(-25, y), Q(40, y); s.append(f'<line x1="{p1[0]}" y1="{p1[1]}" x2="{p2[0]}" y2="{p2[1]}" stroke="{col}" stroke-width="1" stroke-dasharray="3 4"/>')
        s.append(f'<text class="dim" x="{p2[0]+6}" y="{p2[1]+4}">{name}</text>')
    # ground slab + water
    s.append(f'<rect x="{Q(-25,GROUND)[0]}" y="{Q(-25,GROUND)[1]}" width="{(25+34)*sc}" height="{(GROUND-SEABED)*sc}" fill="#4a3f33"/>')
    s.append(f'<rect x="{Q(34,SEA)[0]}" y="{Q(34,SEA)[1]}" width="{6*sc}" height="{(SEA-SEABED)*sc}" fill="#164c5a"/>')
    # hex walls (section along z through x=0): rear wall at -15.59, front flat at +15.59, bay to 21.6
    def wall(z, y0, y1, col="#d9d4c7", w=WALL):
        p = Q(z - w/2, y1); s.append(f'<rect x="{p[0]}" y="{p[1]}" width="{w*sc}" height="{(y1-y0)*sc}" fill="{col}" stroke="#333"/>')
    wall(-APOTHEM, GROUND, PARAPET); wall(APOTHEM, GROUND, PARAPET, "#ff9f6f"); wall(21.6, GROUND, BAY_ROOF, "#ff9f6f", 0.3)
    wall(-HUB_APOTHEM, FLOOR, FLOOR + 1.1, "#9fc3d0", 0.3); wall(HUB_APOTHEM, FLOOR, FLOOR + 1.1, "#9fc3d0", 0.3)
    # hub columns full height
    wall(-R_HUB + 0.3, FLOOR, CEIL, "#9fc3d0", 0.6); wall(R_HUB - 0.3, FLOOR, CEIL, "#9fc3d0", 0.6)
    # floor slab, roof slab, bay roof
    s.append(f'<rect x="{Q(-APOTHEM,FLOOR)[0]}" y="{Q(-APOTHEM,FLOOR)[1]}" width="{2*APOTHEM*sc}" height="{(FLOOR-GROUND)*sc}" fill="#bbb"/>')
    s.append(f'<rect x="{Q(-APOTHEM,PARAPET)[0]}" y="{Q(-APOTHEM,PARAPET)[1]}" width="{2*APOTHEM*sc}" height="{(PARAPET-CEIL)*sc}" fill="#ff9f6f" stroke="#333"/>')
    s.append(f'<rect x="{Q(APOTHEM,BAY_ROOF)[0]}" y="{Q(APOTHEM,BAY_ROOF)[1]}" width="{(21.6-APOTHEM)*sc}" height="{0.4*sc}" fill="#ff9f6f" stroke="#333"/>')
    # crown envelope
    s.append(f'<path d="M{Q(-9,PARAPET)[0]},{Q(-9,PARAPET)[1]} Q{Q(0,CROWN_MAX+3)[0]},{Q(0,CROWN_MAX+3)[1]} {Q(9,PARAPET)[0]},{Q(9,PARAPET)[1]}" fill="#ff9f6f" fill-opacity="0.35" stroke="#ffd37f" stroke-dasharray="4 3"/>')
    s.append(f'<text class="dim" x="{Q(0,CROWN_MAX-2)[0]}" y="{Q(0,CROWN_MAX-2)[1]}" text-anchor="middle">crown variant (MF_Roof)</text>')
    # robots
    for z in (-11.0, -3.5, 9.0, 18.6, 24.0):
        p = Q(z - 0.6, FLOOR if z < 21.6 else COURT); s.append(f'<rect x="{p[0]}" y="{p[1]-ROBOT_H*sc}" width="{1.2*sc}" height="{ROBOT_H*sc}" fill="#eef" stroke="#333" rx="4"/>')
    # partitions lower/upper
    for z in (-2.3, 2.3):
        wall(z, FLOOR, FLOOR + 1.2, "#d9d4c7", 0.3); wall(z, FLOOR + 1.2, FLOOR + 4.8, "#ff9f6f", 0.3)
    s.append('<text class="k" x="60" y="680">Orange = MF_ShellCutaway / MF_Roof (hidden in the cutaway). Cream = MF_BaseFixed. Blue = hub columns and parapets (always visible).</text>')
    # camera rays
    for elev, col, name, tz in ((28.4, "#9fe", "exterior 28.4 deg (span 58)", 6), (40.0, "#ffd37f", "cutaway 40 deg (span 40)", -1)):
        a = math.radians(elev); p0 = Q(tz, FLOOR); p1 = Q(tz + 24*math.cos(a), FLOOR + 24*math.sin(a))
        s.append(f'<line x1="{p0[0]}" y1="{p0[1]}" x2="{p1[0]}" y2="{p1[1]}" stroke="{col}" stroke-width="2"/>')
        s.append(f'<text class="dim" x="{p1[0]-10}" y="{p1[1]-6}" text-anchor="end" fill="{col}">{name}</text>')
        # occlusion depth behind a 1.2 partition and behind a 4.8 wall
        s.append(f'<text class="dim" x="{p0[0]+8}" y="{p0[1]+16*(1 if elev>30 else 2)}" fill="{col}">hides {1.2/math.tan(a):.1f} m of floor behind a 1.2 m partition, {4.8/math.tan(a):.1f} m behind a 4.8 m wall</text>')
    s.append('<text class="k" x="60" y="705">Section is along Z through X=0 (rear at left, court and bay at right). Not to be used for widths; see the floor plan.</text>')
    # screen framing panel
    fx, fy, fw, fh = 860, 80, 512, 320  # 1280x800 at 0.4
    k = 0.4
    s.append(f'<rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" fill="#173e4a" stroke="#eee"/>')
    def hud(x, y, w, h, name):
        s.append(f'<rect x="{fx+x*k}" y="{fy+y*k}" width="{w*k}" height="{h*k}" fill="#0b1b22" fill-opacity="0.85" stroke="#9fc3d0" stroke-dasharray="3 3"/>')
        s.append(f'<text class="dim" x="{fx+x*k+4}" y="{fy+y*k+12}">{name}</text>')
    hud(0, 0, 520, 150, "brand, tabs, 3D controls"); hud(1280-340, 0, 340, 300, "Needs you"); hud(1280-340, 800-260, 340, 260, "actions"); hud(0, 800-250, 250, 250, "minimap"); hud(190, 800-140, 900, 140, "selected-task dock (on selection)")
    # cutaway HQ projected ellipse: hex 36 wide -> at span 40 over 800px => 20 px/m ; ground depth foreshortened by sin(40)
    cxs, cys = fx + 640*k, fy + 400*k
    ppm = 800 / 40 * k
    pts = []
    for th in range(0, 360, 60):
        x, z = rot(th, R_HEX); sxp = cxs + (x*0.8 - z*0.6) * ppm; syp = cys + (x*0.6 + z*0.8) * ppm * math.sin(math.radians(40))
        pts.append(f"{sxp:.1f},{syp:.1f}")
    s.append(f'<polygon points="{" ".join(pts)}" fill="#d9d4c7" fill-opacity="0.9" stroke="#333"/>')
    s.append(f'<text class="k" x="{fx}" y="{fy+fh+18}">Cutaway framing at 1280x800: the hex (36 m) spans about 570 px; target (0, 4.3, -1) sits at 50/50; the bay and court fall below centre, clear of the dock unless a task is selected.</text>')
    s.append(f'<text class="k" x="{fx}" y="{fy+fh+38}">Right-hand HUD keeps the review/testing side partially covered at laptop width; the cutaway camera view offset of 65 px (existing) shifts content left.</text>')
    s.append(f'<text class="k" x="{fx}" y="{fy+fh+58}">Exterior framing: target (0, 4.3, 6), span 58; the HQ and court occupy the middle 60 percent; base label at y 19.5 stays under the top HUD.</text>')
    s.append('</svg>'); return "\n".join(s)

for name, fn in (("colony-plan.svg", colony_svg), ("hq-floor-plan.svg", floor_svg), ("hq-cutaway-composition.svg", cutaway_svg)):
    open(os.path.join(OUT_DIR, name), "w").write(fn()); print("wrote", name)
