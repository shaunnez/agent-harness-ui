"""Registered exports with camera-only holdouts preserving scene lighting and occlusion."""
import bpy,json,sys
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(R/'blend/coastal-detailed.blend'));S=bpy.context.scene
S.cycles.transparent_max_bounces=64
S.render.threads_mode='FIXED';S.render.threads=4;S.cycles.samples=40;S.cycles.use_denoising=True;S.render.film_transparent=True
original={o.name:[slot.material for slot in o.material_slots] for o in S.objects if o.type not in ['CAMERA','LIGHT']};cache={}
default_material=bpy.data.materials.new('default material for empty source slots');default_material.use_nodes=True
def camera_holdout(material):
 if material is None:material=default_material
 if material.name in cache:return cache[material.name]
 m=material.copy();m.name='camera-only holdout '+material.name;m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;out=next(node for node in n if node.type=='OUTPUT_MATERIAL' and node.is_active_output);surface=out.inputs['Surface'].links[0].from_socket
 hold=n.new('ShaderNodeHoldout');ray=n.new('ShaderNodeLightPath');mix=n.new('ShaderNodeMixShader');l.new(surface,mix.inputs[1]);l.new(hold.outputs[0],mix.inputs[2]);l.new(ray.outputs['Is Camera Ray'],mix.inputs[0])
 # Source opacity selects transparent pass-through versus holdout, never residual beauty.
 principled=next((node for node in n if node.type=='BSDF_PRINCIPLED'),None)
 if principled and (principled.inputs['Alpha'].is_linked or principled.inputs['Alpha'].default_value<1):
  transparent=n.new('ShaderNodeBsdfTransparent');cutout=n.new('ShaderNodeMixShader');l.new(transparent.outputs[0],cutout.inputs[1]);l.new(hold.outputs[0],cutout.inputs[2]);alpha=principled.inputs['Alpha']
  if alpha.is_linked:l.new(alpha.links[0].from_socket,cutout.inputs[0])
  else:cutout.inputs[0].default_value=alpha.default_value
  l.new(cutout.outputs[0],mix.inputs[2])
 l.new(mix.outputs[0],out.inputs['Surface']);cache[material.name]=m;return m
calibration='--calibration' in sys.argv;surfaces_only='--surfaces-only' in sys.argv
layers=['base'] if calibration else ['base','bridge','front'] if surfaces_only else ['terrain','base','bridge','front']
bounds=json.loads((R/'qa/final-geometry-bounds.json').read_text()).get('boundsRelativeLogical',{}) if surfaces_only else {}
if calibration:
 S.render.use_border=True;S.render.use_crop_to_border=True;S.render.border_min_x=.065;S.render.border_max_x=.305;S.render.border_min_y=.20;S.render.border_max_y=.83;S.cycles.samples=8
for layer in layers:
 print('Rendering registered '+layer,flush=True);points=[]
 for o in S.objects:
  if o.type in ['CAMERA','LIGHT']:continue
  group=o.get('asset_layer');on=group==layer or (group=='lights' and ((layer=='bridge' and o.name.startswith('bridge')) or (layer=='base' and not o.name.startswith('bridge'))))
  o.hide_render=False;o.visible_camera=True
  for slot,material in zip(o.material_slots,original[o.name]):slot.material=material if on else camera_holdout(material)
  if on and o.type=='MESH':
   for vertex in o.data.vertices:
    p=world_to_camera_view(S,S.camera,o.matrix_world@vertex.co);points.append((p.x*1280-640,(1-p.y)*960-600))
 bounds[layer]=[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)] if points else None
 S.render.filepath=str(R/'qa/cutout-holdout-calibration.png' if calibration else R/'renders'/f'{layer}.png');bpy.ops.render.render(write_still=True)
if calibration:sys.exit(0)
if not surfaces_only:
 black=bpy.data.materials.new('lights only absolute black occluder');black.use_nodes=True;n=black.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');em=n.new('ShaderNodeEmission');em.inputs['Color'].default_value=(0,0,0,1);black.node_tree.links.new(em.outputs[0],out.inputs[0])
 for o in S.objects:
  if o.type in ['CAMERA','LIGHT']:continue
  group=o.get('asset_layer')
  for slot,material in zip(o.material_slots,original[o.name]):slot.material=material if group=='lights' else camera_holdout(material) if group=='water' else black
 S.cycles.use_denoising=False;S.render.filepath=str(R/'renders/lights-raw.png');bpy.ops.render.render(write_still=True)
(R/'qa/final-geometry-bounds.json').write_text(json.dumps({'boundsRelativeLogical':bounds,'method':'projected source mesh vertices; runtime bounds measured from occluded raster alpha','occlusion':'camera-only material holdouts preserve all non-camera light transport and original source opacity'},indent=2)+'\n')
