from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
import json,hashlib,numpy as np
R=Path(__file__).resolve().parent
source=R.parent/'mf.worker.standard.detail.neutral/source/detail-alpha-master-r1.png'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,o):(R/n).write_text(json.dumps(o,indent=2)+'\n')
im=Image.open(source).convert('RGBA');crop=[370,30,890,680];out=im.crop(crop).resize((256,320),Image.Resampling.LANCZOS);a=np.array(out);a[a[:,:,3]==0,:3]=0;out=Image.fromarray(a);e=R/'exports/worker-standard-portrait-r1.png';out.save(e)
sheet=Image.new('RGB',(600,360),'#071923');d=ImageDraw.Draw(sheet)
def composite(image,xy):
 global sheet
 p=Image.new('RGBA',sheet.size);p.alpha_composite(image,xy);sheet=Image.alpha_composite(sheet.convert('RGBA'),p).convert('RGB')
composite(out,(12,28))
for xy,sz in [((300,55),(80,122)),((420,55),(64,86))]:
 fitted=ImageOps.fit(out,sz,Image.Resampling.LANCZOS,centering=(.5,0));composite(fitted,xy);fitted.save(R/f'qa/slot-{sz[0]}x{sz[1]}-r1.png')
d=ImageDraw.Draw(sheet);d.text((12,8),'256x320 export',fill='white');d.text((300,32),'80x122',fill='white');d.text((420,32),'64x86',fill='white');d.text((280,220),'object-fit: cover',fill='white');d.text((280,242),'object-position: center top',fill='white');sheet.save(R/'qa/hud-actual-scale-r1.png')
bgs=Image.new('RGB',(768,348),'#16222c');d=ImageDraw.Draw(bgs)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):
 p=Image.new('RGBA',(256,320),c);p.alpha_composite(out);bgs.paste(p.convert('RGB'),(i*256,28));d.text((i*256+8,8),['Dark','Light','Magenta'][i],fill='white')
bgs.save(R/'qa/alpha-backgrounds-r1.png')
entry={'id':'mf.worker.standard.portrait','revision':1,'status':'pending-coordinator-integration-review','file':str(e.relative_to(R)),'sourceSize':[256,320],'logicalSize':[128,160],'coordinateUnits':'logical-pixels-untrimmed','layer':'hud-portrait','occlusionClass':'ui-image','groundAnchor':None,'sockets':{},'sha256':sha(e),'alpha':'straight RGBA','displaySlots':[[80,122],[64,86]],'displayFit':{'objectFit':'cover','objectPosition':'center top'},'qa':['qa/QA.md','qa/hud-actual-scale-r1.png','qa/alpha-backgrounds-r1.png'],'limits':['Portrait only; no world placement or ground anchor.','Bottom torso crop is intentional. No status/UI baked in.']};write('entry.json',entry)
write('provenance.json',{'assetId':entry['id'],'revision':1,'production':'Deterministic crop of approved detail worker; no new creative generation','sourceAssetId':'mf.worker.standard.detail.neutral','sourceRevision':1,'sourcePath':str(source),'sourceSha256':sha(source),'sourceDimensions':list(im.size),'sourceProvenance':str(R.parent/'mf.worker.standard.detail.neutral/provenance.json'),'cropSourcePixels':crop,'cropDimensions':[520,650],'exportDimensions':[256,320],'resampling':'Lanczos uniform256/520','transforms':['Crop original alpha master at[370,30,890,680]','Uniform resize to256x320','Zero hiddenRGB under fully transparent pixels','QA-only cover crops for two HUD slots'],'exportSha256':sha(e),'exportBytes':e.stat().st_size})
write('qa/measurements-r1.json',{'mode':out.mode,'dimensions':list(out.size),'visibleAlphaBounds':out.getbbox(),'alphaRange':out.getchannel('A').getextrema(),'topBorderOccupiedPixels':int((a[0,:,3]>0).sum()),'bottomBorderOccupiedPixels':int((a[-1,:,3]>0).sum()),'note':'Bottom torso intentionally extends through frame; full head remains inside crop.'})
(R/'qa/QA.md').write_text('''# Portrait A0 r1

Deterministic crop only from approved detail.neutral alpha master. Full head, face and shoulders remain; lower torso intentionally crops at bottom.256×320 straight RGBA with no status/name/background/UI.

HUD QA uses exact80×122 and64×86 slots with object-fit:cover and object-position:center top. This preserves aspect ratio and comfortable head margins while filling narrow portrait slots. Do not stretch the export to slot ratio.

Inspect actual-scale HUD sheet and dark/light/magenta alpha sheet. No new generation, portrait animation, world anchor or other asset produced. Pending coordinator integration review.
''')
write('checksums.json',{str(p.relative_to(R)):sha(p) for p in sorted(R.rglob('*')) if p.is_file() and p.name!='checksums.json'})
print(json.dumps({'sha256':sha(e),'bytes':e.stat().st_size,'bounds':out.getbbox()}))
