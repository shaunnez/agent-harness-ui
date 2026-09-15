import urllib.request,json,concurrent.futures,hashlib
from pathlib import Path
R=Path(__file__).resolve().parents[1]/'sources/polyhaven';R.mkdir(parents=True,exist_ok=True)
def get(url):return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'MissionFrontier/1.0'})).read()
items=[]
for name in ['coastal_cliff_01','coastal_cliff_02','coast_land_rocks_01','seaside_rock']:
 d=json.loads(get('https://api.polyhaven.com/files/'+name));(R/(name+'-files.json')).write_text(json.dumps(d,indent=2))
 if name.startswith('coastal_cliff_'):
  f=d['gltf']['2k']['gltf'];items.append((R/name/(name+'.gltf'),f['url']))
  for rel,o in f['include'].items():items.append((R/name/rel,o['url']))
 else:
  for role in ['Diffuse','nor_gl','Rough','Displacement']:
   f=d[role]['2k'].get('jpg') or d[role]['2k'].get('png');items.append((R/name/(role+Path(f['url']).suffix),f['url']))
def fetch(it):
 p,u=it;p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():p.write_bytes(get(u))
 return {'file':str(p.relative_to(R)),'url':u,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:results=list(ex.map(fetch,items))
(R/'provenance.json').write_text(json.dumps({'license':'CC0','licenseURL':'https://polyhaven.com/license','assets':results},indent=2));print([(x['file'],x['bytes']) for x in results])
