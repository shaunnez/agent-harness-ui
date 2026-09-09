from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;G=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,o):(R/n).write_text(json.dumps(o,indent=2)+'\n')
for n,s in [('detail-master-attempt1.png','exec-147bd6e3-da14-42e2-bb39-148d5251f177.png'),('detail-master-r1.png','exec-00c48322-9b05-4aac-affd-745ba69e97e8.png')]:shutil.copy2(G/s,R/'source'/n)
m=Image.open(R/'source/detail-master-r1.png').convert('RGB');a=np.array(m).astype(float);ex=a[:,:,1]-np.maximum(a[:,:,0],a[:,:,2]);alpha=1-np.clip((ex-20)/130,0,1);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2])+10),a[:,:,1]);ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/detail-alpha-master-r1.png');box=cut.getbbox();crop=cut.crop(box);s=640/crop.height;size=(round(crop.width*s),640);offset=((768-size[0])//2,64);out=Image.new('RGBA',(768,768));out.alpha_composite(crop.resize(size,Image.Resampling.LANCZOS),offset);ar=np.array(out);ex=ar[:,:,1].astype(float)-np.maximum(ar[:,:,0],ar[:,:,2]);ar[:,:,1]=np.where(ex>20,np.minimum(ar[:,:,1],np.maximum(ar[:,:,0],ar[:,:,2]).astype(int)+10),ar[:,:,1]);ar[ar[:,:,3]==0,:3]=0;out=Image.fromarray(ar);e=R/'exports/worker-standard-detail-neutral-r1.png';out.save(e)
def project(p):return [round(offset[0]+(p[0]-box[0])*s,3),round(offset[1]+(p[1]-box[1])*s,3)]
# Manual sole contact centers and visible hand/face landmarks in unchanged master.
points={'leftSole':project([555,1166]),'rightSole':project([768,1105]),'leftHand':project([429,843]),'rightHand':project([837,778]),'face':project([700,315])};anchor=[round((points['leftSole'][k]+points['rightSole'][k])/2,3) for k in range(2)]
geometry={'masterDimensions':list(m.size),'sourceAlphaBounds':box,'exportAlphaBounds':out.getbbox(),'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'sourceSize':[768,768],'logicalSize':[384,384],'landmarksSourcePixels':points,'groundAnchorSourcePixels':anchor,'measurementMethod':'Sole-contact center landmarks manually measured to approximately5master pixels; anchor is their midpoint. Other sockets are visible feature centers, not a rig.'};write('geometry.json',geometry)
sheet=Image.new('RGB',(1536,540),'#16222c');d=ImageDraw.Draw(sheet)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):
 p=Image.new('RGBA',(512,512),c);p.alpha_composite(out.resize((512,512),Image.Resampling.LANCZOS));sheet.paste(p.convert('RGB'),(i*512,28));d.text((i*512+10,8),['Dark','Light','Magenta'][i],fill='white')
sheet.save(R/'qa/alpha-backgrounds-r1.png')
scales=Image.new('RGBA',(700,300),'#071923');d=ImageDraw.Draw(scales)
for x,h in [(80,180),(260,200),(460,220)]:
 b=out.getbbox();subject=out.crop(b);subject=subject.resize((round(subject.width*h/subject.height),h),Image.Resampling.LANCZOS);scales.alpha_composite(subject,(x,260-h));d.text((x,275),str(h)+'px visible',fill='white')
scales.convert('RGB').save(R/'qa/actual-scale-r1.png')
reg=Image.new('RGBA',(768,768),'#071923');reg.alpha_composite(out);d=ImageDraw.Draw(reg)
for n,p in {**points,'ground':anchor}.items():x,y=p;d.ellipse((x-4,y-4,x+4,y+4),fill='#ffcc55');d.text((x+7,y),n,fill='white')
reg.convert('RGB').save(R/'qa/registration-r1.png')
entry={'id':'mf.worker.standard.detail.neutral','revision':1,'status':'pending-coordinator-integration-review','file':str(e.relative_to(R)),'sourceSize':[768,768],'logicalSize':[384,384],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[v/2 for v in anchor],'footprint':[[p[0]/2,p[1]/2] for p in [points['leftSole'],points['rightSole']]],'footprintUse':'Two sole-contact centers only; renderer may expand a navigation footprint separately.','layer':'worker','occlusionClass':'actor','sockets':{k:[v/2 for v in points[k]] for k in ['leftHand','rightHand','face']},'sourceId':'exec-00c48322-9b05-4aac-affd-745ba69e97e8','sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/actual-scale-r1.png','qa/registration-r1.png'],'limits':['Single neutral full-body pose, no rig, tool, animation or portrait export.','Hand sockets are parked-pose feature centers; contact animation requires separate work proof.','Authored detail angle; not an exact scaling of HQ sprite. Integrated M1 pending.']};write('entry.json',entry)
refs=[R.parent/'mf.worker.standard.se.neutral/exports/worker-standard-se-neutral-r1.png',Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/screens/agent-work-blocked-v1.1.png')]
write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':entry['sourceId'],'sourceSha256':sha(R/'source/detail-master-r1.png'),'references':[{'path':str(p),'sha256':sha(p)} for p in refs],'generationPrompt':(R/'source/generation-prompt.txt').read_text(),'correctiveGenerations':1,'correctionPrompt':(R/'source/correction-prompt.txt').read_text(),'correctionInput':'source/detail-master-attempt1.png','correctionReason':'Initial RGB source contained a baked checkerboard; regenerate only background as removable green.','transforms':['Preserve both masters','Deterministic green alpha and spill cleanup','Uniform fit to640source pixels visible height','Lanczos resize and paste on768x768 at recorded offset','Post-resample green cleanup; QA composites only'],'exportSha256':sha(e),'exportBytes':e.stat().st_size,'rightsNote':'Supplied/generated project identity only; provenance is not legal clearance.'})
write('qa/measurements-r1.json',{'alphaRange':out.getchannel('A').getextrema(),'transparentPixels':int((ar[:,:,3]==0).sum()),'partialAlphaPixels':int(((ar[:,:,3]>0)&(ar[:,:,3]<255)).sum()),'borderNontransparent':int((ar[[0,-1],:,3]>0).sum()+(ar[:,[0,-1],3]>0).sum()),'visibleHeight':out.getbbox()[3]-out.getbbox()[1],'pngBytes':e.stat().st_size})
(R/'qa/QA.md').write_text('''# Detail neutral worker A0 r1

768×768 straight RGBA, logical384×384. Full-body ceramic/steel worker, SE three-quarter front face visibility, parked neutral pose. Fuller torso preserves original round head, dark joints, blue eyes and practical feet. No worker name/status, workstation, tool, ground or shadow.

Inspect alpha-backgrounds at dark/light/magenta and actual-scale at180/200/220px visible height. Initial generation baked a checkerboard into RGB; one ImageGen background correction followed by deterministic key/registration. All sources retained.

Manual soles and hand/face landmarks are measured raster feature centers, not recovered geometry. No portrait crop or articulated animation is supplied. Pending coordinator integration review and M1.
''')
write('checksums.json',{str(p.relative_to(R)):sha(p) for p in sorted(R.rglob('*')) if p.is_file() and p.name!='checksums.json'})
print(json.dumps({'sha256':sha(e),'bounds':out.getbbox(),'anchor':entry['groundAnchor'],'bytes':e.stat().st_size}))
