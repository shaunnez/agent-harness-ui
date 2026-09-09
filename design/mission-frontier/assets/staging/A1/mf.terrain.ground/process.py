from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;A0=R.parents[1]/'A0'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
gen=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-378d1bc8-a186-4f42-83b2-e589891b99ad.png');shutil.copy2(gen,R/'source/ground-master-r1.png');m=Image.open(gen).convert('RGB');a=np.array(m).astype(float);ex=np.minimum(a[:,:,0],a[:,:,2])-a[:,:,1];alpha=1-np.clip((ex-20)/130,0,1)
for k in [0,2]:a[:,:,k]=np.where(ex>20,np.minimum(a[:,:,k],a[:,:,1]+20),a[:,:,k])
ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/ground-alpha-master-r1.png');cut.getchannel('A').save(R/'source/ground-alpha-mask-r1.png')
src=np.array([[717,198],[1419,530],[726,886],[37,528]],float);dst=np.array([[512,130],[962,355],[512,580],[62,355]],float)
def matrix(a,b):
 rows=[];v=[]
 for (x,y),(u,w) in zip(a,b):rows.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-w*x,-w*y]]);v.extend([u,w])
 return np.append(np.linalg.solve(rows,v),1).reshape(3,3)
H=matrix(src,dst);inv=np.linalg.inv(H);inv/=inv[2,2];out=cut.transform((1024,768),Image.Transform.PERSPECTIVE,inv.flatten()[:8],Image.Resampling.BICUBIC);a=np.array(out);ex=np.minimum(a[:,:,0],a[:,:,2]).astype(float)-a[:,:,1]
for k in [0,2]:a[:,:,k]=np.where(ex>20,np.minimum(a[:,:,k],a[:,:,1].astype(int)+20),a[:,:,k])
a[a[:,:,3]==0,:3]=0;out=Image.fromarray(a);e=R/'exports/terrain-ground-r1.png';out.save(e);out.getchannel('A').save(R/'source/registered-alpha-mask-r1.png')
def p(xy):
 v=H@np.array([*xy,1]);return(v[:2]/v[2]).tolist()
bottom=p([733,935]);write('geometry.json',{'masterDimensions':m.size,'masterSurfaceCorners':src.tolist(),'registeredSurfaceCorners':dst.tolist(),'groundAnchorSourcePixels':[512,580],'groundAnchorLogical':[256,290],'frontCliffBottomSourcePixels':bottom,'frontDropSourcePixels':bottom[1]-580,'registrationHomography':H.tolist(),'inverseHomography':inv.tolist(),'measurementNote':'Manual visible surface-corner landmarks within approximately8master pixels; organic rim is not a geometric sharp corner. Ground anchor is top surface, not cliff bottom. Exact registration retained for next shore derivation.'})
def bg(im,c):
 b=Image.new('RGBA',im.size,c);b.alpha_composite(im);return b.convert('RGB')
sheet=Image.new('RGB',(1536,412),'#071923');d=ImageDraw.Draw(sheet)
for i,c in enumerate(['#071923','#eef2f5','#d000cc']):sheet.paste(bg(out,c).resize((512,384)),(512*i,28));d.text((512*i+10,8),['Dark','Light','Magenta'][i],fill='white')
sheet.save(R/'qa/alpha-backgrounds-r1.png');reg=bg(out,'#071923');d=ImageDraw.Draw(reg);d.line([tuple(q) for q in dst]+[tuple(dst[0])],fill='#ffcc55',width=3);reg.save(R/'qa/surface-registration-r1.png')
proof=out.copy();base=Image.open(A0/'mf.base.standard.roof/qa/closed-compound-r1.png').convert('RGBA');sc=.275;base=base.resize((round(base.width*sc),round(base.height*sc)),Image.Resampling.LANCZOS);proof.alpha_composite(base,(round(512-768*sc),round(355-692*sc)))
w=Image.open(A0/'mf.worker.standard.se.neutral/exports/worker-standard-se-neutral-r1.png').convert('RGBA');w=w.crop(w.getbbox());w=w.resize((round(w.width*32/w.height),32),Image.Resampling.LANCZOS)
for x,y in [(390,460),(642,450)]:proof.alpha_composite(w,(x-w.width//2,y-32))
bg(proof,'#0b3440').save(R/'qa/overview-placement-r1.png')
entry={'id':'mf.terrain.ground','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[1024,768],'logicalSize':[512,384],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[256,290],'footprint':(dst/2).tolist(),'layer':'terrain','occlusionClass':'ground','sockets':{'center':[256,177.5]},'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/surface-registration-r1.png','qa/overview-placement-r1.png'],'limits':['Organic edge is not seamless. Connectors/shore remain separately assigned.','Flat top surface supports object placement; rim has no independent collision mesh.','No water/background outside plate.']};write('entry.json',entry)
write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-378d1bc8-a186-4f42-83b2-e589891b99ad','sourceSha256':sha(R/'source/ground-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(A0/'mf.terrain.region/source/terrain-region-master-attempt1.png'),'sha256':sha(A0/'mf.terrain.region/source/terrain-region-master-attempt1.png')}],'correctiveGenerations':0,'transforms':['Magenta key preserves green moss, source alpha mask retained','One projective registration from measured organic surface corners to900x450diamond','Post-resample spill cleanup, registered mask retained','QA-only independent base and two workers at overview dimensions'],'exportSha256':sha(e),'exportBytes':e.stat().st_size,'rightsNote':'Generated project reference only; no new external art.'})
(R/'qa/QA.md').write_text('''# Reusable ground plate A1 r1

1024×768 straight RGBA; logical512×384. Measured top surface landmarks registered to900×450source diamond, anchor front surface[512,580], logical[256,290]. Organic perimeter varies around these landmarks. Front rocky drop measured in geometry.json and is separate from the surface anchor.

Preserved original master, alpha master, alpha masks and exact registration for separately assigned shore derivation. No water or shadow matte outside plate. Magenta key protects green moss. No trees/buildings/roads baked in.

Overview placement proof assumes ground at2×logical size (one source pixel/world unit), base0.55×logical size, two32px overview workers. Each is independent and placed inside the clear top area. Texture remains static; no seamless connector promise. Pending coordinator review.
''')
write('qa/measurements-r1.json',{'alphaRange':out.getchannel('A').getextrema(),'alphaBounds':out.getbbox(),'borderNontransparent':int((a[[0,-1],:,3]>0).sum()+(a[:,[0,-1],3]>0).sum()),'frontDropSourcePixels':bottom[1]-580})
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps({'sha256':sha(e),'drop':bottom[1]-580,'bounds':out.getbbox()}))
