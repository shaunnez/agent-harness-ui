from pathlib import Path
from PIL import Image,ImageDraw
import json,hashlib
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra/vegetation-calibration';Q=R/'qa';Q.mkdir(exist_ok=True);p=R/'renders/spreading-grove.png';im=Image.open(p).convert('RGBA');b=im.getchannel('A').getbbox();meta=json.loads((R/'entry.json').read_text());meta.update({'file':'renders/spreading-grove.png','alphaBoundsSource':list(b),'visibleSizeLogical':[(b[2]-b[0])/2,(b[3]-b[1])/2],'sha256':hashlib.sha256(p.read_bytes()).hexdigest()});(R/'entry.json').write_text(json.dumps(meta,indent=2)+'\n')
sheet=Image.new('RGBA',(1250,560),(32,44,48,255));d=ImageDraw.Draw(sheet)
for x,scale in [(20,.175),(225,.275),(500,.4)]:
 scaled=im.resize((round(768*scale),round(768*scale)),Image.Resampling.LANCZOS);sheet.alpha_composite(scaled,(x,75));d.text((x,405),f'World scale {scale*2:g} / {round((b[2]-b[0])*scale)}px visible width',fill='white')
old=Image.open(R.parent/'renders/tree-idle.png').convert('RGBA').resize((270,270),Image.Resampling.LANCZOS);sheet.alpha_composite(old,(920,70));d.text((930,405),'Earlier upright calibration',fill='white');sheet.convert('RGB').save(Q/'actual-scale.png')
alpha=Image.new('RGB',(1536,512))
for i,col in enumerate([(25,32,40),(230,224,213),(220,0,130)]):
 bg=Image.new('RGBA',(512,512),(*col,255));bg.alpha_composite(im.resize((512,512),Image.Resampling.LANCZOS));alpha.paste(bg,(i*512,0))
alpha.save(Q/'alpha-dark-light-magenta.png');(R/'checksums.json').write_text(json.dumps({str(f.relative_to(R)):hashlib.sha256(f.read_bytes()).hexdigest() for f in [p,R/'blend/spreading-grove.blend',R/'entry.json']},indent=2)+'\n');print(json.dumps(meta,indent=2))
