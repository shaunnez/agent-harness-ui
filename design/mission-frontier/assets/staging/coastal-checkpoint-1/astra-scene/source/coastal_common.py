import bpy,math,random,os
from mathutils import Vector,Matrix
from pathlib import Path
R=Path(__file__).resolve().parents[1]
group='terrain';rng=random.Random(915101)
def source_path(relative):
 """Resolve optional rebuild inputs; standalone layer export needs only the packed blend."""
 explicit=os.environ.get('MF_COASTAL_FREE_SOURCE_ROOT')
 candidates=[Path(explicit)] if explicit else [R.parents[1]/'cinematic-v1/astra',Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/assets/staging/cinematic-v1/astra')]
 for root in candidates:
  candidate=root/relative
  if candidate.exists():return candidate
 raise FileNotFoundError(f'Rebuild source missing: {relative}. Set MF_COASTAL_FREE_SOURCE_ROOT to the retained cinematic-v1/astra source directory. Re-export from blend/coastal-detailed.blend requires no external sources.')

def W(u,v,z=0):return Vector((v/32-u/64,v/32+u/64,z))
def UV(p):return (32*(p[1]-p[0]),16*(p[0]+p[1]))
def tag(o,m):
 o['asset_layer']=group
 if m:o.data.materials.append(m)
 return o
def material(name,color,metal=0,rough=.65,wear=False,emission=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emission:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 if wear:
  coord=n.new('ShaderNodeTexCoord');noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=7;noise.inputs['Detail'].default_value=3;l.new(coord.outputs['Object'],noise.inputs['Vector']);ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.12;ramp.color_ramp.elements[0].color=(*(c*(.87 if 'ceramic' in name else .76) for c in color),1);ramp.color_ramp.elements[1].position=.86;ramp.color_ramp.elements[1].color=(*color,1);l.new(noise.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],p.inputs['Base Color'])
  micro=n.new('ShaderNodeTexNoise');micro.inputs['Scale'].default_value=110;micro.inputs['Detail'].default_value=2;l.new(coord.outputs['Object'],micro.inputs['Vector']);bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.17;bump.inputs['Distance'].default_value=.012;l.new(micro.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
 return m
M={}
def setup_materials():
 M.update(ceramic=material('weathered warm ceramic',(.64,.66,.625),.32,.4,True),pale=material('ceramic cap trim',(.72,.73,.675),.3,.38,True),dark=material('deep structural graphite',(.035,.052,.064),.75,.41,True),steel=material('weathered blue grey steel',(.13,.18,.195),.8,.42,True),alloy=material('exposed titanium edges',(.34,.38,.36),.85,.34,True),black=material('gaskets and deep recess',(.008,.014,.019),.1,.75),bronze=material('aged utility bronze',(.38,.24,.075),.68,.52,True),glass=material('recessed blue glazing',(.013,.084,.14),.5,.24),amber=material('warm practical emitter',(.95,.37,.065),.2,.3,False,4),blue=material('unlabelled screen emitter',(.015,.20,.34),.35,.26,False,1.2),road=material('weathered court steel panels',(.13,.17,.175),.53,.58,True),stone=material('coastal weathered stone',(.29,.31,.265),.02,.88,True),stoneDark=material('dark fractured strata',(.17,.21,.20),.02,.89,True),soil=material('coastal mineral earth',(.32,.30,.235),0,.94,True))
 return M

def meshob(name,verts,faces,m,loc=(0,0,0),bevel=0):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);ob.location=loc;tag(ob,m)
 if bevel:b=ob.modifiers.new('manufactured edge radius','BEVEL');b.width=bevel;b.segments=3;ob.modifiers.new('weighted face normals','WEIGHTED_NORMAL')
 return ob
def box(name,p,size,m,bevel=.022):
 x,y,z=[v/2 for v in size];vs=[(-x,-y,-z),(-x,-y,z),(-x,y,-z),(-x,y,z),(x,-y,-z),(x,-y,z),(x,y,-z),(x,y,z)];fs=[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)];return meshob(name,vs,[tuple(reversed(f)) for f in fs],m,p,bevel)
def hull(name,p,size,m,cut=.15):
 x,y,z=[v/2 for v in size];a=[(-x+cut,-y),(x-cut,-y),(x,-y+cut),(x,y-cut),(x-cut,y),(-x+cut,y),(-x,y-cut),(-x,-y+cut)];vs=[(u,v,w) for w in [-z,z] for u,v in a];fs=[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)];return meshob(name,vs,fs,m,p,.025)
def cylinder(name,a,b,r,m,segments=12):
 a,b=Vector(a),Vector(b);d=b-a;vs=[(r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),z) for z in [-d.length/2,d.length/2] for i in range(segments)];fs=[tuple(range(segments-1,-1,-1)),tuple(range(segments,segments*2))]+[(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)];o=meshob(name,vs,fs,m,(a+b)/2);o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o
def cable(name,pts,r,m):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=2;s=c.splines.new('BEZIER');s.bezier_points.add(len(pts)-1)
 for p,co in zip(s.bezier_points,pts):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);tag(o,m);return o
def remove_layer(name):
 for o in list(bpy.data.objects):
  if o.get('asset_layer')==name:bpy.data.objects.remove(o,do_unlink=True)
def remove_named(prefix):
 for o in list(bpy.data.objects):
  if o.name.startswith(prefix):bpy.data.objects.remove(o,do_unlink=True)
