"""Re-light the retained island/water geometry with a coastal meadow palette.

Blender -b --threads 4 --python scripts/frontier/blender/fidelity_environment.py -- island
The original geometry, camera and ground registration are retained byte-for-byte
in source-*.blend. Only derived materials/light are changed; no runtime entities.
"""
import hashlib
import json
import sys
from pathlib import Path
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
STAGE = ROOT / 'design/mission-frontier/assets/staging/design-fidelity-v2/environment'
kind = sys.argv[sys.argv.index('--') + 1]
if kind not in ('island', 'water'):
    raise ValueError('Expected island or water')
source = STAGE / f'source-{kind}.blend'
bpy.ops.wm.open_mainfile(filepath=str(source))
scene = bpy.context.scene
scene.cycles.samples = 48
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
scene.cycles.use_denoising = True

def ramp(name, stops):
    material = bpy.data.materials[name]
    node = next(n for n in material.node_tree.nodes if n.type == 'VALTORGB')
    colors = node.color_ramp
    while len(colors.elements) > 2:
        colors.elements.remove(colors.elements[-1])
    for i, (position, color) in enumerate(stops):
        element = colors.elements[i] if i < 2 else colors.elements.new(position)
        element.position = position
        element.color = (*color, 1)

if kind == 'island':
    ramp('Moss and pale soil', [(0.20, (0.045,0.075,0.025)), (0.79, (0.52,0.45,0.31)), (0.46, (0.16,0.205,0.065)), (0.61, (0.33,0.32,0.17))])
    ramp('Warm fractured limestone', [(0.22,(0.14,0.16,0.145)), (0.80,(0.47,0.43,0.35))])
    ramp('Dry meadow blades', [(0.20,(0.045,0.08,0.02)), (0.77,(0.31,0.34,0.09))])
    ramp('Wet shore', [(0.20,(0.025,0.10,0.11)), (0.80,(0.21,0.30,0.25))])
else:
    ramp('Periodic turquoise water', [(0.0,(0.006,0.09,0.18)), (1.0,(0.018,0.25,0.34))])
for obj in scene.objects:
    if obj.type == 'LIGHT' and obj.data.type == 'SUN':
        obj.data.color = (1.0, 0.90, 0.78)
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.26,0.37,0.54,1)
scene.view_settings.look = 'AgX - Medium High Contrast'
output = STAGE / f'{kind}-r2.png'
scene.render.filepath = str(output)
blend = STAGE / f'{kind}-r2.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
bpy.ops.render.render(write_still=True)
bpy.context.view_layer.update()
p = world_to_camera_view(scene, scene.camera, Vector((0,0,0)))
w,h = scene.render.resolution_x,scene.render.resolution_y
entry = {'id': f'mf.cinematic.{kind}', 'revision': 2, 'file': str(output.relative_to(ROOT)), 'sourceSize':[w,h], 'logicalSize':[w/2,h/2], 'groundAnchor':[p.x*w/2,(1-p.y)*h/2], 'sha256':hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes':output.stat().st_size, 'sourceBlend':str(blend.relative_to(ROOT)), 'originalBlend':str(source.relative_to(ROOT)), 'originalSha256':hashlib.sha256(source.read_bytes()).hexdigest(), 'blenderVersion':bpy.app.version_string, 'samples':scene.cycles.samples, 'provenance':'Derived from Goal3 procedural Blender environment and retained Quaternius CC0 rock geometry. Geometry/camera unchanged; coastal palette and light refinement only.'}
(STAGE / f'{kind}-r2.json').write_text(json.dumps(entry,indent=2)+'\n')
print('Exported', output)
