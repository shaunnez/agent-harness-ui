"""Contract 2.0 hero props: the eight scanned interior pieces the HQ shell reserved room for.

  Blender -b -t 4 --python prepare_complex_props.py -- <meshy_root> <prepared_dir>
  Blender -b -t 4 --python build_props_kit.py -- <meshy_root> <out_dir> <prepared_dir>

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
PREPARED = Path(argv[2]) if len(argv) > 2 else OUT / 'prepared'
if not (PREPARED / 'preparation.json').exists():
    raise RuntimeError(f'Run prepare_complex_props.py first; missing {PREPARED / "preparation.json"}')
preparation = json.loads((PREPARED / 'preparation.json').read_text())

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
#
# The second five finish the list: `build_hq_v2.py` names the greybox that survived the first pass
# -- wall consoles, review dais, fabrication bench, briefing console, cart -- as the pieces with no
# scan yet, and these are those pieces. Their heights are solved backwards from the plan's stated
# plan size rather than picked, because each of them has a width the plan cares about and the scan's
# aspect is fixed:
#
#   WallConsole    the wall row's console is 1.86 m wide on a 3.4 m pitch; 2.60 m tall lands it at
#                  1.96 m, which keeps the pitch and matches the greybox's 2.82 m eye line.
#   FabCell        "fabrication bench 6.0x1.6 ... from radial 8 to 14": at 1.79 m tall the cell is
#                  2.00 m wide exactly, so a run of cells tiles the plan's span on whole metres.
#   ReviewStation  "circular review dais radius 1.6": 1.13 m tall makes the scan 3.20 m across.
#   IntakeDesk     the greybox scout display is 2.65 m wide and 2.82 m tall; 2.30 m gives 3.06 m,
#                  the widest the briefing front wall takes without crowding its court door.
#   ServiceCart    the cart pad is 2.6 x 1.7 and the greybox cart 2.25 m long; 1.07 m tall is that
#                  cart, 1.13 m deep, sitting inside the pad rather than over it.
#
# These five keep their 1024 px textures where the first three were halved to 512. They are not the
# same kind of map: Meshy tiled them 16x through KHR_texture_transform, so a 1024 atlas is already
# only 64 px per tile and halving it would show. They are webp to begin with and cost ~330 KB each.
# The last field is a metalness override, and only the later scans need one. Their atlas paints most
# of the hull metallic: Meshy renders that against its own environment and it reads as brushed dark
# metal, but the colony has no such environment, so in the scene the frames turn to mirrors. The
# first three scans came out dielectric and are left exactly as they were shipped. Roughness stays
# on its texture either way -- it is metalness, not gloss variation, that is wrong.
#
# `MF_Prop_FabCell` and `MF_Prop_ServiceCart` were generated twice. The first pass came back as
# melted lumps -- no wheels on the cart, no recognisable machine in the cell -- because Meshy's
# `should_remesh` defaults to *true* on meshy-7, which decimates to a game-ready shell before the
# texture bake. Flat-fronted pieces survive that; a gantry, a robot arm and caster wheels do not.
# Regenerated with `should_remesh: false`, they arrive at 3.2M and 1.5M triangles. Their high-genus
# topology stalls collapse, so prepare_complex_props.py remeshes and rebakes them before this build.
# They need no metalness override for the same reason those three
# do not: the un-remeshed exports are plain 4k atlases with no `KHR_texture_transform` tiling.
PROPS = {
    'MF_Prop_PlanningTable': ('planningHoloTable.V2',   6000,  512, 1.05, 'ambient_screen_service',  None),
    'MF_Prop_TestRig':       ('testingRig.V2',          7000,  512, 1.70, 'practical_console_cyan',  None),
    'MF_Prop_CargoBattery':  ('cargoBattery.V2',        4000,  512, 1.06, 'practical_warm_strip',    None),
    # 2k rather than the 3k the others get: this one is cloned twenty times in every HQ. The heights
    # are solved backwards from the greybox each scan replaces, because the scan's aspect is fixed
    # and it is the width, not the height, that has to keep the plan's spacing:
    #   WallConsole   2.75 m -> 1.83 x 0.72, against the greybox console's 1.86 x 0.72 on a 3.4 m pitch
    #   IntakeDesk    2.40 m -> 2.65 x 0.70, exactly the greybox scout display's width
    #   ReviewStation 1.36 m -> 3.21 across, the contract's "circular review dais radius 1.6"
    'MF_Prop_WallConsole':   ('MF_Prop_WallConsole',    2000, 1024, 2.75, 'ambient_screen_service',  0.0),
    'MF_Prop_IntakeDesk':    ('MF_Prop_IntakeDesk',     3000, 1024, 2.40, 'ambient_screen_service',  0.0),
    'MF_Prop_ReviewStation': ('MF_Prop_ReviewStation',  3000, 1024, 1.36, 'ambient_screen_service',  0.0),
    # Richer silhouettes than the wall pieces and decimated from millions, so they get more budget:
    #   FabCell      1.73 m -> 2.00 m wide, so three cells tile the plan's radial 8 to 14 on whole metres
    #   ServiceCart  1.06 m -> 2.25 m long, the greybox cart, inside the 2.6 x 1.7 cart pad
    'MF_Prop_FabCell':       ('MF_Prop_FabCell',        6000, 1024, 1.73, 'practical_console_cyan',  None),
    'MF_Prop_ServiceCart':   ('MF_Prop_ServiceCart',    5000, 1024, 1.06, 'practical_warm_strip',    None),
}
BUDGET_BYTES = 4_000_000; BUDGET_TRIS = 40_000

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def tri_count(o):
    o.data.calc_loop_triangles(); return len(o.data.loop_triangles)

def weld(o):
    """Merge coincident vertices, so collapse decimate has edges it can actually collapse.

    Meshy splits vertices at UV seams and shading breaks. Welding these duplicates at 10 microns
    in the import's ~2-unit box helps collapse, but cannot repair the FabCell / ServiceCart scan
    topology. Those meshes require the separate remesh and bake preparation.
    """
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode='OBJECT')


def decimate(o, target):
    """Collapse to a triangle target, in as many passes as it takes.

    One pass is not always enough. Blender's collapse decimate stalls well short of a very small
    ratio, and the un-remeshed scans arrive in the millions: 6,000 / 3,242,836 is a ratio of 0.0018
    and leaves the mesh an order of magnitude over target. Stepping down, never asking for more than
    a 20x cut at a time, avoids that single-pass limit. Anything that reaches its target in one pass
    -- which is every scan generated before this -- takes one pass and behaves exactly as it did.

    Re-welding between passes did not fix the FabCell / ServiceCart stalls (14,622 / 11,291).
    Their scan topology must be rebuilt and rebaked by prepare_complex_props.py first. A stalled
    reduction is an error, never permission to ship beyond the per-prop budget.
    """
    cur = tri_count(o)
    first = True
    while cur > target:
        if not first: weld(o)
        first = False
        m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'
        m.ratio = max(target / cur, 0.05)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=m.name)
        got = tri_count(o)
        if got >= cur: break
        cur = got
    if cur > target:
        raise RuntimeError(f'{o.name}: decimation stalled at {cur} triangles; target {target}')
    return cur

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
for root_name, (asset, tris, px, height, material, metal) in PROPS.items():
    src = MESHY / asset / f'{asset}.glb'
    assert src.exists(), src
    prepared = None
    if root_name in {'MF_Prop_FabCell', 'MF_Prop_ServiceCart'}:
        prepared = preparation[root_name]
        if hashlib.sha256(src.read_bytes()).hexdigest() != prepared['sourceSha256']:
            raise RuntimeError(f'{root_name}: prepared mesh belongs to a different source scan')
        src = PREPARED / f'{asset}.glb'
        if hashlib.sha256(src.read_bytes()).hexdigest() != prepared['sha256']:
            raise RuntimeError(f'{root_name}: prepared mesh hash mismatch')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(src))
    fresh = [o for o in set(bpy.data.objects) - before if o.type == 'MESH']
    assert len(fresh) == 1, (root_name, fresh)
    o = fresh[0]
    # Keep the world matrix across the unparent. The later exports are `KHR_mesh_quantization`, and
    # a quantized mesh carries its dequantization scale on the nodes above it -- drop the parent by
    # assignment alone and the mesh stays in 16-bit grid units, which the height fit below then
    # silently preserves, because it overwrites `o.scale` rather than multiplying into it. Baking
    # the scale here leaves `o.scale` at 1, which is what that fit assumes.
    world = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = world
    for extra in set(bpy.data.objects) - before:
        if extra is not o and extra.type == 'EMPTY':
            bpy.data.objects.remove(extra, do_unlink=True)
    bpy.context.view_layer.update()
    apply(o, scale=True)

    weld(o)
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
    mat = o.data.materials[0]
    mat.name = material
    if metal is not None:
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        # Cut the link as well as the value: the exporter keeps writing the atlas as the
        # metallicRoughness map either way, and a factor of 0 is what makes its blue channel inert.
        # Match the socket by node and name: each `bsdf.inputs[...]` access hands back a fresh
        # wrapper, so `is` against one never holds and the link would survive the removal.
        for link in [x for x in mat.node_tree.links
                     if x.to_node == bsdf and x.to_socket.name == 'Metallic']:
            mat.node_tree.links.remove(link)
        bsdf.inputs['Metallic'].default_value = metal
    root = bpy.data.objects.new(root_name, None)
    scene.collection.objects.link(root)
    o.parent = root
    o.matrix_parent_inverse = root.matrix_world.inverted()

    lo, hi = bounds(o)
    report[root_name] = dict(asset=asset, triangles=got, texturePx=px,
                             size=[round(hi.x-lo.x,3), round(hi.z-lo.z,3), round(hi.y-lo.y,3)],
                             footprintRadius=round(max(hi.x-lo.x, hi.y-lo.y)/2, 3),
                             material=material, metalness=metal)
    if prepared:
        report[root_name]['preparation'] = prepared
    print(f'PROP {root_name:<24} {asset:<24} {got:>6} tris  {px}px  h={height:.2f}m')

    for im in list(bpy.data.images):
        if im.users and (im.size[0] > px or im.size[1] > px):
            im.scale(min(px, im.size[0]), min(px, im.size[1]))

for im in bpy.data.images:
    if im.users: im.pack()

bpy.context.view_layer.update()
total_triangles = sum(p['triangles'] for p in report.values())
if total_triangles > BUDGET_TRIS:
    raise RuntimeError(f'Props kit has {total_triangles} triangles; budget {BUDGET_TRIS}')
path = OUT / 'props-kit.glb'
bpy.ops.export_scene.gltf(
    filepath=str(path), export_format='GLB', export_apply=True, export_yup=True,
    export_cameras=False, export_lights=False,
    export_image_format='WEBP', export_image_quality=85,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12)

raw = path.read_bytes()
if len(raw) > BUDGET_BYTES:
    raise RuntimeError(f'Props kit has {len(raw)} bytes; budget {BUDGET_BYTES}')
json_len = struct.unpack_from('<I', raw, 12)[0]
json_type = raw[16:20]
gltf = json.loads(raw[20:20 + json_len])
for node in gltf['nodes']:
    root_name = node.get('name', '').removesuffix('_body')
    if root_name in report and 'mesh' in node:
        report[root_name]['triangles'] = sum(
            gltf['accessors'][p['indices']]['count'] // 3
            for p in gltf['meshes'][node['mesh']]['primitives'])

# Six of these eight props share a material name with another prop (`ambient_screen_service` alone
# covers four), and importing each into the same Blender session to keep its own baked texture means
# Blender's own datablock-name uniqueness silently suffixes every repeat as `.001`, `.002`... The
# glTF material array has no such constraint -- only Blender's internal bookkeeping does -- so this
# strips the suffix back off the exported name. It is a rename in the JSON only: each entry still
# points at its own image and its own mesh primitives, nothing here merges two props onto one
# texture. Downstream code that matches these names exactly (`ProofBase.tsx`'s screen-content patch,
# any future per-material lookup) would otherwise silently miss every prop but the first to claim a
# given name.
import re
name_pattern = re.compile(r'\.\d{3}$')
renamed = [m['name'] for m in gltf.get('materials', []) if name_pattern.search(m.get('name', ''))]
for m in gltf.get('materials', []):
    m['name'] = name_pattern.sub('', m.get('name', ''))
if renamed:
    new_json = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    new_json += b' ' * ((4 - len(new_json) % 4) % 4)
    rest = raw[20 + json_len:]
    new_len = 12 + 8 + len(new_json) + len(rest)
    raw = (raw[0:8] + struct.pack('<I', new_len)
           + struct.pack('<I', len(new_json)) + json_type + new_json + rest)
    path.write_bytes(raw)
    print('RENAMED_MATERIALS', renamed)

summary = {'file': 'props-kit.glb', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
           'images': len(gltf.get('images', [])), 'props': report,
           'budget': {'bytes': BUDGET_BYTES, 'triangles': BUDGET_TRIS},
           'compression': {'geometry': 'KHR_draco_mesh_compression', 'textures': 'EXT_texture_webp q85'},
           'origin': 'Meshy scans (meshy_output) for the eight interior hero props the HQ shell reserved MF_Props for'}
(OUT / 'props-metadata.json').write_text(json.dumps(summary, indent=2) + '\n')
print('PROPS_COMPLETE', json.dumps({'bytes': len(raw), 'MB': round(len(raw)/1048576, 2),
      'images': summary['images'], 'triangles': sum(p['triangles'] for p in report.values()),
      'extensions': gltf.get('extensionsUsed', [])}))
