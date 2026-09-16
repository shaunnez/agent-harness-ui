"""Shared authoring helpers for the Mission Frontier hexagonal HQ kit (Blender 5.2.1 headless).

Coordinates: every public helper takes glTF-space values (X right, Y up, +Z toward the court/camera).
`pos()` converts to Blender (x, -z, y); `gl()` converts back. Angles are world XZ angles in degrees
(x = cos, z = sin) exactly as contract.json defines them.
"""
import bpy, bmesh, math, json, re
from pathlib import Path
from mathutils import Vector, Matrix

R = Path(__file__).resolve().parents[1]              # .../colony-hq-v1/producer
STAGING = R.parent                                   # .../colony-hq-v1
CONTRACT_PATH = STAGING / 'contract.json'
C = json.loads(CONTRACT_PATH.read_text())
KIT = STAGING.parent / 'exterior-bases' / 'astra-kit'   # read-only source kit
KIT_COMMAND = KIT / 'base-command.blend'
KIT_RELAY = KIT / 'base-relay.blend'
KIT_FOUNDRY = KIT / 'base-foundry.blend'
KIT_ENV = KIT / 'environment.blend'

FLOOR = C['levels']['hqFloor']
COURT = C['levels']['courtPaving']
GROUND = C['levels']['plateauGround']
CEIL = C['levels']['hqCeilingClear']
PARAPET = C['levels']['hqParapet']
BAY_ROOF = C['levels']['bayRoofTop']
APOTHEM = C['hq']['footprint']['apothem']
CORNER_R = C['hq']['footprint']['cornerRadius']
OUTER_WALL = C['hq']['footprint']['outerWall']
PARTITION = C['hq']['footprint']['partition']
PARTITION_SOLID = C['hq']['footprint']['partitionLowerSolid']
HUB_R = C['hq']['hub']['cornerRadius']
HUB_APOTHEM = C['hq']['hub']['apothem']

LIGHTS = []          # (role, [x, y, z]) practical light positions in glTF space, filled while authoring
_group = None        # current parent group name


def pos(p):
    """glTF (x, y, z) -> Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])


def gl(v):
    """Blender Vector -> glTF tuple."""
    return (v.x, v.z, -v.y)


def rot_x_to(phi_deg):
    """Blender Z rotation that turns the local +X axis toward glTF XZ angle phi."""
    return -math.radians(phi_deg)


def rot_forward_to(phi_deg):
    """Blender Z rotation that turns the glTF +Z (forward) axis toward glTF XZ angle phi."""
    return math.radians(90.0 - phi_deg)


def dirv(phi_deg):
    return (math.cos(math.radians(phi_deg)), math.sin(math.radians(phi_deg)))


def radial(phi_deg, r, y=None):
    d = dirv(phi_deg)
    return (d[0] * r, d[1] * r) if y is None else (d[0] * r, y, d[1] * r)


def hex_points(corner_radius, start_deg=0.0):
    return [(corner_radius * math.cos(math.radians(start_deg + 60 * i)), corner_radius * math.sin(math.radians(start_deg + 60 * i))) for i in range(6)]


def flat_segment(phi_deg, dist):
    """Endpoints (glTF XZ) of the hexagon flat facing phi, at perpendicular distance dist from the centre."""
    d = dirv(phi_deg); t = (-d[1], d[0]); half = dist * math.tan(math.radians(30))
    m = (d[0] * dist, d[1] * dist)
    return (m[0] - t[0] * half, m[1] - t[1] * half), (m[0] + t[0] * half, m[1] + t[1] * half)


def rounded_outline(w, d, r, n=6, phi_deg=0.0, centre=(0.0, 0.0)):
    """Rounded rectangle outline (glTF XZ) with local x along phi (length w) and local z across (depth d)."""
    r = min(r, w / 2 - 1e-3, d / 2 - 1e-3); pts = []
    for sx, sz, start in [(1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)]:
        for j in range(n + 1):
            a = math.radians(start + j * 90 / n)
            pts.append((sx * (w / 2 - r) + r * math.cos(a), sz * (d / 2 - r) + r * math.sin(a)))
    c, s = math.cos(math.radians(phi_deg)), math.sin(math.radians(phi_deg))
    return [(centre[0] + x * c - z * s, centre[1] + x * s + z * c) for x, z in pts]


# ---------------------------------------------------------------- scene / groups

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S = bpy.context.scene
    S.unit_settings.system = 'METRIC'; S.unit_settings.scale_length = 1.0
    return S


def group(name, parent=None):
    o = bpy.data.objects.get(name)
    if o is None:
        o = bpy.data.objects.new(name, None); o.empty_display_size = 0.5; o.empty_display_type = 'PLAIN_AXES'
        bpy.context.scene.collection.objects.link(o)
    if parent:
        o.parent = bpy.data.objects[parent]
    return o


def use(name):
    """Set the current visibility group for subsequently created components."""
    global _group
    _group = name
    return bpy.data.objects[name]


def current_group():
    return _group


def _attach(o, name, mat):
    o.name = name
    if o.data is not None and mat is not None:
        o.data.materials.clear(); o.data.materials.append(mat)
    o.parent = bpy.data.objects[_group]
    return o


# ---------------------------------------------------------------- materials

def material(name, color, metal=.1, rough=.4, emission=0.0, alpha=None):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1); p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Emission Color'].default_value = (*color, 1); p.inputs['Emission Strength'].default_value = emission
    if alpha is not None:
        p.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'surface_render_method'): m.surface_render_method = 'BLENDED'
        if hasattr(m, 'blend_method'): m.blend_method = 'BLEND'
    return m


def base_name(n):
    return re.sub(r'\.\d{3}$', '', n)


def dedupe_datablocks():
    """Merge appended `X.001` materials/images into `X` so every file carries one shared library copy."""
    for coll in (bpy.data.images, bpy.data.materials):
        for d in list(coll):
            b = base_name(d.name)
            if b != d.name and coll.get(b) is not None:
                d.user_remap(coll[b]); coll.remove(d)
    for o in list(bpy.data.objects):
        if o.name not in bpy.context.scene.objects and o.type == 'EMPTY':
            bpy.data.objects.remove(o, do_unlink=True)


def append_objects(blend, names, exact=True):
    """Append objects by name from a read-only kit blend; parents are cleared, world matrices kept."""
    names = set(names)
    with bpy.data.libraries.load(str(blend), link=False) as (src, dst):
        dst.objects = [n for n in src.objects if (n in names if exact else base_name(n) in names)]
    out = []
    for o in dst.objects:
        if o is None: continue
        bpy.context.scene.collection.objects.link(o)
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
        out.append(o)
    dedupe_datablocks()
    return out


def append_materials(blend, names):
    missing = [n for n in names if bpy.data.materials.get(n) is None]
    if not missing: return
    with bpy.data.libraries.load(str(blend), link=False) as (src, dst):
        dst.materials = [n for n in src.materials if n in missing]
    dedupe_datablocks()


KIT_MATERIALS = ['structure_ivory_ceramic', 'structure_graphite_joints', 'brushed_titanium', 'console_blue_glass',
                 'court_weathered_basalt', 'utility_ochre', 'practical_warm_strip', 'practical_warm_window_glass',
                 'practical_station_marker', 'practical_console_cyan', 'ambient_screen_service',
                 'ambient_sensor_navigation', 'identity_roof_inset', 'identity_roof_ring', 'identity_trim']


def load_library():
    """Bring the accepted Astra material library in (textures embedded) plus the new contract materials."""
    append_materials(KIT_COMMAND, KIT_MATERIALS)
    M = {n: bpy.data.materials[n] for n in KIT_MATERIALS}
    M['glass_partition'] = material('glass_partition', (0.86, 0.92, 0.95), 0.0, 0.06, 0.0, alpha=0.22)
    M['practical_delivery_beacon'] = material('practical_delivery_beacon', (1.0, 0.56, 0.12), 0.1, 0.25, 3.2)
    for room in ['briefing', 'planning', 'implementation', 'review', 'testing', 'dispatch']:
        M['room_inlay_' + room] = material('room_inlay_' + room, (0.30, 0.335, 0.35), 0.12, 0.62, 0.0)
    return M


# ---------------------------------------------------------------- mesh primitives

def _box_uv(bm, tile=3.0):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            if ax == 0: u, v = c.y, c.z
            elif ax == 1: u, v = c.x, c.z
            else: u, v = c.x, c.y
            l[uv].uv = (u / tile, v / tile)


def _finish(bm, name, mat, centre, rot_deg=0.0, smooth=False, bevel=0.0, segments=1, weighted=True, tile=3.0):
    for f in bm.faces: f.smooth = smooth
    _box_uv(bm, tile)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    o.location = pos(centre); o.rotation_euler = (0, 0, rot_x_to(rot_deg))
    if bevel > 0:
        mod = o.modifiers.new('manufactured edge radius', 'BEVEL'); mod.width = bevel; mod.segments = segments; mod.limit_method = 'ANGLE'
        if weighted: o.modifiers.new('weighted corner normals', 'WEIGHTED_NORMAL')
    return _attach(o, name, mat)


def box(name, centre, size, mat, bevel=0.0, rot=0.0, segments=1):
    """Axis box; size = (length along local x, height, depth along local z) in metres; rot turns local x to angle rot."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(size[0], size[2], size[1]), verts=bm.verts)   # Blender (x, y=-z_gltf, z=y_gltf)
    b = min(bevel, min(size) * 0.45) if bevel else 0.0
    return _finish(bm, name, mat, centre, rot, False, b, segments)


def cyl(name, centre, r, h, mat, n=32, bevel=0.0, segments=1):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=n, radius1=r, radius2=r, depth=h)
    for f in bm.faces: f.smooth = abs(f.normal.z) < 0.5
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            c = l.vert.co
            l[uv].uv = ((math.atan2(c.y, c.x) / math.tau) * (math.tau * r) / 3.0, c.z / 3.0) if abs(f.normal.z) < 0.5 else (c.x / 3.0, c.y / 3.0)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); o.location = pos(centre)
    if bevel > 0:
        mod = o.modifiers.new('machined rim', 'BEVEL'); mod.width = min(bevel, h * 0.4, r * 0.4); mod.segments = segments; mod.limit_method = 'ANGLE'
        o.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    return _attach(o, name, mat)


def prism(name, pts_xz, y0, y1, mat, bevel=0.0, segments=1, smooth_sides=False):
    """Vertical extrusion of a simple polygon given in glTF XZ (any winding), from y0 to y1."""
    area = sum(pts_xz[i][0] * pts_xz[(i + 1) % len(pts_xz)][1] - pts_xz[(i + 1) % len(pts_xz)][0] * pts_xz[i][1] for i in range(len(pts_xz)))
    if area > 0: pts_xz = list(reversed(pts_xz))   # make the outline clockwise in XZ so Blender faces point outward
    bm = bmesh.new(); n = len(pts_xz)
    lo = [bm.verts.new((x, -z, y0)) for x, z in pts_xz]; hi = [bm.verts.new((x, -z, y1)) for x, z in pts_xz]
    bm.faces.new(lo); bm.faces.new(hi)
    for i in range(n): bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.smooth = smooth_sides and abs(f.normal.z) < 0.5
    _box_uv(bm)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    if bevel > 0:
        mod = o.modifiers.new('edge radius', 'BEVEL'); mod.width = bevel; mod.segments = segments; mod.limit_method = 'ANGLE'
        o.modifiers.new('weighted normals', 'WEIGHTED_NORMAL')
    return _attach(o, name, mat)


def ring(name, centre, r, width, mat, major=64, minor=8):
    bm = bmesh.new()
    for i in range(major):
        a = math.tau * i / major
        for j in range(minor):
            b = math.tau * j / minor
            bm.verts.new(((r + width * math.cos(b)) * math.cos(a), (r + width * math.cos(b)) * math.sin(a), width * math.sin(b)))
    bm.verts.ensure_lookup_table()
    for i in range(major):
        for j in range(minor):
            a, b = i * minor + j, i * minor + (j + 1) % minor
            c, d = ((i + 1) % major) * minor + (j + 1) % minor, ((i + 1) % major) * minor + j
            bm.faces.new((bm.verts[a], bm.verts[b], bm.verts[c], bm.verts[d]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.smooth = True
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); o.location = pos(centre)
    return _attach(o, name, mat)


def wall(name, a, b, y0, y1, t, mat, doors=(), bevel=0.04):
    """Straight wall between glTF XZ points a and b (centreline), thickness t, with door openings.

    doors: iterable of (cx, cz, width, clearHeight). Returns the created pieces (solid runs and lintels)."""
    ax, az = a; bx, bz = b; L = math.hypot(bx - ax, bz - az); ux, uz = (bx - ax) / L, (bz - az) / L
    ang = math.degrees(math.atan2(uz, ux)); cuts = []
    for cx, cz, w, h in doors:
        u = (cx - ax) * ux + (cz - az) * uz; cuts.append((u - w / 2, u + w / 2, h))
    cuts.sort(); u = 0.0; out = []
    def seg(u0, u1, yy0, yy1, suffix):
        m = (u0 + u1) / 2
        return box(name + suffix, (ax + ux * m, (yy0 + yy1) / 2, az + uz * m), (u1 - u0, yy1 - yy0, t), mat, bevel, ang)
    for c0, c1, h in cuts:
        if c0 - u > 0.01: out.append(seg(u, c0, y0, y1, ''))
        if y1 - (y0 + h) > 0.01: out.append(seg(c0, c1, y0 + h, y1, '_lintel'))
        u = c1
    if L - u > 0.01: out.append(seg(u, L, y0, y1, ''))
    return out


def glazed_upper(name, a, b, y0, y1, mat_glass, mat_frame, pitch=2.2, t=0.05):
    """Glazed partition upper: one pane plus titanium rails and mullions (all hide with the cutaway)."""
    ax, az = a; bx, bz = b; L = math.hypot(bx - ax, bz - az); ux, uz = (bx - ax) / L, (bz - az) / L
    ang = math.degrees(math.atan2(uz, ux)); mid = ((ax + bx) / 2, az + (bz - az) / 2)
    box(name + '_pane', (mid[0], (y0 + y1) / 2, mid[1]), (L, y1 - y0, t), mat_glass, 0.0, ang)
    box(name + '_sill_rail', (mid[0], y0 + 0.04, mid[1]), (L, 0.08, 0.14), mat_frame, 0.01, ang)
    box(name + '_head_rail', (mid[0], y1 - 0.06, mid[1]), (L, 0.12, 0.16), mat_frame, 0.01, ang)
    n = max(1, round(L / pitch))
    for i in range(n + 1):
        u = L * i / n
        box(name + '_mullion', (ax + ux * u, (y0 + y1) / 2, az + uz * u), (0.08, y1 - y0, 0.12), mat_frame, 0.0, ang)


def socket(name, p, facing_deg):
    o = bpy.data.objects.new(name, None); o.empty_display_type = 'ARROWS'; o.empty_display_size = 0.6
    bpy.context.scene.collection.objects.link(o); o.location = pos(p); o.rotation_euler = (0, 0, rot_forward_to(facing_deg))
    o.parent = bpy.data.objects['MF_Sockets']; o['facingDeg'] = float(facing_deg)
    return o


def light(role, p):
    LIGHTS.append({'role': role, 'position': [round(float(v), 3) for v in p]})


# ---------------------------------------------------------------- kit component templates

class Template:
    """A captured set of kit objects with a ground anchor, duplicated by place()."""

    def __init__(self, objects, anchor_blender):
        self.objects = objects; self.anchor = Vector(anchor_blender)
        for o in objects: o.hide_render = True; o.hide_viewport = True

    def place(self, name, p, facing_deg=0.0, scale=1.0, scale_xyz=None, group_name=None):
        M = Matrix.Translation(Vector(pos(p))) @ Matrix.Rotation(rot_x_to(facing_deg), 4, 'Z')
        if scale_xyz: M = M @ Matrix.Diagonal((scale_xyz[0], scale_xyz[2], scale_xyz[1], 1.0))
        else: M = M @ Matrix.Scale(scale, 4)
        M = M @ Matrix.Translation(-self.anchor); out = []
        for src in self.objects:
            o = src.copy(); o.data = src.data; o.hide_render = False; o.hide_viewport = False
            bpy.context.scene.collection.objects.link(o); o.matrix_world = M @ src.matrix_world
            o.name = name + '_' + base_name(src.name); o.parent = bpy.data.objects[group_name or _group]; out.append(o)
        return out

    def dispose(self):
        for o in self.objects: bpy.data.objects.remove(o, do_unlink=True)


def bbox_world(objects):
    pts = [o.matrix_world @ Vector(v) for o in objects for v in o.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


def capture(blend, basenames, near_blender=None, radius=None, anchor='ground_centre'):
    """Append kit components by base name, optionally only those within radius of a Blender point."""
    objs = append_objects(blend, basenames, exact=False)
    if near_blender is not None:
        keep = []
        for o in objs:
            lo, hi = bbox_world([o]); c = (lo + hi) / 2
            if (Vector((c.x, c.y)) - Vector(near_blender[:2])).length <= radius: keep.append(o)
            else: bpy.data.objects.remove(o, do_unlink=True)
        objs = keep
    lo, hi = bbox_world(objs)
    if anchor == 'ground_centre': a = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)
    elif anchor == 'centre': a = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2)
    else: a = anchor
    return Template(objs, a)


# ---------------------------------------------------------------- cameras and renders

def camera(name, target, offset, vertical_span, aspect=1.4):
    cam = bpy.data.cameras.new(name); cam.type = 'ORTHO'; cam.ortho_scale = vertical_span * max(aspect, 1.0)
    cam.clip_start = 0.5; cam.clip_end = 600
    o = bpy.data.objects.new(name, cam); bpy.context.scene.collection.objects.link(o)
    o.location = pos((target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]))
    o.rotation_euler = (Vector(pos(target)) - o.location).to_track_quat('-Z', 'Y').to_euler()
    return o


def preview_lighting():
    S = bpy.context.scene
    if bpy.data.objects.get('preview_sun') is None:
        sun = bpy.data.lights.new('preview_sun', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(4); sun.color = (1.0, 0.96, 0.9)
        o = bpy.data.objects.new('preview_sun', sun); S.collection.objects.link(o); o.location = (0, 0, 60)
        o.rotation_euler = (math.radians(38), math.radians(-18), math.radians(-35))
        fill = bpy.data.lights.new('preview_fill', 'AREA'); fill.energy = 9000; fill.size = 60; fill.color = (0.75, 0.85, 1.0)
        f = bpy.data.objects.new('preview_fill', fill); S.collection.objects.link(f); f.location = (-40, -30, 70)
        f.rotation_euler = (Vector((0, 0, 6)) - f.location).to_track_quat('-Z', 'Y').to_euler()
    if S.world is None: S.world = bpy.data.worlds.new('preview_world')
    S.world.use_nodes = True; bg = S.world.node_tree.nodes.get('Background')
    if bg: bg.inputs[0].default_value = (0.42, 0.5, 0.58, 1); bg.inputs[1].default_value = 0.7


def render(path, cam, transparent=True, samples=48, res=(1400, 1000), hide_groups=()):
    S = bpy.context.scene; S.camera = cam; S.render.engine = 'CYCLES'; S.cycles.samples = samples; S.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices: d.use = True
        S.cycles.device = 'GPU'
    except Exception as e:   # CPU fallback keeps the build reproducible on machines without Metal
        print('cycles GPU unavailable, CPU render:', e); S.cycles.device = 'CPU'
    S.render.resolution_x, S.render.resolution_y = res; S.render.resolution_percentage = 100
    S.render.film_transparent = transparent; S.render.image_settings.file_format = 'PNG'; S.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    hidden = []
    for gname in hide_groups:
        g = bpy.data.objects.get(gname)
        if g is None: continue
        for o in g.children_recursive:
            if not o.hide_render: o.hide_render = True; hidden.append(o)
    S.render.filepath = str(path); bpy.ops.render.render(write_still=True)
    for o in hidden: o.hide_render = False
