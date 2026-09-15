"""Loss-aware packaging: retain alpha PNGs, JPEG-quality95 opaque PBR images.
No geometry/accessor values or material factors are changed. Requires Pillow.
"""
from pathlib import Path
import io,json,struct,hashlib
from PIL import Image
R=Path(__file__).resolve().parents[1]
def package(path):
 raw=path.read_bytes();jl=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+jl]);binary=raw[28+jl:];images={im['bufferView']:im for im in doc.get('images',[])};out=bytearray();savings=[]
 for idx,bv in enumerate(doc['bufferViews']):
  data=binary[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']]
  if idx in images:
   im=Image.open(io.BytesIO(data));alpha=im.getchannel('A').getextrema()[0]<255 if 'A' in im.getbands() else False
   if not alpha:
    bb=io.BytesIO();im.convert('RGB').save(bb,format='JPEG',quality=95,subsampling=0,optimize=True);encoded=bb.getvalue()
    if len(encoded)<len(data):savings.append({'image':images[idx].get('name',idx),'before':len(data),'after':len(encoded)});data=encoded;images[idx]['mimeType']='image/jpeg'
  out.extend(b'\0'*((-len(out))%4));bv['byteOffset']=len(out);bv['byteLength']=len(data);out.extend(data)
 out.extend(b'\0'*((-len(out))%4));doc['buffers'][0]['byteLength']=len(out);j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(out))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(out),b'BIN\0')+out)
 return {'file':path.name,'before':len(raw),'after':path.stat().st_size,'imagesReencoded':savings,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
report=R/'packaging-report.json'
prior={x['file']:x for x in json.loads(report.read_text())} if report.exists() else {}
results=[]
for path in sorted(R.glob('*.glb')):
 previous=prior.get(path.name);digest=hashlib.sha256(path.read_bytes()).hexdigest()
 results.append(previous if previous and previous['sha256']==digest else package(path))
report.write_text(json.dumps(results,indent=2));print([{k:v for k,v in x.items() if k!='imagesReencoded'} for x in results])
