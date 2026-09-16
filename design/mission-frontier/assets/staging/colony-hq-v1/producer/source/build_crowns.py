"""Slice 2A crowns for the shared hex shell: Relay and Foundry re-seat the accepted kit rooflines, Bastion is new.

Every crown shares the Command crown's sealed hex roof deck so the four looks swap on one shell and one
room table. Kit components are appended read-only from the Astra blends, grounded on the deck and fitted
inside the hex eaves; identity_* materials stay neutral for runtime tinting.
"""
import bpy, math
from mathutils import Vector, Matrix
from hq_lib import *
import build_hq as B

DECK_TOP = 9.82
# The validator requires every crown vertex inside the hex + 1.5 m eaves and below 18.5 m; a footprint
# inside this circle satisfies both flat projections and the runtime label anchor at 19.5 m.
FIT_RADIUS = 15.0
HEIGHT_MAX = 17.9


def roof_base():
    """The Command crown's roof deck: gasket, ceramic deck, titanium perimeter reveals and sector seams."""
    B.setup(); group('MF_Roof'); group('MF_Roof_Crown', 'MF_Roof'); use('MF_Roof')
    B.slab('hex_roof_gasket', hex_points(18.35), 9.22, 9.58, 'structure_graphite_joints', .05)
    B.slab('hex_roof_deck', hex_points(18.18), 9.58, DECK_TOP, 'structure_ivory_ceramic', .06)
    for phi in [30, 90, 150, 210, 270, 330]:
        a, bb = flat_segment(phi, 15.68)
        B.strip('roof_perimeter_reveal', a, bb, 9.85, 'brushed_titanium', .11)
        B.strip('roof_sector_seam', radial(phi - 30, 7), radial(phi - 30, 17.8), 9.845, 'structure_graphite_joints', .07)


def reseat(kit, prefixes, radius=FIT_RADIUS, y_base=DECK_TOP, height_max=HEIGHT_MAX, centre=(0.0, 0.0)):
    """Append kit roof components by name prefix, ground them on the deck and fit them inside `radius`."""
    with bpy.data.libraries.load(str(kit), link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(prefixes)]
    objs = []
    for o in dst.objects:
        if o is None: continue
        bpy.context.scene.collection.objects.link(o); bpy.context.view_layer.update()
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw; objs.append(o)
    bpy.context.view_layer.update()
    lo, hi = bbox_world(objs)                       # Blender axes: x, y = -z(glTF), z = y(glTF)
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    half_diagonal = math.hypot(hi.x - lo.x, hi.y - lo.y) / 2
    s = min(1.0, radius / half_diagonal, (height_max - y_base) / max(0.1, hi.z - lo.z))
    pivot = Vector((cx, cy, lo.z))
    M = Matrix.Translation(Vector((centre[0], -centre[1], y_base))) @ Matrix.Scale(s, 4) @ Matrix.Translation(-pivot)
    for o in objs:
        o.matrix_world = M @ o.matrix_world; o.parent = bpy.data.objects['MF_Roof_Crown']
    dedupe_datablocks()
    return objs, s


def crown_relay():
    """Relay: the asymmetric service tower, parabolic dish and louvred housings from the accepted Relay roof."""
    roof_base()
    objs, s = reseat(KIT_RELAY, (
        'relay_asymmetric_service_tower', 'relay_tower_', 'relay_parabolic_dish', 'relay_dish_pedestal',
        'relay_receiver_rim', 'relay_feed_', 'relay_roof_service_housing', 'relay_roof_service_fin',
        'relay_front_clerestory', 'relay_side_clerestory', 'identity_'))
    use('MF_Roof')
    for phi in [150, 210, 270]:
        # Antenna field on the rear sectors: masts with sensor heads, restrained and within the eaves.
        x, z = radial(phi, 12.6)
        cyl('relay_mast', (x, 11.2, z), .11, 2.8, B.M['brushed_titanium'], 12)
        cyl('relay_mast_head', (x, 12.75, z), .26, .22, B.M['ambient_sensor_navigation'], 12)
        B.b('roof_neutral_identity_trim', radial(phi, 14.25, 9.89), (3, .035, .14), 'identity_trim', .02, phi + 90)
    return B.finish('crown-relay', ['MF_Roof'], {'reseatScale': round(s, 4)})


def crown_foundry():
    """Foundry: the segmented barrel vault, vent banks and twin utility silos from the accepted Foundry roof."""
    roof_base()
    objs, s = reseat(KIT_FOUNDRY, (
        'foundry_segmented_barrel_vault', 'foundry_closed_gable', 'foundry_vent_bank', 'foundry_vent_louver',
        'foundry_rear_utility_silo', 'foundry_silo_', 'foundry_identity_platform', 'foundry_crown_identity_seam',
        'identity_'))
    use('MF_Roof')
    for phi in [30, 330]:
        # Heat exchangers flank the front sectors so the vault reads as a working hall from the court.
        x, z = radial(phi, 12.4)
        B.b('roof_service_housing', (x, 10.08, z), (3.6, .48, 2.0), 'brushed_titanium', .13, phi + 90)
        for j in range(6):
            t = dirv(phi + 90)
            B.b('roof_heat_exchanger_fin', (x + t[0] * (j - 2.5) * .5, 10.36, z + t[1] * (j - 2.5) * .5), (.14, .14, 1.5), 'structure_graphite_joints', .025, phi + 90)
        B.b('roof_neutral_identity_trim', radial(phi, 14.25, 9.89), (3, .035, .14), 'identity_trim', .02, phi + 90)
    return B.finish('crown-foundry', ['MF_Roof'], {'reseatScale': round(s, 4)})


def crown_bastion():
    """Bastion: a stepped hex keep over the hub with a tinted disc and ring, buttresses and six corner turrets."""
    roof_base(); use('MF_Roof_Crown')
    B.slab('bastion_keep_lower', hex_points(9.6), DECK_TOP, 11.7, 'structure_ivory_ceramic', .08)
    B.slab('bastion_keep_band', hex_points(9.78), 11.1, 11.42, 'structure_graphite_joints', .04)
    B.slab('bastion_keep_upper', hex_points(6.9), 11.7, 13.9, 'structure_ivory_ceramic', .08)
    B.slab('bastion_keep_cap', hex_points(7.15), 13.9, 14.25, 'brushed_titanium', .05)
    cyl('identity_coloured_disc', (0, 14.32, 0), 3.4, .14, B.M['identity_roof_inset'], 48, .03)
    ring('identity_illuminated_ring', (0, 14.3, 0), 4.3, .09, B.M['identity_roof_ring'], 64, 8)
    for phi in [0, 60, 120, 180, 240, 300]:
        x, z = radial(phi, 9.4)
        B.b('bastion_buttress', (x, 10.75, z), (.9, 1.9, .9), 'brushed_titanium', .1, phi)
    for phi in [30, 90, 150, 210, 270, 330]:
        n = dirv(phi); t = dirv(phi + 90)
        for j in [-1.6, 0.0, 1.6]:
            x, z = n[0] * 9.65 + t[0] * j, n[1] * 9.65 + t[1] * j
            B.b('bastion_clerestory_recess', (x, 11.0, z), (1.2, .5, .12), 'structure_graphite_joints', .02, phi + 90)
            B.b('bastion_clerestory_glass', (x + n[0] * .06, 11.0, z + n[1] * .06), (1.0, .3, .05), 'practical_warm_window_glass', .01, phi + 90)
        B.b('bastion_identity_trim', radial(phi, 7.0, 12.9), (3.2, .12, .16), 'identity_trim', .02, phi + 90)
    use('MF_Roof')
    for phi in [0, 60, 120, 180, 240, 300]:
        x, z = radial(phi, 15.0)
        cyl('bastion_turret', (x, 10.7, z), 1.15, 1.8, B.M['structure_ivory_ceramic'], 24, .06)
        cyl('bastion_turret_collar', (x, 11.66, z), 1.25, .16, B.M['structure_graphite_joints'], 24, .02)
        cyl('bastion_turret_lamp', (x, 11.8, z), .32, .12, B.M['practical_station_marker'], 16)
    cyl('bastion_mast', (0, 15.4, 0), .12, 2.2, B.M['brushed_titanium'], 12)
    cyl('bastion_mast_beacon', (0, 16.55, 0), .22, .2, B.M['ambient_sensor_navigation'], 12)
    return B.finish('crown-bastion', ['MF_Roof'])


CROWNS = {'relay': crown_relay, 'foundry': crown_foundry, 'bastion': crown_bastion}
