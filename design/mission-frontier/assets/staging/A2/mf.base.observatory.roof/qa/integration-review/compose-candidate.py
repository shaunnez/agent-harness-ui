from pathlib import Path
from PIL import Image,ImageDraw
import json,hashlib,numpy as np
R=Path(__file__).resolve().parent/'candidate';R.mkdir(exist_ok=True);repo=next(p for p in R.parents if (p/'src/frontier/world/scene.ts').exists());pub=repo/'public/frontier';mp=pub/'assets/manifest.json';m=json.loads(mp.read_text());E={x['id']:x for x in m['assets']};cache={}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pic(e):
 p=pub/e['file'].lstrip('/')
 if str(p) not in cache:cache[str(p)]=Image.open(p).convert('RGBA')
 return cache[str(p)]
def draw(canvas,id,x,y,s,cam,origin,entry=None):
 e=entry or E[id];im=pic(e);a=e.get('groundAnchor',e.get('anchor'));sz=[round(v*s*cam) for v in e['logicalSize']];pos=[round(origin[0]+(x-a[0]*s)*cam),round(origin[1]+(y-a[1]*s)*cam)];layer=Image.new('RGBA',canvas.size);layer.alpha_composite(im.resize(sz,Image.Resampling.LANCZOS),pos);canvas.alpha_composite(layer);return np.array(layer)[:,:,3]
def socket(id,name,s):
 e=E[id];return (np.array(e['sockets'][name])-e['groundAnchor'])*s
stages=[('Triage','intake'),('Repo scouts','survey'),('Grill','communications'),('Design','projection'),('Specification','blueprint'),('Planning','planning'),('Implement','fabrication'),('Dev Review','inspection'),('Test','diagnostics'),('Final Review','delivery-inspection'),('Human Approval','launchpad')]
records=[]
for mode in ['hq','detail']:
 for title,name in stages:
  cam=1.5 if mode=='hq' else 1.2;size=(760,540) if mode=='hq' else (1100,850);origin=(380,480) if mode=='hq' else (600,640);canvas=Image.new('RGBA',size,'#071923');bx,by,bs=(0,0,.6) if mode=='hq' else (-80,140,1.3)
  for id in ['floor','back']:draw(canvas,'mf.base.standard.'+id,bx,by,bs,cam,origin)
  x,y,s=(0,-70,.85) if mode=='hq' else (-10,-75,2.1);sx,sy=x+28*s,y-6*s;ss=.95*s;sid='mf.station.'+name
  if name=='launchpad' and mode=='detail':sx-=35*s;sy+=60*s
  draw(canvas,sid,sx,sy,ss,cam,origin)
  if name=='launchpad':
   dock=np.array([sx,sy])+socket(sid,'shuttleDock',ss);draw(canvas,'mf.vehicle.shuttle',*dock,ss*.7,cam,origin)
  contact=np.array([sx,sy])+socket(sid,'frontToolPort',ss);ws=.16 if mode=='hq' else .6;workerpos=contact-socket('mf.worker.standard.se.working','probeTip',ws)
  wm=np.zeros((size[1],size[0]),dtype=np.uint8)
  for part in E['mf.worker.standard.se.working']['parts']:
   wm=np.maximum(wm,draw(canvas,'mf.worker.standard.se.working',*workerpos,ws,cam,origin,entry=part))
  occluded=0
  if mode=='hq':
   front=draw(canvas,'mf.base.standard.front',bx,by,bs,cam,origin);occluded=int(((wm>200)&(front>200)).sum())
  d=ImageDraw.Draw(canvas);d.text((16,12),f'{title} / {name} / {mode} camera {cam} / active worker',fill='white');d.text((16,30),'Runtime anchors, scale and draw order; UI/selection omitted',fill='#a9bac7');canvas.convert('RGB').save(R/f'{mode}-{name}.png')
  records.append({'mode':mode,'stage':title,'asset':sid,'stationScale':ss,'workerScale':ws,'contactWorld':contact.tolist(),'workerAnchorWorld':workerpos.tolist(),'probeSocketErrorWorld':float(np.linalg.norm(workerpos+socket('mf.worker.standard.se.working','probeTip',ws)-contact)),'workerOpaquePixelsCoveredByFront':occluded,'workerOpaquePixels':int((wm>200).sum())})
 sheet=Image.new('RGB',(3*size[0],4*size[1]),'#071923')
 for i,(_,name) in enumerate(stages):sheet.paste(Image.open(R/f'{mode}-{name}.png'),((i%3)*size[0],(i//3)*size[1]))
 sheet.save(R/f'{mode}-all-stages.png')
# Exact roof layer registration using runtime files
c=Image.new('RGBA',(1800,800),'#071923')
for i,variant in enumerate(['standard','observatory']):
 for id in ['mf.base.standard.floor','mf.base.standard.back',f'mf.base.{variant}.roof','mf.base.standard.front']:draw(c,id,0,0,.55,1.5,(450+i*900,730))
 ImageDraw.Draw(c).text((20+i*900,15),variant+' / runtime layer order / .55 x camera1.5',fill='white')
c.convert('RGB').save(R/'roof-runtime-registration.png')
# Validate runtime export hashes and report memory budget without changing runtime
hashes=[]
for e in m['assets']:
 p=pub/e['file'].lstrip('/');hashes.append({'id':e['id'],'shaMatches':sha(p)==e.get('sha256'),'bytes':p.stat().st_size})
a2=[e for e in m['assets'] if '/A2/' in e.get('sourceDirectory','')]
report={'runtimeManifestSha256':sha(mp),'sceneSha256':sha(repo/'src/frontier/world/scene.ts'),'runtimeAssets':len(E),'a2Count':len(a2),'a2CompressedBytes':sum(e['bytes'] for e in a2),'a2DecodedBytes':sum(e['sourceSize'][0]*e['sourceSize'][1]*4 for e in a2),'hashChecks':hashes,'compositions':records,'limits':['Deterministic Pillow reconstruction of current sprite transforms, not a Pixi/browser screenshot.','Zero-angle worker pose only; in-app +/-4degree motion, attention effects, UI labels, actual camera fitting and event semantics remain to verify.','No new generated assets or runtime changes.']};(R/'review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['runtimeAssets','a2Count','a2CompressedBytes','a2DecodedBytes']}));print('occlusions',[(r['asset'],r['workerOpaquePixelsCoveredByFront']) for r in records if r['workerOpaquePixelsCoveredByFront']])
