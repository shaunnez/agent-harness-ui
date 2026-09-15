import bpy
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
