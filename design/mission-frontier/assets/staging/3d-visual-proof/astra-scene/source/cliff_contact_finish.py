# Close the topsoil seam against the continuous geological core; retain an actual connected coast.
from mathutils.kdtree import KDTree
terr=bpy.data.objects['continuous_gravel_terrace'];wall=bpy.data.objects['fractured_continuous_cliff'];kd=KDTree(len(terr.data.vertices))
for i,v in enumerate(terr.data.vertices):kd.insert((v.co.x,v.co.y,0),i)
kd.balance()
for v in wall.data.vertices:
 if v.co.z>3:
  _,idx,dist=kd.find((v.co.x,v.co.y,0));v.co.z=terr.data.vertices[idx].co.z
# Vertical rock uses facade-projected metre UVs; planar terrain UVs stretch on cliff walls.
uv=wall.data.uv_layers.active
for poly in wall.data.polygons:
 for li in poly.loop_indices:
  co=wall.data.vertices[wall.data.loops[li].vertex_index].co
  uv.data[li].uv=((co.y if abs(poly.normal.x)>abs(poly.normal.y) else co.x)*.24,co.z*.24)
# Actual geometric relief on the backing using the retained CC0 rock height map.
sub=wall.modifiers.new('rock_face_subdivision','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=3;sub.render_levels=3
im=bpy.data.images.load(str(next((R/'sources/polyhaven/seaside_rock').glob('Displacement.*'))),check_existing=True);im.colorspace_settings.name='Non-Color';im.pack();tex=bpy.data.textures.new('rock_heightmap_relief',type='IMAGE');tex.image=im
dis=wall.modifiers.new('eroded_rock_relief','DISPLACE');dis.texture=tex;dis.texture_coords='UV';dis.uv_layer='UVMap';dis.strength=1.2;dis.mid_level=.5
# Small scan overlap gaps sit over real textured backing, never over an empty shell.
