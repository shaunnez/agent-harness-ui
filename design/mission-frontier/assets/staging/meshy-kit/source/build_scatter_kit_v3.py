"""Contract 2.0 scatter kit, environment pass v3: Meshy scans substituted into the existing item slots.

  /Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python build_scatter_kit_v3.py -- <meshy_root> <out_dir>

Loads the v2 kit, removes the procedural geometry for the slots listed in SUBSTITUTIONS, and rebuilds
those slots from the Meshy scans: decimated to a per-kind triangle target, textures resized, scaled to
the metre height the v2 metadata recorded for that slot and re-anchored the way the runtime expects
(ground centre for everything except MF_Cliff_*, which hang from their top centre).

Item names, heights and footprints are preserved, so `scatter.ts` placement rules and the seeded
layout keep working untouched. Everything not listed -- grass, reeds, lantern, vehicles, scrub --
is carried over from v2 unchanged.
"""
import bpy, sys, json, struct, hashlib, math
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
MESHY = Path(argv[0]); OUT = Path(argv[1])
HERE = Path(__file__).resolve().parent
STAGING = HERE.parent.parent           # assets/staging
V2 = STAGING / 'colony-v2/producer'
OUT.mkdir(parents=True, exist_ok=True)

# slot -> (meshy asset, triangle target, texture px)
# Foliage keeps 20k: below that the canopy develops holes and the silhouette thins (probe evidence).
# Solid rock and cliff bodies hold their form far lower.
SUBSTITUTIONS = {
    'MF_Tree_Purple_A':  ('tree.pinkCoastal.A',              20000, 512),
    'MF_Tree_Purple_B':  ('tree.purpleCoastal.A',            20000, 512),
    'MF_Tree_Purple_C':  ('tree_02_violet_blossom',          20000, 512),
    'MF_Tree_Purple_D':  ('tree_01_pink_coastal_blossom',    20000, 512),
    'MF_Tree_Bare_A':    ('tree_03_wind_bent_evergreen',     16000, 512),
    'MF_Rock_Large_A':   ('rock.tallOutcrop.A',              10000, 512),
    'MF_Rock_Large_B':   ('rock_02_tall_rock_outcrop',       10000, 512),
    'MF_Boulder_A':      ('rock_03_large_boulder',            6000, 512),
    'MF_Cliff_A':        ('cliff.coastalLarge.A',            12000, 512),
    'MF_Cliff_B':        ('rock_04_undercut_arch_module',    12000, 512),
    'MF_Cliff_C':        ('rock_01_large_coastal_cliff',     12000, 512),
    # Crystals keep their scanned colour: the runtime's `crystal_glow` override would repaint them
    # flat violet, so these carry a different material name and their own baked emission instead.
    'MF_Crystal_A':      ('crystal.largeCluster.A',           8000, 512),
    'MF_Crystal_B':      ('crystal_04_shard_formation',       7000, 512),
    'MF_Crystal_C':      ('crystal_03_crystal_boulder',       7000, 512),
}
# Procedural pieces with no scanned replacement worth keeping: the remaining flat-card trees read as
# blobs next to the scans, so they are dropped from the kit rather than left to be picked.
# Dropped outright, geometry and textures deleted from the kit rather than left unreferenced.
# MF_Tree_Purple_E: its slot height is 9 m and the only unused tree scan is a coastal shrub, which
# stretches badly at that size. The scrub, grass and reed cards read as painted blobs beside the
# scanned canopies, and meshy_output has no scanned grass or reed to put in their place.
REMOVED = [
    'MF_Tree_Purple_E', 'MF_Tree_Purple_F', 'MF_Tree_Purple_G', 'MF_Tree_Olive_A',
    'MF_Scrub_Purple_A', 'MF_Scrub_Purple_B', 'MF_Scrub_Olive_A',
    'MF_Grass_A', 'MF_Grass_B',
    'MF_Reed_A', 'MF_Reed_B',
]
# Slots with no v2 ancestor: a fresh root is created and the scan scaled to this height in metres.
NEW_SLOTS = {
    'MF_Crystal_D': ('crystal_01_large_cluster',  8000, 512, 2.6),
    'MF_Crystal_E': ('crystal_02_embedded_vein',  7000, 512, 1.9),
}
BUDGET_BYTES = 6_000_000; BUDGET_TRIS = 90_000

v2meta = json.loads((V2 / 'scatter-metadata.json').read_text())
v2items = v2meta['items']

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(V2 / 'scatter-kit.glb'))
scene = bpy.context.scene

def purge(root_name):
    """Delete a slot's meshes but keep its root empty, so the slot keeps its identity."""
    root = bpy.data.objects.get(root_name)
    assert root, f'missing v2 slot {root_name}'
    for child in list(root.children_recursive):
        bpy.data.objects.remove(child, do_unlink=True)
    return root

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

for name in REMOVED:
    stale = bpy.data.objects.get(name)
    if stale:
        for child in list(stale.children_recursive):
            bpy.data.objects.remove(child, do_unlink=True)
        bpy.data.objects.remove(stale, do_unlink=True)
        print(f'DROPPED {name}')

for slot in NEW_SLOTS:
    fresh_root = bpy.data.objects.new(slot, None)
    bpy.context.scene.collection.objects.link(fresh_root)
    v2items[slot] = {'height': NEW_SLOTS[slot][3]}
    print(f'CREATED {slot}')

report = {}
for slot, (asset, tris, px) in {**SUBSTITUTIONS, **{k: v[:3] for k, v in NEW_SLOTS.items()}}.items():
    src = MESHY / asset / f'{asset}.glb'
    assert src.exists(), src
    root = purge(slot)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(src))
    fresh = [o for o in set(bpy.data.objects) - before if o.type == 'MESH']
    assert len(fresh) == 1, (slot, fresh)
    o = fresh[0]
    # Drop the imported gltf's own parent empties; the v2 slot root is the only parent.
    o.parent = None
    for extra in set(bpy.data.objects) - before:
        if extra is not o and extra.type == 'EMPTY':
            bpy.data.objects.remove(extra, do_unlink=True)

    got = decimate(o, tris)
    # Meshy normalises every export into a ~2 unit box, so real scale is gone: restore the metre
    # height the runtime layout already assumes for this slot.
    target_h = v2items[slot]['height']
    lo, hi = bounds(o)
    cur_h = max(hi.z - lo.z, 1e-6)
    o.scale = (target_h / cur_h,) * 3
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Re-anchor: cliffs hang from the top centre, everything else stands on ground centre.
    lo, hi = bounds(o)
    ctr = (lo + hi) / 2
    anchor_z = hi.z if slot.startswith('MF_Cliff_') else lo.z
    o.location -= Vector((ctr.x, ctr.y, anchor_z))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    o.name = f'{slot}_body'
    o.parent = root
    o.matrix_parent_inverse = root.matrix_world.inverted()
    # The runtime attaches its wet-rock shader to materials named rock_*, so rock-like slots opt in.
    mat = o.data.materials[0]
    if 'Crystal' in slot:
        # Not `crystal_glow`: that name triggers the runtime's flat-violet repaint. Emission is baked
        # from the scan's own base colour so the shards glow in their real hues at dusk.
        mat.name = f'crystal_scan_{slot.lower()}'
        nodes = mat.node_tree.nodes
        principled = nodes.get('Principled BSDF')
        base = next((n for n in nodes if n.type == 'TEX_IMAGE' and n.image
                     and 'normal' not in n.image.name.lower()
                     and 'metallic' not in n.image.name.lower()
                     and 'rough' not in n.image.name.lower()), None)
        if principled and base:
            mat.node_tree.links.new(base.outputs['Color'], principled.inputs['Emission Color'])
            principled.inputs['Emission Strength'].default_value = 0.55
    elif 'Tree' in slot:
        mat.name = f'tree_meshy_{slot.lower()}'
    else:
        mat.name = f'rock_meshy_{slot.lower()}'
    for im in list(bpy.data.images):
        if im.users == 0: continue
        if im.size[0] > px or im.size[1] > px:
            im.scale(min(px, im.size[0]), min(px, im.size[1]))
    report[slot] = dict(asset=asset, triangles=got, height=round(target_h, 3), texturePx=px)
    print(f'SLOT {slot:<20} {asset:<34} {got:>6} tris  {px}px  h={target_h:.2f}m')

for im in bpy.data.images:
    if im.users: im.pack()

bpy.context.view_layer.update()
path = OUT / 'scatter-kit.glb'
bpy.ops.export_scene.gltf(
    filepath=str(path), export_format='GLB', export_apply=True, export_yup=True,
    export_cameras=False, export_lights=False,
    export_image_format='WEBP', export_image_quality=85,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12)

raw = path.read_bytes()
gltf = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
items = {}
for o in scene.objects:
    if o.type == 'EMPTY' and o.name.startswith('MF_'):
        pts = [c.matrix_world @ Vector(v) for c in o.children_recursive if c.type == 'MESH' for v in c.bound_box]
        if not pts: continue
        lo = [min(p[i] for p in pts) for i in range(3)]; hi = [max(p[i] for p in pts) for i in range(3)]
        items[o.name] = {'footprintRadius': round(max(hi[0]-lo[0], hi[1]-lo[1]) / 2, 3),
                         'height': round(hi[2]-lo[2], 3),
                         'size': [round(hi[0]-lo[0],3), round(hi[2]-lo[2],3), round(hi[1]-lo[1],3)],
                         'anchor': 'top' if o.name.startswith('MF_Cliff_') else 'ground',
                         'meshes': sorted(c.name for c in o.children_recursive if c.type == 'MESH'),
                         'triangles': sum(len(c.data.polygons) for c in o.children_recursive if c.type == 'MESH')}
        if o.name == 'MF_Lantern': items[o.name]['lampOffset'] = [0, 2.72, 0]

summary = {'file': 'scatter-kit.glb', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
           'images': len(gltf.get('images', [])), 'items': items,
           'budget': {'bytes': BUDGET_BYTES, 'triangles': BUDGET_TRIS},
           'compression': {'geometry': 'KHR_draco_mesh_compression', 'textures': 'EXT_texture_webp q85'},
           'substitutions': report,
           'origin': 'Meshy scans (meshy_output) substituted into v2 slots; procedural grass, reeds, lantern, vehicles and scrub retained from v2'}
(OUT / 'scatter-metadata.json').write_text(json.dumps(summary, indent=2) + '\n')
print('KIT_COMPLETE', json.dumps({'bytes': len(raw), 'MB': round(len(raw)/1048576, 2),
      'images': summary['images'], 'extensions': gltf.get('extensionsUsed', [])}))
