"""Cheap transparent composition preview and measured rendered-geometry bounds."""
import bpy,json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[1];bpy.ops.wm.open_mainfile(filepath=str(R/'blend/coastal-blockout.blend'));S=bpy.context.scene
for ob in bpy.data.objects:
 if ob.get('asset_layer')=='water':ob.hide_render=True
S.cycles.samples=16;S.render.threads_mode='FIXED';S.render.threads=4;S.render.film_transparent=True
bounds={};dg=bpy.context.evaluated_depsgraph_get()
for layer in ['terrain','base','bridge','front','lights']:
 points=[]
 for ob in bpy.data.objects:
  if ob.get('asset_layer')!=layer or ob.type!='MESH':continue
  evaluated=ob.evaluated_get(dg);mesh=evaluated.to_mesh()
  for v in mesh.vertices:
   q=world_to_camera_view(S,S.camera,evaluated.matrix_world@v.co);points.append((q.x*1280-640,(1-q.y)*960-600))
  evaluated.to_mesh_clear()
 if points:bounds[layer]={'left':min(p[0] for p in points),'right':max(p[0] for p in points),'top':min(p[1] for p in points),'bottom':max(p[1] for p in points)}
meta=json.loads((R/'qa/blockout-calibration.json').read_text());meta['evaluatedGeometryBoundsRelativeLogical']=bounds;meta['boundsNotes']={'base':'Building and dish silhouette is compared against the proposed buildingZone. Any exceedance requires composition feedback before detail.','terrain':'Includes vegetation composition placeholders and lower shore ledges.'};(R/'qa/blockout-calibration.json').write_text(json.dumps(meta,indent=2)+'\n')
S.render.filepath=str(R/'renders/blockout-transparent.png');bpy.ops.render.render(write_still=True)
