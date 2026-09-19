"""Render the same camera on several GLBs so compression settings can be compared by eye.

  Blender -b -t 4 --python render_compare.py -- <out_png_dir> <glb> [<glb> ...]

Neutral three-point light, fixed camera framed on the model's bounds, 512x640 each.
"""
import bpy, sys, math
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = Path(argv[0]); OUT.mkdir(parents=True, exist_ok=True)
GLBS = [Path(p) for p in argv[1:]]

def render(glb, out_png):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    pts = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    ctr = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 1e-3)

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 512, 640
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('w'); scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.18, .19, .22, 1)

    cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam); scene.camera = cam
    d = radius * 3.0
    cam.location = ctr + Vector((d * .72, -d * .72, d * .42))
    direction = ctr - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam_data.lens = 50

    for name, loc, energy in (('key', (4, -5, 6), 6.0), ('fill', (-5, -3, 2), 2.0), ('rim', (0, 6, 4), 3.0)):
        l = bpy.data.lights.new(name, 'AREA'); l.energy = energy * radius * radius * 30; l.size = radius * 2
        o = bpy.data.objects.new(name, l); scene.collection.objects.link(o)
        o.location = ctr + Vector(loc) * radius
        o.rotation_euler = (ctr - o.location).to_track_quat('-Z', 'Y').to_euler()

    scene.render.filepath = str(out_png)
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', out_png)

for g in GLBS:
    render(g, OUT / (g.stem + '.png'))
print('RENDER_COMPLETE')
