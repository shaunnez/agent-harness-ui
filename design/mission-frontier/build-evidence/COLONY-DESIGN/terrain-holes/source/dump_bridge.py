import bpy, json, sys, bmesh
from mathutils import Vector
out = {}
def bb(o):
    pts=[o.matrix_world @ Vector(c) for c in o.bound_box]
    mn=[round(min(p[i] for p in pts),3) for i in range(3)]
    mx=[round(max(p[i] for p in pts),3) for i in range(3)]
    return {"min":mn,"max":mx,"size":[round(mx[i]-mn[i],3) for i in range(3)]}
objs=[]
for o in bpy.data.objects:
    if o.type!='MESH': continue
    coll=[c.name for c in o.users_collection]
    rec={"name":o.name,"collections":coll,"bounds_blender":bb(o),"location":[round(v,3) for v in o.matrix_world.translation],
         "material":[m.name for m in o.data.materials if m] ,"verts":len(o.data.vertices),"parent":o.parent.name if o.parent else None}
    # open boundary edges for terrain-ish meshes
    if any(k in o.name for k in ("terrace","cliff","formation","geology","landing_rock","landing_solid","rock_mass")):
        bm=bmesh.new(); bm.from_mesh(o.data)
        boundary=sum(1 for e in bm.edges if e.is_boundary)
        rec["boundary_edges"]=boundary; rec["edges"]=len(bm.edges)
        bm.free()
    objs.append(rec)
out["objects"]=objs
out["collections"]=[c.name for c in bpy.data.collections]
out["units"]={"system":bpy.context.scene.unit_settings.system,"scale":bpy.context.scene.unit_settings.scale_length}
json.dump(out,open(sys.argv[-1],'w'),indent=1)
print("dumped",len(objs))
