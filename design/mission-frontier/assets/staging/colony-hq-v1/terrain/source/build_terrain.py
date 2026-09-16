"""Rebuild closed colony parcels from the frozen contract and retained CC0 library.
Run Blender -b -t 2 --python this_file.py. No downloads or paid generation.
"""
import bpy, bmesh, math, json, hashlib, random, sys, struct
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT.parent / 'contract.json').read_text())
SOURCE = ROOT.parents[1] / 'exterior-bases/astra-kit/environment.blend'
N = 192
EDGES = CONTRACT['colony']['edges']

def xyz(p): return (p[0], -p[2], p[1])
def world(p): return [round(p[0],5), round(p[2],5), round(-p[1],5)]
def group(name):
    o=bpy.data.objects.new(name,None); bpy.context.scene.collection.objects.link(o); return o

def mesh(name,verts,faces,ma,parent):
    me=bpy.data.meshes.new(name); me.from_pydata([xyz(v) for v in verts],[],faces); me.update()
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(me); bm.free()
    o=bpy.data.objects.new(name,me); bpy.context.scene.collection.objects.link(o); o.parent=parent
    for m in ma: me.materials.append(m)
    return o

def material(name,color,rough=.85):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.use_backface_culling=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
    return m

def portable(name,source,color):
    m=material(name,color); p=m.node_tree.nodes.get('Principled BSDF'); images=[]
    for node in source.node_tree.nodes:
        if node.type=='TEX_IMAGE' and node.image: images.append(node.image)
    for role,keys,socket in [('color',['albedo','diff','Diffuse'],'Base Color'),('normal',['normal','nor_gl'],'Normal')]:
        im=next((i for i in reversed(images) if any(k in i.name for k in keys)),None)
        if not im: continue
        cp=im.copy();cp.name=name+'_'+role;cp.scale(min(1024,cp.size[0]),min(1024,cp.size[1]));cp.pack()
        node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=cp
        if role=='normal':
            normal=m.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.55
            m.node_tree.links.new(node.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],p.inputs[socket])
        else:m.node_tree.links.new(node.outputs['Color'],p.inputs[socket])
    return m

def bake_palette_texture(m,kind):
    size=512;im=bpy.data.images.new(kind+'_portable_albedo',width=size,height=size)
    pixels=[];rng=random.Random(736)
    for j in range(size):
        for i in range(size):
            u,v=i/size*math.tau,j/size*math.tau
            broad=.5+.22*math.sin(u*2+.8*math.sin(v*3))+.16*math.sin(v*4+math.cos(u*3))
            grain=(rng.random()-.5)*.028
            if kind=='meadow_gravel':
                grass=(.34,.39,.22);gravel=(.43,.43,.31);f=max(0,min(1,(broad-.37)*1.4))
                col=[a*(1-f)+b*f+grain for a,b in zip(grass,gravel)]
            else:
                stratum=.035*math.sin(v*17+math.sin(u*2))+.015*math.sin(v*39+u)
                col=[c+stratum+grain for c in (.56,.49,.36)]
            pixels.extend((*col,1))
    im.pixels.foreach_set(pixels);im.pack()
    nodes=m.node_tree.nodes;p=nodes.get('Principled BSDF')
    for link in list(m.node_tree.links):
        if link.to_node==p and link.to_socket.name=='Base Color':m.node_tree.links.remove(link)
    node=nodes.new('ShaderNodeTexImage');node.image=im;m.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
    return m

def uv_project(o):
    uv=o.data.uv_layers.new(name='UVMap')
    for f in o.data.polygons:
        normal=f.normal
        for li in f.loop_indices:
            v=o.data.vertices[o.data.loops[li].vertex_index].co
            if abs(normal.z)>.5: co=(v.x/9,v.y/9)
            elif abs(normal.x)>abs(normal.y): co=(v.y/8,v.z/8)
            else:co=(v.x/8,v.z/8)
            uv.data[li].uv=co

def box(name,p,size,ma,parent,angle=0,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object;o.name=name;o.scale=(size[0],size[2],size[1]);o.rotation_euler.z=-angle
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.parent=parent;o.data.materials.append(ma)
    if bevel:
        mod=o.modifiers.new('Soft weathered arris','BEVEL');mod.width=bevel;mod.segments=2
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def annulus(name,ri,ro,y,ma,parent,segments=192):
    vv=[(r*math.cos(i*math.tau/segments),y,r*math.sin(i*math.tau/segments)) for r in [ri,ro] for i in range(segments)]
    # Blender bmesh orientation repair cannot orient an isolated open annulus reliably; explicit top winding.
    ff=[(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)]
    o=mesh(name,vv,ff,[ma],parent)
    if o.data.polygons[0].normal.z<0:
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    uv_project(o);return o

def edge_distance(x,z):
    distances=[]
    for e in EDGES:
        a=math.radians(e['worldAngleDeg']);along=x*math.cos(a)+z*math.sin(a)
        if along>28:distances.append(abs(-x*math.sin(a)+z*math.cos(a)))
    return min(distances,default=100)

def coast(a,phase):return 44.6+.52*math.sin(5*a+phase)+.32*math.sin(9*a-.7)+.18*math.sin(15*a+1.2)
def top_height(r,a):
    if r<=34:return 4
    x,z=r*math.cos(a),r*math.sin(a);d=edge_distance(x,z)
    if d<3.5:return 4
    rear=(math.degrees(a)%360)>=200 and (math.degrees(a)%360)<=340
    ridge=0
    if rear and 36<=r<=42 and d>7:
        ridge=3.3*math.sin(math.pi*(r-36)/6)*max(0,math.sin(math.pi*(math.degrees(a)%360-200)/140))
    shoulder=4-.10*max(0,r-36)+(1.1*math.sin(a*3+.7)+.45*math.sin(a*9))*min(1,(r-34)/6)
    return shoulder+ridge

def core(kind,ma,parent):
    phase=.45 if kind=='a' else 1.5
    # Equal angular indices across concentric rings form one welded manifold.
    rings=[(r,None) for r in [10,20,27.5,32.5,34,35,36,37,38,39,40,41,42]]+[(None,.65),(None,.25),(None,-1.3),(None,-3)]
    verts=[(0,4,0)]
    for ri,(r,y) in enumerate(rings):
        for i in range(N):
            a=i*math.tau/N;cr=coast(a,phase)
            radius=r if r is not None else cr+({.65:-.4,.25:0,-1.3:.16,-3:.25}[y])
            h=top_height(radius,a) if y is None else y
            verts.append((radius*math.cos(a),h,radius*math.sin(a)))
    faces=[(0,1+(i+1)%N,1+i) for i in range(N)]
    for ri in range(len(rings)-1):
        for i in range(N):
            p=1+ri*N+i;q=1+ri*N+(i+1)%N
            faces.append((p,q,q+N,p+N))
    bottom=len(verts);verts.append((0,-3,0));start=1+(len(rings)-1)*N
    faces += [(bottom,start+i,start+(i+1)%N) for i in range(N)]
    o=mesh('parcel_closed_manifold_core',verts,faces,ma,parent)
    for f in o.data.polygons:
        r=math.hypot(f.center.x,f.center.y)
        ring_index=(f.index-N)//N
        f.material_index=(0 if r<34 else 4) if ring_index<12 else (1 if ring_index==12 else (2 if ring_index<15 else 3))
    uv_project(o)
    for f in o.data.polygons:
        if math.hypot(f.center.x,f.center.y)>42:
            for li in f.loop_indices:
                v=o.data.vertices[o.data.loops[li].vertex_index].co
                o.data.uv_layers.active.data[li].uv=(math.atan2(-v.y,v.x)*3,v.z/8)
    # The water intersection is sampled from the exact straight segments between .25 and -1.3 rings.
    loop=[]
    for i in range(0,N,2):
        a=i*math.tau/N;r=coast(a,phase)+.16*.25/1.55
        loop.append([round(r*math.cos(a),5),round(r*math.sin(a),5)])
    loop.append(loop[0]);return o,loop

def planting(parent,materials,kind):
    rng=random.Random(612 if kind=='a' else 984)
    verts=[];faces=[]
    # Sparse coastal salt grass keeps every operational route and flat HQ footprint clear.
    for j in range(1000):
        a=rng.random()*math.tau;r=rng.uniform(34.5,41.6);x,z=r*math.cos(a),r*math.sin(a)
        if edge_distance(x,z)<5 or top_height(r,a)>4.8:continue
        y=top_height(r,a)+.025
        for k in range(3):
            t=rng.random()*math.tau;w=rng.uniform(.07,.15);h=rng.uniform(.25,.7);n=len(verts)
            verts.extend([(x-w*math.cos(t),y,z-w*math.sin(t)),(x+w*math.cos(t),y,z+w*math.sin(t)),(x+.2*math.cos(t+.5),y+h,z+.2*math.sin(t+.5))]);faces.extend([(n,n+1,n+2),(n+2,n+1,n)])
    o=mesh('retained_palette_coastal_salt_grass',verts,faces,materials,parent)
    for f in o.data.polygons:f.material_index=(f.index//6)%len(materials)
    # Reuse accepted twisted tree components, reduced once for colony repetition.
    for j,(a,r,scale) in enumerate([(209,37,.53),(282,39,.55),(325,37,.46)]):
        angle=math.radians(a);x,z=r*math.cos(angle),r*math.sin(angle)
        if edge_distance(x,z)<7:continue
        for template in TREES:
            o=template.copy();o.data=template.data.copy();bpy.context.scene.collection.objects.link(o)
            o.name='retained_cc0_tree_'+str(j)+'_'+template.name;o.parent=parent
            # Normalize source assembled geometry together using source world bounds.
            o.matrix_world=template.matrix_world.copy();o.location=(o.location-TREE_ANCHOR)*scale+Vector(xyz((x,top_height(r,angle),z)));o.scale*=scale
            mod=o.modifiers.new('Colony repeated asset budget','DECIMATE');mod.ratio=.22
            bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
            for polygon in o.data.polygons:polygon.use_smooth=False
            bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
            if o.data.attributes.get('custom_normal'):o.data.attributes.remove(o.data.attributes['custom_normal'])
            for m in o.data.materials:
                if m:m.use_backface_culling=True

def validate(core_o,loop):
    bm=bmesh.new();bm.from_mesh(core_o.data)
    boundary=sum(e.is_boundary for e in bm.edges);nonmanifold=sum(not e.is_manifold for e in bm.edges);volume=bm.calc_volume(signed=True)
    bm.free();verts=[v.co for v in core_o.data.vertices];polys=[list(f.vertices) for f in core_o.data.polygons];bvh=BVHTree.FromPolygons(verts,polys)
    downward=sum(f.normal.z<-.5 and f.center.z>-2.999 for f in core_o.data.polygons)
    def inside(x,z):
        hit=False
        for (ax,az),(bx,bz) in zip(loop,loop[1:]):
            if (az>z)!=(bz>z) and x<(bx-ax)*(z-az)/(bz-az)+ax:hit=not hit
        return hit
    fails=[];back=[];checked=0;direction=Vector(xyz((-51,-46,-68))).normalized()
    for ix in range(-92,93):
        for iz in range(-92,93):
            x,z=ix*.5,iz*.5
            if not inside(x,z):continue
            checked+=1;target=Vector(xyz((x,0,z)))
            for label,d in [('vertical',Vector((0,0,-1))),('exterior',direction)]:
                p,n,_,_=bvh.ray_cast(target-d*200,d,400)
                if p is None or p.z<=0:fails.append([label,x,z])
                elif n.dot(d)>=0:back.append([label,x,z])
    result={'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold,'signedVolume':volume,'downwardExposedFaces':downward,'gridPitch':.5,'gridCells':checked,'rayCount':checked*2,'seeThroughCells':fails,'backFaceHits':back,'seabedBottomFacesExemptFromUpwardCheck':True}
    assert boundary==nonmanifold==downward==0 and volume>0 and not fails and not back,result
    return result

def setup_preview(kind):
    s=bpy.context.scene;s.render.engine='BLENDER_EEVEE';s.render.resolution_x=1200;s.render.resolution_y=900;s.render.resolution_percentage=100
    s.world.color=(.24,.3,.35);s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.24,.33,.39,1)
    s.world.node_tree.nodes['Background'].inputs[1].default_value=.6
    bpy.ops.object.light_add(type='AREA',location=(20,-35,75));bpy.context.object.data.energy=70000;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=65
    bpy.ops.object.camera_add(location=xyz((71.4,68.7,101.2)));cam=bpy.context.object;cam.rotation_euler=(Vector(xyz((0,4.3,6)))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=111;s.camera=cam
    s.view_settings.view_transform='AgX';s.render.image_settings.file_format='PNG';s.render.filepath=str(ROOT/'previews'/f'parcel-{kind}-front-side-only.png')
    water=material('preview_water_only',(.055,.22,.26),.32);o=box('PREVIEW_ONLY_sea',(0,-.045,0),(230,.05,230),water,None)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(o,do_unlink=True)

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
SOURCE_MATS={n:bpy.data.materials[n] for n in ['terrain_gravel_sand','terrain_stratified_warm_limestone','coastal_cliff_01']}
TREES=[bpy.data.objects[n].copy() for n in ['retained_twisted_tree_0','retained_twisted_tree_0.001']]
for t in TREES:
    t.data=t.data.copy()
    for i,m in enumerate(t.data.materials):
        if m and m.name=='Bark_TwistedTree':
            bark=material('retained_cc0_twisted_bark',(.19,.16,.11))
            source_image=next(n.image for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image and 'Normal' not in n.image.name)
            im=source_image.copy();im.scale(1024,1024);im.pack();node=bark.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
            bark.node_tree.links.new(node.outputs['Color'],bark.node_tree.nodes['Principled BSDF'].inputs['Base Color']);t.data.materials[i]=bark
coords=[t.matrix_world@Vector(v) for t in TREES for v in t.bound_box]
TREE_ANCHOR=Vector(((min(v.x for v in coords)+max(v.x for v in coords))/2,(min(v.y for v in coords)+max(v.y for v in coords))/2,min(v.z for v in coords)))
MATS=[portable('terrain_plateau_gravel',SOURCE_MATS['terrain_gravel_sand'],(.34,.36,.24)),portable('terrain_shoulder_rock',SOURCE_MATS['terrain_stratified_warm_limestone'],(.52,.48,.33)),portable('coastal_cliff_01_colony',SOURCE_MATS['coastal_cliff_01'],(.57,.52,.38)),material('terrain_seabed',(.20,.27,.25)),material('terrain_coastal_meadow',(.245,.285,.12))]
bake_palette_texture(MATS[0],'meadow_gravel');bake_palette_texture(MATS[2],'stratified_limestone')
MATS[4]=MATS[0];MATS[1]=MATS[2]
for node in MATS[0].node_tree.nodes:
    if node.type=='NORMAL_MAP':node.inputs['Strength'].default_value=.10
ROAD=material('road_basalt_worn',(.115,.145,.155),.9);MARK=material('road_marking_ochre',(.59,.39,.13));PAD=material('pad_landing_concrete',(.42,.43,.4));TRIM=material('utility_ochre',(.62,.39,.12));GRASS=[material('salt_grass_'+str(i),c) for i,c in enumerate([(.2,.27,.11),(.28,.34,.16),(.36,.38,.19)])]
metadata={'contractVersion':CONTRACT.get('version',CONTRACT.get('contractVersion')),'axes':'glTF X right, Y up, +Z front','files':{},'interpretations':['Frozen movement.spurs has fromRadius=toRadius=32.5; independently hideable junction mouths occupy ring r30-32.5 without changing pads.','Seabed bottom faces face downward by closed-solid definition and are exempt from exposed upward-winding rule.']}
for kind in ['hub','a']:
    for o in list(bpy.context.scene.objects):bpy.data.objects.remove(o,do_unlink=True)
    terrain=group('MF_Terrain');plants=group('MF_Planting');road=group('MF_Road_Ring');practical=group('MF_Practicals')
    core_o,shore=core(kind,MATS,terrain)
    rock_rng=random.Random(948)
    for i in range(34):
        a=i*math.tau/34+.035;rr=42.5;xx,zz=rr*math.cos(a),rr*math.sin(a)
        if edge_distance(xx,zz)<5:continue
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=xyz((xx,1.4,zz)))
        rock=bpy.context.object;rock.name='grounded_limestone_rim_'+str(i);rock.parent=terrain
        rock.scale=(rock_rng.uniform(.8,1.5),rock_rng.uniform(.8,1.5),rock_rng.uniform(1.0,1.8));rock.data.materials.append(MATS[2]);uv_project(rock)
    annulus('ring_road_surface',27.5,32.5,4.014,ROAD,road)
    for r in [27.64,32.36]:annulus('ring_road_ochre_edge_'+str(r),r-.045,r+.045,4.022,MARK,road)
    for i in range(48):
        a=i*math.tau/48;box('ring_lane_dash',(30*math.cos(a),4.023,30*math.sin(a)),(1.0,.012,.08),MARK,road,a+math.pi/2)
    pads={};roads={'ring':[[round(30*math.cos(i*math.tau/64),4),4,round(30*math.sin(i*math.tau/64),4)] for i in range(65)]}
    for e in EDGES:
        edge=e['edge'];a=math.radians(e['worldAngleDeg']);c,s=math.cos(a),math.sin(a);pg=group('MF_Pad_'+edge);sg=group('MF_Road_Spur_'+edge)
        box('pad_closed_abutment_'+edge,(36.5*c,.625,36.5*s),(8,7.25,6),PAD,pg,a)
        box('spur_junction_'+edge,(31.25*c,4.029,31.25*s),(2.5,.018,5),ROAD,sg,a)
        for side in [-1,1]:
            box('pad_safety_edge_'+edge,(36.5*c-side*2.84*s,4.268,36.5*s+side*2.84*c),(7.65,.025,.11),MARK,pg,a)
        pads[edge]=[round(36.5*c,5),4.25,round(36.5*s,5)];roads[edge]=[[30*c,4,30*s],[32.5*c,4,32.5*s],[36.5*c,4.25,36.5*s],[40.5*c,4.25,40.5*s]]
    if kind=='hub':
        annulus('spaceport_empty_landing_pad',0.001,14,4.25,PAD,terrain)
        annulus('spaceport_pad_ochre_perimeter',13.55,13.72,4.27,MARK,terrain)
        annulus('spaceport_pad_inner_seam',11.8,11.9,4.268,ROAD,terrain)
        for i in range(8):
            a=i*math.tau/8;box('landing_pad_alignment_mark',(12.7*math.cos(a),4.275,12.7*math.sin(a)),(.65,.018,.16),MARK,terrain,a)
    planting(plants,GRASS,kind)
    bpy.context.view_layer.update();qa=validate(core_o,shore)
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
    coords=[o.matrix_world@Vector(v) for o in meshes for v in o.bound_box]
    bounds={'min':[min(world(v)[i] for v in coords) for i in range(3)],'max':[max(world(v)[i] for v in coords) for i in range(3)]}
    filename=f'parcel-{kind}.glb';bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'parcel-{kind}.blend'),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/filename),export_format='GLB',export_yup=True,export_apply=True,export_cameras=False,export_lights=False,export_extras=True)
    raw=(ROOT/filename).read_bytes();assert tris<=120000 and len(raw)<=12000000,(tris,len(raw))
    gltf=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]]);export_tris=sum(gltf['accessors'][p['indices']]['count']//3 for m in gltf['meshes'] for p in m['primitives'])
    metadata['files'][filename]={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'triangles':export_tris,'evaluatedInstanceTriangles':tris,'bounds':bounds,'shorelineXZ':[shore],'plateauPolygon':[[34*math.cos(i*math.tau/96),34*math.sin(i*math.tau/96)] for i in range(97)],'roadPolylines':roads,'padCentres':pads,'plantingExclusion':{'flatHqRadius':34,'spurHalfWidth':5,'backdropSpurClearance':7},'lightPositions':[],'validation':qa}
    (ROOT/'parcel-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
    setup_preview(kind)
print('TERRAIN_COMPLETE',json.dumps({k:{'triangles':v['triangles'],'bytes':v['bytes'],'rays':v['validation']['rayCount']} for k,v in metadata['files'].items()}))
