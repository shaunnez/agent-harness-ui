from pathlib import Path
from PIL import Image,ImageDraw
import hashlib,json
R=Path(__file__).resolve().parents[1];Q=R/'qa';Q.mkdir(exist_ok=True)
report={}
for action in ['walk','scan','type']:
 paths=sorted((R/'renders').glob(f'worker-{action}-*.png'))
 if len(paths)!=8:continue
 sheet=Image.new('RGB',(192*4,220*2),'#182631'); d=ImageDraw.Draw(sheet);frames=[];rows=[]
 for i,p in enumerate(paths):
  im=Image.open(p);a=im.getchannel('A');bounds=a.getbbox();small=im.resize((192,192),Image.Resampling.LANCZOS)
  bg=Image.new('RGB',(192,192),'#182631');bg.paste(small,(0,0),small);frames.append(bg)
  sheet.paste(bg,((i%4)*192,(i//4)*220));d.text(((i%4)*192+8,(i//4)*220+194),f'{action} {i} / 150ms',fill='white')
  rows.append({'file':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'size':list(im.size),'mode':im.mode,'alphaBoundsSource':list(bounds),'alphaExtrema':list(a.getextrema()),'nonzeroEdgeAlpha':any(a.getpixel((x,y)) for x,y in [(0,j) for j in range(384)]+[(383,j) for j in range(384)]+[(j,0) for j in range(384)]+[(j,383) for j in range(384)])})
 sheet.save(Q/f'{action}-contact-192.png');frames[0].save(Q/f'{action}-actual-scale.gif',save_all=True,append_images=frames[1:],duration=150,loop=0)
 edge=Image.new('RGB',(576,192),'white')
 for j,c in enumerate(['#faf9f3','#0c1420','#ff00ff']):
  bg=Image.new('RGB',(192,192),c);im=Image.open(paths[0]).resize((192,192),Image.Resampling.LANCZOS);bg.paste(im,(0,0),im);edge.paste(bg,(j*192,0))
 edge.save(Q/f'{action}-alpha-backgrounds.png')
 report[action]={'frames':rows,'totalBytes':sum(r['bytes'] for r in rows),'distinctFrames':len(set(r['sha256'] for r in rows)),'clipping':any(r['nonzeroEdgeAlpha'] for r in rows),'decodedRgbaBytes':384*384*4*8}
(Q/'numeric-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:{a:b for a,b in v.items() if a!='frames'} for k,v in report.items()},indent=2))
meta=json.loads((R/'worker-motion-metadata.json').read_text())
for action,animation in meta['animations'].items():
 for frame,measurement in zip(animation['frames'],report[action]['frames']):frame.update(measurement)
 report[action]['anchorStable']=all(f['groundAnchorSource']==[192.0,334.0] for f in animation['frames'])
 if action=='walk':report[action]['supportFootGroundedEveryFrame']=all(abs(min(f['footHeightsWorld']))<.0001 for f in animation['frames'])
meta['files']=[{'file':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted((R/'blend').glob('*.blend'))]+[{'file':'source/original-worker-production.py','sha256':hashlib.sha256((R/'source/original-worker-production.py').read_bytes()).hexdigest()}]
meta['footprint']=None;meta['labelAnchor']=None;meta['occlusionClass']='entity';meta['qa']=report
meta['status']='measured-ready-for-builder-integration-review'
(R/'worker-motion-manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
(Q/'numeric-report.json').write_text(json.dumps(report,indent=2)+'\n')
