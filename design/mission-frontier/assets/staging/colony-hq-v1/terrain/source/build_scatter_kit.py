"""Shared scatter kit for colony parcels (slice 2A). Run Blender -b -t 2 --python this_file.py.

One small GLB carries the pieces the runtime instances per project from a seeded layout: the retained
CC0 purple (and one olive) twisted trees from the accepted environment, three boulders, a lantern post
and two parked vehicles. Every item is a root empty named MF_<Kind>_<Variant> with its meshes as
children, anchored at ground centre, so the placer only needs (x, z, rotation, scale).
"""
import bpy, bmesh, math, json, hashlib, random, struct
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parents[1]/'exterior-bases/astra-kit/environment.blend'
BUDGET_BYTES=3_000_000;BUDGET_TRIS=30_000

def xyz(p):return (p[0],-p[2],p[1])
def material(name,color,rough=.8,metal=0.0,emission=0.0):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.use_backface_culling=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m
def root(name):
    o=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(o);return o
def attach(o,parent,name,mat=None):
    o.name=name;o.parent=parent
    if mat is not None:o.data.materials.clear();o.data.materials.append(mat)
    return o
def box(parent,name,p,size,mat,angle=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object;o.scale=(size[0],size[2],size[1]);o.rotation_euler.z=-angle
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return attach(o,parent,name,mat)
def cyl(parent,name,p,r,h,mat,n=16,axis='Y'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=h,location=xyz(p));o=bpy.context.object
    if axis=='X':o.rotation_euler=(0,math.pi/2,0)
    elif axis=='Z':o.rotation_euler=(math.pi/2,0,0)
    return attach(o,parent,name,mat)
def uv_box(o,tile=3.0):
    uv=o.data.uv_layers.new(name='UVMap') if not o.data.uv_layers else o.data.uv_layers.active
    for f in o.data.polygons:
        n=f.normal
        for li in f.loop_indices:
            v=o.data.vertices[o.data.loops[li].vertex_index].co
            uv.data[li].uv=((v.y,v.z) if abs(n.x)>=max(abs(n.y),abs(n.z)) else (v.x,v.z) if abs(n.y)>=abs(n.z) else (v.x,v.y))
            uv.data[li].uv=(uv.data[li].uv[0]/tile,uv.data[li].uv[1]/tile)

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene=bpy.context.scene
# --- trees: retained twisted trees, leaves + bark pairs, decimated for repetition and re-anchored at ground centre.
tree_sets={'MF_Tree_Purple_A':('retained_twisted_tree_1','retained_twisted_tree_1.001'),
           'MF_Tree_Purple_B':('retained_twisted_tree_2','retained_twisted_tree_2.001'),
           'MF_Tree_Purple_C':('retained_twisted_tree_4','retained_twisted_tree_4.001'),
           'MF_Tree_Purple_D':('retained_twisted_tree_5','retained_twisted_tree_5.001'),
           'MF_Tree_Olive_A':('retained_twisted_tree_6','retained_twisted_tree_6.001')}
keep=[]
bark=None
for item,names in tree_sets.items():
    templates=[bpy.data.objects[n] for n in names]
    coords=[t.matrix_world@Vector(v) for t in templates for v in t.bound_box]
    anchor=Vector(((min(v.x for v in coords)+max(v.x for v in coords))/2,(min(v.y for v in coords)+max(v.y for v in coords))/2,min(v.z for v in coords)))
    r=root(item)
    for t in templates:
        o=t.copy();o.data=t.data.copy();scene.collection.objects.link(o);o.matrix_world=t.matrix_world.copy();o.parent=None
        o.location=o.location-anchor;o.parent=r
        mod=o.modifiers.new('Colony repeated asset budget','DECIMATE');mod.ratio=.32
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
        for polygon in o.data.polygons:polygon.use_smooth=False
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
        if o.data.attributes.get('custom_normal'):o.data.attributes.remove(o.data.attributes['custom_normal'])
        for i,m in enumerate(o.data.materials):
            if m and m.name.startswith('Bark_TwistedTree'):
                if bark is None:
                    bark=material('scatter_twisted_bark',(.19,.16,.11),.9)
                    src=next(n.image for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image and 'Normal' not in n.image.name)
                    im=src.copy();im.name='scatter_bark_albedo';im.scale(512,512);im.pack()
                    node=bark.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
                    bark.node_tree.links.new(node.outputs['Color'],bark.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
                o.data.materials[i]=bark
            elif m:m.use_backface_culling=False   # leaf cards read from both sides
        o.name=item+'_'+('leaves' if 'leaves' in (o.data.materials[0].name if o.data.materials and o.data.materials[0] else '') else 'bark')
        keep.append(o)
    keep.append(r)
# Leaf textures: one shared 1024 image is enough for the kit budget.
for im in bpy.data.images:
    if 'Leaves' in im.name and max(im.size)>1024:im.scale(1024,1024)
# Drop every other object from the environment.
for o in list(scene.objects):
    if o not in keep:bpy.data.objects.remove(o,do_unlink=True)
# --- boulders: displaced ico spheres in the colony limestone palette.
rock_mat=material('scatter_limestone_boulder',(.40,.36,.27),.96)
rng=random.Random(2026)
for j,(name,radius,sub) in enumerate([('MF_Boulder_A',1.0,2),('MF_Boulder_B',1.35,2),('MF_Boulder_C',.7,1)]):
    r=root(name);bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=radius,location=(0,0,radius*.7));o=bpy.context.object
    for v in o.data.vertices:
        v.co=v.co*(1+.18*math.sin(v.co.x*3.1+j)+.14*math.sin(v.co.y*4.3-j)+.12*math.sin(v.co.z*5.7))
        v.co.z=max(v.co.z,-radius*.65)
    o.scale=(1.0,rng.uniform(.8,1.25),rng.uniform(.65,.9));bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for polygon in o.data.polygons:polygon.use_smooth=False
    attach(o,r,name+'_rock',rock_mat);uv_box(o,2.0)
# --- lantern post: dark metal post with a warm marker cap the runtime can pool as a lamp.
post_mat=material('scatter_lantern_post',(.16,.17,.19),.5,.6);cap_mat=material('practical_station_marker',(1.0,.78,.45),.3,0.0,2.4)
r=root('MF_Lantern')
box(r,'MF_Lantern_base',(0,.08,0),(.42,.16,.42),post_mat);cyl(r,'MF_Lantern_post',(0,1.35,0),.07,2.4,post_mat,10)
box(r,'MF_Lantern_head',(0,2.62,0),(.34,.28,.34),post_mat);box(r,'MF_Lantern_cap',(0,2.66,0),(.26,.14,.26),cap_mat)
# --- vehicles: a six-wheel utility rover and a cargo cart, both parked (no runtime state baked in).
body=material('scatter_vehicle_ivory',(.82,.8,.74),.45,.15);dark=material('scatter_vehicle_graphite',(.13,.14,.15),.6,.4);ochre=material('scatter_utility_ochre',(.62,.39,.12),.7);glass=material('scatter_vehicle_glass',(.35,.55,.62),.15,.2)
r=root('MF_Vehicle_Rover')
box(r,'rover_chassis',(0,.72,0),(3.6,.5,1.9),dark);box(r,'rover_deck',(.35,1.05,0),(2.4,.16,1.95),body)
box(r,'rover_cab',(-1.05,1.45,0),(1.3,.95,1.7),body);box(r,'rover_glass',(-1.62,1.55,0),(.1,.6,1.3),glass)
box(r,'rover_cargo',(.6,1.45,0),(1.4,.65,1.2),ochre);box(r,'rover_roll_bar',(.1,1.62,0),(.12,.3,1.7),dark)
for x in [-1.15,0,1.15]:
    for z in [-1.0,1.0]:cyl(r,'rover_wheel',(x,.5,z),.5,.4,dark,14,'Z')
r=root('MF_Vehicle_Cart')
box(r,'cart_bed',(0,.62,0),(2.25,.3,1.3),dark);box(r,'cart_cargo',(0,1.0,0),(1.35,.45,.85),ochre);box(r,'cart_handle',(1.35,.9,0),(.5,.06,.9),dark)
for x in [-.8,.8]:
    for z in [-.45,.45]:cyl(r,'cart_wheel',(x,.3,z),.3,.18,dark,12,'Z')
bpy.context.view_layer.update()
# --- export and measure
for o in scene.objects:
    if o.type=='MESH':
        for m in o.data.materials:
            if m and not m.node_tree.nodes.get('Principled BSDF'):raise SystemExit('material without principled: '+m.name)
items={}
for o in scene.objects:
    if o.type=='EMPTY' and o.name.startswith('MF_'):
        pts=[c.matrix_world@Vector(v) for c in o.children_recursive if c.type=='MESH' for v in c.bound_box]
        lo=[min(p[i] for p in pts) for i in range(3)];hi=[max(p[i] for p in pts) for i in range(3)]
        items[o.name]={'footprintRadius':round(max(hi[0]-lo[0],hi[1]-lo[1])/2,3),'height':round(hi[2]-lo[2],3),'meshes':sorted(c.name for c in o.children_recursive if c.type=='MESH')}
        if o.name=='MF_Lantern':items[o.name]['lampOffset']=[0,2.72,0]
path=ROOT/'scatter-kit.glb'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scatter-kit.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,export_cameras=False,export_lights=False)
raw=path.read_bytes();gltf=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
tris=sum(gltf['accessors'][p['indices']]['count']//3 for m in gltf['meshes'] for p in m['primitives'])
assert len(raw)<=BUDGET_BYTES and tris<=BUDGET_TRIS,(len(raw),tris)
assert all('uri' not in im for im in gltf.get('images',[])) and len(gltf.get('images',[]))<=8
metadata={'file':'scatter-kit.glb','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'triangles':tris,'images':len(gltf.get('images',[])),'items':items,'budget':{'bytes':BUDGET_BYTES,'triangles':BUDGET_TRIS},'source':'exterior-bases/astra-kit/environment.blend (retained CC0 twisted trees), deterministic Blender geometry otherwise'}
(ROOT/'scatter-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
print('SCATTER_COMPLETE',json.dumps({'bytes':len(raw),'triangles':tris,'images':metadata['images'],'items':list(items)}))
