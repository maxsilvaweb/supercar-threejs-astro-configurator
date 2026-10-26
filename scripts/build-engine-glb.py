"""
USD → GLB for the engine bay V8 (NVIDIA SimReady engineAssembly_v8_engine_a01, CC BY 4.0).

Reparents the instanced pulleys and belt, drops the physics helpers, splits the block into one
node per material (and per cylinder bank where a material spans both), then exports Y-up GLB.
src/lib/engine.ts matches the resulting node names, so keep them stable.

  blender -b --factory-startup --python scripts/build-engine-glb.py -- <simready_usd>/sm_engineAssembly_v8_engine_a01_01.usd engine-v8.raw.glb

Then compress with the name-preserving pipeline (webp → dedup --materials false --meshes false →
resize 1024 → draco) into public/models/engine-v8/engine-v8.glb.
"""
import bpy, re, sys
args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[0], args[1]

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

# Split the block into one node per material so the app can recolour and explode by name.
block = objs["engine_01_mesh_00"]
bpy.ops.object.select_all(action="DESELECT")
block.select_set(True)
bpy.context.view_layer.objects.active = block
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")
for ob in geometry.children_recursive:
    if ob.type == "MESH" and ob.name.startswith("engine_01_mesh_00"):
        ob.name = ob.data.name = f"block_{short(ob.material_slots[0].material.name)}"

# Parts that sit on both cylinder banks get one node per bank, so the exploded view can fan them out.
BANK = 0.12
for ob in [o for o in geometry.children_recursive if o.type == "MESH" and o.name.startswith("block_")]:
    ys = [v.co.y for v in ob.data.vertices]
    if min(ys) > -0.25 or max(ys) < 0.25:
        continue
    base = ob.name
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
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

geometry.name = "EngineV8"
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
