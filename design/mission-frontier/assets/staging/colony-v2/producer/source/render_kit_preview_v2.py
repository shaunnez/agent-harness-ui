"""Contact sheet of the Contract 2.0 scatter kit: every MF_* item in a row, lit like the colony, from the front-left.

  /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python render_kit_preview_v2.py

Writes producer/previews/scatter-kit.png (and -front.png looking straight at -Y, which is the face the
runtime turns toward the sea). Trees, cliffs and rocks stand on a plane at z = 0; cliff pieces hang from
z = 0 so their undercuts read against the plane.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
HERE = Path(__file__).resolve().parent
V2 = HERE.parent
bpy.ops.wm.open_mainfile(filepath=str(V2 / 'scatter-kit.blend'))
scene = bpy.context.scene
roots = sorted([o for o in scene.objects if o.type == 'EMPTY' and o.name.startswith('MF_')], key=lambda o: o.name)
x = 0.0
for r in roots:
    pts = [c.matrix_world @ Vector(v) for c in r.children_recursive if c.type == 'MESH' for v in c.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    width = hi.x - lo.x
    r.location = (x - lo.x, 0, 0 if lo.z >= -0.01 else 0)
    x += width + 2.0
bpy.ops.mesh.primitive_plane_add(size=x + 20, location=(x / 2, 0, -0.01)); plane = bpy.context.object
ground = bpy.data.materials.new('preview_ground'); ground.use_nodes = True
ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.35, .34, .3, 1); plane.data.materials.append(ground)
world = bpy.data.worlds.new('preview'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.55, .68, .78, 1); world.node_tree.nodes['Background'].inputs['Strength'].default_value = .9
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.5; sun.angle = .2
so = bpy.data.objects.new('sun', sun); scene.collection.objects.link(so); so.rotation_euler = (math.radians(50), math.radians(-20), math.radians(35))
scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'SceneEEVEE') and 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
scene.render.resolution_x = 2400; scene.render.resolution_y = 600; scene.render.film_transparent = False
(V2 / 'previews').mkdir(exist_ok=True)
def shoot(name, offset):
    cam = bpy.data.cameras.new(name); cam.type = 'ORTHO'; cam.ortho_scale = x + 6
    co = bpy.data.objects.new(name, cam); scene.collection.objects.link(co)
    target = Vector((x / 2, 0, 2.0)); co.location = target + Vector(offset)
    co.rotation_euler = (target - co.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = co; scene.render.filepath = str(V2 / 'previews' / f'scatter-kit{name}.png'); bpy.ops.render.render(write_still=True)
shoot('', (-x * .15, -x * .9, x * .45))
shoot('-front', (0, -x * 1.2, 2.0))
print('KIT_PREVIEW', [r.name for r in roots])
