"""Merge static components by visibility group and material, export a portable GLB, and measure it.

The editable .blend keeps every component separate; merging happens only in memory after the blend is saved,
exactly as the Astra kit does. Sockets and group empties survive as glTF nodes; lights never export.
"""
import bpy, json, hashlib, struct
from pathlib import Path
from mathutils import Vector
from hq_lib import gl, base_name


def material_has_images(m):
    return m is not None and m.use_nodes and any(n.type == 'TEX_IMAGE' and n.image for n in m.node_tree.nodes)


def merge_static_geometry():
    """Collapse every mesh under an MF_* parent into one mesh per (parent, material). Returns the inventory."""
    inventory = {}; buckets = {}; dg = bpy.context.evaluated_depsgraph_get()
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH' or not o.parent or not o.parent.name.startswith('MF_'): continue
        mat = o.data.materials[0] if o.data.materials else None
        buckets.setdefault((o.parent.name, mat.name if mat else 'none'), []).append(o)
        inventory.setdefault(o.parent.name, []).append(base_name(o.name))
    for (gn, mn), objects in sorted(buckets.items()):
        verts = []; faces = []; uvs = []; smooth = []; normals = []
        want_uv = material_has_images(bpy.data.materials.get(mn))
        for o in objects:
            ev = o.evaluated_get(dg); me = ev.to_mesh(); base = len(verts); mw = o.matrix_world; nm = mw.to_3x3().inverted_safe().transposed()
            verts.extend([tuple(mw @ v.co) for v in me.vertices]); uv = me.uv_layers.active
            cn = me.corner_normals
            for p in me.polygons:
                faces.append(tuple(base + i for i in p.vertices)); smooth.append(p.use_smooth)
                for li in p.loop_indices:
                    n = (nm @ cn[li].vector).normalized(); normals.append((n.x, n.y, n.z))
                    if want_uv: uvs.append(tuple(uv.data[li].uv) if uv else (0.0, 0.0))
            ev.to_mesh_clear()
        me = bpy.data.meshes.new(gn + '__' + mn); me.from_pydata(verts, [], faces); me.update()
        if want_uv:
            layer = me.uv_layers.new(name='UVMap'); layer.data.foreach_set('uv', [c for pair in uvs for c in pair])
        for p, s in zip(me.polygons, smooth): p.use_smooth = s
        try:
            me.normals_split_custom_set(normals)
        except Exception as e:
            print('custom normals skipped for', me.name, e)
        ob = bpy.data.objects.new(gn + '__' + mn, me); bpy.context.scene.collection.objects.link(ob); ob.parent = bpy.data.objects[gn]
        if mn != 'none': me.materials.append(bpy.data.materials[mn])
        for o in objects: bpy.data.objects.remove(o, do_unlink=True)
    return inventory


def bounds_of(objects):
    pts = []
    for o in objects:
        if o.type == 'MESH':
            for v in o.data.vertices: pts.append(gl(o.matrix_world @ v.co))
    if not pts: return None
    lo = [round(min(p[i] for p in pts), 4) for i in range(3)]; hi = [round(max(p[i] for p in pts), 4) for i in range(3)]
    return {'min': lo, 'max': hi, 'size': [round(hi[i] - lo[i], 4) for i in range(3)]}


def read_glb_stats(path):
    b = Path(path).read_bytes(); n = struct.unpack_from('<I', b, 12)[0]; d = json.loads(b[20:20 + n])
    tris = sum(d['accessors'][p['indices']]['count'] // 3 for m in d['meshes'] for p in m['primitives'] if 'indices' in p)
    return {'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest(), 'triangles': tris, 'meshes': len(d['meshes']),
            'materials': len(d.get('materials', [])), 'images': len(d.get('images', [])), 'nodes': len(d['nodes'])}


def export_asset(stem, out_dir, root_groups, extra=None):
    """Merge, export <stem>.glb and return a metadata entry with bounds per group and GLB statistics."""
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    inventory = merge_static_geometry()
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        if o.type != 'LIGHT': o.select_set(True)
    path = out_dir / (stem + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True, export_cameras=True,
                              export_lights=False, export_yup=True, export_animations=False, export_image_format='AUTO')
    groups = {}
    for g in bpy.context.scene.objects:
        if g.type == 'EMPTY' and g.name.startswith('MF_'):
            groups[g.name] = {'parent': g.parent.name if g.parent else None, 'children': sorted(c.name for c in g.children),
                              'bounds': bounds_of(g.children_recursive)}
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    materials = sorted({m.name for o in meshes for m in o.data.materials if m})
    entry = {'file': stem + '.glb', 'editableSource': stem + '.blend', 'rootGroups': root_groups, 'bounds': bounds_of(meshes),
             'groups': groups, 'materials': materials, 'sourceComponents': {k: sorted(set(v)) for k, v in inventory.items()},
             'componentCounts': {k: len(v) for k, v in inventory.items()}, 'glb': read_glb_stats(path)}
    if extra: entry.update(extra)
    return entry
