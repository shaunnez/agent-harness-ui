import bpy, json, sys, collections
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:]
manifest=json.load(open(args[0])); out=args[1]
loops=manifest['shorelineXZ']
def inside(x,y):
    for loop in loops:
        ins=False
        for i in range(len(loop)):
            ax,az=loop[i]; bx,bz=loop[(i+1)%len(loop)]; ay,by=-az,-bz
            if (ay>y)!=(by>y) and x < (bx-ax)*(y-ay)/(by-ay)+ax: ins=not ins
        if ins: return True
    return False
for o in bpy.data.objects:
    if o.type=='MESH' and not any(k in o.name for k in ("terrace","cliff","formation","geology","landing_rock","landing_solid","rock_mass")):
        o.hide_set(True); o.hide_render=True; o.hide_viewport=True
dg=bpy.context.evaluated_depsgraph_get(); dg.update(); scene=bpy.context.scene
d=Vector((-51,68,-46)).normalized()
step=0.4
holes=[]; backfirst=[]; front=0; cells=0; rim_exit=0
x=-38.0
while x<=43.0:
    y=-34.0
    while y<=31.0:
        if inside(x,y):
            cells+=1
            target=Vector((x,y,4.0)); origin=target-d*200
            ok,loc,nrm,idx,obj,mat=scene.ray_cast(dg,origin,d)
            if not ok:
                # where does the ray cross sea level?
                t=(0.0-origin.z)/d.z; sea=origin+d*t
                if inside(sea.x,sea.y): holes.append([round(x,1),round(y,1),round(sea.x,1),round(sea.y,1)])
                else: rim_exit+=1
            elif nrm.dot(d)>0: backfirst.append([round(x,1),round(y,1),round(loc.z,2),obj.name])
            else: front+=1
        y+=step
    x+=step
res={"step":step,"cells":cells,"trueHoles_seaExitInsideShore":holes,"nTrueHoles":len(holes),"rimExitsToSea":rim_exit,
     "backfaceFirst":len(backfirst),"backfaceByObject":dict(collections.Counter(b[3] for b in backfirst)),"backfaceSamples":backfirst,"front":front}
json.dump(res,open(out,'w'))
print("cells",cells,"trueHoles",len(holes),"rimExits",rim_exit,"backfaceFirst",len(backfirst),"front",front)
