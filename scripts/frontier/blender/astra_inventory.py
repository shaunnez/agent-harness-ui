import bpy,json
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra';bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);out=[]
paths=[next((R/'sources/modular-sci-fi-megakit').rglob('WallAstra_Straight.gltf')),next((R/'sources/modular-sci-fi-megakit').rglob('Prop_Vent_Wide.gltf')),R/'sources/stylized-nature-megakit/glTF/CommonTree_1.gltf',R/'sources/stylized-nature-megakit/glTF/Bush_Common.gltf']
for p in paths:
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(p));obs=[o for o in bpy.data.objects if o not in before and o.type=='MESH'];out.append({'path':str(p),'objects':[{'name':o.name,'dimensions':list(o.dimensions),'materials':[m.name if m else None for m in o.data.materials]} for o in obs]})
 for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
(R/'sources/mesh-inventory.json').write_text(json.dumps(out,indent=2))
