from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
g=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-86e92dab-2f45-4f8c-9dc2-f287a7b9e9d0.png');shutil.copy2(g,R/'source/rock-master-r1.png');m=Image.open(g).convert('RGB');a=np.array(m).astype(float);ex=np.minimum(a[:,:,0],a[:,:,2])-a[:,:,1];alpha=1-np.clip((ex-20)/130,0,1)
for k in [0,2]:a[:,:,k]=np.where(ex>20,np.minimum(a[:,:,k],a[:,:,1]+20),a[:,:,k])
ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/rock-alpha-master-r1.png');box=cut.getbbox();s=200/(box[2]-box[0]);size=(200,round((box[3]-box[1])*s));contact=[785,742];offset=(round(192-(contact[0]-box[0])*s),round(210-(contact[1]-box[1])*s));out=Image.new('RGBA',(384,256));out.alpha_composite(cut.crop(box).resize(size,Image.Resampling.LANCZOS),offset);a=np.array(out);a[a[:,:,3]==0,:3]=0;out=Image.fromarray(a);e=R/'exports/rock-r1.png';out.save(e)
def p(q):return [round(offset[k]+(q[k]-box[k])*s,4) for k in [0,1]]
anchor=[v/2 for v in p(contact)];fp=[p(q) for q in [[222,648],[790,520],[1349,645],[768,754]]];write('geometry.json',{'masterSize':m.size,'sourceAlphaBounds':box,'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'exportAlphaBounds':out.getbbox(),'groundAnchorLogical':anchor,'contactMaster':contact,'footprintSourcePixels':fp,'measurementNote':'Manual visible left/right/front rock-ground contacts; rear support point is hidden estimate. Anchor central low contact, not entire image bottom.','actualVisibleWidthLogical':100,'actualVisibleHeightLogical':size[1]/2})
qa=Image.new('RGB',(1152,284),'#16222c');d=ImageDraw.Draw(qa)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):
 b=Image.new('RGBA',out.size,c);b.alpha_composite(out);qa.paste(b.convert('RGB'),(384*i,28));d.text((384*i+8,8),['Dark','Light','Magenta'][i],fill='white')
qa.save(R/'qa/alpha-backgrounds-r1.png')
water=Image.open(R.parent/'mf.terrain.water/exports/terrain-water-r1.png').convert('RGBA');ground=Image.open(R.parent/'mf.terrain.ground/exports/terrain-ground-r1.png').convert('RGBA');scene=Image.new('RGBA',(1024,768))
for y in range(0,768,512):
 for x in range(0,1024,512):scene.alpha_composite(water,(x,y))
scene.alpha_composite(ground)
for scale,xy in [(.3,(190,390)),(.5,(380,480)),(.7,(790,400)),(1,(595,530))]:
 size2=(round(192*scale),round(128*scale));sm=out.resize(size2,Image.Resampling.LANCZOS);scene.alpha_composite(sm,(round(xy[0]-anchor[0]*scale),round(xy[1]-anchor[1]*scale)))
scene.convert('RGB').save(R/'qa/ground-instances-r1.png')
scales=Image.new('RGBA',(700,180),'#071923');d=ImageDraw.Draw(scales)
for i,scale in enumerate([.3,.5,.7,1]):
 sm=out.resize((round(192*scale),round(128*scale)),Image.Resampling.LANCZOS);scales.alpha_composite(sm,(i*175,20));d.text((i*175+10,150),f'{scale}x / {100*scale:.0f}px wide',fill='white')
scales.convert('RGB').save(R/'qa/actual-scales-r1.png')
entry={'id':'mf.prop.rock','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[384,256],'logicalSize':[192,128],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':anchor,'footprint':[[v/2 for v in q] for q in fp],'layer':'scenery-prop','occlusionClass':'low-prop','sockets':{},'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/ground-instances-r1.png','qa/actual-scales-r1.png'],'limits':['Rear footprint point estimated; no collision mesh.','Single static low cluster; no shadow or land tile.']};write('entry.json',entry)
ref=R.parent/'mf.terrain.ground/source/ground-master-r1.png';write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-86e92dab-2f45-4f8c-9dc2-f287a7b9e9d0','sourceSha256':sha(R/'source/rock-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(ref),'sha256':sha(ref)}],'derivativeDecision':'Ground-source rocks merge with shoreline rather than providing one complete bounded cluster, so authorized new generation used.','correctiveGenerations':0,'transforms':['Magenta key preserves moss','Uniform fit200source px wide','Register manually measured contact near192,210source','QA-only instances on accepted ground and water'],'exportSha256':sha(e),'exportBytes':e.stat().st_size})
(R/'qa/QA.md').write_text('''# Rock A1 r1

384×256RGBA/logical192×128. Visible100logical width and approximately44logical height; consumer0.3–0.7 gives30–70pxwide low cluster. Ground contact near[96,105], manual footprint rear point estimated. No mound/tile/water or cast shadow baked in.

Dark/light/magenta alpha and ground instances at0.3/0.5/0.7/1.0 provided. Sparse tiny moss matches terrain. Original source retained; pending coordinator review.
''')
write('qa/measurements-r1.json',{'mode':out.mode,'size':out.size,'alphaBounds':out.getbbox(),'borderNontransparent':int((a[[0,-1],:,3]>0).sum()+(a[:,[0,-1],3]>0).sum())});write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps({'anchor':anchor,'size':size,'sha256':sha(e)}))
