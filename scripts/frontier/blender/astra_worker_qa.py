from pathlib import Path
from PIL import Image,ImageDraw
import json,hashlib,math
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra/production';Q=R/'qa';Q.mkdir(exist_ok=True)
meta=json.loads((R/'worker-metadata.json').read_text());files=sorted((R/'renders').glob('worker-work-*.png'));images=[Image.open(p).convert('RGBA') for p in files];hashes={str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (R/'renders').glob('*.png')};b=images[0].getchannel('A').getbbox();tip0=meta['workFrames'][0]['probeTipSource'];distances=[math.dist(tip0,f['probeTipSource']) for f in meta['workFrames']];checks={'frameCount':len(images),'uniqueFrameHashes':len({hashes[str(p.relative_to(R))] for p in files}),'uniqueProbeCoordinates':len({tuple(f['probeTipSource']) for f in meta['workFrames']}),'maxProbeDistanceFromFrame0SourcePx':max(distances),'maxProbeDistanceLogicalPx':max(distances)/2,'alphaFootRows300to383Identical':all(im.getchannel('A').crop((0,300,384,384)).tobytes()==images[0].getchannel('A').crop((0,300,384,384)).tobytes() for im in images),'allAnchorsExact':all(f['groundAnchorSource']==[192,334] for f in meta['workFrames']),'samples':meta['samples'],'sourceSizesCorrect':all(im.size==(384,384) for im in images),'visibleBoundsSource':b,'status':'requires-coordinator-in-app-review'}
assert checks['frameCount']==checks['uniqueFrameHashes']==checks['uniqueProbeCoordinates']==12
assert checks['allAnchorsExact'] and checks['sourceSizesCorrect'] and checks['alphaFootRows300to383Identical']
assert checks['maxProbeDistanceFromFrame0SourcePx']<8
frames=[]
for i,im in enumerate(images):
 canvas=Image.new('RGBA',(630,300),(24,31,39,255));d=ImageDraw.Draw(canvas)
 for x,h in [(20,58),(230,200)]:
  k=h/(b[3]-b[1]);res=im.resize(tuple(round(v*k) for v in im.size),Image.Resampling.LANCZOS);canvas.alpha_composite(res,(x,0));d.text((x,275),f'{h}px body / frame {i:02d}',fill='white')
 frames.append(canvas.convert('RGB'))
frames[0].save(Q/'actual-scale.png');frames[0].save(Q/'work-playback.gif',save_all=True,append_images=frames[1:],duration=100,loop=0)
sheet=Image.new('RGBA',(1152,440),(24,31,39,255));d=ImageDraw.Draw(sheet)
for i,im in enumerate(images):
 x=(i%6)*192;y=(i//6)*220;sheet.alpha_composite(im.resize((192,192),Image.Resampling.LANCZOS),(x,y));d.text((x+8,y+195),f'Frame {i:02d}',fill='white')
sheet.convert('RGB').save(Q/'twelve-frames.png')
for name in ['worker-idle','worker-work-00','worker-portrait']:
 im=Image.open(R/'renders'/f'{name}.png').convert('RGBA');canvas=Image.new('RGB',(1152,384))
 for i,col in enumerate([(24,31,39),(235,229,216),(220,0,135)]):
  bg=Image.new('RGBA',(384,384),(*col,255));bg.alpha_composite(im);canvas.paste(bg,(384*i,0))
 canvas.save(Q/f'{name}-alpha.png')
entries=[]
for suffix,name in [('se.neutral','worker-idle'),('se.working','worker-work-00'),('portrait','worker-portrait')]:
 entry={'id':'mf.worker.standard.'+suffix,'revision':1,'status':'production-pending-coordinator-review','file':f'renders/{name}.png','sourceSize':[384,384],'logicalSize':[192,192],'groundAnchor':[96,167] if suffix!='portrait' else [96,96],'sha256':hashes[f'renders/{name}.png'],'metadata':'worker-metadata.json'}
 if suffix=='se.working':entry['frames']=meta['workFrames'];entry['frameDurationMs']=100;entry['loop']=True
 entries.append(entry)
(R/'entries.json').write_text(json.dumps(entries,indent=2)+'\n');(R/'checksums.json').write_text(json.dumps(hashes,indent=2)+'\n');(Q/'checks.json').write_text(json.dumps(checks,indent=2)+'\n');print(json.dumps(checks,indent=2))
