from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
R=Path(__file__).resolve().parent;src=R.parent/'mf.route.bridge.se/exports/bridge-se-r1.png'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
se=Image.open(src).convert('RGBA');sw=se.transpose(Image.Transpose.FLIP_LEFT_RIGHT);e=R/'exports/bridge-sw-r1.png';sw.save(e)
roads={'SE':Image.open(R.parent/'mf.route.road.se/exports/road-se-r1.png').convert('RGBA'),'SW':Image.open(R.parent/'mf.route.road.sw/exports/road-sw-r1.png').convert('RGBA')};water=Image.open(R.parent/'mf.terrain.water/exports/terrain-water-r1.png').convert('RGBA')
def bg(im):
 p=Image.new('RGBA',im.size)
 for y in range(0,im.height,512):
  for x in range(0,im.width,512):p.alpha_composite(water,(x,y))
 p.alpha_composite(im);return p.convert('RGB')
groups={}
for name,bridge in [('SE',se),('SW',sw)]:
 group=Image.new('RGBA',(1152,704))
 for i in range(3):group.alpha_composite(bridge if i==1 else roads[name],((i*320 if name=='SE' else (2-i)*320),i*160))
 groups[name]=group;group.save(R/f'qa/joined-{name.lower()}-native-r1.png')
sheet=Image.new('RGB',(1220,680),'#102c31');d=ImageDraw.Draw(sheet)
for col,name in enumerate(['SE','SW']):
 for y0,factor in [(30,1),(430,.65)]:
  small=groups[name].resize((round(576*factor),round(352*factor)),Image.Resampling.LANCZOS);sheet.paste(bg(small),(20+610*col,y0));d.text((20+610*col,y0-20),name+' road - bridge - road / logical scale '+str(factor),fill='white')
sheet.save(R/'qa/both-axes-consumer-scales-r1.png');contacts=Image.new('RGB',(768,384),'#102c31')
for i,(cx,cy) in enumerate([(736,336),(416,496)]):contacts.paste(bg(groups['SW'].crop((cx-48,cy-48,cx+48,cy+48))).resize((384,384)),(i*384,0))
contacts.save(R/'qa/join-contact-magnified-r1.png')
alpha=Image.new('RGB',(1536,412),'#16222c');d=ImageDraw.Draw(alpha)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):
 p=Image.new('RGBA',sw.size,c);p.alpha_composite(sw);alpha.paste(p.convert('RGB'),(i*512,28));d.text((i*512+8,8),['Dark','Light','Magenta'][i],fill='white')
alpha.save(R/'qa/alpha-backgrounds-r1.png')
a=np.array(groups['SW']);checks=[]
for cx,cy in [(736,336),(416,496)]:
 vals=[int(a[round(cy+(x-cx)*.5),x,3]) for x in range(cx-20,cx+21)];checks.append({'samples':len(vals),'minimumAlpha':min(vals),'zeroAlphaSamples':sum(v==0 for v in vals)})
b=np.array(sw);r=np.array(roads['SW']);opaque=r[:,:,3]==255;write('qa/join-measurements-r1.json',{'joins':checks,'losslessMirrorVerified':bool(np.array_equal(b,np.array(se)[:,::-1])),'approvedOpaqueSwRoadDeckEqual':bool(np.array_equal(b[opaque],r[opaque])),'undersideDepthLogical':4.5})
entry={'id':'mf.route.bridge.sw','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[512,384],'logicalSize':[256,192],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[128,128],'footprint':[[196,82],[220,94],[60,174],[36,162]],'layer':'route','occlusionClass':'ground-route','sockets':{'ne':[208,88],'sw':[48,168]},'crossSections':{'ne':[[196,82],[220,94]],'sw':[[36,162],[60,174]]},'repeatDisplacement':[-160,80],'undersideDepthLogical':4.5,'sha256':sha(e),'alpha':'straight RGBA','qa':['qa/QA.md','qa/both-axes-consumer-scales-r1.png','qa/join-contact-magnified-r1.png','qa/alpha-backgrounds-r1.png','qa/join-measurements-r1.json'],'limits':['Authorized mirror reverses small structural-side highlight direction; shallow underside remains credible.','No opposite-view rerender or water baked in. Scene filtering remains coordinator review.']};write('entry.json',entry)
write('geometry.json',{'coordinateTransform':'Source continuous x_new=512-x_old; raster index x_new=511-x_old. Logical x_new=256-x_old.','groundAnchor':[128,128],'endpoints':entry['sockets'],'crossSections':entry['crossSections'],'undersideDepthLogical':4.5})
write('provenance.json',{'assetId':entry['id'],'revision':1,'production':'Authorized deterministic mirror of accepted ImageGen-derived SE bridge; no new generation','sourceAssetId':'mf.route.bridge.se','sourceRevision':1,'sourcePath':str(src),'sourceSha256':sha(src),'sourceProvenance':str(R.parent/'mf.route.bridge.se/provenance.json'),'transforms':['Lossless horizontal pixel reflection','Reflect connector geometry in frame center','QA-only SW roads before/after bridge over accepted tiled water'],'exportSha256':sha(e),'exportBytes':e.stat().st_size,'lightingReversal':'Small underside/curb highlight direction reverses horizontally; geometry is only4.5logical deep, with no tall pillars or cast shadows.'})
(R/'qa/QA.md').write_text('''# Bridge SW A1 r1

Lossless authorized mirror of accepted SE bridge.512×384RGBA, logical256×192, anchor[128,128], SW-road endpoints/cross sections. Approved opaque SW road deck pixels remain identical;4.5logical structural depth inherited unchanged.

Both axes shown as road-bridge-road at0.65/1.0logical scales over accepted water. Small underside lighting reverses with the mirror; actual-scale structure remains shallow and understated. No tall geometry or baked shadow. Inspect magnified transitions and alpha backgrounds; no water in export. Pending coordinator review.
''')
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps({'sha256':sha(e),'joins':checks}))
