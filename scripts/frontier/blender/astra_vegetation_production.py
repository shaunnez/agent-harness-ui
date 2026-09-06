import bpy,math,json,sys,hashlib
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra/vegetation-production';(R/'renders').mkdir(exist_ok=True);(R/'blend').mkdir(exist_ok=True)
mode='tree'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);S=bpy.context.scene;S.render.engine='CYCLES';S.cycles.samples=64;S.cycles.use_denoising=True;S.render.threads_mode='FIXED';S.render.threads=4;S.render.film_transparent=True;S.render.image_settings.file_format='PNG';S.render.image_settings.color_mode='RGBA';S.world.color=(.22,.26,.32);S.view_settings.view_transform='AgX'
def mat(n,col,metal=0,rough=.4,emit=0):
 m=bpy.data.materials.new(n);m.diffuse_color=(*col,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emit:p.inputs['Emission Color'].default_value=(*col,1);p.inputs['Emission Strength'].default_value=emit
 return m
white=mat('ceramic warm white',(.72,.75,.73),.25,.3);dark=mat('slate structure',(.055,.075,.085),.7,.35);metal=mat('machined titanium',(.24,.28,.29),.8,.29);amber=mat('amber inset',(.75,.3,.055),.5,.33);blue=mat('blue glass',(.009,.12,.22),.5,.2);eye=mat('blue eye',(.035,.5,1),.15,.18,3);black=mat('visor glass',(.007,.014,.021),.65,.16)
# Object-space finish variation stays isotropic on the authored geometry.
for material in [white,dark,metal]:
 nodes=material.node_tree.nodes;links=material.node_tree.links;p=nodes.get('Principled BSDF');coords=nodes.new('ShaderNodeTexCoord');noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=5;noise.inputs['Detail'].default_value=3;links.new(coords.outputs['Object'],noise.inputs['Vector']);ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.25,.25,.25,1);ramp.color_ramp.elements[1].color=(.48,.48,.48,1);links.new(noise.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs['Color'],p.inputs['Roughness'])
groups={};group='floor'
def tag(o,m):
 o.data.materials.clear();o.data.materials.append(m);groups.setdefault(group,[]).append(o);return o
def cube(n,loc,size,m,bev=.08):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=n;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);tag(o,m)
 if bev:b=o.modifiers.new('rounded ceramic edges','BEVEL');b.width=bev;b.segments=3;o.modifiers.new('weighted corner normals','WEIGHTED_NORMAL')
 return o
def sphere(n,loc,scale,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=loc);o=bpy.context.object;o.name=n;o.scale=scale;tag(o,m)
 for p in o.data.polygons:p.use_smooth=True
 return o
def cyl(n,a,b,r,m):
 a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=(b-a).length,location=(a+b)/2);o=bpy.context.object;o.name=n;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();tag(o,m);v=o.modifiers.new('edge bevel','BEVEL');v.width=r*.16;v.segments=2;o.modifiers.new('weighted normals','WEIGHTED_NORMAL');return o
def import_mesh(path,loc,size=None):
 path=Path(path)
 if 'modular-sci-fi-megakit' in str(path):
  data=json.loads(path.read_text());prepared=R/'prepared';prepared.mkdir(exist_ok=True)
  for item in data.get('images',[])+data.get('buffers',[]):
   uri=item.get('uri','')
   if uri and not uri.startswith('data:'):
    candidates=list((R/'sources/modular-sci-fi-megakit').rglob(Path(uri).name));item['uri']=str(candidates[0]) if candidates else str(path.parent/uri)
  targetpath=prepared/path.name;targetpath.write_text(json.dumps(data));path=targetpath
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));obs=[o for o in bpy.data.objects if o not in before and o.type=='MESH'];o=obs[0];bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
 pts=[o.matrix_world@Vector(v) for v in o.bound_box];lo=Vector([min(v[i] for v in pts) for i in range(3)]);hi=Vector([max(v[i] for v in pts) for i in range(3)]);center=(lo+hi)/2;o.data.transform(o.matrix_world);o.matrix_world=Matrix.Identity(4);o.data.transform(Matrix.Translation(-center));o.location=loc
 if size:o.scale=Vector([size[i]/(hi-lo)[i] for i in range(3)])
 groups.setdefault(group,[]).append(o);return o
# shared warm upper-left key; large source produces soft contact shadows
bpy.ops.object.light_add(type='AREA',location=(10,-6,16));key=bpy.context.object;key.name='warm upper-left key';key.data.energy=4800;key.data.color=(1,.83,.66);key.data.shape='DISK';key.data.size=7;key.rotation_euler=(-key.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='AREA',location=(4,1,6));fill=bpy.context.object;fill.data.energy=1300;fill.data.color=(.65,.78,1);fill.data.size=8;fill.rotation_euler=(-fill.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(12,12,9.79795897));cam=bpy.context.object;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';S.camera=cam
S.world.use_nodes=True;bg=S.world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=(.42,.48,.58,1);bg.inputs['Strength'].default_value=.55
group='tree';root=R.parent/'sources/stylized-nature-megakit/glTF';used=[]
for name,loc,size in [('TwistedTree_3',(.45,-.35,2.75),(5.7,5.75,5.5)),('TwistedTree_5',(-1.85,1.45,1.5),(2.9,2.9,3)),('Bush_Common',(1.1,1.0,.3),(1.2,1.25,.6))]:
 path=root/(name+'.gltf');used.append(str(path));o=import_mesh(path,loc,size);bpy.context.view_layer.update()
 # Slim only the lower trunk; branches and leaf-cluster positions stay matched.
 if 'Tree' in name:
  zmin=min(v.co.z for v in o.data.vertices);zmax=max(v.co.z for v in o.data.vertices)
  for v in o.data.vertices:
   t=(v.co.z-zmin)/(zmax-zmin);factor=.53+.47*min(1,max(0,t/.48));v.co.x*=factor;v.co.y*=factor
 for slot,m in enumerate(list(o.data.materials)):
  if not m:continue
  m=m.copy();o.data.materials[slot]=m;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=0
  if 'Leaves' in m.name:
   nodes=m.node_tree.nodes;links=m.node_tree.links
   for l in list(links):
    if l.to_socket==p.inputs['Base Color']:links.remove(l)
   tex=nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=2.3;tex.inputs['Detail'].default_value=2;coord=nodes.new('ShaderNodeTexCoord');links.new(coord.outputs['Object'],tex.inputs['Vector']);ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.19,.035,.26,1);ramp.color_ramp.elements[1].color=(.63,.25,.51,1);links.new(tex.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs['Color'],p.inputs['Base Color']);p.inputs['Roughness'].default_value=.78
   trans=nodes.new('ShaderNodeBsdfTranslucent');links.new(ramp.outputs['Color'],trans.inputs['Color']);mix=nodes.new('ShaderNodeMixShader');mix.inputs[0].default_value=.32;links.new(p.outputs[0],mix.inputs[1]);links.new(trans.outputs[0],mix.inputs[2]);out=nodes.get('Material Output')
   if p.inputs['Alpha'].is_linked:
    alpha=p.inputs['Alpha'].links[0].from_socket;transparent=nodes.new('ShaderNodeBsdfTransparent');cut=nodes.new('ShaderNodeMixShader');links.new(alpha,cut.inputs[0]);links.new(transparent.outputs[0],cut.inputs[1]);links.new(mix.outputs[0],cut.inputs[2]);links.new(cut.outputs[0],out.inputs['Surface'])
   else:links.new(mix.outputs[0],out.inputs['Surface'])
resolution=(768,768);cam.data.ortho_scale=9.5;anchor=(0,0,0);target=(384,680)
S.render.resolution_x,S.render.resolution_y=resolution;S.render.resolution_percentage=100;bpy.context.view_layer.update();q=world_to_camera_view(S,cam,Vector(anchor));right=cam.rotation_euler.to_matrix()@Vector((1,0,0));up=cam.rotation_euler.to_matrix()@Vector((0,1,0));cam.location-=right*((target[0]/768-q.x)*cam.data.ortho_scale)+up*((1-target[1]/768-q.y)*cam.data.ortho_scale);bpy.context.view_layer.update()
meta={'id':'mf.prop.purple-tree','revision':1,'status':'production-pending-review','sourceSize':[768,768],'logicalSize':[384,384],'groundAnchor':[192,340],'camera':{'elevationDegrees':30,'azimuthDegrees':45,'location':list(cam.location),'orthoScale':9.5},'samples':64,'usedMeshes':used,'transforms':'TwistedTree3 broad5.7x5.75x5.5, companion TwistedTree5 2.9x2.9x3, lower-trunk taper53percent interpolating to unchanged branching at48percent height. Purple leaf noise coloration and alpha-preserving translucency.','lighting':{'key':[10,-6,16],'keyWatts':4800,'fillWatts':1300,'worldStrength':.55},'buildScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'provenance':'Quaternius Nature FREE STANDARD CC0; original acquisition/license/archive evidence in sibling sources. No baked ground or shadow.'}
(R/'entry.json').write_text(json.dumps(meta,indent=2)+'\n');bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend/spreading-grove.blend'));S.render.filepath=str(R/'renders/spreading-grove.png');bpy.ops.render.render(write_still=True)

# Independent physical cast shadow; no receiver surface in the foliage export.
for o in groups['tree']:o.visible_camera=False
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.025));catcher=bpy.context.object;catcher.name='ground shadow catcher';catcher.is_shadow_catcher=True
S.render.filepath=str(R/'renders/spreading-grove-shadow.png');bpy.ops.render.render(write_still=True)
meta['shadow']={'file':'renders/spreading-grove-shadow.png','sourceSize':[768,768],'logicalSize':[384,384],'groundAnchor':[192,340],'method':'Cycles shadow catcher at z=-0.025, tree hidden to camera only'}
(R/'entry.json').write_text(json.dumps(meta,indent=2)+'\n')
