"""Re-light the retained island/water geometry with a coastal meadow palette.

Blender -b --threads 4 --python scripts/frontier/blender/fidelity_environment.py -- island
The original geometry, camera and ground registration are retained byte-for-byte
in source-*.blend. Derived materials/light and meadow dressing are changed; no runtime entities.
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
    ramp('Moss and pale soil', [(0.18, (0.055,0.115,0.028)), (0.84, (0.245,0.31,0.11)), (0.48, (0.105,0.195,0.05)), (0.65, (0.18,0.255,0.075))])
    meadow = bpy.data.materials['Moss and pale soil'].node_tree.nodes
    meadow['Noise Texture'].inputs['Scale'].default_value = 0.65
    meadow['Noise Texture'].inputs['Detail'].default_value = 4.0
    meadow['Bump'].inputs['Strength'].default_value = 0.28
    meadow['Bump'].inputs['Distance'].default_value = 0.026
    # Keep the weathered shoreline, but let the interior read as a meadow rather
    # than scattering the same gravel density across the whole island.
    for obj in scene.objects:
        if obj.name.startswith('Surface debris'):
            radius = (obj.location.x / 16.5) ** 2 + (obj.location.y / 11.6) ** 2
            if radius < 0.72 and int(obj.name.rsplit(' ', 1)[1]) % 4:
                obj.hide_render = True
    bpy.data.objects['Low meadow tufts'].scale.z = 0.7
    ramp('Warm fractured limestone', [(0.22,(0.14,0.16,0.145)), (0.80,(0.47,0.43,0.35))])
    ramp('Dry meadow blades', [(0.20,(0.075,0.145,0.025)), (0.77,(0.27,0.35,0.10))])
    ramp('Wet shore', [(0.20,(0.025,0.10,0.11)), (0.80,(0.21,0.30,0.25))])
else:
    ramp('Periodic turquoise water', [(0.0,(0.006,0.09,0.18)), (1.0,(0.018,0.25,0.34))])
for obj in scene.objects:
    if obj.type == 'LIGHT' and obj.data.type == 'SUN':
        obj.data.color = (1.0, 0.90, 0.78)
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.26,0.37,0.54,1)
scene.view_settings.look = 'AgX - Medium High Contrast'
revision = 3 if kind == 'island' else 2
output = STAGE / f'{kind}-r{revision}.png'
scene.render.filepath = str(output)
blend = STAGE / f'{kind}-r{revision}.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
bpy.ops.render.render(write_still=True)
bpy.context.view_layer.update()
p = world_to_camera_view(scene, scene.camera, Vector((0,0,0)))
w,h = scene.render.resolution_x,scene.render.resolution_y
entry = {'id': f'mf.cinematic.{kind}', 'revision': revision, 'file': str(output.relative_to(ROOT)), 'sourceSize':[w,h], 'logicalSize':[w/2,h/2], 'groundAnchor':[p.x*w/2,(1-p.y)*h/2], 'sha256':hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes':output.stat().st_size, 'sourceBlend':str(blend.relative_to(ROOT)), 'originalBlend':str(source.relative_to(ROOT)), 'originalSha256':hashlib.sha256(source.read_bytes()).hexdigest(), 'blenderVersion':bpy.app.version_string, 'samples':scene.cycles.samples, 'provenance':'Derived from Goal3 procedural Blender environment and retained Quaternius CC0 rock geometry. Island mesh and camera retained; coastal meadow palette, softer microtexture, reduced interior gravel and shorter tufts. Water retains revision 2 palette.'}
(STAGE / f'{kind}-r{revision}.json').write_text(json.dumps(entry,indent=2)+'\n')
print('Exported', output)
