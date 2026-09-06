from pathlib import Path
import hashlib, json, shutil
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parent
GENERATED=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-c871c81d-2430-4acf-a75b-ef3aa2c40860.png')
MASTER=ROOT/'source/base-standard-floor-master-r1.png'
if not MASTER.exists(): shutil.copy2(GENERATED,MASTER)
im=Image.open(MASTER).convert('RGB');rgb=np.array(im).astype(float)
ex=rgb[:,:,1]-np.maximum(rgb[:,:,0],rgb[:,:,2]);alpha=1-np.clip((ex-20)/170,0,1)
rgb[:,:,1]=np.where(ex>20,np.minimum(rgb[:,:,1],np.maximum(rgb[:,:,0],rgb[:,:,2])+10),rgb[:,:,1])
rgba=np.dstack((rgb,alpha*255)).clip(0,255).astype(np.uint8);rgba[rgba[:,:,3]==0,:3]=0
cutout=Image.fromarray(rgba);cutout.save(ROOT/'source/base-standard-floor-alpha-master-r1.png')
# Manually measured visible top-rim corner intersections, source pixels.
# Tiny chamfer apex is extrapolated from the adjacent long straight edge.
src=np.array([[767,51],[1508,460],[768,934],[29,461]],dtype=float)
dst=np.array([[768,140],[1472,492],[768,844],[64,492]],dtype=float)
def homography(a,b):
    A=[]; B=[]
    for (x,y),(u,v) in zip(a,b):
        A.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);B.extend([u,v])
    return np.append(np.linalg.solve(A,B),1).reshape(3,3)
H=homography(src,dst); inverse=np.linalg.inv(H);inverse/=inverse[2,2]
out=cutout.transform((1536,1024),Image.Transform.PERSPECTIVE,inverse.flatten()[:8],Image.Resampling.BICUBIC)
arr=np.array(out);extra=arr[:,:,1].astype(float)-np.maximum(arr[:,:,0],arr[:,:,2]);arr[:,:,1]=np.where(extra>20,np.minimum(arr[:,:,1],np.maximum(arr[:,:,0],arr[:,:,2]).astype(int)+10),arr[:,:,1]);arr[arr[:,:,3]==0,:3]=0
out=Image.fromarray(arr);export=ROOT/'exports/base-standard-floor-r1.png';out.save(export)
def project(p):
    q=H@np.array([*p,1]);return (q[:2]/q[2]).round(4).tolist()
geometry={'sourceCanvas':list(im.size),'exportCanvas':[1536,1024],'logicalCanvas':[768,512],'cornerOrder':['back','right','front','left'],'sourceSurfaceCorners':src.tolist(),'targetSurfaceCorners':dst.tolist(),'sourceFrontBottomBevel':[768,985],'registeredFrontBottomBevel':project([768,985]),'sourceToExportHomography':H.tolist(),'exportToSourcePerspectiveCoefficients':inverse.flatten()[:8].tolist(),'exportAlphaBounds':out.getbbox(),'method':'Visually measured top perimeter corner intersections on generated raster, then one projective registration to the specified diamond. Corner estimate tolerance +/-3 source pixels, retained for scene review. No inferred 3D geometry.','groundAnchorRequested':[768,844],'anchorConvention':'Front top-surface corner, as assigned. Physical bevel extends below this anchor.'}
geometry['frontBevelVerticalOffsetExport']=round(geometry['registeredFrontBottomBevel'][1]-844,4)
(ROOT/'geometry.json').write_text(json.dumps(geometry,indent=2)+'\n')
def composite(color,size):
    small=out.resize(size,Image.Resampling.LANCZOS);bg=Image.new('RGBA',size,color);bg.alpha_composite(small);return bg.convert('RGB')
sheet=Image.new('RGB',(1536,378),'#22303a');d=ImageDraw.Draw(sheet)
for i,(name,color) in enumerate([('Dark','#071923'),('Light','#f0f3f5'),('Magenta','#d000cc')]):
    sheet.paste(composite(color,(512,341)),(512*i,28));d.text((512*i+12,8),name+' / export at 1:3',fill='white')
sheet.save(ROOT/'qa/alpha-backgrounds-r1.png')
composite('#071923',(768,512)).save(ROOT/'qa/hq-logical-scale-r1.png')
composite('#071923',(384,256)).save(ROOT/'qa/overview-scale-r1.png')
register=Image.new('RGBA',(1536,1024),'#071923');register.alpha_composite(out);d=ImageDraw.Draw(register)
points=[tuple(p) for p in dst];d.line(points+[points[0]],fill='#ffb64c',width=2)
for label,(x,y) in zip(geometry['cornerOrder'],points):
    d.ellipse((x-5,y-5,x+5,y+5),outline='#61d7ff',width=2);d.text((min(x+8,1370),y-18),label+' '+str((int(x),int(y))),fill='white')
bottom=geometry['registeredFrontBottomBevel'];d.line((768,844,bottom[0],bottom[1]),fill='#61d7ff',width=2)
d.text((20,20),'Orange: registered surface diamond. Cyan front line: physical bevel depth.',fill='white');register.convert('RGB').save(ROOT/'qa/registered-corners-r1.png')
source_qa=im.copy();d=ImageDraw.Draw(source_qa)
for label,(x,y) in zip(geometry['cornerOrder'],src):
    d.ellipse((x-7,y-7,x+7,y+7),outline='#ff0080',width=3);d.text((min(x+8,1380),max(y-20,0)),label+' '+str((int(x),int(y))),fill='black')
source_qa.save(ROOT/'qa/source-corner-measurements-r1.png')
qa={'mode':out.mode,'size':list(out.size),'alphaRange':out.getchannel('A').getextrema(),'transparentPixels':int((arr[:,:,3]==0).sum()),'partialAlphaPixels':int(((arr[:,:,3]>0)&(arr[:,:,3]<255)).sum()),'borderNontransparent':int((arr[[0,-1],:,3]>0).sum()+(arr[:,[0,-1],3]>0).sum()),'greenDominantVisiblePixels':int(((arr[:,:,1].astype(float)-np.maximum(arr[:,:,0],arr[:,:,2])>30)&(arr[:,:,3]>16)).sum()),'decodedRgbaBytes':1536*1024*4,'pngBytes':export.stat().st_size}
(ROOT/'qa/measurements-r1.json').write_text(json.dumps(qa,indent=2)+'\n')
print(json.dumps({'geometry':geometry,'qa':qa}))
