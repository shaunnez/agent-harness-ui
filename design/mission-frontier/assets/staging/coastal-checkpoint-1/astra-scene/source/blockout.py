"""Checkpoint 1 composition only. No detailed material production before builder acceptance."""
import bpy,math,json,random,hashlib
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[1];CONTRACT=json.loads((R.parent/'contract.json').read_text());rng=random.Random(915100)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
S=bpy.context.scene;S.render.engine='CYCLES';S.cycles.samples=32;S.cycles.use_denoising=True;S.cycles.seed=915100;S.render.threads_mode='FIXED';S.render.threads=4;S.render.film_transparent=True;S.render.image_settings.file_format='PNG';S.render.image_settings.color_mode='RGBA';S.render.resolution_x=2560;S.render.resolution_y=1920;S.render.resolution_percentage=100;S.view_settings.view_transform='AgX';S.world.use_nodes=True;S.world.node_tree.nodes['Background'].inputs[0].default_value=(.22,.28,.36,1);S.world.node_tree.nodes['Background'].inputs[1].default_value=.4
# Ground-plane mapping: +X=(-32,+16), +Y=(+32,+16) logical pixels.
def world(u,v,z=0):return (v/32-u/64,v/32+u/64,z)
def mat(name,c,metal=0,rough=.6,emit=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emit:p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emit
 return m
ceramic=mat('blockout warm ceramic',(.63,.65,.62),.25,.42);steel=mat('blockout slate steel',(.045,.071,.083),.7,.42);glass=mat('blockout inset glazing',(.022,.10,.15),.5,.25);amber=mat('blockout practical fixtures',(.8,.35,.07),.2,.35,2);rock=mat('blockout coastal grey rock',(.19,.22,.20));strata=mat('blockout lower rock strata',(.14,.17,.17));meadow=mat('blockout coastal turf',(.22,.27,.15));soil=mat('blockout weathered path edges',(.30,.28,.22));deck=mat('blockout roadway',(.10,.14,.155),.35);sea=mat('blockout ocean datum',(.022,.16,.215),.25,.25);shallow=mat('blockout submerged shelf',(.055,.22,.24),.15,.4);purple=mat('blockout vegetation mass',(.24,.12,.27));bark=mat('blockout trunks',(.10,.095,.075))
GROUP='terrain';groups={k:[] for k in ['terrain','base','bridge','front','lights','water']}
def add(o,m):o.data.materials.append(m);o['asset_layer']=GROUP;groups[GROUP].append(o);return o
def cube(name,p,size,m,bev=.06):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);add(o,m)
 if bev:b=o.modifiers.new('blockout edge bevel','BEVEL');b.width=bev;b.segments=3;o.modifiers.new('weighted normals','WEIGHTED_NORMAL')
 return o
def hull(name,p,size,m,cut=.4):
 x,y,h=size[0]/2,size[1]/2,size[2]/2;outline=[(-x+cut,-y),(x-cut,-y),(x,-y+cut),(x,y-cut),(x-cut,y),(-x+cut,y),(-x,y-cut),(-x,-y+cut)];verts=[(a,b,z) for z in [-h,h] for a,b in outline];faces=[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)];me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);ob.location=p;add(ob,m);b=ob.modifiers.new('cast edge bevel','BEVEL');b.width=.06;b.segments=3;ob.modifiers.new('weighted normals','WEIGHTED_NORMAL');return ob
def cylinder(name,a,b,r,m,vertices=16):
 a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=(b-a).length,location=(a+b)/2);ob=bpy.context.object;ob.name=name;ob.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();add(ob,m);return ob

def landmass(name,poly):
 # Differently sized/elevated rings form a plateau, broken ledge and submerged foot.
 xy=[Vector(world(u,v,0)) for u,v in poly];center=sum(xy,Vector())/len(xy);rings=[(1.0,-.025), (1.025,-.75),(1.11,-1.48),(1.13,-2.8)]
 verts=[]
 for scale,z in rings:
  for p in xy:
   q=center+(p-center)*scale;verts.append((q.x,q.y,z))
 N=len(xy);faces=[tuple(range(N))];mi=[0]
 for k in range(3):
  for i in range(N):faces.append((k*N+i,k*N+(i+1)%N,(k+1)*N+(i+1)%N,(k+1)*N+i));mi.append(1 if k!=1 else 2)
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);add(o,meadow);o.data.materials.append(rock);o.data.materials.append(strata)
 for p,i in zip(me.polygons,mi):p.material_index=i
 # A lower exposed terrace occupies selected portions, not one uniform vertical rim.
 return o
mainpoly=[(-520,-100),(-465,-250),(-335,-330),(-195,-335),(-100,-275),(35,-275),(150,-235),(220,-195),(275,-140),(272,-95),(240,-30),(283,24),(235,102),(124,155),(-22,157),(-144,117),(-285,132),(-450,41),(-555,-31)]
farpoly=[(385,-220),(433,-285),(520,-315),(565,-284),(566,-221),(491,-172),(421,-151),(391,-174)]
landmass('main terraced coastal headland',mainpoly);landmass('far rocky abutment and existing route spur',farpoly)
# Secondary low promontories establish visible terracing and sheltered coves.
for name,poly,z in [('left low shore shelf',[(-565,-75),(-470,-30),(-435,58),(-344,111),(-440,136),(-558,39)],-1.25),('front low shore shelf',[(-260,133),(-100,117),(50,158),(175,122),(185,200),(55,210),(-100,196),(-231,180)],-1.5)]:
 pts=[world(u,v,z) for u,v in poly];me=bpy.data.meshes.new(name);me.from_pydata(pts,[],[tuple(range(len(pts)))]);o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);add(o,rock);sol=o.modifiers.new('low terrace depth','SOLIDIFY');sol.thickness=.7
# The courtyard stays clear for the named runtime worker sockets and complete ambient patrol.
court=hull('open live worker court',world(0,20,-.06),(5.3,5.3,.12),deck,.45)
# Main road, bridge and far road follow the exact existing route axis at z=0.
route_points={k:CONTRACT['composition'][k] for k in ['entrance','bridgeNear','bridgeFar','routeJoin']}
roadwidth=28/(32*32/ math.sqrt(32*32+16*16))
def road(name,near,far,layer,m,thickness):
 global GROUP;GROUP=layer;a=Vector(world(*near));b=Vector(world(*far));o=cube(name,(a+b)/2-Vector((0,0,thickness/2)),((b-a).length,roadwidth,thickness),m,.025);o.rotation_euler.z=math.atan2(b.y-a.y,b.x-a.x);return a,b
road('continuous courtyard approach',route_points['entrance'],route_points['bridgeNear'],'terrain',deck,.09)
road('far abutment approach to real route joint',route_points['bridgeFar'],route_points['routeJoin'],'terrain',deck,.09)
a,b=road('elevated inlet bridge deck',route_points['bridgeNear'],route_points['bridgeFar'],'bridge',steel,.23)
# Abutments, two supports and rails are structurally connected to a real gap over water.
for t in [.08,.92]:
 p=a.lerp(b,t);hull('bridge pier rock footing',(p.x,p.y,-2.49),(.68,1.52,.55),rock,.15)
 for side in [-1,1]:
  y=p.y+side*roadwidth*.34;cube('bridge vertical support',(p.x,y,-1.33),(.25,.25,2.33),steel,.035)
for end in [a,b]:cube('deck abutment bearing',(end.x,end.y,-.25),(.46,1.34,.48),ceramic,.06)
for sign in [-1,1]:
 y=a.y+sign*(roadwidth/2+.055);cylinder('bridge continuous upper guardrail',(a.x,y,.43),(b.x,y,.43),.038,steel)
 cylinder('bridge continuous lower guardrail',(a.x,y,.18),(b.x,y,.18),.022,steel)
 for k in range(9):
  x=a.x+(b.x-a.x)*k/8;cube('bridge rail upright',(x,y,.23),(.06,.07,.46),ceramic,.014)
# Articulated building massing: clear forward court, service wings, stepped command deck.
GROUP='base';bc=Vector(world(-25,-105));hull('headquarters lower ceramic mass',bc+Vector((0,0,1.20)),(6,5,2.4),ceramic,.60)
hull('lower dark structural belt',bc+Vector((0,0,.30)),(6.11,5.11,.30),steel,.62)
hull('main upper roof terrace',bc+Vector((0,0,2.42)),(6.22,5.22,.20),steel,.63)
upper=bc+Vector((-.62,-.53,3.0));hull('offset upper command volume',upper,(4.2,3.4,1.05),ceramic,.55)
hull('upper command glazing belt',upper+Vector((0,0,-.06)),(4.26,3.46,.37),glass,.55)
hull('upper ceramic roof step',upper+Vector((0,0,.57)),(4.4,3.6,.22),ceramic,.62)
# Recessed entrance is dark and framed, with projecting side service structures.
face=bc+Vector((3.055,.68,1.02));cube('recessed main entrance',face,(.025,1.68,1.89),steel,.04)
for y in [-.34,1.7]:hull('entrance jamb',bc+Vector((3.25,y,1.19)),(.40,.44,2.4),ceramic,.10)
cube('entrance projecting lintel',bc+Vector((3.25,.68,2.27)),(.68,2.44,.33),ceramic,.06)
GROUP='lights';cube('entrance warm practical',bc+Vector((3.608,.68,2.22)),(.035,1.35,.055),amber,.014)
GROUP='base'
# Low asymmetric service annexes break the central mass and ground the building in the court.
hull('left lower workshop wing',bc+Vector((1.48,-3.02,.80)),(2.5,1.65,1.60),ceramic,.36)
hull('workshop dark inset bay',bc+Vector((1.5,-3.86,.81)),(1.78,.025,1.09),steel,.04)
hull('right utility tower',bc+Vector((-2.18,2.17,1.35)),(1.65,1.68,2.7),ceramic,.28)
for k in range(3):cube('right tower deep vent band',bc+Vector((-2.18,3.023,.55+k*.60)),(1.17,.045,.28),steel,.015)
# Rooftop observation/communications equipment is massing only at this checkpoint.
tower=bc+Vector((-.90,-.70,3.85));hull('small rooftop control core',tower,(2.2,1.9,.60),ceramic,.30)
cylinder('roof receiver pedestal',tower+Vector((0,0,.2)),tower+Vector((0,0,.65)),.22,steel)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=tower+Vector((0,0,.89)));o=bpy.context.object;o.name='dish massing placeholder';o.scale=(.70,.70,.16);o.rotation_euler.y=.42;add(o,ceramic)
# Large dark inset facade windows establish depth but intentionally omit fine detail.
for k in [-1.8,-.2,1.40]:
 cube('front face recessed service bay',bc+Vector((k,2.525,1.23)),(1.18,.035,1.44),steel,.025)
 cube('front face glazing',bc+Vector((k,2.55,1.47)),(.93,.022,.58),glass,.015)
GROUP='terrain'
# Vegetation masses reserve composition space; final production must replace these placeholders.
for u,v,h in [(-370,-180,2.3),(-295,-275,2.1),(-470,-35,1.8),(124,-215,1.65),(535,-272,1.30)]:
 x,y,_=world(u,v);cylinder('tree placement trunk',(x,y,0),(x,y,h*.75),.12,bark)
 for dx,dy,dz in [(-.3,0,.10),(.3,.2,.22),(0,-.2,.48)]:
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.57,location=(x+dx,y+dy,h+dz));o=bpy.context.object;o.name='vegetation composition proxy';o.scale=(1.15,1,.8);add(o,purple)
# Water datum is shown in the assembled blockout only, never an opaque runtime background.
GROUP='water';cube('ocean blockout datum',(0,0,-2.87),(90,90,.10),sea,0)
# Shared warm upper-left light and cool sky fill.
lights=[]
for name,loc,energy,col,size in [('warm upper left',(10,-6,16),4200,(1,.83,.66),7),('cool sky fill',(4,1,8),600,(.65,.78,1),9)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=energy;o.data.color=col;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler();lights.append({'name':name,'location':loc,'energy':energy,'color':col,'size':size,'rotationEuler':list(o.rotation_euler)})
bpy.ops.object.camera_add(location=(20,20,16.329931619));cam=bpy.context.object;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1280/(32*math.sqrt(2));S.camera=cam
bpy.context.view_layer.update();q=world_to_camera_view(S,cam,Vector((0,0,0)));right=cam.rotation_euler.to_matrix()@Vector((1,0,0));up=cam.rotation_euler.to_matrix()@Vector((0,1,0));cam.location-=right*((.5-q.x)*cam.data.ortho_scale)+up*((1-1200/1920-q.y)*cam.data.ortho_scale*1920/2560);bpy.context.view_layer.update()
def project(v):
 q=world_to_camera_view(S,cam,Vector(v));return [round(q.x*2560/2,6),round((1-q.y)*1920/2,6)]
origin=project((0,0,0));basis={k:[round(a-b,6) for a,b in zip(project(p),origin)] for k,p in {'x':(1,0,0),'y':(0,1,0),'z':(0,0,1)}.items()}
sockets={k:{'relativeLogicalRequested':v,'world':list(world(*v)),'logicalMeasured':project(world(*v)),'relativeLogicalMeasured':[round(a-b,6) for a,b in zip(project(world(*v)),origin)]} for k,v in route_points.items()}
meta={'status':'assembled-blockout-awaiting-composition-review','contractRevision':CONTRACT['revision'],'contractSHA256':hashlib.sha256((R.parent/'contract.json').read_bytes()).hexdigest(),'sourceSize':[2560,1920],'logicalSize':[1280,960],'groundAnchorMeasured':origin,'projectedBasisLogical':basis,'camera':{'location':list(cam.location),'rotationEuler':list(cam.rotation_euler),'orthoScale':cam.data.ortho_scale},'lightTransforms':lights,'sockets':sockets,'workerSockets':{'task':[{ 'relative':p,'measured':project(world(*p))} for p in CONTRACT['composition']['workers']],'ambientPatrolSource':'src/frontier/world/worker-behavior.ts:112; full 2-crew World loops preserved in open court'},'bridge':{'deckTopZ':0,'waterTopZ':-2.82,'deckWorldWidth':roadwidth,'near':list(a),'far':list(b),'actualInlet':'separate main headland and far rock polygons; water under central span'},'geometrySources':{'mainPlateauUV':mainpoly,'farAbutmentUV':farpoly},'placeholders':['tree crowns/trunks are composition masses','dish is a roof-volume proxy','materials are blockout swatches; no detailed production started'],'layerObjectCounts':{k:len(v) for k,v in groups.items()}}
(R/'qa/blockout-calibration.json').write_text(json.dumps(meta,indent=2)+'\n');bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend/coastal-blockout.blend'));S.render.filepath=str(R/'renders/blockout.png');bpy.ops.render.render(write_still=True)
