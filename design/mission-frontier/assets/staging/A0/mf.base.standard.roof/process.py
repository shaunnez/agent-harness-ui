from pathlib import Path
import json,shutil
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parent
GEN=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-6d4b39ed-52e8-43ea-9691-49f66bdd9a19.png')
MASTER=ROOT/'source/base-standard-roof-master-r1.png'
if not MASTER.exists():shutil.copy2(GEN,MASTER)
im=Image.open(MASTER).convert('RGB');rgb=np.array(im).astype(float);ex=rgb[:,:,1]-np.maximum(rgb[:,:,0],rgb[:,:,2]);alpha=1-np.clip((ex-20)/170,0,1);rgb[:,:,1]=np.where(ex>20,np.minimum(rgb[:,:,1],np.maximum(rgb[:,:,0],rgb[:,:,2])+10),rgb[:,:,1]);rgba=np.dstack((rgb,alpha*255)).clip(0,255).astype(np.uint8);rgba[rgba[:,:,3]==0,:3]=0;cut=Image.fromarray(rgba);cut.save(ROOT/'source/base-standard-roof-alpha-master-r1.png')
src=np.array([[687,152],[1333,498],[687,856],[43,498]],dtype=float);dst=np.array([[768,120],[1472,472],[768,824],[64,472]],dtype=float)
A=[];B=[]
for (x,y),(u,v) in zip(src,dst):A.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);B.extend([u,v])
H=np.append(np.linalg.solve(A,B),1).reshape(3,3);inv=np.linalg.inv(H);inv/=inv[2,2]
out=cut.transform((1536,1280),Image.Transform.PERSPECTIVE,inv.flatten()[:8],Image.Resampling.BICUBIC);arr=np.array(out);ex=arr[:,:,1].astype(float)-np.maximum(arr[:,:,0],arr[:,:,2]);arr[:,:,1]=np.where(ex>20,np.minimum(arr[:,:,1],np.maximum(arr[:,:,0],arr[:,:,2]).astype(int)+10),arr[:,:,1]);arr[arr[:,:,3]==0,:3]=0;out=Image.fromarray(arr);exp=ROOT/'exports/base-standard-roof-r1.png';out.save(exp)
def project(p):
    q=H@np.array([*p,1]);return (q[:2]/q[2]).round(4).tolist()
basepath=Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/assets/staging/A0/mf.base.standard.front/qa/compound-composite-r1.png');opened=Image.open(basepath).convert('RGBA');closed=opened.copy();closed.alpha_composite(out);closed.save(ROOT/'qa/closed-compound-r1.png')
def bg(im,color,size):
    plate=Image.new('RGBA',size,color);plate.alpha_composite(im.resize(size,Image.Resampling.LANCZOS));return plate.convert('RGB')
sheet=Image.new('RGB',(1536,464),'#22303a');d=ImageDraw.Draw(sheet)
for i,(name,col) in enumerate([('Dark','#071923'),('Light','#f0f3f5'),('Magenta','#d000cc')]):sheet.paste(bg(out,col,(512,427)),(i*512,28));d.text((i*512+12,8),name+' / roof only',fill='white')
sheet.save(ROOT/'qa/alpha-backgrounds-r1.png');bg(closed,'#071923',(384,320)).save(ROOT/'qa/closed-overview-r1.png')
comp=Image.new('RGB',(1536,668),'#071923');comp.paste(bg(closed,'#071923',(768,640)),(0,28));comp.paste(bg(opened,'#071923',(768,640)),(768,28));d=ImageDraw.Draw(comp);d.text((18,8),'Closed compound / tall backr2 beneath',fill='white');d.text((786,8),'Roof removed / same physical registration',fill='white');comp.save(ROOT/'qa/closed-open-logical-scale-r1.png')
overview=Image.new('RGB',(768,348),'#071923');overview.paste(bg(closed,'#071923',(384,320)),(0,28));overview.paste(bg(opened,'#071923',(384,320)),(384,28));d=ImageDraw.Draw(overview);d.text((16,8),'Closed / overview50%logical',fill='white');d.text((400,8),'Open / same camera',fill='white');overview.save(ROOT/'qa/closed-open-overview-r1.png')
geo={'sourceCanvas':list(im.size),'exportCanvas':[1536,1280],'logicalCanvas':[768,640],'commonAnchorSource':[768,1044],'commonAnchorLogical':[384,522],'floorSurfaceCornersSource':[[768,340],[1472,692],[768,1044],[64,692]],'sourceRoofDeckCornersApprox':src.tolist(),'registeredRoofDeckCorners':dst.tolist(),'sourceFrontLowerFasciaApprox':[687,967],'registeredFrontLowerFasciaApprox':project([687,967]),'sourceToExportHomography':H.tolist(),'exportToSourceCoefficients':inv.flatten()[:8].tolist(),'alphaBounds':out.getbbox(),'landmarkMethod':'Manual visible deck perimeter/chamfer landmarks, estimated within5source pixels; one projective registration. Hidden rear underside is not directly measurable. Composite validation required.','heightConvention':'Deck perimeter is220source pixels above corresponding floor. Generated lower fascia is deeper than requested26px, measured separately.'};(ROOT/'geometry.json').write_text(json.dumps(geo,indent=2)+'\n')
stats={'size':list(out.size),'mode':out.mode,'alphaRange':out.getchannel('A').getextrema(),'transparentPixels':int((arr[:,:,3]==0).sum()),'partialAlphaPixels':int(((arr[:,:,3]>0)&(arr[:,:,3]<255)).sum()),'borderNontransparent':int((arr[[0,-1],:,3]>0).sum()+(arr[:,[0,-1],3]>0).sum()),'greenDominantVisiblePixels':int(((arr[:,:,1].astype(float)-np.maximum(arr[:,:,0],arr[:,:,2])>30)&(arr[:,:,3]>16)).sum()),'pngBytes':exp.stat().st_size,'decodedRgbaBytes':1536*1280*4};(ROOT/'qa/measurements-r1.json').write_text(json.dumps(stats,indent=2)+'\n');print(json.dumps({'geometry':geo,'stats':stats}))
