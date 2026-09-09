from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;A0=R.parents[1]/'A0'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
g=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-49fafed1-74fe-4e7e-9c99-95b4f97e778e.png');shutil.copy2(g,R/'source/cargo-master-r1.png');m=Image.open(g).convert('RGB');a=np.array(m).astype(float);ex=a[:,:,1]-np.maximum(a[:,:,0],a[:,:,2]);alpha=1-np.clip((ex-20)/130,0,1);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2])+10),a[:,:,1]);ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/cargo-alpha-master-r1.png');box=cut.getbbox();s=160/(box[2]-box[0]);size=(160,round((box[3]-box[1])*s));contact=[442,919];offset=(round(192-(contact[0]-box[0])*s),round(300-(contact[1]-box[1])*s));out=Image.new('RGBA',(384,384));out.alpha_composite(cut.crop(box).resize(size,Image.Resampling.LANCZOS),offset);a=np.array(out);a[a[:,:,3]==0,:3]=0;out=Image.fromarray(a);e=R/'exports/cargo-r1.png';out.save(e)
def p(q):return [round(offset[k]+(q[k]-box[k])*s,4) for k in [0,1]]
anchor=[v/2 for v in p(contact)];fp=[p(q) for q in [[146,768],[782,588],[1100,745],contact]];write('geometry.json',{'masterSize':m.size,'sourceAlphaBounds':box,'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'exportAlphaBounds':out.getbbox(),'groundAnchorLogical':anchor,'contactMaster':contact,'footprintSourcePixels':fp,'measurementNote':'Visible left/right/front ground contacts manually measured within6master pixels. Rear contact occluded estimate. Anchor is front ground-contact corner.','actualVisibleWidthLogical':80,'actualVisibleHeightLogical':size[1]/2})
qa=Image.new('RGB',(1152,412),'#16222c');d=ImageDraw.Draw(qa)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):
 b=Image.new('RGBA',out.size,c);b.alpha_composite(out);qa.paste(b.convert('RGB'),(384*i,28));d.text((384*i+8,8),['Dark','Light','Magenta'][i],fill='white')
qa.save(R/'qa/alpha-backgrounds-r1.png')
floor=Image.open(A0/'mf.base.standard.floor/exports/base-standard-floor-r1.png').convert('RGBA').resize((768,512),Image.Resampling.LANCZOS);scene=Image.new('RGBA',(768,512),'#071923');scene.alpha_composite(floor)
for scale,xy in [(.3,(180,240)),(.45,(310,280)),(.7,(430,330)),(1,(500,220))]:
 sm=out.resize((round(192*scale),round(192*scale)),Image.Resampling.LANCZOS);scene.alpha_composite(sm,(round(xy[0]-anchor[0]*scale),round(xy[1]-anchor[1]*scale)))
scene.convert('RGB').save(R/'qa/basefloor-instances-r1.png');scales=Image.new('RGBA',(800,180),'#071923');d=ImageDraw.Draw(scales)
for i,scale in enumerate([.3,.45,.7,1]):
 sm=out.resize((round(192*scale),round(192*scale)),Image.Resampling.LANCZOS);scales.alpha_composite(sm,(i*200,110-round(anchor[1]*scale)));d.text((i*200+10,150),f'{scale}x / {80*scale:.0f}px wide',fill='white')
scales.convert('RGB').save(R/'qa/actual-scales-r1.png')
entry={'id':'mf.prop.cargo','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[384,384],'logicalSize':[192,192],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':anchor,'footprint':[[v/2 for v in q] for q in fp],'layer':'task-prop','occlusionClass':'low-prop','sockets':{'handle':[v/2 for v in p([774,765])]},'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/basefloor-instances-r1.png','qa/actual-scales-r1.png'],'limits':['Display eligibility and interaction are runtime-owned: show only for task with retained artifacts. No evidence semantics baked into art.','No text/logo/status light, shadow, floor or opening animation.','Rear footprint point estimated.']};write('entry.json',entry)
ref=A0/'mf.station.fabrication/source/station-fabrication-master-r1.png';write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-49fafed1-74fe-4e7e-9c99-95b4f97e778e','sourceSha256':sha(R/'source/cargo-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(ref),'sha256':sha(ref)}],'correctiveGenerations':0,'transforms':['Green key/spill cleanup','Uniform fit160source pixels wide','Register front ground corner near192,300source','QA-only instances at consumer scales on accepted floor'],'exportSha256':sha(e),'exportBytes':e.stat().st_size})
(R/'qa/QA.md').write_text('''# Cargo A1 r1

384×384RGBA/logical192². Actualcase80logical wide; actualheight in geometry.json. Registered front ground corner near[96,150]. Closed ceramic/slate physical case with latches/handles, no text/digits/logo or semantic light.

Actual-size QA shows24px overview at0.3,36px at0.45,56px at0.7 plus1.0reference. No floor or shadow baked into export. Runtime owns interaction and must show cargo only for retained artifacts. Dark/light/magenta alpha and approved base-floor instances included. Pending coordinator review.
''')
write('qa/measurements-r1.json',{'mode':out.mode,'size':out.size,'alphaBounds':out.getbbox(),'borderNontransparent':int((a[[0,-1],:,3]>0).sum()+(a[:,[0,-1],3]>0).sum())});write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps({'anchor':anchor,'size':size,'sha256':sha(e)}))
