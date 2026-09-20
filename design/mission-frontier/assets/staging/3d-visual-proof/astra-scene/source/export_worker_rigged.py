"""Rig the retained cinematic robot and export it with its four motion clips.

  /Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python export_worker_rigged.py

The authored robot is 80 unparented rigid parts. `export_worker.py` exported them flat with one clip,
`worker_tool_work`, which left the runtime hand-swinging each leg part about a computed hip pivot in
`worker-gait.ts`, and left four of the six work actions with no motion at all.

Nothing about the robot is redesigned here. The geometry, materials and lighting come from the same
retained production script, and every joint pivot and pose below is lifted from the two scripts that
already own them: `original-worker-production.py` (which builds each limb around an explicit pivot)
and `living-world/astra/source/rebuild-living-worker.py` (which already authored walk, scan and type
as sprite frames, including the two-link leg IK). This script gives those pivots a parent hierarchy
and those poses a glTF clip.

The hierarchy is plain empties, not an armature. The parts are rigid, so nothing needs skin weights;
a parent node per joint is enough, and the runtime's `batchWorker` already turns any node hierarchy
into a bone palette. Rotating `rig_thigh_L` now carries the shin and the foot with it.
"""
import bpy, math, json, struct, hashlib, sys
from pathlib import Path
from mathutils import Vector, Matrix

OUT = Path(__file__).resolve().parents[1]
SOURCE = OUT / 'source/original-worker-production.py'
source = SOURCE.read_text(); lines = source.splitlines()
lines[4] = 'R=Path(' + repr(str(OUT)) + ');(R/"renders").mkdir(exist_ok=True);(R/"blend").mkdir(exist_ok=True)'
exec('\n'.join(lines).split("render('worker-idle')")[0], globals())
for o in list(bpy.data.objects):
    if o not in groups['worker']:
        bpy.data.objects.remove(o, do_unlink=True)

# `turn` (a quarter turn about Z) has already been applied to every part by the production script, so
# world space here is the authored frame turned. Pivots are authored coordinates put through the same
# turn, exactly as rebuild-living-worker.py does.
def P(v):
    return turn @ Vector(v)

# Authored pivots. y is the side: the tool arm is the y<0 side, which is named L here.
HIP_Z, KNEE_Z, ANKLE_Z = 1.1, 0.73, 0.28
NECK = (0.0, 0.0, 1.88)
SIDES = {'L': -1, 'R': 1}
# Part-name chains, from rebuild-living-worker.py. `ankle bearing` is omitted: that part is added by
# the sprite rebuild and does not exist in the production geometry.
CHAINS = {
    'thigh': ['thigh', 'thigh armour', 'knee', 'knee actuator outer pin'],
    'shin': ['shin', 'shin shell', 'shin longitudinal plate seam'],
    'foot': ['segmented foot', 'foot ceramic toe'],
    'shoulder': ['upper arm', 'upper arm inset vent', 'upper arm fastener', 'elbow bearing'],
    'forearm': ['forearm', 'hand gripper', 'finger proximal segment', 'finger hinge',
                'finger distal segment', 'compact fabrication probe', 'probe ceramic grip collar',
                'probe machined tip'],
}
HEAD = ['round ceramic head', 'dark friendly visor', 'blue eye', 'ear joint', 'ear cap',
        'ear cap recessed bolt', 'helmet crown gasket']

parts = {o.name: o for o in groups['worker']}
local = {n: (turn.inverted() @ o.matrix_world).translation for n, o in parts.items()}


def match(stems, side=None):
    return [n for n in parts
            if any(n == s or n.startswith(s + '.') for s in stems)
            and (side is None or local[n].y * side > 0)]


def empty(name, world, parent=None):
    o = bpy.data.objects.new(name, None)
    o.empty_display_size = 0.08
    bpy.context.scene.collection.objects.link(o)
    o.matrix_world = Matrix.Translation(world)
    if parent:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o


bpy.context.view_layer.update()
# `MF_Worker` is a static node: it carries the normalising transform applied at the end and is never
# keyframed, because a location track on it would fight that transform. `rig_body` is the animated
# body -- everything hangs off it, and the walk's crouch is its own translation.
root = empty('MF_Worker', Vector((0, 0, 0)))
body = empty('rig_body', Vector((0, 0, 0)), root)
joints = {'body': body, 'head': empty('rig_head', P(NECK), body)}
for tag, side in SIDES.items():
    y = side * 0.22
    thigh = empty(f'rig_thigh_{tag}', P((-.02, y, HIP_Z)), body)
    shin = empty(f'rig_shin_{tag}', P((-.02, y, KNEE_Z)), thigh)
    foot = empty(f'rig_foot_{tag}', P((-.02, y, ANKLE_Z)), shin)
    arm_y = side * 0.4
    shoulder = empty(f'rig_shoulder_{tag}', P((0, arm_y, 1.67)), body)
    forearm = empty(f'rig_forearm_{tag}', P((.08, arm_y * 1.2, 1.28)), shoulder)
    joints.update({f'thigh_{tag}': thigh, f'shin_{tag}': shin, f'foot_{tag}': foot,
                   f'shoulder_{tag}': shoulder, f'forearm_{tag}': forearm})

assigned = set()


def attach(names, joint):
    for n in names:
        o = parts[n]
        world = o.matrix_world.copy()
        o.parent = joint
        o.matrix_parent_inverse = joint.matrix_world.inverted()
        o.matrix_world = world
        assigned.add(n)


for tag, side in SIDES.items():
    for chain, stems in CHAINS.items():
        attach(match(stems, side), joints[f'{chain}_{tag}'])
attach(match(HEAD), joints['head'])
# Everything else is the torso, which is the root: chest, pelvis, neck, shoulder bearings, hub plate.
attach([n for n in parts if n not in assigned], body)
bpy.context.view_layer.update()

REST = {name: (j.location.copy(), j.rotation_euler.copy()) for name, j in joints.items()}


def pose(joint, x=0.0, z=0.0, dz=None):
    """Swing a joint. The authored motion rotates about world (-1,0,0); a joint at rest has identity
    axes, so that is a negative rotation about its own X."""
    j = joints[joint]
    j.location = REST[joint][0].copy()
    if dz is not None:
        j.location.z += dz
    j.rotation_euler = (-x, 0.0, z)


def rest_all():
    for name, j in joints.items():
        j.location, j.rotation_euler = REST[name][0].copy(), REST[name][1].copy()


# Two-link leg IK and every pose angle below are rebuild-living-worker.py's, unchanged.
STRIDE, LIFT, L1, L2 = .35, .18, .37, .45
BODY_DROP = -.08


def walk(p, tag, side):
    # The phase runs backwards against the sprite rebuild's. That build carried no root motion -- the
    # caller translated the sprite and chose its direction -- so its cycle lifts the foot while the
    # foot slides forward, which advances a root-motion-free body backwards. Negating the phase puts
    # the support phase where the foot slides back, so playing the clip forwards walks forwards.
    cycle = -p + (math.pi if side > 0 else 0)
    dx = STRIDE * math.cos(cycle)
    dz = .28 + LIFT * max(0, math.sin(cycle)) - 1.02
    knee = math.acos(max(-1, min(1, (dx * dx + dz * dz - L1 * L1 - L2 * L2) / (2 * L1 * L2))))
    hip = math.atan2(-dx, -dz) - math.atan2(L2 * math.sin(knee), L1 + L2 * math.cos(knee))
    pose(f'thigh_{tag}', hip); pose(f'shin_{tag}', knee); pose(f'foot_{tag}', -hip - knee)
    pose(f'shoulder_{tag}', .28 * math.cos(cycle)); pose(f'forearm_{tag}', -.12)
    # Planted while the lift is zero; the ground it covers over that half cycle is the stride.
    return dx, LIFT * max(0, math.sin(cycle)) <= 1e-9


def clip_walk(p):
    joints['body'].location = REST['body'][0].copy(); joints['body'].location.z += BODY_DROP
    for tag, side in SIDES.items():
        walk(p, tag, side)
    pose('head', 0.0, .035 * math.sin(p))


def clip_scan(p):
    for tag, side in SIDES.items():
        upper = (-.78 + .10 * math.sin(p)) if side < 0 else (-.30 + .07 * math.cos(p))
        elbow = (-.66 + .12 * math.sin(p + .7)) if side < 0 else -.45
        pose(f'shoulder_{tag}', upper); pose(f'forearm_{tag}', elbow)
    pose('head', -.07 + .09 * math.cos(p), .22 * math.sin(p))


def clip_type(p):
    for tag, side in SIDES.items():
        cycle = p + (math.pi if side > 0 else 0)
        pose(f'shoulder_{tag}', -.78 + .065 * math.sin(cycle))
        pose(f'forearm_{tag}', -.70 + .13 * math.sin(cycle + .3))
    pose('head', .10 + .025 * math.cos(p))


def clip_tool(p):
    """The clip the flat export already shipped: the tool arm only, feet planted."""
    pose('shoulder_L', -.72 + .020 * math.sin(p))
    pose('forearm_L', -.45 + .035 * (math.sin(p + .6) - math.sin(.6)))


# Each loop closes on itself: the last key repeats the first, so the clip has no seam.
CLIPS = [('worker_walk', clip_walk, 8), ('worker_scan', clip_scan, 8),
         ('worker_type', clip_type, 8), ('worker_tool_work', clip_tool, 12)]
FPS = 10
S.render.fps = FPS; S.render.fps_base = 1
planted = []
for name, fn, steps in CLIPS:
    # Frame 0, not frame 1: a clip keyed from frame 1 exports sampler times starting at 0.1 s, and
    # the mixer then holds the first pose through a dead tenth of a second on every loop.
    for i in range(steps + 1):
        S.frame_set(i)
        rest_all()
        fn(math.tau * i / steps)
        if name == 'worker_walk':
            bpy.context.view_layer.update()
            planted.append((i / steps, joints['foot_L'].matrix_world.translation.copy(),
                            LIFT * max(0, math.sin(math.tau * i / steps)) <= 1e-9))
        for j in joints.values():
            j.keyframe_insert(data_path='location', frame=i)
            j.keyframe_insert(data_path='rotation_euler', frame=i)
    # Push to an NLA track named for the clip and detach, so the next clip keyframes a fresh action.
    # `animation_data_clear()` would drop the tracks already pushed, leaving only the last clip.
    for j in joints.values():
        action = j.animation_data.action
        action.name = f'{name}:{j.name}'
        action.use_fake_user = True
        track = j.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        j.animation_data.action = None
    print(f'CLIP {name} keys={steps + 1} duration={steps / FPS:.2f}s')

# Normalise exactly as the flat export did: face glTF +Z, stand on y=0, 1.8 m tall. The root carries
# it, so every part and every authored pivot moves with it and no keyframe needs rescaling.
rest_all()
S.frame_set(0)
bpy.context.view_layer.update()
pts = [o.matrix_world @ Vector(v) for o in groups['worker'] for v in o.bound_box]
lo = min(v.z for v in pts); hi = max(v.z for v in pts)
scale = 1.8 / (hi - lo)
root.matrix_world = Matrix.Scale(scale, 4) @ Matrix.Translation((0, 0, -lo)) @ Matrix.Rotation(math.pi, 4, 'Z')
bpy.context.view_layer.update()
# The retained roughness override from the flat export.
for m in bpy.data.materials:
    if m.use_nodes:
        p = m.node_tree.nodes.get('Principled BSDF')
        if p:
            for link in list(p.inputs['Roughness'].links):
                m.node_tree.links.remove(link)
            p.inputs['Roughness'].default_value = .38

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT / 'worker.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_optimize_animation_size=False, export_bake_animation=True)

raw = (OUT / 'worker.glb').read_bytes()
doc = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
clips = {a['name']: len(a['channels']) for a in doc.get('animations', [])}
# Measured, not assumed: the planted foot's travel in the authored frame over its support half of the
# cycle is the ground one leg covers, and both legs support once per cycle. `sign` says which way the
# body travels -- a foot sliding towards +Y (the authored forward) carries the body towards -Y.
# The first and last sample of a closed loop are the same pose, so the span of the planted ankle is
# the honest measure rather than last-minus-first. One leg's support covers that span of ground, and
# both legs support once per cycle.
support = [v.y for _, v, on_ground in planted if on_ground]
span = (max(support) - min(support)) if len(support) > 1 else 0.0
stride_metres = round(span * 2 * scale, 4)
(OUT / 'worker-metadata.json').write_text(json.dumps({
    'height': 1.8, 'forward': '+Z', 'origin': 'feet',
    'provenance': 'Existing cinematic-v1 authored worker geometry; no character redesign. Joint '
                  'hierarchy and clips built from the pivots and poses already owned by '
                  'original-worker-production.py and rebuild-living-worker.py.',
    'sourceScriptSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'buildScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'meshObjects': len(groups['worker']),
    'rigJoints': sorted(j.name for j in joints.values()),
    'animations': {name: {'channels': clips.get(name, 0),
                          'durationSeconds': round(steps / FPS, 3),
                          'loops': True} for name, _, steps in CLIPS},
    'walk': {'strideMetresPerCycle': stride_metres,
             'note': 'Ground covered by one full worker_walk cycle. Scale the clip by '
                     'speed / (strideMetresPerCycle / durationSeconds) so the feet do not skate.'},
}, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'worker.blend'))
print('WORKER_RIGGED', json.dumps({'bytes': len(raw), 'nodes': len(doc['nodes']),
                                   'skins': len(doc.get('skins', [])), 'clips': clips,
                                   'strideMetresPerCycle': stride_metres,
                                   'supportSamples': len(support),
                                   'plantedSpanAuthored': round(span, 4)}))
