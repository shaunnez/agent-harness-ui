import bpy,json,hashlib
from pathlib import Path
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra';results={};records={}
for name in ['exterior-calibration','exterior-production']:
 bpy.ops.wm.open_mainfile(filepath=str(R/name/'blend/exterior.blend'));bpy.context.view_layer.update();h=hashlib.sha256();count=0;records[name]={}
 for o in sorted(bpy.data.objects,key=lambda o:o.name):
  if o.type!='MESH':continue
  record=[o.name,[[float(v) for v in row] for row in o.matrix_world],[[float(n) for n in v.co] for v in o.data.vertices],sorted([sorted(p.vertices) for p in o.data.polygons])];records[name][o.name]=record;h.update(json.dumps(record,separators=(',',':')).encode());count+=1
 results[name]={'meshCount':count,'geometrySha256':h.hexdigest()}
differences=[]
for key,record in records['exterior-calibration'].items():
 other=records['exterior-production'].get(key)
 if other!=record:
  if other is None:differences.append({'name':key,'missing':True});continue
  delta=max([abs(x-y) for a,b in zip(record[1]+record[2],other[1]+other[2]) for x,y in zip(a,b)],default=0)
  differences.append({'name':key,'maxDelta':delta,'topologyEqual':record[3]==other[3],'vertexCounts':[len(record[2]),len(other[2])]})
results['differences']=differences;results['equivalentWithin1e6']=all(d.get('maxDelta',999)<1e-6 and d.get('topologyEqual',False) and d['vertexCounts'][0]==d['vertexCounts'][1] for d in differences);(R/'exterior-production/geometry-check.json').write_text(json.dumps(results,indent=2)+'\n');print(results)
