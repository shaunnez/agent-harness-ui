from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil,math
R=Path(__file__).resolve().parent
G=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-23b61b7a-46da-4c8a-b03f-89a905540a75.png')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,o):(R/n).write_text(json.dumps(o,indent=2)+'\n')
shutil.copy2(G,R/'source/working-master-r1.png');m=Image.open(G).convert('RGB');a=np.array(m).astype(float);ex=a[:,:,1]-np.maximum(a[:,:,0],a[:,:,2]);alpha=1-np.clip((ex-20)/130,0,1);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2])+10),a[:,:,1]);ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/working-alpha-master-r1.png');box=cut.getbbox();s=640/(box[3]-box[1]);size=(round((box[2]-box[0])*s),640);offset=((768-size[0])//2,64)
def project(p):return [round(offset[0]+(p[0]-box[0])*s,3),round(offset[1]+(p[1]-box[1])*s,3)]
def export(im):
 out=Image.new('RGBA',(768,768));out.alpha_composite(im.crop(box).resize(size,Image.Resampling.LANCZOS),offset);a=np.array(out);ex=a[:,:,1].astype(float)-np.maximum(a[:,:,0],a[:,:,2]);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2]).astype(int)+10),a[:,:,1]);a[a[:,:,3]==0,:3]=0;return Image.fromarray(a)
# Real source-pixel partition. Duplicate only circular elbow bearing under moving cuff.
y,x=np.ogrid[:ar.shape[0],:ar.shape[1]];disk=(x-746)**2+(y-494)**2<=39**2
moving=(x>=773)|disk;stationary=(x<776)|disk
ba=ar.copy();ba[~stationary]=0;pa=ar.copy();pa[~moving]=0
body=export(Image.fromarray(ba));part=export(Image.fromarray(pa));assembled=export(cut)
for name,im in [('body',body),('forearm-probe',part),('assembled',assembled)]:im.save(R/f'exports/worker-working-{name}-r1.png')
Image.fromarray((moving*255).astype('uint8')).save(R/'source/moving-part-mask-r1.png');Image.fromarray((stationary*255).astype('uint8')).save(R/'source/body-mask-r1.png')
pivot=project([746,494]);soles=[project([400,1068]),project([614,1026])];anchor=[sum(v[k] for v in soles)/2 for k in [0,1]];tip=project([1124,580])
def pose(deg):
 p=part.rotate(deg,Image.Resampling.BICUBIC,center=tuple(pivot));return Image.alpha_composite(body,p)
def plate(im,bg):
 p=Image.new('RGBA',im.size,bg);p.alpha_composite(im);return p.convert('RGB')
sheet=Image.new('RGB',(1536,540),'#16222c');d=ImageDraw.Draw(sheet)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):sheet.paste(plate(pose(0),c).resize((512,512),Image.Resampling.LANCZOS),(512*i,28));d.text((512*i+10,8),['Dark','Light','Magenta'][i],fill='white')
sheet.save(R/'qa/alpha-backgrounds-r1.png')
contact=Image.new('RGB',(900,330),'#071923');d=ImageDraw.Draw(contact)
for i,deg in enumerate([-4,0,4]):
 im=pose(deg);region=(round(pivot[0]-80),round(pivot[1]-80),round(pivot[0]+80),round(pivot[1]+80));contact.paste(plate(im.crop(region),'#d000cc').resize((300,300)),(i*300,28));d.text((i*300+10,8),str(deg)+' degrees',fill='white')
contact.save(R/'qa/elbow-contact-r1.png')
frames=[]
for t in range(32):
 angle=4*math.sin(t*2*math.pi/32);im=pose(angle);frame=Image.new('RGB',(650,300),'#071923');d=ImageDraw.Draw(frame)
 for pos,h in [((80,202),58),((310,60),200)]:
  scale=h/640;sm=im.resize((round(768*scale),round(768*scale)),Image.Resampling.LANCZOS);tmp=Image.new('RGBA',frame.size);tmp.alpha_composite(sm,pos);frame=Image.alpha_composite(frame.convert('RGBA'),tmp).convert('RGB')
 d=ImageDraw.Draw(frame);d.text((35,15),'Only forearm/probe rotates around measured elbow; feet/body fixed',fill='white');d.text((80,278),'58px worker',fill='white');d.text((310,278),'200px worker',fill='white');frames.append(frame)
frames[0].save(R/'qa/actual-scale-motion-r1.gif',save_all=True,append_images=frames[1:],duration=62,loop=0,disposal=2)
frames[8].save(R/'qa/actual-scale-motion-frame-r1.png')
reg=plate(assembled,'#071923');d=ImageDraw.Draw(reg)
for n,p in [('elbow',pivot),('ground',anchor),('probeTip',tip)]:xx,yy=p;d.ellipse((xx-4,yy-4,xx+4,yy+4),fill='#ffcc55');d.text((xx+8,yy),n,fill='white')
reg.save(R/'qa/registration-r1.png')
geometry={'sourceSize':list(m.size),'masterAlphaBounds':box,'exportAlphaBounds':assembled.getbbox(),'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'pivotSourcePixels':pivot,'groundAnchorSourcePixels':anchor,'soleContactsSourcePixels':soles,'probeTipSourcePixels':tip,'partition':{'masterPivot':[746,494],'bearingRadiusMaster':39,'movingMask':'x>=773 OR pivot disk','bodyMask':'x<776 OR pivot disk','overlapReason':'Existing circular elbow source pixels retained beneath moving cuff to prevent pivot opening; no invented/inpainted pixels.'},'rotationDegrees':[-4,4],'measurementToleranceMasterPixels':5};write('geometry.json',geometry)
anchorL=[v/2 for v in anchor];pivotL=[v/2 for v in pivot]
parts=[{'name':'body','file':'exports/worker-working-body-r1.png','sourceSize':[768,768],'logicalSize':[384,384],'anchor':anchorL,'offset':[0,0],'rotationDegrees':0},{'name':'forearm-probe','file':'exports/worker-working-forearm-probe-r1.png','sourceSize':[768,768],'logicalSize':[384,384],'anchor':anchorL,'pivot':pivotL,'offset':[0,0],'maxRotationDegrees':4,'drawOrder':1}]
e=R/'exports/worker-working-assembled-r1.png';entry={'id':'mf.worker.standard.se.working','revision':1,'status':'pending-coordinator-motion-review','file':str(e.relative_to(R)),'sourceSize':[768,768],'logicalSize':[384,384],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':anchorL,'layer':'worker','occlusionClass':'actor','sockets':{'elbow':pivotL,'probeTip':[v/2 for v in tip]},'parts':parts,'motionContract':'Render body fixed. Place moving part in the same untrimmed frame and rotate around elbow pivot only, maximum±4degrees. Active-run only. Stop at0 and use assembled fallback for reduced motion; neutral/finished uses parked ID. Probe tip moves with part.','sha256':sha(e),'geometry':'geometry.json','qa':['qa/QA.md','qa/actual-scale-motion-r1.gif','qa/elbow-contact-r1.png','qa/alpha-backgrounds-r1.png','qa/registration-r1.png'],'limits':['Station contact requires renderer placement; no station is baked in.','Only elbow forearm/probe articulation, not a full skeleton.','At58px the motion is subtle; do not exaggerate beyond4degrees to force visibility.']};write('entry.json',entry)
write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-23b61b7a-46da-4c8a-b03f-89a905540a75','sourceSha256':sha(R/'source/working-master-r1.png'),'generationPrompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(R.parent/'mf.worker.standard.detail.neutral/exports/worker-standard-detail-neutral-r1.png'),'sha256':sha(R.parent/'mf.worker.standard.detail.neutral/exports/worker-standard-detail-neutral-r1.png')}],'correctiveGenerations':0,'transforms':['Green key/spill cleanup','Source pixel body/part masks with overlapping original elbow bearing','Uniform fit640visible height in768canvas','QA-only±4degree rotation;32frame GIF at62ms each'],'rightsNote':'Supplied generated project reference only. No external art introduced.'})
(R/'qa/QA.md').write_text('''# Working worker A0 r1 motion QA

Source body pose remains fixed. Actual generated forearm, hand and probe pixels are isolated around a visibly round elbow joint. Original elbow disk is retained in both layers to keep a covered mechanical bearing; no redraw or generated intermediate frames. Registered untrimmed frames use identical placement. Static assembled fallback retained.

Only moving part rotates±4degrees about measured elbow. GIF provides58px and200px visible worker height on fixed canvases. Inspect GIF playback, elbow-contact extreme sheet and dark/light/magenta alpha QA. Main renderer must register probe contact to station frontToolPort and gate activity on a real active run. Neutral/finished uses parked asset; no whole-body bob/stretch.

Pending coordinator motion and integrated scene review. This is not a full character rig. Hand/probe angle is a small diagnostic movement;58px overview motion is intentionally subtle.
''')
write('checksums.json',{str(p.relative_to(R)):sha(p) for p in sorted(R.rglob('*')) if p.is_file() and p.name!='checksums.json'})
print(json.dumps({'anchor':anchorL,'pivot':pivotL,'sha256':sha(e),'bounds':assembled.getbbox()}))
