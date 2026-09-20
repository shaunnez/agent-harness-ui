"""Deterministically author the colony HQ from the frozen contract; source kit is read-only."""
import sys, json, math, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from hq_lib import *
from export_hq import export_asset, bounds_of

OBSTACLES = []
M = {}

def obstacle(name, objects):
    bpy.context.view_layer.update()
    bounds = bounds_of(objects)
    OBSTACLES.append({'name': name, **{k: bounds[k] for k in ('min','max')}})

def setup():
    global M
    reset_scene(); LIGHTS.clear(); OBSTACLES.clear(); M = load_library()
    # Keep the source identity channels strictly neutral.
    for name in C['materials']['identityTinted']:
        p=M[name].node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value=(.62,.62,.62,1)
        p.inputs['Emission Color'].default_value=(.62,.62,.62,1)
    return M

def slab(name, pts, bottom, top, ma, bevel=.04):
    return prism(name,pts,bottom,top,M[ma],bevel,2)

def b(name,p,size,ma='structure_ivory_ceramic',bevel=.04,rot=0):
    return box(name,p,size,M[ma],bevel,rot,2)

def strip(name,a,bb,y,ma='practical_warm_strip',width=.07):
    return wall(name,a,bb,y,y+.035,width,M[ma],bevel=.008)

def shell():
    setup()
    for name in ['MF_BaseFixed','MF_ShellCutaway','MF_Interior','MF_Court','MF_Props','MF_Practicals','MF_Sockets','MF_Roof']:
        group(name)
    group('MF_ShellCutaway_FrontFlats','MF_ShellCutaway')
    group('MF_ShellCutaway_PartitionGlass','MF_ShellCutaway')
    for room in C['hq']['rooms']: group('MF_Interior_'+room,'MF_Interior')
    use('MF_BaseFixed')
    slab('hex_foundation',hex_points(18.35),GROUND-.08,FLOOR-.14,'structure_graphite_joints',.06)
    slab('hex_floor',hex_points(18),FLOOR-.17,FLOOR,'court_weathered_basalt')
    for phi in [30,90,150,210,270,330]:
        a,bb=flat_segment(phi,APOTHEM-.28)
        gn='MF_ShellCutaway_FrontFlats' if phi in [30,90] else 'MF_BaseFixed'
        use(gn)
        doors=[]
        if phi==90: doors=[(0,APOTHEM,4,3.8),(-6,APOTHEM,2.4,3.8)]
        if phi==270: doors=[(0,-APOTHEM,4,4)]
        wall('perimeter_'+str(phi),a,bb,FLOOR,CEIL,.6,M['structure_ivory_ceramic'],doors,bevel=.07)
        # Deep top/bottom shadow lines, slim warm clerestories and corner buttresses.
        for yy,h,ma in [(FLOOR+.22,.3,'structure_graphite_joints'),(CEIL-.3,.18,'brushed_titanium')]:
            wall('facade_band',a,bb,yy,yy+h,.65,M[ma],doors,bevel=.03)
        tangent=dirv(phi+90); normal=dirv(phi)
        for along in [-5.8,-2.9,2.9,5.8]:
            # Front entrance and rear service aperture remain genuinely open.
            if phi==90 and along in [5.8,2.9]: continue
            x,z=normal[0]*(APOTHEM+.035)+tangent[0]*along,normal[1]*(APOTHEM+.035)+tangent[1]*along
            b('clerestory_recess',(x,7.9,z),(2.2,.83,.12),'structure_graphite_joints',.03,phi+90)
            b('clerestory_glass',(x+normal[0]*.07,7.9,z+normal[1]*.07),(1.95,.49,.05),'practical_warm_window_glass',.02,phi+90)
        for end in [a,bb]:
            b('facade_corner_shoulder',(end[0],6.65,end[1]),(.74,4.7,.74),'brushed_titanium',.12,phi)
        b('parapet_cap',radial(phi,APOTHEM-.3,9.32),(17.65,.54,.87),'structure_ivory_ceramic',.07,phi+90)
    # Individual room polygons are physical inlays with service-route strips.
    for room in C['hq']['rooms']:
        use('MF_Interior_'+room)
        key='room_dispatch_marshalling' if room=='dispatch' else 'room_'+room
        poly=C['movement'][key]['polygon']
        slab(room+'_floor_inlay',poly,FLOOR+.002,FLOOR+.025,'room_inlay_'+room,.015)
        for i,a in enumerate(poly):
            bb=poly[(i+1)%len(poly)]
            strip(room+'_floor_reveal',a,bb,FLOOR+.026,'brushed_titanium',.07)
    # Hub: low hex parapets with real 2.4m clear openings, structural corner posts.
    use('MF_BaseFixed')
    slab('hub_inlay',hex_points(5.72),FLOOR+.001,FLOOR+.018,'structure_graphite_joints')
    for phi in [30,90,150,210,270,330]:
        a,bb=flat_segment(phi,HUB_APOTHEM)
        x,z=radial(phi,HUB_APOTHEM)
        wall('hub_parapet',a,bb,FLOOR,FLOOR+1.1,.26,M['structure_ivory_ceramic'],[(x,z,2.4,3.8)])
        for edge in [-1,1]:
            tx,tz=dirv(phi+90)
            b('hub_door_marker',(x+tx*edge*1.34,FLOOR+1.1,z+tz*edge*1.34),(.15,.06,.25),'practical_console_cyan',.02,phi)
    for x,z in hex_points(6):
        cyl('hub_column',(x,6.5,z),.3,4.4,M['brushed_titanium'],16,.04)
    table=[cyl('hub_table_plinth',(0,4.72,0),1.05,.84,M['structure_graphite_joints']),cyl('hub_table',(0,5.24,0),1.5,.2,M['console_blue_glass'])]
    ring('hub_table_edge',(0,5.36,0),1.36,.055,M['practical_console_cyan'],48,6); obstacle('hub_table',table)
    # Only the 240 radial is omitted: implementation occupies both rear sectors.
    for phi in [0,60,120,180,300]:
        a,bb=radial(phi,6.25),radial(phi,17.45)
        use('MF_BaseFixed'); wall('partition_'+str(phi),a,bb,FLOOR,FLOOR+1.2,.3,M['structure_ivory_ceramic'])
        use('MF_ShellCutaway_PartitionGlass'); glazed_upper('partition_glass_'+str(phi),a,bb,FLOOR+1.2,8.95,M['glass_partition'],M['brushed_titanium'])
    for x in [-2.15,2.15]:
        a,bb=(x,5.6),(x,15.1)
        use('MF_BaseFixed'); wall('dispatch_corridor',a,bb,FLOOR,FLOOR+1.2,.3,M['structure_ivory_ceramic'])
        use('MF_ShellCutaway_PartitionGlass'); glazed_upper('corridor_glass',a,bb,FLOOR+1.2,8.3,M['glass_partition'],M['brushed_titanium'])
    # Projecting loading bay, its own lower roof follows MF_Roof cutaway visibility.
    use('MF_BaseFixed'); b('bay_foundation',(0,4.11,18.59),(10.8,.30,6.02),'structure_graphite_joints')
    use('MF_Interior_dispatch'); b('bay_floor',(0,4.285,18.59),(10.2,.03,6.02),'room_inlay_dispatch')
    for side in [-1,1]:
        use('MF_BaseFixed' if side==-1 else 'MF_ShellCutaway_FrontFlats')
        wall('bay_side',(side*5.1,15.58),(side*5.1,21.6),FLOOR,8.08,.6,M['structure_ivory_ceramic'])
        strip('bay_side_lamp',(side*5.42,16),(side*5.42,21),7.55)
    use('MF_ShellCutaway_FrontFlats')
    wall('bay_front',(-5.4,21.3),(5.4,21.3),FLOOR,8.28,.6,M['structure_ivory_ceramic'],[(0,21.3,4,4)])
    for x in [-2.25,2.25]: b('bay_door_jamb',(x,6.25,21.63),(.34,3.9,.26),'brushed_titanium')
    use('MF_Roof'); b('bay_roof',(0,8.16,18.55),(10.8,.28,6.15),'structure_ivory_ceramic',.1)
    for x in [-3.5,0,3.5]: b('bay_roof_rib',(x,8.34,18.55),(.1,.1,5.8),'brushed_titanium')
    # Broad articulated court with inset joints and practical edge lighting.
    use('MF_Court'); slab('court_grounded_plinth',C['movement']['court']['polygon'],GROUND-.04,COURT,'court_weathered_basalt',.04)
    for x in range(-16,18,4): strip('court_paving_joint',(x,21.8),(x,27.4),COURT+.005,'structure_graphite_joints',.045)
    for z in [17,19,22,24,26]:
        for side in [-1,1]: strip('court_cross_joint',(side*5.55,z),(side*17.9,z),COURT+.005,'structure_graphite_joints',.035)
    for x in [-16,16]:
        strip('court_edge_marker',(x,22.2),(x,26.5),COURT+.018,'utility_ochre',.12)
    use('MF_Practicals')
    for x,z in [(-16,17),(-16,26),(16,17),(16,26)]:
        b('court_bollard',(x,4.81,z),(.34,1.12,.34),'brushed_titanium')
        b('court_bollard_cap',(x,5.39,z),(.36,.08,.36),'practical_station_marker')
        light('practical_station_marker',(x,5.44,z))
    b('delivery_beacon',(4.9,8.47,20.7),(.22,.42,.22),'practical_delivery_beacon');light('practical_delivery_beacon',(4.9,8.6,20.7))
    equipment()
    for room in C['hq']['rooms'].values():
        for s in room['sockets']: socket(s['id'],(s['xz'][0],s['y'],s['xz'][1]),s['facingDeg'])
    for s in C['hq']['hubOverflowSockets']+C['hq']['courtSockets']: socket(s['id'],(s['xz'][0],s['y'],s['xz'][1]),s['facingDeg'])
    socket('base_label',C['interactionSockets']['base_label'],90)
    return finish('hq-shell',['MF_BaseFixed','MF_ShellCutaway','MF_Interior','MF_Court','MF_Props','MF_Practicals','MF_Sockets','MF_Roof'],{'obstacles':list(OBSTACLES),'lights':list(LIGHTS),'doors':C['hq']['doors'],'sockets':[{'id':o.name,'position':list(gl(o.location)),'facingDeg':o.get('facingDeg',90)} for o in bpy.data.objects['MF_Sockets'].children]})

def equipment():
    # Wall consoles leave the socket rows and the hub-door centreline unobstructed.
    for room,phis in [('planning',[150]),('implementation',[210,270]),('review',[330]),('testing',[30])]:
        use('MF_Interior_'+room)
        for phi in phis:
            n=dirv(phi); t=dirv(phi+90)
            for k,along in enumerate([-5.1,-1.7,1.7,5.1]):
                x,z=n[0]*15.0+t[0]*along,n[1]*15.0+t[1]*along
                pieces=[b(room+'_console_base',(x,4.96,z),(1.7,1.3,.55),'structure_graphite_joints',.07,phi+90)]
                b(room+'_console_top',(x,5.69,z),(1.86,.18,.72),'brushed_titanium',.05,phi+90)
                b(room+'_monitor_housing',(x,6.52,z),(1.64,1.2,.18),'structure_graphite_joints',.08,phi+90)
                b(room+'_monitor',(x-n[0]*.12,6.54,z-n[1]*.12),(1.4,.94,.035),'ambient_screen_service',.03,phi+90)
                for j in range(3): b(room+'_console_key',(x+t[0]*(j-1)*.35,5.81,z+t[1]*(j-1)*.35),(.16,.06,.17),'practical_console_cyan',.012,phi+90)
                # Geometric instrument grid, deliberately without task counts or progress text.
                for line in [-.25,0,.25]:
                    b(room+'_instrument_trace',(x-n[0]*.15,6.54+line,z-n[1]*.15),(1.02,.025,.012),'console_blue_glass',.003,phi+90)
                obstacle(room+'_wall_console_'+str(phi)+'_'+str(k),pieces)
            light('practical_console_cyan',radial(phi,14.3,6.5))
    # Low distinct central equipment, set toward room exterior away from hub approaches.
    for room,phi in [('planning',150),('review',330),('testing',30)]:
        use('MF_Interior_'+room); x,z=radial(phi,10.7); y=4.3
        if room=='review':
            pieces=[cyl('review_dais',(x,y+.15,z),1.35,.3,M['brushed_titanium'],32,.04)]
            ring('review_dais_light',(x,y+.34,z),1.2,.035,M['practical_console_cyan'],48,6)
        else:
            pieces=[b(room+'_table',(x,5.05,z),(2.8,1.5,1.0),'structure_graphite_joints',.15,phi+90)]
            b(room+'_table_surface',(x,5.85,z),(3,.16,1.2),'console_blue_glass',.08,phi+90)
            if room=='testing':
                for d in [-.75,.75]:
                    t=dirv(phi+90); xx,zz=x+t[0]*d,z+t[1]*d
                    cyl('testing_diagnostic_rig',(xx,6.05,zz),.24,.4,M['brushed_titanium'],16,.02)
                    ring('testing_sensor_collar',(xx,6.27,zz),.24,.035,M['practical_console_cyan'],24,6)
        obstacle(room+'_central_equipment',pieces)
    use('MF_Interior_implementation'); x,z=radial(240,10.4)
    pieces=[b('implementation_fabrication_bench',(x,5.05,z),(6,1.5,1.35),'structure_graphite_joints',.08,330)]
    b('implementation_bench_top',(x,5.86,z),(6.2,.16,1.6),'brushed_titanium',.07,330)
    for d in [-2.3,-1.15,0,1.15,2.3]:
        t=dirv(330);xx,zz=x+d*t[0],z+d*t[1]
        b('fabrication_module',(xx,6.12,zz),(.65,.38,.7),'structure_ivory_ceramic',.07,330)
        b('fabrication_module_inlay',(xx,6.33,zz),(.43,.025,.45),'utility_ochre',.025,330)
    obstacle('implementation_fabrication_bench',pieces)
    use('MF_Interior_briefing')
    pieces=[b('briefing_qa_console',(-6.8,5.1,13.7),(2.2,1.6,.7),'structure_graphite_joints',.09)]
    b('briefing_scout_display',(-6.8,6.4,14.1),(2.65,1.45,.17),'ambient_screen_service',.06)
    for xx in [-7.55,-6.8,-6.05]:
        b('briefing_scout_panel',(xx,6.5,13.995),(.51,.66,.035),'console_blue_glass',.035)
        b('briefing_console_control',(xx,5.94,13.7),(.32,.07,.23),'practical_console_cyan',.015)
    obstacle('briefing_qa_console',pieces)
    use('MF_Interior_dispatch')
    # Cargo fits frozen pads and never acquires runtime progress or project markings.
    pieces=[b('cargo_crate',(-4,5.1,17),(1.4,1.6,1.4),'utility_ochre',.12)]
    for x in [-4.48,-3.52]: b('cargo_retaining_band',(x,5.1,17),(.11,1.64,1.43),'brushed_titanium',.03)
    b('cargo_lid',(-4,5.94,17),(1.44,.12,1.44),'structure_graphite_joints',.04);obstacle('cargo_crates',pieces)
    pieces=[b('dispatch_cart',(4,4.73,20.2),(2.25,.4,1.3),'brushed_titanium',.1)]
    for x in [3.2,4.8]:
        for z in [19.75,20.65]: cyl('cart_wheel',(x,4.49,z),.18,.3,M['structure_graphite_joints'],16,.025)
    b('cart_cargo',(4,5.11,20.2),(1.35,.4,.8),'utility_ochre',.06);obstacle('cargo_cart',pieces)

def finish(stem, roots, extra=None):
    bpy.context.view_layer.update(); bpy.context.preferences.filepaths.save_version=0; bpy.ops.wm.save_as_mainfile(filepath=str(R/(stem+'.blend')))
    return export_asset(stem,R,roots,extra)

if __name__=='__main__':
    from build_structures import crown, bridge
    from build_crowns import CROWNS
    results={}
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    known=['shell','command','bridge','end',*CROWNS]
    kinds=[x for x in args if x in known] or ['shell','command','bridge','end']
    for kind in kinds:
        result=shell() if kind=='shell' else crown() if kind=='command' else CROWNS[kind]() if kind in CROWNS else bridge(kind=='end')
        results[result['file'].removesuffix('.glb')]=result
    path=R/'hq-metadata.json'; old=json.loads(path.read_text()) if path.exists() else {}
    old.update({'version':'1.0.0','contractVersion':C['version'],'contractSha256':hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest()})
    old.setdefault('assets',{}).update(results)
    old['lights']=old['assets'].get('hq-shell',{}).get('lights',[])
    old['sockets']=old['assets'].get('hq-shell',{}).get('sockets',[])
    old['obstacles']=old['assets'].get('hq-shell',{}).get('obstacles',[])
    path.write_text(json.dumps(old,indent=2)+'\n')
