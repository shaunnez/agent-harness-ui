"""Export selected kit after saving the editable Blender source."""
import bpy,json
from mathutils import Vector

def export_asset(kind,filename,output=None):
 output=output or R;output.mkdir(parents=True,exist_ok=True)
 ns={'bpy':bpy};exec((R/'source/merge_geometry.py').read_text(),ns)
 bpy.ops.object.select_all(action='DESELECT')
 for o in bpy.context.scene.objects:
  if o.type!='LIGHT':o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(output/(filename+'.glb')),export_format='GLB',use_selection=True,export_apply=True,export_cameras=True,export_lights=False,export_yup=True,export_animations=False)
 def bounds(objects):
  points=[]
  for o in objects:
   if o.type=='MESH':
    for v in o.data.vertices:
     p=o.matrix_world@v.co;points.append((p.x,p.z,-p.y))
  lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
  return {'min':lo,'max':hi,'size':[hi[i]-lo[i] for i in range(3)]}
 obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];materials=sorted({m.name for o in obs for m in o.data.materials if m});groups={o.name:[c.name for c in o.children] for o in bpy.context.scene.objects if o.name.startswith('MF_')}
 lamps=[[-7.1,8.53,8.05],[7.1,8.53,8.05],[-12,5.4,19.5],[12,5.4,19.5],[-12,5.4,9.7],[12,5.4,9.7]]
 if kind=='command':lamps+=[[0,11.35,-.1]]
 if kind=='relay':lamps+=[[-10.8,14.15,-4.1]]
 if kind=='foundry':lamps+=[[0,11.35,9.6]]
 entry={'file':filename+'.glb','editableSource':filename+'.blend','bounds':bounds(obs),'groups':groups,'materials':materials,'sourceComponents':ns['source_inventory'],'baseLightPositions':lamps if kind!='environment' else [],'environmentLightPositions':[[35,5.4,11.3],[39,5.4,16.7]] if kind=='environment' else []}
 if kind!='environment':entry['buildingBounds']=bounds([o for o in obs if o.parent and o.parent.name not in ['MF_Court','MF_Props','MF_Practicals']])
 path=output/'kit-metadata.json';meta=json.loads(path.read_text()) if path.exists() else {'version':1,'units':'metres','axes':'glTF X right Y up Z front','assets':{},'sockets':C['sockets'],'walkableRoutes':C['walkableRoutes'],'cameras':META['cameras'],'shorelineXZ':META['shorelineXZ'],'shorelineExactXZ':META['shorelineExactXZ'],'shorelineSimplification':META['shorelineSimplification'],'baseLightPositions':{},'environmentLightPositions':[[35,5.4,11.3],[39,5.4,16.7]],'worker':C['worker']}
 meta['assets'][kind]=entry
 if kind!='environment':meta['baseLightPositions'][kind]=lamps
 path.write_text(json.dumps(meta,indent=2))
