"""Re-seat accepted Command crown and reassemble original bridge components at frozen dimensions."""
import bpy, math
from mathutils import Vector
from hq_lib import *
import build_hq as B


def crown():
    B.setup();group('MF_Roof');group('MF_Roof_Crown','MF_Roof');use('MF_Roof')
    # Continuous, sealed roof with articulated sector plates above the shared hex shell.
    B.slab('hex_roof_gasket',hex_points(18.35),9.22,9.58,'structure_graphite_joints',.05)
    B.slab('hex_roof_deck',hex_points(18.18),9.58,9.82,'structure_ivory_ceramic',.06)
    for phi in [30,90,150,210,270,330]:
        a,bb=flat_segment(phi,15.68)
        B.strip('roof_perimeter_reveal',a,bb,9.85,'brushed_titanium',.11)
        B.strip('roof_sector_seam',radial(phi-30,7),radial(phi-30,17.8),9.845,'structure_graphite_joints',.07)
    # Preserve the accepted segmented central drum, upper armour, neutral identity and sensors.
    prefixes=('central_roof_service_cap','command_clerestory','core_dark_collar','core_ivory_drum','core_upper_recess','identity_','radial_core_panel','radial_upper_armour_panel','roof_sensor_')
    with bpy.data.libraries.load(str(KIT_COMMAND),link=False) as (src,dst):
        dst.objects=[n for n in src.objects if n.startswith(prefixes)]
    for o in dst.objects:
        if o is None:continue
        bpy.context.scene.collection.objects.link(o);bpy.context.view_layer.update();mw=o.matrix_world.copy();o.parent=None;o.matrix_world=mw
        # Original crown centre z=-5; new crown sits over the actual central hub.
        o.location.y-=5;o.location.z-=.45;o.parent=bpy.data.objects['MF_Roof_Crown']
    dedupe_datablocks()
    use('MF_Roof')
    for phi in [30,150]:
        # Curved low roof bays: individual capsule segments retain engineered panel gaps.
        x,z=radial(phi,11.2)
        B.slab('command_curved_bay_gasket',rounded_outline(8.6,5.9,2.7,10,phi+90,(x,z)),9.78,10.15,'structure_graphite_joints',.04)
        for j in range(5):
            t=dirv(phi+90);px,pz=x+t[0]*(j-2)*1.55,z+t[1]*(j-2)*1.55
            # Rounded end plates, broad white ceramic crown surface, restrained metallic seams.
            B.slab('command_bay_armour',rounded_outline(1.49,5.6,.48,6,phi+90,(px,pz)),10.08,10.65+.35*(1-abs(j-2)/2),'structure_ivory_ceramic',.04)
        n=dirv(phi)
        for j in [-2,-1,0,1,2]:
            t=dirv(phi+90);px,pz=x+n[0]*2.9+t[0]*j*1.45,z+n[1]*2.9+t[1]*j*1.45
            B.b('crown_bay_window',(px,10.24,pz),(1.12,.24,.055),'practical_warm_window_glass',.02,phi+90)
    for phi in [210,270,330]:
        x,z=radial(phi,11.1)
        B.b('roof_service_housing',(x,10.08,z),(4.2,.48,2.2),'brushed_titanium',.13,phi+90)
        for j in range(7):
            t=dirv(phi+90);B.b('roof_heat_exchanger_fin',(x+t[0]*(j-3)*.48,10.36,z+t[1]*(j-3)*.48),(.14,.14,1.65),'structure_graphite_joints',.025,phi+90)
        B.b('roof_neutral_identity_trim',radial(phi,14.25,9.89),(3,.035,.14),'identity_trim',.02,phi+90)
    return B.finish('crown-command',['MF_Roof'])


def bridge(end=False):
    B.setup();gn='MF_Bridge_End' if end else 'MF_Bridge';group(gn);use(gn)
    # Component meshes come directly from the accepted editable bridge; dimension normalization
    # below changes span/pier placement without introducing a second visual vocabulary.
    names=['bridge_deck_panel','bridge_structural_deck','bridge_reinforced_pier','bridge_bearing','bridge_guardrail_post','bridge_continuous_rail','bridge_safety_edge','path_bollard.004','practical_bollard_cap.004']
    originals=append_objects(KIT_ENV,names)
    # The reused pier's cliff texture dominates the 2 MB bridge budget; use the shared
    # untextured ceramic concrete palette on that structural component instead.
    for ob in originals:
        if ob.name=='bridge_reinforced_pier':
            ob.data=ob.data.copy();ob.data.materials.clear();ob.data.materials.append(B.M['structure_ivory_ceramic'])
    templates={o.name:o for o in originals}
    def component(key,name,p,size):
        src=templates[key];o=src.copy();o.data=src.data;bpy.context.scene.collection.objects.link(o)
        o.parent=bpy.data.objects[gn];o.name=name;o.location=pos(p)
        o.rotation_euler=(0,0,0);bpy.context.view_layer.update()
        current=o.dimensions.copy();desired=Vector((size[0],size[2],size[1]))
        o.scale=Vector((o.scale.x*desired.x/current.x,o.scale.y*desired.y/current.y,o.scale.z*desired.z/current.z))
        return o
    if end:
        # Root at pad centre; +X outward, abutment face exactly X=+4.0.
        B.b('bridge_abutment_block',(3,.62,0),(2,7.24,6),'structure_graphite_joints',.06)
        # Concrete cap is 1cm below the terrain pad to avoid coplanar surfaces.
        # Wheelchair/cart-friendly graded kerb, 4.0→4.25 from inboard approach.
        pts=[(-4,-3),(-2.8,-3),(-2.8,3),(-4,3)]
        mesh=bpy.data.meshes.new('pad_kerb_ramp');verts=[pos((x,4.0 if x==-4 else 4.25,z)) for x,z in pts]
        verts += [pos((x,3.95,z)) for x,z in pts]
        mesh.from_pydata(verts,[],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]);mesh.update()
        o=bpy.data.objects.new('pad_kerb_ramp',mesh);bpy.context.scene.collection.objects.link(o);o.parent=bpy.data.objects[gn];mesh.materials.append(B.M['court_weathered_basalt'])
        for z in [-2.65,2.65]:
            component('path_bollard.004','abutment_bollard',(3.4,4.82,z),(.38,1.14,.38))
            component('practical_bollard_cap.004','abutment_lamp',(3.4,5.42,z),(.38,.14,.38));light('practical_bollard_cap',(3.4,5.49,z))
    else:
        component('bridge_structural_deck','bridge_structural_deck',(13.5,3.83,0),(27,.68,4))
        for i in range(18): component('bridge_deck_panel','bridge_deck_panel_'+str(i+1),(.75+i*1.5,4.205,0),(1.46,.09,4))
        for x in [6.75,13.5,20.25]:
            component('bridge_reinforced_pier','bridge_reinforced_pier',(x,.45,0),(1.2,6.9,3))
            component('bridge_bearing','bridge_bearing',(x,3.9,0),(1.8,.4,3.8))
        for z in [-1.97,1.97]:
            for y in [4.8,5.29]:component('bridge_continuous_rail','bridge_continuous_rail',(13.5,y,z),(27,.12,.12))
            component('bridge_safety_edge','bridge_safety_edge',(13.5,4.3,z),(27,.1,.15))
            for i in range(19):component('bridge_guardrail_post','bridge_guardrail_post',(.065+i*(26.87/18),4.77,z),(.13,1.16,.13))
    for o in originals:bpy.data.objects.remove(o,do_unlink=True)
    dedupe_datablocks()
    return B.finish('bridge-end' if end else 'bridge-span-27',[gn],{'lights':list(LIGHTS),'deckY':4.25,'length':8 if end else 27})
