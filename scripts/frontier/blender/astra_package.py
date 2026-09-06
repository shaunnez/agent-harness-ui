from pathlib import Path
import json,hashlib
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra'
Q=R/'qa';Q.mkdir(exist_ok=True)
entries=[]
for mode,stem,assetid in [('worker','worker-idle','mf.worker.standard.se.neutral'),('worker','worker-work-0','mf.worker.standard.se.working'),('tree','tree-idle','mf.prop.purple-tree'),('hq','hq-roof','mf.base.standard.roof')]:
 p=R/'renders'/f'{stem}.png'
 if not p.exists():continue
 meta=json.loads((R/f'{mode}-metadata.json').read_text());im=Image.open(p).convert('RGBA');bbox=im.getchannel('A').getbbox()
 entry={'id':assetid,'revision':1,'status':'cinematic-calibration-not-visually-qualified','file':str(p.relative_to(R)),'sourceSize':list(im.size),'logicalSize':[v/2 for v in im.size],'groundAnchor':meta['groundAnchorLogical'],'coordinateUnits':'logical-pixels-untrimmed','alphaBoundsSource':bbox,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'metadata':f'{mode}-metadata.json'}
 if stem=='worker-work-0':entry['animation']={'frames':meta['workFrames'],'frameDurationMs':250,'loop':True,'groundAnchorFixed':True,'note':'Upper arm and forearm joint transforms only; feet, torso and head unchanged. Three samples with repeated closing frame.'}
 entries.append(entry)
 sheet=Image.new('RGB',(im.width*3,im.height+28));d=ImageDraw.Draw(sheet)
 for i,col in enumerate([(24,31,39),(230,226,213),(210,0,130)]):
  bg=Image.new('RGBA',im.size,(*col,255));bg.alpha_composite(im);sheet.paste(bg,(im.width*i,28));d.text((im.width*i+8,8),str(col),fill='white')
 sheet.save(Q/f'{stem}-alpha.png')
(R/'calibration-entries.json').write_text(json.dumps(entries,indent=2)+'\n')
worker=Image.open(R/'renders/worker-idle.png').convert('RGBA');b=worker.getchannel('A').getbbox();frames=[]
for idx in [0,1,2]:
 im=Image.open(R/'renders'/f'worker-work-{idx}.png').convert('RGBA');sheet=Image.new('RGBA',(620,310),(24,31,39,255));d=ImageDraw.Draw(sheet)
 for x,h in [(35,58),(220,200)]:
  scale=h/(b[3]-b[1]);res=im.resize(tuple(round(v*scale) for v in im.size),Image.Resampling.LANCZOS);sheet.alpha_composite(res,(x,20));d.text((x,285),f'{h}px visible body height',fill='white')
 frames.append(sheet.convert('RGB'))
frames[0].save(Q/'worker-actual-scale.png');frames[0].save(Q/'worker-work-playback.gif',save_all=True,append_images=frames[1:],duration=250,loop=0)
files=[p for p in (R/'renders').glob('*.png')]+list((R/'blend').glob('*.blend'))
(R/'checksums.json').write_text(json.dumps({str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},indent=2)+'\n')
sheet=Image.new('RGBA',(1100,620),(30,42,49,255));d=ImageDraw.Draw(sheet)
for x,name in [(15,'hq-open-proof'),(565,'hq-closed-proof')]:
 im=Image.open(R/'renders'/f'{name}.png').convert('RGBA');im=im.resize((int(im.width*.33),int(im.height*.33)),Image.Resampling.LANCZOS);sheet.alpha_composite(im,(x,50));d.text((x,22),name+' source x0.33',fill='white')
for x,h,name in [(55,120,'tree-idle'),(240,58,'worker-idle'),(750,58,'worker-work-0')]:
 im=Image.open(R/'renders'/f'{name}.png').convert('RGBA');b=im.getchannel('A').getbbox();im=im.crop(b);im=im.resize((round(im.width*h/im.height),h),Image.Resampling.LANCZOS);sheet.alpha_composite(im,(x,510-h));d.text((x,540),name,fill='white')
sheet.convert('RGB').save(Q/'calibration-kit-scale.png')
