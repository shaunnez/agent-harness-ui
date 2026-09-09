import bpy,math,json,sys,hashlib
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra/exterior-calibration';(R/'renders').mkdir(exist_ok=True);(R/'blend').mkdir(exist_ok=True)
mode='hq'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);S=bpy.context.scene;S.render.engine='CYCLES';S.cycles.samples=24;S.cycles.use_denoising=True;S.render.threads_mode='FIXED';S.render.threads=4;S.render.film_transparent=True;S.render.image_settings.file_format='PNG';S.render.image_settings.color_mode='RGBA';S.world.color=(.22,.26,.32);S.view_settings.view_transform='AgX'
def mat(n,col,metal=0,rough=.4,emit=0):
 m=bpy.data.materials.new(n);m.diffuse_color=(*col,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emit:p.inputs['Emission Color'].default_value=(*col,1);p.inputs['Emission Strength'].default_value=emit
 return m
white=mat('ceramic warm white',(.72,.75,.73),.25,.3);dark=mat('slate structure',(.055,.075,.085),.7,.35);metal=mat('machined titanium',(.24,.28,.29),.8,.29);amber=mat('amber inset',(.75,.3,.055),.5,.33);blue=mat('blue glass',(.009,.12,.22),.5,.2);eye=mat('blue eye',(.035,.5,1),.15,.18,3);black=mat('visor glass',(.007,.014,.021),.65,.16)
# Object-space finish variation stays isotropic on the authored geometry.
for material in [white,dark,metal]:
 nodes=material.node_tree.nodes;links=material.node_tree.links;p=nodes.get('Principled BSDF');coords=nodes.new('ShaderNodeTexCoord');noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=5;noise.inputs['Detail'].default_value=3;links.new(coords.outputs['Object'],noise.inputs['Vector']);ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.25,.25,.25,1);ramp.color_ramp.elements[1].color=(.48,.48,.48,1);links.new(noise.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs['Color'],p.inputs['Roughness'])
nodes=white.node_tree.nodes;links=white.node_tree.links;p=nodes.get('Principled BSDF');coord=nodes.new('ShaderNodeTexCoord');micro=nodes.new('ShaderNodeTexNoise');micro.inputs['Scale'].default_value=95;micro.inputs['Detail'].default_value=2;links.new(coord.outputs['Object'],micro.inputs['Vector']);bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12;bump.inputs['Distance'].default_value=.009;links.new(micro.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])
groups={};group='floor'
def tag(o,m):
 o.data.materials.clear();o.data.materials.append(m);groups.setdefault(group,[]).append(o);return o
def cube(n,loc,size,m,bev=.08):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=n;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);tag(o,m)
 if bev:b=o.modifiers.new('rounded ceramic edges','BEVEL');b.width=bev;b.segments=3;o.modifiers.new('weighted corner normals','WEIGHTED_NORMAL')
 return o
def chamfered_hull(n,loc,size,m,cut=.6):
 x,y,h=size[0]/2,size[1]/2,size[2]/2;outline=[(-x+cut,-y),(x-cut,-y),(x,-y+cut),(x,y-cut),(x-cut,y),(-x+cut,y),(-x,y-cut),(-x,-y+cut)];verts=[(a+loc[0],b+loc[1],z+loc[2]) for z in [-h,h] for a,b in outline];faces=[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)];mesh=bpy.data.meshes.new(n);mesh.from_pydata(verts,[],faces);o=bpy.data.objects.new(n,mesh);bpy.context.collection.objects.link(o);tag(o,m);bev=o.modifiers.new('rounded chamfer edges','BEVEL');bev.width=.065;bev.segments=4;o.modifiers.new('weighted normals','WEIGHTED_NORMAL');return o
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
    candidates=list((R.parent/'sources/modular-sci-fi-megakit').rglob(Path(uri).name));item['uri']=str(candidates[0]) if candidates else str(path.parent/uri)
  targetpath=prepared/path.name;targetpath.write_text(json.dumps(data));path=targetpath
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));obs=[o for o in bpy.data.objects if o not in before and o.type=='MESH'];o=obs[0];bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
 pts=[o.matrix_world@Vector(v) for v in o.bound_box];lo=Vector([min(v[i] for v in pts) for i in range(3)]);hi=Vector([max(v[i] for v in pts) for i in range(3)]);center=(lo+hi)/2;o.data.transform(o.matrix_world);o.matrix_world=Matrix.Identity(4);o.data.transform(Matrix.Translation(-center));o.location=loc
 if size:o.scale=Vector([size[i]/(hi-lo)[i] for i in range(3)])
 groups.setdefault(group,[]).append(o);return o
# shared warm upper-left key; large source produces soft contact shadows
bpy.ops.object.light_add(type='AREA',location=(10,-6,16));key=bpy.context.object;key.name='warm upper-left key';key.data.energy=4800;key.data.color=(1,.83,.66);key.data.shape='DISK';key.data.size=7;key.rotation_euler=(-key.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='AREA',location=(4,1,6));fill=bpy.context.object;fill.data.energy=550;fill.data.color=(.65,.78,1);fill.data.size=8;fill.rotation_euler=(-fill.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(12,12,9.79795897));cam=bpy.context.object;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';S.camera=cam
used=[];group='roof';pack=next((R.parent/'sources/modular-sci-fi-megakit').glob('*'))/'glTF';placements=[]
# An actual enclosed perimeter reaches floor z=0; the entire shell disappears in HQ.
for side in range(4):
 rot=side*math.pi/2
 for i in range(4):
  t=-3.6+i*2.4;v=Vector((4.64,t,1.28));v=Matrix.Rotation(rot,4,'Z')@v
  backing=cube('continuous exterior backing',v-Vector((math.cos(rot)*.4,math.sin(rot)*.4,0)),(.10,2.42,2.56),dark,.025);backing.rotation_euler.z=rot
  name='WallAstra_Straight_Window.gltf' if i in [0,3] else 'WallAstra_Straight.gltf';path=pack/'Walls'/name;o=import_mesh(path,v,(.64,2.39,2.52));o.rotation_euler.z=rot;used.append(str(path));placements.append({'mesh':name,'location':list(v),'size':[.64,2.39,2.52],'rotationZ':rot})
  for j,m in enumerate(list(o.data.materials)):
   if 'Red' in m.name:o.data.materials[j]=amber
for x in [-4.7,4.7]:
 for y in [-4.7,4.7]:
  cyl('corner structural pier',(x,y,.03),(x,y,2.63),.29,white)
  for z in [.3,2.35]:cyl('pier service collar',(x,y,z-.055),(x,y,z+.055),.30,metal)
# Two closed access modules break up the repeated facade; publisher geometry remains visible.
for side in [0,1]:
 path=pack/'Platforms/Door_Frame_Square.gltf';v=(4.96,0,1.25) if side==0 else (0,4.96,1.25);o=import_mesh(path,v,(.22,1.45,2.2));o.rotation_euler.z=side*math.pi/2;used.append(str(path));placements.append({'mesh':path.name,'location':v,'size':[.22,1.45,2.2],'rotationZ':side*math.pi/2})
chamfered_hull('perimeter ceramic cornice',(0,0,2.64),(10.02,10.02,.22),white,.72)
# Circular observatory massing: recessed drums, blue glazing and segmented sloping ceramic terraces.
def ring_surface(name,r0,r1,z0,z1,material,segments=32):
 for k in range(segments):
  a=k*math.tau/segments+.006;b=(k+1)*math.tau/segments-.006
  verts=[(r*math.cos(t),r*math.sin(t),z) for r,z in [(r0,z0),(r1,z1)] for t in [a,(a+b)/2,b]];faces=[(0,1,4,3),(1,2,5,4)];mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);tag(o,material);sol=o.modifiers.new('panel thickness','SOLIDIFY');sol.thickness=.035;bev=o.modifiers.new('soft panel edges','BEVEL');bev.width=.018;bev.segments=2;o.modifiers.new('weighted normals','WEIGHTED_NORMAL')
for n,(radius,z,upper) in enumerate([(4.22,2.77,3.78),(3.15,3.78,4.83),(2.08,4.83,5.77)]):
 cyl('recessed circular service drum',(0,0,z),(0,0,upper-.31),radius-.10,dark)
 cyl('blue panoramic glazing',(0,0,z+.16),(0,0,z+.47),radius-.065,blue)
 ring_surface('segmented sloping ceramic terrace',radius,radius-.38,z+.51,upper,white)
 cyl('upper terrace dark seam',(0,0,upper-.035),(0,0,upper+.02),radius-.40,metal)
 for k in range(24):
  a=k*math.tau/24;x=(radius-.025)*math.cos(a);y=(radius-.025)*math.sin(a)
  post=cube('glazing structural mullion',(x,y,z+.31),(.10,.12,.50),white,.025);post.rotation_euler.z=a
  if k%3==0:
   v=(radius+.017)*Vector((math.cos(a),math.sin(a),0));v.z=z+.61
   plate=cube('terrace service vent',v,(.035,.32,.16),dark,.012);plate.rotation_euler.z=a
   for h in [-.08,0,.08]:
    vv=v+Vector((-.01*math.cos(a)-h*math.sin(a),-.01*math.sin(a)+h*math.cos(a),0));fin=cube('vent heat fin',vv,(.047,.027,.13),metal,.005);fin.rotation_euler.z=a
# Ground-cornice corners carry different functional service units, connected physically to the drum.
for x,y,sx,sy in [(3.75,-3.5,1.1,1.45),(-3.5,3.55,1.55,.95)]:
 chamfered_hull('corner mechanical pod',(x,y,3.0),(sx,sy,.54),white,.18)
 for dy in [-.24,0,.24]:cube('pod heat grille',(x,y+dy,3.282),(sx*.65,.065,.024),dark,.006)
 cyl('pod supply conduit',(x,y,2.9),(x*.84,y*.84,2.9),.075,metal)
# Articulated dish on a layered mechanical pedestal; no smooth hemisphere.
cyl('dish azimuth bearing',(0,0,5.65),(0,0,5.93),.70,dark);cyl('dish ceramic pedestal',(0,0,5.91),(0,0,6.13),.55,white)
for y in [-.32,.32]:cube('dish fork support',(.05,y,6.35),(.20,.12,.52),metal,.055)
cyl('dish elevation axle',(.05,-.46,6.50),(.05,.46,6.50),.15,dark)
# Local bowl coordinates transformed into a tilted dish.
D=Matrix.Translation(Vector((.05,0,6.46)))@Matrix.Rotation(math.radians(38),4,'Y');verts=[];faces=[]
for ring in range(10):
 r=1.02*ring/9
 for j in range(64):
  a=j*math.tau/64;verts.append(tuple(D@Vector((r*math.cos(a),r*math.sin(a),.34*(r/1.02)**2))))
for ring in range(9):
 for j in range(64):faces.append((ring*64+j,ring*64+(j+1)%64,(ring+1)*64+(j+1)%64,(ring+1)*64+j))
mesh=bpy.data.meshes.new('parabolic receiver');mesh.from_pydata(verts,[],faces);o=bpy.data.objects.new('tilted segmented dish',mesh);bpy.context.collection.objects.link(o);tag(o,white);sol=o.modifiers.new('dish shell','SOLIDIFY');sol.thickness=.055
for p in mesh.polygons:p.use_smooth=True
for a in range(0,360,45):
 angle=math.radians(a);cyl('dish radial structural rib',D@Vector((.10*math.cos(angle),.10*math.sin(angle),.015)),D@Vector((.98*math.cos(angle),.98*math.sin(angle),.32)),.018,metal)
cyl('dish feed support',D@Vector((0,0,.02)),D@Vector((0,0,.62)),.045,dark);sphere('dish receiver',D@Vector((0,0,.64)),(.10,.10,.12),metal)
resolution=(1536,1280);cam.data.ortho_scale=15.427;anchor=(5,5,0);target=(768,1044);S.render.resolution_x,S.render.resolution_y=resolution;S.render.resolution_percentage=100
bpy.context.view_layer.update();q=world_to_camera_view(S,cam,Vector(anchor));right=cam.rotation_euler.to_matrix()@Vector((1,0,0));up=cam.rotation_euler.to_matrix()@Vector((0,1,0));cam.location-=right*((target[0]/1536-q.x)*cam.data.ortho_scale)+up*((1-target[1]/1280-q.y)*cam.data.ortho_scale*1280/1536);bpy.context.view_layer.update()
def pixel(v):
 p=world_to_camera_view(S,cam,Vector(v));return [round(p.x*1536,3),round((1-p.y)*1280,3)]
meta={'id':'mf.base.standard.roof','revision':'exterior-calibration-r1','status':'24sample-pending-review','file':'renders/exterior.png','sourceSize':[1536,1280],'logicalSize':[768,640],'groundAnchor':[384,522],'groundAnchorSource':pixel(anchor),'samples':24,'floorCornersSource':[pixel(v) for v in [(-5,-5,0),(-5,5,0),(5,5,0),(5,-5,0)]],'usedMeshes':sorted(set(used)),'importPlacements':placements,'camera':{'location':list(cam.location),'orthoScale':15.427,'elevationDegrees':30,'azimuthDegrees':45},'shellContactWorldZ':0,'provenance':'Quaternius Modular SciFi FREE STANDARD meshes+trim textures with retained originals and acquisition evidence. Agent-authored terraced drum, segmentation and mechanical dish. Whole exterior shell disappears in HQ.'}
(R/'entry.json').write_text(json.dumps(meta,indent=2)+'\n');bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend/exterior.blend'));S.render.filepath=str(R/'renders/exterior.png');bpy.ops.render.render(write_still=True)
