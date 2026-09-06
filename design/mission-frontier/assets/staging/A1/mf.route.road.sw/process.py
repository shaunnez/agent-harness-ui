from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
R=Path(__file__).resolve().parent;src=R.parent/'mf.route.road.se/exports/road-se-r1.png'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
se=Image.open(src).convert('RGBA');sw=se.transpose(Image.Transpose.FLIP_LEFT_RIGHT);e=R/'exports/road-sw-r1.png';sw.save(e)
def bg(im):
 p=Image.new('RGBA',im.size,'#102c31');p.alpha_composite(im);return p.convert('RGB')
groups={}
for name,im in [('SE',se),('SW',sw)]:
 group=Image.new('RGBA',(1152,704))
 for i in range(3):group.alpha_composite(im,((i*320 if name=='SE' else (2-i)*320),i*160))
 groups[name]=group
 groups[name].save(R/f'qa/joined-{name.lower()}-native-r1.png')
sheet=Image.new('RGB',(1220,680),'#102c31');d=ImageDraw.Draw(sheet)
for col,name in enumerate(['SE','SW']):
 for y0,factor in [(30,1),(430,.65)]:
  small=groups[name].resize((round(576*factor),round(352*factor)),Image.Resampling.LANCZOS);sheet.paste(bg(small),(20+610*col,y0));d.text((20+610*col,y0-20),name+' / three segments / logical scale '+str(factor),fill='white')
sheet.save(R/'qa/both-axes-consumer-scales-r1.png');contacts=Image.new('RGB',(768,384),'#102c31')
for i,(cx,cy) in enumerate([(736,336),(416,496)]):contacts.paste(bg(groups['SW'].crop((cx-48,cy-48,cx+48,cy+48))).resize((384,384)),(i*384,0))
contacts.save(R/'qa/join-contact-magnified-r1.png')
qa=Image.new('RGB',(1536,412),'#16222c');d=ImageDraw.Draw(qa)
for i,col in enumerate(['#071923','#f0f3f5','#d000cc']):
 p=Image.new('RGBA',sw.size,col);p.alpha_composite(sw);qa.paste(p.convert('RGB'),(i*512,28));d.text((i*512+8,8),['Dark','Light','Magenta'][i],fill='white')
qa.save(R/'qa/alpha-backgrounds-r1.png')
a=np.array(groups['SW']);vals=[int(a[round(336+(x-736)*.5),x,3]) for x in range(716,757)];write('qa/join-measurements-r1.json',{'sampleCount':len(vals),'minimumInteriorJoinAlpha':min(vals),'zeroAlphaSamples':sum(v==0 for v in vals),'losslessMirrorVerified':bool(np.array_equal(np.array(sw),np.array(se)[:,::-1]))})
entry={'id':'mf.route.road.sw','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[512,384],'logicalSize':[256,192],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[128,128],'footprint':[[196,82],[220,94],[60,174],[36,162]],'layer':'route','occlusionClass':'ground-route','sockets':{'ne':[208,88],'sw':[48,168]},'crossSections':{'ne':[[196,82],[220,94]],'sw':[[36,162],[60,174]]},'repeatDisplacement':[-160,80],'sha256':sha(e),'alpha':'straight RGBA','qa':['qa/QA.md','qa/both-axes-consumer-scales-r1.png','qa/join-contact-magnified-r1.png','qa/alpha-backgrounds-r1.png','qa/join-measurements-r1.json'],'limits':['Permitted mirrored ground material; tiny curb-side shading reverses. No tall geometry or cast shadow is present.','Live scene filtering and connection composition remain coordinator verification.']};write('entry.json',entry)
write('geometry.json',{'coordinateTransform':"Continuous source-frame reflection x=512-x, y=y; raster pixel index x=511-x. Logical x=256-x.",'groundAnchor':[128,128],'endpoints':entry['sockets'],'crossSections':entry['crossSections'],'sourceGroundAnchor':[128,128]})
write('provenance.json',{'assetId':entry['id'],'revision':1,'production':'Authorized deterministic mirrored derivative; no ImageGen','sourceAssetId':'mf.route.road.se','sourceRevision':1,'sourcePath':str(src),'sourceSha256':sha(src),'sourceProvenance':str(R.parent/'mf.route.road.se/provenance.json'),'transforms':['Lossless horizontal pixel reflection in512x384canvas','Reflect metadata coordinates around x256source/x128logical','QA-only exact[-320,160]source translations and requested scale rendering'],'exportSha256':sha(e),'exportBytes':e.stat().st_size,'lightingReview':'Flat dark surface and pale curbs preserve material kinship; negligible curb-side highlight direction is mirrored, no tall object/shadow reversal.'})
(R/'qa/QA.md').write_text('''# Road SW A1 r1

Lossless horizontal derivative of approved SE export; no regeneration/resampling/color alteration. Same512×384RGBA, logical256×192, anchor[128,128]. Endpoints ne[208,88],sw[48,168] and cross sections match assignment. Pixel centers mirror at x'=511-x; continuous geometry mirrors at x'=512-x.

Three SW segments join by[-160,80]logical displacement. Both axes compared at0.65/1.0logical scale. Inspect magnified seam and alpha backgrounds; source endpoint inset correction is retained. Flat material has no tall railings or cast shadows; tiny curb-side shading reverses but does not materially change ground readability. Pending coordinator review.
''')
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps({'sha256':sha(e),'minimumJoinAlpha':min(vals)}))
