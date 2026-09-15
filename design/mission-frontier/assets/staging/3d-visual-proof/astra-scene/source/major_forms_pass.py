"""Third bounded art pass from actual browser P1s: curved bays, ergonomic furniture, interlocked coast."""
from mathutils import Matrix
# Break the warehouse silhouette with three overlapping, stepped, segmented equipment bays per side.
# They are structural service volumes, not additional task work areas.
def sector(n,cx,cz,r0,r1,a0,a1,y0,y1,ma):
 vv=[]
 for y in [y0,y1]:
  for r,a in [(r0,a0),(r1,a0),(r1,a1),(r0,a1)]:vv.append((cx+r*math.cos(a),y,cz+r*math.sin(a)))
 o=mesh(n,vv,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],ma);be=o.modifiers.new('rounded_panel_arris','BEVEL');be.width=.07;be.segments=3;o.modifiers.new('panel_normals','WEIGHTED_NORMAL');return o
def half_bay(n,p,r,h,ma,side):
 center=0 if side==1 else math.pi;N=25;ring=[(p[0]+r*math.cos(center-math.pi/2+i*math.pi/(N-1)),p[2]+r*math.sin(center-math.pi/2+i*math.pi/(N-1))) for i in range(N)]
 vv=[(x,p[1]+sy*h/2,z) for sy in [-1,1] for x,z in ring];ff=[tuple(range(N)),tuple(range(N*2-1,N-1,-1))]
 for i in range(N):ff.append((i,(i+1)%N,(i+1)%N+N,i+N))
 ob=mesh(n,vv,ff,ma);be=ob.modifiers.new('bay_edge_radius','BEVEL');be.width=.06;be.segments=2;ob.modifiers.new('bay_normals','WEIGHTED_NORMAL');return ob
for side in [-1,1]:
 for bay,(z,top) in enumerate([(-5.1,9.65),(0,9.15),(5.0,8.55)]):
  x=side*10.5
  group='MF_BaseFixed';half_bay('curved_bay_footing',(x,4.35,z),3.0,.55,edge,side)
  group='MF_ShellCutaway'
  half_bay('curved_service_bay_core',(x,(4.6+top)/2,z),2.72,top-4.6,edge,side)
  center=0 if side==1 else math.pi
  for k in range(6):
   a0=center-math.pi*.56+k*math.pi*1.12/6+.025;a1=center-math.pi*.56+(k+1)*math.pi*1.12/6-.025
   sector('curved_lower_armour',x,z,2.65,2.94,a0,a1,4.72,6.4,ivory)
   sector('curved_upper_armour',x,z,2.65,2.9,a0,a1,top-.95,top-.08,ivory)
   sector('curved_recessed_service_window',x,z,2.69,2.73,a0+.04,a1-.04,6.65,top-1.17,glass)
   aa=(a0+a1)/2;px=x+2.94*math.cos(aa);pz=z+2.94*math.sin(aa)
   o=cube('curved_bay_external_rib',(px,(4.65+top)/2,pz),(.28,top-4.65,.4),metal,.08);o.rotation_euler.z=-aa
   sector('curved_service_lamp',x,z,2.74,2.78,a0+.12,a1-.12,top-1.34,top-1.23,amber)
  group='MF_Roof';cyl('stepped_bay_roof_gasket',(x,top+.06,z),3.0,.2,edge,48)
  for k in range(10):
   a0=k*math.tau/10+.016;a1=(k+1)*math.tau/10-.016
   sector('segmented_bay_roof',x,z,.3,2.95,a0,a1,top+.17,top+.49,ivory)
  cyl('bay_roof_access_hatch',(x,top+.52,z),.75,.12,metal,24)
# Recessed rooftop spine and service equipment occupy the broad white plate fields.
for side in [-1,1]:
 group='MF_Roof';x=side*6.2
 cube('roof_service_spine',(x,11.04,.25),(2.65,.16,12),edge,.25)
 for z in [-4.5,-1,2.5,5]:
  cube('roof_split_service_housing',(x,11.34,z),(2.3,.45,2.6),metal,.25)
  for dx in [-.7,0,.7]:cube('roof_service_cooling_blade',(x+dx,11.62,z),(.15,.18,2.1),edge,.02)
# Furniture is sized to a 1.8m worker: worktop 0.8m above floor, angled control surface.
for o in list(bpy.data.objects):
 n=o.name
 if n.startswith('console_pedestal'):o.location.z=4.72;o.scale.z*=.65
 if n.startswith('console_worktop'):o.location.z=5.1;o.scale.x*=.79;o.scale.y*=.62
 if n.startswith('console_monitor_') or n.startswith('console_readout_line'):
  o.location.z=5.8+(o.location.z-6.35)*.78;o.scale.z*=.78;o.scale.y*=.72
 if n.startswith('operator_stool'):o.location.z=4.65;o.scale.z*=.63
 if n.startswith('rear_workstation_housing') or n.startswith('rear_workstation_display'):
  o.location.z=6.25;o.scale.x*=.7;o.scale.z*=.6
 if n.startswith('rear_workstation_data'):
  o.location.z=6.25+(o.location.z-7.25)*.6;o.scale.x*=.7;o.scale.z*=.6
 if n.startswith('rear_workstation_desk'):o.location.z=5.1;o.scale.x*=.74;o.scale.y*=.7
 if n.startswith('rear_workstation_support'):o.location.z=4.72;o.scale.z*=.64
# Smaller sloped input consoles, visible controls and floor service bands.
group='MF_Interior'
for side in [-1,1]:
 for z in [-5.6,-1.6,2.4]:
  x=side*9.0;o=cube('angled_input_console',(x,5.24,z),(1.55,.16,1.0),edge,.09);o.rotation_euler.y=side*.20
  cube('input_touch_surface',(x,5.36,z),(1.2,.035,.72),glass,.04)
  for k in [-.36,0,.36]:cube('console_control_key',(x+k,5.4,z+.26),(.16,.025,.1),ochre,.015)
 for z in [-6,-3,0,3,6]:
  cube('floor_service_inset',(side*4.0,4.35,z),(.62,.04,2.7),edge,.04)
  for k in range(4):cube('floor_inset_grate',(side*4.0,4.38,z-.85+k*.55),(.43,.025,.06),metal,.01)
for x in [-2.5,0,2.5]:
 for z in [-3.5,0,3.5,7]:cube('central_service_floor_panel',(x,4.34,z),(2.43,.075,3.42),pave,.09)
for x in [-3.8,3.8]:cube('central_route_inlay',(x,4.4,2),(.07,.018,14),ochre,.01)
# One shared equipment bench sits between the existing two work areas; sockets at +/-5 stay clear.
cube('shared_analysis_bench_base',(0,4.72,0),(2.7,.76,1.9),edge,.3)
cube('shared_analysis_bench_rim',(0,5.17,0),(3.2,.18,2.35),metal,.35)
cube('shared_analysis_bench_surface',(0,5.29,0),(2.75,.055,1.9),glass,.24)
for x in [-.8,0,.8]:cube('bench_neutral_grid',(x,5.325,0),(.018,.01,1.5),cyan,0)
for z in [-.55,0,.55]:cube('bench_neutral_grid',(0,5.325,z),(2.3,.01,.018),cyan,0)
# Replace the exposed right strip and long backing sections with a second, interlocking coastal scan.
old=bpy.data.objects.get('coastal_scanned_formation_3')
if old:bpy.data.objects.remove(old,do_unlink=True)
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(R/'sources/polyhaven/coastal_cliff_01/coastal_cliff_01.gltf'))
scan1=[o for o in bpy.data.objects if o not in before and o.type=='MESH'][0];bpy.ops.object.select_all(action='DESELECT');scan1.select_set(True);bpy.context.view_layer.objects.active=scan1;dec=scan1.modifiers.new('portable_scan_lod','DECIMATE');dec.ratio=.13;bpy.ops.object.modifier_apply(modifier=dec.name)
scan1.data.transform(scan1.matrix_world);scan1.matrix_world=Matrix.Identity(4);lo=Vector([min(v.co[i] for v in scan1.data.vertices) for i in range(3)]);hi=Vector([max(v.co[i] for v in scan1.data.vertices) for i in range(3)]);scan1.data.transform(Matrix.Translation(-(lo+hi)/2));dd=hi-lo
for idx,(x,z,w,d,h,a) in enumerate([(23,-5,29,11,7,math.pi/2),(17,16,21,10,6.7,math.pi/2),(8,25,20,10,6.3,math.pi*.83)]):
 o=scan1 if idx==0 else bpy.data.objects.new('interlocked_cliff',scan1.data.copy())
 if idx:S.collection.objects.link(o)
 o.name='interlocking_scanned_cliff_'+str(idx);o.parent=groups['MF_Terrain'];o.scale=(w/dd.x,d/dd.y,h/dd.z);o.rotation_euler.z=a;o.location=xyz((x,h*.46-1,z));bpy.context.view_layer.update()
 # The bridge corridor is an actual clearance through the upper outcrop geometry.
 inv=o.matrix_world.inverted()
 for v in o.data.vertices:
  world=o.matrix_world@v.co;wx,wz=world.x,-world.y
  if ((wx>11 and 11<wz<17) or (abs(wx)<14.5 and -11<wz<21.5)) and world.z>3.75:world.z=3.75
  rad=math.sqrt(((world.x+4)/30)**2+((-world.y+1)/30)**2)
  if rad>1.07:
   world.x=-4+(world.x+4)*1.07/rad;world.y=1+(world.y-1)*1.07/rad
  v.co=inv@world
for im in bpy.data.images:
 if im.filepath and 'coastal_cliff_01' in im.filepath:im.pack()
