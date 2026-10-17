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
rock = [material(f"Warm limestone {i}", c) for i, c in enumerate([
    (.67, .62, .48), (.77, .70, .54), (.83, .76, .60),
    (.89, .80, .63), (.73, .70, .57), (.92, .83, .66),
])]
stone = [material(f"Ruined stone {i}", c) for i, c in enumerate([
    (.79, .72, .57), (.91, .82, .65), (.69, .67, .58),
])]
leaf = [material(f"Foliage {i}", c) for i, c in enumerate([
    (.21, .47, .12), (.31, .56, .10), (.46, .65, .13), (.24, .52, .17),
])]
dirt = material("Sunlit worn grass", (.78, .72, .47))
cloud = material("Cloud cream", (.95, .96, .94))

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
profile = [(1, 0), (1.04, -1.0), (1.10, -2.8), (1.22, -5.2),
           (1.35, -8.0), (1.48, -11), (1.65, -15), (1.82, -19)]
verts, faces, choices = [], [], []
for level, (scale, height) in enumerate(profile):
    for i in range(N):
        wave = math.sin(i * .93 + level * 2.7) * .45 + math.sin(i * .21) * .3
        verts.append(point(i / N, scale + (0 if level == 0 else wave * .035),
                           height + (0 if level == 0 else wave * .65)))
for level in range(len(profile)-1):
    for i in range(N):
        j = (i + 1) % N
        a, b, c, d = level*N+i, level*N+j, (level+1)*N+i, (level+1)*N+j
        faces.extend([(a, c, b), (b, c, d)])
        choices.extend([random.randrange(len(rock)), random.randrange(len(rock))])
mesh("Sculpted limestone cliff", verts, faces, rock, choices)

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

for i in range(68):
    t = (i + .5) / 68
    x, y, _ = point(t, 1.025)
    block((x, y, .03), (.62, .42, .17), i % len(stone))
for t, height in [(.12, 5), (.17, 3), (.29, 2), (.38, 5),
                  (.58, 2), (.68, 2), (.81, 2), (.91, 2)]:
    x, y, _ = point(t, 1.04)
    for layer in range(height):
        jitter = random.uniform(-.09, .09)
        block((x+jitter, y-jitter, .25 + layer*.48),
              (.82 + random.random()*.12, .70, .47), random.randrange(len(stone)))
mesh("Broken stone ring and ruins", verts, faces, stone, choices)

# Broad worn patches on the top and thousands of light grass blades add close-up detail.
verts, faces, choices = [], [], []
for cx, cy, radius in [(-6,3,1.2), (2,-3,1.5), (7,2,1), (-1,1,1.1)]:
    start = len(verts)
    verts.append((cx, cy, .012))
    for i in range(11):
        a = 2 * math.pi * i / 11
        r = radius * (0.8 + random.random()*.35)
        verts.append((cx+math.cos(a)*r, cy+math.sin(a)*r*.55, .012))
    for i in range(11):
        faces.append((start, start+1+i, start+1+(i+1)%11))
        choices.append(0)
mesh("Worn sunny grass patches", verts, faces, [dirt], choices)

verts, faces, choices = [], [], []
for i in range(650):
    x, y = random.uniform(-13,13), random.uniform(-7,7)
    if (abs(x/14)**POWER + abs(y/8)**POWER > .88):
        continue
    a = random.random()*math.pi
    h = random.uniform(.08, .20)
    w = .04
    start = len(verts)
    verts.extend([(x-math.cos(a)*w,y-math.sin(a)*w,.018),
                  (x+math.cos(a)*w,y+math.sin(a)*w,.018),
                  (x+math.sin(a)*h*.25,y-math.cos(a)*h*.25,h)])
    faces.append((start,start+1,start+2))
    choices.append(random.randrange(len(grass)))
mesh("Individual grass blades", verts, faces, grass, choices)

# Low-poly shrubs have real volume on the summit lip and across the cliff.
verts, faces, choices = [], [], []
for i in range(320):
    t = random.random()
    level = random.choices([1,2,3,4,5], weights=[6,5,4,2,1])[0]
    scale, z = profile[level]
    x, y, _ = point(t, scale + .03)
    size = random.uniform(.23, .7) * (1.1 if level < 3 else .8)
    start = len(verts)
    verts.extend([(x-size,y,z), (x+size,y,z), (x,y-size,z), (x,y+size,z),
                  (x,y,z+size*.8), (x,y,z-size*.45)])
    for face in [(0,2,4),(2,1,4),(1,3,4),(3,0,4),
                 (2,0,5),(1,2,5),(3,1,5),(0,3,5)]:
        faces.append(tuple(start+k for k in face))
        choices.append(random.randrange(len(leaf)))
mesh("Foliage on cliff", verts, faces, leaf, choices)

# Distant rounded cloud puffs are joined into one cheap browser draw call.
cloud_parts = []
for cx, cy, cz in [(-29,-6,-3), (29,4,-2), (-23,22,-5), (25,20,-5)]:
    for i in range(7):
        x = cx + i*1.55
        y = cy + math.sin(i*2)*.9
        z = cz + math.sin(i*.9)*.65
        r = 2.1 + math.sin(i*1.7)*.35
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=(x,y,z))
        puff = bpy.context.object
        puff.scale = (r, r*.9, r*.7)
        puff.data.materials.append(cloud)
        cloud_parts.append(puff)
bpy.ops.object.select_all(action="DESELECT")
for puff in cloud_parts: puff.select_set(True)
bpy.context.view_layer.objects.active = cloud_parts[0]
bpy.ops.object.join()
bpy.context.object.name = "Cloud banks"

# Authored reference and reverse cameras make the source scene reviewable.
for name, location in [("Reference view", (0,-42,24)), ("Reverse view", (0,38,20))]:
    cam = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, cam)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    direction = Vector((0,0,-4)) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z','Y').to_euler()
    cam.lens = 42
bpy.context.scene.camera = bpy.data.objects["Reference view"]
world = bpy.data.worlds.new("Bright sky")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (.28,.65,1,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = .45
bpy.context.scene.world = world
sun = bpy.data.lights.new("Warm afternoon sun", 'SUN')
sun.energy = 1.6
sun_obj = bpy.data.objects.new("Warm afternoon sun", sun)
bpy.context.collection.objects.link(sun_obj)
sun_obj.rotation_euler = (.35,-.45,-.45)
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
                          use_selection=True)
bpy.ops.render.render(write_still=True)
print("Mountain exported:", OUT / "mountain.glb")
