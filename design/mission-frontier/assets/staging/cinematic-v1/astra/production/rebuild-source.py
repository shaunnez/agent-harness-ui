import bpy,math,json,sys,hashlib
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra/production';(R/'renders').mkdir(exist_ok=True);(R/'blend').mkdir(exist_ok=True)
mode='worker'
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
bpy.ops.object.light_add(type='AREA',location=(4,1,6));fill=bpy.context.object;fill.data.energy=550;fill.data.color=(.65,.78,1);fill.data.size=8;fill.rotation_euler=(-fill.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(12,12,9.79795897));cam=bpy.context.object;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';S.camera=cam
used=[]
group='worker';# segmented articulated geometry, fixed planted feet
for y in [-.22,.22]:
 cube('segmented foot',(.12,y,.12),(.53,.33,.22),dark,.08);cube('foot ceramic toe',(.25,y,.17),(.3,.31,.15),white,.05);cyl('shin',(-.02,y,.28),(-.02,y,.65),.115,dark);cube('shin shell',(.045,y,.47),(.24,.27,.34),white,.07);sphere('knee',(-.02,y,.73),(.13,.14,.13),metal);cyl('thigh',(-.02,y,.77),(-.02,y,1.1),.14,dark);cube('thigh armour',(.07,y,.94),(.25,.31,.3),white,.08)
sphere('pelvis',(0,0,1.12),(.27,.36,.2),dark);cube('ribbed torso',(0,0,1.48),(.46,.57,.55),dark,.13);cube('ceramic chest',(.14,0,1.55),(.34,.55,.47),white,.12);cube('small chest inset',(.323,0,1.54),(.025,.24,.19),metal,.025);cyl('neck',(0,0,1.75),(0,0,1.88),.12,metal);sphere('round ceramic head',(0,0,2.13),(.43,.43,.43),white);sphere('dark friendly visor',(.335,0,2.13),(.155,.335,.25),black)
for y in [-.15,.15]:sphere('blue eye',(.474,y,2.16),(.025,.047,.055),eye)
for y in [-.44,.44]:
 cyl('ear joint',(0,y*.9,2.13),(0,y*1.03,2.13),.19,dark);cyl('ear cap',(0,y*1.04,2.13),(0,y*1.08,2.13),.145,white)
for z in [1.29,1.36,1.43]:
 cube('waist interlocking rib',(-.08,0,z),(.44,.61,.045),metal,.025)
for y in [-.23,.23]:
 cyl('chest fastener',(.307,y,1.68),(.331,y,1.68),.035,dark)
 cube('chest lower seam',(.317,y*.57,1.4),(.03,.16,.023),dark,.008)
cube('amber shoulder identifier',(.09,.365,1.7),(.19,.06,.06),amber,.018)
# Recessed panel seams and fasteners, with no semantic status marks.
for y in [-.19,.19]:
 cube('inset chest plate seam',(.31,y,1.56),(.011,.009,.22),dark,.003)
for z in [1.48,1.53,1.58]:
 cube('chest service vent',(.345,0,z),(.012,.14,.014),dark,.004)
for y in [-.44,.44]:
 for z in [2.075,2.185]:
  cyl('ear cap recessed bolt',(.062,y*1.085,z),(.062,y*1.1,z),.019,metal)
for y in [-.22,.22]:
 cube('shin longitudinal plate seam',(.169,y,.47),(.009,.011,.2),dark,.003)
 cyl('knee actuator outer pin',(-.02,y-.145,.73),(-.02,y-.155,.73),.052,dark)
# A shallow continuous helmet crown seam follows the actual sphere.
bpy.ops.mesh.primitive_torus_add(major_segments=64,minor_segments=8,location=(0,0,2.30),major_radius=.395,minor_radius=.005)
tag(bpy.context.object,metal);bpy.context.object.name='helmet crown gasket'
# Right articulated chain; child mesh transforms remain editable
moving=[]
for y in [-.4,.4]:
 shoulder=(0,y,1.67);elbow=(.08,y*1.2,1.28);hand=(.15,y*1.25,1.02)
 sphere('shoulder bearing',shoulder,(.17,.17,.17),metal);upper=cyl('upper arm',shoulder,elbow,.13,white);elbow_mesh=sphere('elbow bearing',elbow,(.13,.13,.13),dark);fore=cyl('forearm',elbow,hand,.12,white);palm=sphere('hand gripper',hand,(.13,.13,.13),metal)
 foredetails=[];upperdetails=[]
 for offset in [-.065,.065]:
  a=(hand[0]+.075,hand[1]+offset,hand[2]-.035);b=(hand[0]+.09,hand[1]+offset,hand[2]-.12);c=(hand[0]+.045,hand[1]+offset,hand[2]-.16)
  foredetails.extend([cyl('finger proximal segment',a,b,.027,white),sphere('finger hinge',b,(.028,.028,.028),dark),cyl('finger distal segment',b,c,.024,metal)])
 for z in [1.51,1.56]:upperdetails.append(cube('upper arm inset vent',(.117,y*1.1,z),(.016,.10,.017),dark,.004))
 upperdetails.append(cyl('upper arm fastener',(.13,y*1.1,1.43),(.146,y*1.1,1.43),.023,metal))
 if y<0:
  moving=[fore,palm]+foredetails;uppermoving=[upper,elbow_mesh]+upperdetails;shoulder_pivot=Vector(shoulder);pivot=Vector(elbow)
  tool=cyl('compact fabrication probe',(.15,y*1.25,.97),(.15,y*1.25,.71),.055,dark);moving.append(tool)
  moving.append(cyl('probe ceramic grip collar',(.15,y*1.25,.92),(.15,y*1.25,.85),.062,white))
  moving.append(cyl('probe machined tip',(.15,y*1.25,.78),(.15,y*1.25,.71),.032,metal))
  tool_tip=Vector((.15,y*1.25,.71))
bpy.context.view_layer.update()
turn=Matrix.Rotation(math.pi/2,4,'Z')
for o in groups['worker']:o.matrix_world=turn@o.matrix_world
pivot=turn@pivot;tool_tip=turn@tool_tip;shoulder_pivot=turn@shoulder_pivot
resolution=(384,384);cam.data.ortho_scale=3.35;anchor=(0,0,0);target=(192,334)
S.render.resolution_x,S.render.resolution_y=resolution;S.render.resolution_percentage=100
# Precisely register camera to source-pixel ground anchor.
bpy.context.view_layer.update();q=world_to_camera_view(S,cam,Vector(anchor));dx=target[0]/resolution[0]-q.x;dy=(1-target[1]/resolution[1])-q.y;right=cam.rotation_euler.to_matrix()@Vector((1,0,0));up=cam.rotation_euler.to_matrix()@Vector((0,1,0));cam.location-=right*(dx*cam.data.ortho_scale)+up*(dy*cam.data.ortho_scale*resolution[1]/resolution[0]);bpy.context.view_layer.update()
def pixel(v):
 p=world_to_camera_view(S,cam,Vector(v));return [round(p.x*resolution[0],3),round((1-p.y)*resolution[1],3)]
meta={'id':'mf.worker.standard.se','revision':1,'status':'production-pending-in-app-review','sourceSize':[384,384],'logicalSize':[192,192],'groundAnchor':[96,167],'groundAnchorSource':pixel(anchor),'camera':{'location':list(cam.location),'euler':list(cam.rotation_euler),'orthoScale':cam.data.ortho_scale,'elevationDegrees':30,'azimuthDegrees':45},'samples':64,'blenderVersion':bpy.app.version_string,'footContactsSource':[pixel(turn@Vector((.12,y,0))) for y in [-.22,.22]],'buildScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'lighting':{'key':[10,-6,16],'keyWatts':4800,'keySize':7,'fillWatts':550},'workFrames':[],'provenance':'Original agent-authored segmented Blender geometry, refined from accepted cinematic calibration model; no external model/texture in worker.'}
def render(name):
 S.render.filepath=str(R/'renders'/(name+'.png'));bpy.ops.render.render(write_still=True)
render('worker-idle')
original=[o.matrix_world.copy() for o in moving];upper_original=[o.matrix_world.copy() for o in uppermoving]
for i in range(12):
 S.frame_set(i+1);phase=math.tau*i/12;upperangle=-.72+.020*math.sin(phase);angle=-.45+.035*(math.sin(phase+.6)-math.sin(.6))
 U=Matrix.Translation(shoulder_pivot)@Matrix.Rotation(upperangle,4,(-1,0,0))@Matrix.Translation(-shoulder_pivot)
 T=U@Matrix.Translation(pivot)@Matrix.Rotation(angle,4,(-1,0,0))@Matrix.Translation(-pivot)
 for o,m in zip(uppermoving,upper_original):
  o.matrix_world=U@m;o.keyframe_insert(data_path='location',frame=i+1);o.keyframe_insert(data_path='rotation_euler',frame=i+1)
 for o,m in zip(moving,original):
  o.matrix_world=T@m;o.keyframe_insert(data_path='location',frame=i+1);o.keyframe_insert(data_path='rotation_euler',frame=i+1)
 bpy.context.view_layer.update();name=f'worker-work-{i:02d}';meta['workFrames'].append({'file':f'renders/{name}.png','frame':i+1,'durationMs':100,'upperArmRadians':upperangle,'elbowRadians':angle,'elbowPivotSource':pixel(U@pivot),'probeTipSource':pixel(T@tool_tip),'groundAnchorSource':pixel(anchor)})
 render(name)
S.render.fps=10;S.frame_start=1;S.frame_end=12;S.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend/worker-production.blend'))
meta['probeEnvelopeSource']={'min':[min(f['probeTipSource'][j] for f in meta['workFrames']) for j in range(2)],'max':[max(f['probeTipSource'][j] for f in meta['workFrames']) for j in range(2)]}
# Portrait is rendered from this same model and neutral pose, not a new identity.
for o,m in zip(moving,original):o.animation_data_clear();o.matrix_world=m
for o,m in zip(uppermoving,upper_original):o.animation_data_clear();o.matrix_world=m
cam.data.ortho_scale=1.65;focus=turn@Vector((0,0,1.97));bpy.context.view_layer.update();q=world_to_camera_view(S,cam,focus);cam.location-=right*((.5-q.x)*cam.data.ortho_scale)+up*((.55-q.y)*cam.data.ortho_scale);bpy.context.view_layer.update();meta['portrait']={'file':'renders/worker-portrait.png','sourceSize':[384,384],'faceCenterSource':pixel(turn@Vector((.35,0,2.13))),'cameraLocation':list(cam.location),'orthoScale':1.65};render('worker-portrait')
(R/'worker-metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
(R/'rebuild-source.py').write_text(Path(__file__).read_text())
