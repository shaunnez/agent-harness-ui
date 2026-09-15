"""Check preserved environment geometry and measured enlarged cargo contact in saved sources."""
import bpy,json,hashlib,struct
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[1];BASE=R.parents[1]/'3d-visual-proof/astra-scene'
def environment_signature(path,baseline=False):
 bpy.ops.wm.open_mainfile(filepath=str(path));dg=bpy.context.evaluated_depsgraph_get();rows={}
 for o in bpy.context.scene.objects:
  if o.type!='MESH' or not o.parent:continue
  keep=o.parent.name in ['MF_Terrain','MF_Bridge','MF_Planting'] or (baseline and o.parent.name in ['MF_Props','MF_Practicals'] and o.location.x>30)
  if not keep:continue
  ev=o.evaluated_get(dg);me=ev.to_mesh();h=hashlib.sha256()
  for v in me.vertices:h.update(struct.pack('<3f',*(o.matrix_world@v.co)))
  for p in me.polygons:h.update(struct.pack('<I',len(p.vertices)));h.update(struct.pack('<'+'I'*len(p.vertices),*p.vertices))
  rows[o.name]=h.hexdigest();ev.to_mesh_clear()
 return rows
source=environment_signature(BASE/'scene.blend',True);derived=environment_signature(R/'environment.blend');assert source==derived
bpy.ops.wm.open_mainfile(filepath=str(R/'base-command.blend'))
def bbox(objects):
 p=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box];lo=[min(v[i] for v in p) for i in range(3)];hi=[max(v[i] for v in p) for i in range(3)];return lo,hi
cargo=[]
for x,z in [(-11,15),(10.5,17.6),(-14,-5)]:
 objects=[o for o in bpy.context.scene.objects if o.name.startswith(('cargo_crate','cargo_retaining_band','cargo_lid')) and abs(o.location.x-x)<1.2 and abs(-o.location.y-z)<1.2];lo,hi=bbox(objects);height=hi[2]-lo[2];assert abs(height-2)<.001;cargo.append({'centerXZ':[x,z],'groundY':lo[2],'height':height,'boundsBlender':{'min':lo,'max':hi}})
cart=[o for o in bpy.context.scene.objects if o.name.startswith(('service_cart','cart_'))];lo,hi=bbox(cart);gap=cargo[1]['boundsBlender']['min'][0]-hi[0];assert gap>.5
result={'status':'pass','preservedEnvironmentComponents':len(source),'environmentEvaluatedGeometryIdenticalToAcceptedSource':True,'cargo':cargo,'cartCrateHorizontalClearance':gap,'cartBoundsBlender':{'min':lo,'max':hi},'baselineBlendSha256':hashlib.sha256((BASE/'scene.blend').read_bytes()).hexdigest()};(R/'authoring-audit.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
