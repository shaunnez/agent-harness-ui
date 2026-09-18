"""The transport shuttle that stands on the hub landing terrace.

  /Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python build_shuttle.py -- <meshy_root> <out_dir>

A single hero object rather than a kit item: it is seen from the exterior camera at close range, so it
keeps 1024px maps where the scatter pieces drop to 512. Exported Draco + WebP like the kit.

Meshy normalises every export into a ~2 unit box, so the real length is restored here. The model is
laid out with its landing gear down; the export is re-anchored so the gear contact plane is y=0 and the
nose faces +Z in glTF, matching the court/front convention every other colony asset follows.
"""
import bpy, sys, json, struct, hashlib
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
MESHY = Path(argv[0]); OUT = Path(argv[1]); OUT.mkdir(parents=True, exist_ok=True)
ASSET = 'spaceship.transport.A'
TRIANGLES = 24000
TEXTURE_PX = 1024
# The pad disc is radius 14; a transport that reads as crew-scale against a 1.8 m worker sits near
# 12 m nose to tail, leaving the pad legible around it.
LENGTH_M = 12.0

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
        'texturePx': TEXTURE_PX,
        'compression': {'geometry': 'KHR_draco_mesh_compression', 'textures': 'EXT_texture_webp q88'},
        'origin': f'Meshy {ASSET} (multi-image-to-3d, 4 views)'}
(OUT / 'shuttle-metadata.json').write_text(json.dumps(meta, indent=2) + '\n')
print('SHUTTLE_COMPLETE', json.dumps({'MB': round(len(raw)/1048576, 2), 'triangles': tris,
      'size_m': meta['size'], 'images': meta['images']}))
