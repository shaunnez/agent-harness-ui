from pathlib import Path
from PIL import Image,ImageDraw
import json,hashlib
R=Path(__file__).resolve().parents[1];p=R/'renders/blockout-transparent.png';im=Image.open(p).convert('RGBA');a=im.getchannel('A');meta=json.loads((R/'qa/blockout-calibration.json').read_text());assert im.size==(2560,1920)
edges=[a.crop(b).getextrema()[1] for b in [(0,0,2560,1),(0,1919,2560,1920),(0,0,1,1920),(2559,0,2560,1920)]];assert edges==[0,0,0,0]
for socket in meta['sockets'].values():assert max(abs(a-b) for a,b in zip(socket['relativeLogicalMeasured'],socket['relativeLogicalRequested']))<.001
entry={'id':'mf.coastal.blockout-preview','status':'composition-review-only-not-final-art','file':'renders/blockout-transparent.png','sourceSize':[2560,1920],'logicalSize':[1280,960],'groundAnchor':[640,600],'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'boundsSourcePixels':list(a.getbbox()),'allCanvasEdgesTransparent':True,'sockets':meta['sockets'],'limits':['coarse material and vegetation placeholders','road/court coplanar overlap needs correction','terrain left and roof top exceed proposed composition bounds; builder feedback pending']}
(R/'qa/blockout-preview-entry.json').write_text(json.dumps(entry,indent=2)+'\n')
canvas=Image.new('RGBA',(1280,960),(17,34,42,255));canvas.alpha_composite(im.resize((1280,960),Image.Resampling.LANCZOS));d=ImageDraw.Draw(canvas)
for name,socket in meta['sockets'].items():
 x,y=socket['logicalMeasured'];d.ellipse((x-5,y-5,x+5,y+5),fill='#ffcd6b');d.text((x+9,y-15),name+' '+str(socket['relativeLogicalRequested']),fill='white')
for p in [[-30,25],[32,25],[-110,36],[-28,72],[18,49],[-64,12],[-74,48],[8,84],[54,61],[-28,28]]:
 x,y=p[0]+640,p[1]+600;d.ellipse((x-3,y-3,x+3,y+3),fill='#77e0ff')
d.text((25,24),'BLOCKOUT CALIBRATION — orange route sockets; cyan task/ambient ground contacts',fill='white')
canvas.save(R/'qa/blockout-registration.png');print(json.dumps(entry,indent=2))
