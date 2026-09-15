import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parents[1];bpy.ops.wm.open_mainfile(filepath=str(R/'scene.blend'));S=bpy.context.scene
exec((R/'source/geology_join.py').read_text())
bpy.ops.wm.save_as_mainfile(filepath=str(R/'scene.blend'));exec((R/'source/export_scene.py').read_text())
S.camera=bpy.data.objects['camera_exterior'];S.render.filepath=str(R/'previews/exterior.png');bpy.ops.render.render(write_still=True)
for g in ['MF_Roof','MF_ShellCutaway']:
 for o in bpy.data.objects[g].children:o.hide_render=True
S.camera=bpy.data.objects['camera_cutaway'];S.render.filepath=str(R/'previews/cutaway.png');bpy.ops.render.render(write_still=True)
