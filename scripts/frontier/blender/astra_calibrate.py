import bpy,math,json,sys,hashlib
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra';(R/'renders').mkdir(exist_ok=True);(R/'blend').mkdir(exist_ok=True)
mode=sys.argv[-1] if sys.argv[-1] in ['hq','tree','worker'] else 'hq'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);S=bpy.context.scene;S.render.engine='CYCLES';S.cycles.samples=12;S.cycles.use_denoising=True;S.render.threads_mode='FIXED';S.render.threads=4;S.render.film_transparent=True;S.render.image_settings.file_format='PNG';S.render.image_settings.color_mode='RGBA';S.world.color=(.22,.26,.32);S.view_settings.view_transform='AgX'
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
if mode=='hq':
 cube('raised foundation',(0,0,-.18),(10,10,.36),dark,.18);cube('ceramic foundation lip',(0,0,-.03),(10,10,.16),white,.2)
 for x in range(10):
  for y in range(10):cube('modular steel floor',(x-4.5,y-4.5,.06),(.965,.965,.09),metal,.015)
 path=next((R/'sources/modular-sci-fi-megakit').rglob('WallAstra_Straight.gltf'));used.append(str(path));group='back'
 for side in [0,1]:
  cube('continuous structural wall',(-4.76,0,1.3) if side==0 else (0,-4.76,1.3),(.54,9.6,2.6) if side==0 else (9.6,.54,2.6),dark,.08)
  for z in [.25,2.52]:cube('rounded continuous wall rail',(-4.62,0,z) if side==0 else (0,-4.62,z),(.74,9.55,.28) if side==0 else (9.55,.74,.28),white,.12)
  for i in range(4):
   loc=(-4.75,-3.6+i*2.4,1.3) if side==0 else (-3.6+i*2.4,-4.75,1.3);panelpath=path if i%2==0 else path.with_name('WallAstra_Straight_Window.gltf');used.append(str(panelpath));o=import_mesh(panelpath,loc,(.65,2.38,2.55));o.rotation_euler.z=0 if side==0 else math.pi/2
   for j,m in enumerate(list(o.data.materials)):
    if 'Red' in m.name:o.data.materials[j]=amber
   # inward-facing service panels and low warm fittings
   p=(-4.36,loc[1],1.15) if side==0 else (loc[0],-4.36,1.15);box=cube('inset service panel',p,(.055,1.5,1.05) if side==0 else (1.5,.055,1.05),dark,.025)
   for h in range(5):
    v=(-4.30,loc[1]-.53+h*.265,1.15) if side==0 else (loc[0]-.53+h*.265,-4.30,1.15)
    cube('machinery heat exchanger fin',v,(.095,.095,.72) if side==0 else (.095,.095,.72),metal,.02)
   v=(-4.28,loc[1],1.80) if side==0 else (loc[0],-4.28,1.80)
   cube('recessed blue instrument glass',v,(.035,1.35,.27) if side==0 else (1.35,.035,.27),blue,.025)
   lightloc=(-4.3,loc[1],2.18) if side==0 else (loc[0],-4.3,2.18);cube('warm passive lamp housing',lightloc,(.09,.55,.055) if side==0 else (.55,.09,.055),amber,.01)
 for x,y in [(-4.7,-4.7),(-4.7,4.7),(4.7,-4.7)]:cube('rounded structural pier',(x,y,1.35),(.7,.7,2.7),white,.17)
 group='front'
 for side in [0,1]:
  for t in [-3.8,3.8]:cube('cutaway parapet',(4.75,t,.38) if side==0 else (t,4.75,.38),(.55,2,.75) if side==0 else (2,.55,.75),white,.12)
 group='roof'
 cube('rounded overhanging eave',(0,0,2.76),(10.05,10.05,.36),white,.28)
 cube('deep dark mechanical neck',(0,0,3.1),(8.6,8.6,.55),dark,.4)
 cube('substantial rounded upper hull',(0,0,3.58),(8.4,8.4,.7),white,.5)
 cube('panoramic blue glass band',(0,0,4.03),(7.7,7.7,.35),blue,.5)
 cube('upper ceramic roof plate',(0,0,4.31),(8,8,.3),white,.45)
 for side in [0,1]:
  for i in range(9):
   t=-3.4+i*.85
   cube('mechanical neck cooling rib',(4.31,t,3.12) if side==0 else (t,4.31,3.12),(.09,.16,.38) if side==0 else (.16,.09,.38),metal,.02)
  for t in [-2.8,0,2.8]:
   cube('warm recessed eave lens',(4.37,t,2.98) if side==0 else (t,4.37,2.98),(.06,.85,.08) if side==0 else (.85,.06,.08),amber,.015)
   cube('window mullion',(3.87,t,4.03) if side==0 else (t,3.87,4.03),(.08,.09,.39) if side==0 else (.09,.08,.39),white,.02)
 for t in [-3,-1,1,3]:
  cube('roof expansion joint x',(t,0,4.464),(.012,7.5,.004),dark,.001)
  cube('roof expansion joint y',(0,t,4.464),(7.5,.012,.004),dark,.001)
 for x in [-3.55,-1.7,0,1.7,3.55]:
  for y in [-3.55,3.55]:cyl('recessed roof fastener',(x,y,4.46),(x,y,4.477),.035,metal)
 for z in [3.03,3.17]:
  cyl('connected coolant pipe x',(4.34,-3.5,z),(4.34,3.5,z),.055,metal)
  cyl('connected coolant pipe y',(-3.5,4.34,z),(3.5,4.34,z),.055,metal)
 cyl('observatory dark drum',(-.8,-.75,4.38),(-.8,-.75,4.7),2.13,dark)
 sphere('rounded observatory dome',(-.8,-.75,4.63),(2.05,2.05,1.13),white)
 for a in range(0,360,45):
  x=-.8+2.12*math.cos(math.radians(a));y=-.75+2.12*math.sin(math.radians(a));cyl('dome rib base',(x,y,4.43),(x,y,4.76),.065,metal)
 cube('asymmetric service housing',(2.85,1.8,4.65),(1.25,2.8,.7),dark,.14)
 cube('service housing white shell',(2.9,1.8,4.9),(1.1,2.7,.3),white,.14)
 for y in [.9,1.2,1.5,1.8,2.1,2.4]:cube('utility ventilation slot',(2.92,y,5.07),(.65,.095,.035),dark,.01)
 cyl('antenna mast',(-2.8,2.6,4.45),(-2.8,2.6,5.7),.07,metal)
 # Editable parabolic dish with a real concave surface and feed.
 verts=[];faces=[]
 for ring in range(9):
  r=.9*ring/8
  for j in range(48):
   a=j*math.tau/48;verts.append((-2.8+r*math.cos(a),2.6+r*math.sin(a),5.45+.36*(r/.9)**2))
 for ring in range(8):
  for j in range(48):faces.append((ring*48+j,ring*48+(j+1)%48,(ring+1)*48+(j+1)%48,(ring+1)*48+j))
 mesh=bpy.data.meshes.new('parabolic dish mesh');mesh.from_pydata(verts,[],faces);o=bpy.data.objects.new('observatory dish',mesh);bpy.context.collection.objects.link(o);tag(o,white);sol=o.modifiers.new('dish thickness','SOLIDIFY');sol.thickness=.055
 for p in mesh.polygons:p.use_smooth=True
 cyl('dish receiver',(-2.8,2.6,5.48),(-2.8,2.6,6.05),.055,dark)
 resolution=(1536,1280);cam.data.ortho_scale=15.427;anchor=(5,5,0);target=(768,1044)
elif mode=='tree':
 group='tree';paths=[R/'sources/stylized-nature-megakit/glTF/CommonTree_1.gltf',R/'sources/stylized-nature-megakit/glTF/Bush_Common.gltf'];used=[str(p) for p in paths]
 for i,(path,loc,size) in enumerate([(paths[0],(0,0,3.63),None),(paths[1],(1.3,.4,.5),(1.5,1.5,1)),(paths[1],(-1,.7,.35),(1.2,1.2,.7))]):
  o=import_mesh(path,loc,size)
  for m in o.data.materials:
   if m and 'Leaves' in m.name:
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.32,.075,.42,1)
    for l in list(m.node_tree.links):
     if l.to_socket==p.inputs['Base Color']:m.node_tree.links.remove(l)
    p.inputs['Roughness'].default_value=.78
    nodes=m.node_tree.nodes;links=m.node_tree.links;out=nodes.get('Material Output');trans=nodes.new('ShaderNodeBsdfTranslucent');trans.inputs['Color'].default_value=(.32,.075,.42,1);mix=nodes.new('ShaderNodeMixShader');mix.inputs[0].default_value=.38;links.new(p.outputs['BSDF'],mix.inputs[1]);links.new(trans.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],out.inputs['Surface'])
    if p.inputs['Alpha'].is_linked:
     alpha=p.inputs['Alpha'].links[0].from_socket;transparent=nodes.new('ShaderNodeBsdfTransparent');cutout=nodes.new('ShaderNodeMixShader');links.new(alpha,cutout.inputs[0]);links.new(transparent.outputs[0],cutout.inputs[1]);links.new(mix.outputs[0],cutout.inputs[2]);links.new(cutout.outputs[0],out.inputs['Surface'])
 resolution=(768,768);cam.data.ortho_scale=9.5;anchor=(0,0,0);target=(384,680)
else:
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
 # Right articulated chain; child mesh transforms remain editable
 moving=[]
 for y in [-.4,.4]:
  shoulder=(0,y,1.67);elbow=(.08,y*1.2,1.28);hand=(.15,y*1.25,1.02)
  sphere('shoulder bearing',shoulder,(.17,.17,.17),metal);upper=cyl('upper arm',shoulder,elbow,.13,white);elbow_mesh=sphere('elbow bearing',elbow,(.13,.13,.13),dark);fore=cyl('forearm',elbow,hand,.12,white);palm=sphere('hand gripper',hand,(.13,.13,.13),metal)
  if y<0:
   moving=[fore,palm];uppermoving=[upper,elbow_mesh];shoulder_pivot=Vector(shoulder);pivot=Vector(elbow)
   tool=cyl('compact fabrication probe',(.15,y*1.25,.97),(.15,y*1.25,.71),.055,dark);moving.append(tool)
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
(R/(mode+'-rebuild.py')).write_text(Path(__file__).read_text())
meta={'buildScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'mode':mode,'blenderVersion':bpy.app.version_string,'camera':{'elevationDegrees':30,'azimuthDegrees':45,'orthoScale':cam.data.ortho_scale,'location':list(cam.location),'rotationEuler':list(cam.rotation_euler)},'resolution':resolution,'logicalSize':[v/2 for v in resolution],'groundAnchorSource':pixel(anchor),'groundAnchorLogical':[v/2 for v in pixel(anchor)],'samples':S.cycles.samples,'usedMeshes':used,'lighting':{'keyLocation':[10,-6,16],'keyWatts':4800,'keySize':7,'keyColor':[1,.83,.66],'fillWatts':550},'notes':'Calibration only. Custom worker geometry with editable segmented limbs; no claim of final fidelity.'}
if mode=='worker':
 meta['footContactsSource']=[pixel(turn@Vector((.12,y,0))) for y in [-.22,.22]]
 meta['elbowPivotSource']=pixel(pivot);meta['idleProbeTipSource']=pixel(tool_tip)
if mode=='hq':meta['floorCornersSource']=[pixel(v) for v in [(-5,-5,0),(-5,5,0),(5,5,0),(5,-5,0)]]
(R/(mode+'-metadata.json')).write_text(json.dumps(meta,indent=2)+'\n');bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend'/(mode+'-calibration.blend')))
def render(name):S.render.filepath=str(R/'renders'/(name+'.png'));bpy.ops.render.render(write_still=True)
if mode=='hq':
 for selected in (['roof'] if '--roof' in sys.argv else ([] if '--proof' in sys.argv else ['floor','back','front','roof'])):
  for k,obs in groups.items():
   for o in obs:o.hide_render=k!=selected
  render('hq-'+selected)
 for k,obs in groups.items():
  for o in obs:o.hide_render=k=='roof'
 render('hq-open-proof')
 for k,obs in groups.items():
  for o in obs:o.hide_render=False
 render('hq-closed-proof')
else:
 render(mode+'-idle')
 if mode=='worker':
  # Bend only forearm about actual elbow; feet, torso and head stay fixed.
  original=[o.matrix_world.copy() for o in moving];upper_original=[o.matrix_world.copy() for o in uppermoving]
  meta['workFrames']=[]
  for i,angle in enumerate([-.45,-.53,-.45]):
   S.frame_set(i*8+1)
   U=Matrix.Translation(shoulder_pivot)@Matrix.Rotation(-.72,4,(-1,0,0))@Matrix.Translation(-shoulder_pivot)
   T=U@Matrix.Translation(pivot)@Matrix.Rotation(angle,4,(-1,0,0))@Matrix.Translation(-pivot)
   for o,m in zip(uppermoving,upper_original):o.matrix_world=U@m;o.keyframe_insert(data_path='location',frame=i*8+1);o.keyframe_insert(data_path='rotation_euler',frame=i*8+1)
   for o,m in zip(moving,original):o.matrix_world=T@m;o.keyframe_insert(data_path='location',frame=i*8+1);o.keyframe_insert(data_path='rotation_euler',frame=i*8+1)
   bpy.context.view_layer.update();meta['workFrames'].append({'file':'worker-work-'+str(i)+'.png','elbowRadians':angle,'probeTipSource':pixel(T@tool_tip),'groundAnchorSource':pixel(anchor)})
   render('worker-work-'+str(i))
  (R/'worker-metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
  bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend'/'worker-calibration.blend'))
