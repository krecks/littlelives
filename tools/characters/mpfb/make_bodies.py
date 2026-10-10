"""
Generates the Sim base bodies with MPFB (MakeHuman for Blender), headless:

    blender -b -P tools/characters/mpfb/make_bodies.py -- <packs dir> <out dir> [--preview]

<packs dir> holds the CC0 MakeHuman asset packs as downloaded (zips): `makehuman_system_assets_cc0.zip`
(eyes, brows, lashes, teeth, tongue, skins), `faceunits01.zip` (ARKit face units) and `visemes02.zip`
(Meta/Oculus visemes). Missing packs are installed into MPFB's user data, as MPFB's own "Load pack"
does. See README.md for the pinned Blender and MPFB versions.

Per body (`male`, `female`) this writes `<out>/<body>.gltf` (+ .bin): the body, eyes, eyebrows,
eyelashes, teeth and tongue, MakeHuman's hairstyles and clothes, skinned to MPFB's `game_engine` rig,
with the face units and visemes as morph targets on every part (MPFB transfers them from the body to
the proxies), and `<out>/<body>.json` naming the parts and the source textures. The body and the
low-detail body carry a `_HIDE` attribute: bit k set where clothes item k (`CLOTHES`) hides the skin
(the item's MakeHuman delete group, which MPFB would otherwise cut out of the mesh). With `--preview`,
PNG renders of each body, a few expressions and the clothes go to `<out>/preview/`.

The look is set here: real proportions (MakeHuman's averages), women and men apart within ordinary
human variation, MakeHuman's skins by age (young, middle-aged, old).
"""

import json
import os
import sys
import zipfile

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) < 2:
    raise SystemExit(__doc__)
PACKS, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
PREVIEW = '--preview' in argv
os.makedirs(OUT, exist_ok=True)

bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mpfb')
from bl_ext.blender_org.mpfb.services.assetservice import AssetService  # noqa: E402
from bl_ext.blender_org.mpfb.services.exportservice import ExportService  # noqa: E402
from bl_ext.blender_org.mpfb.services.faceservice import FaceService  # noqa: E402
from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.blender_org.mpfb.services.locationservice import LocationService  # noqa: E402
from bl_ext.blender_org.mpfb.services.objectservice import ObjectService  # noqa: E402
from bl_ext.blender_org.mpfb.services.targetservice import TargetService  # noqa: E402

# ---- asset packs ------------------------------------------------------------------------------

PACK_FILES = {
    'system': 'makehuman_system_assets_cc0.zip',
    'faceunits01': 'faceunits01.zip',
    'visemes02': 'visemes02.zip',
}


def install_packs():
    data = LocationService.get_user_data()
    have = {
        'system': AssetService.system_assets_pack_is_installed(),
        'faceunits01': FaceService.is_faceunits01_installed(),
        'visemes02': os.path.exists(os.path.join(data, 'targets', 'visemes', 'viseme_sil.target')),
    }
    for key, name in PACK_FILES.items():
        if have[key]:
            continue
        path = os.path.join(PACKS, name)
        if not os.path.exists(path):
            raise SystemExit(f'missing asset pack {path}')
        print('installing', name, '->', data)
        with zipfile.ZipFile(path) as z:
            z.extractall(data)
    AssetService.update_all_asset_lists()
    if not FaceService.is_faceunits01_installed(force_recheck=True):
        raise SystemExit('faceunits01 did not install')


# ---- the look -----------------------------------------------------------------------------------

# MakeHuman macros (0..1). Age 0.5 is 25 years. Proportions 0.5, height, weight and muscle 0.5 are
# MakeHuman's averages, from anthropometric data: real proportions (a head about 1/7.5 of the
# body height), women and men apart as the gender macro shapes them.
MACROS = {
    'female': dict(gender=0.0, age=0.5, muscle=0.42, weight=0.48, proportions=0.8, height=0.45, cupsize=0.6, firmness=0.6),
    'male': dict(gender=1.0, age=0.5, muscle=0.62, weight=0.52, proportions=0.8, height=0.55, cupsize=0.5, firmness=0.5),
}
RACE = {'asian': 0.33, 'caucasian': 0.34, 'african': 0.33}

# Life stages (the game's, content `life.stages`): MakeHuman age (0 = 1 year, 0.1875 = 11, 0.5 = 25,
# 1 = 90) and how the body changes. The young adult is the base body; the others are exported as
# variants of it (same topology, own shape and skeleton).
STAGES = {
    'baby': dict(age=0.0),
    'child': dict(age=0.12),
    'teen': dict(age=0.29),
    'youngAdult': dict(age=0.5),
    'adult': dict(age=0.64, weight=0.55),
    'elder': dict(age=0.9, weight=0.55, muscle=0.4),
}
BASE_STAGE = 'youngAdult'

# No stylisation: only what clothes need (nipples smoothed so they don't show through tops).
STYLE = {
    'nipple-point-decr': 1.0,
    'nipple-size-decr': 0.6,
}
# Women and men apart at a glance, as in real people (each within ordinary human variation): the
# shoulder-to-hip ratio (about 1.4 in men, close to 1 in women), the waist, arms and neck; the jaw
# and chin, nose, lips and brows of the face.
STYLE_BODY = {
    'female': {
        'measure-shoulder-dist-decr': 0.35,
        'measure-hips-circ-incr': 0.3,
        'measure-waist-circ-decr': 0.25,
        'measure-neck-circ-decr': 0.35,
        'upperarm-scale-horiz-decr': 0.25,
        'upperarm-shoulder-muscle-decr': 0.3,
        'upperleg-fat-incr': 0.2,
        'torso-vshape-decr': 0.25,
        'chin-width-decr': 0.35,
        'chin-prominent-decr': 0.25,
        'cheek-bones-incr': 0.2,
        'nose-scale-horiz-decr': 0.25,
        'nose-volume-decr': 0.3,
        'nose-point-width-decr': 0.25,
        'mouth-upperlip-volume-incr': 0.3,
        'mouth-lowerlip-volume-incr': 0.3,
        'eye-scale-incr': 0.2,
        'eyebrows-angle-up': 0.4,
        'eyebrows-trans-up': 0.2,
    },
    'male': {
        'measure-shoulder-dist-incr': 0.35,
        'torso-vshape-incr': 0.35,
        'measure-hips-circ-decr': 0.2,
        'measure-neck-circ-incr': 0.35,
        'upperarm-shoulder-muscle-incr': 0.3,
        'torso-muscle-pectoral-incr': 0.25,
        'chin-width-incr': 0.35,
        'chin-prominent-incr': 0.25,
        'chin-height-incr': 0.15,
        'head-square': 0.35,
        'nose-scale-horiz-incr': 0.15,
        'nose-scale-vert-incr': 0.15,
        'mouth-upperlip-volume-decr': 0.15,
        'eyebrows-trans-down': 0.3,
        'eyebrows-trans-forward': 0.3,
    },
}
SIDED = ('eye-', 'cheek-', 'upperarm-', 'lowerarm-', 'upperleg-', 'lowerleg-', 'leg-', 'ear-')

PARTS = {
    'eyes': 'high-poly/high-poly.mhclo',
    'eyebrows': {'female': 'eyebrow003/eyebrow003.mhclo', 'male': 'eyebrow012/eyebrow012.mhclo'},
    'eyelashes': 'eyelashes01/eyelashes01.mhclo',
    'teeth': 'teeth_base/teeth_base.mhclo',
    'tongue': 'tongue01/tongue01.mhclo',
}
# MakeHuman's hairstyles, fitted by MPFB to every body and life stage
# (bob01 and long01 are left out: a fringe over the whole face, and a hood-like shell.)
HAIRS = ['afro01', 'bob02', 'braid01', 'ponytail01', 'short01', 'short02', 'short03', 'short04']
# MakeHuman's clothes, fitted by MPFB to every body and life stage (the build splits the suits into
# tops and bottoms; see `GARMENTS` in build_mpfb.py). At most 24: `_HIDE` is a bit mask in a float.
CLOTHES = [
    'female_casualsuit01', 'female_casualsuit02', 'female_sportsuit01', 'female_elegantsuit01',
    'male_casualsuit01', 'male_casualsuit02', 'male_casualsuit03', 'male_casualsuit04', 'male_casualsuit05',
    'male_casualsuit06', 'male_elegantsuit01',
    'shoes01', 'shoes03', 'shoes05', 'shoes06',
]
# MakeHuman's skins by age: the creator's skin colour tints them at runtime (relative to their median).
SKIN_AGE = {'baby': 'young', 'child': 'young', 'teen': 'young', 'youngAdult': 'young', 'adult': 'middleage', 'elder': 'old'}


def skin_for(body, stage):
    return f'{SKIN_AGE[stage]}_caucasian_{body}/{SKIN_AGE[stage]}_caucasian_{body}.mhmat'


# MakeHuman's low-detail bodies (about 1,600 vertices), fitted to every body and stage like the rest:
# the game draws them on residents far from the camera.
PROXIES = {'female': 'female1605/female1605.proxy', 'male': 'male1591/male1591.proxy'}
TYPES = {'Basemesh': 'body', 'Eyes': 'eyes', 'Eyebrows': 'eyebrows', 'Eyelashes': 'eyelashes', 'Teeth': 'teeth', 'Tongue': 'tongue', 'Proxymeshes': 'lod'}


def targets_for(body):
    style = dict(STYLE)
    style.update(STYLE_BODY[body])
    out = []
    for name, value in style.items():
        if value <= 0:
            continue
        if name.startswith(SIDED):
            out += [{'target': f'l-{name}', 'value': value}, {'target': f'r-{name}', 'value': value}]
        else:
            out.append({'target': name, 'value': value})
    return out


def pick(spec, body):
    return spec[body] if isinstance(spec, dict) else spec


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def make_human(body, stage):
    info = HumanService._create_default_human_info_dict()
    info['name'] = body
    info['phenotype'] = dict(MACROS[body], **STAGES[stage], race=dict(RACE))
    info['targets'] = targets_for(body)
    info['rig'] = 'game_engine'
    for part, spec in PARTS.items():
        info[part] = pick(spec, body)
    info['proxy'] = PROXIES[body]
    info['skin_mhmat'] = skin_for(body, stage)
    info['skin_material_type'] = 'GAMEENGINE'
    info['eyes_material_type'] = 'MAKESKIN'
    settings = HumanService.get_default_deserialization_settings()
    settings.update(subdiv_levels=0, load_clothes=False, override_skin_model='PRESET', override_rig='PRESET')
    basemesh = HumanService.deserialize_from_dict(info, settings)
    for hair in HAIRS:
        path = AssetService.find_asset_absolute_path(f'{hair}/{hair}.mhclo', asset_subdir='hair')
        HumanService.add_mhclo_asset(path, basemesh, asset_type='Hair', subdiv_levels=0, material_type='MAKESKIN')
    for item in CLOTHES:
        HumanService.add_mhclo_asset(clothes_path(item), basemesh, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN')
    return basemesh


def clothes_path(item):
    return AssetService.find_asset_absolute_path(f'{item}/{item}.mhclo', asset_subdir='clothes')


def keep_skin(copy):
    """
    Drops the clothes' delete masks (MPFB cuts the skin under clothes out of the mesh; every Sim
    wears different clothes on the same body) and records them instead as the `_HIDE` bit mask on
    the body and the low-detail body.
    """
    proxy = ObjectService.find_object_of_type_amongst_nearest_relatives(copy, mpfb_type_name='Proxymeshes')
    for obj in (copy, proxy):
        if obj is None:
            continue
        for mod in list(obj.modifiers):
            if mod.type == 'MASK' and mod.vertex_group.startswith('Delete.'):
                obj.modifiers.remove(mod)


def write_hide(obj):
    groups = {g.index: CLOTHES.index(g.name[len('Delete.'):]) for g in obj.vertex_groups
              if g.name.startswith('Delete.') and g.name[len('Delete.'):] in CLOTHES}
    mask = [0.0] * len(obj.data.vertices)
    for v in obj.data.vertices:
        bits = 0
        for g in v.groups:
            if g.group in groups and g.weight > 0.5:
                bits |= 1 << groups[g.group]
        mask[v.index] = float(bits)
    attr = obj.data.attributes.new('_HIDE', 'FLOAT', 'POINT')
    attr.data.foreach_set('value', mask)
    return sum(1 for m in mask if m)


def export_copy(basemesh, face):
    """Bakes the modelling targets, adds face units + visemes (`face`) and carries them to the proxies."""
    root = ExportService.create_character_copy(basemesh, name_suffix='_export')
    copy = ObjectService.find_object_of_type_amongst_nearest_relatives(root)
    TargetService.bake_targets(copy)
    if face:
        FaceService.load_targets(copy, load_microsoft_visemes=False, load_meta_visemes=True, load_arkit_faceunits=True)
        FaceService.interpolate_targets(copy)
    keep_skin(copy)
    ExportService.bake_modifiers_remove_helpers(copy, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)
    return root, copy


def texture_of(obj):
    for slot in obj.material_slots:
        mat = slot.material
        if mat and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image and node.image.filepath:
                    return bpy.path.abspath(node.image.filepath)
    return None


def part_kind(obj):
    t = ObjectService.get_object_type(obj)
    if t == 'Hair':
        return next((f'hair.{h}' for h in HAIRS if h in obj.name), None)
    if t == 'Clothes':
        return next((f'cloth.{c}' for c in CLOTHES if obj.name.split('.')[-1].startswith(c)), None)
    return TYPES.get(t)


def export(body, stage):
    """One body at one life stage: `<body>.gltf` for the base stage, else `<body>.<stage>.gltf`."""
    base = stage == BASE_STAGE
    name = body if base else f'{body}.{stage}'
    clear_scene()
    basemesh = make_human(body, stage)
    original = ObjectService.find_object_of_type_amongst_nearest_relatives(basemesh, 'Skeleton') or basemesh.parent
    # Variants only need their shape (the base's face morphs apply to them as they are).
    root, copy = export_copy(basemesh, face=base)
    # Keep only the export copy.
    for obj in [original] + ObjectService.get_list_of_children(original):
        bpy.data.objects.remove(obj, do_unlink=True)
    parts = {}
    for obj in ObjectService.get_list_of_children(root):
        kind = part_kind(obj)
        if kind is None or obj.type != 'MESH':
            print('dropping', obj.name, ObjectService.get_object_type(obj))
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        obj.name = kind
        obj.data.name = kind
        if kind in ('body', 'lod'):
            print(f'{name} {kind} hidden vertices {write_hide(obj)}')
        keys = [k.name for k in obj.data.shape_keys.key_blocks[1:]] if obj.data.shape_keys else []
        parts[kind] = {'vertices': len(obj.data.vertices), 'morphs': len(keys), 'texture': texture_of(obj)}
        print(f'{name} {kind:14s} verts {len(obj.data.vertices):6d} morphs {len(keys)}')
    root.name = 'rig'
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in ObjectService.get_list_of_children(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, f'{name}.gltf'), export_format='GLTF_SEPARATE', use_selection=True,
        export_yup=True, export_apply=False, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials='NONE', export_skins=True, export_morph=base, export_morph_normal=base,
        export_morph_tangent=False, export_animations=False, export_def_bones=False, export_attributes=True,
    )
    keys = [k.name for k in bpy.data.objects['body'].data.shape_keys.key_blocks[1:]] if base else []
    meta = {'macros': dict(MACROS[body], **STAGES[stage]), 'race': RACE, 'stage': stage, 'targets': targets_for(body), 'parts': parts,
            'morphs': keys, 'skin': skin_for(body, stage), 'assets': {k: pick(v, body) for k, v in PARTS.items()}, 'hairs': HAIRS,
            'clothes': {c: clothes_path(c) for c in CLOTHES}}
    json.dump(meta, open(os.path.join(OUT, f'{name}.json'), 'w'), indent=1)
    if PREVIEW:
        preview(name, root, faces=base)


# ---- preview renders --------------------------------------------------------------------------

PREVIEW_FACES = {
    'neutral': {},
    'smile': {'mouthSmileLeft': 0.8, 'mouthSmileRight': 0.8, 'cheekSquintLeft': 0.5, 'cheekSquintRight': 0.5},
    'sad': {'browInnerUp': 0.8, 'mouthFrownLeft': 0.7, 'mouthFrownRight': 0.7},
    'blink': {'eyeBlinkLeft': 1.0, 'eyeBlinkRight': 1.0},
    'aa': {'viseme_aa': 1.0},
}


def set_face(root, weights):
    for obj in ObjectService.get_list_of_children(root):
        if obj.type != 'MESH' or not obj.data.shape_keys:
            continue
        for kb in obj.data.shape_keys.key_blocks[1:]:
            kb.value = weights.get(kb.name, 0.0)


PREVIEW_LOOK = {
    'female': ('hair.bob02', ['cloth.female_casualsuit01', 'cloth.shoes05']),
    'male': ('hair.short02', ['cloth.male_casualsuit04', 'cloth.shoes05']),
}


def show_only(root, keep):
    for obj in ObjectService.get_list_of_children(root):
        if obj.type == 'MESH':
            hide = obj.name.startswith(('hair.', 'cloth.', 'lod')) and obj.name not in keep
            obj.hide_render = hide
            obj.hide_viewport = hide


def preview(body, root, faces=True):
    d = os.path.join(OUT, 'preview')
    os.makedirs(d, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 768, 1024
    scene.render.film_transparent = False
    body_obj = bpy.data.objects['body']
    top = max((body_obj.matrix_world @ v.co).z for v in body_obj.data.vertices)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def shot(name, loc, target, lens):
        cam.location = loc
        direction = Vector(target) - cam.location
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        cam_data.lens = lens
        scene.render.filepath = os.path.join(d, f'{body}_{name}.png')
        bpy.ops.render.render(write_still=True)

    sex = body.split('.')[0]
    hair, outfit = PREVIEW_LOOK[sex]
    show_only(root, [hair] + outfit)
    set_face(root, {})
    far = 4.2 * max(top, 1.0) / 1.75
    shot('body', (0, -far, top * 0.55), (0, 0, top * 0.5), 50)
    shot('body34', (far * 0.62, -far * 0.79, top * 0.6), (0, 0, top * 0.5), 50)
    eye = top - 0.12 * top / 1.75
    for face, weights in (PREVIEW_FACES.items() if faces else ()):
        set_face(root, weights)
        shot(f'face_{face}', (0.18, -0.62, eye), (0, 0, eye - 0.02), 85)
    set_face(root, {})
    if faces:
        for h in HAIRS:
            show_only(root, [f'hair.{h}'] + outfit)
            shot(f'hair_{h}', (0.35, -1.0, eye), (0, 0, eye - 0.02), 85)
        for c in CLOTHES:
            show_only(root, [hair, f'cloth.{c}'])
            shot(f'cloth_{c}', (far * 0.62, -far * 0.79, top * 0.6), (0, 0, top * 0.5), 50)
    show_only(root, [n.name for n in ObjectService.get_list_of_children(root)])


install_packs()
for b in ('female', 'male'):
    for st in STAGES:
        export(b, st)
print('done ->', OUT)
