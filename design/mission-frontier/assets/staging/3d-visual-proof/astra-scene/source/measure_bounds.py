"""Measure evaluated scene geometry in the delivered glTF coordinate convention."""
import bpy,json
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[1];bpy.ops.wm.open_mainfile(filepath=str(R/'scene.blend'));deps=bpy.context.evaluated_depsgraph_get()
def bounds(groups):
 points=[]
 for group in groups:
  for o in bpy.data.objects[group].children_recursive:
   if o.type!='MESH':continue
   e=o.evaluated_get(deps);me=e.to_mesh()
   for v in me.vertices:
    p=e.matrix_world@v.co;points.append((p.x,p.z,-p.y))
   e.to_mesh_clear()
 lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
 return {'min':lo,'max':hi,'size':[hi[i]-lo[i] for i in range(3)]}
d={'coordinates':'glTF X/right, Y/up, Z/front; metres','building':bounds(['MF_BaseFixed','MF_Roof','MF_ShellCutaway','MF_Interior']),'terrainIncludingLanding':bounds(['MF_Terrain']),'court':bounds(['MF_Court']),'bridge':bounds(['MF_Bridge'])};(R/'measured-bounds.json').write_text(json.dumps(d,indent=2));print(json.dumps(d,indent=2))
