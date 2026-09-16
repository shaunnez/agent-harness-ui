import bpy, sys, math
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:]; out=args[0]
scene=bpy.context.scene
scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO'; scene.display.shading.color_type='TEXTURE'
scene.display.shading.show_shadows=True; scene.display.shading.show_cavity=False
scene.render.resolution_x=1400; scene.render.resolution_y=900; scene.render.resolution_percentage=100
cam_data=bpy.data.cameras.new('diag'); cam_data.type='ORTHO'; cam_data.ortho_scale=95; cam_data.clip_end=1000
cam=bpy.data.objects.new('diag_cam',cam_data); scene.collection.objects.link(cam); scene.camera=cam
d=Vector((-51,68,-46)).normalized(); target=Vector((0,-2,3))
cam.location=target-d*250
cam.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
world=scene.world or bpy.data.worlds.new('w'); scene.world=world; world.color=(0.09,0.24,0.29)
for culling,name in ((False,'double-sided-as-app.png'),(True,'front-side-only.png')):
    scene.display.shading.show_backface_culling=culling
    scene.render.filepath=out+'/'+name; bpy.ops.render.render(write_still=True); print('wrote',name)
# close-up of the front-left rim, both modes
cam_data.ortho_scale=34; target=Vector((-18,-12,3)); cam.location=target-d*250
for culling,name in ((False,'rim-front-left-double-sided.png'),(True,'rim-front-left-front-only.png')):
    scene.display.shading.show_backface_culling=culling
    scene.render.filepath=out+'/'+name; bpy.ops.render.render(write_still=True); print('wrote',name)
