import bpy,math,random
from mathutils import Vector
import coastal_common as C
W=C.W;M=C.M;rng=random.Random(915103)
def build():
 C.group='base';bc=W(-25,-105)
 # Replace the blockout swatches, preserving accepted world-space massing.
 for o in bpy.data.objects:
  if o.get('asset_layer')!='base' or o.type!='MESH':continue
  for slot in o.material_slots:
   name=slot.material.name.lower() if slot.material else ''
   slot.material=M['glass'] if 'glaz' in name else M['dark'] if 'steel' in name else M['ceramic']
 # A real carved opening reveals a deep framed vestibule rather than a dark decal.
 body=next(o for o in bpy.data.objects if o.name.startswith('headquarters lower ceramic mass'))
 cutter=C.box('temporary actual entrance cutter',bc+Vector((3,.68,1.045)),(1.8,1.74,1.92),None,.07)
 bpy.context.view_layer.objects.active=cutter;cutter.select_set(True)
 if cutter.modifiers:bpy.ops.object.modifier_apply(modifier=cutter.modifiers[0].name)
 modifier=body.modifiers.new('carved entrance recess','BOOLEAN');modifier.operation='DIFFERENCE';modifier.object=cutter;bpy.context.view_layer.objects.active=body;bpy.ops.object.modifier_apply(modifier=modifier.name);bpy.data.objects.remove(cutter,do_unlink=True)
 C.remove_named('recessed main entrance');C.remove_named('dish massing placeholder')
 C.box('vestibule dark rear door',bc+Vector((2.14,.68,1.04)),(.03,1.67,1.82),M['dark'],.025)
 for i in range(8):C.box('recessed door horizontal armored section',bc+Vector((2.165,.68,.27+i*.215)),(.05,1.55,.175),M['steel'],.014)
 C.box('vestibule inset threshold',bc+Vector((2.74,.68,.055)),(1.28,1.76,.10),M['steel'],.025)
 for y in [-.16,1.52]:C.box('inner vestibule guide rail',bc+Vector((2.69,y,1.03)),(1.14,.055,1.89),M['bronze'],.012)
 C.group='lights';C.box('vestibule rear warm practical',bc+Vector((2.30,.68,1.86)),(.07,1.24,.042),M['amber'],.01)
 C.group='base'
 # Ceramic facade is panelled around deep dark bays with visible gasket gaps.
 for face in ['y','x']:
  for k in range(5):
   t=-2.22+k*1.06
   if face=='x' and -.45<t<1.77:continue
   p=bc+Vector((t,2.572,1.19)) if face=='y' else bc+Vector((3.08,t*.78,1.18))
   sz=(.15,.18,2.19) if face=='y' else (.20,.14,2.18)
   C.hull('ceramic facade upright',p,sz,M['pale'],.045)
   for z in [.25,2.15]:
    q=Vector(p);q.z=z;C.box('upright collar',q,(.23,.22,.095) if face=='y' else (.22,.23,.095),M['alloy'],.012)
  if face=='y':
   for x in [-1.8,-.2,1.4]:
    C.box('recessed bay machined frame',bc+Vector((x,2.586,1.22)),(1.25,.15,1.53),M['steel'],.038)
    C.box('deep window gasket surround',bc+Vector((x,2.670,1.44)),(1.05,.035,.81),M['black'],.023)
    C.box('protected blue glazed panel',bc+Vector((x,2.692,1.45)),(.92,.028,.66),M['glass'],.014)
    for dx in [-.47,.47]:C.box('glazing mullion',bc+Vector((x+dx,2.714,1.45)),(.025,.030,.70),M['alloy'],.007)
    C.box('bay lower service panel',bc+Vector((x,2.682,.73)),(1.02,.11,.38),M['ceramic'],.028)
    for k in range(7):C.box('lower service grille',bc+Vector((x-.38+k*.125,2.745,.74)),(.062,.027,.17),M['dark'],.003)
    for dx in [-.52,.52]:
     for z in [.49,1.95]:C.box('bay retaining fastener',bc+Vector((x+dx,2.682,z)),(.037,.026,.037),M['alloy'],.004)
    C.box('facade practical recessed pocket',bc+Vector((x,2.68,2.12)),(.86,.14,.14),M['dark'],.018)
    C.group='lights';C.box('facade amber practical',bc+Vector((x,2.76,2.11)),(.61,.020,.036),M['amber'],.006);C.group='base'
 # Layered horizontal cladding and roof edge coping, using interrupted panels.
 for face,extent in [('y',5.4),('x',4.3)]:
  for k in range(6):
   t=-extent/2+extent*(k+.5)/6
   p=bc+Vector((t,2.59,2.33)) if face=='y' else bc+Vector((3.105,t,2.33))
   size=(extent/6-.04,.23,.17) if face=='y' else (.24,extent/6-.04,.17)
   C.hull('segmented upper ceramic beam',p,size,M['pale'],.065)
   p.z=bc.z+.38;C.box('plinth retaining plate',p,(extent/6-.06,.13,.16) if face=='y' else (.13,extent/6-.06,.16),M['alloy'],.014)
 # Rebuild the upper silhouette as a recessed steel gallery with separate armor plates.
 for prefix in ['offset upper command volume','upper command glazing belt','upper ceramic roof step','small rooftop control core']:C.remove_named(prefix)
 upper=bc+Vector((-.62,-.53,3.0))
 C.hull('upper recessed structural gallery',upper,(3.92,3.10,.91),M['dark'],.42)
 C.hull('upper gallery lower service cornice',upper+Vector((0,0,-.48)),(4.39,3.56,.17),M['alloy'],.48)
 C.hull('upper gallery black roof gasket',upper+Vector((0,0,.48)),(4.36,3.54,.14),M['black'],.52)
 C.hull('upper inset maintenance roof',upper+Vector((0,0,.57)),(3.85,3.0,.10),M['steel'],.42)
 for face,extent,plane in [('y',3.6,1.62),('x',2.72,2.03)]:
  n=5 if face=='y' else 4
  for k in range(n):
   t=-extent/2+extent*(k+.5)/n;step=extent/n
   def P(z,extra=0):return upper+Vector((t,plane+extra,z)) if face=='y' else upper+Vector((plane+extra,t,z))
   def Z(w,d,h):return (w,d,h) if face=='y' else (d,w,h)
   C.box('gallery deep blue window',P(.005,.012),Z(step-.12,.035,.38),M['glass'],.01)
   C.box('gallery structural mullion',P(.0,.045)+Vector((-step/2+.045,0,0) if face=='y' else (0,-step/2+.045,0)),Z(.065,.16,.82),M['alloy'],.012)
   C.hull('separated upper ceramic armor',P(.31,.11),Z(step-.07,.25,.22),M['ceramic'],.04)
   C.hull('gallery lower ceramic armor',P(-.32,.10),Z(step-.09,.23,.20),M['pale'],.037)
   C.hull('segmented tiered roof cornice',P(.59,.10),Z(step-.045,.38,.13),M['pale'],.045)
   C.box('gallery inset belt grille',P(-.18,.055),Z(step-.17,.04,.06),M['black'],.005)
   if k%2==0:
    C.group='lights';C.box('upper gallery protected practical',P(.18,.068),Z(step-.24,.023,.025),M['amber'],.004);C.group='base'
 # A smaller armored receiver plinth leaves an inhabited mechanical roof terrace.
 tower=bc+Vector((-.90,-.70,3.85))
 C.hull('receiver core dark footing',tower+Vector((0,0,-.04)),(1.63,1.48,.57),M['dark'],.22)
 for k in range(3):
  t=-.49+k*.49
  C.hull('receiver plinth armor cassette',tower+Vector((t,.78,.03)),(.43,.13,.40),M['ceramic'],.055)
  C.hull('receiver plinth side cassette',tower+Vector((.86,t,.03)),(.14,.43,.40),M['pale'],.05)
 C.hull('receiver cornice',tower+Vector((0,0,.31)),(1.89,1.70,.105),M['pale'],.23)
 for x in [-1.54,.64]:
  p=upper+Vector((x,.78,.80));C.hull('upper roof cooling assembly',p,(.52,.84,.35),M['steel'],.075)
  C.cylinder('vertical roof cooling fan',p+Vector((0,0,.18)),p+Vector((0,0,.205)),.215,M['black'],24)
  for angle in range(0,180,30):
   v=Vector((.19*math.cos(math.radians(angle)),.19*math.sin(math.radians(angle)),.222));C.cylinder('fan safety guard',p+v,p+Vector((-v.x,-v.y,v.z)),.012,M['alloy'])
  C.cable('upper roof silver pipe',[p+Vector((0,-.42,0)),p+Vector((.12,-.62,0)),p+Vector((.37,-.74,-.03))],.045,M['alloy'])
 # Projecting side service wing has a stacked heat exchanger, segmented armor and a steel visor.
 wing=bc+Vector((1.48,-3.02,.80))
 C.hull('workshop layered dark roof',wing+Vector((0,0,.84)),(2.6,1.77,.12),M['dark'],.32)
 for k in range(3):
  p=wing+Vector((.22,-.52+k*.49,1.02));C.hull('workshop rooftop armored cooler',p,(1.3,.43,.3),M['steel'],.07)
  for q in range(8):C.box('workshop exchanger wide fins',p+Vector((-.49+q*.14,0,.16)),(.06,.31,.035),M['alloy'],.004)
 for k in range(3):
  p=wing+Vector((1.29,-.48+k*.48,-.04));C.hull('workshop separated ceramic wall cassette',p,(.16,.41,1.19),M['ceramic'],.07)
  C.box('workshop panel gasket',p+Vector((.085,0,-.26)),(.02,.28,.17),M['dark'],.006)
 C.hull('entrance projecting steel visor',bc+Vector((3.17,.68,2.13)),(.74,2.10,.16),M['dark'],.15)
 for y in [-.29,1.65]:C.hull('entrance heavy jamb armor',bc+Vector((3.18,y,1.03)),(.40,.19,2.07),M['pale'],.065)
 C.hull('entrance split ceramic lintel',bc+Vector((3.26,.68,2.27)),(.38,1.95,.15),M['ceramic'],.065)
 # Roof service bays provide middle-scale function in the large dark roof terrace.
 for p,size in [(bc+Vector((1.75,-1.70,2.62)),(1.50,.72,.28)),(bc+Vector((-1.72,1.52,2.65)),(1.38,.64,.34))]:
  C.hull('roof ceramic service housing',p,size,M['ceramic'],.15)
  for i in range(8):C.box('roof heat exchanger grille',p+Vector((-.53+i*.15,0,size[2]/2+.012)),(.055,size[1]*.73,.025),M['dark'],.003)
  C.cable('roof insulated supply conduit',[p+Vector((.35,.40,.02)),p+Vector((.5,.59,.015)),p+Vector((.65,.62,-.13))],.045,M['steel'])
 for x in [-2.1,-.6,.9]:
  C.box('main roof panel seam',bc+Vector((x,0,2.532)),(.02,4.3,.013),M['alloy'],.002)
 # Industrial roof radio dish has a bowl, ribs, pivot fork and a real feed, replacing proxy sphere.
 tower=bc+Vector((-.90,-.70,3.85));center=tower+Vector((0,0,.78));D=MatrixTranslation(center)@MatrixRotation(.50);verts=[];faces=[]
 for ring in range(9):
  r=.65*ring/8
  for i in range(48):
   a=i*math.tau/48;verts.append(tuple(D@Vector((r*math.cos(a),r*math.sin(a),.18*(r/.65)**2))))
 for ring in range(8):
  for i in range(48):faces.append((ring*48+i,ring*48+(i+1)%48,(ring+1)*48+(i+1)%48,(ring+1)*48+i))
 ob=C.meshob('segmented parabolic receiver bowl',verts,faces,M['ceramic']);sol=ob.modifiers.new('thin dish shell','SOLIDIFY');sol.thickness=.025
 for a in range(0,360,60):
  t=math.radians(a);C.cylinder('receiver supporting rib',D@Vector((0,0,.01)),D@Vector((.63*math.cos(t),.63*math.sin(t),.175)),.014,M['steel'])
 C.cylinder('dish feed',D@Vector((0,0,0)),D@Vector((0,0,.39)),.027,M['dark'])
 for y in [-.2,.2]:C.hull('dish pivot fork',tower+Vector((0,y,.5)),(.14,.10,.44),M['alloy'],.025)
 # Off-court fixed power cabinet and utility pipes are architecture, not task artifacts.
 C.hull('fixed workshop power cabinet',bc+Vector((2.4,-3.1,.48)),(.57,.58,.95),M['steel'],.065)
 for z in [.22,.45,.68]:C.box('power cabinet vent',bc+Vector((2.708,-3.1,z)),(.025,.36,.085),M['dark'],.006)
 C.cable('workshop utility riser',[bc+Vector((2.9,-2.15,.10)),bc+Vector((2.9,-2.15,1.70)),bc+Vector((2.87,-1.93,1.9))],.041,M['bronze'])
 # Recessed narrow top trim keeps the accepted silhouette within the building zone.
 for x in [-1.5,-.65,.20,.95]:C.box('uppermost roof construction seam',tower+Vector((x*.55,0,.315)),(.017,1.31,.014),M['dark'],.002)

def MatrixTranslation(p):
 from mathutils import Matrix
 return Matrix.Translation(p)
def MatrixRotation(a):
 from mathutils import Matrix
 return Matrix.Rotation(a,4,'Y')

def court_and_crossing():
 C.group='terrain'
 # Enlarged modular court, with a right-hand service apron and permanently clear worker zone.
 cp=W(0,23);sx,sy=5.60,5.74
 C.hull('loading court concrete foundation',cp+Vector((0,0,-.17)),(sx+.24,sy+.24,.24),M['stone'],.44)
 C.hull('loading court graphite lip',cp+Vector((0,0,-.055)),(sx+.08,sy+.08,.06),M['dark'],.4)
 for i in range(7):
  for j in range(7):
   x=cp.x-sx/2+(i+.5)*sx/7;y=cp.y-sy/2+(j+.5)*sy/7
   # Small corner panels are omitted at chamfered edges.
   if (i,j) in [(0,0),(0,6),(6,0),(6,6)]:continue
   C.box('individual apron deck panel',(x,y,-.012),(sx/7-.026,sy/7-.026,.024),M['road'],.006)
 for axis in [0,1]:
  for sign in [-1,1]:
   for i in range(20):
    t=-2.3+i*.24;p=cp+Vector((t,sign*2.66,.004)) if axis==0 else cp+Vector((sign*2.62,t,.004));sz=(.205,.11,.015) if axis==0 else (.11,.205,.015)
    C.box('inset apron drainage grate',p,sz,M['black'],.003)
    for j in [-.065,0,.065]:q=Vector(p);q[axis]+=j;q.z=.017;C.box('drain grate crossbar',q,(.016,.10,.014) if axis==0 else (.10,.016,.014),M['steel'],.002)
 # Painted loading lines remain flat; service fixtures stay outside the live patrol envelope.
 for x in [1.54,2.17]:
  for y in [1.42,2.08]:
   C.box('apron loading corner long paint',cp+Vector((x,y,.009)),(.36,.025,.006),M['pale'],.002)
   C.box('apron loading corner short paint',cp+Vector((x-.17,y+.12,.009)),(.025,.24,.006),M['pale'],.002)
 p=W(151,30)
 C.hull('asymmetric fixed service apron foundation',p+Vector((0,0,-.11)),(1.28,1.45,.20),M['stone'],.20)
 C.hull('asymmetric service apron top',p+Vector((0,0,-.007)),(1.17,1.34,.018),M['road'],.17)
 C.hull('fixed apron electrical pedestal',p+Vector((-.18,.23,.33)),(.37,.38,.66),M['steel'],.055)
 C.box('pedestal inset unlabeled display',p+Vector((.016,.23,.43)),(.026,.23,.14),M['glass'],.012)
 for u,v in [(-156,22),(158,51)]:
  q=W(u,v);C.cylinder('fixed apron protective bollard',q,q+Vector((0,0,.31)),.045,M['alloy'])
 # Approach starts at the court boundary, so no coplanar road lies inside the loading floor.
 entrance=W(0,10);near=W(250,-115);far=W(430,-205);join=W(520,-250);road_start=Vector((cp.x-sx/2,entrance.y,0));width=42/(1024/math.sqrt(1280));endwidth=26.4/(1024/math.sqrt(1280))
 def strip(name,a,b,widthA,widthB,material,thickness,layer):
  C.group=layer;v=[(a.x,a.y-widthA/2,0),(b.x,b.y-widthB/2,0),(b.x,b.y+widthB/2,0),(a.x,a.y+widthA/2,0)];vs=v+[(x,y,-thickness) for x,y,z in v];fs=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)];return C.meshob(name,vs,fs,material)
 strip('continuous court-to-bridge approach',road_start,near,width,width,M['road'],.10,'terrain')
 taper=join-Vector(((-1)*70/math.sqrt(1280),0,0)) # 70 logical Euclidean px before join on -X axis
 # More legible exact formulation: route projects |X|*sqrt(32²+16²).
 taper=Vector((join.x+70/math.sqrt(1280),join.y,0))
 strip('far bank full-width approach',far,taper,width,width,M['road'],.10,'terrain');strip('far approach taper to actual junction',taper,join,width,endwidth,M['road'],.10,'terrain')
 C.group='terrain'
 for side in [-1,1]:
  y=near.y+side*(width/2+.045)
  C.box('approach recessed safety curb',((road_start.x+near.x)/2,y,.06),(abs(road_start.x-near.x),.095,.12),M['steel'],.018)
  for i in range(8):
   x=road_start.x+(near.x-road_start.x)*(i+.5)/8
   C.box('approach quiet edge paint',(x,y-side*.10,.008),(.23,.03,.007),M['pale'],.002)
 C.remove_layer('bridge');C.group='bridge';bridgeDeck=strip('widened structural bridge deck',near,far,width,width,M['dark'],.23,'bridge');bridgeDeck.location.z=-.026
 length=(far-near).length
 for i in range(12):
  x=near.x+(far.x-near.x)*(i+.5)/12;C.box('bridge deck expansion panel',(x,near.y,-.012),(length/12-.022,width-.075,.024),M['road'],.006)
 for side in [-1,1]:
  y=near.y+side*(width/2+.055);C.box('bridge structural longitudinal girder',((near.x+far.x)/2,y,-.24),(length,.17,.36),M['steel'],.025)
  C.cylinder('continuous bridge upper guardrail',(near.x,y,.47),(far.x,y,.47),.035,M['alloy']);C.cylinder('continuous bridge lower rail',(near.x,y,.23),(far.x,y,.23),.019,M['steel'])
  for i in range(12):
   x=near.x+(far.x-near.x)*i/11;C.hull('bridge guardrail structural post',(x,y,.26),(.095,.13,.53),M['ceramic'],.025)
   if i%3==1:
    C.group='lights';C.box('bridge practical inset',(x,y+side*.072,.23),(.035,.018,.085),M['amber'],.004);C.group='bridge'
 for t in [.08,.92]:
  p=near.lerp(far,t);C.hull('rocky bridge pier abutment',(p.x,p.y,-2.48),(.79,width+.55,.7),M['stone'],.14)
  for sign in [-1,1]:
   y=p.y+sign*width*.31;C.hull('bridge steel pier',(p.x,y,-1.29),(.28,.27,2.34),M['steel'],.038)
   C.cylinder('bridge diagonal pier brace',(p.x-.3,y,-.31),(p.x+.3,y,-2.20),.057,M['alloy'])
 for p in [near,far]:C.hull('bridge load bearing end block',(p.x,p.y,-.23),(.49,width+.48,.47),M['ceramic'],.08)
 # Foreground curbs are deliberately only at the front corner, away from all patrol points.
 C.group='front'
 for p,size in [(cp+Vector((2.7,2.0,.10)),(.16,.74,.20)),(cp+Vector((2.0,2.76,.10)),(.74,.16,.20))]:C.hull('low apron corner kerb',p,size,M['ceramic'],.05)
 C.group='terrain'
 return {'approachStartWorld':list(road_start),'bridgeWidthWorld':width,'projectedWidthLogical':42,'farJunctionWidthLogical':26.4,'farTaperLengthLogical':70,'socketsWorld':{k:list(v) for k,v in [('entrance',entrance),('bridgeNear',near),('bridgeFar',far),('routeJoin',join)]}}
