"""Probe one meshy GLB across decimation / texture / compression settings.

  /Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python probe_one.py -- <name> <src_root> <out_dir>

Reports bytes and triangles for each setting so quality/size can be judged from real numbers
rather than guessed. Writes nothing into the repo except the probe GLBs in <out_dir>.
"""
import bpy, sys, json, struct, math
from pathlib import Path

argv = sys.argv[sys.argv.index('--') + 1:]
NAME, SRC_ROOT, OUT = argv[0], Path(argv[1]), Path(argv[2])
OUT.mkdir(parents=True, exist_ok=True)
SRC = SRC_ROOT / NAME / f'{NAME}.glb'

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_src():
    bpy.ops.import_scene.gltf(filepath=str(SRC))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    assert len(meshes) == 1, meshes
    return meshes[0]

def tri_count(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)

def decimate(o, target_tris):
    cur = tri_count(o)
    if target_tris >= cur: return cur
    m = o.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = target_tris / cur
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)
    return tri_count(o)

def resize_textures(px):
    for im in bpy.data.images:
        if im.size[0] > px or im.size[1] > px:
            im.scale(min(px, im.size[0]), min(px, im.size[1]))
        im.pack()

def export(path, draco, webp=False):
    kw = dict(filepath=str(path), export_format='GLB', export_apply=True,
              export_cameras=False, export_lights=False, export_yup=True)
    if draco:
        kw.update(export_draco_mesh_compression_enable=True,
                  export_draco_mesh_compression_level=6,
                  export_draco_position_quantization=14,
                  export_draco_normal_quantization=10,
                  export_draco_texcoord_quantization=12)
    if webp:
        kw.update(export_image_format='WEBP', export_image_quality=85)
    bpy.ops.export_scene.gltf(**kw)
    return path.stat().st_size

results = []
for tris in [int(t) for t in (60000, 20000, 8000, 4000)]:
    for px in (2048, 1024, 512):
        reset()
        o = import_src()
        raw_tris = tri_count(o)
        got = decimate(o, tris)
        resize_textures(px)
        for draco in (False, True):
            for webp in (False, True):
                tag = f'{NAME}.t{tris}.p{px}{".draco" if draco else ""}{".webp" if webp else ""}.glb'
                try:
                    size = export(OUT / tag, draco, webp)
                except Exception as e:
                    print('FAIL', tag, e); continue
                results.append(dict(tris=got, px=px, draco=draco, webp=webp, bytes=size, file=tag))
                print(f'PROBE {got:>7} tris  {px:>4}px  draco={int(draco)} webp={int(webp)}  {size/1048576:7.2f} MB  {tag}')

(OUT / f'{NAME}.probe.json').write_text(json.dumps({'source': str(SRC), 'sourceTriangles': raw_tris, 'results': results}, indent=2))
print('PROBE_COMPLETE', NAME)
