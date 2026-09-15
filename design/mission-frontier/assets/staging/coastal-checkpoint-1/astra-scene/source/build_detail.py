"""Detailed scene production from the historically preserved accepted blockout."""
import sys,json,hashlib,bpy
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[1];sys.path.insert(0,str(R/'source'))
import coastal_common as C
bpy.ops.wm.open_mainfile(filepath=str(R/'blend/coastal-blockout.blend'));S=bpy.context.scene;C.setup_materials()
import coastal_landscape as land
import coastal_architecture as architecture
print('Building detailed terrain',flush=True);vegetation=land.build()
print('Building detailed architecture',flush=True);architecture.build();roads=architecture.court_and_crossing()
# All old proxy plants, land, road and bridge geometry were replaced. Preserve the calibrated camera/light.
for ob in bpy.data.objects:
 if ob.get('asset_layer')=='lights':
  for slot in ob.material_slots:slot.material=C.M['amber']
S.cycles.samples=32;S.cycles.use_denoising=True;S.cycles.seed=915104;S.render.threads_mode='FIXED';S.render.threads=4;S.render.film_transparent=True
# Give the water datum a quiet diffuse base; final shallows/masks are separately registered outputs.
for ob in bpy.data.objects:
 if ob.get('asset_layer')=='water':
  for slot in ob.material_slots:slot.material=C.material('quiet ocean beauty datum',(.016,.13,.18),.15,.35)
bpy.context.view_layer.update()
def project(v):
 q=world_to_camera_view(S,S.camera,Vector(v));return [round(q.x*1280,6),round((1-q.y)*960,6)]
meta={'status':'detailed-assembled-preview-pending-builder-inspection','contractRevision':2,'sourceSize':[2560,1920],'logicalSize':[1280,960],'groundAnchorMeasured':project((0,0,0)),'sockets':{k:{'world':v,'logicalMeasured':project(v)} for k,v in roads['socketsWorld'].items()},'roads':roads,'vegetation':vegetation,'sourceSHA256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (R/'source').glob('coastal_*.py')},'blenderVersion':bpy.app.version_string,'layerObjectCounts':{k:sum(o.get('asset_layer')==k for o in bpy.data.objects) for k in ['terrain','base','bridge','front','lights']}}
# Save self-contained packed textures in the new source only; existing source libraries are never saved.
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend/coastal-detailed.blend'));(R/'qa/detail-calibration.json').write_text(json.dumps(meta,indent=2)+'\n')
S.render.filepath=str(R/'renders/detailed-assembled.png');bpy.ops.render.render(write_still=True)
