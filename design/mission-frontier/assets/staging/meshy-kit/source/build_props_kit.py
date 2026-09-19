"""Contract 2.0 hero props: the three scanned interior pieces the HQ shell reserved room for.

  /Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python build_props_kit.py -- <meshy_root> <out_dir>

`hq-shell.glb` ships an `MF_Props` root with no children, and the contract already names the sockets
these pieces belong on -- `hq_planning_table_*`, `hq_testing_bench_*`, `hq_dispatch_bay_*`. Rather
than rebuild the shell (whose producer receipt is hash-bound), the props ship as their own GLB and
the runtime anchors them to those sockets.

Each prop is decimated, its textures resized and its geometry scaled to a stated metre size, then
re-anchored to stand on ground centre with +Y forward -- the direction a socket's `facingDeg` turns.
Emissive parts are renamed into the colony's material conventions so `ProofBase` drives them with
the same dusk response as the rest of the interior, with no runtime special-casing.
"""
import bpy, sys, json, struct, hashlib
from pathlib import Path
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
MESHY = Path(argv[0]); OUT = Path(argv[1])
OUT.mkdir(parents=True, exist_ok=True)

# root -> (meshy asset, triangle target, texture px, height in metres, material name)
#
# Heights come from the floor plan's own equipment list, not taste. Planning is specified as a
# "plan holo-table 3.0x2.0"; at 1.05 m the scan lands at 3.05 x 3.06, which is that table. Testing's
# "diagnostic bench at radial 9" is the rig at 1.7 m, which keeps its footprint inside the 4 m gap
# between the two inner-row sockets that face it. Dispatch's "crate stack pad" is 1.6 x 1.6, so the
# battery is sized to 1.06 m, where the scan is 1.55 m wide and sits on the pad rather than over it.
#
# `ambient_` and `practical_` prefixes are load-bearing: ProofBase drives emissiveIntensity by
# material-name prefix, so a screen named this way brightens at dusk for free. `structure_` stays
# unlit. Nothing here is named `identity_`: these are fixtures, never project-tinted.
PROPS = {
    'MF_Prop_PlanningTable': ('planningHoloTable.V2', 6000, 512, 1.05, 'ambient_screen_service'),
    'MF_Prop_TestRig':       ('testingRig.V2',        7000, 512, 1.70, 'practical_console_cyan'),
    'MF_Prop_CargoBattery':  ('cargoBattery.V2',      4000, 512, 1.06, 'practical_warm_strip'),
}
BUDGET_BYTES = 2_500_000; BUDGET_TRIS = 20_000

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def tri_count(o):
    o.data.calc_loop_triangles(); return len(o.data.loop_triangles)

def decimate(o, target):
    cur = tri_count(o)
    if target >= cur: return cur
    m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = target / cur
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)
    return tri_count(o)

def bounds(o):
    pts = [o.matrix_world @ Vector(v) for v in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi

def apply(o, location=False, scale=False):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=location, rotation=False, scale=scale)

report = {}
for root_name, (asset, tris, px, height, material) in PROPS.items():
    src = MESHY / asset / f'{asset}.glb'
    assert src.exists(), src
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(src))
    fresh = [o for o in set(bpy.data.objects) - before if o.type == 'MESH']
    assert len(fresh) == 1, (root_name, fresh)
    o = fresh[0]
    o.parent = None
    for extra in set(bpy.data.objects) - before:
        if extra is not o and extra.type == 'EMPTY':
            bpy.data.objects.remove(extra, do_unlink=True)

    got = decimate(o, tris)
    # Meshy normalises every export into a ~2 unit box, so real scale is gone.
    lo, hi = bounds(o)
    o.scale = (height / max(hi.z - lo.z, 1e-6),) * 3
    bpy.context.view_layer.update()
    apply(o, scale=True)

    # Stand on ground centre: a socket gives a floor point, and the runtime adds no vertical offset.
    lo, hi = bounds(o)
    ctr = (lo + hi) / 2
    o.location -= Vector((ctr.x, ctr.y, lo.z))
    apply(o, location=True)

    o.name = f'{root_name}_body'
    o.data.materials[0].name = material
    root = bpy.data.objects.new(root_name, None)
    scene.collection.objects.link(root)
    o.parent = root
    o.matrix_parent_inverse = root.matrix_world.inverted()

    lo, hi = bounds(o)
    report[root_name] = dict(asset=asset, triangles=got, texturePx=px,
                             size=[round(hi.x-lo.x,3), round(hi.z-lo.z,3), round(hi.y-lo.y,3)],
                             footprintRadius=round(max(hi.x-lo.x, hi.y-lo.y)/2, 3),
                             material=material)
    print(f'PROP {root_name:<24} {asset:<24} {got:>6} tris  {px}px  h={height:.2f}m')

    for im in list(bpy.data.images):
        if im.users and (im.size[0] > px or im.size[1] > px):
            im.scale(min(px, im.size[0]), min(px, im.size[1]))

for im in bpy.data.images:
    if im.users: im.pack()

bpy.context.view_layer.update()
path = OUT / 'props-kit.glb'
bpy.ops.export_scene.gltf(
    filepath=str(path), export_format='GLB', export_apply=True, export_yup=True,
    export_cameras=False, export_lights=False,
    export_image_format='WEBP', export_image_quality=85,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12)

raw = path.read_bytes()
gltf = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
summary = {'file': 'props-kit.glb', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
           'images': len(gltf.get('images', [])), 'props': report,
           'budget': {'bytes': BUDGET_BYTES, 'triangles': BUDGET_TRIS},
           'compression': {'geometry': 'KHR_draco_mesh_compression', 'textures': 'EXT_texture_webp q85'},
           'origin': 'Meshy scans (meshy_output) for the three interior hero props the HQ shell reserved MF_Props for'}
(OUT / 'props-metadata.json').write_text(json.dumps(summary, indent=2) + '\n')
print('PROPS_COMPLETE', json.dumps({'bytes': len(raw), 'MB': round(len(raw)/1048576, 2),
      'images': summary['images'], 'triangles': sum(p['triangles'] for p in report.values()),
      'extensions': gltf.get('extensionsUsed', [])}))
