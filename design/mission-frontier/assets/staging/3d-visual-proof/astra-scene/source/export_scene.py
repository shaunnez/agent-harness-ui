"""Open scene.blend then run in Blender. Exports named hierarchy and actual coordinates."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[1] if '__file__' in globals() else R
# Actual sea-plane intersections from exported terrain meshes, not top-edge guesses.
def shoreline_section(name):
 o=bpy.data.objects[name];edges={};segments=[];ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());section_mesh=ev.to_mesh()
 for poly in section_mesh.polygons:
  pp=[o.matrix_world@section_mesh.vertices[i].co for i in poly.vertices];hits=[]
  for a,b in zip(pp,pp[1:]+pp[:1]):
   if (a.z<0)!=(b.z<0):
    v=a+(b-a)*(-a.z/(b.z-a.z));hits.append((round(v.x,3),round(-v.y,3)))
  if len(hits)==2 and hits[0]!=hits[1]:segments.append(hits)
 for a,b in segments:edges.setdefault(a,[]).append(b);edges.setdefault(b,[]).append(a)
 if not edges:
  ev.to_mesh_clear();return []
 start=next(iter(edges));loop=[start];prev=None;cur=start
 for _ in range(len(segments)+1):
  opts=[v for v in edges[cur] if v!=prev]
  if not opts:break
  nxt=opts[0]
  if nxt==start:break
  loop.append(nxt);prev,cur=cur,nxt
 assert len(loop)>3 and start in edges.get(loop[-1],[]), 'Sea-plane section did not close: '+name
 ev.to_mesh_clear();return loop
sea_loops=[shoreline_section(n) for n in ['fractured_continuous_cliff','landing_rock_mass']]
# Merge static source geometry by visibility root and material for portable draw-call economy.
# scene.blend is saved BEFORE this step, so authored components remain independently editable.
source_inventory={};buckets={};dg=bpy.context.evaluated_depsgraph_get()
for o in list(bpy.context.scene.objects):
 if o.type!='MESH':continue
 parent=o.parent
 if not parent or not parent.name.startswith('MF_'):continue
 mi=o.data.polygons[0].material_index if o.data.polygons else 0
 mat=o.data.materials[mi] if o.data.materials else None;key=(parent.name,mat.name if mat else 'none')
 buckets.setdefault(key,[]).append(o);source_inventory.setdefault(parent.name,[]).append(o.name)
for (gn,mn),objects in buckets.items():
 verts=[];faces=[];uvs=[];smooth=[];colors=[]
 for o in objects:
  ev=o.evaluated_get(dg);me=ev.to_mesh();base=len(verts);verts.extend([tuple(o.matrix_world@v.co) for v in me.vertices]);uv=me.uv_layers.active;ca=me.color_attributes.get('Color') or me.color_attributes.active_color
  for p in me.polygons:
   faces.append(tuple(base+i for i in p.vertices));smooth.append(p.use_smooth)
   uvs.extend([tuple(uv.data[li].uv) if uv else (0,0) for li in p.loop_indices])
   colors.extend([tuple(ca.data[li if ca.domain=='CORNER' else me.loops[li].vertex_index].color) if ca else (1,1,1,1) for li in p.loop_indices])
  ev.to_mesh_clear()
 me=bpy.data.meshes.new(gn+'__'+mn);me.from_pydata(verts,[],faces);me.update();layer=me.uv_layers.new(name='UVMap')
 layer.data.foreach_set('uv',[c for pair in uvs for c in pair])
 cl=me.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');cl.data.foreach_set('color',[c for pair in colors for c in pair])
 for p,v in zip(me.polygons,smooth):p.use_smooth=v
 ob=bpy.data.objects.new(gn+'__'+mn,me);bpy.context.scene.collection.objects.link(ob);ob.parent=bpy.data.objects[gn]
 if mn!='none':me.materials.append(bpy.data.materials[mn])
 for o in objects:bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
 if o.type!='LIGHT':o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(R/'scene.glb'),export_format='GLB',use_selection=True,export_apply=True,export_cameras=True,export_lights=False,export_yup=True,export_animations=False)
def gl(p):return [round(p.x,5),round(p.z,5),round(-p.y,5)]
obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];pts=[o.matrix_world@Vector(v) for o in obs for v in o.bound_box]
metadata={'version':1,'units':'metres','axes':'glTF X right Y up Z front','seaLevel':0,'groundLevel':4,'bounds':{'min':gl(Vector([min(v[i] for v in pts) for i in range(3)])),'max':gl(Vector([max(v[i] for v in pts) for i in range(3)]))},'groups':{},'sockets':{},'cameras':{},'materials':[],'shorelineXZ':[json.loads((R/'shoreline.json').read_text()),[[31,9],[40,9],[44,13],[42,19],[34,19],[31,16]]],'worker':{'file':'worker.glb','height':1.8,'origin':'feet','forward':'+Z'}}
for o in bpy.context.scene.objects:
 if o.name.startswith('MF_'):metadata['groups'][o.name]={'children':len(o.children),'objects':[c.name for c in o.children]}
 if o.name.startswith('socket_'):metadata['sockets'][o.name[7:]]=gl(o.location)
 if o.type=='CAMERA':metadata['cameras'][o.name[7:]]={'position':gl(o.location),'target':list(o['target_gltf']),'verticalSpan':o['vertical_span'],'quaternionBlender':list(o.rotation_euler.to_quaternion())}
for m in sorted({m for o in obs for m in o.data.materials if m},key=lambda m:m.name):
 if not m.use_nodes:continue
 p=m.node_tree.nodes.get('Principled BSDF')
 if p:metadata['materials'].append({'name':m.name,'baseColor':list(p.inputs['Base Color'].default_value),'roughness':p.inputs['Roughness'].default_value,'metallic':p.inputs['Metallic'].default_value,'emissiveIntensity':p.inputs['Emission Strength'].default_value,'images':[n.image.name for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]})
# Runtime wash works at 0.42m field spacing; retain source and a measured <=0.14m simplification.
def distance_segment(p,a,b):
 dx=b[0]-a[0];dy=b[1]-a[1];q=dx*dx+dy*dy
 t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/q)) if q else 0
 return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
def rdp(points,eps):
 if len(points)<=2:return points
 ds=[distance_segment(p,points[0],points[-1]) for p in points[1:-1]];maximum=max(ds,default=0)
 if maximum<=eps:return [points[0],points[-1]]
 idx=ds.index(maximum)+1;return rdp(points[:idx+1],eps)[:-1]+rdp(points[idx:],eps)
metadata['shorelineExactXZ']=[loop+[loop[0]] for loop in sea_loops]
metadata['shorelineXZ']=[rdp(loop,.14) for loop in metadata['shorelineExactXZ']]
errors=[max(min(distance_segment(p,a,b) for a,b in zip(simple,simple[1:])) for p in exact) for exact,simple in zip(metadata['shorelineExactXZ'],metadata['shorelineXZ'])]
assert max(errors)<=.140001
metadata['shorelineSimplification']={'toleranceMetres':.14,'maxDeviationMetres':errors,'sourcePointCounts':[len(v) for v in metadata['shorelineExactXZ']],'runtimePointCounts':[len(v) for v in metadata['shorelineXZ']],'source':'closed evaluated sea-plane sections of continuous geological core and landing; scan excursions may protrude beyond core'}
metadata['walkableRoutes']=json.loads((R.parent/'contract.json').read_text())['walkableRoutes']
metadata['practicalLightPositions']=[[-7.1,8.65,8.6],[7.1,8.65,8.6],[-12,5.4,19.5],[12,5.4,19.5],[-12,5.4,9.7],[12,5.4,9.7],[35,5.4,11.3],[39,5.4,16.7]]
metadata['bounds']={'min':[round(min(gl(v)[i] for v in pts),4) for i in range(3)],'max':[round(max(gl(v)[i] for v in pts),4) for i in range(3)]}
metadata['sourceComponents']=source_inventory
for o in obs:o.data.calc_loop_triangles()
metadata['geometry']={'meshObjects':len(obs),'triangles':sum(len(o.data.loop_triangles) for o in obs),'exportOptimization':'merged by visibility group and material; editable source remains separate'}
(R/'scene-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
