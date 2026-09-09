from pathlib import Path
import hashlib, json, shutil
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
SOURCE = Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-0d136c05-5ba2-42b2-8bba-ad6d29bf2ee7.png')
master = ROOT / 'source/worker-standard-se-neutral-master-r1.png'
if not master.exists(): shutil.copy2(SOURCE, master)
im = Image.open(master).convert('RGB')
rgb = np.asarray(im).astype(np.float32)
excess = rgb[:,:,1] - np.maximum(rgb[:,:,0],rgb[:,:,2])
# Green chroma-key only. No anatomical painting or geometry synthesis.
alpha = 1 - np.clip((excess - 20) / 170, 0, 1)
rgb[:,:,1] = np.where(excess > 20, np.minimum(rgb[:,:,1], np.maximum(rgb[:,:,0],rgb[:,:,2]) + 10), rgb[:,:,1])
rgba = np.dstack((rgb, alpha * 255)).clip(0,255).astype(np.uint8)
rgba[rgba[:,:,3] == 0,:3] = 0
cutout = Image.fromarray(rgba)
cutout.save(ROOT/'source/worker-standard-se-neutral-alpha-master-r1.png')
bbox = cutout.getbbox()
crop = cutout.crop(bbox)
target_height = 312
size = (round(crop.width * target_height / crop.height),target_height)
scaled = crop.resize(size,Image.Resampling.LANCZOS)
# Bottommost visible sole at y340; measured anchor is recorded separately.
offset = (192 - size[0]//2, 340 - target_height)
out = Image.new('RGBA',(384,384))
out.alpha_composite(scaled,offset)
final = np.array(out)
final_excess = final[:,:,1].astype(float) - np.maximum(final[:,:,0], final[:,:,2])
final[:,:,1] = np.where(final_excess > 20, np.minimum(final[:,:,1], np.maximum(final[:,:,0],final[:,:,2]).astype(int) + 10), final[:,:,1])
final[final[:,:,3] == 0,:3] = 0
out = Image.fromarray(final)
export = ROOT/'exports/worker-standard-se-neutral-r1.png'
out.save(export)
panel = Image.new('RGB',(1152,520),'#22303a')
draw = ImageDraw.Draw(panel)
for i,(name,color) in enumerate([('Dark','#071923'),('Light','#f0f3f5'),('Magenta','#d000cc')]):
    bg=Image.new('RGBA',(384,384),color);bg.alpha_composite(out)
    panel.paste(bg.convert('RGB'),(i*384,24));draw.text((i*384+12,8),name,fill='white')
    for n,height in enumerate([58,180]):
        small=out.crop(out.getbbox()); small=small.resize((round(small.width*height/small.height),height),Image.Resampling.LANCZOS)
        # Detail appears on a second sheet; this strip is actual HQ size.
        if height==58:
            plate=Image.new('RGBA',(384,104),color);plate.alpha_composite(small,(24,22));panel.paste(plate.convert('RGB'),(i*384,408));draw.text((i*384+88,438),'HQ: 58 px visible height',fill=('white' if i!=1 else 'black'))
panel.save(ROOT/'qa/alpha-and-hq-r1.png')
detail=Image.new('RGB',(768,244),'#071923'); d=ImageDraw.Draw(detail)
for i,(name,color) in enumerate([('Dark','#071923'),('Light','#f0f3f5'),('Magenta','#d000cc')]):
    small=out.crop(out.getbbox()); small=small.resize((round(small.width*180/small.height),180),Image.Resampling.LANCZOS)
    plate=Image.new('RGBA',(256,244),color);plate.alpha_composite(small,((256-small.width)//2,32));detail.paste(plate.convert('RGB'),(i*256,0));d.text((i*256+12,12),'Detail: 180 px visible',fill=('white' if i!=1 else 'black'))
detail.save(ROOT/'qa/detail-actual-scale-r1.png')
grid=Image.new('RGBA',(768,768),'#22303a');grid.alpha_composite(out.resize((768,768),Image.Resampling.NEAREST));g=ImageDraw.Draw(grid)
for x in range(0,384,16):
    g.line((x*2,0,x*2,768),fill=(90,120,140,100));g.text((x*2+2,4),str(x),fill='white')
for y in range(0,384,16):
    g.line((0,y*2,768,y*2),fill=(90,120,140,100));g.text((4,y*2+2),str(y),fill='white')
grid.convert('RGB').save(ROOT/'qa/measurement-grid-r1.png')
stats={'masterSize':im.size,'masterMode':im.mode,'keyBoundsMaster':bbox,'cropScale':target_height/crop.height,'scaledSize':size,'pasteOffset':offset,'exportBoundsAlphaGt0':out.getbbox(),'alphaExtrema':out.getchannel('A').getextrema(),'transparentPixelCount':int(np.count_nonzero(np.array(out)[:,:,3]==0)),'partialAlphaPixelCount':int(np.count_nonzero((np.array(out)[:,:,3]>0)&(np.array(out)[:,:,3]<255)))}
(ROOT/'qa/measurements-r1.json').write_text(json.dumps(stats,indent=2)+'\n')
print(json.dumps(stats))
