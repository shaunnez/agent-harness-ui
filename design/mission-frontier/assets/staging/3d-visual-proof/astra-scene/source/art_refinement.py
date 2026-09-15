"""Photographic PBR ground, coherent scanned cliff formations, retained Quaternius trees,
and segmented shell geometry. Explicit browser iteration-1 art corrections."""
import bmesh
from mathutils import Matrix
# Replace generated terrain noise with true portable CC0 image maps.
def pbr_files(material,asset):
 n=material.node_tree.nodes;l=material.node_tree.links;p=n.get('Principled BSDF')
 for socket in ['Base Color','Normal','Roughness']:
  for link in list(p.inputs[socket].links):l.remove(link)
 for role,socket in [('Diffuse','Base Color'),('Rough','Roughness'),('nor_gl','Normal')]:
  path=next((R/'sources/polyhaven'/asset).glob(role+'.*'));im=bpy.data.images.load(str(path),check_existing=True);im.pack()
  if role!='Diffuse':im.colorspace_settings.name='Non-Color'
  t=n.new('ShaderNodeTexImage');t.image=im
  if role=='nor_gl':
   nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.8;l.new(t.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs[0],p.inputs[socket])
  else:l.new(t.outputs['Color'],p.inputs[socket])
pbr_files(soil,'coast_land_rocks_01');pbr_files(rock,'seaside_rock');pbr_files(darkrock,'seaside_rock')
# Delete the repeated decorative boulder necklace, low-poly vegetation and poles.
for o in list(bpy.data.objects):
 if o.name.startswith(('cliff_bedded_outcrop','foliage_crown_cluster','wind_shaped_tree_trunk','tree_branch','coastal_low_scrub','scattered_weathered_stone')):bpy.data.objects.remove(o,do_unlink=True)
# Give exterior soil visible cross-slope ledges outside the manufactured footprint.
terrain=bpy.data.objects['continuous_gravel_terrace']
for v in terrain.data.vertices:
 x,z=v.co.x,-v.co.y;clearance=max(abs(x)-14,z-20,-z-12,0);f=min(1,clearance/6)
 v.co.z+=f*(.65*math.sin(x*.32+z*.16)+.4*math.sin(z*.52)+.22*math.sin(x*1.3+z*.9))
# Contract the top lip inside the scanned faces, while retaining the submerged rock footing.
for name in ['continuous_gravel_terrace','fractured_continuous_cliff']:
 ob=bpy.data.objects[name]
 for v in ob.data.vertices:
  x,z=v.co.x,-v.co.y;rad=math.sqrt(((x+4)/29)**2+((z+1)/29)**2)
  if v.co.z>3:
   f=max(0,min(1,(rad-.65)/.35))*.075;v.co.x=-4+(x+4)*(1-f);v.co.y=-(-1+(z+1)*(1-f))
# Several long rock formations, not repeated independent rocks. Original scan has real fissures.
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(R/'sources/polyhaven/coastal_cliff_02/coastal_cliff_02.gltf'))
scan=[o for o in bpy.data.objects if o not in before and o.type=='MESH'][0]
bpy.context.view_layer.objects.active=scan;bpy.ops.object.select_all(action='DESELECT');scan.select_set(True)
# Decimate original 483k-vertex scan once with UVs retained, then vary rotation/scale per formation.
dec=scan.modifiers.new('portable_scan_lod','DECIMATE');dec.ratio=.075;bpy.ops.object.modifier_apply(modifier=dec.name)
scan.data.transform(scan.matrix_world);scan.matrix_world=Matrix.Identity(4)
lo=Vector([min(v.co[i] for v in scan.data.vertices) for i in range(3)]);hi=Vector([max(v.co[i] for v in scan.data.vertices) for i in range(3)]);scan.data.transform(Matrix.Translation(-(lo+hi)/2));dims=hi-lo
for im in bpy.data.images:
 if im.filepath and 'coastal_cliff_02' in im.filepath:im.pack()
# (gltf center x,z, desired width/depth/height, angle) follows distinct coastal segments.
formations=[(-8,28,40,8.8,6.5,0),(-32,-1,34,9,7.3,math.pi/2),(-8,-26,37,10,9.5,math.pi),(21,-8,27,9,6.8,-math.pi/2)]
for idx,(x,z,w,d,h,a) in enumerate(formations):
 o=scan if idx==0 else bpy.data.objects.new('scan_cliff_'+str(idx),scan.data)
 if idx:S.collection.objects.link(o)
 o.name='coastal_scanned_formation_'+str(idx);o.parent=groups['MF_Terrain'];o.scale=(w/dims.x,d/dims.y,h/dims.z);o.rotation_euler.z=a+math.pi;o.location=xyz((x,h/2-1,z))
# A rocky raised terrace sits on the rear shoulder, improving topographic silhouette.
o=bpy.data.objects.new('rear_rocky_terrace',scan.data);S.collection.objects.link(o);o.parent=groups['MF_Terrain'];o.scale=(.42,.72,.62);o.rotation_euler.z=.35+math.pi;o.location=xyz((-17,5.2,-19))
# Retain the previously approved Quaternius tree type with actual twisted branches/leaves.
group='MF_Planting'
for idx,(name,x,z,h,angle) in enumerate([('TwistedTree_3',-24,-12,8.3,.2),('TwistedTree_5',-25,3,6.1,1.5),('TwistedTree_3',-19,19,6.6,-.6),('TwistedTree_3',-12,-23,8.8,2.5),('TwistedTree_5',10,-22,7.1,.8),('TwistedTree_3',18,-13,6.7,2.1),('TwistedTree_5',-11,25,4.3,0)]):
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(R/'sources/quaternius'/(name+'.gltf')));oo=[o for o in bpy.data.objects if o not in before and o.type=='MESH']
 for o in oo:
  o.data=o.data.copy();o.data.transform(o.matrix_world);o.matrix_world=Matrix.Identity(4);lo=Vector([min(v.co[i] for v in o.data.vertices) for i in range(3)]);hi=Vector([max(v.co[i] for v in o.data.vertices) for i in range(3)]);o.data.transform(Matrix.Translation(Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))));sc=h/(hi.z-lo.z);o.scale=(sc*1.55,sc*1.5,sc);o.location=xyz((x,ground(x,z),z));o.rotation_euler.z=angle;o.name='retained_twisted_tree_'+str(idx);o.parent=groups[group]
  for i,m in enumerate(list(o.data.materials)):
   if m and 'Leaves' in m.name:
    mm=m.copy();mm.name='coastal_purple_leaves' if idx%3 else 'coastal_olive_leaves';o.data.materials[i]=mm;p=mm.node_tree.nodes.get('Principled BSDF')
    for link in list(p.inputs['Base Color'].links):mm.node_tree.links.remove(link)
    p.inputs['Base Color'].default_value=(.29,.095,.27,1) if idx%3 else (.19,.245,.075,1);p.inputs['Roughness'].default_value=.9
  # Export merge expects one material per object; split leaf/bark geometry without changing shape.
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='MATERIAL');bpy.ops.object.mode_set(mode='OBJECT')
# Architecture: reduce blank ivory wall height with dark inner service lining.
group='MF_Interior'
for side in [-1,1]:
 for z in [-6.6,-2.4,1.8,5.8]:
  if side==1:group='MF_ShellCutaway'
  cube('upper_inner_service_band',(side*10.35,9.0,z),(.15,.75,3.7),edge,.08)
 group='MF_Interior'
 for x in [side*4.3,side*7.3,side*10.2]:
  cube('rear_wall_cladding',(x,8.6,-7.82),(2.8,2.7,.14),edge,.08)
  cube('rear_wall_crossrail',(x,9.8,-7.68),(2.7,.15,.12),metal,.02)
  for yy in [7.6,8.1,8.6,9.1]:cube('rear_wall_equipment_seam',(x,yy,-7.67),(2.4,.035,.06),metal,.01)
# Cover monolithic central service wall in framed, recessed equipment modules.
for x in [-1.75,0,1.75]:
 cube('core_interior_service_panel',(x,7.25,-5.9),(1.5,4.9,.18),edge,.14)
 cube('core_interior_upper_armour',(x,9.15,-5.75),(1.35,.8,.2),ivory,.1)
 for k in range(6):cube('core_interior_vent',(x,6.1+k*.33,-5.77),(1.1,.095,.12),metal,.02)
# Exterior window recesses become visibly subdivided machinery/clerestory bays.
for side in [-1,1]:
 group='MF_ShellCutaway' if side==1 else 'MF_BaseFixed'
 for z in [-6.8,-2.5,1.8,6.2]:
  for k in [-.95,0,.95]:cube('external_bay_frame',(side*12.24,7.6,z+k),(.24,2.15,.12),metal,.035)
  cube('external_bay_sill',(side*12.28,6.62,z),(.36,.22,3.05),ivory,.08)
  for k in range(3):cube('external_bay_inset_light',(side*12.29,7.95,z-.8+k*.8),(.04,.12,.44),amber,.015)
# Narrow articulated roof ribs and raised clipped-corner armor shoulder blocks.
for side in [-1,1]:
 group='MF_Roof'
 for z in [-7,-3.5,0,3.5,6.5]:
  cube('roof_structural_rib',(side*7.1,11.04,z),(9.7,.17,.28),ivory,.08)
 # Raised side cap creates multi-level facade/roof silhouette with deep graphite channel.
 cube('side_roof_armour_gasket',(side*10.4,11.1,-.6),(2.55,.32,14.8),edge,.7)
 for z in [-5.7,-2.5,.7,3.9]:cube('segmented_side_roof_armour',(side*10.4,11.42,z),(2.45,.55,3.04),ivory,.4)
# Segmented ring plate geometry physically separates radial armor panels.
for o in list(bpy.data.objects):
 if o.name.startswith('core_top_cap'):bpy.data.objects.remove(o,do_unlink=True)
group='MF_Roof'
for i in range(18):
 a0=i*math.tau/18+.014;a1=(i+1)*math.tau/18-.014;verts=[]
 for y in [12.08,12.58]:
  for rr,a in [(2.0,a0),(5.9,a0),(5.9,a1),(2.0,a1)]:verts.append((math.cos(a)*rr,y,-5+math.sin(a)*rr))
 ob=mesh('radial_upper_armour_panel',verts,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],ivory);be=ob.modifiers.new('armor_edge','BEVEL');be.width=.055;be.segments=2;ob.modifiers.new('armor_normals','WEIGHTED_NORMAL')
cyl('central_roof_service_cap',(0,12.4,-5),2.12,.45,edge,48)
# Angled entry armour makes the broad openings purpose-built structural portals.
for side in [-1,1]:
 group='MF_ShellCutaway'
 for x in [side*7.1-3.9,side*7.1+3.9]:
  cube('portal_outer_shoulder',(x,8.6,8.2),(1.45,2.25,1.25),ivory,.35)
  ob=cube('portal_inward_haunch',(x,9.12,8.2),(1.1,1.8,1.3),ivory,.24);ob.rotation_euler.y=(-.35 if x>side*7.1 else .35)
  cube('portal_amber_warning',(x,7.75,8.93),(.24,.65,.06),amber,.03)

exec((R/'source/cliff_contact_finish.py').read_text(),globals())
