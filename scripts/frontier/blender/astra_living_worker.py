"""Rebuild registered motion from the retained original authored geometry. Run with Blender -b -t 4 --python this-file."""
import bpy, math, json, hashlib, sys
from pathlib import Path
from mathutils import Matrix, Vector
OUT = Path(__file__).resolve().parents[3] / 'design/mission-frontier/assets/staging/living-world/astra'
SOURCE = OUT / 'source/original-worker-production.py'
source = SOURCE.read_text()
# Retain original camera, lighting, materials and geometry; replace only output ownership.
lines = source.splitlines()
lines[4] = "R=Path(" + repr(str(OUT)) + ");(R/'renders').mkdir(exist_ok=True);(R/'blend').mkdir(exist_ok=True)"
exec('\n'.join(lines).split("render('worker-idle')")[0], globals())
# Expose the existing ankle connection during the larger gait articulation.
for side in [-1,1]:
    ankle=sphere('ankle bearing',(-.02,side*.22,.255),(.105,.115,.095),dark)
    bpy.context.view_layer.update()
    ankle.matrix_world=turn@ankle.matrix_world
bpy.context.view_layer.update()
originals = {o.name:o.matrix_world.copy() for o in groups['worker']}
localpos = {o.name: turn.inverted() @ o.matrix_world.translation for o in groups['worker']}
axis = (-1, 0, 0)
def rot(pivot, angle, ax=axis):
    p = turn @ Vector(pivot)
    return Matrix.Translation(p) @ Matrix.Rotation(angle,4,ax) @ Matrix.Translation(-p)
def apply(names, matrix):
    for n in names: bpy.data.objects[n].matrix_world = matrix @ originals[n]
def names(stems, side=None):
    return [n for n in originals if any(n == s or n.startswith(s+'.') for s in stems) and (side is None or localpos[n].y*side>0)]
head=names(['round ceramic head','dark friendly visor','blue eye','ear joint','ear cap','ear cap recessed bolt','helmet crown gasket'])
upperstems=['upper arm','upper arm inset vent','upper arm fastener','elbow bearing']
forestems=['forearm','hand gripper','finger proximal segment','finger hinge','finger distal segment','compact fabrication probe','probe ceramic grip collar','probe machined tip']
legs={}
for side in [-1,1]:
    legs[side]={'thigh':names(['thigh','thigh armour','knee','knee actuator outer pin'],side), 'shin':names(['shin','shin shell','shin longitudinal plate seam','ankle bearing'],side),'foot':names(['segmented foot','foot ceramic toe'],side),'upper':names(upperstems,side),'fore':names(forestems,side)}
meta.update({'id':'mf.worker.standard.se.living-motion','revision':1,'sourceId':'original-authored-cinematic-worker','sourceScriptSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'buildScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'workFrames':[],'animations':{},'rootMotion':'none; caller translates walking actor','coordinateUnits':'logical-pixels-untrimmed','alphaMode':'straight','walkStrideLogicalPixels':36,'provenance':'Existing original agent-authored Blender robot regenerated from retained source; articulated rigid mesh joints; no new textures or third-party assets.'})
S.render.image_settings.compression=100
for action in ['walk','scan','type']:
    frames=[]
    for n in originals:bpy.data.objects[n].animation_data_clear()
    for i in range(8):
        S.frame_set(i+1)
        for n,m in originals.items(): bpy.data.objects[n].matrix_world=m
        p=math.tau*i/8
        probe_transform=Matrix.Identity(4)
        foot_contacts=[]
        for side in [-1,1]:
            y=side*.22; arm_y=side*.4; chain=legs[side]
            if action=='walk':
                cycle=p+(math.pi if side>0 else 0)
                # Two-link inverse kinematics: support foot stays on the ground;
                # swing foot lifts. Only the body lowers, the scene anchor is fixed.
                stride=.35
                foot_x=stride*math.cos(cycle)
                lift=.18*max(0,math.sin(cycle))
                dx=foot_x;dz=.28+lift-1.02
                l1=.37;l2=.45
                knee=math.acos(max(-1,min(1,(dx*dx+dz*dz-l1*l1-l2*l2)/(2*l1*l2))))
                hip=math.atan2(-dx,-dz)-math.atan2(l2*math.sin(knee),l1+l2*math.cos(knee))
                body=Matrix.Translation(Vector((0,0,-.08)))
                H=body@rot((-.02,y,1.1),hip)
                K=H@rot((-.02,y,.73),knee)
                F=K@rot((-.02,y,.28),-hip-knee)
                apply(chain['thigh'],H);apply(chain['shin'],K);apply(chain['foot'],F)
                foot_contacts.append(F@(turn@Vector((.12,y,0))))
                U=rot((0,arm_y,1.67),.28*math.cos(cycle));T=U@rot((.08,arm_y*1.2,1.28),-.12)
            elif action=='scan':
                upperangle=(-.78+.10*math.sin(p)) if side<0 else (-.30+.07*math.cos(p))
                elbowangle=(-.66+.12*math.sin(p+.7)) if side<0 else -.45
                U=rot((0,arm_y,1.67),upperangle);T=U@rot((.08,arm_y*1.2,1.28),elbowangle)
            else:
                cycle=p+(math.pi if side>0 else 0)
                U=rot((0,arm_y,1.67),-.78+.065*math.sin(cycle))
                T=U@rot((.08,arm_y*1.2,1.28),-.70+.13*math.sin(cycle+.3))
            if action=='walk': U=body@U;T=body@T
            apply(chain['upper'],U);apply(chain['fore'],T)
            if side<0:probe_transform=T
        if action=='scan':
            apply(head,rot((0,0,1.88),.22*math.sin(p),(0,0,1))@rot((0,0,1.88),-.07+.09*math.cos(p)))
        elif action=='type':apply(head,rot((0,0,1.88),.10+.025*math.cos(p)))
        else:
            moving_names=set(head)
            for chain in legs.values():
                for ns in chain.values():moving_names.update(ns)
            apply([n for n in originals if n not in moving_names],body)
            apply(head,body@rot((0,0,1.88),.035*math.sin(p),(0,0,1)))
        for n in originals:
            o=bpy.data.objects[n];o.keyframe_insert(data_path='location',frame=i+1);o.keyframe_insert(data_path='rotation_euler',frame=i+1)
        bpy.context.view_layer.update()
        name=f'worker-{action}-{i:02d}'
        frames.append({'file':f'renders/{name}.png','frame':i,'durationMs':150,'groundAnchorSource':pixel((0,0,0)),'sockets':{'probeTip':[v/2 for v in pixel(probe_transform@tool_tip)]},'probeTipSource':pixel(probe_transform@tool_tip),'footContactsSource':[pixel(v) for v in foot_contacts], 'footHeightsWorld':[round(v.z,6) for v in foot_contacts]})
        if '--source-only' not in sys.argv:render(name)
    S.render.fps=20;S.render.fps_base=3;S.frame_start=1;S.frame_end=8
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'blend'/f'worker-{action}.blend'))
    meta['animations'][action]={'durationMs':1200,'frameDurationMs':150,'frames':frames,'staticFallbackFrame':0,'suggestedStrideLogicalPixels':36 if action=='walk' else 0}
    (OUT/'worker-motion-metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
    print('LOOP_COMPLETE',action,flush=True)
(OUT/'source/rebuild-living-worker.py').write_text(Path(__file__).read_text())
