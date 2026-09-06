from pathlib import Path
from PIL import Image,ImageDraw
import json,hashlib
ROOT=Path(__file__).resolve().parents[3];R=ROOT/'design/mission-frontier/assets/staging/cinematic-v1/astra/exterior-production';Q=R/'qa';Q.mkdir(exist_ok=True)
base=Image.new('RGBA',(1536,1280));A=ROOT/'design/mission-frontier/assets/staging/A0'
for id in ['mf.base.standard.floor','mf.base.standard.back','mf.base.standard.front']:
 folder=A/id;e=json.loads((folder/('entry-r2.json' if id.endswith('back') else 'entry.json')).read_text());im=Image.open(folder/e['file']).convert('RGBA');base.alpha_composite(im,(0,200 if id.endswith('floor') else 0))
roof=Image.open(R/'renders/exterior.png').convert('RGBA');composite=base.copy();composite.alpha_composite(roof);bg=Image.new('RGBA',base.size,(30,42,49,255));bg.alpha_composite(composite);bg.save(Q/'retained-v1-interior-composite.png')
prev=Image.open(R.parent/'renders/hq-roof.png').convert('RGBA');old=base.copy();old.alpha_composite(prev);sheet=Image.new('RGBA',(1100,550),(30,42,49,255));d=ImageDraw.Draw(sheet)
for x,im,title in [(15,old,'Previous roof with retained v1 interior'),(565,composite,'Refined roof with retained v1 interior')]:
 im=im.resize((507,422),Image.Resampling.LANCZOS);sheet.alpha_composite(im,(x,45));d.text((x,18),title,fill='white')
sheet.convert('RGB').save(Q/'overview-comparison.png');alpha=Image.new('RGB',(1536,427))
for i,col in enumerate([(25,32,40),(235,229,217),(220,0,130)]):
 im=Image.new('RGBA',(512,427),(*col,255));im.alpha_composite(roof.resize((512,427),Image.Resampling.LANCZOS));alpha.paste(im,(i*512,0))
alpha.save(Q/'roof-alpha.png')
e=json.loads((R/'entry.json').read_text());b=roof.getchannel('A').getbbox();e['alphaBoundsSource']=list(b);e['topAlphaMarginSource']=b[1];e['sha256']=hashlib.sha256((R/'renders/exterior.png').read_bytes()).hexdigest();assert b[1]>=20;(R/'entry.json').write_text(json.dumps(e,indent=2)+'\n');(R/'checksums.json').write_text(json.dumps({str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [R/'renders/exterior.png',R/'blend/exterior.blend',R/'entry.json']},indent=2)+'\n');print('Top alpha margin:',b[1])
