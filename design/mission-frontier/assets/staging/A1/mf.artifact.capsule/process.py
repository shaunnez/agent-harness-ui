from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;A0=R.parents[1]/'A0'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
g=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-e9aed8a2-bb88-429d-a9a6-f28817edadd5.png');shutil.copy2(g,R/'source/capsule-master-r1.png');m=Image.open(g).convert('RGBA');clean=np.array(m);clean[clean[:,:,3]<4]=0;cut=Image.fromarray(clean);cut.save(R/'source/capsule-alpha-master-r1.png');box=cut.getbbox();s=170/(box[3]-box[1]);size=(round((box[2]-box[0])*s),170);contact=[741,998];offset=(round(192-(contact[0]-box[0])*s),round(300-(contact[1]-box[1])*s));out=Image.new('RGBA',(384,384));out.alpha_composite(cut.crop(box).resize(size,Image.Resampling.LANCZOS),offset);a=np.array(out);a[a[:,:,3]==0,:3]=0;out=Image.fromarray(a);e=R/'exports/capsule-r1.png';out.save(e)
def p(q):return [round(offset[k]+(q[k]-box[k])*s,4) for k in [0,1]]
anchor=[v/2 for v in p(contact)];fp=[p(q) for q in [[510,905],[708,810],[918,911],contact]];write('geometry.json',{'masterSize':m.size,'sourceAlphaBounds':box,'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'exportAlphaBounds':out.getbbox(),'groundAnchorLogical':anchor,'contactMaster':contact,'footprintSourcePixels':fp,'measurementNote':'Visible left/right/front ground contacts manually measured within6master pixels. Rear contact occluded estimate. Anchor is front ground-contact corner.','actualVisibleWidthLogical':size[0]/2,'actualVisibleHeightLogical':size[1]/2})
qa=Image.new('RGB',(1152,412),'#16222c');d=ImageDraw.Draw(qa)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):
 b=Image.new('RGBA',out.size,c);b.alpha_composite(out);qa.paste(b.convert('RGB'),(384*i,28));d.text((384*i+8,8),['Dark','Light','Magenta'][i],fill='white')
qa.save(R/'qa/alpha-backgrounds-r1.png')
floor=Image.open(A0/'mf.base.standard.floor/exports/base-standard-floor-r1.png').convert('RGBA').resize((768,512),Image.Resampling.LANCZOS);scene=Image.new('RGBA',(768,512),'#071923');scene.alpha_composite(floor)
for scale,xy in [(.45,(180,240)),(.6,(310,280)),(.8,(430,330)),(1,(500,220))]:
 sm=out.resize((round(192*scale),round(192*scale)),Image.Resampling.LANCZOS);scene.alpha_composite(sm,(round(xy[0]-anchor[0]*scale),round(xy[1]-anchor[1]*scale)))
scene.convert('RGB').save(R/'qa/basefloor-instances-r1.png');scales=Image.new('RGBA',(800,180),'#071923');d=ImageDraw.Draw(scales)
for i,scale in enumerate([.45,.6,.8,1]):
 sm=out.resize((round(192*scale),round(192*scale)),Image.Resampling.LANCZOS);scales.alpha_composite(sm,(i*200,110-round(anchor[1]*scale)));d.text((i*200+10,150),f'{scale}x / {size[0]/2*scale:.0f}px wide',fill='white')
scales.convert('RGB').save(R/'qa/actual-scales-r1.png')
entry={'id':'mf.artifact.capsule','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[384,384],'logicalSize':[192,192],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':anchor,'footprint':[[v/2 for v in q] for q in fp],'layer':'task-prop','occlusionClass':'low-prop','sockets':{'glassInset':[v/2 for v in p([630,520])]},'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/basefloor-instances-r1.png','qa/actual-scales-r1.png'],'limits':['Runtime binds capsule to one retained artifact and opens evidence. No progress or autonomous travel implied.','No text/logo/status symbols, shadow, floor or opening animation. Blue glass is non-semantic material; metallic brass fittings are not lights.','Rear footprint point estimated.']};write('entry.json',entry)
ref=A0/'mf.station.fabrication/source/station-fabrication-master-r1.png';write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-e9aed8a2-bb88-429d-a9a6-f28817edadd5','sourceSha256':sha(R/'source/capsule-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(ref),'sha256':sha(ref)}],'correctiveGenerations':0,'transforms':['Preserve generated real RGBA alpha; discard sub4/255 alpha background specks before bounds, no chroma key','Uniform fit170source pixels high','Register front ground corner near192,300source','QA-only instances at consumer scales on accepted floor'],'exportSha256':sha(e),'exportBytes':e.stat().st_size})
(R/'qa/QA.md').write_text('''# Capsule A1 r1

384×384RGBA/logical192². Actual capsule width/height measured in geometry.json; uniform170source-pixel height. Registered front ground corner near[96,150]. Upright sealed ceramic/slate data capsule with subtle blue glass, no text/digits/logo or semantic light.

Actual-size QA shows0.45/0.6/0.8 and1.0detail scale. No floor or shadow baked into export. Runtime owns retained-artifact evidence interaction; no autonomous motion implied. Dark/light/magenta alpha and approved base-floor instances included. Pending coordinator review.
''')
write('qa/measurements-r1.json',{'mode':out.mode,'size':out.size,'alphaBounds':out.getbbox(),'borderNontransparent':int((a[[0,-1],:,3]>0).sum()+(a[:,[0,-1],3]>0).sum())});write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps({'anchor':anchor,'size':size,'sha256':sha(e)}))
