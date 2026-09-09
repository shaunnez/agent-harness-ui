from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;A0=R.parents[1]/'A0'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,o):(R/n).write_text(json.dumps(o,indent=2)+'\n')
gen=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-684c6327-6c03-40c7-bec4-71b7d525107c.png');shutil.copy2(gen,R/'source/shuttle-master-r1.png');m=Image.open(gen).convert('RGB');a=np.array(m).astype(float);ex=a[:,:,1]-np.maximum(a[:,:,0],a[:,:,2]);alpha=1-np.clip((ex-20)/130,0,1);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2])+10),a[:,:,1]);ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/shuttle-alpha-master-r1.png');box=cut.getbbox();s=280/(box[2]-box[0]);size=(280,round((box[3]-box[1])*s));offset=(116,430-size[1]);out=Image.new('RGBA',(512,512));out.alpha_composite(cut.crop(box).resize(size,Image.Resampling.LANCZOS),offset);ar=np.array(out);ex=ar[:,:,1].astype(float)-np.maximum(ar[:,:,0],ar[:,:,2]);ar[:,:,1]=np.where(ex>20,np.minimum(ar[:,:,1],np.maximum(ar[:,:,0],ar[:,:,2]).astype(int)+10),ar[:,:,1]);ar[ar[:,:,3]==0,:3]=0;out=Image.fromarray(ar);e=R/'exports/vehicle-shuttle-r1.png';out.save(e)
def p(v):return [round(offset[0]+(v[0]-box[0])*s,4),round(offset[1]+(v[1]-box[1])*s,4)]
pts={k:p(v) for k,v in {'contactCentre':[610,850],'frontSkid':[580,962],'leftSkid':[320,883],'rightSkid':[900,817],'rearSkidEstimate':[640,738],'roof':[780,366]}.items()};anchor=[v/2 for v in pts['contactCentre']];fp=[pts['leftSkid'],pts['rearSkidEstimate'],pts['rightSkid'],pts['frontSkid']];height=(p([780,809])[1]-pts['roof'][1])/2
write('geometry.json',{'masterSize':list(m.size),'masterAlphaBounds':box,'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'exportAlphaBounds':out.getbbox(),'landmarksSourcePixels':pts,'groundAnchorSourcePixels':pts['contactCentre'],'approxSupportFootprintSourcePixels':fp,'footprintNote':'Three visible skid contacts manually measured; hidden fourth contact estimated. Contact centre is the mean of these four contacts.','bodyHeightLogical':height,'measurementToleranceMasterPixels':6})
def bg(im,color):
 b=Image.new('RGBA',im.size,color);b.alpha_composite(im);return b.convert('RGB')
sheet=Image.new('RGB',(1536,540),'#16222c');dr=ImageDraw.Draw(sheet)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):sheet.paste(bg(out,c),(i*512,28));dr.text((i*512+10,8),['Dark','Light','Magenta'][i],fill='white')
sheet.save(R/'qa/alpha-backgrounds-r1.png')
reg=bg(out,'#071923');dr=ImageDraw.Draw(reg)
for k,(x,y) in pts.items():dr.ellipse((x-3,y-3,x+3,y+3),fill='#ffcc55');dr.text((min(x+6,395),y),k,fill='white')
reg.save(R/'qa/socket-registration-r1.png')
fabric=Image.open(A0/'mf.station.fabrication/exports/station-fabrication-r1.png').convert('RGBA');workerHQ=Image.open(A0/'mf.worker.standard.se.neutral/exports/worker-standard-se-neutral-r1.png').convert('RGBA');workerDetail=Image.open(A0/'mf.worker.standard.detail.neutral/exports/worker-standard-detail-neutral-r1.png').convert('RGBA')
communications=Image.open(R.parents[1]/'A1/mf.station.communications/exports/station-communications-r1.png').convert('RGBA')
qa=Image.new('RGBA',(2250,1040),'#071923');dr=ImageDraw.Draw(qa)
for row,factor,wh,y0 in [(0,1.275,74,30),(1,2.52,200,410)]:
 for col,station in enumerate([fabric,communications,out]):
  sz=round(256*factor);pos=(col*750+120,y0);qa.alpha_composite(station.resize((sz,sz),Image.Resampling.LANCZOS),pos)
  w=workerHQ if row==0 else workerDetail;w=w.crop(w.getbbox());w=w.resize((round(w.width*wh/w.height),wh),Image.Resampling.LANCZOS);qa.alpha_composite(w,(col*750+75,y0+round(sz*.8)-wh))
  dr=ImageDraw.Draw(qa);dr.text((col*750+35,y0+5),['Fabrication','Communications','Shuttle'][col]+(' /HQ1.275x, worker74px' if row==0 else ' /detail2.52x, worker200px'),fill='white')
qa.convert('RGB').save(R/'qa/calibrated-scale-comparison-r1.png')
entry={'id':'mf.vehicle.shuttle','revision':1,'status':'pending-coordinator-A2-review','file':str(e.relative_to(R)),'sourceSize':[512,512],'logicalSize':[256,256],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':anchor,'footprint':[[v/2 for v in q] for q in fp],'footprintUse':'Approximate support footprint; rear point is occluded estimate.','layer':'vehicle','occlusionClass':'solid-vehicle','dockingAnchor':anchor,'sockets':{k:[v/2 for v in pts[k]] for k in ['contactCentre']},'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/socket-registration-r1.png','qa/calibrated-scale-comparison-r1.png'],'limits':['Static parked shuttle. Runtime travel must be tied to persisted delivery or handoff events.','No workers, floor, state labels or animated parts baked in.','A2 integrated scene review pending.']};write('entry.json',entry)
refs=[R.parent/'mf.station.launchpad/exports/station-launchpad-r1.png',Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/screens/project-base-attention-v1.1.png'),A0/'mf.station.fabrication/exports/station-fabrication-r1.png'];write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-684c6327-6c03-40c7-bec4-71b7d525107c','sourceSha256':sha(R/'source/shuttle-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(v),'sha256':sha(v)} for v in refs],'correctiveGenerations':1,'correctionPrompt':(R/'source/correction-prompt.txt').read_text(),'initialSourceSha256':sha(gen.parent/'exec-dbe67bed-a9e1-414b-93d1-8897158b3547.png'),'transforms':['Green key and spill cleanup','Crop subject and uniformly fit280source pixels wide','Lanczos resize and register bottom at430source on512canvas','QA-only comparison at requested consumer factors'],'exportSha256':sha(e),'exportBytes':e.stat().st_size,'rightsNote':'Supplied/generated project references only; provenance is not legal clearance.'})
write('qa/measurements-r1.json',{'mode':out.mode,'size':out.size,'alphaRange':out.getchannel('A').getextrema(),'borderNontransparent':int((ar[[0,-1],:,3]>0).sum()+(ar[:,[0,-1],3]>0).sum()),'bodyHeightLogical':height,'approxFootprintWidthLogical':(pts['rightSkid'][0]-pts['leftSkid'][0])/2,'approxFootprintDepthLogical':(pts['frontSkid'][1]-fp[1][1])/2})
(R/'qa/QA.md').write_text('''# Shuttle station A2 r1

Uncrewed rounded cargo shuttle with landing skids. Dark passive sensor glass and metallic amber trim; no pad, worker, exhaust or state glow. Ceramic/slate materials and warm light match fabrication. No worker/floor/wall/task text or status symbols; glass is reflective with no semantic illumination. One correction removed a bright cyan sensor edge. Initial and corrected sources retained.

512×512RGBA, logical256×256. Visible skid contacts manually measured; hidden rear skid estimated. Ground and docking anchor share the contact centre. No frontToolPort is required on this vehicle. See measurements for actual desk height and footprint rather than assuming prompted dimensions.

QA compares approved fabrication, communications and independent worker at HQ0.85×1.5=1.275 and detail2.1×1.2=2.52. Worker shown74px/200px. Alpha inspected on dark/light/magenta. Main renderer owns contact, live state, selection and attention. Pending coordinator A2 integration review.
''')
shutil.copy2(gen.parent/'exec-dbe67bed-a9e1-414b-93d1-8897158b3547.png',R/'source/shuttle-initial-bright-sensor.png')

padRoot=R.parent/'mf.station.launchpad'; pad=Image.open(padRoot/'exports/station-launchpad-r1.png').convert('RGBA'); pe=json.loads((padRoot/'entry.json').read_text()); dock=pe['sockets']['shuttleDock']; shift=(round(dock[0]*2-anchor[0]*2),round(dock[1]*2-anchor[1]*2)); composite=pad.copy();composite.alpha_composite(out,shift);composite.save(R/'qa/pad-shuttle-composite-r1.png')
contact=bg(composite,'#071923');d=ImageDraw.Draw(contact);poly=[tuple(round(v*2) for v in q) for q in pe['dockClearancePolygon']];d.line(poly+[poly[0]],fill='#f0cc76',width=2)
for q in fp:
 x,y=q[0]+shift[0],q[1]+shift[1];d.ellipse((x-4,y-4,x+4,y+4),fill='#62c1fa')
contact.save(R/'qa/dock-contact-r1.png')
scale=Image.new('RGBA',(1700,1150),'#071923');d=ImageDraw.Draw(scale)
for factor,x,y,wh in [(1.275,0,20,74),(2.52,650,20,200)]:
 n=round(384*factor);scale.alpha_composite(composite.resize((n,n),Image.Resampling.LANCZOS),(x,y));w=workerHQ if wh==74 else workerDetail;w=w.crop(w.getbbox());w=w.resize((round(w.width*wh/w.height),wh),Image.Resampling.LANCZOS);scale.alpha_composite(w,(x+20,y+round(n*.82)-wh));d.text((x+15,y+8),f'Docked / {factor}x / worker {wh}px',fill='white')
scale.convert('RGB').save(R/'qa/docked-actual-scale-r1.png')
entry['qa']+=['qa/pad-shuttle-composite-r1.png','qa/dock-contact-r1.png','qa/docked-actual-scale-r1.png'];entry['docking']={'padId':pe['id'],'socket':'shuttleDock','sameLogicalScale':True,'sourcePixelPasteOffset':shift};write('entry.json',entry)
write('qa/docking-measurements-r1.json',{'padDockLogical':dock,'shuttleContactCentreLogical':anchor,'pasteOffsetSource':shift,'contactPointsOnPadSource':[[q[0]+shift[0],q[1]+shift[1]] for q in fp],'note':'Three visible skid contacts plus estimated hidden fourth; clearance comparison requires coordinator visual qualification.'})

z=.70;small=out.resize((round(512*z),round(512*z)),Image.Resampling.LANCZOS);ss=(round(dock[0]*2-anchor[0]*2*z),round(dock[1]*2-anchor[1]*2*z));fit=pad.copy();fit.alpha_composite(small,ss);fit.save(R/'qa/pad-shuttle-clearance-fit-r1.png');entry['docking']['recommendedShuttleScaleRelativeToPad']=z;entry['docking']['nativeScaleNote']='Native skids fit deck, but left skid falls outside conservative clearance polygon. Use0.70relative scale to put all contact centres inside declared clearance.';entry['qa'].append('qa/pad-shuttle-clearance-fit-r1.png');write('entry.json',entry)
poly=np.array(pe['dockClearancePolygon']);q=np.array(fp)/2;q=np.array(dock)+(q-np.array(anchor))*z;edges=np.roll(poly,-1,axis=0)-poly;v=q[:,None,:]-poly;c=edges[None,:,0]*v[:,:,1]-edges[None,:,1]*v[:,:,0];inside=((c>=0).all(axis=1)|(c<=0).all(axis=1));write('qa/clearance-fit-measurements-r1.json',{'relativeScale':z,'contactCentersInside':inside.tolist(),'contactsLogical':q.tolist(),'note':'Contact centres tested against conservative polygon; skid perimeter and visual deck fit also require visual inspection.'})
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'})
print(json.dumps({'anchor':anchor,'sockets':entry['sockets'],'benchHeight':height,'sha256':sha(e)}))
