"""Contract 2.0 scatter kit (environment pass). Blender 5.2.1 headless:

  /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python build_scatter_kit_v2.py

One GLB the runtime instances per parcel from a seeded layout. It carries the 2A pieces (purple and
olive twisted trees, lantern post, two vehicles) and adds: three more tree silhouettes and a bare tree,
purple and olive scrub, dry grass tufts and reeds, three scanned cliff pieces with undercuts (Poly Haven
coastal_cliff_01 / 02, CC0, decimated), large / medium / shoreline rocks in the same cliff material, and
three crystal clusters with an emissive `crystal_glow` material the runtime can tint per parcel.

Every item is a root empty named MF_<Kind>_<Variant> with its meshes as children. Trees, scrub, grass,
rocks and crystals are anchored at ground centre; cliff pieces are anchored at their top centre (the
runtime hangs them from the lip) and face -Y in Blender (+Z in glTF), which the metadata records.
"""
import bpy, bmesh, math, json, hashlib, random, struct
from pathlib import Path
from mathutils import Vector, Matrix
HERE = Path(__file__).resolve().parent
V2 = HERE.parent                                  # colony-v2/producer
STAGING = V2.parent.parent                        # assets/staging
ASTRA = STAGING / 'exterior-bases/astra-kit/environment.blend'
BUDGET_BYTES = 6_000_000; BUDGET_TRIS = 90_000
rng = random.Random(2027)

def xyz(p): return (p[0], -p[2], p[1])
def material(name, color, rough=.8, metal=0.0, emission=0.0, emission_color=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes = True; m.use_backface_culling = True
    p = m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal
    p.inputs['Emission Color'].default_value = (*(emission_color or color), 1); p.inputs['Emission Strength'].default_value = emission
    return m
def root(name):
    o = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(o); return o
def attach(o, parent, name, mat=None):
    o.name = name; o.parent = parent
    if mat is not None: o.data.materials.clear(); o.data.materials.append(mat)
    return o
def box(parent, name, p, size, mat, angle=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p)); o = bpy.context.object; o.scale = (size[0], size[2], size[1]); o.rotation_euler.z = -angle
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True); return attach(o, parent, name, mat)
def cyl(parent, name, p, r, h, mat, n=16, axis='Y'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=h, location=xyz(p)); o = bpy.context.object
    if axis == 'X': o.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Z': o.rotation_euler = (math.pi / 2, 0, 0)
    return attach(o, parent, name, mat)
def uv_box(o, tile=3.0):
    uv = o.data.uv_layers.new(name='UVMap') if not o.data.uv_layers else o.data.uv_layers.active
    for f in o.data.polygons:
        n = f.normal
        for li in f.loop_indices:
            v = o.data.vertices[o.data.loops[li].vertex_index].co
            uv.data[li].uv = ((v.y, v.z) if abs(n.x) >= max(abs(n.y), abs(n.z)) else (v.x, v.z) if abs(n.y) >= abs(n.z) else (v.x, v.y))
            uv.data[li].uv = (uv.data[li].uv[0] / tile, uv.data[li].uv[1] / tile)
def flat_shade(o):
    for polygon in o.data.polygons: polygon.use_smooth = False
def apply_all(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
def decimate(o, ratio):
    mod = o.modifiers.new('Colony repeated asset budget', 'DECIMATE'); mod.ratio = ratio
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=mod.name)
def anchor_children(r, mode='ground'):
    """Move the children so the item's bounds centre sits on x = y = 0 with z = 0 at the bottom (ground) or top."""
    pts = [c.matrix_world @ Vector(v) for c in r.children_recursive if c.type == 'MESH' for v in c.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z if mode == 'ground' else hi.z))
    for c in r.children:
        c.matrix_world = Matrix.Translation(-shift) @ c.matrix_world

bpy.ops.wm.open_mainfile(filepath=str(ASTRA))
scene = bpy.context.scene
keep = []

# --- trees -------------------------------------------------------------------------------------------------------
# 2A pairs plus three new silhouettes (tall, broad, the seventh retained tree recoloured purple) and a bare trunk.
tree_sets = {
    'MF_Tree_Purple_A': ('retained_twisted_tree_1', 'retained_twisted_tree_1.001', (1, 1, 1), None),
    'MF_Tree_Purple_B': ('retained_twisted_tree_2', 'retained_twisted_tree_2.001', (1, 1, 1), None),
    'MF_Tree_Purple_C': ('retained_twisted_tree_4', 'retained_twisted_tree_4.001', (1, 1, 1), None),
    'MF_Tree_Purple_D': ('retained_twisted_tree_5', 'retained_twisted_tree_5.001', (1, 1, 1), None),
    'MF_Tree_Olive_A': ('retained_twisted_tree_6', 'retained_twisted_tree_6.001', (1, 1, 1), None),
    'MF_Tree_Purple_E': ('retained_twisted_tree_2', 'retained_twisted_tree_2.001', (.68, .68, 1.38), None),     # tall, slender
    'MF_Tree_Purple_F': ('retained_twisted_tree_5', 'retained_twisted_tree_5.001', (1.32, 1.32, .72), None),   # broad, low
    'MF_Tree_Purple_G': ('retained_twisted_tree_0', 'retained_twisted_tree_0.001', (.9, .9, .95), 'purple'),   # seventh tree, purple
    'MF_Tree_Bare_A': (None, 'retained_twisted_tree_3.001', (.95, .95, 1.05), None),                          # trunk only
}
bark = None
purple_leaves = bpy.data.materials['coastal_purple_leaves']
def tree_copy(template, r, item, scale, recolour):
    global bark
    o = template.copy(); o.data = template.data.copy(); scene.collection.objects.link(o); o.matrix_world = template.matrix_world.copy(); o.parent = None
    decimate(o, .32)
    apply_all(o)
    o.scale = scale; apply_all(o)
    flat_shade(o)
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(o.data); bm.free()
    if o.data.attributes.get('custom_normal'): o.data.attributes.remove(o.data.attributes['custom_normal'])
    leaves = False
    for i, m in enumerate(o.data.materials):
        if m and m.name.startswith('Bark_TwistedTree'):
            if bark is None:
                bark = material('scatter_twisted_bark', (.19, .16, .11), .9)
                src = next(n.image for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and 'Normal' not in n.image.name)
                im = src.copy(); im.name = 'scatter_bark_albedo'; im.scale(512, 512); im.pack()
                node = bark.node_tree.nodes.new('ShaderNodeTexImage'); node.image = im
                bark.node_tree.links.new(node.outputs['Color'], bark.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
            o.data.materials[i] = bark
        elif m:
            leaves = True
            if recolour == 'purple': o.data.materials[i] = purple_leaves
            o.data.materials[i].use_backface_culling = False
    o.name = item + ('_leaves' if leaves else '_bark'); o.parent = r
    return o
for item, (leaf_name, bark_name, scale, recolour) in tree_sets.items():
    r = root(item)
    for name in (leaf_name, bark_name):
        if name: tree_copy(bpy.data.objects[name], r, item, scale, recolour)
    anchor_children(r); keep.append(r); keep.extend(r.children)
for im in bpy.data.images:
    if 'Leaves' in im.name and max(im.size) > 1024: im.scale(1024, 1024)

# --- scrub: leaf canopies brought down to the ground as low bushes ---------------------------------------------
for item, leaf_name, scale, recolour in [('MF_Scrub_Purple_A', 'retained_twisted_tree_1', (.42, .42, .30), None),
                                          ('MF_Scrub_Purple_B', 'retained_twisted_tree_4', (.36, .5, .26), None),
                                          ('MF_Scrub_Olive_A', 'retained_twisted_tree_6', (.5, .5, .36), None)]:
    r = root(item); o = tree_copy(bpy.data.objects[leaf_name], r, item, scale, recolour); decimate(o, .55)
    anchor_children(r); keep.append(r); keep.extend(r.children)


# --- scanned cliff pieces: Poly Haven coastal cliffs, decimated, top-anchored, face toward -Y ------------------
cliff_sources = {'MF_Cliff_A': ('interlocking_scanned_cliff_0', .13, (1, 1, 1)),
                 'MF_Cliff_B': ('interlocking_scanned_cliff_1', .13, (1, 1, 1.15)),
                 'MF_Cliff_C': ('rear_rocky_terrace', .12, (1.1, 1, 1.25))}
cliff_materials = {}
def cliff_material(src_mat):
    """Re-author the scanned material as albedo + normal only (roughness fixed), shared across pieces."""
    key = src_mat.name.split('.')[0]
    if key in cliff_materials: return cliff_materials[key]
    m = material('rock_' + key, (1, 1, 1), .92); m.use_backface_culling = False
    p = m.node_tree.nodes['Principled BSDF']
    for n in src_mat.node_tree.nodes:
        if n.type != 'TEX_IMAGE' or not n.image: continue
        name = n.image.name
        if '_diff' in name or '_nor_gl' in name:
            im = n.image.copy(); im.name = 'rock_' + key + ('_albedo' if '_diff' in name else '_normal'); im.scale(1024, 1024); im.pack()
            node = m.node_tree.nodes.new('ShaderNodeTexImage'); node.image = im
            if '_diff' in name: m.node_tree.links.new(node.outputs['Color'], p.inputs['Base Color'])
            else:
                node.image.colorspace_settings.name = 'Non-Color'
                nm = m.node_tree.nodes.new('ShaderNodeNormalMap'); m.node_tree.links.new(node.outputs['Color'], nm.inputs['Color'])
                m.node_tree.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    cliff_materials[key] = m; return m
for item, (src_name, ratio, scale) in cliff_sources.items():
    src = bpy.data.objects[src_name]
    o = src.copy(); o.data = src.data.copy(); scene.collection.objects.link(o); o.matrix_world = src.matrix_world.copy()
    r = root(item); o.parent = None
    # On the Astra island every scanned piece faced outward from the island centre; turn that outward
    # direction to -Y so the runtime only has to align -Y (glTF +Z) with the coast normal.
    outward = math.atan2(o.location.y, o.location.x)
    apply_all(o); decimate(o, ratio)
    o.rotation_euler = (0, 0, -math.pi / 2 - outward); apply_all(o); o.scale = scale; apply_all(o)
    o.data.materials[0] = cliff_material(o.data.materials[0]); o.parent = r; o.name = item + '_rock'
    anchor_children(r, 'top'); keep.append(r); keep.extend(r.children)
# Drop every other object from the environment now; the rest is authored here.
for o in list(scene.objects):
    if o not in keep: bpy.data.objects.remove(o, do_unlink=True)

# --- grass tufts and reeds: fans of tapered blades, no texture ------------------------------------------------
grass_mat = material('scatter_dry_grass', (.56, .52, .30), .9); grass_mat.use_backface_culling = False
reed_mat = material('scatter_reed', (.34, .42, .21), .85); reed_mat.use_backface_culling = False
reed_head = material('scatter_reed_head', (.36, .22, .12), .8)
def blades(parent, name, mat, count, height, spread, width, lean):
    bm = bmesh.new()
    for i in range(count):
        a = i / count * math.pi * 2 + rng.uniform(-.3, .3); h = height * rng.uniform(.7, 1.15)
        bx, by = math.cos(a) * spread * rng.uniform(.2, 1), math.sin(a) * spread * rng.uniform(.2, 1)
        tip = Vector((bx + math.cos(a) * lean * h, by + math.sin(a) * lean * h, h))
        side = Vector((-math.sin(a), math.cos(a), 0)) * width
        foot = Vector((bx, by, 0))
        v0 = bm.verts.new(foot - side); v1 = bm.verts.new(foot + side)
        v2 = bm.verts.new(tip + side * .25); v3 = bm.verts.new(tip - side * .25)
        bm.faces.new((v0, v1, v2, v3))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.update()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o); attach(o, parent, name, mat); return o
for item, count, height, spread in [('MF_Grass_A', 9, .55, .32), ('MF_Grass_B', 12, .75, .42)]:
    r = root(item); blades(r, item + '_blades', grass_mat, count, height, spread, .05, .45); keep.append(r)
for item, count, height in [('MF_Reed_A', 7, 1.6), ('MF_Reed_B', 10, 1.95)]:
    r = root(item); blades(r, item + '_blades', reed_mat, count, height, .28, .035, .12)
    for i in range(count // 2):
        a = i / (count // 2) * math.pi * 2; h = height * rng.uniform(.85, 1.05)
        cyl(r, item + '_head', (math.cos(a) * .18 + math.cos(a) * .12 * h, h - .12, math.sin(a) * .18 + math.sin(a) * .12 * h), .035, .26, reed_head, 6)
    keep.append(r)

rock_a = cliff_materials['coastal_cliff_01']; rock_b = cliff_materials['coastal_cliff_02']

# --- rocks: large chunks cut from the scanned cliffs; medium and shoreline boulders in the same material --------
def chunk(item, src_item, box_min, box_max, mat, scale):
    src = next(c for c in bpy.data.objects[src_item].children if c.type == 'MESH')
    o = src.copy(); o.data = src.data.copy(); scene.collection.objects.link(o); o.matrix_world = src.matrix_world.copy(); o.parent = None
    apply_all(o)   # bake the top anchor so the cut box is in the piece's anchored frame
    bm = bmesh.new(); bm.from_mesh(o.data)
    for axis in range(3):
        for sign, bound in ((1, box_max[axis]), (-1, box_min[axis])):
            normal = Vector([0, 0, 0]); normal[axis] = sign
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector([bound if i == axis else 0 for i in range(3)]), plane_no=normal, clear_outer=True)
    bm.to_mesh(o.data); bm.free(); o.data.update()
    r = root(item); o.parent = r; o.name = item + '_rock'; o.data.materials.clear(); o.data.materials.append(mat)
    o.scale = scale; apply_all(o)
    anchor_children(r); keep.append(r); return r
chunk('MF_Rock_Large_A', 'MF_Cliff_A', (-4.5, -3.2, -4.6), (2.5, 3.2, 0.5), rock_a, (.85, .85, .9))
chunk('MF_Rock_Large_B', 'MF_Cliff_C', (-3.0, -3.0, -3.8), (4.0, 2.4, 0.5), rock_b, (.9, .95, 1.0))
for j, (name, radius, sub, squash, mat) in enumerate([('MF_Boulder_A', 1.0, 2, .8, rock_a), ('MF_Boulder_B', 1.35, 2, .9, rock_b), ('MF_Boulder_C', .7, 1, .75, rock_a),
                                                       ('MF_Rock_Shore_A', 1.5, 2, .38, rock_b), ('MF_Rock_Shore_B', 2.1, 2, .32, rock_a), ('MF_Rock_Shore_C', .9, 1, .45, rock_b)]):
    r = root(name); bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=radius, location=(0, 0, radius * .7)); o = bpy.context.object
    for v in o.data.vertices:
        v.co = v.co * (1 + .18 * math.sin(v.co.x * 3.1 + j) + .14 * math.sin(v.co.y * 4.3 - j) + .12 * math.sin(v.co.z * 5.7))
        v.co.z = max(v.co.z, -radius * .65)
    o.scale = (1.0, rng.uniform(.8, 1.25), squash); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    flat_shade(o); attach(o, r, name + '_rock', mat); uv_box(o, 2.5); anchor_children(r); keep.append(r)

# --- crystals: hexagonal prisms with pointed tips on a rock foot, one emissive material for runtime tinting ------
crystal = material('crystal_glow', (.58, .38, .92), .18, 0.0, 1.4, (.72, .48, 1.0)); crystal.use_backface_culling = True
def prism(parent, name, base, height, radius, tilt, yaw):
    """Six-sided shard: a prism that narrows into a pointed tip."""
    bm = bmesh.new(); angles = [i / 6 * math.pi * 2 for i in range(6)]
    ring0 = [bm.verts.new((math.cos(a) * radius, math.sin(a) * radius, 0)) for a in angles]
    ring1 = [bm.verts.new((math.cos(a) * radius * .6, math.sin(a) * radius * .6, height)) for a in angles]
    tip = bm.verts.new((0, 0, height * 1.3))
    bm.faces.new(ring0[::-1])
    for i in range(6):
        bm.faces.new((ring0[i], ring0[(i + 1) % 6], ring1[(i + 1) % 6], ring1[i]))
        bm.faces.new((ring1[i], ring1[(i + 1) % 6], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.update()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    o.rotation_euler = (tilt, 0, yaw); o.location = base; apply_all(o); flat_shade(o); return attach(o, parent, name, crystal)
for item, count, tall in [('MF_Crystal_A', 5, 1.9), ('MF_Crystal_B', 3, 1.3), ('MF_Crystal_C', 7, 2.4)]:
    r = root(item)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.9, location=(0, 0, .1)); foot = bpy.context.object
    foot.scale = (1.2, 1.0, .45); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True); flat_shade(foot)
    attach(foot, r, item + '_foot', rock_a); uv_box(foot, 2.0)
    for i in range(count):
        a = i / count * math.pi * 2 + rng.uniform(-.4, .4); d = rng.uniform(0.0, .55)
        h = tall * rng.uniform(.45, 1.0); rad = h * rng.uniform(.11, .17)
        prism(r, item + '_shard', (math.cos(a) * d, math.sin(a) * d, .25), h, rad, rng.uniform(.12, .42), a + rng.uniform(-.5, .5))
    anchor_children(r); keep.append(r)

# --- lantern post and vehicles: unchanged from 2A -----------------------------------------------------------------
post_mat = material('scatter_lantern_post', (.16, .17, .19), .5, .6); cap_mat = material('practical_station_marker', (1.0, .78, .45), .3, 0.0, 2.4)
r = root('MF_Lantern')
box(r, 'MF_Lantern_base', (0, .08, 0), (.42, .16, .42), post_mat); cyl(r, 'MF_Lantern_post', (0, 1.35, 0), .07, 2.4, post_mat, 10)
box(r, 'MF_Lantern_head', (0, 2.62, 0), (.34, .28, .34), post_mat); box(r, 'MF_Lantern_cap', (0, 2.66, 0), (.26, .14, .26), cap_mat)
body = material('scatter_vehicle_ivory', (.82, .8, .74), .45, .15); dark = material('scatter_vehicle_graphite', (.13, .14, .15), .6, .4)
ochre = material('scatter_utility_ochre', (.62, .39, .12), .7); glass = material('scatter_vehicle_glass', (.35, .55, .62), .15, .2)
r = root('MF_Vehicle_Rover')
box(r, 'rover_chassis', (0, .72, 0), (3.6, .5, 1.9), dark); box(r, 'rover_deck', (.35, 1.05, 0), (2.4, .16, 1.95), body)
box(r, 'rover_cab', (-1.05, 1.45, 0), (1.3, .95, 1.7), body); box(r, 'rover_glass', (-1.62, 1.55, 0), (.1, .6, 1.3), glass)
box(r, 'rover_cargo', (.6, 1.45, 0), (1.4, .65, 1.2), ochre); box(r, 'rover_roll_bar', (.1, 1.62, 0), (.12, .3, 1.7), dark)
for x in [-1.15, 0, 1.15]:
    for z in [-1.0, 1.0]: cyl(r, 'rover_wheel', (x, .5, z), .5, .4, dark, 14, 'Z')
r = root('MF_Vehicle_Cart')
box(r, 'cart_bed', (0, .62, 0), (2.25, .3, 1.3), dark); box(r, 'cart_cargo', (0, 1.0, 0), (1.35, .45, .85), ochre); box(r, 'cart_handle', (1.35, .9, 0), (.5, .06, .9), dark)
for x in [-.8, .8]:
    for z in [-.45, .45]: cyl(r, 'cart_wheel', (x, .3, z), .3, .18, dark, 12, 'Z')
bpy.context.view_layer.update()

# --- export and measure --------------------------------------------------------------------------------------------
for o in scene.objects:
    if o.type == 'MESH':
        for m in o.data.materials:
            if m and not m.node_tree.nodes.get('Principled BSDF'): raise SystemExit('material without principled: ' + m.name)
items = {}
for o in scene.objects:
    if o.type == 'EMPTY' and o.name.startswith('MF_'):
        pts = [c.matrix_world @ Vector(v) for c in o.children_recursive if c.type == 'MESH' for v in c.bound_box]
        lo = [min(p[i] for p in pts) for i in range(3)]; hi = [max(p[i] for p in pts) for i in range(3)]
        items[o.name] = {'footprintRadius': round(max(hi[0] - lo[0], hi[1] - lo[1]) / 2, 3), 'height': round(hi[2] - lo[2], 3),
                         'size': [round(hi[0] - lo[0], 3), round(hi[2] - lo[2], 3), round(hi[1] - lo[1], 3)],
                         'anchor': 'top' if o.name.startswith('MF_Cliff_') else 'ground',
                         'meshes': sorted(c.name for c in o.children_recursive if c.type == 'MESH'),
                         'triangles': sum(len(c.data.polygons) for c in o.children_recursive if c.type == 'MESH')}
        if o.name == 'MF_Lantern': items[o.name]['lampOffset'] = [0, 2.72, 0]
path = V2 / 'scatter-kit.glb'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(V2 / 'scatter-kit.blend'), compress=True)
bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False)
raw = path.read_bytes(); gltf = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
tris = sum(gltf['accessors'][p['indices']]['count'] // 3 for m in gltf['meshes'] for p in m['primitives'])
assert all('uri' not in im for im in gltf.get('images', [])) and len(gltf.get('images', [])) <= 8, len(gltf.get('images', []))
metadata = {'file': 'scatter-kit.glb', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'triangles': tris, 'images': len(gltf.get('images', [])),
            'items': items, 'budget': {'bytes': BUDGET_BYTES, 'triangles': BUDGET_TRIS},
            'cliffFacing': 'each MF_Cliff_* piece is longest along +X and faces +Z in glTF; anchor at the top centre',
            'origin': 'exterior-bases/astra-kit/environment.blend (retained CC0 twisted trees, Poly Haven coastal_cliff_01 / 02 scans), deterministic Blender geometry otherwise'}
(V2 / 'scatter-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('SCATTER_COMPLETE', json.dumps({'bytes': len(raw), 'triangles': tris, 'images': metadata['images'], 'items': {k: v['triangles'] for k, v in items.items()}}))
assert len(raw) <= BUDGET_BYTES and tris <= BUDGET_TRIS, (len(raw), tris)
