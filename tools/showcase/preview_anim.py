"""Fast Workbench preview of the APC drive.

Same rig, same 250 frames, but flat shading instead of Cycles -- seconds per
frame rather than ten. The point is to check the motion (steering, wheel spin,
turret sweep) long before the lit version finishes, so a bad path costs a minute
instead of forty.

Runs as its own headless process, so it does not disturb the GUI session or the
Cycles render already in flight.
"""
import bpy

sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.render.resolution_x, sc.render.resolution_y = 960, 540
sc.render.resolution_percentage = 100
sc.frame_start, sc.frame_end = 1, 250
sc.render.fps = 30

im = sc.render.image_settings
im.media_type = "VIDEO"
im.file_format = "FFMPEG"
sc.render.ffmpeg.format = "MPEG4"
sc.render.ffmpeg.codec = "H264"
sc.render.ffmpeg.constant_rate_factor = "MEDIUM"
sc.render.filepath = "/Users/ilpinto/dev/roaring-lions/art/showcase/apc_drive_preview.mp4"

# Workbench needs its own look; studio lighting plus cavity reads geometry well.
shading = sc.display.shading
shading.light = "STUDIO"
shading.color_type = "MATERIAL"
shading.show_cavity = True

print(f"preview: {sc.render.filepath} {sc.frame_start}-{sc.frame_end} "
      f"{sc.render.resolution_x}x{sc.render.resolution_y}")
bpy.ops.render.render(animation=True)
print("preview done")
