import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra/vegetation-production'
bpy.ops.wm.open_mainfile(filepath=str(R/'blend/spreading-grove.blend'));S=bpy.context.scene
for o in bpy.data.objects:
 if o.type=='MESH':o.visible_camera=False
S.render.resolution_x=1536;S.render.resolution_y=768;S.camera.data.ortho_scale=19
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.025));catcher=bpy.context.object;catcher.is_shadow_catcher=True;catcher.name='shadow receiver';S.render.filepath=str(R/'renders/spreading-grove-shadow-wide.png');bpy.ops.render.render(write_still=True)
