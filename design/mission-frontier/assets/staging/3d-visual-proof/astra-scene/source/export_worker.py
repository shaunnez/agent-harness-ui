"""Reuse retained cinematic robot, normalize feet/forward, export static portable model."""
import bpy,math,json
from pathlib import Path
from mathutils import Vector,Matrix
OUT=Path(__file__).resolve().parents[1]
source=(OUT/'source/original-worker-production.py').read_text();lines=source.splitlines();lines[4]='R=Path('+repr(str(OUT))+');(R/"renders").mkdir(exist_ok=True);(R/"blend").mkdir(exist_ok=True)'
exec('\n'.join(lines).split("render('worker-idle')")[0],globals())
for o in list(bpy.data.objects):
 if o not in groups['worker']:bpy.data.objects.remove(o,do_unlink=True)
# Original type faces Blender +Y after quarter turn; rotate to Blender -Y = glTF +Z.
neutral={o.name:o.matrix_world.copy() for o in groups['worker']}
for o in groups['worker']:o.matrix_world=Matrix.Rotation(math.pi,4,'Z')@o.matrix_world
bpy.context.view_layer.update();pts=[o.matrix_world@Vector(v) for o in groups['worker'] for v in o.bound_box];lo=min(v.z for v in pts);hi=max(v.z for v in pts);scale=1.8/(hi-lo)
for o in groups['worker']:o.matrix_world=Matrix.Scale(scale,4)@Matrix.Translation((0,0,-lo))@o.matrix_world
normalize=Matrix.Scale(scale,4)@Matrix.Translation((0,0,-lo))@Matrix.Rotation(math.pi,4,'Z')
# Retain original short tool-working arm articulation. No foot translation or invented gait.
for i in range(13):
 S.frame_set(i+1);phase=math.tau*i/12;upperangle=-.72+.020*math.sin(phase);angle=-.45+.035*(math.sin(phase+.6)-math.sin(.6))
 U=Matrix.Translation(shoulder_pivot)@Matrix.Rotation(upperangle,4,(-1,0,0))@Matrix.Translation(-shoulder_pivot)
 T=U@Matrix.Translation(pivot)@Matrix.Rotation(angle,4,(-1,0,0))@Matrix.Translation(-pivot)
 for obs,tr in [(uppermoving,U),(moving,T)]:
  for o in obs:
   o.matrix_world=normalize@tr@neutral[o.name];o.keyframe_insert(data_path='location',frame=i+1);o.keyframe_insert(data_path='rotation_euler',frame=i+1)
S.render.fps=10;S.frame_start=1;S.frame_end=13;S.frame_set(1);S.name='worker_tool_work'
for m in bpy.data.materials:
 if m.use_nodes:
  p=m.node_tree.nodes.get('Principled BSDF')
  if p:
   for link in list(p.inputs['Roughness'].links):m.node_tree.links.remove(link)
   p.inputs['Roughness'].default_value=.38
bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(OUT/'worker.glb'),export_format='GLB',use_selection=True,export_apply=True,export_animations=True,export_animation_mode='SCENE')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'worker.blend'))
(OUT/'worker-metadata.json').write_text(json.dumps({'height':1.8,'forward':'+Z','origin':'feet','provenance':'Existing cinematic-v1 authored worker geometry; no character redesign','meshObjects':len(groups['worker']),'animation':'worker_tool_work: 1.2-second original tool arm motion, feet stationary; runtime plays only for admitted active run'},indent=2))

# Blender SCENE splits rigid objects; merge tracks into one portable work clip.
import struct
f=OUT/'worker.glb';raw=f.read_bytes();jl=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+jl]);merged={'name':'worker_tool_work','channels':[],'samplers':[]}
for a in doc.get('animations',[]):
 off=len(merged['samplers']);merged['samplers'].extend(a['samplers'])
 for ch in a['channels']:ch['sampler']+=off;merged['channels'].append(ch)
doc['animations']=[merged];j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);tail=raw[20+jl:];f.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(j)+len(tail))+struct.pack('<I4s',len(j),b'JSON')+j+tail)
