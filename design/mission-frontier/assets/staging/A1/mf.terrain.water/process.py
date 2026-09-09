from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;A0=R.parents[1]/'A0'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
gen=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-c01d7ea0-bc09-41cf-90df-a90a7cca0e95.png');shutil.copy2(gen,R/'source/water-master-r1.png');m=Image.open(gen).convert('RGB');raw=m.resize((512,512),Image.Resampling.LANCZOS);raw.save(R/'source/water-resized-before-periodic-r1.png');a=np.array(raw).astype(float)
# Periodic-plus-smooth decomposition removes boundary-driven low-frequency discontinuity.
v=np.zeros_like(a);v[0,:,:]=a[-1,:,:]-a[0,:,:];v[-1,:,:]=-v[0,:,:];dx=a[:,-1,:]-a[:,0,:];v[:,0,:]+=dx;v[:,-1,:]-=dx
cy,cx=np.meshgrid(np.arange(512),np.arange(512),indexing='ij');den=2*np.cos(2*np.pi*cx/512)+2*np.cos(2*np.pi*cy/512)-4;den[0,0]=1
smooth=np.fft.ifft2(np.fft.fft2(v,axes=(0,1))/den[:,:,None],axes=(0,1)).real;a-=smooth
# Narrow8px cosine endpoint closure guarantees exact opposed RGB boundaries.
for axis in [1,0]:
 for k in range(8):
  w=.5*(1+np.cos(np.pi*k/8));lo=[slice(None)]*3;hi=[slice(None)]*3;lo[axis]=k;hi[axis]=-1-k;lo=tuple(lo);hi=tuple(hi);left=a[lo].copy();right=a[hi].copy();mean=(left+right)/2;a[lo]=left*(1-w)+mean*w;a[hi]=right*(1-w)+mean*w
out=Image.fromarray(np.round(a).clip(0,255).astype('uint8'));e=R/'exports/terrain-water-r1.png';out.save(e);arr=np.array(out).astype(int)
qa=Image.new('RGB',(1536,1536))
for yy in range(3):
 for xx in range(3):qa.paste(out,(xx*512,yy*512))
qa.save(R/'qa/tiled-3x3-r1.png');marked=qa.copy();d=ImageDraw.Draw(marked)
for pos in [512,1024]:d.line((pos,0,pos,1536),fill='#ffcc55',width=1);d.line((0,pos,1536,pos),fill='#ffcc55',width=1)
marked.save(R/'qa/tile-boundary-locations-r1.png')
# Central wrap junction and uninterrupted original-sized tile at consumer density.
qa.crop((384,384,640,640)).resize((768,768),Image.Resampling.NEAREST).save(R/'qa/wrap-junction-magnified-r1.png')
metrics={'mode':out.mode,'size':list(out.size),'opposedLeftRightMaxDifference':int(abs(arr[:,0]-arr[:,-1]).max()),'opposedTopBottomMaxDifference':int(abs(arr[0]-arr[-1]).max()),'interiorHorizontalMeanAdjacentDifference':float(abs(np.diff(arr,axis=1)).mean()),'interiorVerticalMeanAdjacentDifference':float(abs(np.diff(arr,axis=0)).mean()),'transformMeanAbsoluteChannelChange':float(abs(arr-np.array(raw).astype(int)).mean()),'tileProofDimensions':[1536,1536]};write('qa/seam-measurements-r1.json',metrics)
entry={'id':'mf.terrain.water','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[512,512],'logicalSize':[256,256],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[0,0],'layer':'water','occlusionClass':'background','sockets':{},'repeat':['x','y'],'sha256':sha(e),'alpha':'opaque RGB','qa':['qa/QA.md','qa/tiled-3x3-r1.png','qa/tile-boundary-locations-r1.png','qa/wrap-junction-magnified-r1.png','qa/seam-measurements-r1.json'],'limits':['Static texture, no animation or shoreline foam.','A512px repeating texture can reveal repeated motifs over large uninterrupted water areas.','Use repeat texture sampling; avoid independently filtered clamp-to-edge sprites.']};write('entry.json',entry)
ref=A0/'mf.terrain.region/source/terrain-region-master-attempt1.png';write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-c01d7ea0-bc09-41cf-90df-a90a7cca0e95','sourceSha256':sha(R/'source/water-master-r1.png'),'sourceDimensions':list(m.size),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(ref),'sha256':sha(ref)}],'correctiveGenerations':0,'transforms':['Full-frame Lanczos resize to512RGB','Deterministic periodic-plus-smooth FFT decomposition to remove boundary-driven low-frequency difference','8pixel cosine endpoint closure both axes; no generated redraw','QuantizeRGB, verify opposed edges identical','Unaltered export repeated3x3 for QA'],'exportSha256':sha(e),'exportBytes':e.stat().st_size,'rightsNote':'Supplied/generated project reference only; no external texture source.'})
(R/'qa/QA.md').write_text('''# Water tile A1 r1

512×512 opaqueRGB; logical256×256. Blue/teal rippled water from accepted region palette. No land, border foam, objects, text or interface.

Generated source is not assumed seamless. Retained resized original, then deterministic periodic-plus-smooth correction and narrow8pixel cosine edge closure. Opposed RGB boundaries are exactly equal in both axes. No image-generation correction or mirrored quadrant tiling used.

Inspect the real1536×1536 three-by-three proof without guides; separate boundary overlay locates joins. Magnified wrap junction reveals local pixels. Exact edge equality prevents hard wrap jumps but does not guarantee absence of perceptible motif repetition. Fine highlights are static reflections, not simulated waves. Use repeat sampling and assess pattern scale in scene; large open expanses may reveal repetition.

Pending coordinator A1 visual review.
''')
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps({'sha256':sha(e),'metrics':metrics}))
