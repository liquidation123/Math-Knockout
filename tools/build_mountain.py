"""Build the editable summit and browser GLB: blender -b --python tools/build_mountain.py"""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector  # pyright: ignore[reportMissingImports]  # Provided by Blender at runtime.

random.seed(17)
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)
N = 96
POWER = 2.6  # Matches the browser's rounded gameplay boundary.

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*color, 1)
    node.inputs["Roughness"].default_value = 0.95
    return mat

grass = [material(f"Grass {i}", c) for i, c in enumerate([
    (0.35, .66, .13), (.43, .72, .16), (.54, .76, .19),
    (.48, .70, .13), (.63, .78, .22), (.32, .58, .15),
])]
painted = material("Painted meadow", (1, 1, 1))
texture = painted.node_tree.nodes.new("ShaderNodeTexImage")
texture.image = bpy.data.images.load(str(OUT / "grass-painted.jpg"))
painted.node_tree.links.new(texture.outputs["Color"],
                            painted.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
rock = [material(f"Sunlit limestone {i}", c) for i, c in enumerate([
    (.72, .59, .40), (.81, .69, .49), (.91, .79, .59),
    (.95, .85, .66), (.64, .59, .47), (.86, .73, .51),
])]
cliff_paint = material("Painted cliff", (1, 1, 1))
cliff_image = cliff_paint.node_tree.nodes.new("ShaderNodeTexImage")
cliff_image.image = bpy.data.images.load(str(OUT / "limestone.jpg"))
cliff_paint.node_tree.links.new(cliff_image.outputs["Color"],
                                cliff_paint.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
stone = [material(f"Ruined stone {i}", c) for i, c in enumerate([
    (.85, .72, .53), (.96, .84, .65), (.73, .67, .55),
])]
leaf = [material(f"Foliage {i}", c) for i, c in enumerate([
    (.16, .39, .08), (.24, .52, .09), (.40, .66, .11), (.20, .47, .14),
])]
dirt = material("Sunlit worn grass", (.78, .72, .47))
cloud = material("Painted cloud banks", (1, 1, 1))
cloud_image = cloud.node_tree.nodes.new("ShaderNodeTexImage")
cloud_image.image = bpy.data.images.load(str(OUT / "cloud-bank.png"))
cloud.node_tree.links.new(cloud_image.outputs["Color"],
                          cloud.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
cloud.node_tree.links.new(cloud_image.outputs["Alpha"],
                          cloud.node_tree.nodes.get("Principled BSDF").inputs["Alpha"])
cloud.node_tree.links.new(cloud_image.outputs["Color"],
                          cloud.node_tree.nodes.get("Principled BSDF").inputs["Emission Color"])
cloud.node_tree.nodes.get("Principled BSDF").inputs["Emission Strength"].default_value = 1.2
cloud.surface_render_method = 'DITHERED'

def point(t, scale=1, z=0):
    a = 2 * math.pi * t
    c, s = math.cos(a), math.sin(a)
    return (14 * math.copysign(abs(c) ** (2 / POWER), c) * scale,
            8 * math.copysign(abs(s) ** (2 / POWER), s) * scale, z)

def mesh(name, vertices, faces, mats, choices):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.materials.clear()
    for mat in mats:
        data.materials.append(mat)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    for poly, index in zip(data.polygons, choices):
        poly.material_index = index
    return obj

# A flat, rounded playable top. Every point on its rim is the actual fall boundary.
verts = [(0, 0, 0)]
for ring in range(1, 11):
    for i in range(N):
        verts.append(point(i / N, ring / 10))
faces, choices = [], []
for i in range(N):
    faces.append((0, 1 + i, 1 + (i + 1) % N))
    choices.append(0)
for ring in range(1, 10):
    lo, hi = 1 + (ring - 1) * N, 1 + ring * N
    for i in range(N):
        j = (i + 1) % N
        faces.extend([(lo+i, hi+i, lo+j), (lo+j, hi+i, hi+j)])
        choices.extend([0, 0])
top = mesh("Playable grass top", verts, faces, [painted], choices)
uv = top.data.uv_layers.new()
for polygon in top.data.polygons:
    for loop in polygon.loop_indices:
        x, y, _ = top.data.vertices[top.data.loops[loop].vertex_index].co
        uv.data[loop].uv = ((x + 14) / 28, (y + 8) / 16)

# Broad cliff bands, with irregular strata and an expanding base below the clouds.
profile = [(1, 0), (1.015, -.6), (1.03, -1.2), (1.045, -2),
           (1.075, -3.3), (1.11, -4.7), (1.16, -6.1), (1.22, -7.6),
           (1.28, -9.3), (1.35, -11), (1.42, -12.8), (1.50, -14.6),
           (1.58, -16.3), (1.68, -18), (1.78, -19.8), (1.88, -21.5)]
verts, faces, choices = [], [], []
for level, (scale, height) in enumerate(profile):
    for i in range(N):
        # Coherent ridges continue down the cliff instead of changing randomly per face.
        ridge = math.sin(i * .18) * .25 + math.sin(i * .49 + .7) * .12
        chip = math.sin(i * 1.51 + level * 1.3) * .045
        flare = 0 if level == 0 else (ridge + chip) * level / len(profile)
        verts.append(point(i / N, scale + flare,
                           height + (0 if level == 0 else math.sin(i*.33+level)*.20)))
for level in range(len(profile)-1):
    for i in range(N):
        j = (i + 1) % N
        a, b, c, d = level*N+i, level*N+j, (level+1)*N+i, (level+1)*N+j
        faces.extend([(a, c, b), (b, c, d)])
        shade = (i // 5 + level // 3 + (1 if math.sin(i*.22) > .5 else 0)) % len(rock)
        choices.extend([shade, shade])
cliff = mesh("Sculpted limestone cliff", verts, faces, [cliff_paint], [0] * len(faces))
uv = cliff.data.uv_layers.new()
for polygon in cliff.data.polygons:
    for loop in polygon.loop_indices:
        index = cliff.data.loops[loop].vertex_index
        level, around = divmod(index, N)
        # Give the closing face its own UV seam rather than stretching across the texture.
        if polygon.index % (N * 2) >= (N - 1) * 2 and around == 0: around = N
        uv.data[loop].uv = (around / N * 3, level / (len(profile) - 1) * 2)

# Small stone slabs and taller broken ruins follow the outer rim, leaving combat clear.
verts, faces, choices = [], [], []
def block(center, size, mat):
    x, y, z = center
    sx, sy, sz = (v / 2 for v in size)
    start = len(verts)
    verts.extend([(x+dx*sx, y+dy*sy, z+dz*sz) for dz in (-1, 1)
                  for dy in (-1, 1) for dx in (-1, 1)])
    faces.extend([tuple(start+k for k in face) for face in
                  [(0,1,3,2), (4,6,7,5), (0,4,5,1),
                   (2,3,7,6), (0,2,6,4), (1,5,7,3)]])
    choices.extend([mat] * 6)

for i in range(96):
    t = (i + .5) / 96
    x, y, _ = point(t, 1.012)
    block((x, y, .16), (.88, .62, .34), i % len(stone))
# Four readable, weathered towers on the far arc; shorter broken posts at the front.
for t, courses in [(.12, 8), (.20, 4), (.30, 3), (.39, 8),
                   (.58, 3), (.67, 3), (.81, 3), (.91, 3)]:
    x, y, _ = point(t, 1.035)
    for layer in range(courses):
        for side in range(4):
            dx, dy = ((-.46,-.46), (.46,-.46), (-.46,.46), (.46,.46))[side]
            jitter = random.uniform(-.035, .035)
            block((x+dx+jitter, y+dy, .36+layer*.48),
                  (.88, .88, .46), (layer+side) % len(stone))
mesh("Broken stone ring and ruins", verts, faces, stone, choices)

# The painted grass contains worn paths; a few real blades break the flat silhouette.
verts, faces, choices = [], [], []
for i in range(260):
    x, y = random.uniform(-13,13), random.uniform(-7,7)
    if (abs(x/14)**POWER + abs(y/8)**POWER > .88):
        continue
    a = random.random()*math.pi
    h = random.uniform(.05, .15)
    w = .04
    start = len(verts)
    verts.extend([(x-math.cos(a)*w,y-math.sin(a)*w,.018),
                  (x+math.cos(a)*w,y+math.sin(a)*w,.018),
                  (x+math.sin(a)*h*.25,y-math.cos(a)*h*.25,h)])
    faces.append((start,start+1,start+2))
    choices.append(random.randrange(len(grass)))
mesh("Individual grass blades", verts, faces, grass, choices)

# Layered leaf mounds spill from the lip and gather on cliff ledges.
verts, faces, choices = [], [], []
for i in range(300):
    t = random.random()
    level = random.choices(range(1,11), weights=[17,15,12,10,8,6,4,3,2,1])[0]
    scale, z = profile[level]
    x, y, _ = point(t, scale + .015)
    size = random.uniform(.42, .9) * (1.25 if level < 4 else .8)
    start = len(verts)
    # A two-ring canopy reads as rounded foliage, with far fewer faces than a sphere.
    for ring, radius, height in [(0, .9, -.25), (1, 1, .28), (2, .48, .9)]:
        for side in range(8):
            a = side * math.tau / 8
            wobble = 1 + .1 * math.sin(side * 2.7 + i)
            verts.append((x + math.cos(a) * size * radius * wobble,
                          y + math.sin(a) * size * radius * wobble,
                          z + height * size))
    verts.append((x, y, z + size))
    for ring in range(2):
        for side in range(8):
            next_side = (side + 1) % 8
            faces.extend([(start + ring*8+side, start + ring*8+next_side,
                           start + (ring+1)*8+side),
                          (start + ring*8+next_side, start + (ring+1)*8+next_side,
                           start + (ring+1)*8+side)])
            choices.extend([(i + side // 3) % len(leaf)] * 2)
    for side in range(8):
        faces.append((start+16+side, start+16+(side+1)%8, start+24))
        choices.append((i+side//3) % len(leaf))
mesh("Foliage on cliff", verts, faces, leaf, choices)

# Distant transparent cards keep the dramatic painted clouds without heavy meshes.
verts, faces = [], []
for x, y, bottom, width, height in [(-35, 22, -9, 55, 28),
                                     (35, 22, -9, 55, 28),
                                     (0, -17, -29, 76, 22)]:
    start = len(verts)
    verts.extend([(x-width/2,y,bottom), (x+width/2,y,bottom),
                  (x+width/2,y,bottom+height), (x-width/2,y,bottom+height)])
    faces.append((start, start+1, start+2, start+3))
clouds = mesh("Painted cloud banks", verts, faces, [cloud], [0]*len(faces))
uv = clouds.data.uv_layers.new()
for poly in clouds.data.polygons:
    for loop, coords in zip(poly.loop_indices, [(0,0), (1,0), (1,1), (0,1)]):
        uv.data[loop].uv = coords

# Authored reference and reverse cameras make the source scene reviewable.
for name, location in [("Reference view", (0,-44,28)), ("Reverse view", (0,38,24))]:
    cam = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, cam)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    direction = Vector((0,0,-7)) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z','Y').to_euler()
    cam.lens = 34
bpy.context.scene.camera = bpy.data.objects["Reference view"]
world = bpy.data.worlds.new("Bright sky")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (.13,.54,.96,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = .8
bpy.context.scene.world = world
sun = bpy.data.lights.new("Warm afternoon sun", 'SUN')
sun.energy = 2.7
sun_obj = bpy.data.objects.new("Warm afternoon sun", sun)
bpy.context.collection.objects.link(sun_obj)
sun_obj.rotation_euler = (.35,-.45,-.8)
bpy.context.scene.render.engine = 'BLENDER_EEVEE'
bpy.context.scene.view_settings.view_transform = 'Standard'
bpy.context.scene.render.resolution_x = 1120
bpy.context.scene.render.resolution_y = 840
bpy.context.scene.render.resolution_percentage = 100
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.context.scene.render.filepath = str(OUT / "mountain-preview.png")
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.file.pack_all()  # Keep the editable Blender file portable.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "mountain.blend"))
bpy.ops.object.select_all(action="DESELECT")
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH': obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / "mountain.glb"), export_format='GLB',
                          use_selection=True, export_image_format='WEBP',
                          export_image_quality=52, export_meshopt_compression_enable=True)
bpy.ops.render.render(write_still=True)
print("Mountain exported:", OUT / "mountain.glb")
