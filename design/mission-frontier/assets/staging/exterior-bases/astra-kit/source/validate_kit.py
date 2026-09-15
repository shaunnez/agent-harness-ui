"""Portable GLB contract audit; independent of browser artistic acceptance."""
import json,struct,hashlib,io,sys
from pathlib import Path
from PIL import Image
R=Path(__file__).resolve().parents[1];C=json.loads((R.parent/'contract.json').read_text())
def read(path):
 b=path.read_bytes();magic,ver,size=struct.unpack_from('<4sII',b);assert (magic,ver,size)==(b'glTF',2,len(b));n=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+n]);binary=b[28+n:]
 for v in d['bufferViews']:assert v.get('byteOffset',0)+v['byteLength']<=len(binary)
 for im in d.get('images',[]):
  assert 'uri' not in im;v=d['bufferViews'][im['bufferView']];Image.open(io.BytesIO(binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).verify()
 return d,{'file':path.name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'meshes':len(d['meshes']),'materials':len(d['materials']),'images':len(d.get('images',[])),'triangles':sum(d['accessors'][p['indices']]['count']//3 for m in d['meshes'] for p in m['primitives'])}
def audit(root):
 meta=json.loads((root/'kit-metadata.json').read_text());results={};signatures={}
 for kind in ['environment','command','relay','foundry']:
  name='environment' if kind=='environment' else 'base-'+kind;d,stats=read(root/(name+'.glb'));nodes={n.get('name'):n for n in d['nodes']};mats={m['name'] for m in d['materials']};groups=C['environmentGroups'] if kind=='environment' else C['baseGroups'];assert {n for n in nodes if n and n.startswith('MF_') and '__' not in n}==set(groups);assert mats==set(meta['assets'][kind]['materials']);assert len(d['cameras'])==2;assert 'animations' not in d
  if kind!='environment':
   assert set(C['roofColorMaterials'])<=mats;assert any(n.startswith('ambient_screen_') for n in mats);assert any(n.startswith('ambient_sensor_') for n in mats)
   for n,p in C['sockets'].items():assert all(abs(a-b)<1e-4 for a,b in zip(nodes['socket_'+n].get('translation',[0,0,0]),p))
   bb=meta['assets'][kind]['buildingBounds'];assert bb['size'][0]<=31 and bb['size'][2]<=25 and bb['max'][1]<=18.2
   signatures[kind]=stats['triangles'];assert all(nodes[g].get('children') for g in groups)
  else:assert not any(n and n.startswith('socket_') for n in nodes)
  results[kind]=stats
 assert len(set(signatures.values()))==3;assert meta['sockets']==C['sockets'];assert meta['walkableRoutes']==C['walkableRoutes'];assert all(x[0]==x[-1] for x in meta['shorelineXZ'])
 return {'status':'pass','checks':'Embedded GLB buffers/images; exact groups/material inventories; seven common sockets; three distinct geometry counts; building size/height; cameras; closed shore; no animation/actors','assets':results,'browserAcceptance':'Builder owned'}
result=audit(R);(R/'validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
if (R/'export-check/environment.glb').exists():
 other=audit(R/'export-check');checks={k:all(result['assets'][k][p]==other['assets'][k][p] for p in ['meshes','materials','images','triangles']) for k in result['assets']};assert all(checks.values());(R/'independent-export-check.json').write_text(json.dumps({'status':'pass','checks':checks,'delivered':result['assets'],'independentlyExported':other['assets'],'note':'Reopened saved editable blends and independently exported. Geometry/material/image counts match; byte identity is reported separately by hashes.'},indent=2))
