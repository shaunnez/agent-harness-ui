import bpy,math,random,json,hashlib
from mathutils import Vector,Matrix
import coastal_common as C
W=C.W;M=C.M;rng=random.Random(915102)
SHORE=[];rock_templates=[]
def terrain_material():
 m=C.material('salt meadow earth and low vegetation',(.26,.30,.18),0,.95);n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');coord=n.new('ShaderNodeTexCoord');noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1.3;noise.inputs['Detail'].default_value=4;noise.inputs['Roughness'].default_value=.63;l.new(coord.outputs['Object'],noise.inputs['Vector']);r=n.new('ShaderNodeValToRGB');r.color_ramp.elements.remove(r.color_ramp.elements[1]);r.color_ramp.elements[0].position=.15;r.color_ramp.elements[0].color=(.105,.18,.085,1)
 for t,col in [(.40,(.17,.26,.115,1)),(.60,(.27,.31,.17,1)),(.80,(.39,.36,.26,1))]:r.color_ramp.elements.new(t).color=col
 l.new(noise.outputs['Fac'],r.inputs[0]);l.new(r.outputs[0],p.inputs['Base Color']);micro=n.new('ShaderNodeTexNoise');micro.inputs['Scale'].default_value=60;micro.inputs['Detail'].default_value=3;l.new(coord.outputs['Object'],micro.inputs['Vector']);b=n.new('ShaderNodeBump');b.inputs['Strength'].default_value=.22;b.inputs['Distance'].default_value=.025;l.new(micro.outputs['Fac'],b.inputs['Height']);l.new(b.outputs[0],p.inputs['Normal']);return m

def F(u):return -100+(u+100)*.80 if u< -100 else u
main=[(-520,-100),(-465,-250),(-335,-330),(-195,-335),(-100,-275),(35,-275),(150,-235),(220,-195),(275,-140),(272,-95),(240,-30),(283,24),(235,102),(124,155),(-22,157),(-144,117),(-285,132),(-450,41),(-555,-31)]
main=[(F(u),v) for u,v in main]
far=[(400,-221),(443,-275),(510,-289),(544,-270),(551,-238),(505,-191),(449,-170),(412,-186)]
def inside(u,v,poly=main):
 hit=False
 for i,(x,y) in enumerate(poly):
  xx,yy=poly[i-1]
  if ((y>v)!=(yy>v)) and u<(xx-x)*(v-y)/(yy-y)+x:hit=not hit
 return hit

def height(u,v):
 # Smoothly grade the planted rear shoulder into the manufactured terrace.
 clearance=max(-236-u,u-210,-210-v,v-119,0)
 fade=min(1,clearance/60);fade=fade*fade*(3-2*fade)
 hill=1.52*math.exp(-((u+323)/112)**2-((v+206)/110)**2)+.86*math.exp(-((u+410)/83)**2-((v+38)/92)**2)
 return -.035+fade*(hill+.075*math.sin(u*.031)*math.cos(v*.033))
def build_land(name,poly,soilmat,is_main=True):
 dense=[]
 for i,(u,v) in enumerate(poly):
  q=poly[(i+1)%len(poly)]
  for k in range(4):
   t=k/4;dense.append((u+(q[0]-u)*t,v+(q[1]-v)*t))
 N=len(dense);center=(sum(u for u,v in dense)/N,sum(v for u,v in dense)/N);vs=[tuple(W(*center,height(*center) if is_main else -.035))];fs=[]
 for j,f in enumerate([i/16 for i in range(1,17)]):
  for u,v in dense:
   uu=center[0]+(u-center[0])*f;vv=center[1]+(v-center[1])*f;vs.append(tuple(W(uu,vv,height(uu,vv) if is_main else -.035)))
 for i in range(N):fs.append((0,1+i,1+(i+1)%N))
 for j in range(15):
  for i in range(N):
   a=1+j*N+i;b=1+j*N+(i+1)%N;fs.extend([(a,b,b+N),(a,b+N,a+N)])
 top_faces=[]
 for f in fs:
  a,b,c=[Vector(vs[i]) for i in f[:3]];top_faces.append(tuple(reversed(f)) if (b-a).cross(c-a).z<0 else f)
 ob=C.meshob(name+' undulating upper surface',vs,top_faces,soilmat)
 for face in ob.data.polygons:face.use_smooth=True
 # Coast strata use irregular shared boundaries, then many separately articulated rock blocks.
 coastal=[]
 for j,(scale,z) in enumerate([(1,-.08),(1.018,-.70),(1.055,-1.52),(1.077,-2.86)]):
  ring=[]
  for i,(u,v) in enumerate(dense):
   uu=center[0]+(u-center[0])*scale;vv=center[1]+(v-center[1])*scale
   if j:uu+=rng.uniform(-3,3);vv+=rng.uniform(-2,2)
   zz=(height(uu,vv) if is_main else -.035) if j==0 else z+rng.uniform(-.065,.065)
   ring.append(tuple(W(uu,vv,zz)))
  coastal.append(ring)
 cv=sum(coastal,[]);cf=[]
 for j in range(3):
  for i in range(N):cf.extend([(j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N),(j*N+i,(j+1)*N+(i+1)%N,(j+1)*N+i)])
 rock=C.meshob(name+' fractured coastal core',cv,cf,M['stone']);rock.data.materials.append(M['stoneDark'])
 for p in rock.data.polygons:p.material_index=1 if rng.random()<.32 else 0
 # Foot polygon is the authored shore seed; later waterline boulders add their intersections.
 SHORE.append([[p[0],p[1]] for p in coastal[-1]])
 for j,z in enumerate([-.46,-1.14,-1.93,-2.54]):
  for i in range(N):
   if rng.random()<.20:continue
   p=Vector(coastal[min(j+1,3)][i]);p.z=z+rng.uniform(-.27,.27)
   prev=Vector(coastal[min(j+1,3)][(i-1)%N]);nxt=Vector(coastal[min(j+1,3)][(i+1)%N]);angle=math.atan2(nxt.y-prev.y,nxt.x-prev.x)
   rock_piece(p,(rng.uniform(.40,.78),rng.uniform(.24,.43),rng.uniform(.24,.46)),angle,'exposed fractured cliff stratum',j==3)
 return dense

def init_rocks():
 folder=C.source_path('sources/stylized-nature-megakit/glTF')
 for k in range(1,4):
  before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(folder/f'Rock_Medium_{k}.gltf'));new=set(bpy.data.objects)-before
  for ob in new:
   if ob.type!='MESH':continue
   me=ob.data.copy();points=[ob.matrix_world@v.co for v in me.vertices];lo=Vector(tuple(min(p[i] for p in points) for i in range(3)));hi=Vector(tuple(max(p[i] for p in points) for i in range(3)));center=(lo+hi)/2
   for vert,point in zip(me.vertices,points):vert.co=Vector(tuple((point[i]-center[i])/max((hi[i]-lo[i])/2,.001) for i in range(3)))
   me.materials.clear();me.materials.append(M['stoneDark'] if k==1 else M['stone']);rock_templates.append(me)
  for ob in new:bpy.data.objects.remove(ob,do_unlink=True)
def rock_piece(p,scale,angle,name,waterline=False):
 ob=bpy.data.objects.new(name,rng.choice(rock_templates));bpy.context.collection.objects.link(ob);ob.location=p;ob.scale=scale;ob.rotation_euler=(rng.uniform(-.14,.14),rng.uniform(-.12,.12),angle);C.tag(ob,None)
 if waterline:
  # Conservative horizontal ellipse at sea datum for mask shoreline unions.
  dz=abs(-2.82-p.z)/scale[2]
  if dz<1:
   r=math.sqrt(1-dz*dz);poly=[]
   for a in range(16):
    t=a*math.tau/16;x=math.cos(t)*scale[0]*r;y=math.sin(t)*scale[1]*r;poly.append([p.x+x*math.cos(angle)-y*math.sin(angle),p.y+x*math.sin(angle)+y*math.cos(angle)])
   SHORE.append(poly)
 return ob

def add_vegetation():
 source=C.source_path('vegetation-production/blend/spreading-grove-r2.blend')
 with bpy.data.libraries.load(str(source),link=False) as (data_from,data_to):data_to.objects=[n for n in data_from.objects if any(t in n for t in ['TwistedTree','Bush'])]
 templates=[o for o in data_to.objects if o and o.type=='MESH']
 # Identify actual imported shapes by bounding height; no generated tree substitutes.
 templates.sort(key=lambda o:o.dimensions.z,reverse=True)
 if not templates:raise RuntimeError('Expected existing grove mesh objects were absent')
 positions=[(-326,-239,.50,.2),(-415,-106,.46,1.6),(-374,11,.36,.9),(-149,-289,.40,2.8),(150,-217,.32,1.1),(-292,82,.26,2.3)]
 for i,(u,v,s,angle) in enumerate(positions):
  template=templates[0 if i%3 else min(1,len(templates)-1)];o=template.copy();o.data=template.data;bpy.context.collection.objects.link(o);o.name='existing Quaternius purple coastal tree';o['asset_layer']='terrain';o.rotation_euler.z+=angle;o.scale*=s
  bpy.context.view_layer.update();pts=[o.matrix_world@Vector(p) for p in o.bound_box];center=Vector(((min(p.x for p in pts)+max(p.x for p in pts))/2,(min(p.y for p in pts)+max(p.y for p in pts))/2,min(p.z for p in pts)));dest=W(u,v,height(u,v)-.04);o.location+=dest-center
 for i in range(52):
  u,v=rng.choice([(-415,-109),(-330,-229),(-361,-17),(-279,101),(-157,-281),(167,-225),(210,76),(-250,-285)])
  u+=rng.uniform(-31,31);v+=rng.uniform(-22,22)
  if not inside(u,v):continue
  template=templates[-1];o=template.copy();o.data=template.data;bpy.context.collection.objects.link(o);o.name='retained coastal shrub cluster';o['asset_layer']='terrain';o.scale*=rng.uniform(.28,.55);o.rotation_euler.z+=rng.random()*math.tau
  bpy.context.view_layer.update();pts=[o.matrix_world@Vector(p) for p in o.bound_box];center=Vector(((min(p.x for p in pts)+max(p.x for p in pts))/2,(min(p.y for p in pts)+max(p.y for p in pts))/2,min(p.z for p in pts)));o.location+=W(u,v,height(u,v)-.07)-center
 for o in templates:
  if o.users_collection:bpy.data.objects.remove(o,do_unlink=True)
 provenance={'blendPath':str(source),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'licenceEvidence':'Existing Quaternius FREE Standard CC0 acquisition evidence in original cinematic-v1/astra/sources/acquisition.json; no new acquisition','placements':positions,'packedIntoFinalBlend':True,'rockSources':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in C.source_path('sources/stylized-nature-megakit/glTF').glob('Rock_Medium_[123].gltf')]}
 return provenance

def build():
 C.group='terrain';C.remove_layer('terrain');init_rocks();green=terrain_material();dense=build_land('main headland',main,green);build_land('far compact abutment',far,green,False)
 # Interrupted low shore shelves are uneven isolated bedrock, not concentric bands.
 for u,v,sz,z in [(-366,85,(1.8,1.2,.35),-1.55),(-182,130,(2.1,.95,.35),-1.72),(81,145,(1.45,1.1,.36),-1.82),(246,80,(.95,.85,.43),-1.7)]:rock_piece(W(u,v,-2.17),(sz[0],sz[1],.94),rng.uniform(-1,1),'grounded low coastal ledge',True)
 for i in range(130):
  u=rng.uniform(-442,240);v=rng.uniform(-265,128)
  if not inside(u,v):continue
  if (-235<u<195 and -210<v<120) or (u>140 and v< -100):continue
  # Scatter on plateau only, away from the live court and route corridor.
  if u<-400 and v>70:continue
  rock_piece(W(u,v,height(u,v)+.015),(rng.uniform(.04,.13),rng.uniform(.04,.12),rng.uniform(.04,.10)),rng.random()*math.tau,'embedded plateau stone')
 # Low patchy grasses with blade geometry, never a continuous high-contrast turf pattern.
 grass=C.material('short salt meadow blades',(.24,.29,.15),0,.96)
 for u,v in [(-398,-123),(-309,-221),(-250,-268),(-361,-17),(-281,106),(120,-249)]:
  verts=[];faces=[]
  for i in range(135):
   uu=u+rng.uniform(-32,32);vv=v+rng.uniform(-19,19);p=W(uu,vv,height(uu,vv));h=rng.uniform(.035,.09);w=.012;idx=len(verts);verts.extend([tuple(p+Vector((-w,0,0))),tuple(p+Vector((w,0,0))),tuple(p+Vector((rng.uniform(-.025,.025),rng.uniform(-.02,.02),h)))]);faces.append((idx,idx+1,idx+2))
  C.meshob('patch of short coastal grass',verts,faces,grass)
 provenance=add_vegetation()
 (C.R/'source/shore-geometry.json').write_text(json.dumps({'seaWorldZ':-2.82,'shorePolygonsWorldXY':SHORE,'method':'authored coastal core waterline polygons plus conservative water-intersecting cliff-block ellipses','basisLogical':{'x':[-32,16],'y':[32,16],'z':[0,-39.191837]}},indent=2)+'\n')
 return provenance
