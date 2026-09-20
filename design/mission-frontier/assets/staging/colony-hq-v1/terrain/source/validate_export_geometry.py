"""Ray-cast actual exported geometry after a fresh Blender glTF import."""
import ast, json
from pathlib import Path
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
# Share the documented 0.5 m ray grid and closed-solid invariants without running the producer.
module=ast.parse((ROOT/'source/build_terrain.py').read_text())
selected=ast.Module(body=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name in ['xyz','validate']],type_ignores=[])
exec(compile(selected,'build_terrain.py','exec'))
metadata=json.loads((ROOT/'parcel-metadata.json').read_text());reports={}
for filename,entry in metadata['files'].items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/filename))
    obj=next(o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('parcel_closed_manifold_core'))
    # glTF splits vertices at UV/material seams; weld these coincident exported vertices before topology check.
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0001);bm.to_mesh(obj.data);bm.free()
    reports[filename]=validate(obj,entry['shorelineXZ'][0])
(ROOT/'export-raycast-validation.json').write_text(json.dumps(reports,indent=2)+'\n')
print('EXPORTED_RAYCAST_VALIDATION',json.dumps(reports))
