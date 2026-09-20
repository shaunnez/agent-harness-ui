"""Rebuild the two high-genus scans before the props-kit bake.

Blender -b -t 4 --python prepare_complex_props.py -- <meshy_root> <prepared_dir>
Voxel size is in the original normalized scan units (about a two-unit box).
Keeps the originals untouched; writes rebaked GLBs and hash-bound receipts.
"""
import bpy, math, sys, json, hashlib, struct
from pathlib import Path
args = sys.argv[sys.argv.index('--') + 1:]
ROOT, OUT = map(Path, args)
OUT.mkdir(parents=True, exist_ok=True)
receipts = {}
for name,target in [('MF_Prop_FabCell',6000),('MF_Prop_ServiceCart',5000)]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/name/f'{name}.glb'))
    high=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    high.name='Source'
    world=high.matrix_world.copy(); high.parent=None; high.matrix_world=world
    bpy.ops.object.select_all(action='DESELECT'); high.select_set(True)
    bpy.context.view_layer.objects.active=high
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    low=high.copy(); low.data=high.data.copy(); bpy.context.collection.objects.link(low)
    low.name=name
    bpy.ops.object.select_all(action='DESELECT'); low.select_set(True); bpy.context.view_layer.objects.active=low
    mod=low.modifiers.new('Clean scan topology','REMESH'); mod.mode='VOXEL'; mod.voxel_size=0.004
    mod.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    low.data.calc_loop_triangles(); cur=len(low.data.loop_triangles)
    print('REMESH',name,cur,flush=True)
    for i in range(6):
        mod=low.modifiers.new('Runtime budget','DECIMATE'); mod.ratio=min(1,target/cur); mod.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        low.data.calc_loop_triangles(); got=len(low.data.loop_triangles)
        print('DECIMATE',name,got,flush=True)
        if got<=target: break
        if got>=cur: raise RuntimeError('Clean mesh stalled')
        cur=got
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=0.015)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Preserve the source shader for selected-to-active baking; destination receives a new atlas.
    low.data.materials.clear()
    mat=bpy.data.materials.new(name); mat.use_nodes=True; low.data.materials.append(mat)
    nodes=mat.node_tree.nodes; bsdf=nodes.get('Principled BSDF')
    scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=1
    scene.render.bake.use_selected_to_active=True; scene.render.bake.cage_extrusion=0.025
    scene.render.bake.max_ray_distance=0.06; scene.render.bake.margin=8
    scene.render.bake.use_pass_direct=False; scene.render.bake.use_pass_indirect=False
    scene.render.bake.use_pass_color=True
    high.select_set(True); low.select_set(True); bpy.context.view_layer.objects.active=low
    source_mat=high.data.materials[0]; sn=source_mat.node_tree.nodes
    source_bsdf=next(n for n in sn if n.type=='BSDF_PRINCIPLED')
    source_out=next(n for n in sn if n.type=='OUTPUT_MATERIAL')
    maps={}
    for label,bake_type in [('BaseColor','DIFFUSE'),('Normal','NORMAL'),('Roughness','ROUGHNESS'),('Metallic','EMIT'),('Emission','EMIT')]:
        im=bpy.data.images.new(name+'_'+label,width=1024,height=1024)
        if label not in ('BaseColor','Emission'): im.colorspace_settings.name='Non-Color'
        node=nodes.new('ShaderNodeTexImage'); node.image=im; nodes.active=node
        if bake_type=='EMIT':
            emission=sn.new('ShaderNodeEmission')
            socket=source_bsdf.inputs['Metallic' if label=='Metallic' else 'Emission Color']
            if socket.is_linked: source_mat.node_tree.links.new(socket.links[0].from_socket,emission.inputs['Color'])
            else:
                value=socket.default_value
                emission.inputs['Color'].default_value=(value,value,value,1) if label=='Metallic' else value
            source_mat.node_tree.links.new(emission.outputs[0],source_out.inputs['Surface'])
        print('BAKE',name,label,flush=True)
        bpy.ops.object.bake(type=bake_type)
        if bake_type=='EMIT':
            sn.remove(emission); source_mat.node_tree.links.new(source_bsdf.outputs[0],source_out.inputs['Surface'])
        im.pack(); maps[label]=node
    for label,socket in [('BaseColor','Base Color'),('Roughness','Roughness'),('Metallic','Metallic'),('Emission','Emission Color')]:
        mat.node_tree.links.new(maps[label].outputs['Color'],bsdf.inputs[socket])
    bsdf.inputs['Emission Strength'].default_value=1
    normal=nodes.new('ShaderNodeNormalMap')
    mat.node_tree.links.new(maps['Normal'].outputs['Color'],normal.inputs['Color'])
    mat.node_tree.links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])
    high.select_set(False)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),export_format='GLB',use_selection=True,export_cameras=False,export_lights=False)
    raw = (OUT/f'{name}.glb').read_bytes()
    gltf = json.loads(raw[20:20+struct.unpack_from('<I', raw, 12)[0]])
    exported_triangles = sum(gltf['accessors'][p['indices']]['count']//3
                             for mesh in gltf['meshes'] for p in mesh['primitives'])
    if exported_triangles > target:
        raise RuntimeError(f'{name}: exported mesh exceeds {target} triangles')
    receipts[name] = {
        'sourceSha256': hashlib.sha256((ROOT/name/f'{name}.glb').read_bytes()).hexdigest(),
        'sha256': hashlib.sha256((OUT/f'{name}.glb').read_bytes()).hexdigest(),
        'triangles': exported_triangles, 'targetTriangles': target, 'voxelSize': 0.004,
        'texturePx': 1024, 'cageExtrusion': 0.025, 'maxRayDistance': 0.06,
        'blenderVersion': bpy.app.version_string,
    }
(OUT/'preparation.json').write_text(json.dumps(receipts, indent=2)+'\n')
