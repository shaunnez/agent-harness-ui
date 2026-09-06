from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;A0=R.parents[1]/'A0'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
g=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-3431a31d-cbaa-4ef7-a16a-077068f7e7b3.png');shutil.copy2(g,R/'source/worker-sw-master-r1.png');m=Image.open(g).convert('RGB');a=np.array(m).astype(float);ex=a[:,:,1]-np.maximum(a[:,:,0],a[:,:,2]);alpha=1-np.clip((ex-20)/130,0,1);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2])+10),a[:,:,1]);ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/worker-sw-alpha-master-r1.png');box=cut.getbbox();s=312/(box[3]-box[1]);size=(round((box[2]-box[0])*s),312);offset=(round(192-(589-box[0])*s),28);out=Image.new('RGBA',(384,384));out.alpha_composite(cut.crop(box).resize(size,Image.Resampling.LANCZOS),offset);a=np.array(out);ex=a[:,:,1].astype(float)-np.maximum(a[:,:,0],a[:,:,2]);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2]).astype(int)+10),a[:,:,1]);a[a[:,:,3]==0,:3]=0;out=Image.fromarray(a);e=R/'exports/worker-standard-sw-neutral-r1.png';out.save(e)
def p(q):return [round(offset[k]+(q[k]-box[k])*s,4) for k in [0,1]]
soles=[p([500,1074]),p([678,1130])];anchor=[sum(q[k] for q in soles)/4 for k in [0,1]];write('geometry.json',{'masterSize':m.size,'masterAlphaBounds':box,'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'exportAlphaBounds':out.getbbox(),'soleContactMaster':[[500,1074],[678,1130]],'soleContactsSourcePixels':soles,'groundAnchorLogical':anchor,'measurementMethod':'Manual lower-sole contact centers within6master pixels; anchor midpoint of the two measured contacts.','visibleHeightSourcePixels':312,'fullCanvasAt58VisiblePixels':384*58/312})
qa=Image.new('RGB',(1152,412),'#16222c');d=ImageDraw.Draw(qa)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):
 b=Image.new('RGBA',out.size,c);b.alpha_composite(out);qa.paste(b.convert('RGB'),(384*i,28));d.text((384*i+8,8),['Dark','Light','Magenta'][i],fill='white')
qa.save(R/'qa/alpha-backgrounds-r1.png')
sePath=A0/'mf.worker.standard.se.neutral/exports/worker-standard-se-neutral-r1.png';se=Image.open(sePath).convert('RGBA');compare=Image.new('RGBA',(700,300),'#071923');d=ImageDraw.Draw(compare)
for i,(name,w) in enumerate([('SE accepted',se),('SW new',out)]):
 b=w.getbbox();crop=w.crop(b)
 for j,height in enumerate([58,80,156]):
  sm=crop.resize((round(crop.width*height/crop.height),height),Image.Resampling.LANCZOS);pos=(40+i*340+j*95,240-height);compare.alpha_composite(sm,pos);d.text((pos[0],255),str(height)+'px',fill='white')
 d.text((40+i*340,20),name,fill='white')
compare.convert('RGB').save(R/'qa/both-facings-actual-scale-r1.png')
floor=Image.open(A0/'mf.base.standard.floor/exports/base-standard-floor-r1.png').convert('RGBA').resize((768,512),Image.Resampling.LANCZOS);scene=Image.new('RGBA',(768,512),'#071923');scene.alpha_composite(floor)
for i,(w,an) in enumerate([(se,[103.875,163.8765]),(out,anchor)]):
 for j,h in enumerate([58,80]):
  scale=h/156;sz=round(192*scale);sm=w.resize((sz,sz),Image.Resampling.LANCZOS);gx=280+i*150;gy=260+j*100;scene.alpha_composite(sm,(round(gx-an[0]*scale),round(gy-an[1]*scale)))
scene.convert('RGB').save(R/'qa/basefloor-contact-r1.png')
entry={'id':'mf.worker.standard.sw.neutral','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[384,384],'logicalSize':[192,192],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':anchor,'footprint':[[v/2 for v in q] for q in soles],'footprintUse':'Two measured sole centers; not a full collision polygon.','layer':'worker','occlusionClass':'actor','sockets':{'face':[v/2 for v in p([540,345])]},'facing':'SW screen lower left','sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/both-facings-actual-scale-r1.png','qa/basefloor-contact-r1.png'],'limits':['One neutral parked pose; no active motion, tool or portrait variant.','New opposite-facing render preserves identity but is not pixel-mirrored anatomy.','Runtime owns selection/task state and neutral-versus-active semantics.']};write('entry.json',entry)
write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-3431a31d-cbaa-4ef7-a16a-077068f7e7b3','sourceSha256':sha(R/'source/worker-sw-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(sePath),'sha256':sha(sePath)}],'correctiveGenerations':0,'transforms':['Green alpha/spill cleanup','Uniform fit312source visible height matching SE','Register manually measured sole-contact midpoint','QA-only both facings on accepted floor at58/80px'],'exportSha256':sha(e),'exportBytes':e.stat().st_size})
(R/'qa/QA.md').write_text('''# SW neutral worker A1 r1

384×384RGBA/logical192²; visible312source pixels matches accepted SE overview worker. Same ceramic/dark-joint friendly blue-eye identity, SW three-quarter front facing, planted neutral feet. New ImageGen render keeps upper-left illumination rather than blindly mirroring lighting.

Measured sole-midpoint anchor in geometry.json. Both-facings actual-scale QA includes58/80/156px visible height, plus floor contact at58/80. Dark/light/magenta alpha inspected; no floor/shadow/tool/status/name baked into asset. Pending coordinator review. Final assigned A1 worker only; no other variant.
''')
write('qa/measurements-r1.json',{'mode':out.mode,'size':out.size,'alphaBounds':out.getbbox(),'visibleHeight':out.getbbox()[3]-out.getbbox()[1],'borderNontransparent':int((a[[0,-1],:,3]>0).sum()+(a[:,[0,-1],3]>0).sum()),'greenDominantVisiblePixels':int((((a[:,:,1].astype(float)-np.maximum(a[:,:,0],a[:,:,2]))>30)&(a[:,:,3]>16)).sum())});write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps({'anchor':anchor,'size':size,'sha256':sha(e)}))
