from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
R=Path(__file__).resolve().parent;src=R.parent/'mf.terrain.ground/exports/terrain-ground-r1.png'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
im=Image.open(src).convert('RGBA');a=np.array(im);h,w=a.shape[:2];yy,xx=np.indices((h,w));# Inner2:1diamond keeps shore band≈45source vertical/90horizontal.
inner=(abs(xx-512)/360+abs(yy-355)/180)<=1
owner=np.zeros((h,w),dtype='uint8');owner[~inner & (yy<355)&(xx<512)]=1;owner[~inner &(yy<355)&(xx>=512)]=2;owner[~inner &(yy>=355)&(xx>=512)]=3;owner[~inner &(yy>=355)&(xx<512)]=4
names=['interior','nw','ne','se','sw'];parts=[];combined=Image.new('RGBA',im.size);coverage=np.zeros((h,w),dtype='uint8');ends={'nw':[[62,355],[512,130]],'ne':[[512,130],[962,355]],'se':[[962,355],[512,580]],'sw':[[512,580],[62,355]]};sockets={};measured={}
for i,name in enumerate(names):
 mask=owner==i;p=np.zeros_like(a);p[mask]=a[mask];part=Image.fromarray(p);f=R/f'exports/shore-{name}-r1.png';part.save(f);Image.fromarray((mask*255).astype('uint8')).save(R/f'source/partition-{name}-mask-r1.png');combined=Image.alpha_composite(combined,part);coverage+=(p[:,:,3]>0).astype('uint8')
 item={'name':name,'file':str(f.relative_to(R)),'sourceSize':[1024,768],'logicalSize':[512,384],'anchor':[256,290],'offset':[0,0],'sha256':sha(f)}
 if name!='interior':
  py,px=np.where((p[:,:,3]>=250));found=[]
  for qx,qy in ends[name]:
   k=np.argmin((px-qx)**2+(py-qy)**2);found.append([int(px[k]),int(py[k])])
  mid=np.mean(ends[name],axis=0);k=np.argmin((px-mid[0])**2+(py-mid[1])**2);approach=[int(px[k]),int(py[k])];measured[name]={'registeredSurfaceEndpointsSource':ends[name],'nearestOpaqueOwnedEndpointsSource':found,'approachSource':approach};sockets[name+'Start']=[v/2 for v in found[0]];sockets[name+'End']=[v/2 for v in found[1]];sockets[name+'Approach']=[v/2 for v in approach];item['sockets']={'start':sockets[name+'Start'],'end':sockets[name+'End'],'approach':sockets[name+'Approach']}
 parts.append(item)
e=R/'exports/shore-assembled-r1.png';combined.save(e);out=np.array(combined);diff=np.abs(out.astype(int)-a.astype(int));report={'exactRgbaPixelEquality':bool(np.array_equal(a,out)),'maxChannelDifference':int(diff.max()),'differentPixels':int((diff.max(axis=2)>0).sum()),'overlapPixels':int((coverage>1).sum()),'uncoveredOriginalAlphaPixels':int(((a[:,:,3]>0)&(coverage==0)).sum()),'introducedAlphaPixels':int(((a[:,:,3]==0)&(coverage>0)).sum()),'sourceSha256':sha(src),'assembledSha256':sha(e)};write('qa/reconstruction-r1.json',report)
assert report['exactRgbaPixelEquality'] and report['overlapPixels']==0
write('geometry.json',{'sourceSize':[1024,768],'logicalSize':[512,384],'groundAnchor':[256,290],'partition':'Interior abs(x-512)/360+abs(y-355)/180<=1. Outside interior: nw x<512,y<355; ne x>=512,y<355; se x>=512,y>=355; sw x<512,y>=355. All source pixels assigned exactly once.','innerDiamondSource':[[512,175],[872,355],[512,535],[152,355]],'shoreSockets':measured,'endpointMethod':'Nearest fully opaque pixel owned by the requested shore part to approved registered surface corner; approach uses nearest opaque owned pixel to edge midpoint. Raster measurements, not new geometry.','reuseBoundary':'Each part uses source geometry and translation only. Neighbor/bridge joins must align sockets; this derivative does not invent matching external tiles or alter terrain edges.'})
def bg(v,c='#0b3440'):
 b=Image.new('RGBA',v.size,c);b.alpha_composite(v);return b.convert('RGB')
bg(combined).save(R/'qa/reconstruction-at-scale2-r1.png')
# Contact crops are native source pixels: logical2x equals source1x.
sheet=Image.new('RGB',(1024,560),'#071923');d=ImageDraw.Draw(sheet)
for i,(cx,cy) in enumerate([(512,175),(872,355),(512,535),(152,355)]):
 region=(cx-128,cy-128,cx+128,cy+128);sheet.paste(bg(combined.crop(region)),(i*256,28));d.text((i*256+8,8),['Back junction','Right junction','Front junction','Left junction'][i],fill='white')
for i,(cx,cy) in enumerate([(512,130),(962,355),(512,580),(62,355)]):
 region=(cx-128,cy-128,cx+128,cy+128);sheet.paste(bg(combined.crop(region)),(i*256,304));d.text((i*256+8,284),['Back outer seam','Right outer seam','Front outer seam','Left outer seam'][i],fill='white')
sheet.save(R/'qa/joins-at-scale2-r1.png')
partsQA=Image.new('RGB',(1536,824),'#071923');d=ImageDraw.Draw(partsQA)
for i,item in enumerate(parts):
 x=(i%3)*512;y=(i//3)*412;part=Image.open(R/item['file']);partsQA.paste(bg(part).resize((512,384)),(x,y+28));d.text((x+8,y+8),item['name'],fill='white')
partsQA.save(R/'qa/part-ownership-r1.png')
entry={'id':'mf.terrain.shore.rim','revision':1,'status':'pending-coordinator-A1-review','file':str(e.relative_to(R)),'sourceSize':[1024,768],'logicalSize':[512,384],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[256,290],'layer':'terrain','occlusionClass':'ground','parts':parts,'sockets':sockets,'sha256':sha(e),'alpha':'straight RGBA; mutually exclusive source alpha ownership','geometry':'geometry.json','qa':['qa/QA.md','qa/reconstruction-r1.json','qa/reconstruction-at-scale2-r1.png','qa/joins-at-scale2-r1.png','qa/part-ownership-r1.png'],'limits':['Do not draw assembled export beneath parts; choose assembled OR parts.','Part boundaries are registered to this plate, not a guarantee of arbitrary seamless island-to-island tiling.','No rotations baked; preserve lighting and use measured sockets for approach alignment.']};write('entry.json',entry)
write('provenance.json',{'assetId':entry['id'],'revision':1,'production':'Deterministic exclusive alpha partition; no ImageGen or repaint','sourceAssetId':'mf.terrain.ground','sourceRevision':1,'sourcePath':str(src),'sourceSha256':sha(src),'sourceProvenance':str(R.parent/'mf.terrain.ground/provenance.json'),'transforms':['Assign every original pixel to exactly one interior/shore part','Copy original RGBA pixel values without color edits or resampling','Assemble five parts for exact equality verification','QA-only native source1x/logical2x crops'],'exportSha256':sha(e)})
(R/'qa/QA.md').write_text('''# Shore rim A1 r1

Deterministic five-part partition of approved ground r1. Each1024×768RGBA frame retains the same logical512×384 and anchor[256,290]. Interior and nw/ne/se/sw parts own mutually exclusive pixels, including fractional source alpha. No resampling, palette changes, double-alpha overlap or invented fill.

Reconstruction has exactRGBA pixel equality, zero differing pixels, zero overlapping occupied pixels and zero uncovered original alpha. See machine-readable reconstruction-r1.json. Source and assembled PNG hashes may differ only if encoding differs; pixel equality is canonical.

Native source1× equals logical2×: reconstruction-at-scale2 and joins-at-scale2 show inner edge junctions and outer corner seams at the requested scale. Part ownership sheet is half-size for overview. Edge endpoint and approach sockets are nearest fully opaque owned raster points to original registered corners/midpoints.

Use assembled OR parts, never both together. Parts can be independently translated for bridge approaches/expanded composition, but arbitrary neighboring tiles are not automatically seamless; coordinator must align endpoints and assess new joins. No new terrain, connector geometry or water created. Accepted ground source untouched. Pending coordinator review.
''')
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'});print(json.dumps(report))
