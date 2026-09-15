"""Derive editable exterior kit from accepted coastal proof without mutating it."""
import bpy,math,json,sys
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[1];BASE=R.parents[1]/'3d-visual-proof/astra-scene';C=json.loads((R.parent/'contract.json').read_text());META=json.loads((BASE/'scene-metadata.json').read_text())
G='MF_Roof'
def pos(v):return (v[0],-v[2],v[1])
def material(name,color,metal=.1,rough=.4,emission=0):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission;return m

def tagged(o,name,ma):
 o.name=name;o.parent=bpy.data.objects[G];o.data.materials.append(ma);return o

def cube(name,p,size,ma,b=.08):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos(p));o=bpy.context.object;o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if b:
  mod=o.modifiers.new('manufactured edge radius','BEVEL');mod.width=b;mod.segments=3
  o.modifiers.new('weighted corner normals','WEIGHTED_NORMAL')
 return tagged(o,name,ma)

def cyl(name,p,r,h,ma,n=48):
 bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=h,location=pos(p));o=tagged(bpy.context.object,name,ma);mod=o.modifiers.new('machined rim','BEVEL');mod.width=min(.065,h*.18);mod.segments=2;o.modifiers.new('weighted normals','WEIGHTED_NORMAL');return o

def rounded(name,p,size,ma,r=.8):
 outline=[];w,d=size[0],size[2];r=min(r,w/2-.001,d/2-.001)
 for sx,sz,start in [(1,1,0),(-1,1,90),(-1,-1,180),(1,-1,270)]:
  for j in range(9):
   a=math.radians(start+j*90/8);outline.append((sx*(w/2-r)+r*math.cos(a),sz*(d/2-r)+r*math.sin(a)))
 verts=[pos((p[0]+x,p[1]+h,p[2]+z)) for h in [-size[1]/2,size[1]/2] for x,z in outline];n=len(outline);faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)];me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(o);return tagged(o,name,ma)

def ring(name,p,r,width,ma):
 bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=width,major_segments=64,minor_segments=8,location=pos(p));o=tagged(bpy.context.object,name,ma)
 for f in o.data.polygons:f.use_smooth=True
 return o

def erase_roof():
 for o in list(bpy.data.objects['MF_Roof'].children_recursive):bpy.data.objects.remove(o,do_unlink=True)

def identity_disc(x,y,z,r):
 cyl('identity_recess_socket',(x,y,z),r+.28,.28,ink);cyl('identity_coloured_disc',(x,y+.11,z),r,.12,idroof);ring('identity_illuminated_ring',(x,y+.19,z),r-.11,.07,idring)
 # Modeled neutral segmented survey mark, deliberately no project/task symbol baked in.
 for a in [0,math.pi/2,math.pi,math.pi*1.5]:
  o=cube('identity_radial_marker',(x+math.cos(a)*r*.65,y+.19,z+math.sin(a)*r*.65),(.54,.03,.09),idring,.02);o.rotation_euler.z=-a

def station_details():
 global G
 G='MF_ShellCutaway'
 for side in [-1,1]:
  for z in [-5,0,5]:
   x=side*13.28
   cube('window_recess_housing',(x,7.2,z),(.24,1.62,2.08),ink,.1)
   cube('warm_window_glazing',(x+side*.14,7.18,z),(.06,1.2,1.78),warm,.035)
   for dz in [-.52,0,.52]:cube('window_dark_mullion',(x+side*.2,7.18,z+dz),(.07,1.23,.065),metal,.015)
   for yy in [6.93,7.46]:cube('window_interior_light',(x+side*.19,yy,z),(.065,.045,1.59),lamp,.01)
  for x in [side*7.1-3.3,side*7.1+3.3]:
   cube('door_sensor_housing',(x,7.95,8.72),(.44,.7,.28),ink,.09)
   cube('door_sensor_lens',(x,8.08,8.88),(.22,.18,.04),sensor,.025)
   cube('door_marker_lamp',(x,7.67,8.87),(.16,.075,.045),lamp,.015)
  cube('entry_recessed_lamp',(side*7.1,8.53,8.05),(5.5,.14,.16),lamp,.04)
  cube('entry_service_computer_housing',(side*11.2,6.48,8.87),(.67,1.16,.3),ink,.1)
  cube('entry_service_computer_display',(side*11.2,6.61,9.04),(.48,.58,.04),screen,.045)
  for dx in [-.13,.13]:cube('entry_computer_control',(side*11.2+dx,6.14,9.065),(.08,.07,.035),lamp,.01)
  cube('entry_identity_strip',(side*7.1,9.61,8.51),(4.0,.15,.09),idtrim,.04)
 G='MF_Props'
 # Resize each complete crate assembly around its measured ground contact.
 for x,z in [(-11,15),(9,17.6),(-14,-5)]:
  items=[o for o in bpy.context.scene.objects if o.name.startswith(('cargo_crate','cargo_retaining_band','cargo_lid')) and abs(o.location.x-x)<.9 and abs(-o.location.y-z)<.9]
  low=min((o.matrix_world@Vector(v)).z for o in items for v in o.bound_box);high=max((o.matrix_world@Vector(v)).z for o in items for v in o.bound_box);factor=2/(high-low);anchor=Vector(pos((x,low,z)))
  offset=1.5 if x==9 else 0
  for o in items:o.location=anchor+(o.location-anchor)*factor;o.location.x+=offset;o.scale*=factor
  x+=offset
  for dx in [-.82,.82]:cube('cargo_recessed_handle',(x+dx,low+1.2,z+.985),(.18,.46,.11),ink,.05)
  cube('cargo_inventory_lamp',(x,low+1.54,z+1.0),(.28,.08,.04),lamp,.02)
 anchor=Vector(pos((7,4.21,19)))
 for o in bpy.context.scene.objects:
  if o.name.startswith(('service_cart','cart_')):o.location=anchor+(o.location-anchor)*1.35;o.scale*=1.35

def make_command():
 global G
 G='MF_Roof'
 for o in list(bpy.data.objects['MF_Roof'].children):
  if o.name.startswith(('roof_receiver','receiver_mast','antenna_')):bpy.data.objects.remove(o,do_unlink=True)
 identity_disc(0,12.63,-5,3.5)
 # Recessed warm clerestory bays under the existing segmented round crown.
 for i in range(12):
  a=math.tau*i/12;x=6.49*math.cos(a);z=-5+6.49*math.sin(a)
  o=cube('command_clerestory_recess',(x,11.35,z),(.14,.65,1.55),ink,.04);o.rotation_euler.z=-a
  o=cube('command_clerestory_glass',(x+math.cos(a)*.09,11.35,z+math.sin(a)*.09),(.035,.38,1.23),warm,.025);o.rotation_euler.z=-a
 for side in [-1,1]:
  cube('roof_sensor_foot',(side*4.7,12.75,-7),(1.0,.25,.8),ink,.1);cyl('roof_sensor_beacon',(side*4.7,13.12,-7),.2,.42,sensor,24)

def make_relay():
 global G
 erase_roof();G='MF_Roof'
 rounded('relay_right_lower_eave',(6.1,10.7,-.5),(13.4,.5,19.6),ink,2);rounded('relay_right_stepped_roof',(6.1,11.1,-.8),(12.9,.45,18.8),ivory,2)
 rounded('relay_left_continuous_roof',(-6,10.55,-.5),(11.8,.5,19.6),ivory,2)
 rounded('relay_left_tower_foot',(-6.0,10.85,-4.2),(11.8,.65,13.5),ink,2)
 rounded('relay_asymmetric_service_tower',(-6,12.75,-4.2),(9.3,3.2,10.8),ivory,2)
 rounded('relay_tower_clerestory',(-6,14.13,-4.2),(9.45,.75,10.9),ink,2)
 for z in [-7.4,-4.1,-.8]:cube('relay_tower_warm_window',(-10.76,14.15,z),(.08,.43,2.2),warm,.04)
 rounded('relay_tower_crown',(-6,14.63,-4.2),(10.0,.5,11.5),ivory,2.2)
 for x in [-8.3,-6,-3.7]:
  cube('relay_front_clerestory_recess',(x,14.15,1.28),(1.72,.55,.13),ink,.04);cube('relay_front_clerestory_window',(x,14.15,1.36),(1.44,.3,.04),warm,.035)
  cube('relay_tower_front_service_panel',(x,12.7,1.27),(1.58,1.8,.17),metal,.07)
  for yy in [12.1,12.45,12.8,13.15]:cube('relay_service_panel_louver',(x,yy,1.38),(1.32,.05,.06),ink,.015)
 for z in [-7.3,-4.2,-1.1]:
  cube('relay_side_clerestory_recess',(-1.23,14.15,z),(.13,.57,2.1),ink,.04);cube('relay_side_clerestory_window',(-1.15,14.15,z),(.04,.32,1.8),warm,.025)
 for z in [1.9,5.0]:
  rounded('relay_roof_service_housing',(6.1,11.6,z),(5.7,.5,1.65),metal,.4)
  for dx in [-2,-1,0,1,2]:cube('relay_roof_service_fin',(6.1+dx,11.88,z),(.14,.13,1.3),ink,.03)
 identity_disc(5.7,11.47,-3.4,2.8)
 # Offset compact radio dish: true concave paraboloid and separate feed, rather than a roof recolour.
 cyl('relay_dish_pedestal',(-6,15.15,-4),1,.65,metal);verts=[];faces=[];n=48
 for j in range(9):
  r=.05+j*2.75/8
  for i in range(n):a=math.tau*i/n;verts.append(pos((-6+r*math.cos(a),15.55+.19*r*r,-4+r*math.sin(a))))
 for j in range(8):
  for i in range(n):a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
 me=bpy.data.meshes.new('relay_parabolic_dish');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('relay_parabolic_dish',me);bpy.context.scene.collection.objects.link(o);tagged(o,'relay_parabolic_dish',ivory);sol=o.modifiers.new('dish double wall','SOLIDIFY');sol.thickness=.11
 ring('relay_receiver_rim',(-6,17.04,-4),2.8,.08,metal);cyl('relay_feed_mast',(-6,16.5,-4),.07,1.7,metal,16);cyl('relay_feed_sensor',(-6,17.37,-4),.22,.27,sensor,24)
 for z in [1.7,4.7]:rounded('relay_front_step',(-6,10.9,z),(10.7,.45,2.7),ivory,.9)

def make_foundry():
 global G
 erase_roof();G='MF_Roof'
 rounded('foundry_broad_hangar_eave',(0,10.72,-.35),(28.9,.7,20.3),ink,3)
 # Six barrel-vault segments form a single broad industrial crown with visible transverse ribs.
 for j in range(6):
  z=-8.45+j*3.05;verts=[];faces=[];n=24
  for zz in [z,z+2.88]:
   for i in range(n+1):
    a=math.pi*i/n;x=13.7*math.cos(a);y=10.98+2.6*math.sin(a);verts.append(pos((x,y,zz)))
  for i in range(n):faces.append((i,i+1,i+n+2,i+n+1))
  me=bpy.data.meshes.new('foundry_vault');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('foundry_segmented_barrel_vault',me);bpy.context.scene.collection.objects.link(o);tagged(o,'foundry_segmented_barrel_vault',ivory);sol=o.modifiers.new('armoured roof thickness','SOLIDIFY');sol.thickness=.28
  cube('foundry_crown_identity_seam',(0,13.62,z+1.44),(.28,.08,2.7),idtrim,.035)
 # Closed barrel gables keep the broad roof a physically complete shell.
 for z in [-8.45,9.68]:
  vv=[pos((13.7*math.cos(math.pi*i/24),10.98+2.6*math.sin(math.pi*i/24),z)) for i in range(25)];vv.extend([pos((-13.7,10.72,z)),pos((13.7,10.72,z))]);me=bpy.data.meshes.new('foundry_gable');me.from_pydata(vv,[],[tuple(range(len(vv)))]);me.update();o=bpy.data.objects.new('foundry_closed_gable',me);bpy.context.scene.collection.objects.link(o);tagged(o,'foundry_closed_gable',ink);sol=o.modifiers.new('gable wall','SOLIDIFY');sol.thickness=.15
 for side in [-1,1]:
  for z in [-3.8,.2,4.2]:
   rounded('foundry_vent_bank',(side*9.4,12.96,z),(2.5,.24,2.9),metal,.35)
   for dz in [-.9,-.45,0,.45,.9]:cube('foundry_vent_louver',(side*9.4,13.13,z+dz),(2.05,.1,.08),ink,.025)
 # Low rear utility shoulders and service silos give a broad service silhouette.
 for side in [-1,1]:
  cyl('foundry_rear_utility_silo',(side*10.6,12.45,-7),2.0,3.3,metal)
  for yy in [11.2,12.8,14.0]:ring('foundry_silo_collar',(side*10.6,yy,-7),2.02,.1,ink)
  cyl('foundry_silo_cap',(side*10.6,14.18,-7),2.05,.27,ivory);cyl('foundry_silo_marker',(side*10.6,14.48,-7),.18,.25,sensor,24)
 rounded('foundry_identity_platform',(0,13.5,-3.8),(8.9,.4,8.2),ink,2.5);identity_disc(0,13.84,-3.8,3.5)
 for x in [-8,-4,4,8]:
  cube('foundry_clerestory_frame',(x,12.0,9.78),(2.85,.78,.17),metal,.08);cube('foundry_front_clerestory',(x,12.0,9.89),(2.6,.46,.04),warm,.04)
  for dx in [-.7,0,.7]:cube('foundry_window_mullion',(x+dx,12.0,9.92),(.055,.48,.04),ink,.015)

def build(kind):
 global ivory,ink,metal,warm,lamp,screen,sensor,idroof,idring,idtrim
 bpy.ops.wm.open_mainfile(filepath=str(BASE/'scene.blend'));S=bpy.context.scene
 # Far landing lamps are environmental, despite their original prop/practical ownership.
 for o in list(S.objects):
  if o.parent and o.parent.name in ['MF_Props','MF_Practicals'] and o.location.x>30:o.parent=bpy.data.objects['MF_Bridge']
 keep=C['environmentGroups'] if kind=='environment' else C['baseGroups']
 for o in list(S.objects):
  if o.type=='MESH' and (not o.parent or o.parent.name not in keep):bpy.data.objects.remove(o,do_unlink=True)
 for o in list(S.objects):
  if o.name.startswith('MF_') and o.name not in keep:bpy.data.objects.remove(o,do_unlink=True)
 if kind!='environment':
  ivory=bpy.data.materials['structure_ivory_ceramic'];ink=bpy.data.materials['structure_graphite_joints'];metal=bpy.data.materials['brushed_titanium']
  warm=material('practical_warm_window_glass',(.55,.29,.08),.15,.25,1.35);lamp=material('practical_station_marker',(.95,.57,.2),.1,.25,2.8);screen=material('ambient_screen_service',(.6,.8,.85),.1,.3,1.2);sensor=material('ambient_sensor_navigation',(.8,.9,1),.15,.25,1.7)
  idroof=material('identity_roof_inset',(.6,.6,.6),.35,.3,.12);idring=material('identity_roof_ring',(.9,.9,.9),.15,.25,2.0);idtrim=material('identity_trim',(.65,.65,.65),.3,.32,.45)
  station_details();{'command':make_command,'relay':make_relay,'foundry':make_foundry}[kind]()
  for name,p in C['sockets'].items():bpy.data.objects['socket_'+name].location=pos(p)
 else:
  for o in list(S.objects):
   if o.name.startswith('socket_'):bpy.data.objects.remove(o,do_unlink=True)
 filename='environment' if kind=='environment' else 'base-'+kind
 bpy.ops.wm.save_as_mainfile(filepath=str(R/(filename+'.blend')))
 exec((R/'source/export_kit.py').read_text(),globals());export_asset(kind,filename)
 if '--render' in sys.argv and kind!='environment':
  cam=bpy.data.objects['camera_exterior'];cam.location=pos((35,29,43));target=Vector(pos((0,8,5)));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=48;S.camera=cam;S.render.filepath=str(R/'previews'/(kind+'.png'));S.cycles.samples=20;bpy.ops.render.render(write_still=True)
  for gn in ['MF_Roof','MF_ShellCutaway']:
   for o in bpy.data.objects[gn].children:o.hide_render=True
  S.render.filepath=str(R/'previews'/(kind+'-cutaway.png'));bpy.ops.render.render(write_still=True)
if __name__=='__main__':
 args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
 kinds=[x for x in args if x in ['environment','command','relay','foundry']] or ['environment','command','relay','foundry']
 for kind in kinds:build(kind)
