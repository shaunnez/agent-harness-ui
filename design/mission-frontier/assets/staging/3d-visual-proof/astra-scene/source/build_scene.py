"""Deterministic metre-scale Mission Frontier scene; Blender 4/5, no external assets."""
import bpy, math, random, json, sys
from pathlib import Path
from mathutils import Vector
import numpy as np
R=Path(__file__).resolve().parents[1];random.seed(916);rng=random.Random(916)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
S=bpy.context.scene;S.unit_settings.system='METRIC'
groups={}; group='MF_Terrain'
def xyz(p):return (p[0],-p[2],p[1])
def root(n):
 o=bpy.data.objects.new(n,None);S.collection.objects.link(o);groups[n]=o;return o
for n in ['MF_Terrain','MF_BaseFixed','MF_Roof','MF_ShellCutaway','MF_Interior','MF_Court','MF_Bridge','MF_Props','MF_Planting','MF_Practicals']:root(n)
def tag(o,n,m):
 o.name=n;o.parent=groups[group]
 if m:o.data.materials.append(m)
 return o
def mat(n,c,rough=.65,metal=0,emit=0,texture=False):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if emit:p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emit
 if texture:
  # Actual packed image maps, sampled consistently through UVs, not Blender procedural nodes.
  N=256; yy,xx=np.mgrid[:N,:N]; rnd=np.random.default_rng(sum(map(ord,n)));grain=rnd.random((N,N));cloud=(np.sin(xx*.035)+np.sin(yy*.054+xx*.014)+np.sin(xx*.12-yy*.08))/6
  v=np.clip(.88+cloud*.22+(grain-.5)*.13,.55,1.12);px=np.ones((N,N,4),dtype=np.float32)
  for k in range(3):px[:,:,k]=np.power(np.clip(c[k]*v,0,1),1/2.2)
  im=bpy.data.images.new(n+'_albedo',N,N);im.pixels.foreach_set(px.ravel());im.pack();t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=im;m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
  # Tangent-space grain normal; portable, restrained surface grain.
  no=np.ones((N,N,4),dtype=np.float32);no[:,:,0]=.5+(grain-.5)*.1;no[:,:,1]=.5+(rnd.random((N,N))-.5)*.1;no[:,:,2]=1
  ni=bpy.data.images.new(n+'_normal',N,N);ni.colorspace_settings.name='Non-Color';ni.pixels.foreach_set(no.ravel());ni.pack();tn=m.node_tree.nodes.new('ShaderNodeTexImage');tn.image=ni;nm=m.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.3;m.node_tree.links.new(tn.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
 return m
ivory=mat('structure_ivory_ceramic',(.66,.64,.57),.48,.23,texture=True);edge=mat('structure_graphite_joints',(.065,.085,.091),.51,.65,texture=True);metal=mat('brushed_titanium',(.28,.33,.34),.38,.8);pave=mat('court_weathered_basalt',(.19,.22,.23),.87,texture=True);soil=mat('terrain_gravel_sand',(.36,.32,.235),.95,texture=True);rock=mat('terrain_stratified_warm_limestone',(.38,.365,.32),.97,texture=True);darkrock=mat('terrain_wet_slate',(.17,.22,.22),.81,texture=True);ochre=mat('utility_ochre',(.69,.35,.075),.56,.3);glass=mat('console_blue_glass',(.012,.072,.105),.21,.5);leaf=[mat('foliage_'+str(i),c,.94) for i,c in enumerate([(.19,.23,.10),(.26,.30,.14),(.29,.15,.25),(.41,.22,.34),(.34,.27,.16)])];bark=mat('tree_salt_bark',(.15,.115,.085),.96,texture=True);amber=mat('practical_warm_strip',(1,.49,.14),.4,0,2);cyan=mat('practical_console_cyan',(.10,.55,.76),.36,0,1.4)
def cube(n,p,sz,m,b=.08):
 if b>=.6 and sz[1]<1:
  # True rounded plan: beveling a thin cube clamps radius to its thickness.
  rad=min(b,sz[0]/2-.01,sz[2]/2-.01);ring=[]
  for xx,zz,start in [(1,1,0),(-1,1,90),(-1,-1,180),(1,-1,270)]:
   for j in range(7):
    a=math.radians(start+j*15);ring.append((p[0]+xx*(sz[0]/2-rad)+rad*math.cos(a),p[2]+zz*(sz[2]/2-rad)+rad*math.sin(a)))
  nn=len(ring);vs=[(x,p[1]+h*sz[1]/2,z) for h in [-1,1] for x,z in ring];fs=[tuple(range(nn)),tuple(range(nn*2-1,nn-1,-1))]
  for i in range(nn):fs.append((i,(i+1)%nn,(i+1)%nn+nn,i+nn))
  o=mesh(n,vs,fs,m);mod=o.modifiers.new('small_edge_radius','BEVEL');mod.width=min(.08,sz[1]*.2);mod.segments=2;o.modifiers.new('corner_normals','WEIGHTED_NORMAL');return o
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object;o.dimensions=(sz[0],sz[2],sz[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);tag(o,n,m)
 if b:mod=o.modifiers.new('machined_edge_radius','BEVEL');mod.width=b;mod.segments=3;o.modifiers.new('corner_normals','WEIGHTED_NORMAL')
 return o
def cyl(n,p,r,h,m,verts=32):
 bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=h,location=xyz(p));o=bpy.context.object;tag(o,n,m);mod=o.modifiers.new('rim_radius','BEVEL');mod.width=.06;mod.segments=2;o.modifiers.new('corner_normals','WEIGHTED_NORMAL');return o
def beam(n,a,b,r,m):
 aa,bb=Vector(xyz(a)),Vector(xyz(b));bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=r,depth=(bb-aa).length,location=(aa+bb)/2);o=bpy.context.object;o.rotation_euler=(bb-aa).to_track_quat('Z','Y').to_euler();return tag(o,n,m)
def ico(n,p,sz,m,sub=1):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=xyz(p));o=bpy.context.object;o.scale=(sz[0],sz[2],sz[1]);o.rotation_euler=(rng.random()*.4,rng.random()*.5,rng.random()*6);return tag(o,n,m)
def mesh(n,vs,fs,m):
 me=bpy.data.meshes.new(n);me.from_pydata([xyz(v) for v in vs],[],fs);me.update();o=bpy.data.objects.new(n,me);S.collection.objects.link(o);tag(o,n,m)
 # Planar metre UVs plus normal maps (geometry carries cliff topology).
 uv=me.uv_layers.new(name='UVMap')
 for f in me.polygons:
  for li in f.loop_indices:
   v=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=(v.x*.09,v.y*.09+v.z*.06)
 return o
# Connected coastal terrain: dense irregular rings, cove indentation, varied upper terrace.
N=96
shore=[]
for i in range(N):
 a=2*math.pi*i/N;z=math.sin(a)*29-1;x=math.cos(a)*29-4
 jitter=1+.045*math.sin(7*a)+.035*math.sin(13*a);x=-4+(x+4)*jitter;z=-1+(z+1)*jitter
 if x>12 and z>17:x-=7*math.exp(-((z-22)/6)**2)
 shore.append((x,z))
def ground(x,z):
 clearance=max(abs(x)-14,z-20,-z-12,0);f=min(1,clearance/5)
 return 3.96+f*(.24*math.sin(x*.63)*math.cos(z*.42)+4.1*math.exp(-((x+18)/10)**2-((z+17)/10)**2))
vs=[(-4,ground(-4,-1),-1)];fs=[]
for j in range(1,17):
 f=j/16
 for x,z in shore:
  xx=-4+(x+4)*f;zz=-1+(z+1)*f;vs.append((xx,ground(xx,zz),zz))
for i in range(N):fs.append((0,1+(i+1)%N,1+i))
for j in range(15):
 for i in range(N):
  a=1+j*N+i;b=1+j*N+(i+1)%N;fs.extend([(a,b+N,b),(a,a+N,b+N)])
mesh('continuous_gravel_terrace',vs,fs,soil)
# Cliff uses continuous strata, deep fissures, toe shelves; no repeated rock ring.
cv=[];cf=[]
for level,(scale,y) in enumerate([(1,None),(1.01,2.4),(1.045,1.1),(1.09,-.8)]):
 for i,(x,z) in enumerate(shore):
  xx=-4+(x+4)*scale;zz=-1+(z+1)*scale;cv.append((xx,ground(x,z) if y is None else y+.28*math.sin(i*2.3+level),zz))
for j in range(3):
 for i in range(N):
  a=j*N+i;b=j*N+(i+1)%N;cf.extend([(a,b,a+N),(b,b+N,a+N)])
mesh('fractured_continuous_cliff',cv,cf,rock)
for i,(x,z) in enumerate(shore):
 if i%2==0:
  for y,s in [(1.3,1.35),(2.9,.85)]:
   ico('cliff_bedded_outcrop', (x+rng.uniform(-.5,.5),y,z+rng.uniform(-.6,.6)),(rng.uniform(1.1,2.3)*s,rng.uniform(.7,1.4),rng.uniform(.8,1.8)*s),rock if y>2 else darkrock,2)
# Scrub and weathered gravel outside clear manufactured footprint.
for i in range(520):
 x=rng.uniform(-29,22);z=rng.uniform(-26,25)
 if (x/28)**2+(z/28)**2> .86 or (-15<x<15 and -12<z<21):continue
 y=ground(x,z)
 if i%3==0:ico('scattered_weathered_stone',(x,y+.12,z),(.25+rng.random()*.5,.12+rng.random()*.25,.2+rng.random()*.4),rock)
 else:
  group='MF_Planting';ico('coastal_low_scrub',(x,y+.15,z),(.35+rng.random()*.8,.16+rng.random()*.23,.3+rng.random()*.7),leaf[i%2],1);group='MF_Terrain'
# Solid grounded foundation and open entrance court.
group='MF_BaseFixed';cube('base_structural_plinth',(0,4.02,0),(25,.55,21),edge,.85);cube('base_finished_floor',(0,4.22,0),(24,.12,20),pave,.8)
group='MF_Court';cube('court_foundation',(0,3.97,14.8),(27,.52,11.8),edge,1.2)
for ix in range(9):
 for iz in range(4):cube('apron_paving_panel',(-12+ix*3,4.245,10.7+iz*2.7),(2.97,.07,2.67),pave,.07)
for x in [-12.85,12.85]:cube('court_edge_inlay',(x,4.3,14.8),(.075,.02,10.4),ochre,.01)
for x in [-9,-3,3,9]:
 for z in [10.6,19.5]:cube('court_drain',(x,4.3,z),(2,.04,.23),edge,.01)
# Two rounded pavilion wings joined by a rear service spine, open central entry.
for side in [-1,1]:
 x=side*7.1
 group='MF_BaseFixed'
 cube('wing_rear_structure',(x,7.4,-8.7),(9.7,6.25,1.5),ivory,.7)
 cube('wing_outer_structure',(side*11.3,7.3,-.6),(1.6,6.1,16.5),ivory,.7)
 if side==1:
  o=bpy.context.object;o.parent=groups['MF_ShellCutaway']
  cube('cutaway_outer_sill',(side*11.3,4.8,-.6),(1.6,1.1,16.5),edge,.2)
 # recessed façade sockets inside articulated posts, open front bay
 if side==1:group='MF_ShellCutaway'
 for z in [-6.8,-2.5,1.8,6.2]:
  cube('facade_window_recess',(side*12.13,7.6,z),(.09,2.0,2.9),edge,.12)
  cube('facade_service_panel',(side*12.2,5.75,z),(.08,.8,2.6),metal,.06)
  for k in range(4):cube('facade_vent_fin',(side*12.26,5.5+k*.16,z),(.07,.045,2.2),edge,.01)
  cube('segmented_outer_rib',(side*11.95,7.35,z+1.8),(.75,6.3,.46),ivory,.2)
 group='MF_ShellCutaway'
 for xx in [x-3.9,x+3.9]:cube('entry_radius_pier',(xx,7.15,7.6),(1.15,5.8,1.8),ivory,.48)
 cube('entry_crown',(x,9.4,7.5),(8.8,1.4,2),ivory,.55)
 cube('entry_inner_lintel',(x,8.85,7.37),(6.6,.2,1.7),edge,.09)
 group='MF_ShellCutaway';cube('practical_entry',(x,8.72,8.4),(3.2,.12,.09),amber,.03)
 group='MF_Roof'
 cube('wing_lower_roof_gasket',(x,10.3,-.4),(10.4,.32,18.2),edge,1.15)
 cube('wing_rounded_roof',(x,10.67,-.4),(10.35,.55,18.1),ivory,1.3)
 # segmented roof strips, actual recessed joints
 for z in [-7,-3.5,0,3.5,6.5]:cube('roof_transverse_seam',(x,10.965,z),(8.7,.035,.07),edge,.01)
 cube('roof_service_recess',(x,10.99,-2.2),(3.2,.07,5.5),edge,.35)
 for zz in range(8):cube('roof_heat_exchanger_fin',(x,11.11,-4.5+zz*.65),(2.7,.19,.12),metal,.025)
 # furnished interior: blue screens are generic tools, no invented task status
 group='MF_Interior'
 for zz in [-6.6,-2.4,1.8,5.8]:
  group='MF_ShellCutaway' if side==1 else 'MF_Interior'
  cube('interior_wall_dark_panel',(side*10.44,7.0,zz),(.11,4.0,3.85),edge,.04)
  cube('interior_panel_header',(side*10.32,8.65,zz),(.12,.18,3.4),metal,.03)
  for k in range(4):cube('interior_rack_slot',(side*10.3,7.45+k*.21,zz),(.08,.055,2.8),metal,.01)
  cube('interior_practical_wash',(side*10.24,8.35,zz),(.05,.09,2.6),amber,.02)
 group='MF_Interior'
 for xx in [x-2.6,x,x+2.6]:
  for zz in [-6,-3,0,3,6]:cube('interior_floor_panel',(xx,4.3,zz),(2.55,.06,2.94),pave,.02)
 for z in [-5.6,-1.6,2.4]:
  cube('console_pedestal',(side*9.3,4.95,z),(1.7,1.3,2.2),edge,.2)
  desk=cube('console_worktop',(side*9.0,5.65,z),(2.4,.18,2.5),metal,.15)
  cube('console_monitor_housing',(side*10.15,6.35,z),(.22,1.25,2.1),edge,.12)
  cube('console_monitor_glass',(side*10,6.35,z),(.04,1.0,1.84),glass,.03)
  for k in range(5):cube('console_readout_line',(side*9.97,6.0+k*.16,z),(.025,.025,1.2-(k%3)*.17),cyan,0)
  cyl('operator_stool',(side*7.4,4.85,z),.45,1.05,edge,16)
 for xx in [x-2.9,x+2.9]:cube('interior_route_inlay',(xx,4.31,-.1),(.055,.03,14),ochre,.01)
 # low central collaboration table leaves exact interior worker sockets clear
 cyl('round_workbench_base',(x,4.7,4.9),1.15,.8,edge)
 cyl('round_workbench_top',(x,5.16,4.9),1.5,.12,metal)
 cyl('round_workbench_glass',(x,5.25,4.9),1.13,.055,glass)
group='MF_Interior'
for x in [-7.1,7.1]:
 cube('rear_equipment_niche',(x,6.65,-7.88),(5.2,3.8,.12),edge,.13)
 for dx in [-1.75,0,1.75]:
  cube('rear_service_cabinet',(x+dx,5.95,-7.5),(1.4,2.5,.65),metal,.15)
  for k in range(5):cube('cabinet_vent',(x+dx,6.0+k*.22,-7.13),(1.05,.07,.07),edge,.01)
  cube('cabinet_small_lamp',(x+dx+.44,5.3,-7.13),(.08,.12,.03),amber,.02)
# Roof inset inspection panels, facade leg armour and fasteners.
for side in [-1,1]:
 group='MF_ShellCutaway'
 for xx in [side*7.1-3.9,side*7.1+3.9]:
  cube('entry_pier_dark_recess',(xx,6.8,8.53),(.72,3.7,.08),edge,.17)
  cube('entry_pier_armour',(xx,6.8,8.59),(.5,2.4,.14),ivory,.12)
  cube('entry_pier_foot',(xx,4.65,8.5),(1.3,.7,.45),metal,.14)
  for yy in [5.4,8.15]:
   cube('entry_pier_bolt',(xx,yy,8.63),(.13,.13,.06),metal,.03)
 group='MF_Roof'
 for zz in [-6,2,5.5]:
  cube('roof_inspection_hatch',(side*9.5,11.02,zz),(1.6,.09,1.8),metal,.1)
  for xx in [-.6,.6]:cube('roof_hatch_fastener',(side*9.5+xx,11.08,zz),(.075,.025,.13),edge,.01)
group='MF_Interior'
for x in [-5.4,5.4]:
 cube('rear_workstation_housing',(x,7.25,-7.0),(3.7,2.5,.3),edge,.15)
 cube('rear_workstation_display',(x,7.25,-6.82),(3.3,2.1,.04),glass,.06)
 for k in range(9):cube('rear_workstation_data',(x-.2,6.4+k*.2,-6.79),(2.2-(k%4)*.23,.055,.018),cyan,0)
 cube('rear_workstation_desk',(x,5.55,-6.25),(3.7,.2,1.5),metal,.14)
 cube('rear_workstation_support',(x,4.95,-6.7),(2.8,1.3,.5),edge,.12)
# Raised rounded rear core rather than stacked boxes. Entire cap belongs to roof.
group='MF_BaseFixed';cube('rear_cross_spine',(0,7.3,-7.9),(6,6,3.9),ivory,.6)
group='MF_Roof'
cyl('core_dark_collar',(0,10.5,-5.0),6.6,.6,edge,64);cyl('core_ivory_drum',(0,11.2,-5.0),6.4,1.2,ivory,64);cyl('core_upper_recess',(0,11.95,-5.0),5.8,.35,edge,64);cyl('core_top_cap',(0,12.3,-5.0),5.9,.48,ivory,64)
for i in range(16):
 a=i*math.tau/16;x=6.43*math.cos(a);z=-5+6.43*math.sin(a)
 ob=cube('radial_core_panel',(x,11.2,z),(.12,.8,1.25),metal,.04);ob.rotation_euler.z=-a
cyl('roof_receiver_foot',(1,12.8,-6),1.1,.5,edge);beam('receiver_mast',(1,12.9,-6),(1,15,-6),.1,metal)
for dx in [-1.5,0,1.5]:beam('antenna_array',(1+dx,14.55,-6.5),(1+dx,14.55,-5.5),.08,ivory)
beam('antenna_crossbar',(-.5,14.55,-6),(2.5,14.55,-6),.08,metal)
# Grounded bridge, rails, piers; compact far landing physically part of scene.
group='MF_Bridge';cube('bridge_structural_deck',(24,3.83,14),(24,.68,4.2),edge,.15)
for i in range(16):cube('bridge_deck_panel',(12.75+i*1.5,4.21,14),(1.47,.08,4),pave,.035)
for x in [13,19,26,33]:
 cube('bridge_reinforced_pier',(x,1.8,14),(1.2,4.2,3),rock,.15)
 cube('bridge_bearing',(x,3.6,14),(1.8,.4,3.8),metal,.1)
for z in [12.03,15.97]:
 for i in range(13):beam('bridge_guardrail_post',(12+i*2,4.3,z),(12+i*2,5.35,z),.07,metal)
 for y in [4.8,5.35]:beam('bridge_continuous_rail',(12,y,z),(36,y,z),.065,metal)
 cube('bridge_safety_edge',(24,4.29,z),(24,.035,.055),ochre,.01)
group='MF_Terrain';ico('landing_rock_mass',(37,1.15,14),(6.5,3.2,5.5),rock,2);cube('landing_solid_cap',(37,3.85,14),(8,.5,7),rock,.8)
group='MF_Bridge';cube('landing_paving',(37,4.16,14),(7.5,.15,6.5),pave,.6)
# Utility props: cargo, service cart, power stack, antenna, consoles, bollard lights.
group='MF_Props'
for x,z in [(-11,15),(9,17.6),(-14,-5)]:
 cube('cargo_crate',(x,4.9,z),(1.5,1.3,1.4),ochre,.18)
 for xx in [-.55,.55]:cube('cargo_retaining_band',(x+xx,4.95,z),(.14,1.43,1.5),edge,.04)
 cube('cargo_lid',(x,5.62,z),(1.55,.12,1.45),metal,.05)
for x,z in [(-13.2,-5),(13.6,-6)]:
 cube('utility_power_pack',(x,5.2,z),(1.7,2.35,3.2),edge,.25)
 for zz in [-.9,0,.9]:cyl('power_cell',(x,5.25,z+zz),.55,2.05,metal,16)
 cube('power_cap',(x,6.45,z),(1.8,.25,3.3),ivory,.16)
x,z=7,19
cube('service_cart_chassis',(x,4.75,z),(2.4,.3,1.5),edge,.15);cube('service_cart_battery',(x,5.3,z),(1.4,.8,1.2),ochre,.2)
for xx in [-.85,.85]:
 for zz in [-.7,.7]:
  o=cyl('cart_wheel',(x+xx,4.55,z+zz),.34,.2,edge,16);o.rotation_euler.x=math.pi/2
beam('cart_handle',(x-1,4.9,z-.5),(x-1,5.9,z-.5),.065,metal);beam('cart_handle',(x-1,4.9,z+.5),(x-1,5.9,z+.5),.065,metal);beam('cart_grip',(x-1,5.9,z-.5),(x-1,5.9,z+.5),.08,metal)
for x,z in [(-12,19.5),(12,19.5),(-12,9.7),(12,9.7),(35,11.3),(39,16.7)]:
 group='MF_Props';cyl('path_bollard',(x,4.8,z),.16,1.05,edge,12)
 group='MF_Practicals';cyl('practical_bollard_cap',(x,5.34,z),.18,.16,amber,12)
# Salt-shaped trees: branching trunks and clustered, varied leaf crowns.
group='MF_Planting'
for idx,(x,z,h) in enumerate([(-23,-14,7.6),(-25,-2,6.5),(-22,13,5.8),(-16,-21,7.2),(11,-22,6.7),(17,-16,5.6),(-14,24,5.8)]):
 y=ground(x,z);beam('wind_shaped_tree_trunk',(x,y,z),(x+.4,y+h*.73,z+.2),.23,bark)
 for j in range(7):
  a=j*2.4;dx=math.cos(a)*(1.2+j*.14);dz=math.sin(a)*(1.2+j*.14);yy=y+h*(.62+.035*j)
  beam('tree_branch',(x+.25,y+h*.43,z),(x+dx,yy,z+dz),.105,bark)
  for k in range(23):
   aa=rng.random()*math.tau;rr=rng.random()*1.25
   ico('foliage_crown_cluster',(x+dx+math.cos(aa)*rr,yy+rng.random()*1.1,z+dz+math.sin(aa)*rr),(.33+rng.random()*.37,.24+rng.random()*.36,.3+rng.random()*.38),leaf[2+(j+k)%2] if idx%3 else leaf[(j+k)%2],2)
exec((R/'source/landscape_finish.py').read_text(),globals())
exec((R/'source/art_refinement.py').read_text(),globals())
exec((R/'source/major_forms_pass.py').read_text(),globals())
exec((R/'source/geology_join.py').read_text(),globals())
# Actual exportable sockets/cameras.
contract=json.loads((R.parent/'contract.json').read_text())
for n,p in contract['sockets'].items():
 o=bpy.data.objects.new('socket_'+n,None);S.collection.objects.link(o);o.location=xyz(p);o.empty_display_size=.4
for name,c in contract['cameras'].items():
 bpy.ops.object.camera_add(location=xyz(c['position']));o=bpy.context.object;o.name='camera_'+name;target=Vector(xyz(c['target']));o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler();o.data.type='ORTHO';o.data.ortho_scale=c['verticalSpan']*1.4;o['target_gltf']=c['target'];o['vertical_span']=c['verticalSpan']
S.camera=bpy.data.objects['camera_exterior'];S.render.engine='CYCLES';S.cycles.samples=24;S.cycles.use_denoising=True;S.render.resolution_x=1400;S.render.resolution_y=1000;S.render.resolution_percentage=100;S.world.color=(.44,.49,.55);S.view_settings.view_transform='AgX'
bpy.ops.object.light_add(type='SUN',location=(0,0,30));o=bpy.context.object;o.name='preview_sun';o.rotation_euler=(.4,-.5,-.4);o.data.energy=2.3;o.data.angle=.15
bpy.ops.object.light_add(type='AREA',location=(10,-20,35));o=bpy.context.object;o.name='preview_fill';o.data.energy=9000;o.data.size=30
S.render.film_transparent=True
bpy.ops.wm.save_as_mainfile(filepath=str(R/'scene.blend'))
(R/'shoreline.json').write_text(json.dumps(shore))
exec((R/'source/export_scene.py').read_text(),globals())
if '--render' in sys.argv:
 S.render.filepath=str(R/'previews/exterior.png');bpy.ops.render.render(write_still=True)
 for g in ['MF_Roof','MF_ShellCutaway']:
  for o in groups[g].children:o.hide_render=True
 S.camera=bpy.data.objects['camera_cutaway'];S.render.filepath=str(R/'previews/cutaway.png');bpy.ops.render.render(write_still=True)
