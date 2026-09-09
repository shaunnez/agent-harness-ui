from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
g=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-59ab6987-21b3-4d4b-bc6f-308f40f503d6.png');shutil.copy2(g,R/'source/bridge-master-r1.png');m=Image.open(g).convert('RGB');a=np.array(m).astype(float);ex=a[:,:,1]-np.maximum(a[:,:,0],a[:,:,2]);alpha=1-np.clip((ex-20)/130,0,1);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2])+10),a[:,:,1]);ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/bridge-alpha-master-r1.png')
src=np.array([[110,296],[317,174],[1333,733],[1116,857]],float);dst=np.array([[72,188],[120,164],[440,324],[392,348]],float)
def matrix(a,b):
 r=[];v=[]
 for (x,y),(u,w) in zip(a,b):r.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-w*x,-w*y]]);v.extend([u,w])
 return np.append(np.linalg.solve(r,v),1).reshape(3,3)
measured=src.copy();src[0]=measured[0]*.985+measured[3]*.015;src[1]=measured[1]*.985+measured[2]*.015;src[2]=measured[2]*.985+measured[1]*.015;src[3]=measured[3]*.985+measured[0]*.015
H=matrix(src,dst);iv=np.linalg.inv(H);iv/=iv[2,2];out=cut.transform((512,384),Image.Transform.PERSPECTIVE,iv.flatten()[:8],Image.Resampling.BICUBIC)
# Remove shallow end-side pixels beyond shared connection cross-sections.
y,x=np.indices((384,512));u=(x-96)/640+(y-176)/320;clip=(u>=0)&(u<=1);ar=np.array(out);ar[~clip]=0;ar[ar[:,:,3]==0,:3]=0;structureMask=(y>=.5*x+152)&clip;ar[~structureMask]=0;structure=Image.fromarray(ar);structure.save(R/'source/registered-generated-underside-r1.png');roadPath=R.parent/'mf.route.road.se/exports/road-se-r1.png';road=Image.open(roadPath).convert('RGBA');out=Image.alpha_composite(structure,road);e=R/'exports/bridge-se-r1.png';out.save(e);Image.fromarray((clip*255).astype('uint8')).save(R/'source/end-section-mask-r1.png')
def bg(im):
 water=Image.open(R.parent/'mf.terrain.water/exports/terrain-water-r1.png').convert('RGBA');p=Image.new('RGBA',im.size)
 for wy in range(0,im.height,512):
  for wx in range(0,im.width,512):p.alpha_composite(water,(wx,wy))
 p.alpha_composite(im);return p.convert('RGB')
joined=Image.new('RGBA',(1152,704))
for i in range(3):joined.alpha_composite(out if i==1 else road,(i*320,i*160))
joined.save(R/'qa/joined-native-r1.png');sheet=Image.new('RGB',(900,680),'#102c31');d=ImageDraw.Draw(sheet)
for y0,factor in [(30,1),(430,.65)]:
 small=joined.resize((round(1152*.5*factor),round(704*.5*factor)),Image.Resampling.LANCZOS);sheet.paste(bg(small),(20,y0));d.text((20,y0-20),'Road - bridge - road / logical scale '+str(factor),fill='white')
sheet.save(R/'qa/joined-consumer-scales-r1.png')
contacts=Image.new('RGB',(768,384),'#102c31')
for i,(x0,y0) in enumerate([(416,336),(736,496)]):contacts.paste(bg(joined.crop((x0-48,y0-48,x0+48,y0+48))).resize((384,384)),(i*384,0))
contacts.save(R/'qa/join-contact-magnified-r1.png')
alphaQA=Image.new('RGB',(1536,412),'#16222c');d=ImageDraw.Draw(alphaQA)
for i,col in enumerate(['#071923','#f0f3f5','#d000cc']):
 p=Image.new('RGBA',out.size,col);p.alpha_composite(out);alphaQA.paste(p.convert('RGB'),(i*512,28));d.text((i*512+10,8),['Dark','Light','Magenta'][i],fill='white')
alphaQA.save(R/'qa/alpha-backgrounds-r1.png')
write('geometry.json',{'masterDimensions':list(m.size),'measuredMasterTopCorners':measured.tolist(),'sampledInsetCorners':src.tolist(),'endSamplingInsetFraction':.015,'registeredTopCornersSourcePixels':dst.tolist(),'homography':H.tolist(),'inverseHomography':iv.tolist(),'logicalEndpoints':{'nw':[48,88],'se':[208,168]},'logicalCrossSections':{'nw':[[36,94],[60,82]],'se':[[196,174],[220,162]]},'logicalDisplacement':[160,80],'logicalGroundAnchor':[128,128],'endpointMask':'0<=((x-96)/640+(y-176)/320)<=1 in export source coordinates','measurementToleranceMasterPixels':4,'registrationNote':'Four manually measured top corners rectified to exact contract; organic generated geometry is not assumed exact before transform.'})
entry={'id':'mf.route.bridge.se','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[512,384],'logicalSize':[256,192],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[128,128],'footprint':(dst/2).tolist(),'layer':'route','occlusionClass':'ground-route','sockets':{'nw':[48,88],'se':[208,168]},'crossSections':{'nw':[[36,94],[60,82]],'se':[[196,174],[220,162]]},'repeatDisplacement':[160,80],'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/joined-consumer-scales-r1.png','qa/join-contact-magnified-r1.png','qa/alpha-backgrounds-r1.png'],'limits':['SE bridge only. Approved road deck retained verbatim; generated structure below near edge.','Small material discontinuity at repeated panels may remain; scene joins must be inspected with actual filtering.']};write('entry.json',entry)
ref=Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/reference/selected-world.png');write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-59ab6987-21b3-4d4b-bc6f-308f40f503d6','sourceSha256':sha(R/'source/bridge-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(ref),'sha256':sha(ref)},{'path':str(R.parent/'mf.route.road.se/source/road-master-r1.png'),'sha256':sha(R.parent/'mf.route.road.se/source/road-master-r1.png')}],'approvedDeck':{'path':str(roadPath),'sha256':sha(roadPath)},'correctiveGenerations':0,'transforms':['Green alpha cleanup','Measured4corner projective registration to contract road top with1.5percent inward longitudinal endpoint sampling to remove generated end gaps','Clip generated underside beyond end cross-sections, retain only near-side structure','Overlay approved road deck pixels for identical road transitions','QA-only three segments translated exact[320,160]source; displayed0.65/1logical scales'],'exportSha256':sha(e),'exportBytes':e.stat().st_size})
(R/'qa/QA.md').write_text('''# Bridge SE A1 r1

512×384RGBA, logical256×192, ground anchor[128,128]. Registered center displacement[160,80] is exact2:1. End cross-sections nw[36,94]/[60,82], se[196,174]/[220,162]. Three independent exports joined by[320,160]source translation and shown at0.65/1.0logical scale.

Approved road deck retained over ImageGen-derived shallow near-edge steel structure. Open square deck transitions. Road-bridge-road proof uses accepted water. Original master, alpha master, endpoint mask and exact registration retained. No building/worker/label/light/endcap/step/water baked into bridge. Inspect magnified contact and real consumer-scale proof; renderer sampling may affect tiny joins. Pending coordinator review.
''')
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(sha(e))
