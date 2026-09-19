"""Contract 2.0 HQ shell: six curved bays of different heights around a hub drum, on the retained floor plan.

Hex logic is organisation, not silhouette: rooms, doors, partitions, sockets and the dispatch bay are the
1.0.1 plan unchanged; the envelope is five stepped arc bays (implementation spans two sectors) separated by
recessed structural spines, a roof drum that carries the crown, framed warm windows, roof equipment and an
attached service wing. Run through build_all_v2.py under Blender 5.2.1 headless.
"""
import math
import re
from v2_lib import *  # noqa: F401,F403
from v2_lib import B, C2, DRUM_R, DRUM_TOP, APRON, ENVELOPE_R, finish_v2

FLOOR = C['levels']['hqFloor']; GROUND = C['levels']['plateauGround']; COURT = C['levels']['courtPaving']
CEIL = C['levels']['hqCeilingClear']
WALL_T = 0.6
# phi = sector midline (world XZ deg), half = angular half-width, r = outer wall radius, top = parapet top, tier = upper step height
LOBES = [
    dict(name='testing', phi=30, half=26.0, r=16.9, top=9.6, tier=1.6, cut=True),
    dict(name='front', phi=90, half=26.0, r=16.6, top=8.6, tier=0.0, cut=True),
    dict(name='planning', phi=150, half=26.0, r=17.2, top=10.6, tier=2.2, cut=False),
    dict(name='implementation', phi=240, half=56.0, r=16.8, top=8.9, tier=0.0, cut=False),
    dict(name='review', phi=330, half=26.0, r=17.4, top=11.6, tier=2.0, cut=False),
]
SPINES = [0, 60, 120, 180, 300]          # corner radials between lobes (240 is inside the double bay)
COURT_DOOR_PHI = 90 + math.degrees(math.asin(6.0 / 16.6))   # the briefing court door at x = -6


def arc_points(phi0, phi1, r, step=3.0):
    n = max(2, int(math.ceil((phi1 - phi0) / step)))
    return [radial(phi0 + (phi1 - phi0) * i / n, r) for i in range(n + 1)]


def arc_slab(name, phi0, phi1, r_in, r_out, y0, y1, mat, bevel=.05, step=3.0):
    pts = arc_points(phi0, phi1, r_out, step) + list(reversed(arc_points(phi0, phi1, r_in, step)))
    return B.slab(name, pts, y0, y1, mat, bevel)


def arc_wall(name, phi0, phi1, r_out, t, y0, y1, mat, doors=(), step=3.0, bevel=.05, inset=0.0):
    """Faceted arc wall as short boxes on the chord; doors = (phi_centre, width_m, clear_height)."""
    r = r_out - t / 2 - inset
    mat = mat if isinstance(mat, str) else mat.name
    n = max(2, int(math.ceil((phi1 - phi0) / step)))
    out = []
    for i in range(n):
        a0 = phi0 + (phi1 - phi0) * i / n; a1 = phi0 + (phi1 - phi0) * (i + 1) / n; mid = (a0 + a1) / 2
        chord = 2 * r * math.sin(math.radians(a1 - a0) / 2) + 0.02
        x, z = radial(mid, r)
        cut = None
        for dphi, width, height in doors:
            half = math.degrees(math.asin(min(1.0, width / 2 / r)))
            if abs(mid - dphi) < half: cut = height
        if cut is None:
            out.append(B.b(name, (x, (y0 + y1) / 2, z), (chord, y1 - y0, t), mat, bevel, mid + 90))
        elif y1 - (y0 + cut) > 0.05:
            out.append(B.b(name + '_lintel', (x, (y0 + cut + y1) / 2, z), (chord, y1 - (y0 + cut), t), mat, bevel, mid + 90))
    return out


def windows(prefix, phi0, phi1, r, y, height, skip=(), pitch_deg=5.0, margin=4.0):
    """Framed warm windows recessed into an arc wall; skip = (phi_centre, half_angle) ranges."""
    a = phi0 + margin
    while a <= phi1 - margin + 1e-6:
        if not any(abs(a - c) < h for c, h in skip):
            n = dirv(a); x, z = radial(a, r + .03)
            B.b(prefix + '_window_recess', (x, y, z), (2.0, height + .26, .18), 'structure_graphite_joints', .03, a + 90)
            B.b(prefix + '_window_glass', (x - n[0] * .06, y, z - n[1] * .06), (1.76, height, .05), 'practical_warm_window_glass', .02, a + 90)
            B.b(prefix + '_window_mullion', (x - n[0] * .03, y, z - n[1] * .03), (.08, height, .07), 'brushed_titanium', .01, a + 90)
            B.b(prefix + '_window_sill', (x + n[0] * .12, y - height / 2 - .18, z + n[1] * .12), (2.1, .09, .32), 'brushed_titanium', .02, a + 90)
        a += pitch_deg


# Greybox room equipment the scanned hero props replace. The 1.0.1 `equipment()` recipe is otherwise
# retained in full -- wall consoles, review dais, fabrication bench, briefing console and the cart all
# stay, because no scan exists for them yet.
#
# The v1 producer directory is read-only history, so this strips the pieces after the shared recipe
# has run rather than forking it: the parts that remain keep one source of truth, and a future scan
# is added here by name instead of by re-copying fifty lines.
REPLACED_BY_SCANS = {
    # planningHoloTable.V2 -> MF_Prop_PlanningTable
    'planning_table', 'planning_table_surface',
    # testingRig.V2 -> MF_Prop_TestRig
    'testing_table', 'testing_table_surface', 'testing_diagnostic_rig', 'testing_sensor_collar',
    # cargoBattery.V2 -> MF_Prop_CargoBattery, on the same frozen cargo pad
    'cargo_crate', 'cargo_retaining_band', 'cargo_lid',
}
# Their obstacle entries go with them: `prop-placement.ts` publishes the scanned footprints instead,
# and leaving these would keep robots out of floor that no longer has anything standing on it.
REPLACED_OBSTACLES = {'planning_central_equipment', 'testing_central_equipment', 'cargo_crates'}


def equipment_v2():
    """The retained equipment recipe, less the pieces the Meshy scans now stand in for."""
    B.equipment()
    removed = 0
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and re.sub(r'\.\d{3}$', '', o.name) in REPLACED_BY_SCANS:
            bpy.data.objects.remove(o, do_unlink=True)
            removed += 1
    kept = [x for x in B.OBSTACLES if x['name'] not in REPLACED_OBSTACLES]
    dropped = len(B.OBSTACLES) - len(kept)
    B.OBSTACLES[:] = kept
    assert removed and dropped == len(REPLACED_OBSTACLES), (removed, dropped)
    print(f'GREYBOX_REPLACED meshes={removed} obstacles={dropped}')


def lobe(spec):
    phi, half, r, top = spec['phi'], spec['half'], spec['r'], spec['top']
    phi0, phi1 = phi - half, phi + half
    walls = 'MF_ShellCutaway_FrontFlats' if spec['cut'] else 'MF_BaseFixed'
    use(walls)
    doors = []
    if spec['name'] == 'front':
        doors = [(90.0, 10.4, 8.3), (COURT_DOOR_PHI, 2.4, 3.8)]     # bay throat, briefing court door
    if spec['name'] == 'implementation':
        doors = [(270.0, 4.0, 4.0)]                                  # rear service door
    arc_wall(spec['name'] + '_bay_wall', phi0, phi1, r, WALL_T, FLOOR - .05, top, B.M['structure_ivory_ceramic'], doors)
    # Plinth shadow line, upper titanium band, parapet cap: the facade rhythm every bay shares.
    arc_wall(spec['name'] + '_plinth_band', phi0 + .5, phi1 - .5, r + .05, .12, GROUND, GROUND + .55, B.M['structure_graphite_joints'], doors, bevel=.02)
    arc_wall(spec['name'] + '_upper_band', phi0 + .5, phi1 - .5, r + .04, .1, top - .42, top - .2, B.M['brushed_titanium'], (), bevel=.02)
    arc_slab(spec['name'] + '_parapet_cap', phi0 - .6, phi1 + .6, r - .95, r + .12, top, top + .36, 'structure_ivory_ceramic', .06)
    arc_slab(spec['name'] + '_parapet_reveal', phi0 - .6, phi1 + .6, r - .55, r - .4, top + .36, top + .42, 'brushed_titanium', .01)
    skip = [(d[0], math.degrees(math.asin(min(1.0, d[1] / 2 / r))) + 3.5) for d in doors]
    windows(spec['name'], phi0, phi1, r, 7.1, 1.45, skip, pitch_deg=6.5)
    # Roof: sealed deck with an upper tier on the taller bays, all hidden by the cutaway.
    use('MF_Roof')
    arc_slab(spec['name'] + '_roof_deck', phi0 - .4, phi1 + .4, 8.6, r - .5, top - .28, top + .02, 'structure_ivory_ceramic', .05)
    arc_slab(spec['name'] + '_roof_gasket', phi0 - .4, phi1 + .4, 8.6, r - .45, top - .34, top - .28, 'brushed_titanium', .02)
    a = phi0 + 4.0
    while a < phi1 - 2.0:
        B.strip(spec['name'] + '_roof_seam', radial(a, 9.4), radial(a, r - 1.15), top + .025, 'structure_graphite_joints', .06)
        a += 7.0
    B.strip(spec['name'] + '_roof_walkway', radial(phi0 + 3, r - 2.6), radial(phi1 - 3, r - 2.6), top + .03, 'utility_ochre', .18)
    if spec['tier'] > 0:
        arc_slab(spec['name'] + '_tier', phi0 + 4, phi1 - 4, 8.4, r - 2.1, top, top + spec['tier'], 'structure_ivory_ceramic', .08)
        arc_slab(spec['name'] + '_tier_cap', phi0 + 3.6, phi1 - 3.6, r - 2.9, r - 1.98, top + spec['tier'], top + spec['tier'] + .3, 'structure_graphite_joints', .03)
        arc_wall(spec['name'] + '_tier_band', phi0 + 4.5, phi1 - 4.5, r - 2.06, .1, top + .3, top + .55, B.M['structure_graphite_joints'], (), step=4.0, bevel=.02)
        arc_wall(spec['name'] + '_tier_clerestory', phi0 + 7, phi1 - 7, r - 2.06, .08, top + spec['tier'] - 1.05, top + spec['tier'] - .45, B.M['practical_warm_window_glass'], (), step=4.0, bevel=.01)
        light('practical_warm_window_glass', radial(phi, r - 2.4, top + spec['tier'] / 2))


def roof_equipment():
    use('MF_Roof')
    # Implementation: three vent banks and a process tank along the long low roof.
    for j, a in enumerate([222, 240, 258]):
        x, z = radial(a, 13.6); t = dirv(a + 90)
        B.b('roof_vent_bank', (x, 9.34, z), (2.6, .62, 1.3), 'brushed_titanium', .08, a + 90)
        for k in range(5):
            B.b('roof_vent_louver', (x + t[0] * (k - 2) * .48, 9.7, z + t[1] * (k - 2) * .48), (.12, .12, 1.1), 'structure_graphite_joints', .02, a + 90)
    x, z = radial(276, 13.2)
    cyl('roof_process_tank', (x, 10.1, z), 1.15, 2.2, B.M['structure_ivory_ceramic'], 24, .08)
    cyl('roof_tank_collar', (x, 11.25, z), 1.22, .14, B.M['structure_graphite_joints'], 24, .02)
    # Testing: access hatch and two condenser units. Planning: comms mast. Review: sensor pods on the tier.
    x, z = radial(22, 13.4); cyl('roof_access_hatch', (x, 9.6, z), .8, .2, B.M['brushed_titanium'], 24, .02)
    for a in [36, 44]:
        x, z = radial(a, 13.9); B.b('roof_condenser', (x, 9.95, z), (1.3, .9, 1.0), 'brushed_titanium', .06, a + 90)
        B.b('roof_condenser_grille', (x, 10.42, z), (1.1, .04, .8), 'structure_graphite_joints', .01, a + 90)
    x, z = radial(150, 12.6); cyl('roof_comms_mast', (x, 14.4, z), .12, 3.2, B.M['brushed_titanium'], 12)
    cyl('roof_comms_head', (x, 16.1, z), .32, .26, B.M['ambient_sensor_navigation'], 12)
    for a in [318, 342]:
        x, z = radial(a, 13.0); cyl('roof_sensor_pod', (x, 13.85, z), .42, .5, B.M['structure_graphite_joints'], 16, .03)
        cyl('roof_sensor_lens', (x, 14.15, z), .3, .1, B.M['ambient_sensor_navigation'], 16)


def drum():
    """Roof drum over the hub: the crown's plinth, with a warm clerestory ring. Hidden with the roof."""
    use('MF_Roof')
    base = 8.0
    cyl('hub_drum', (0, (base + DRUM_TOP) / 2, 0), DRUM_R, DRUM_TOP - base, B.M['structure_ivory_ceramic'], 48, .06)
    cyl('hub_drum_base_band', (0, base + .3, 0), DRUM_R + .12, .6, B.M['structure_graphite_joints'], 48, .02)
    cyl('hub_drum_mid_band', (0, 11.3, 0), DRUM_R + .08, .22, B.M['brushed_titanium'], 48, .01)
    cyl('hub_drum_collar', (0, DRUM_TOP - .3, 0), DRUM_R + .14, .34, B.M['structure_graphite_joints'], 48, .02)
    ring('hub_drum_deck_ring', (0, DRUM_TOP + .02, 0), DRUM_R - .45, .05, B.M['brushed_titanium'], 64, 8)
    for k in range(14):
        a = k * (360 / 14) + 5
        n = dirv(a); x, z = radial(a, DRUM_R + .02)
        B.b('drum_clerestory_recess', (x, 12.3, z), (2.4, .78, .16), 'structure_graphite_joints', .02, a + 90)
        B.b('drum_clerestory_glass', (x + n[0] * .05, 12.3, z + n[1] * .05), (2.2, .56, .05), 'practical_warm_window_glass', .01, a + 90)
        B.b('drum_lower_recess', (x, 9.9, z), (1.6, 1.3, .12), 'structure_graphite_joints', .02, a + 90)
    for phi in [0, 60, 120, 180, 240, 300]:
        x, z = radial(phi, DRUM_R + .18)
        B.b('drum_rib', (x, (base + DRUM_TOP) / 2, z), (.36, DRUM_TOP - base, .38), 'brushed_titanium', .05, phi)
    light('practical_warm_window_glass', (0, 12.3, DRUM_R))
    light('practical_warm_window_glass', radial(200, DRUM_R, 12.3))


def spines():
    use('MF_BaseFixed')
    for phi in SPINES:
        x, z = radial(phi, 15.75)
        B.b('structural_spine', (x, (GROUND + 9.4) / 2, z), (1.5, 9.4 - GROUND, 1.5), 'structure_graphite_joints', .08, phi)
        B.b('spine_cap', radial(phi, 15.75, 9.46), (1.6, .12, 1.6), 'structure_graphite_joints', .03, phi)
        sx, sz = radial(phi, 16.52)
        B.b('spine_service_strip', (sx, 6.9, sz), (.14, 4.6, .08), 'practical_warm_strip', .01, phi + 90)
        light('practical_warm_strip', (sx, 6.9, sz))
        for yy in [5.0, 6.2, 7.4, 8.6]:
            B.b('spine_ladder_rung', radial(phi, 16.46, yy), (.6, .06, .16), 'brushed_titanium', .01, phi + 90)


def service_wing():
    """Attached side mass on the implementation bay: a low service annex with a tank, inside the eaves."""
    use('MF_BaseFixed')
    a = 256.0; n = dirv(a); t = dirv(a + 90)
    cx, cz = radial(a, 17.7)
    B.b('service_wing', (cx, (GROUND + 7.1) / 2, cz), (6.4, 7.1 - GROUND, 2.7), 'structure_ivory_ceramic', .08, a + 90)
    B.b('service_wing_plinth', (cx, GROUND + .28, cz), (6.5, .56, 2.8), 'structure_graphite_joints', .03, a + 90)
    B.b('service_wing_cap', (cx, 7.2, cz), (6.6, .3, 2.9), 'structure_graphite_joints', .04, a + 90)
    for j in [-1.9, 0.0, 1.9]:
        x, z = cx + t[0] * j + n[0] * 1.32, cz + t[1] * j + n[1] * 1.32
        B.b('service_wing_louver_frame', (x, 5.7, z), (1.2, 1.6, .12), 'structure_graphite_joints', .02, a + 90)
        for yy in [5.2, 5.55, 5.9, 6.25]:
            B.b('service_wing_louver', (x + n[0] * .04, yy, z + n[1] * .04), (1.0, .07, .06), 'brushed_titanium', .01, a + 90)
    use('MF_Roof')
    x, z = cx - t[0] * 1.2, cz - t[1] * 1.2
    cyl('service_wing_tank', (x, 8.15, z), .95, 1.6, B.M['brushed_titanium'], 20, .06)
    x, z = cx + t[0] * 1.6, cz + t[1] * 1.6
    B.b('service_wing_unit', (x, 7.75, z), (1.8, .8, 1.4), 'structure_graphite_joints', .05, a + 90)


def interior():
    """The retained 1.0.1 plan: inlays, hub, partitions (trimmed to the new envelope), corridor, bay, court."""
    for room in C['hq']['rooms']:
        use('MF_Interior_' + room)
        key = 'room_dispatch_marshalling' if room == 'dispatch' else 'room_' + room
        poly = C['movement'][key]['polygon']
        B.slab(room + '_floor_inlay', poly, FLOOR + .002, FLOOR + .025, 'room_inlay_' + room, .015)
        for i, a in enumerate(poly):
            bb = poly[(i + 1) % len(poly)]
            B.strip(room + '_floor_reveal', a, bb, FLOOR + .026, 'brushed_titanium', .07)
    use('MF_BaseFixed')
    B.slab('hub_inlay', hex_points(5.72), FLOOR + .001, FLOOR + .018, 'structure_graphite_joints')
    for phi in [30, 90, 150, 210, 270, 330]:
        a, bb = flat_segment(phi, HUB_APOTHEM)
        x, z = radial(phi, HUB_APOTHEM)
        wall('hub_parapet', a, bb, FLOOR, FLOOR + 1.1, .26, B.M['structure_ivory_ceramic'], [(x, z, 2.4, 3.8)])
        for edge in [-1, 1]:
            tx, tz = dirv(phi + 90)
            B.b('hub_door_marker', (x + tx * edge * 1.34, FLOOR + 1.1, z + tz * edge * 1.34), (.15, .06, .25), 'practical_console_cyan', .02, phi)
    for x, z in hex_points(6):
        cyl('hub_column', (x, 6.5, z), .3, 4.4, B.M['brushed_titanium'], 16, .04)
    table = [cyl('hub_table_plinth', (0, 4.72, 0), 1.05, .84, B.M['structure_graphite_joints']), cyl('hub_table', (0, 5.24, 0), 1.5, .2, B.M['console_blue_glass'])]
    ring('hub_table_edge', (0, 5.36, 0), 1.36, .055, B.M['practical_console_cyan'], 48, 6); B.obstacle('hub_table', table)
    # Partitions end inside the structural spines (15.5 +- .85) instead of at the hex corners.
    for phi in [0, 60, 120, 180, 300]:
        a, bb = radial(phi, 6.25), radial(phi, 15.2)
        use('MF_BaseFixed'); wall('partition_' + str(phi), a, bb, FLOOR, FLOOR + 1.2, .3, B.M['structure_ivory_ceramic'])
        use('MF_ShellCutaway_PartitionGlass'); glazed_upper('partition_glass_' + str(phi), a, bb, FLOOR + 1.2, 8.6, B.M['glass_partition'], B.M['brushed_titanium'])
    for x in [-2.15, 2.15]:
        a, bb = (x, 5.6), (x, 15.1)
        use('MF_BaseFixed'); wall('dispatch_corridor', a, bb, FLOOR, FLOOR + 1.2, .3, B.M['structure_ivory_ceramic'])
        use('MF_ShellCutaway_PartitionGlass'); glazed_upper('corridor_glass', a, bb, FLOOR + 1.2, 8.3, B.M['glass_partition'], B.M['brushed_titanium'])
    # Projecting loading bay with a recessed shutter entrance and canopy.
    use('MF_BaseFixed'); B.b('bay_foundation', (0, 4.11, 18.59), (10.8, .30, 6.02), 'structure_graphite_joints')
    use('MF_Interior_dispatch'); B.b('bay_floor', (0, 4.285, 18.59), (10.2, .03, 6.02), 'room_inlay_dispatch')
    for side in [-1, 1]:
        use('MF_BaseFixed' if side == -1 else 'MF_ShellCutaway_FrontFlats')
        wall('bay_side', (side * 5.1, 15.58), (side * 5.1, 21.6), FLOOR, 8.08, .6, B.M['structure_ivory_ceramic'])
        B.strip('bay_side_lamp', (side * 5.42, 16), (side * 5.42, 21), 7.55)
        B.b('bay_side_band', (side * 5.42, 4.27, 18.6), (.12, .5, 5.9), 'structure_graphite_joints', .02)
    use('MF_ShellCutaway_FrontFlats')
    wall('bay_front', (-5.4, 21.3), (5.4, 21.3), FLOOR, 8.28, .6, B.M['structure_ivory_ceramic'], [(0, 21.3, 4.6, 4.2)])
    for x in [-2.6, 2.6]:
        B.b('bay_door_jamb', (x, 6.4, 21.66), (.42, 4.2, .34), 'brushed_titanium', .03)
    B.b('bay_door_head', (0, 8.62, 21.66), (5.8, .32, .34), 'brushed_titanium', .03)
    B.b('bay_shutter_track', (0, 8.42, 21.2), (4.6, .12, .3), 'structure_graphite_joints', .01)
    B.b('bay_entry_strip', (0, 8.52, 21.7), (4.4, .06, .08), 'practical_warm_strip', .005); light('practical_warm_strip', (0, 8.52, 21.8))
    use('MF_Roof'); B.b('bay_roof', (0, 8.16, 18.55), (10.8, .28, 6.15), 'structure_ivory_ceramic', .1)
    for x in [-3.5, 0, 3.5]: B.b('bay_roof_rib', (x, 8.34, 18.55), (.1, .1, 5.8), 'brushed_titanium')
    B.b('bay_canopy', (0, 8.7, 22.6), (7.6, .22, 2.2), 'brushed_titanium', .04)
    for x in [-3.4, 3.4]: B.b('bay_canopy_stay', (x, 8.2, 23.4), (.12, .9, .12), 'structure_graphite_joints', .01)
    # Court apron: paving with joints and edge markers inside the flat ground the field provides.
    use('MF_Court'); B.slab('court_apron', C2['movement']['court']['polygon'], GROUND - .04, COURT, 'court_weathered_basalt', .04)
    for x in range(-12, 13, 4): B.strip('court_paving_joint', (x, 21.8), (x, 26.8), COURT + .005, 'structure_graphite_joints', .045)
    for z in [17, 19, 22, 24, 26]:
        for side in [-1, 1]: B.strip('court_cross_joint', (side * 5.55, z), (side * 12.3, z), COURT + .005, 'structure_graphite_joints', .035)
    for x in [-11.6, 11.6]:
        B.strip('court_edge_marker', (x, 16.2), (x, 26.6), COURT + .018, 'utility_ochre', .12)
    use('MF_Practicals')
    for x, z in [(-11.8, 16.0), (-11.8, 26.6), (11.8, 16.0), (11.8, 26.6)]:
        B.b('court_bollard', (x, 4.81, z), (.34, 1.12, .34), 'brushed_titanium')
        B.b('court_bollard_cap', (x, 5.39, z), (.36, .08, .36), 'practical_station_marker')
        light('practical_station_marker', (x, 5.44, z))
    B.b('delivery_beacon', (4.9, 8.47, 20.7), (.22, .42, .22), 'practical_delivery_beacon'); light('practical_delivery_beacon', (4.9, 8.6, 20.7))
    equipment_v2()
    for room in C['hq']['rooms'].values():
        for s in room['sockets']: socket(s['id'], (s['xz'][0], s['y'], s['xz'][1]), s['facingDeg'])
    for s in C2['hq']['hubOverflowSockets'] + C2['hq']['courtSockets']: socket(s['id'], (s['xz'][0], s['y'], s['xz'][1]), s['facingDeg'])
    socket('base_label', C2['interactionSockets']['base_label'], 90)


def shell_v2():
    B.setup()
    for name in ['MF_BaseFixed', 'MF_ShellCutaway', 'MF_Interior', 'MF_Court', 'MF_Props', 'MF_Practicals', 'MF_Sockets', 'MF_Roof']:
        group(name)
    group('MF_ShellCutaway_FrontFlats', 'MF_ShellCutaway')
    group('MF_ShellCutaway_PartitionGlass', 'MF_ShellCutaway')
    for room in C['hq']['rooms']: group('MF_Interior_' + room, 'MF_Interior')
    use('MF_BaseFixed')
    # Foundation and floor follow the lobed footprint: a shallow plinth disc the bays stand on.
    B.slab('foundation_plinth', arc_points(0, 360, 17.75, 4.0)[:-1], GROUND - .08, FLOOR - .14, 'structure_graphite_joints', .06)
    B.slab('hq_floor', arc_points(0, 360, 17.55, 4.0)[:-1], FLOOR - .17, FLOOR, 'court_weathered_basalt')
    for spec in LOBES: lobe(spec)
    spines(); service_wing(); drum(); roof_equipment(); interior()
    return finish_v2('hq-shell', ['MF_BaseFixed', 'MF_ShellCutaway', 'MF_Interior', 'MF_Court', 'MF_Props', 'MF_Practicals', 'MF_Sockets', 'MF_Roof'],
                     {'obstacles': list(B.OBSTACLES), 'lights': list(LIGHTS), 'doors': C2['hq']['doors'],
                      'sockets': [{'id': o.name, 'position': list(gl(o.location)), 'facingDeg': o.get('facingDeg', 90)} for o in bpy.data.objects['MF_Sockets'].children],
                      'envelope': {'maxRadius': ENVELOPE_R, 'drumTop': DRUM_TOP}})
