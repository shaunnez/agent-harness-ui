import bpy,json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[1];bpy.ops.wm.open_mainfile(filepath=str(R/'blend/coastal-detailed.blend'));S=bpy.context.scene
images=[{'name':im.name,'packed':bool(im.packed_file),'filepath':im.filepath} for im in bpy.data.images if im.source=='FILE'];assert all(i['packed'] for i in images),images
normals={}
for ob in S.objects:
 if 'undulating upper surface' in ob.name:
  bad=sum(p.normal.z<=0 for p in ob.data.polygons);normals[ob.name]={'faces':len(ob.data.polygons),'downwardFaces':bad};assert bad==0,(ob.name,bad)
fixtures=[]
for ob in S.objects:
 if any(n in ob.name for n in ['fixed apron electrical pedestal','fixed apron protective bollard','low apron corner kerb']):
  points=[ob.matrix_world@Vector(p) for p in ob.bound_box];uv=[(32*(p.y-p.x),16*(p.x+p.y)) for p in points];b=[min(p[0] for p in uv),min(p[1] for p in uv),max(p[0] for p in uv),max(p[1] for p in uv)];overlap=b[2]>-110 and b[0]<54 and b[3]>12 and b[1]<84;assert not overlap,(ob.name,b);fixtures.append({'name':ob.name,'groundFootprintLogical':b,'overlapsPatrolZone':False})
def P(p):
 q=world_to_camera_view(S,S.camera,Vector(p));return [q.x*1280,(1-q.y)*960]
o=P((0,0,0));basis={k:[P(v)[i]-o[i] for i in range(2)] for k,v in [('x',(1,0,0)),('y',(0,1,0)),('z',(0,0,1))]}
report={'packedExternalImages':images,'terrainNormals':normals,'staticCourtFixtures':fixtures,'projectedOriginLogical':o,'projectedBasisLogical':basis,'areaLights':[{'name':ob.name,'location':list(ob.location),'rotationEuler':list(ob.rotation_euler),'energy':ob.data.energy,'color':list(ob.data.color),'size':ob.data.size} for ob in S.objects if ob.type=='LIGHT' and ob.data.type=='AREA'],'standaloneExportInput':'blend/coastal-detailed.blend; all textures packed; export_layers.py reads no acquisition inputs'}
(R/'qa/blend-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
