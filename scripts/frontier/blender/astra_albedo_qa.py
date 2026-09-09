from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
ROOT=Path(__file__).resolve().parents[3];A=ROOT/'design/mission-frontier/assets/staging/cinematic-v1/astra';R=A/'vegetation-albedo-preview';Q=R/'qa';Q.mkdir(exist_ok=True);out={};sheet=Image.new('RGBA',(1000,410),(164,151,115,255));d=ImageDraw.Draw(sheet)
for i,(name,p) in enumerate([('Retained v1',ROOT/'public/frontier/assets/mf.prop.purple-tree.r1.png'),('Dark production',A/'vegetation-production/renders/spreading-grove.png'),('Albedo preview',R/'renders/spreading-grove.png')]):
 im=Image.open(p).convert('RGBA');a=np.array(im).astype(float);rgb=a[:,:,:3];mask=(a[:,:,3]>240)&(rgb[:,:,0]>rgb[:,:,1]*1.15)&(rgb[:,:,2]>rgb[:,:,1]*1.15);l=rgb@np.array([.2126,.7152,.0722]);out[name]={'purpleOpaquePixels':int(mask.sum()),'sRgbLumaP10P50P90':np.quantile(l[mask],[.1,.5,.9]).tolist()};im=im.resize((307,307),Image.Resampling.LANCZOS);sheet.alpha_composite(im,(i*333,20));d.text((i*333+16,350),name+' / same0.8logical scale',fill='white')
sheet.convert('RGB').save(Q/'comparison.png');(Q/'lightness.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
