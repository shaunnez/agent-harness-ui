from pathlib import Path
import json,shutil
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parent
GEN=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-89f74e05-a783-4b4d-8430-4d296793336b.png')
MASTER=ROOT/'source/base-standard-front-master-r1.png'
if not MASTER.exists():shutil.copy2(GEN,MASTER)
im=Image.open(MASTER).convert('RGB');rgb=np.array(im).astype(float)
ex=rgb[:,:,1]-np.maximum(rgb[:,:,0],rgb[:,:,2]);alpha=1-np.clip((ex-20)/170,0,1);rgb[:,:,1]=np.where(ex>20,np.minimum(rgb[:,:,1],np.maximum(rgb[:,:,0],rgb[:,:,2])+10),rgb[:,:,1]);rgba=np.dstack((rgb,alpha*255)).clip(0,255).astype(np.uint8);rgba[rgba[:,:,3]==0,:3]=0
cut=Image.fromarray(rgba);cut.save(ROOT/'source/base-standard-front-alpha-master-r1.png')
out=Image.new('RGBA',(1536,1280));coeffs={};height_scale=.90
# Each generated disconnected segment is registered to its own front edge.
for name,source_range,target_range,source_intercept,source_slope,target_intercept,target_slope,region in [
 ('left',(53,486),(64,500),635.2,.48,660,.5,(0,0,768,1280)),
 ('right',(893,1323),(1036,1472),1295,-.48,1428,-.5,(768,0,1536,1280))]:
    sx=(target_range[1]-target_range[0])/(source_range[1]-source_range[0]);xoff=source_range[0]-target_range[0]/sx
    cf=[1/sx,0,xoff,source_slope/sx-target_slope/height_scale,1/height_scale,source_intercept+source_slope*xoff-target_intercept/height_scale]
    warped=cut.transform((1536,1280),Image.Transform.AFFINE,cf,Image.Resampling.BICUBIC);out.paste(warped.crop(region),region[:2]);coeffs[name]=cf
arr=np.array(out);ex=arr[:,:,1].astype(float)-np.maximum(arr[:,:,0],arr[:,:,2]);arr[:,:,1]=np.where(ex>20,np.minimum(arr[:,:,1],np.maximum(arr[:,:,0],arr[:,:,2]).astype(int)+10),arr[:,:,1]);arr[arr[:,:,3]==0,:3]=0;out=Image.fromarray(arr);export=ROOT/'exports/base-standard-front-r1.png';out.save(export)
prior=Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/assets/staging/A0/mf.base.standard.back')
base=Image.open(prior/'qa/floor-back-composite-r2.png').convert('RGBA');assembly=base.copy();assembly.alpha_composite(out);assembly.save(ROOT/'qa/compound-composite-r1.png')
def bg(im,col,size):
    plate=Image.new('RGBA',size,col);plate.alpha_composite(im.resize(size,Image.Resampling.LANCZOS));return plate.convert('RGB')
bg(assembly,'#071923',(768,640)).save(ROOT/'qa/hq-compound-logical-scale-r1.png')
sheet=Image.new('RGB',(1536,464),'#22303a');d=ImageDraw.Draw(sheet)
for i,(name,color) in enumerate([('Dark','#071923'),('Light','#f0f3f5'),('Magenta','#d000cc')]):sheet.paste(bg(out,color,(512,427)),(512*i,28));d.text((512*i+12,8),name+' / front only',fill='white')
sheet.save(ROOT/'qa/alpha-backgrounds-r1.png')
# Place two copies of the approved worker on the logical floor before the front layer.
workerpath=Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/assets/staging/A0/mf.worker.standard.se.neutral/exports/worker-standard-se-neutral-r1.png')
worker=Image.open(workerpath).convert('RGBA');wb=worker.getbbox();worker=worker.crop(wb);worker=worker.resize((round(worker.width*58/worker.height),58),Image.Resampling.LANCZOS)
worker_anchor=[(207.75-wb[0])*58/(wb[3]-wb[1]),(327.753-wb[1])*58/(wb[3]-wb[1])]
scene=base.resize((768,640),Image.Resampling.LANCZOS);positions=[(205,405),(385,465)];offsets=[]
for x,y in positions:
    at=(round(x-worker_anchor[0]),round(y-worker_anchor[1]));offsets.append(at);scene.alpha_composite(worker,at)
normal=scene.copy();front=out.resize((768,640),Image.Resampling.LANCZOS);normal.alpha_composite(front)
faded=scene.copy();dim=front.copy();dim.putalpha(dim.getchannel('A').point(lambda v:round(v*.30)));faded.alpha_composite(dim)
compare=Image.new('RGB',(1536,668),'#071923');compare.paste(bg(normal,'#071923',(768,640)),(0,28));compare.paste(bg(faded,'#071923',(768,640)),(768,28));d=ImageDraw.Draw(compare);d.text((18,8),'Two58px workers / normal front occlusion',fill='white');d.text((786,8),'QA only: front at30% opacity / selected-worker visibility',fill='white');compare.save(ROOT/'qa/two-workers-occlusion-r1.png')
wa=np.array(worker)[:,:,3].astype(float)/255;fa=np.array(front)[:,:,3].astype(float)/255
visible=[]
for at in offsets:
    x,y=at;block=fa[y:y+worker.height,x:x+worker.width];visible.append(round(float((wa*(1-block)).sum()/wa.sum()),4))
measure={'size':list(out.size),'mode':out.mode,'alphaRange':out.getchannel('A').getextrema(),'transparentPixels':int((arr[:,:,3]==0).sum()),'partialAlphaPixels':int(((arr[:,:,3]>0)&(arr[:,:,3]<255)).sum()),'borderNontransparent':int((arr[[0,-1],:,3]>0).sum()+(arr[:,[0,-1],3]>0).sum()),'greenDominantVisiblePixels':int(((arr[:,:,1].astype(float)-np.maximum(arr[:,:,0],arr[:,:,2])>30)&(arr[:,:,3]>16)).sum()),'centralOpeningRegion':{'sourceRect':[502,780,1034,1150],'nontransparentPixels':int((arr[780:1150,502:1034,3]>0).sum())},'workerFootPositionsLogical':positions,'workerVisibleHeightPx':58,'workerAlphaVisibleFractions':visible,'pngBytes':export.stat().st_size,'decodedRgbaBytes':1536*1280*4};(ROOT/'qa/measurements-r1.json').write_text(json.dumps(measure,indent=2)+'\n')
geo={'sourceCanvas':list(im.size),'exportCanvas':[1536,1280],'logicalCanvas':[768,640],'commonAnchorSource':[768,1044],'commonAnchorLogical':[384,522],'floorSurfaceCornersSource':[[768,340],[1472,692],[768,1044],[64,692]],'sourceSegmentXBounds':{'left':[53,486],'right':[893,1323]},'targetSegmentXBounds':{'left':[64,500],'right':[1036,1472]},'sourceLowerFootLine':{'left':{'yIntercept':635.2,'xSlope':.48},'right':{'yIntercept':1295,'xSlope':-.48}},'targetFrontEdgeLine':{'left':{'yIntercept':660,'xSlope':.5},'right':{'yIntercept':1428,'xSlope':-.5}},'heightScale':height_scale,'inverseAffineCoefficients':coeffs,'alphaBounds':out.getbbox(),'registrationMethod':'Manual bounds and lower-foot line measurements from visible source; independently map disconnected segments to front floor edges using affine registration. No new geometry painted.','measurementToleranceSourcePixels':3};(ROOT/'geometry.json').write_text(json.dumps(geo,indent=2)+'\n');print(json.dumps(measure))
