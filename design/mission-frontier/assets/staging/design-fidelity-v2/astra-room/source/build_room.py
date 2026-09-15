"""Original Mission Frontier room geometry. Run Blender -b -t 4 --python this.py -- --quality calibration|final."""
import bpy, math, json, sys, random
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[1]
quality='final' if '--quality' in sys.argv and sys.argv[sys.argv.index('--quality')+1]=='final' else 'calibration'
rng=random.Random(9152026)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
S=bpy.context.scene;S.render.engine='CYCLES';S.cycles.samples=24 if quality=='calibration' else 64;S.cycles.use_denoising=True;S.cycles.seed=9152026
S.render.threads_mode='FIXED';S.render.threads=4;S.render.film_transparent=True;S.render.image_settings.file_format='PNG';S.render.image_settings.color_mode='RGBA';S.render.image_settings.color_depth='8'
S.render.resolution_x=1536;S.render.resolution_y=1280;S.render.resolution_percentage=100;S.view_settings.view_transform='AgX';S.world.use_nodes=True;S.world.node_tree.nodes['Background'].inputs[0].default_value=(.22,.28,.36,1);S.world.node_tree.nodes['Background'].inputs[1].default_value=.36
G={k:[] for k in ['floor','back','front']};group='floor'
def mat(name,col,metal=.0,rough=.45,emission=0,wear=False):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emission:p.inputs['Emission Color'].default_value=(*col,1);p.inputs['Emission Strength'].default_value=emission
 if wear:
  n=m.node_tree.nodes;l=m.node_tree.links;tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=24.0;tex.inputs['Detail'].default_value=3
  ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.18;ramp.color_ramp.elements[0].color=(*(v*.76 for v in col),1);ramp.color_ramp.elements[1].position=.8;ramp.color_ramp.elements[1].color=(*col,1);l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],p.inputs['Base Color'])
  fine=n.new('ShaderNodeTexNoise');fine.inputs['Scale'].default_value=160;b=n.new('ShaderNodeBump');b.inputs['Strength'].default_value=.18;b.inputs['Distance'].default_value=.006;l.new(fine.outputs['Fac'],b.inputs['Height']);l.new(b.outputs[0],p.inputs['Normal'])
 return m
ceramic=mat('warm weathered ceramic',(.63,.65,.62),.32,.39,wear=True);lightceramic=mat('ceramic edge caps',(.73,.74,.69),.28,.36,wear=True);dark=mat('deep graphite structure',(.027,.041,.048),.72,.44,wear=True);steel=mat('brushed blue steel',(.115,.16,.18),.78,.39,wear=True);floorM=[mat('floor plate '+str(i),(.085+i*.009,.105+i*.009,.113+i*.009),.7,.48,wear=True) for i in range(4)];rubber=mat('black gaskets',(.009,.014,.019),.05,.7);silver=mat('exposed fasteners',(.32,.36,.35),.85,.29);bronze=mat('aged warm safety alloy',(.39,.23,.07),.76,.45,wear=True);amber=mat('amber practical lamps',(.95,.39,.075),.25,.27,4);blue=mat('unlabelled blue screens',(.012,.16,.29),.52,.24,1.1);screenline=mat('screen geometric diagram lines',(.045,.37,.61),.45,.3,1.5)
def tag(o,m):o.data.materials.append(m);G[group].append(o);return o
def box(n,loc,size,m,bevel=.025):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=n;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);tag(o,m)
 if bevel:b=o.modifiers.new('machined softened edges','BEVEL');b.width=bevel;b.segments=3;o.modifiers.new('face normals','WEIGHTED_NORMAL')
 return o
def cylinder(n,a,b,r,m,verts=12):
 a=Vector(a);b=Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=(b-a).length,location=(a+b)/2);o=bpy.context.object;o.name=n;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();tag(o,m);bev=o.modifiers.new('edge roll','BEVEL');bev.width=min(.012,r*.13);bev.segments=2;o.modifiers.new('face normals','WEIGHTED_NORMAL');return o
def cable(n,pts,r,m):
 c=bpy.data.curves.new(n,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=2;s=c.splines.new('BEZIER');s.bezier_points.add(len(pts)-1)
 for p,co in zip(s.bezier_points,pts):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 o=bpy.data.objects.new(n,c);bpy.context.collection.objects.link(o);tag(o,m);return o
def hull(n,loc,size,m,cut=.15):
 x,y,z=size[0]/2,size[1]/2,size[2]/2;a=[(-x+cut,-y),(x-cut,-y),(x,-y+cut),(x,y-cut),(x-cut,y),(-x+cut,y),(-x,y-cut),(-x,-y+cut)];v=[(xx+loc[0],yy+loc[1],zz+loc[2]) for zz in [-z,z] for xx,yy in a];f=[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)];me=bpy.data.meshes.new(n);me.from_pydata(v,[],f);o=bpy.data.objects.new(n,me);bpy.context.collection.objects.link(o);tag(o,m);be=o.modifiers.new('edge bevel','BEVEL');be.width=.025;be.segments=3;o.modifiers.new('normals','WEIGHTED_NORMAL');return o
# A 10x10 walkable plate with a physically deep platform. Top corners are the registration footprint.
box('platform lower armored chassis',(0,0,-.34),(10,10,.52),dark,.06);box('thin perimeter upper lip',(0,0,-.075),(10,10,.15),steel,.025)
for i in range(10):
 for j in range(10):
  x=-4.5+i;y=-4.5+j;box('individual inset deck plate',(x,y,-.015),(.962,.962,.06),floorM[(i*7+j*3)%4],.015)
  if (i+j)%3==0:
   for k in [-1,1]:box('recessed deck fastening',(x+k*.38,y-.38,.017),(.033,.033,.009),silver,.004)
# Service tracks and inset perimeter drains leave central ground empty.
for axis in [0,1]:
 for sign in [-1,1]:
  for t in range(18):
   pos=(-4.25+t*.5,sign*4.12,.025);dims=(.44,.16,.035)
   if axis:pos=(pos[1],pos[0],pos[2]);dims=(dims[1],dims[0],dims[2])
   box('perimeter drainage cassette',pos,dims,rubber,.008)
   for k in range(4):
    q=list(pos);q[axis]+=(k-1.5)*.10;di=(.025,.145,.013) if not axis else (.145,.025,.013);box('drain grille fin',(q[0],q[1],.049),di,steel,.004)
  pos=(0,sign*3.94,.028);di=(8.75,.024,.014)
  if axis:pos=(pos[1],pos[0],pos[2]);di=(di[1],di[0],di[2])
  box('fine inset guidance alloy',pos,di,bronze,.003)
# Platform exterior segmented fascia with vent slots, structural ribs and occasional warm lamp.
for side in [0,1]:
 for i in range(10):
  u=-4.5+i
  def pf(v,z):return (5.01,v,z) if side==0 else (v,5.01,z)
  sz=(.075,.94,.33) if side==0 else (.94,.075,.33)
  box('platform fascia cassette',pf(u,-.33),sz,steel,.026)
  for k in [-.3,0,.3]:
   sz2=(.015,.18,.042) if side==0 else (.18,.015,.042);box('fascia slot',pf(u+k,-.30),sz2,rubber,.004)
  if i%3==1:
   sz3=(.028,.42,.047) if side==0 else (.42,.028,.047);box('recessed platform lamp',pf(u,-.17),sz3,amber,.009)
# Two far walls built from structural frames, ceramic outer skin and deep dark service bays.
group='back'
def wallpoint(side,u,d,z):return (u,-4.84+d,z) if side==0 else (-4.84+d,-u,z)
def wb(side,n,u,d,z,size,m,bev=.025):
 o=hull(n,(0,0,0),size,m,.17) if n=='segmented ceramic coping' else box(n,wallpoint(side,u,d,z),size,m,bev)
 if n=='segmented ceramic coping':o.location=wallpoint(side,u,d,z)
 if side:o.rotation_euler.z=math.pi/2
 return o
def wc(side,n,pts,r,m):return cable(n,[wallpoint(side,*p) for p in pts],r,m)
for side in [0,1]:
 wb(side,'continuous wall steel spine',0,0,1.23,(9.72,.36,2.5),dark,.04)
 wb(side,'ceramic outer lower band',0,-.23,.48,(9.75,.22,.88),ceramic,.04)
 for i in range(5):
  u=-3.84+i*1.92; style=(i+(2 if side else 0))%5
  wb(side,'ceramic outer armor panel',u,-.24,1.68,(1.86,.26,1.42),ceramic,.055)
  wb(side,'top ceramic beam gasket',u,0,2.54,(1.90,.62,.15),rubber,.025)
  wb(side,'segmented ceramic coping',u,0,2.60,(1.86,.65,.12),lightceramic,.055)
  # Inner recessed bays have a dark surround, frame and interchangeable machinery motifs.
  wb(side,'inner bay bevel surround',u,.255,1.33,(1.60,.19,1.86),steel,.07)
  wb(side,'inner bay recessed dark face',u,.37,1.34,(1.40,.095,1.66),rubber,.025)
  for v in [-.64,.64]:wb(side,'bay vertical inset rail',u+v,.45,1.32,(.045,.065,1.54),bronze,.012)
  wb(side,'inset lamp armored pocket',u,.46,2.12,(1.05,.13,.13),dark,.027)
  wb(side,'amber warm upper practical',u,.535,2.105,(.73,.033,.045),amber,.01)
  wb(side,'lower service plinth',u,.53,.30,(1.62,.44,.38),steel,.055)
  for k in range(5):wb(side,'plinth vent fin',u-.48+k*.24,.767,.33,(.10,.015,.12),dark,.005)
  if style in [1,3]:
   wb(side,'recessed display casing',u-.05,.50,1.32,(1.04,.17,.82),steel,.048)
   wb(side,'blue blank display glass',u-.05,.599,1.34,(.88,.028,.65),blue,.02)
   # Abstract linework only, deliberately no lettering or semantic status.
   for k in range(5):wb(side,'screen horizontal technical line',u-.14,.618,1.12+k*.095,(.54 if k%2 else .70,.009,.007),screenline,.001)
   for k in [-.32,.28]:wb(side,'screen framing line',u+k,.619,1.34,(.007,.009,.49),screenline,.001)
   wb(side,'display lower input shelf',u,.69,.78,(1.16,.46,.13),dark,.035)
   for k in range(7):wb(side,'unlabelled input socket',u-.43+k*.14,.85,.863,(.06,.065,.02),silver,.005)
   wc(side,'display data cable',[(u+.63,.48,1.2),(u+.74,.50,.93),(u+.68,.50,.64),(u+.63,.49,.43)],.035,dark)
  elif style==2:
   for k in range(3):
    wb(side,'power service drawer',u,.49,.78+k*.39,(1.08,.18,.31),dark,.026)
    for h in range(6):wb(side,'cooling grille',u-.41+h*.165,.595,.78+k*.39,(.07,.025,.20),steel,.007)
    wb(side,'drawer latch',u+.54,.617,.78+k*.39,(.035,.045,.11),silver,.007)
   wc(side,'amber insulated conduit',[(u-.5,.54,.6),(u-.57,.54,1.3),(u-.47,.54,1.79),(u+.35,.54,1.85)],.025,bronze)
  else:
   wb(side,'service access hatch',u-.13,.48,1.30,(.69,.17,1.09),ceramic,.035)
   wb(side,'hatch recessed handhold',u+.04,.585,1.24,(.12,.035,.22),dark,.015)
   for k in range(7):wb(side,'hatch lower vents',u-.36+k*.072,.576,.94,(.037,.025,.14),dark,.004)
   for v in [-.40,.16]:
    for z in [.84,1.76]:wb(side,'hatch corner hex fastener',u+v,.58,z,(.042,.025,.042),silver,.007)
   for v in [.39,.52]:wc(side,'bundled wall cable',[(u+v,.45,.48),(u+v,.47,.93),(u+v+.07,.47,1.55),(u+v,.46,1.88)],.023,dark if v==.39 else bronze)
  for v in [-.82,.82]:
   for z in [.43,2.30]:wb(side,'frame exposed bolt',u+v,.35,z,(.055,.034,.055),silver,.008)
 # Massive uprights every two panels, with smaller dark strips at intermediate joins.
 for i in range(6):
  u=-4.8+i*1.92
  wb(side,'ceramic structural upright',u,.27,1.34,(.22,.49,2.67),ceramic,.045)
  wb(side,'upright inset steel channel',u,.532,1.34,(.075,.028,1.40),steel,.013)
  for z in [.24,2.44]:wb(side,'upright collar',u,.30,z,(.28,.56,.13),lightceramic,.022)
  for z in [.65,2.02]:wb(side,'upright fastener',u,.55,z,(.052,.032,.052),silver,.007)
# A second, smaller scale of mechanical construction breaks up broad ceramic surfaces.
for side in [0,1]:
 for i in range(5):
  u=-3.84+i*1.92; style=(i+(2 if side else 0))%5
  # The upper beam has a real recessed service strip and segmented armor seam.
  wb(side,'upper ceramic inner fascia',u,.27,2.39,(1.53,.20,.22),ceramic,.035)
  wb(side,'upper beam dark service inset',u+.14,.383,2.405,(.84,.023,.09),dark,.009)
  for k in range(6):wb(side,'upper inset heat fin',u-.17+k*.123,.401,2.406,(.061,.022,.049),steel,.003)
  wb(side,'coping recessed top service plate',u-.10,.02,2.674,(.79,.37,.018),steel,.022)
  for k in [-.39,.19]:
   wb(side,'top service panel silver lock',u+k,.14,2.688,(.028,.030,.015),silver,.003)
  for k in [-.72,.72]:
   wb(side,'top armored panel seam',u+k,0,2.670,(.018,.61,.009),rubber,.002)
  # Small functional junction housings and connected conduits occupy wall edges.
  wb(side,'cable junction enclosure',u+.53,.58,.63,(.16,.19,.21),steel,.022)
  wb(side,'junction inset alloy face',u+.53,.69,.65,(.105,.026,.11),bronze,.008)
  for z in [.59,.71]:wb(side,'junction fixing',u+.53,.71,z,(.025,.015,.025),silver,.003)
  for v in [-.58,.54]:
   wb(side,'structural lower foot socket',u+v,.40,.12,(.29,.59,.22),dark,.032)
   wb(side,'foot socket alloy top',u+v,.50,.234,(.16,.29,.025),steel,.011)
  # Exposed steel at panel boundaries reads as manufactured layering, not painted lines.
  for z in [.52,1.99]:wb(side,'horizontal bay retaining strip',u,.52,z,(1.19,.04,.027),steel,.004)
  # Asymmetric circuit detail is geometry; no text or state indicators.
  if style in [1,3]:
   for k in range(4):
    wb(side,'screen lower geometric blocks',u-.34+k*.16,.620,1.62,(.065,.009,.027),screenline,.003)
  elif style in [0,4]:
   for z in [1.12,1.38,1.6]:
    wb(side,'service cover bracket',u-.46,.57,z,(.11,.10,.045),steel,.006)
    wb(side,'cover bracket screw',u-.45,.632,z,(.026,.014,.026),silver,.004)
 # Continuous low pipe rack sits above the wall foot and remains behind walkable space.
 for z in [.075,.14]:wc(side,'low twin utility conduit',[(-4.55,.88,z),(0,.88,z),(4.55,.88,z)],.021,bronze if z==.075 else steel)
# Subtle extra deck construction: maintenance hatches and inset paired deck seams.
group='floor'
for x,y in [(-2.5,-3.5),(3.5,2.5),(-3.5,1.5),(1.5,3.5)]:
 hull('flush chamfered maintenance hatch',(x,y,.020),(.77,.78,.025),steel,.13)
 hull('hatch centre deck panel',(x,y,.036),(.67,.68,.013),floorM[1],.11)
 for dx in [-.24,.24]:
  box('flush hatch lifting recess',(x+dx,y,.045),(.05,.17,.008),rubber,.007)
for side in [0,1]:
 for i in range(9):
  u=-4+i
  loc=(5.027,u,-.32) if side==0 else (u,5.027,-.32)
  sz=(.036,.045,.36) if side==0 else (.045,.036,.36)
  box('platform external titanium splice',loc,sz,silver,.007)
group='back'
# Corner service mast closes the join, rather than overlapping two thin walls.
hull('rear corner structural core',(-4.62,-4.62,1.31),(.64,.64,2.66),ceramic,.12)
# Foreground parapets intentionally below knees and physically interrupted for access.
group='front'
for side in [0,1]:
 for sign in [-1,1]:
  mid=sign*3.30
  loc=(4.80,mid,.17) if side==0 else (mid,4.80,.17);sz=(.32,2.65,.34) if side==0 else (2.65,.32,.34)
  box('low armored parapet',loc,sz,ceramic,.055)
  pos=list(loc);pos[2]=.365;sz2=(.39,2.69,.095) if side==0 else (2.69,.39,.095);box('dark parapet coping',pos,sz2,steel,.025)
  for k in [-.89,0,.89]:
   pos=list(loc);pos[1 if side==0 else 0]+=k;pos[2]=.16;sz3=(.355,.038,.30) if side==0 else (.038,.355,.30);box('parapet panel gasket',pos,sz3,dark,.004)
  for k in [-1.26,1.26]:
   pos=list(loc);pos[1 if side==0 else 0]+=k;pos[2]=.34;box('parapet end cap',pos,(.43,.43,.62),ceramic,.06)
   pos[0 if side==0 else 1]+=.225;sz4=(.035,.09,.12) if side==0 else (.09,.035,.12);box('low entrance practical lamp',pos,sz4,amber,.016)
 # Threshold sits in the open central span.
 loc=(4.83,0,.041) if side==0 else (0,4.83,.041);sz=(.29,3.92,.045) if side==0 else (3.92,.29,.045);box('open entrance threshold',loc,sz,steel,.015)
 for k in range(13):
  pos=list(loc);pos[1 if side==0 else 0]=-1.8+k*.3;pos[2]=.071;sz2=(.21,.035,.014) if side==0 else (.035,.21,.014);box('threshold anti slip grooves',pos,sz2,rubber,.003)
# Physical warm daylight shared with prior assets, restrained cool fill.
for name,loc,energy,col,size in [('warm upper left',(10,-6,16),3600,(1,.83,.66),7),('cool sky fill',(4,1,8),650,(.65,.78,1),9)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=energy;o.data.color=col;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(12,12,9.797958971));cam=bpy.context.object;cam.name='registered 2 to 1 isometric camera';cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1536*math.sqrt(2)*10/1408;S.camera=cam
bpy.context.view_layer.update();q=world_to_camera_view(S,cam,Vector((5,5,0)));right=cam.rotation_euler.to_matrix()@Vector((1,0,0));up=cam.rotation_euler.to_matrix()@Vector((0,1,0));cam.location-=right*((.5-q.x)*cam.data.ortho_scale)+up*((1-1044/1280-q.y)*cam.data.ortho_scale*1280/1536);bpy.context.view_layer.update()
def pixel(v):
 q=world_to_camera_view(S,cam,Vector(v));return [round(q.x*1536,5),round((1-q.y)*1280,5)]
meta={'camera':{'azimuthDegrees':45,'elevationDegrees':30,'orthoScale':cam.data.ortho_scale,'location':list(cam.location)},'sourceSize':[1536,1280],'logicalSize':[768,640],'groundAnchor':[384,522],'groundAnchorSourceMeasured':pixel((5,5,0)),'floorCornersSourceMeasured':{k:pixel(v) for k,v in {'back':(-5,-5,0),'right':(-5,5,0),'front':(5,5,0),'left':(5,-5,0)}.items()},'objectCounts':{k:len(v) for k,v in G.items()},'samples':S.cycles.samples,'seed':9152026,'blenderVersion':bpy.app.version_string,'layering':'floor then back then live stations and workers then front','renderLayerIsolation':'Camera visibility only; other layers still cast physically registered shadows. Front walls never exceed 0.67 world units.','centralFloorClearWorldBounds':[[-3.6,-3.6],[3.6,3.6]]}
(R/'source'/('geometry-'+quality+'.json')).write_text(json.dumps(meta,indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend'/('room-'+quality+'.blend')))
if quality=='calibration':
 S.render.filepath=str(R/'renders/calibration-combined.png');bpy.ops.render.render(write_still=True)
else:
 for layer in ['floor','back','front']:
  for k,objs in G.items():
   for o in objs:o.visible_camera=k==layer
  S.render.filepath=str(R/'renders'/('room-'+layer+'-r1.png'));bpy.ops.render.render(write_still=True)
 for objs in G.values():
  for o in objs:o.visible_camera=True
 bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend/room-final.blend'))

if quality=='final':
 blackEmission=bpy.data.materials.new('lights pass opaque black occluder');blackEmission.use_nodes=True
 nodes=blackEmission.node_tree.nodes;nodes.clear();out=nodes.new('ShaderNodeOutputMaterial');em=nodes.new('ShaderNodeEmission');em.inputs['Color'].default_value=(0,0,0,1);blackEmission.node_tree.links.new(em.outputs[0],out.inputs['Surface'])
 emitterNames={amber.name,blue.name,screenline.name}
 for objs in G.values():
  for ob in objs:
   for slot in ob.material_slots:
    if slot.material.name not in emitterNames:slot.material=blackEmission
 S.cycles.samples=16
 bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend/room-lights-pass.blend'))
 S.render.filepath=str(R/'renders/room-lights-raw-r1.png');bpy.ops.render.render(write_still=True)
