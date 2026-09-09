import bpy,json
from pathlib import Path
p=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra/exterior-calibration';bpy.ops.wm.open_mainfile(filepath=str(p/'blend/exterior.blend'))
for o in bpy.data.objects:
 if o.type=='MESH' and len(o.data.materials)>2:
  scores={}
  for face in o.data.polygons:
   mat=o.data.materials[face.material_index];key=mat.name;scores[key]=scores.get(key,0)+face.area*face.normal.x
  print(o.name,list(o.location),list(o.rotation_euler),scores)
