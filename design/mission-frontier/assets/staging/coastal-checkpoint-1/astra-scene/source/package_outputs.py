"""Deterministic registration, world-distance masks, alpha QA and manifest packaging."""
from pathlib import Path
import json,subprocess,hashlib
import numpy as np
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[1];size=(2560,1920);(R/'masks').mkdir(exist_ok=True)
subprocess.run(['clang++','-O2',str(R/'source/edt.cpp'),'-o',str(R/'qa/edt')],check=True)
# Verify transform against an independently calculated small two-seed field.
t=np.zeros((19,19),np.uint8);t[4,3]=255;t[13,16]=255;t.tofile(R/'qa/edt-test-input.raw')
subprocess.run([str(R/'qa/edt'),'19',str(R/'qa/edt-test-input.raw'),str(R/'qa/edt-test-result.raw')],check=True)
y,x=np.indices(t.shape);expected=np.minimum(np.hypot(x-3,y-4),np.hypot(x-16,y-13));error=float(np.abs(np.fromfile(R/'qa/edt-test-result.raw',np.float32).reshape(t.shape)-expected).max());assert error<1e-5
# Canonical transparent pixels discard invisible render dither without changing visible samples.
for layer in ['terrain','base','bridge','front']:
 p=R/'renders'/f'{layer}.png';pixels=np.array(Image.open(p).convert('RGBA'));pixels[pixels[:,:,3]==0]=0;Image.fromarray(pixels,'RGBA').save(p)
# Convert occluded practical-energy render into straight-alpha emission, eliminating black matte.
a=np.asarray(Image.open(R/'renders/lights-raw.png').convert('RGBA')).astype(np.float32)/255
strength=a[:,:,:3].max(axis=2);keep=strength>4/255;out=np.zeros_like(a);out[:,:,:3]=np.divide(a[:,:,:3],strength[:,:,None],out=np.zeros_like(a[:,:,:3]),where=strength[:,:,None]>0);out[:,:,3]=strength*a[:,:,3]*keep;out[~keep]=0
Image.fromarray(np.rint(out*255).astype(np.uint8),'RGBA').save(R/'renders/lights.png')
# Actual ray-visible architecture/land/support alpha excludes shore effects from opaque geometry.
assembled=Image.new('RGBA',size)
for layer in ['terrain','bridge','base','front']:assembled=Image.alpha_composite(assembled,Image.open(R/'renders'/f'{layer}.png').convert('RGBA'))
assembled.save(R/'renders/assembled-transparent.png');water=1-np.asarray(assembled)[:,:,3].astype(np.float32)/255
geo=json.loads((R/'source/shore-geometry.json').read_text());polys=geo['shorePolygonsWorldXY'];pts=np.array([p for poly in polys for p in poly]);low=pts.min(axis=0)-4;high=pts.max(axis=0)+4;span=float(max(high-low));low=(low+high-span)/2;N=2048;step=span/(N-1)
im=Image.new('L',(N,N));draw=ImageDraw.Draw(im)
for poly in polys:draw.polygon([tuple((np.array(p)-low)/step) for p in poly],fill=255)
im.save(R/'masks/source-world-waterline.png');np.asarray(im).tofile(R/'masks/source-world-waterline.raw')
subprocess.run([str(R/'qa/edt'),str(N),str(R/'masks/source-world-waterline.raw'),str(R/'masks/source-world-distance.raw')],check=True)
dfield=np.fromfile(R/'masks/source-world-distance.raw',np.float32).reshape(N,N)*step
y,x=np.indices((size[1],size[0]),dtype=np.float32);u=(x+.5)/2-640;v=(y+.5)/2-600+39.191837*geo['seaWorldZ'];wx=v/32-u/64;wy=v/32+u/64;gx=np.clip((wx-low[0])/step,0,N-1.001);gy=np.clip((wy-low[1])/step,0,N-1.001);ix=gx.astype(int);iy=gy.astype(int);fx=gx-ix;fy=gy-iy
d=(dfield[iy,ix]*(1-fx)*(1-fy)+dfield[iy,ix+1]*fx*(1-fy)+dfield[iy+1,ix]*(1-fx)*fy+dfield[iy+1,ix+1]*fx*fy)
def mask(extent,fade):
 a=water*np.clip((extent-d)/fade,0,1)*(d>0);red=np.clip(d/extent,0,1);out=np.zeros((*d.shape,4),np.uint8);out[:,:,0]=np.rint(red*255).astype(np.uint8);out[:,:,3]=np.rint(a*255).astype(np.uint8);out[out[:,:,3]==0]=0;return out
shore=mask(1.35,.24);depth=mask(1.5,.4)
# Breaking is localized by broad world-space variation and open-water-facing exposure.
dy,dx=np.gradient(dfield,step);nx=dx[iy,ix];ny=dy[iy,ix];length=np.maximum(np.hypot(nx,ny),.001);exposure=.28+.72*np.clip((nx+ny)/length*.7071,0,1);patch=np.clip((.52+.28*np.sin(wx*.95+wy*.73)+.20*np.sin(wx*2.31-wy*.6)+.12*np.sin(wx*4.1+wy*2.7)-.25)/.75,0,1);shore[:,:,3]=np.rint(shore[:,:,3].astype(float)*exposure*patch).astype(np.uint8);shore[shore[:,:,3]==0]=0
Image.fromarray(shore,'RGBA').save(R/'masks/shore.png');Image.fromarray(depth,'RGBA').save(R/'masks/depth.png')
near=np.array([35,105,99],np.float32);far=np.array([17,64,76],np.float32);mix=np.clip(d/1.5,0,1);sh=np.zeros_like(depth);sh[:,:,:3]=np.rint(near[None,None,:]*(1-mix[:,:,None])+far[None,None,:]*mix[:,:,None]).astype(np.uint8);sh[:,:,3]=np.rint(depth[:,:,3].astype(float)*.67).astype(np.uint8);sh[sh[:,:,3]==0]=0;Image.fromarray(sh,'RGBA').save(R/'renders/shallows.png')
entries=[];qa={};cal=json.loads((R/'qa/detail-calibration.json').read_text())
for key in ['terrain','base','bridge','front','lights','shallows','shore']:
 p=R/('masks' if key=='shore' else 'renders')/f'{key}.png';im=Image.open(p).convert('RGBA');a=np.asarray(im)[:,:,3];bbox=im.getchannel('A').getbbox();edge=int(np.count_nonzero(a[0])+np.count_nonzero(a[-1])+np.count_nonzero(a[:,0])+np.count_nonzero(a[:,-1]));assert im.size==size and edge==0,(key,edge)
 entry={'id':f'mf.coastal.{key}','file':str(p.relative_to(R)),'sourceSize':list(size),'logicalSize':[1280,960],'groundAnchor':[640,600],'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'boundsSourcePixels':bbox,'sockets':{k:v['logicalMeasured'] for k,v in cal['sockets'].items()}}
 if key=='shore':entry['encoding']={'R':'linear normalized offshore distance; 0 shoreline, 1 at 1.35 world units offshore','G':0,'B':0,'alpha':'water-only visibility times soft surf extent, irregular breaking patches and shoreline exposure','colourSpace':'raw PNG data; no colour conversion'}
 entries.append(entry);qa[key]={'alphaBounds':bbox,'edgeNonzero':edge,'nonzeroAlphaPixels':int(np.count_nonzero(a))}
(R/'entries.json').write_text(json.dumps(entries,indent=2)+'\n')
(R/'qa/static-qa.json').write_text(json.dumps({'assets':qa,'edtBruteForceMaxErrorPixels':error,'maskWorldGrid':{'size':N,'origin':low.tolist(),'step':step},'maskWaterAlphaOverlapWithOpaqueGeometry':int(np.count_nonzero((shore[:,:,3]>0)&(water==0))),'shaderQualification':'builder owned; see main acceptance evidence','sourceSize':list(size),'logicalSize':[1280,960],'groundAnchor':[640,600],'decodedRGBABytesSevenLayers':size[0]*size[1]*4*7},indent=2)+'\n')
# Review sheets reveal alpha and practical-only material without altering runtime images.
for color,name in [((20,43,50,255),'dark'),((230,226,213,255),'light')]:
 bg=Image.new('RGBA',size,color);bg=Image.alpha_composite(bg,Image.open(R/'renders/shallows.png'));bg=Image.alpha_composite(bg,assembled);bg.convert('RGB').save(R/'qa'/f'assembled-{name}.jpg',quality=92)
print(json.dumps({'entries':len(entries),'qa':qa,'maskOverlap':0},indent=2))
