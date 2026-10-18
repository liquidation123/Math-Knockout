"""Build the editable summit and browser GLB: blender -b --python tools/build_mountain.py"""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

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
rock = material("Textured limestone", (1, 1, 1))
rock_texture = rock.node_tree.nodes.new("ShaderNodeTexImage")
rock_texture.image = bpy.data.images.load(str(OUT / "limestone.jpg"))
rock.node_tree.links.new(rock_texture.outputs["Color"],
                         rock.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
stone = [material(f"Ruined stone {i}", c) for i, c in enumerate([
    (.78, .70, .54), (.88, .80, .64), (.68, .67, .58),
])]
leaf = [material(f"Foliage {i}", c) for i, c in enumerate([
    (.16, .39, .08), (.24, .52, .09), (.40, .66, .11), (.20, .47, .14),
])]
dirt = material("Sunlit worn grass", (.78, .72, .47))
sky_cloud = material("Distant painted atmosphere", (1, 1, 1))
cloud_image = sky_cloud.node_tree.nodes.new("ShaderNodeTexImage")
cloud_image.image = bpy.data.images.load(str(OUT / "cloud-bank.png"))
surface = sky_cloud.node_tree.nodes.get("Principled BSDF")
sky_cloud.node_tree.links.new(cloud_image.outputs["Color"], surface.inputs["Base Color"])
sky_cloud.node_tree.links.new(cloud_image.outputs["Alpha"], surface.inputs["Alpha"])
sky_cloud.surface_render_method = 'DITHERED'

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

# Sculpted ledges and buttresses break up the old cone silhouette.
profile = [(1, 0), (1.015, -.6), (1.03, -1.2), (1.045, -2),
           (1.06, -3.3), (1.08, -4.7), (1.10, -6.1), (1.13, -7.6),
           (1.16, -9.3), (1.19, -11), (1.22, -12.8), (1.26, -14.6),
           (1.31, -16.3), (1.37, -18), (1.42, -20), (1.47, -22),
           (1.49, -25), (1.45, -28), (1.36, -31), (1.22, -34),
           (1.0, -37)]
verts, faces, choices = [], [], []
for level, (scale, height) in enumerate(profile):
    for i in range(N):
        # Coherent ridges continue down the cliff instead of changing randomly per face.
        ridge = math.sin(i * .18) * .12 + math.sin(i * .49 + .7) * .05
        buttress = max(0, math.sin(i * .29 + .6)) ** 8 * .24
        ledge = .065 if level in (3, 7, 11) else 0
        chip = math.sin(i * 1.51 + level * 1.3) * .025
        flare = 0 if level == 0 else (ridge + buttress + ledge + chip) * level / len(profile)
        verts.append(point(i / N, scale + flare,
                           height + (0 if level == 0 else math.sin(i*.33+level)*.20)))
for level in range(len(profile)-1):
    for i in range(N):
        j = (i + 1) % N
        a, b, c, d = level*N+i, level*N+j, (level+1)*N+i, (level+1)*N+j
        faces.extend([(a, c, b), (b, c, d)])
        choices.extend([0, 0])
cliff = mesh("Sculpted limestone cliff", verts, faces, [rock], choices)
uv = cliff.data.uv_layers.new()
for face in cliff.data.polygons:
    seam = any(cliff.data.loops[loop].vertex_index % N == N-1 for loop in face.loop_indices)
    for loop in face.loop_indices:
        index = cliff.data.loops[loop].vertex_index
        level, side = divmod(index, N)
        uv.data[loop].uv = ((N if seam and side == 0 else side) / N * 4,
                            level / (len(profile)-1) * 2)
for polygon in cliff.data.polygons: polygon.use_smooth = True

# Small stone slabs and taller broken ruins follow the outer rim, leaving combat clear.
verts, faces, choices = [], [], []
def block(center, size, mat, angle=0):
    x, y, z = center
    sx, sy, sz = (v / 2 for v in size)
    start = len(verts)
    verts.extend([(x+(dx*sx)*math.cos(angle)-(dy*sy)*math.sin(angle),
                   y+(dx*sx)*math.sin(angle)+(dy*sy)*math.cos(angle), z+dz*sz)
                  for dz in (-1, 1) for dy in (-1, 1) for dx in (-1, 1)])
    faces.extend([tuple(start+k for k in face) for face in
                  [(0,1,3,2), (4,6,7,5), (0,4,5,1),
                   (2,3,7,6), (0,2,6,4), (1,5,7,3)]])
    choices.extend([mat] * 6)

for i in range(76):
    t = (i + .5) / 76
    x, y, _ = point(t, 1.012)
    block((x, y, .13), (random.uniform(.7, 1.2), random.uniform(.45, .8),
                        random.uniform(.24, .4)), i % len(stone),
          math.atan2(y/8, x/14) + math.pi/2)
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
ruins = mesh("Broken stone ring and ruins", verts, faces, stone, choices)
bevel = ruins.modifiers.new("Soft weathered edges", 'BEVEL')
bevel.width = .045
bevel.segments = 2
ruins.modifiers.new("Corner normals", 'WEIGHTED_NORMAL')

# The painted meadow is a color base; thousands of bent 3D blades make its depth real.
verts, faces, choices = [], [], []
for i in range(5200):
    x, y = random.uniform(-13.7, 13.7), random.uniform(-7.7, 7.7)
    edge = abs(x/14)**POWER + abs(y/8)**POWER
    if edge > .94:
        continue
    # Three crossed leaves per tuft, with a bent tip and two triangles per leaf.
    height = random.uniform(.05, .16) if edge < .65 else random.uniform(.12, .29)
    for leaf_index in range(3):
        angle = random.random() * math.tau
        dx, dy = math.cos(angle), math.sin(angle)
        width = random.uniform(.018, .042)
        bend = height * random.uniform(.24, .48)
        base = len(verts)
        verts.extend([(x-dy*width, y+dx*width, .025),
                      (x+dy*width, y-dx*width, .025),
                      (x+dx*bend-dy*width*.55, y+dy*bend+dx*width*.55, height*.7),
                      (x+dx*bend+dy*width*.55, y+dy*bend-dx*width*.55, height*.7),
                      (x+dx*bend*1.5, y+dy*bend*1.5, height)])
        faces.extend([(base, base+1, base+2), (base+1, base+3, base+2),
                      (base+2, base+3, base+4)])
        choices.extend([random.randrange(len(grass))] * 3)
mesh("Bent meadow grass", verts, faces, grass, choices)

# Tiny flowers and raised stone chips add scale without changing the flat physics floor.
petal = [material("Flower ivory", (.98, .93, .68)),
         material("Flower blue", (.43, .68, .84)),
         material("Flower gold", (.96, .72, .23))]
verts, faces, choices = [], [], []
for i in range(170):
    x, y = random.uniform(-13, 13), random.uniform(-7, 7)
    if abs(x/14)**POWER + abs(y/8)**POWER > .88: continue
    radius = random.uniform(.035, .09)
    start = len(verts)
    verts.append((x, y, .11))
    for side in range(6):
        angle = side * math.tau / 6
        verts.append((x + math.cos(angle)*radius, y + math.sin(angle)*radius, .07))
    for side in range(6):
        faces.append((start, start+1+side, start+1+(side+1)%6))
        choices.append(i % len(petal))
mesh("Meadow flowers", verts, faces, petal, choices)

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
        for side in range(12):
            a = side * math.tau / 12
            wobble = 1 + .1 * math.sin(side * 2.7 + i)
            verts.append((x + math.cos(a) * size * radius * wobble,
                          y + math.sin(a) * size * radius * wobble,
                          z + height * size))
    verts.append((x, y, z + size))
    for ring in range(2):
        for side in range(12):
            next_side = (side + 1) % 12
            faces.extend([(start + ring*12+side, start + ring*12+next_side,
                           start + (ring+1)*12+side),
                          (start + ring*12+next_side, start + (ring+1)*12+next_side,
                           start + (ring+1)*12+side)])
            choices.extend([(i + side // 3) % len(leaf)] * 2)
    for side in range(12):
        faces.append((start+24+side, start+24+(side+1)%12, start+36))
        choices.append((i+side//3) % len(leaf))
mesh("Foliage on cliff", verts, faces, leaf, choices)

# Layer the painterly sky clouds lower beside the cliff; the old grey puffs obscured them.
verts, faces = [], []
for x, y, bottom, width, height in [(-34, 37, -12, 50, 24),
                                     (34, 37, -12, 50, 24),
                                     (-32, 24, -29, 38, 18),
                                     (32, 24, -29, 38, 18),
                                     (0, -30, -32, 76, 20)]:
    start = len(verts)
    verts.extend([(x-width/2,y,bottom), (x+width/2,y,bottom),
                  (x+width/2,y,bottom+height), (x-width/2,y,bottom+height)])
    faces.append((start, start+1, start+2, start+3))
atmosphere = mesh("Distant painted atmosphere", verts, faces, [sky_cloud], [0]*len(faces))
uv = atmosphere.data.uv_layers.new()
for poly in atmosphere.data.polygons:
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
world.node_tree.nodes["Background"].inputs["Color"].default_value = (.38,.69,.94,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.1
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
                          export_image_quality=70, export_meshopt_compression_enable=True)
bpy.ops.render.render(write_still=True)
print("Mountain exported:", OUT / "mountain.glb")
