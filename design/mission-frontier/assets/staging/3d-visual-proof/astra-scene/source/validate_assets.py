"""Structural/portable-data audit. It does not establish artistic/browser acceptance."""
import json,struct,hashlib,io
from pathlib import Path
from PIL import Image
R=Path(__file__).resolve().parents[1]
def read(name):
 p=R/name;b=p.read_bytes();magic,version,size=struct.unpack_from('<4sII',b);assert magic==b'glTF' and version==2 and size==len(b);jl=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+jl]);bn=b[28+jl:];assert len(bn)>=d['buffers'][0]['byteLength']
 for v in d['bufferViews']:assert v.get('byteOffset',0)+v['byteLength']<=len(bn)
 for im in d.get('images',[]):
  assert 'uri' not in im;v=d['bufferViews'][im['bufferView']];Image.open(io.BytesIO(bn[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).verify()
 return d,{'file':name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'meshCount':len(d.get('meshes',[])),'materialCount':len(d.get('materials',[])),'embeddedImages':len(d.get('images',[])),'triangles':sum(d['accessors'][p['indices']]['count']//3 for m in d.get('meshes',[]) for p in m['primitives'])}
s,ss=read('scene.glb');w,ww=read('worker.glb');m=json.loads((R/'scene-metadata.json').read_text());names={n['name'] for n in s['nodes'] if 'name' in n}
for g in ['MF_Terrain','MF_BaseFixed','MF_Roof','MF_ShellCutaway','MF_Interior','MF_Court','MF_Bridge','MF_Props','MF_Planting','MF_Practicals']:assert g in names
assert len(s['cameras'])==2;assert all('socket_'+n in names for n in m['sockets']);assert all(m['bounds']['min'][i]<m['bounds']['max'][i] for i in range(3));assert len(m['shorelineXZ'])==2 and all(len(loop)>=3 for loop in m['shorelineXZ']);assert len(m['practicalLightPositions'])<=12
assert all(loop[0]==loop[-1] for loop in m['shorelineXZ'])
assert max(m['shorelineSimplification']['maxDeviationMetres'])<=.15
assert {x['name'] for x in s['materials']}=={x['name'] for x in m['materials']}
assert [a['name'] for a in w['animations']]==['worker_tool_work'];assert len(w['animations'][0]['channels'])==32
assert any('normalTexture' in mt for mt in s['materials']);assert any(mt.get('alphaMode')=='MASK' for mt in s['materials']);assert any('COLOR_0' in p['attributes'] for me in s['meshes'] for p in me['primitives'])
result={'status':'pass','scope':'GLB headers/buffers/images, groups/cameras/sockets, metadata bounds/shore loops, PBR normals, retained vertex color/alpha, original worker animation','scene':ss,'worker':ww,'browserAcceptance':'Builder-owned; not established by this structural audit'}
(R/'validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
