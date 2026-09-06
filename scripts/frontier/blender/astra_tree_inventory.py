import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra';out=[]
for name in ['CommonTree_2','CommonTree_3','CommonTree_4','CommonTree_5','TwistedTree_2','TwistedTree_3','TwistedTree_4','TwistedTree_5']:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);bpy.ops.import_scene.gltf(filepath=str(R/'sources/stylized-nature-megakit/glTF'/f'{name}.gltf'));bpy.context.view_layer.update();obs=[o for o in bpy.context.selected_objects if o.type=='MESH'];out.append({'name':name,'dimensions':[list(o.dimensions) for o in obs]})
(R/'tree-variants.json').write_text(json.dumps(out,indent=2))
