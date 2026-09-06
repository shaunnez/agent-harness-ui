from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;A0=R.parents[1]/'A0'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
g=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-09133dc9-0333-4c15-8868-e599c7564075.png');shutil.copy2(g,R/'source/purple-tree-master-r1.png');m=Image.open(g).convert('RGB');a=np.array(m).astype(float);ex=a[:,:,1]-np.maximum(a[:,:,0],a[:,:,2]);alpha=1-np.clip((ex-20)/130,0,1);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2])+10),a[:,:,1]);ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/purple-tree-alpha-master-r1.png');cut.getchannel('A').save(R/'source/purple-tree-alpha-mask-r1.png');box=cut.getbbox();s=560/(box[3]-box[1]);size=(round((box[2]-box[0])*s),560);root=[675,1156];offset=(round(384-(root[0]-box[0])*s),round(684-(root[1]-box[1])*s));out=Image.new('RGBA',(768,768));out.alpha_composite(cut.crop(box).resize(size,Image.Resampling.LANCZOS),offset);a=np.array(out);ex=a[:,:,1].astype(float)-np.maximum(a[:,:,0],a[:,:,2]);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2]).astype(int)+10),a[:,:,1]);a[a[:,:,3]==0,:3]=0;out=Image.fromarray(a);e=R/'exports/purple-tree-r1.png';out.save(e)
anchor=[(offset[k]+(root[k]-box[k])*s)/2 for k in [0,1]]
write('geometry.json',{'masterDimensions':list(m.size),'masterAlphaBounds':box,'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'exportAlphaBounds':out.getbbox(),'rootContactMaster':root,'groundAnchorLogical':anchor,'rootMeasurementMethod':'Manual central trunk/root-ground contact estimate within8master pixels; broad root tips extend slightly below anchor.','actualVisibleHeightLogical':(out.getbbox()[3]-out.getbbox()[1])/2,'actualCanopyWidthLogical':(out.getbbox()[2]-out.getbbox()[0])/2,'shadow':'No cast shadow supplied; independent ground contact shadow is renderer-owned if needed.'})
def bg(im,col):
 p=Image.new('RGBA',im.size,col);p.alpha_composite(im);return p.convert('RGB')
sheet=Image.new('RGB',(1536,540),'#16222c');d=ImageDraw.Draw(sheet)
for i,col in enumerate(['#071923','#f0f3f5','#d000cc']):sheet.paste(bg(out,col).resize((512,512)),(i*512,28));d.text((i*512+8,8),['Dark','Light','Magenta'][i],fill='white')
sheet.save(R/'qa/alpha-backgrounds-r1.png')
water=Image.open(R.parent/'mf.terrain.water/exports/terrain-water-r1.png').convert('RGBA');ground=Image.open(R.parent/'mf.terrain.ground/exports/terrain-ground-r1.png').convert('RGBA');scene=Image.new('RGBA',(1536,900))
for yy in range(0,900,512):
 for xx in range(0,1536,512):scene.alpha_composite(water,(xx,yy))
scene.alpha_composite(ground,(256,120))
instances=[(.35,(450,490)),(.5,(630,370)),(.65,(1000,520)),(.8,(790,650))]
for scale,(gx,gy) in instances:
 f=scale/2;sz=round(768*f);small=out.resize((sz,sz),Image.Resampling.LANCZOS);scene.alpha_composite(small,(round(gx-anchor[0]*scale),round(gy-anchor[1]*scale)))
scene.convert('RGB').save(R/'qa/ground-water-instances-r1.png')
scales=Image.new('RGBA',(1000,320),'#071923');d=ImageDraw.Draw(scales)
for i,scale in enumerate([.35,.5,.65,.8]):
 sz=round(384*scale);sm=out.resize((sz,sz),Image.Resampling.LANCZOS);scales.alpha_composite(sm,(20+i*245,280-round(anchor[1]*scale)));d.text((20+i*245,300),f'{scale}x / {280*scale:.0f}px tree',fill='white')
scales.convert('RGB').save(R/'qa/actual-scales-r1.png')
metrics={'size':out.size,'mode':out.mode,'alphaBounds':out.getbbox(),'transparentPixels':int((a[:,:,3]==0).sum()),'partialAlphaPixels':int(((a[:,:,3]>0)&(a[:,:,3]<255)).sum()),'borderNontransparent':int((a[[0,-1],:,3]>0).sum()+(a[:,[0,-1],3]>0).sum()),'greenDominantVisiblePixels':int((((a[:,:,1].astype(float)-np.maximum(a[:,:,0],a[:,:,2]))>30)&(a[:,:,3]>16)).sum())};write('qa/measurements-r1.json',metrics)
entry={'id':'mf.prop.purple-tree','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[768,768],'logicalSize':[384,384],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':anchor,'layer':'scenery-prop','occlusionClass':'foliage','sockets':{'root':anchor},'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/ground-water-instances-r1.png','qa/actual-scales-r1.png','qa/measurements-r1.json'],'limits':['Natural canopy is broader than nominal target, approximately300logical wide and280logical tall; uniform scale preserves branches.','One static tree instance, repeated silhouette recognizable. No foliage animation or shadow asset.','Canopy can occlude workers; renderer owns depth/placement.']};write('entry.json',entry)
refs=[Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/reference/selected-world.png'),A0/'mf.terrain.region/source/terrain-region-master-attempt1.png'];write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-09133dc9-0333-4c15-8868-e599c7564075','sourceSha256':sha(R/'source/purple-tree-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(p),'sha256':sha(p)} for p in refs],'correctiveGenerations':0,'transforms':['Green chroma alpha/spill cleanup including branch openings','Uniform resample to560source pixel height preserving natural canopy width','Register measured root near[384,684]source','QA-only instances on accepted ground/water at consumer scales'],'exportSha256':sha(e),'exportBytes':e.stat().st_size})
(R/'qa/QA.md').write_text('''# Purple tree A1 r1

Natural lavender/plum clustered canopy and rugged trunk/root contact.768×768RGBA, logical384². Uniform fit preserves natural branching: actual silhouette approximately300logical wide×280high, broader/shorter than nominal260×300target. Ground anchor is measured root center near[192,342], not image bounds.

Genuine alpha removes flat green including branch gaps; no matte, pot, land tile or cast shadow. Inspect dark/light/magenta foliage edges and exact consumer sizes:0.35≈98px,0.5≈140px,0.65≈182px,0.8≈224px. Multiple identical instances on accepted ground+water are QA-only. Repetition/occlusion remains scene placement concern. Pending coordinator review.
''')
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps({'sha256':sha(e),'anchor':anchor,'bounds':out.getbbox(),'size':size,'metrics':metrics}))
