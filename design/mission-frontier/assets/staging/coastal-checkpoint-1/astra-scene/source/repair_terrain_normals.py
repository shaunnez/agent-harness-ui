"""Historical bounded correction: orient radial terrain fan/ring faces consistently upward."""
import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parents[1];bpy.ops.wm.open_mainfile(filepath=str(R/'blend/coastal-detailed.blend'));S=bpy.context.scene;fixed={}
for ob in S.objects:
 if 'undulating upper surface' in ob.name:
  bad=[p for p in ob.data.polygons if p.normal.z<0]
  for p in bad:p.flip()
  ob.data.update();fixed[ob.name]=len(bad)
S.cycles.samples=32;S.render.threads_mode='FIXED';S.render.threads=4;bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend/coastal-detailed.blend'))
(R/'qa/terrain-normal-correction.json').write_text(json.dumps({'flippedFaces':fixed,'geometryPositionsChanged':False,'sourceBuildCorrected':True},indent=2)+'\n')
S.render.filepath=str(R/'renders/detailed-assembled.png');bpy.ops.render.render(write_still=True)
import runpy
runpy.run_path(str(R/'source/export_layers.py'),run_name='__main__')
