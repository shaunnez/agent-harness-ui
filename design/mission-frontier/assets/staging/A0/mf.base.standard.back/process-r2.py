from pathlib import Path
import json,shutil
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parent
GEN=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-97a67028-ee56-4f19-976c-e661ae25bff5.png')
MASTER=ROOT/'source/base-standard-back-master-r2.png'
if not MASTER.exists():shutil.copy2(GEN,MASTER)
im=Image.open(MASTER).convert('RGB');rgb=np.array(im).astype(float)
ex=rgb[:,:,1]-np.maximum(rgb[:,:,0],rgb[:,:,2]);alpha=1-np.clip((ex-20)/170,0,1)
rgb[:,:,1]=np.where(ex>20,np.minimum(rgb[:,:,1],np.maximum(rgb[:,:,0],rgb[:,:,2])+10),rgb[:,:,1]);rgba=np.dstack((rgb,alpha*255)).clip(0,255).astype(np.uint8);rgba[rgba[:,:,3]==0,:3]=0
cutout=Image.fromarray(rgba);cutout.save(ROOT/'source/base-standard-back-alpha-master-r2.png')
# Fit the two planar wall faces independently to the accepted floor footprint.
# The source has correct materials but its feet are translated down and the
# wall height is too large. A registered piecewise affine transform retains
# every source pixel while fitting span, floor-contact slope and wall height.
source_center=686.5;sx=1408/1293;source_ground_y=506;source_slope=319/601.5
target_center=768;target_inner_ground_y=364;height_scale=220/374
out=Image.new('RGBA',(1536,1280));coefficients={}
for side,sign,region in [('left',-1,(0,0,768,1280)),('right',1,(768,0,1536,1280))]:
    # inverse x = x'/sx + source_center - target_center/sx
    # inverse y = y'/height_scale + source_ground_y - innerY/height_scale
    #             + (source_slope/sx - .5/height_scale) * abs(x'-target_center)
    c=source_center-target_center/sx; slope=(source_slope/sx-.5/height_scale)*sign
    cf=[1/sx,0,c,slope,1/height_scale,source_ground_y-target_inner_ground_y/height_scale-slope*target_center]
    warped=cutout.transform((1536,1280),Image.Transform.AFFINE,cf,Image.Resampling.BICUBIC)
    out.paste(warped.crop(region),region[:2]);coefficients[side]=cf
arr=np.array(out);ex=arr[:,:,1].astype(float)-np.maximum(arr[:,:,0],arr[:,:,2]);arr[:,:,1]=np.where(ex>20,np.minimum(arr[:,:,1],np.maximum(arr[:,:,0],arr[:,:,2]).astype(int)+10),arr[:,:,1]);arr[arr[:,:,3]==0,:3]=0;out=Image.fromarray(arr)
export=ROOT/'exports/base-standard-back-r2.png';out.save(export)
floorpath=ROOT/'source/floor-padded-guidance-r2.png'
floor=Image.open(floorpath).convert('RGBA');assembly=floor.copy();assembly.alpha_composite(out)
assembly.save(ROOT/'qa/floor-back-composite-r2.png')
def bg(image,color,size):
    image=image.resize(size,Image.Resampling.LANCZOS);base=Image.new('RGBA',size,color);base.alpha_composite(image);return base.convert('RGB')
sheet=Image.new('RGB',(1536,464),'#22303a');d=ImageDraw.Draw(sheet)
for i,(name,color) in enumerate([('Dark','#071923'),('Light','#f0f3f5'),('Magenta','#d000cc')]):
    sheet.paste(bg(out,color,(512,427)),(i*512,28));d.text((i*512+12,8),name+' / walls only',fill='white')
sheet.save(ROOT/'qa/alpha-backgrounds-r2.png');bg(assembly,'#071923',(768,640)).save(ROOT/'qa/hq-composite-logical-scale-r2.png')
geo={'canvas':[1536,1280],'logicalCanvas':[768,640],'commonAnchorSource':[768,1044],'commonAnchorLogical':[384,522],'floorSurfaceCornersSource':[[768,340],[1472,692],[768,1044],[64,692]],'sourceInnerGroundPath':[[85,825],[686.5,506],[1288,825]],'registeredInnerGroundPath':[[round(768+(85-686.5)*sx,4),round(364+abs((85-686.5)*sx)*.5,4)],[768,364],[round(768+(1288-686.5)*sx,4),round(364+abs((1288-686.5)*sx)*.5,4)]],'sourceWidthControl':[40,1333],'targetWidthControl':[64,1472],'sourceTopBackApprox':[686.5,132],'registeredTopBackApprox':[768,round(364+height_scale*(132-506),4)],'heightScale':height_scale,'horizontalScale':sx,'inverseAffineCoefficients':coefficients,'alphaBounds':out.getbbox(),'surfaceOffsetConvention':'Inner visible wall feet are 24 export pixels toward the floor interior relative to rear perimeter line. Outer wall structure/foot reaches the perimeter. Common anchor is inherited from floor, not wall bounding box.','measurementMethod':'Manual source foot and top landmarks within approximately 3 pixels, then two joined affine face registrations split at target x768. New exports share target floor landmarks; no new floor pixels synthesized.'}
(ROOT/'geometry-r2.json').write_text(json.dumps(geo,indent=2)+'\n')
registration=bg(assembly,'#071923',(1536,1280));d=ImageDraw.Draw(registration)
rear=[(64,692),(768,340),(1472,692)];d.line(rear,fill='#ffb64c',width=2);d.line([tuple(p) for p in geo['registeredInnerGroundPath']],fill='#61d7ff',width=2);d.text((20,20),'Orange: floor rear perimeter. Cyan: measured wall inner-contact path.',fill='white');registration.save(ROOT/'qa/registration-composite-r2.png')
stats={'mode':out.mode,'size':list(out.size),'alphaRange':out.getchannel('A').getextrema(),'transparentPixels':int((arr[:,:,3]==0).sum()),'partialAlphaPixels':int(((arr[:,:,3]>0)&(arr[:,:,3]<255)).sum()),'borderNontransparent':int((arr[[0,-1],:,3]>0).sum()+(arr[:,[0,-1],3]>0).sum()),'interiorFloorRegionNontransparent':int((arr[760:1000,450:1050,3]>0).sum()),'greenDominantVisiblePixels':int(((arr[:,:,1].astype(float)-np.maximum(arr[:,:,0],arr[:,:,2])>30)&(arr[:,:,3]>16)).sum()),'pngBytes':export.stat().st_size,'decodedRgbaBytes':1536*1280*4}
(ROOT/'qa/measurements-r2.json').write_text(json.dumps(stats,indent=2)+'\n');print(json.dumps({'geometry':geo,'qa':stats}))
