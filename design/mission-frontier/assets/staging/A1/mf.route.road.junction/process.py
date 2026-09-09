from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
R=Path(__file__).resolve().parent
refs=[R.parent/'mf.route.road.se/exports/road-se-r1.png',R.parent/'mf.route.road.sw/exports/road-sw-r1.png']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
se,sw=[np.array(Image.open(p).convert('RGBA')) for p in refs];yy,xx=np.indices((384,512));u=(xx-96)/640+(yy-176)/320;v=(416-xx)/640+(yy-176)/320
se[(u<.2)|(u>.8)]=0;sw[(v<.2)|(v>.8)]=0
both=(se[:,:,3]>0)&(sw[:,:,3]>0);lumse=se[:,:,:3].mean(axis=2);lumsw=sw[:,:,:3].mean(axis=2)
# Overlap chooses existing dark walking-surface pixels instead of placing curb across crossing.
chooseSW=((sw[:,:,3]>0)&(se[:,:,3]==0))|(both&(lumsw<lumse));outa=se.copy();outa[chooseSW]=sw[chooseSW];out=Image.fromarray(outa);e=R/'exports/road-junction-r1.png';out.save(e)
for name,mask in [('se-crop',(u>=.2)&(u<=.8)),('sw-crop',(v>=.2)&(v<=.8)),('sw-pixel-ownership',chooseSW)]:Image.fromarray((mask*255).astype('uint8')).save(R/f'source/{name}-mask-r1.png')
def bg(im,c='#102c31'):
 p=Image.new('RGBA',im.size,c);p.alpha_composite(im);return p.convert('RGB')
proof=Image.new('RGBA',(1536,896));offsets=[(refs[0],(256,128)),(refs[1],(768,128)),(refs[0],(768,384)),(refs[1],(256,384))]
for p,xy in offsets:proof.alpha_composite(Image.open(p).convert('RGBA'),xy)
proof.alpha_composite(out,(512,256));proof.save(R/'qa/four-arms-native-r1.png');qa=Image.new('RGB',(1100,850),'#102c31');d=ImageDraw.Draw(qa)
for pos,factor in [((10,30),1),((10,490),.65)]:
 small=proof.resize((round(768*factor),round(448*factor)),Image.Resampling.LANCZOS);qa.paste(bg(small),pos);d.text((pos[0],pos[1]-20),'Four road arms / logical scale '+str(factor),fill='white')
qa.save(R/'qa/four-arms-consumer-scales-r1.png');bg(proof.crop((608,420,928,620))).resize((960,600),Image.Resampling.NEAREST).save(R/'qa/center-and-joins-magnified-r1.png')
alphaQA=Image.new('RGB',(1536,412),'#16222c');d=ImageDraw.Draw(alphaQA)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):alphaQA.paste(bg(out,c),(512*i,28));d.text((512*i+8,8),['Dark','Light','Magenta'][i],fill='white')
alphaQA.save(R/'qa/alpha-backgrounds-r1.png')
endpoints={'nw':[80,104],'ne':[176,104],'se':[176,152],'sw':[80,152]};cross={'nw':[[68,110],[92,98]],'ne':[[164,98],[188,110]],'se':[[164,158],[188,146]],'sw':[[68,146],[92,158]]}
entry={'id':'mf.route.road.junction','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[512,384],'logicalSize':[256,192],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[128,128],'layer':'route','occlusionClass':'ground-route','sockets':endpoints,'crossSections':cross,'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/four-arms-consumer-scales-r1.png','qa/center-and-joins-magnified-r1.png','qa/alpha-backgrounds-r1.png'],'limits':['Deterministic crossing made from existing flat surface pixels; center panel patterns meet rather than continuing as one unique manufactured panel.','No gate/railing/central ornament. Scene filtering remains coordinator verification.']};write('entry.json',entry)
write('geometry.json',{'logicalAnchor':[128,128],'endpoints':endpoints,'crossSections':cross,'construction':'Crop each accepted full road to longitudinal interval[0.2,0.8], preserving original pixel positions. Where strips overlap, choose darker existing RGB pixel to retain slate and suppress interior cream curb crossings. No colors or geometry drawn.','registeredOpeningGeometry':'Inherited exact road axes and width; crop planes yield required centers.','armOffsetsFromJunctionLogical':{'nw':[-128,-64],'ne':[128,-64],'se':[128,64],'sw':[-128,64]}})
write('provenance.json',{'assetId':entry['id'],'revision':1,'production':'Authorized deterministic crop/composite of accepted road art; no ImageGen','references':[{'path':str(p),'sha256':sha(p)} for p in refs],'transforms':['Clip road length to middle60percent','Select darker original pixel in crossing intersection, avoiding overlaid curb barriers','Retain alpha and exterior transparent boundary; no resampling','QA-only attach four original road arms at exact connector offsets'],'exportSha256':sha(e),'exportBytes':e.stat().st_size})
(R/'qa/QA.md').write_text('''# Four-way junction A1 r1

512×384RGBA, logical256×192; anchor[128,128]. Four prescribed centers/cross-sections retained from both accepted24logical road axes. Interior crossing composed only from approved slate/curb pixels. Selection of darker source pixels removes cream curb barriers across passages; exterior corner curbs remain. No generated/painted center replacement.

Four original road arms attached at exact offsets. Native proof plus0.65/1logical scale and magnified center/join QA retained. No generic code-drawn surface, gate, railing or ornament. Center panel grain comes from both original roads and is not a uniquely authored manufactured intersection. Pending coordinator review.
''')
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(sha(e))
