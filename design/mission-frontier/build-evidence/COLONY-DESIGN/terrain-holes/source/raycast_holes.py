import bpy, json, sys
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:]
manifest=json.load(open(args[0])); out=args[1]
loops=manifest['shorelineXZ']  # glTF (x,z); blender (x, y=-z)
def inside(x,y,loop):
    ins=False
    for i in range(len(loop)):
        ax,az=loop[i]; bx,bz=loop[(i+1)%len(loop)]
        ay,by=-az,-bz
        if (ay>y)!=(by>y) and x < (bx-ax)*(y-ay)/(by-ay)+ax: ins=not ins
    return ins
dg=bpy.context.evaluated_depsgraph_get()
scene=bpy.context.scene
# hide planting & bridge so we only test terrain
for o in bpy.data.objects:
    if o.type=='MESH' and not any(k in o.name for k in ("terrace","cliff","formation","geology","landing_rock","landing_solid","rock_mass")):
        o.hide_set(True); o.hide_render=True; o.hide_viewport=True
dg.update()
step=0.5
xs=[i*step for i in range(int(-38/step),int(43/step)+1)]
ys=[i*step for i in range(int(-34/step),int(31/step)+1)]
misses=[];backfaces=[];hits=0;inland=0;lowhits=[]
for x in xs:
  for y in ys:
    if not any(inside(x,y,l) for l in loops): continue
    inland+=1
    ok,loc,nrm,idx,obj,mat=scene.ray_cast(dg,Vector((x,y,60)),Vector((0,0,-1)))
    if not ok: misses.append([x,y]); continue
    hits+=1
    if nrm.z<0: backfaces.append([x,y,round(loc.z,2),obj.name])
    if loc.z<0.05: lowhits.append([x,y,round(loc.z,2),obj.name])
res={"step":step,"inlandCells":inland,"hits":hits,"misses":len(misses),"missCells":misses,"backfaceHits":len(backfaces),"backfaceSamples":backfaces[:40],"belowSeaHits":len(lowhits),"belowSeaSamples":lowhits[:40]}
# also: first-hit object histogram
json.dump(res,open(out,'w'),indent=1)
print("inland",inland,"hits",hits,"misses",len(misses),"backface",len(backfaces),"belowSea",len(lowhits))
