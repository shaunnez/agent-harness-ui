"""The transport shuttle that stands on the hub landing terrace.

  /Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python build_shuttle.py -- <meshy_root> <out_dir>

A single hero object rather than a kit item: it is seen from the exterior camera at close range, so it
keeps 1024px maps where the scatter pieces drop to 512. Exported Draco + WebP like the kit.

Meshy normalises every export into a ~2 unit box, so the real length is restored here. The model is
laid out with its landing gear down; the export is re-anchored so the gear contact plane is y=0 and the
nose faces +Z in glTF, matching the court/front convention every other colony asset follows.
"""
import bpy, sys, json, struct, hashlib, math
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
MESHY = Path(argv[0]); OUT = Path(argv[1]); OUT.mkdir(parents=True, exist_ok=True)
ASSET = 'spaceship.transport.A'
TRIANGLES = 24000
TEXTURE_PX = 1024
# Reviewed at 12 m and called too small. The pad disc is radius 12, so 18 m nose to tail fills it as
# a transport should while still leaving its markings readable around the hull.
LENGTH_M = 18.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(MESHY / ASSET / f'{ASSET}.glb'))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(meshes) == 1, meshes
o = meshes[0]
o.parent = None
for extra in list(bpy.context.scene.objects):
    if extra is not o and extra.type == 'EMPTY':
        bpy.data.objects.remove(extra, do_unlink=True)

o.data.calc_loop_triangles()
source_tris = len(o.data.loop_triangles)
m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = TRIANGLES / source_tris
bpy.context.view_layer.objects.active = o
bpy.ops.object.modifier_apply(modifier=m.name)
o.data.calc_loop_triangles()
tris = len(o.data.loop_triangles)

def bounds():
    pts = [o.matrix_world @ Vector(v) for v in o.bound_box]
    return (Vector([min(p[i] for p in pts) for i in range(3)]),
            Vector([max(p[i] for p in pts) for i in range(3)]))

lo, hi = bounds()
size = hi - lo
# Longest horizontal axis is the fuselage; scale that to LENGTH_M.
longest = max(size.x, size.y)
o.scale = (LENGTH_M / longest,) * 3
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
bpy.context.view_layer.objects.active = o
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

lo, hi = bounds()
ctr = (lo + hi) / 2
o.location -= Vector((ctr.x, ctr.y, lo.z))   # gear contact plane to z=0 (Blender up)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

root = bpy.data.objects.new('MF_Shuttle', None)
bpy.context.scene.collection.objects.link(root)
o.name = 'MF_Shuttle_body'
o.parent = root
o.data.materials[0].name = 'shuttle_hull'

# ---- landing pad -------------------------------------------------------------------------------
# There is no scanned pad in the Meshy set, so it is built here in the deterministic style the rest of
# the colony kit uses. It is a separate root: the runtime centres the pad on the contract's
# spaceport_pad and stands the shuttle on it at an offset.
PAD_RADIUS = 11.5

def material(name, rgb, rough=.85, metal=0.0, emission=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Emission Color'].default_value = (*rgb, 1)
    p.inputs['Emission Strength'].default_value = emission
    return m

pad_root = bpy.data.objects.new('MF_Pad', None)
bpy.context.scene.collection.objects.link(pad_root)

def attach_pad(obj, name, mat):
    obj.name = name; obj.parent = pad_root
    obj.data.materials.clear(); obj.data.materials.append(mat)

deck = material('pad_landing_concrete', (.33, .33, .35), .9)
kerb = material('pad_graphite_kerb', (.16, .16, .18), .7, .3)
paint = material('road_marking_ochre', (.78, .57, .19), .6)
# `practical_` names are the colony's own convention for lights the runtime treats as practicals.
beacon = material('practical_delivery_beacon', (1.0, .62, .25), .35, 0.0, 6.0)
strip = material('practical_warm_strip', (1.0, .76, .45), .4, 0.0, 3.5)

bpy.ops.mesh.primitive_cylinder_add(radius=PAD_RADIUS, depth=0.32, location=(0, 0, -0.16), vertices=64)
attach_pad(bpy.context.object, 'pad_deck', deck)
bpy.ops.mesh.primitive_torus_add(major_radius=PAD_RADIUS, minor_radius=0.22,
                                 location=(0, 0, -0.08), major_segments=64, minor_segments=8)
attach_pad(bpy.context.object, 'pad_kerb', kerb)
bpy.ops.mesh.primitive_torus_add(major_radius=PAD_RADIUS - 1.9, minor_radius=0.1,
                                 location=(0, 0, 0.02), major_segments=64, minor_segments=6)
attach_pad(bpy.context.object, 'pad_ring_marking', paint)
# Touchdown cross.
for angle in (0, math.pi / 2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.02))
    bar = bpy.context.object
    bar.scale = (5.2, 0.34, 0.04); bar.rotation_euler.z = angle
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    attach_pad(bar, 'pad_cross', paint)
# Edge beacons, evenly spaced, plus a low strip in each quadrant gap.
for i in range(8):
    a = i * math.tau / 8
    x, y = math.cos(a) * (PAD_RADIUS - 0.55), math.sin(a) * (PAD_RADIUS - 0.55)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=0.72, location=(x, y, 0.36), vertices=10)
    attach_pad(bpy.context.object, 'pad_beacon_post', kerb)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.26, location=(x, y, 0.82), segments=12, ring_count=8)
    attach_pad(bpy.context.object, 'pad_beacon_lamp', beacon)
for i in range(8):
    a = (i + 0.5) * math.tau / 8
    x, y = math.cos(a) * (PAD_RADIUS - 1.0), math.sin(a) * (PAD_RADIUS - 1.0)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, 0.06))
    s_ = bpy.context.object
    s_.scale = (1.5, 0.22, 0.1); s_.rotation_euler.z = a
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    attach_pad(s_, 'pad_edge_strip', strip)

for im in bpy.data.images:
    if not im.users: continue
    if im.size[0] > TEXTURE_PX or im.size[1] > TEXTURE_PX:
        im.scale(min(TEXTURE_PX, im.size[0]), min(TEXTURE_PX, im.size[1]))
    im.pack()

bpy.context.view_layer.update()
path = OUT / 'shuttle.glb'
bpy.ops.export_scene.gltf(
    filepath=str(path), export_format='GLB', export_apply=True, export_yup=True,
    export_cameras=False, export_lights=False,
    export_image_format='WEBP', export_image_quality=88,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12)

raw = path.read_bytes()
gltf = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
lo, hi = bounds()
meta = {'file': 'shuttle.glb', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
        'triangles': tris, 'sourceTriangles': source_tris, 'images': len(gltf.get('images', [])),
        'assets': {'shuttle': {'glb': {'sha256': hashlib.sha256(raw).hexdigest()}}},
        'size': [round(hi.x - lo.x, 3), round(hi.z - lo.z, 3), round(hi.y - lo.y, 3)],
        'anchor': 'ground: landing gear contact plane at y=0, fuselage centred on the root',
        'padRadius': PAD_RADIUS,
        'roots': ['MF_Shuttle', 'MF_Pad'],
        'texturePx': TEXTURE_PX,
        'compression': {'geometry': 'KHR_draco_mesh_compression', 'textures': 'EXT_texture_webp q88'},
        'origin': f'Meshy {ASSET} (multi-image-to-3d, 4 views)'}
(OUT / 'shuttle-metadata.json').write_text(json.dumps(meta, indent=2) + '\n')
print('SHUTTLE_COMPLETE', json.dumps({'MB': round(len(raw)/1048576, 2), 'triangles': tris,
      'size_m': meta['size'], 'images': meta['images']}))
