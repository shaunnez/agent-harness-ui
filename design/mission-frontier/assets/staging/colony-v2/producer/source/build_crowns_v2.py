"""Contract 2.0 crowns: the four accepted looks re-fitted onto the hub drum (base 11.65, fit radius 11.3).

The shell owns the roof now, so a crown file carries only the crown: no hex deck. Kit pieces are appended
read-only from the Astra blends and re-seated exactly as 1.0.1 did; Bastion is re-authored at the new base.
"""
import math
from v2_lib import *  # noqa: F401,F403
from v2_lib import B, CROWN_BASE, CROWN_FIT_R, CROWN_MAX, finish_v2
from build_crowns import reseat  # 1.0.1 helper: append by prefix, ground on y_base, fit inside radius


def crown_start():
    B.setup(); group('MF_Roof'); group('MF_Roof_Crown', 'MF_Roof'); use('MF_Roof_Crown')
    # A shallow seat ring ties every crown to the drum reveal.
    cyl('crown_seat', (0, CROWN_BASE - .03, 0), CROWN_FIT_R - .2, .08, B.M['structure_graphite_joints'], 48, .01)
    ring('crown_identity_trim', (0, CROWN_BASE + .03, 0), CROWN_FIT_R - .45, .05, B.M['identity_trim'], 64, 8)


def fit(kit, prefixes):
    return reseat(kit, prefixes, radius=CROWN_FIT_R, y_base=CROWN_BASE + .05, height_max=CROWN_MAX)


def crown_command():
    crown_start()
    objs, s = fit(KIT_COMMAND, ('central_roof_service_cap', 'command_clerestory', 'core_dark_collar', 'core_ivory_drum',
                                'core_upper_recess', 'identity_', 'roof_sensor_'))
    return finish_v2('crown-command', ['MF_Roof'], {'reseatScale': round(s, 4)})


def crown_relay():
    crown_start()
    objs, s = fit(KIT_RELAY, ('relay_asymmetric_service_tower', 'relay_tower_', 'relay_parabolic_dish', 'relay_dish_pedestal',
                              'relay_receiver_rim', 'relay_feed_', 'relay_roof_service_housing', 'relay_roof_service_fin',
                              'relay_front_clerestory', 'relay_side_clerestory', 'identity_'))
    use('MF_Roof_Crown')
    for phi in [150, 210, 270]:
        x, z = radial(phi, 7.6)
        cyl('relay_mast', (x, CROWN_BASE + 1.5, z), .1, 2.6, B.M['brushed_titanium'], 12)
        cyl('relay_mast_head', (x, CROWN_BASE + 2.9, z), .24, .2, B.M['ambient_sensor_navigation'], 12)
    return finish_v2('crown-relay', ['MF_Roof'], {'reseatScale': round(s, 4)})


def crown_foundry():
    crown_start()
    objs, s = fit(KIT_FOUNDRY, ('foundry_segmented_barrel_vault', 'foundry_closed_gable', 'foundry_vent_bank', 'foundry_vent_louver',
                                'foundry_rear_utility_silo', 'foundry_silo_', 'foundry_identity_platform', 'foundry_crown_identity_seam',
                                'identity_'))
    return finish_v2('crown-foundry', ['MF_Roof'], {'reseatScale': round(s, 4)})


def crown_bastion():
    """Bastion: a stepped keep with a tinted disc and ring, buttresses and turrets, on the drum."""
    crown_start(); use('MF_Roof_Crown'); y = CROWN_BASE
    B.slab('bastion_keep_lower', hex_points(6.9), y, y + 1.5, 'structure_ivory_ceramic', .08)
    B.slab('bastion_keep_band', hex_points(7.05), y + 1.0, y + 1.28, 'structure_graphite_joints', .04)
    B.slab('bastion_keep_upper', hex_points(4.9), y + 1.5, y + 3.2, 'structure_ivory_ceramic', .08)
    B.slab('bastion_keep_cap', hex_points(5.1), y + 3.2, y + 3.5, 'brushed_titanium', .05)
    cyl('identity_coloured_disc', (0, y + 3.57, 0), 2.6, .14, B.M['identity_roof_inset'], 48, .03)
    ring('identity_illuminated_ring', (0, y + 3.55, 0), 3.2, .09, B.M['identity_roof_ring'], 64, 8)
    for phi in [0, 60, 120, 180, 240, 300]:
        x, z = radial(phi, 6.7)
        B.b('bastion_buttress', (x, y + .75, z), (.8, 1.5, .8), 'brushed_titanium', .1, phi)
    for phi in [30, 90, 150, 210, 270, 330]:
        n = dirv(phi); t = dirv(phi + 90)
        for j in [-1.3, 0.0, 1.3]:
            x, z = n[0] * 6.15 + t[0] * j, n[1] * 6.15 + t[1] * j
            B.b('bastion_clerestory_recess', (x, y + .95, z), (1.05, .45, .12), 'structure_graphite_joints', .02, phi + 90)
            B.b('bastion_clerestory_glass', (x + n[0] * .06, y + .95, z + n[1] * .06), (.88, .28, .05), 'practical_warm_window_glass', .01, phi + 90)
        B.b('bastion_identity_trim', radial(phi, 4.95, y + 2.5), (2.4, .12, .16), 'identity_trim', .02, phi + 90)
    for phi in [0, 60, 120, 180, 240, 300]:
        x, z = radial(phi, 7.7)
        cyl('bastion_turret', (x, y + .8, z), .75, 1.6, B.M['structure_ivory_ceramic'], 24, .06)
        cyl('bastion_turret_collar', (x, y + 1.66, z), .83, .14, B.M['structure_graphite_joints'], 24, .02)
        cyl('bastion_turret_lamp', (x, y + 1.78, z), .26, .1, B.M['practical_station_marker'], 16)
    cyl('bastion_mast', (0, y + 3.85, 0), .1, .7, B.M['brushed_titanium'], 12)
    cyl('bastion_mast_beacon', (0, y + 4.3, 0), .2, .18, B.M['ambient_sensor_navigation'], 12)
    return finish_v2('crown-bastion', ['MF_Roof'])


CROWNS = {'command': crown_command, 'relay': crown_relay, 'foundry': crown_foundry, 'bastion': crown_bastion}
