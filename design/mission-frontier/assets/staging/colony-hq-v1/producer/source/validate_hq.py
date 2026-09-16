"""Validate exported GLBs independently by re-importing into Blender; exits nonzero on defect."""
import bpy,sys,json,hashlib,math,struct
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from hq_lib import R,C,CONTRACT_PATH,gl

checks=[]
def require(condition, detail):
    if not condition:raise AssertionError(detail)
    checks.append(detail)

def bounds(objects):
    p=[gl(o.matrix_world@v.co) for o in objects if o.type=='MESH' for v in o.data.vertices]
    return [min(x[i] for x in p) for i in range(3)],[max(x[i] for x in p) for i in range(3)]

meta=json.loads((R/'hq-metadata.json').read_text())
require(meta['contractSha256']==hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest(),'metadata binds current frozen contract SHA256')
for name,a in meta['assets'].items():
    path=R/a['file'];raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n])
    require(hashlib.sha256(raw).hexdigest()==a['glb']['sha256'],name+': hash matches export')
    budget=C['budgets']['hqShell' if name=='hq-shell' else 'crown' if name.startswith('crown') else 'bridgeSpan']
    tris=sum(d['accessors'][p['indices']]['count']//3 for mesh in d.get('meshes',[]) for p in mesh['primitives'])
    require(len(raw)<=budget['bytes'] and tris<=budget['triangles'],name+': byte and triangle budgets')
    require(all('uri' not in x for x in d.get('images',[])),name+': all textures embedded')
    require(len(d.get('images',[]))<=8,name+': texture count <=8')
    require(all('uri' not in x for x in d.get('buffers',[])),name+': portable internal buffers')
    for m in d.get('materials',[]):
        if m['name'].startswith('identity_'):
            c=m.get('pbrMetallicRoughness',{}).get('baseColorFactor',[1,1,1,1])
            require(max(c[:3])-min(c[:3])<.001,name+': neutral '+m['name'])
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(path));bpy.context.view_layer.update()
    for root in a['rootGroups']:require(bpy.data.objects.get(root) is not None,name+': root '+root)
    for im in bpy.data.images:
        require(max(im.size)<=2048,name+': image dimensions '+im.name)
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];lo,hi=bounds(meshes)
    for i in range(3):
        require(abs(lo[i]-a['bounds']['min'][i])<.005 and abs(hi[i]-a['bounds']['max'][i])<.005,name+': measured bounds axis '+str(i))
    if name=='hq-shell':
        for room in C['hq']['rooms']:require(bpy.data.objects.get('MF_Interior_'+room) is not None,'room child '+room)
        sockets=[s for r in C['hq']['rooms'].values() for s in r['sockets']]+C['hq']['hubOverflowSockets']+C['hq']['courtSockets']
        require(len(sockets)==53,'frozen contract has 53 worker sockets')
        for s in sockets:
            o=bpy.data.objects.get(s['id']);require(o is not None,'export socket '+s['id'])
            p=gl(o.matrix_world.translation);expected=(s['xz'][0],s['y'],s['xz'][1])
            require(max(abs(p[i]-expected[i]) for i in range(3))<=.05,'socket coordinates '+s['id'])
        for name2 in ['MF_ShellCutaway_FrontFlats','MF_ShellCutaway_PartitionGlass']:
            o=bpy.data.objects.get(name2);require(o and o.parent.name=='MF_ShellCutaway','cutaway ownership '+name2)
    elif name=='crown-command':
        require(lo[1]>=C['levels']['hqCeilingClear']-.01 and hi[1]<=18.5,'crown sits over shell within height envelope')
        for o in meshes:
            for v in o.data.vertices:
                x,y,z=gl(o.matrix_world@v.co)
                require(all(x*math.cos(math.radians(phi))+z*math.sin(math.radians(phi))<=C['hq']['footprint']['apothem']+1.5+.02 for phi in [30,90,150,210,270,330]),'crown vertex within hex eaves')
        checks=[x for x in checks if x!='crown vertex within hex eaves']+['all crown vertices within hex +1.5m eaves']
    elif name=='bridge-span-27':
        require(abs(lo[0])<.01 and abs(hi[0]-27)<.01,'bridge exact 27m root-to-root envelope')
        require(abs(lo[1]+3)<.01 and abs(hi[1]-5.35)<.01,'bridge seabed foundation and rail top')
    elif name=='bridge-end':require(abs(lo[1]+3)<.01 and abs(hi[0]-4)<.01,'end foundation -3m and outward face X4')
report={'passed':True,'contractVersion':C['version'],'assets':list(meta['assets']),'checks':checks,'checkCount':len(checks)}
(R/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print('PASS:',len(checks),'independent GLB checks')
