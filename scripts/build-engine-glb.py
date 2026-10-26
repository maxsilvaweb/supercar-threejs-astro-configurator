"""
USD → GLB for the engine bay engines (NVIDIA SimReady engineAssembly_v8_engine_a01 and
engineAssembly_v12_engine_a01, both CC BY 4.0).

Reparents the instanced parts, drops the physics helpers, optionally decimates, splits each engine
body into one node per material (and per cylinder bank where a material spans both), then exports
Y-up GLB. The V8 body becomes block_*, the V12 bodies body_01_* and body_02_*. src/lib/engine.ts
matches these node names, so keep them stable.

  blender -b --factory-startup --python scripts/build-engine-glb.py -- <simready_usd>/sm_engineAssembly_v8_engine_a01_01.usd engine-v8.raw.glb
  blender -b --factory-startup --python scripts/build-engine-glb.py -- <simready_usd>/sm_engineAssembly_v12_engine_a01_01.usd engine-v12.raw.glb 0.3 -x

Optional arguments: the decimate ratio (the V12 needs 0.3 to stay under ~1M triangles), then the end
of the engine with the belt drive. The V12's pulleys are baked into its bodies, so with "-x" or "+x"
the script pulls each one out into a pulley_NN node pivoted on its axis, which the app spins. The V8
ships its pulleys as separate gear_* parts and needs neither.

Then compress with the name-preserving pipeline (webp → dedup --materials false --meshes false →
resize 1024 → draco) into public/models/engine-v8/engine-v8.glb or public/models/engine-v12/engine-v12.glb.
"""
import bmesh, bpy, re, sys
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[0], args[1]
decimate = float(args[2]) if len(args) > 2 else 1.0
pulley_end = args[3] if len(args) > 3 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath=src, import_materials=True, import_usd_preview=True)
objs = bpy.data.objects

# Instanceable prototypes land at the origin; put each mesh back under its positioned *_obj_00 Xform.
for ob in list(objs):
    m = re.match(r"(.+)_mesh_00$", ob.name)
    if ob.type == "MESH" and m and (holder := objs.get(f"{m.group(1)}_obj_00")):
        holder.instance_type = "NONE"
        holder.instance_collection = None
        ob.parent = holder
        ob.matrix_parent_inverse.identity()
        ob.matrix_basis.identity()

# Drop physics/joint/grasp helpers; keep only Geometry and its children.
geometry = objs["Geometry"]
keep = {geometry, *geometry.children_recursive}
for ob in list(objs):
    if ob not in keep:
        bpy.data.objects.remove(ob, do_unlink=True)

# Prototype meshes live in a collection outside the view layer; move everything into the scene.
scene_collection = bpy.context.scene.collection
for ob in keep:
    for collection in list(ob.users_collection):
        collection.objects.unlink(ob)
    scene_collection.objects.link(ob)

for collection in list(bpy.data.collections):
    if collection.name.startswith("proto"):
        bpy.data.collections.remove(collection)

# One material per base name: "m_opaque__metal__steel_a01.003" → "m_opaque__metal__steel_a01".
for ob in geometry.children_recursive:
    for slot in ob.material_slots:
        if slot.material and (base := bpy.data.materials.get(re.sub(r"\.\d{3}$", "", slot.material.name))):
            slot.material = base

def short(material_name):
    # "m_opaque__metal__paintedRough_orange_a01" → "paintedRough_orange"
    return re.sub(r"^m_opaque__\w+?__|_a\d+$|_b\d+$", "", material_name).replace("__", "_")

def select_only(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob

if decimate < 1:
    for ob in [o for o in geometry.children_recursive if o.type == "MESH"]:
        select_only(ob)
        modifier = ob.modifiers.new("decimate", "DECIMATE")
        modifier.ratio = decimate
        bpy.ops.object.modifier_apply(modifier=modifier.name)

# Split each engine body into one node per material so the app can recolour and explode by name.
bodies = {"engine_01_mesh_00": "block"}
bodies.update({ob.name: m.group(1) for ob in objs if (m := re.match(r"(body_\d+)_mesh_00$", ob.name))})
for body_name, prefix in bodies.items():
    body = objs.get(body_name)
    if not body:
        continue
    select_only(body)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
    for ob in geometry.children_recursive:
        if ob.type == "MESH" and ob.name.startswith(body_name):
            ob.name = ob.data.name = f"{prefix}_{short(ob.material_slots[0].material.name)}"

# Parts that sit on both cylinder banks get one node per bank, so the exploded view can fan them out.
BANK = 0.12
for ob in [o for o in geometry.children_recursive if o.type == "MESH" and re.match(r"(block|body_\d+)_", o.name)]:
    ys = [v.co.y for v in ob.data.vertices]
    if min(ys) > -0.25 or max(ys) < 0.25:
        continue
    base = ob.name
    select_only(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = [o for o in geometry.children_recursive if o.type == "MESH" and (o.name == base or o.name.startswith(base + "."))]
    for index, piece in enumerate(pieces):
        piece.name = f"{base}~{index}"
    buckets = {"": [], "_bank1": [], "_bank2": []}
    for piece in pieces:
        y = sum(v.co.y for v in piece.data.vertices) / len(piece.data.vertices)
        buckets["_bank1" if y < -BANK else "_bank2" if y > BANK else ""].append(piece)
    for suffix, group in buckets.items():
        if not group:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for piece in group:
            piece.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
        group[0].name = base + suffix

def islands(bm):
    """Face lists of each connected piece."""
    seen, out = set(), []
    for face in bm.faces:
        if face.index in seen:
            continue
        seen.add(face.index)
        stack, group = [face], []
        while stack:
            current = stack.pop()
            group.append(current)
            for edge in current.edges:
                for linked in edge.link_faces:
                    if linked.index not in seen:
                        seen.add(linked.index)
                        stack.append(linked)
        out.append(group)
    return out

def bounds(faces):
    cos = [v.co for f in faces for v in f.verts]
    lo = Vector((min(c.x for c in cos), min(c.y for c in cos), min(c.z for c in cos)))
    hi = Vector((max(c.x for c in cos), max(c.y for c in cos), max(c.z for c in cos)))
    return lo, hi

# Pull baked-in pulleys out into their own nodes. A pulley is every piece in the belt plane whose outline
# sits inside a disc around an axis that a round black rim is centred on. Metal round parts such as the
# alternator casing or a tensioner housing don't start a pulley, and parts behind the belt plane stay put.
if pulley_end:
    sign = -1 if pulley_end == "-x" else 1
    parts = [o for o in geometry.children_recursive if o.type == "MESH" and re.match(r"(block|body_\d+)_", o.name)]
    extreme = max(sign * v.co.x for o in parts for v in o.data.vertices)
    found = []  # (object, island faces' indices, lo, hi)
    for ob in parts:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        for group in islands(bm):
            lo, hi = bounds(group)
            if sign * (lo.x + hi.x) / 2 > extreme - 0.06:
                found.append((ob, [f.index for f in group], lo, hi))
        bm.free()

    axes = []  # [y, z, radius]
    for ob, _, lo, hi in found:
        if not re.search(r"black|rubber", ob.material_slots[0].material.name):
            continue
        size = hi - lo
        diameter = max(size.y, size.z)
        if diameter < 0.07 or diameter > 0.25 or abs(size.y - size.z) > 0.12 * diameter:
            continue
        y, z = (lo.y + hi.y) / 2, (lo.z + hi.z) / 2
        axis = next((a for a in axes if abs(a[0] - y) < 0.006 and abs(a[1] - z) < 0.006), None)
        if axis:
            axis[2] = max(axis[2], diameter / 2)
        else:
            axes.append([y, z, diameter / 2])
    axes.sort(key=lambda a: (a[1], a[0]))

    def inside(axis, lo, hi):
        # Treat each piece as round: its centre plus its larger half-extent must stay within the disc.
        y, z, radius = axis
        reach = ((lo.y + hi.y) / 2 - y) ** 2 + ((lo.z + hi.z) / 2 - z) ** 2
        return reach ** 0.5 + max(hi.y - lo.y, hi.z - lo.z) / 2 <= radius * 1.02

    members = {}  # object name → {face index: pulley number}
    spans = {}  # pulley number → [min x, max x]
    for ob, faces, lo, hi in found:
        number = next((i for i, axis in enumerate(axes) if inside(axis, lo, hi)), None)
        if number is None:
            continue
        members.setdefault(ob.name, {}).update({index: number for index in faces})
        span = spans.setdefault(number, [lo.x, hi.x])
        span[0], span[1] = min(span[0], lo.x), max(span[1], hi.x)

    pieces = {}  # pulley number → separated objects
    for name, faces in members.items():
        source = objs[name]
        for number in sorted(set(faces.values())):
            select_only(source)
            bpy.ops.object.mode_set(mode="EDIT")
            bm = bmesh.from_edit_mesh(source.data)
            bm.faces.ensure_lookup_table()
            tag = bm.faces.layers.int.get("pulley") or bm.faces.layers.int.new("pulley")
            if number == min(faces.values()):
                for face in bm.faces:
                    face[tag] = faces.get(face.index, -1)
            for face in bm.faces:
                face.select_set(face[tag] == number)
            bmesh.update_edit_mesh(source.data)
            before = set(objs)
            bpy.ops.mesh.separate(type="SELECTED")
            bpy.ops.object.mode_set(mode="OBJECT")
            pieces.setdefault(number, []).extend(o for o in objs if o not in before)

    for label, (number, group) in enumerate(sorted(pieces.items()), start=1):
        bpy.ops.object.select_all(action="DESELECT")
        for piece in group:
            piece.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
        pulley = group[0]
        pulley.name = f"pulley_{label:02d}"
        y, z, _ = axes[number]
        bpy.context.scene.cursor.location = ((spans[number][0] + spans[number][1]) / 2, y, z)
        select_only(pulley)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")

    for ob in geometry.children_recursive:
        if ob.type == "MESH" and "pulley" in ob.data.attributes:
            ob.data.attributes.remove(ob.data.attributes["pulley"])

geometry.name = "Engine"
for ob in geometry.children_recursive:
    if ob.type == "MESH":
        ob.data.name = ob.name
    print("NODE", ob.type, ob.name, [s.material.name for s in ob.material_slots if s.material])

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_yup=True,
    export_apply=False,
    export_image_format="AUTO",
    export_materials="EXPORT",
    export_extras=False,
    use_selection=False,
)
