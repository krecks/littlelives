"""
Builds the Sim character assets in `web/public/assets/characters/` from MPFB bodies (MakeHuman, CC0):

    python3 -I tools/characters/build_mpfb.py <mpfb dir> <legacy dir> <output dir>

- <mpfb dir>: the output of `mpfb/make_bodies.py` (`male.gltf`, `female.gltf` + `.json`): bodies with eyes,
  eyebrows, eyelashes, teeth, tongue, hair and clothes on MPFB's `game_engine` rig, the ARKit face
  units and Meta visemes as morph targets, and per life stage the same, refitted.
- <legacy dir>: a character set built by `build.py` from the Quaternius packs (rig.json, anims.bin,
  male.bin, hair textures). Its clips (`anims.bin`, Universal Animation Library) and hairstyles
  (Universal Base Characters) are carried over; the hair is refitted to the new heads.

Output: the same files as build.py (rig.json version 3, `<body>.bin`, anims.bin, textures), plus
per part the face morphs (see `write_parts` in common.py) and `rig.morphs` naming the channels. The
garments are MakeHuman's clothes (`GARMENTS`; see clothes.py), their textures in one atlas.

The skeleton keeps the clip skeleton's bones, order and parents (65 bones, MPFB's `game_engine` rig
uses the same names), so the clips retarget as before (target local = pre * source local * post),
plus two eye bones under the head for the gaze. Expressions, blinks and speech are morphs.
"""

import json
import os
import shutil
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clothes import CATEGORY, Atlas, covered, fit_cut, item_material, pieces  # noqa: E402
from clothes import subset as keep_faces  # noqa: E402
from common import FIELD_SCALE, hair_fields, smoothstep, mirror_m, mirror_q, mirror_t, qinv, qmul, raster_attrs, srgb_to_lin, to_babylon, write_parts  # noqa: E402
from garments import Landmarks, body_fields, coverage  # noqa: E402
from gltfio import Gltf  # noqa: E402
from meshops import dense_weights, smooth_normals, top4, weld_ids  # noqa: E402

SRC, LEGACY, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)

legacy = json.load(open(os.path.join(LEGACY, 'rig.json')))
NB0 = legacy['clipBones']
BONES = legacy['bones'][:NB0]
PARENTS = legacy['parents'][:NB0]
B = {n: i for i, n in enumerate(BONES)}
HEAD = B['Head']
FACE_BONES = ['eye_l', 'eye_r']
NBT = NB0 + len(FACE_BONES)
ALL_BONES = BONES + FACE_BONES
ALL_PARENTS = PARENTS + [HEAD] * len(FACE_BONES)
# MPFB bone names that differ from the clip skeleton's.
RENAME = {'Root': 'root', 'head': 'Head'}

# Face channels: the visemes in the order the voice engine numbers them, then the ARKit face units.
# The gaze turns the eye bones: the eyeballs drop their eyeLook morphs, and only the lids' up / down
# follow is kept (eyeLookUp / eyeLookDown on the skin and lashes).
VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U']
MORPH_SCALE = 30000.0  # int16 position deltas per metre
NORMAL_SCALE = 63.0  # int8 normal deltas


def keep_channel(target, part=None):
    if target.startswith(('eyeLookIn', 'eyeLookOut')):
        return False
    return not (part == 'eyes' and target.startswith('eyeLook'))


def channel_name(target):
    return target[len('viseme_'):] if target.startswith('viseme_') else target


# ---- retarget constants (mirrored space) ------------------------------------------------------

def world_q(local, parents):
    out = np.zeros_like(local)
    for i, p in enumerate(parents):
        out[i] = qmul(out[p], local[i]) if p >= 0 else local[i]
    return out


src_rest_q = np.array(legacy['sourceRestQ'], np.float64).reshape(-1, 4)[:NB0]
src_rest_q = np.concatenate([src_rest_q, np.tile([0, 0, 0, 1.0], (len(FACE_BONES), 1))])
src_world_q = world_q(src_rest_q, ALL_PARENTS)
src_pelvis_h = legacy['sourcePelvis'][2]


# Bone directions (bone -> child joint) used to line the new bodies' rest pose (an A-pose) up with
# the clip skeleton's T-pose: the clips store rotations relative to that T-pose.
CHILD = {
    'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01', 'neck_01': 'Head',
    'thigh_l': 'calf_l', 'calf_l': 'foot_l', 'foot_l': 'ball_l', 'ball_l': 'ball_leaf_l',
    'thigh_r': 'calf_r', 'calf_r': 'foot_r', 'foot_r': 'ball_r', 'ball_r': 'ball_leaf_r',
}
for side in 'lr':
    CHILD.update({f'clavicle_{side}': f'upperarm_{side}', f'upperarm_{side}': f'lowerarm_{side}', f'lowerarm_{side}': f'hand_{side}', f'hand_{side}': f'middle_01_{side}'})
    for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        CHILD.update({f'{f}_01_{side}': f'{f}_02_{side}', f'{f}_02_{side}': f'{f}_03_{side}', f'{f}_03_{side}': f'{f}_04_leaf_{side}'})


def world_positions(t, q, parents):
    rot = world_q(q, parents)
    pos = np.zeros((len(parents), 3))
    for i, p in enumerate(parents):
        pos[i] = t[i] if p < 0 else pos[p] + Rotation.from_quat(rot[p]).apply(t[i])
    return pos


def align(a, b, a2=None, b2=None):
    """Rotation taking direction a onto b (and, if given, the plane of (a, a2) onto that of (b, b2))."""
    if a2 is None:
        return Rotation.align_vectors([b], [a])[0]
    return Rotation.align_vectors([b, b2], [a, a2], weights=[10, 1])[0]


def tpose(name, t, q):
    """World rotations (mirrored) of the body posed like the legacy body of the same name (T-pose)."""
    lb = legacy['bodies'][name]
    lt = np.array(lb['restT']).reshape(-1, 3)[:NB0]
    lq = np.array(lb['restQ']).reshape(-1, 4)[:NB0]
    lp = world_positions(lt, lq, PARENTS)
    tp = world_positions(t, q, ALL_PARENTS)
    tw = world_q(q, ALL_PARENTS)
    R = [None] * len(ALL_BONES)
    for i, n in enumerate(ALL_BONES):
        c = CHILD.get(n)
        if c is None:
            R[i] = R[ALL_PARENTS[i]] if ALL_PARENTS[i] >= 0 else Rotation.identity()
            continue
        j = B[c]
        if n.startswith('hand_'):
            side = n[-1]
            a2 = tp[B[f'index_01_{side}']] - tp[B[f'pinky_01_{side}']]
            b2 = lp[B[f'index_01_{side}']] - lp[B[f'pinky_01_{side}']]
            R[i] = align(tp[j] - tp[i], lp[j] - lp[i], a2, b2)
        else:
            R[i] = align(tp[j] - tp[i], lp[j] - lp[i])
    return np.array([(R[i] * Rotation.from_quat(tw[i])).as_quat() for i in range(len(ALL_BONES))])


def retarget(name, target_local_q_mirrored, target_local_t_mirrored):
    tw = tpose(name, target_local_t_mirrored, target_local_q_mirrored)
    C = qmul(qinv(src_world_q), tw)
    pre = np.array([qinv(C[p]) if p >= 0 else [0, 0, 0, 1.0] for p in ALL_PARENTS])
    return pre, C


# ---- MPFB body --------------------------------------------------------------------------------

class Body:
    """One MPFB export: bind-pose joint matrices in the clip skeleton's order, and the mesh parts."""

    def __init__(self, name):
        self.name = name
        self.g = Gltf(os.path.join(SRC, f'{name}.gltf'))
        self.meta = json.load(open(os.path.join(SRC, f'{name}.json')))
        j = self.g.j
        skin = j['skins'][0]
        self.src_names = [RENAME.get(j['nodes'][k]['name'], j['nodes'][k]['name']) for k in skin['joints']]
        ibm = self.g.acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1).astype(np.float64)
        W = {n: np.linalg.inv(m) for n, m in zip(self.src_names, ibm)}
        missing = [n for n in BONES if n not in W and '_leaf' not in n]
        assert not missing, f'{name}: MPFB rig lacks {missing}'
        # Leaf bones (no weights): past the last finger joint, in front of the ball of the foot.
        for b in BONES:
            if b in W:
                continue
            p = PARENTS[B[b]]
            parent = BONES[p]
            m = W[parent].copy()
            if b.startswith('ball_leaf'):
                fwd = W[parent][:3, 3] - W[BONES[PARENTS[p]]][:3, 3]
                fwd[1] = 0
                m[:3, 3] = W[parent][:3, 3] + fwd / np.linalg.norm(fwd) * 0.06
            else:
                prev = W[BONES[PARENTS[p]]][:3, 3]
                m[:3, 3] = W[parent][:3, 3] + (W[parent][:3, 3] - prev) * 0.8
            W[b] = m
        self.W = W
        self.parts = {}
        for mesh in j['meshes']:
            self.parts[mesh['name']] = self.read_part(mesh)
        # Eyes: the opaque eyeballs only (the clear cornea shells are transparent in the texture);
        # the runtime gives the eyeball a glossy coat instead.
        alpha = np.asarray(Image.open(self.meta['parts']['eyes']['texture']).convert('RGBA'))[..., 3]
        eyes = self.parts['eyes']
        h, w = alpha.shape
        px = np.clip((eyes['uv'] * [w - 1, h - 1]).round().astype(int), 0, [w - 1, h - 1])
        self.parts['eyes'] = subset(eyes, alpha[px[:, 1], px[:, 0]] >= 128)
        # Eye bones: at each eyeball's centre, with the head's orientation.
        eyes = self.parts['eyes']
        H = W['Head']
        for side, bone in ((1, 'eye_l'), (-1, 'eye_r')):
            sel = eyes['pos'][:, 0] * side > 0
            lo, hi = eyes['pos'][sel].min(0), eyes['pos'][sel].max(0)
            r = (hi[0] - lo[0]) / 2
            c = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2] + r])
            m = H.copy()
            m[:3, 3] = c
            W[bone] = m
            eyes['joints'][sel] = 0
            eyes['joints'][sel, 0] = NB0 + FACE_BONES.index(bone)
            eyes['weights'][sel] = 0
            eyes['weights'][sel, 0] = 1
        self.world = np.array([W[n] for n in ALL_BONES])
        self.ibm = np.array([np.linalg.inv(m) for m in self.world])
        local = []
        for i, p in enumerate(ALL_PARENTS):
            local.append(self.world[i] if p < 0 else np.linalg.inv(self.world[p]) @ self.world[i])
        local = np.array(local)
        self.t = local[:, :3, 3]
        self.q = Rotation.from_matrix(local[:, :3, :3]).as_quat()  # x, y, z, w

    def read_part(self, mesh):
        g = self.g
        p = mesh['primitives'][0]
        a = p['attributes']
        jo = g.acc(a['JOINTS_0']).astype(np.int64)
        remap = np.array([B[n] if n in B else -1 for n in self.src_names])
        we = g.acc(a['WEIGHTS_0']).astype(np.float64)
        joints = remap[jo]
        assert (joints[we > 0] >= 0).all(), mesh['name']
        part = dict(
            pos=g.acc(a['POSITION']).astype(np.float64), nor=g.acc(a['NORMAL']).astype(np.float64),
            uv=g.acc(a['TEXCOORD_0']).astype(np.float64), joints=np.maximum(joints, 0), weights=we,
            idx=g.acc(p['indices']).ravel().astype(np.int64),
        )
        if '_HIDE' in a:
            # Bit k: clothes item k (make_bodies.py `CLOTHES`) hides this vertex.
            part['hide'] = np.round(g.acc(a['_HIDE']).ravel()).astype(np.int64)
        names = mesh.get('extras', {}).get('targetNames', [])
        part['targets'] = {}
        for name, t in zip(names, p.get('targets', [])):
            if not keep_channel(name, mesh['name']):
                continue
            dp = g.acc(t['POSITION']).astype(np.float64)
            dn = g.acc(t['NORMAL']).astype(np.float64) if 'NORMAL' in t else np.zeros_like(dp)
            part['targets'][channel_name(name)] = (dp, dn)
        return part

    def skull(self, part):
        head_w = (part['weights'] * (part['joints'] == HEAD)).sum(1)
        return skull_box(part['pos'], head_w)


def skull_box(pos, head_w):
    """Bounds (bind pose, world axes) of the skull, where hair sits: the head's top 11 cm (crown to brows)."""
    head = pos[head_w > 0.95]
    pts = head[head[:, 1] > head[:, 1].max() - 0.11]
    return pts.min(0), pts.max(0)


def open_head(fields, part):
    """No neckline covers the head: a low chin (or jaw) would otherwise be inside a collar."""
    head_w = (part['weights'] * (part['joints'] == HEAD)).sum(1)
    fields = fields.copy()
    fields[head_w > 0.3, 2:4] = np.minimum(fields[head_w > 0.3, 2:4], -0.05)
    return fields


def scalp_weights(part, eye_y):
    """
    Per vertex 0..1: the scalp, where hair grows: the head above its hairline (as fractions of the
    eyes' height under the crown, so it suits every head: over the brow at the front, above the ears
    at the sides, down to the nape at the back), feathered. The runtime paints it in the hair colour
    under any hairstyle, so skin never shows between hair cards.
    """
    head_w = (part['weights'] * (part['joints'] == HEAD)).sum(1)
    y, nz = part['pos'][:, 1], part['nor'][:, 2]
    h = y[head_w > 0.9].max() - eye_y
    front, back = smoothstep(0.2, 0.6, nz), smoothstep(-0.2, -0.6, nz)
    line = eye_y + h * (0.5 * front + 0.3 * (1 - front - back) - 0.35 * back)
    w = smoothstep(line - 0.05 * h, line + 0.08 * h, y) * (head_w > 0.9)
    return w


def scalp_fields(fields, part, scalp):
    """Head skin: the crew field (no neckline reaches the head) holds -1 - scalp weight."""
    head_w = (part['weights'] * (part['joints'] == HEAD)).sum(1)
    out = fields.copy()
    out[head_w > 0.9, 2] = -1 - scalp[head_w > 0.9]
    return out


def clean_scalp(albedo, part, scalp, eye_y, size=1024):
    """
    MakeHuman's skins paint stubble over the scalp: fill it with the forehead's skin colour, so a
    bald head is bald (under hair the shader paints the scalp in the hair colour).
    """
    img = np.asarray(albedo.convert('RGB').resize((size, size), Image.LANCZOS), np.float64) / 255
    lin = srgb_to_lin(img)
    head_w = (part['weights'] * (part['joints'] == HEAD)).sum(1)
    m, hit = raster_attrs(part, np.minimum(scalp * 1.5, 1)[:, None], size)
    m = gaussian_filter(np.where(hit, m[..., 0], 0), 2)
    y = part['pos'][:, 1]
    forehead = (head_w > 0.9) & (scalp < 0.01) & (part['nor'][:, 2] > 0.6) & (y > eye_y + 0.025) & (y < eye_y + 0.05)
    hm, hhit = raster_attrs(part, forehead.astype(np.float64)[:, None], size)
    skin = np.median(lin[hhit & (hm[..., 0] > 0.99)], 0)
    fine = lin / np.maximum(gaussian_filter(lin, (2, 2, 0)), 1e-4)
    filled = skin * np.clip(fine, 0.92, 1.08)
    out = lin * (1 - m[..., None]) + filled * m[..., None]
    out = np.where(out <= 0.0031308, out * 12.92, 1.055 * np.clip(out, 0, 1) ** (1 / 2.4) - 0.055)
    return Image.fromarray(np.uint8(np.clip(out, 0, 1) * 255), 'RGB')


def subset(part, keep):
    """The faces of `part` whose vertices are all kept, with the vertices compacted."""
    tri = part['idx'].reshape(-1, 3)
    tri = tri[keep[tri].all(1)]
    used = np.unique(tri)
    remap = np.full(len(part['pos']), -1)
    remap[used] = np.arange(len(used))
    out = {k: (v[used] if isinstance(v, np.ndarray) and len(v) == len(part['pos']) else v) for k, v in part.items() if k not in ('idx', 'targets')}
    out['idx'] = remap[tri].ravel()
    out['targets'] = {c: (dp[used], dn[used]) for c, (dp, dn) in part.get('targets', {}).items()}
    return out


def clusters(part, cell, uv_cell=0.03):
    """
    Vertex clustering on a `cell`-sized grid: the cluster of each vertex and the triangles that
    survive (those spanning three clusters), for `simplify`. Only vertices facing the same way
    (normal octant) in the same patch of the texture merge, so thin shells (a tooth's front and
    back) and UV islands stay apart.
    """
    n = part['nor']
    octant = (n[:, 0] > 0) * 1 + (n[:, 1] > 0) * 2 + (n[:, 2] > 0) * 4
    key = np.c_[np.floor(part['pos'] / cell), octant, np.floor(part['uv'] / uv_cell)].astype(np.int64)
    _, of = np.unique(key, axis=0, return_inverse=True)
    of = of.ravel()
    tri = of[part['idx'].reshape(-1, 3)]
    tri = tri[(tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])]
    return of, tri


def simplify(part, of, tri):
    """A part with each cluster's vertices merged (positions, normals, weights and morph deltas averaged)."""
    n = of.max() + 1
    cnt = np.bincount(of, minlength=n).astype(np.float64)[:, None]

    def mean(a):
        out = np.zeros((n,) + a.shape[1:])
        np.add.at(out, of, a)
        return out / cnt.reshape((n,) + (1,) * (a.ndim - 1))

    first = np.full(n, -1)
    first[of[::-1]] = np.arange(len(of))[::-1]
    out = dict(part)
    out['pos'] = mean(part['pos'])
    nor = mean(part['nor'])
    out['nor'] = nor / np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-9)
    out['uv'] = part['uv'][first]
    if 'joints' in part:
        dense = np.zeros((len(of), NBT))
        np.put_along_axis(dense, part['joints'], part['weights'], 1)
        out['joints'], out['weights'] = top4(mean(dense))
    if part.get('fields') is not None:
        out['fields'] = mean(np.asarray(part['fields'], np.float64))
    out['idx'] = tri.ravel()
    out['targets'] = {c: (mean(dp), mean(dn)) for c, (dp, dn) in part.get('targets', {}).items()}
    return out


def triangles(part, tri_keep):
    """The triangles `tri_keep` of a part with their vertices (compacted, in first-use order): (vertices, part)."""
    tri = part['idx'].reshape(-1, 3)[tri_keep]
    used = np.unique(tri)
    remap = np.full(len(part['pos']), -1)
    remap[used] = np.arange(len(used))
    return used, take(part, used, remap[tri].ravel())


def take(part, used, idx):
    out = {k: (v[used] if isinstance(v, np.ndarray) and len(v) == len(part['pos']) else v) for k, v in part.items() if k not in ('idx', 'targets', 'morph')}
    out['idx'] = idx
    out['targets'] = {c: (dp[used], dn[used]) for c, (dp, dn) in part.get('targets', {}).items()}
    return out


# Body chunks: the body's triangles grouped by the garments that hide them completely (the skin is
# discarded there anyway), so a Sim draws only the chunks its clothes leave visible. Chunks under
# 2% of the triangles stay in the always-drawn `body`.
CHUNK_MIN = 0.02
COVER_MARGIN = 0.02  # = the shader's MARGIN


def body_chunks(skin, cuts):
    """{part name: (triangle mask, garments hiding it)}; `body` is never hidden."""
    f = skin['fields']
    tri = skin['idx'].reshape(-1, 3)
    names = list(cuts)
    sig = np.zeros(len(tri), np.int64)
    for k, key in enumerate(names):
        hidden = coverage(f, cuts[key], key.split('.')[0]) > COVER_MARGIN
        sig |= hidden[tri].all(1).astype(np.int64) << k
    sigs, counts = np.unique(sig, return_counts=True)
    keep = {s for s, c in zip(sigs, counts) if s and c >= CHUNK_MIN * len(tri)}
    sig = np.where(np.isin(sig, list(keep)), sig, 0)
    out = {'body': (sig == 0, [])}
    for s in sorted(keep):
        hiders = [names[k] for k in range(len(names)) if s >> k & 1]
        out[f'body.{s:x}'] = (sig == s, hiders)
    return out


# Teeth: MakeHuman's are 3.9k vertices (more than a shirt) for something seen a few pixels big.
TEETH_CELL = 0.0025
# Clothes on residents far from the camera (over the low-detail body): clustered on this grid (m).
LOD_CLOTH_CELL = 0.045

# Garments per body: `<slot>.<id>` (the ids saves keep) -> (MakeHuman clothes item, piece[, legs cut
# off this far from the knee up the thigh]). Suits are split into tops and bottoms (clothes.py
# `pieces`); MakeHuman's clothes fit either body. The jeans are the highest-waisted
# (male_casualsuit01's), so every top's hem reaches over them; men's shorts are those jeans cut off.
SHOES = {'shoes.sneakers': ('shoes05', 'shoes'), 'shoes.trainers': ('shoes06', 'shoes'),
         'shoes.boots': ('shoes03', 'shoes'), 'shoes.dress': ('shoes01', 'shoes')}
GARMENTS = {
    'female': {
        'top.tee': ('female_casualsuit01', 'top'),
        'top.tank': ('female_sportsuit01', 'top'),
        'top.blouse': ('female_elegantsuit01', 'top'),
        'top.long': ('male_casualsuit02', 'top'),
        'top.shirt': ('male_casualsuit01', 'top'),
        'top.jacket': ('male_casualsuit05', 'top'),
        'bottom.trousers': ('male_casualsuit01', 'bottom'),
        'bottom.shorts': ('female_casualsuit02', 'bottom'),
        'bottom.capri': ('female_sportsuit01', 'bottom'),
        'bottom.skirt': ('female_elegantsuit01', 'bottom'),
        **SHOES,
    },
    'male': {
        'top.tee': ('male_casualsuit04', 'top'),
        'top.vneck': ('male_casualsuit06', 'top'),
        'top.polo': ('male_casualsuit03', 'top'),
        'top.long': ('male_casualsuit02', 'top'),
        'top.shirt': ('male_casualsuit01', 'top'),
        'top.jacket': ('male_casualsuit05', 'top'),
        'top.suit': ('male_elegantsuit01', 'top'),
        'bottom.trousers': ('male_casualsuit01', 'bottom'),
        'bottom.shorts': ('male_casualsuit01', 'bottom', 0.12),
        'bottom.suit': ('male_elegantsuit01', 'bottom'),
        **SHOES,
    },
}
# Tees whose print is a MakeHuman logo: plain (their folds' occlusion only).
PLAIN_TOPS = {'female_casualsuit01', 'female_casualsuit02', 'male_casualsuit02', 'male_casualsuit04', 'male_casualsuit06'}


# ---- morphs ---------------------------------------------------------------------------------------

def pack_morphs(part, channels):
    """Sparse morphs of a part: the vertices any channel moves, and per channel (slot, dpos, dnor)."""
    targets = part.get('targets') or {}
    keep = {}
    for c, (dp, dn) in targets.items():
        moved = (np.abs(dp).max(1) > 2e-5) | (np.abs(dn).max(1) > 0.01)
        if moved.any():
            keep[c] = moved
    if not keep:
        return None
    verts = np.where(np.any(list(keep.values()), axis=0))[0]
    slot_of = np.full(len(part['pos']), -1)
    slot_of[verts] = np.arange(len(verts))
    ranges, slots, dps, dns = [0], [], [], []
    for c in channels:
        moved = keep.get(c)
        if moved is not None:
            dp, dn = targets[c]
            ids = np.where(moved)[0]
            slots.append(slot_of[ids])
            dps.append(dp[ids])
            dns.append(dn[ids])
        ranges.append(ranges[-1] + (0 if moved is None else int(moved.sum())))
    cat = (lambda xs, w: np.concatenate(xs) if xs else np.zeros((0, w)))
    return dict(verts=verts, ranges=ranges, slots=cat(slots, 1).ravel() if slots else np.zeros(0, np.int64),
                dpos=cat(dps, 3), dnor=cat(dns, 3))


def transfer_targets(dst, src, radius=0.02, k=4):
    """Morph deltas for `dst` from the nearest vertices of `src` (e.g. a beard following the jaw)."""
    tree = cKDTree(src['pos'])
    d, nn = tree.query(dst['pos'], k=k)
    w = np.where(d < radius, 1 / np.maximum(d, 1e-4), 0)
    tot = w.sum(1, keepdims=True)
    w = np.where(tot > 0, w / np.maximum(tot, 1e-9), 0)
    out = {}
    for c, (dp, dn) in src['targets'].items():
        tp = (dp[nn] * w[..., None]).sum(1)
        if np.abs(tp).max() > 2e-5:
            out[c] = (tp, (dn[nn] * w[..., None]).sum(1))
    return out


# ---- legacy set (clips, hair) -------------------------------------------------------------------

def legacy_parts(body, names):
    """Reads mesh parts of a legacy `<body>.bin` back into glTF space."""
    info = legacy['bodies'][body]
    blob = open(os.path.join(LEGACY, info['mesh']), 'rb').read()
    out = {}
    for name in names:
        e = info['parts'][name]
        n, ni = e['vertices'], e['indices']
        pos = np.frombuffer(blob, '<f4', n * 3, e['positions']).reshape(n, 3).astype(np.float64)
        nor = np.frombuffer(blob, '<i2', n * 4, e['normals']).reshape(n, 4)[:, :3] / 32767.0
        uv = np.frombuffer(blob, '<f4', n * 2, e['uvs']).reshape(n, 2).astype(np.float64)
        joints = np.frombuffer(blob, np.uint8, n * 4, e['joints']).reshape(n, 4).astype(np.int64)
        weights = np.frombuffer(blob, np.uint8, n * 4, e['weights']).reshape(n, 4) / 255.0
        idx = np.frombuffer(blob, '<u2', ni, e['index']).astype(np.int64)
        out[name] = to_babylon(dict(pos=pos, nor=nor, uv=uv, joints=joints, weights=weights, idx=idx))
    ibm = np.array([mirror_m(np.array(m).reshape(4, 4).T) for m in np.array(info['inverseBind']).reshape(-1, 16)])
    return out, ibm


def legacy_skull(body):
    parts, _ = legacy_parts(body, ['body'])
    b = parts['body']
    lhead = legacy['bones'].index('Head')
    under = [i for i, p in enumerate(legacy['parents']) if p == lhead] + [lhead]
    head_w = (b['weights'] * np.isin(b['joints'], under)).sum(1)
    return skull_box(b['pos'], head_w)


def refit_hair(part, source_skull, target_skull):
    """Hair skinned to the head, moved from the legacy skull onto the new one (per world axis)."""
    (smin, smax), (tmin, tmax) = source_skull, target_skull
    scale = (tmax - tmin) / (smax - smin)
    pos = (part['pos'] - (smax + smin) / 2) * scale + (tmax + tmin) / 2
    nor = part['nor'] / scale
    nor /= np.linalg.norm(nor, axis=1, keepdims=True)
    out = dict(part, pos=pos, nor=nor)
    out['joints'] = np.zeros_like(part['joints'])
    out['joints'][:, 0] = HEAD
    out['weights'] = np.zeros_like(part['weights'], dtype=np.float64)
    out['weights'][:, 0] = 1
    return out


# ---- textures -------------------------------------------------------------------------------

def skin_reference(albedo, body):
    """Median linear colour of the skin (texels inside the body's UV islands)."""
    size = 256
    _, hit = raster_attrs(body, np.ones((len(body['pos']), 1)), size)
    a = np.asarray(albedo.convert('RGB').resize((size, size)), np.float64) / 255
    return np.median(srgb_to_lin(a[hit]), 0)


def aged_skin(young, old, size=1024, sigma=6):
    """The young skin with the old one's small-scale relief (wrinkles, pores) as a luminance ratio."""
    y = np.asarray(young.convert('RGB').resize((size, size), Image.LANCZOS), np.float64) / 255
    o = np.asarray(old.convert('RGB').resize((size, size), Image.LANCZOS), np.float64) / 255
    lum = srgb_to_lin(o) @ [0.2126, 0.7152, 0.0722]
    relief = np.clip(lum / np.maximum(gaussian_filter(lum, sigma), 1e-3), 0.55, 1.25)
    lin = srgb_to_lin(y) * relief[..., None]
    out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, 1) ** (1 / 2.4) - 0.055)
    return Image.fromarray(np.uint8(np.clip(out, 0, 1) * 255), 'RGB')


def card_texture(path):
    """
    A MakeHuman hair texture as greyscale strands (median 0.5 linear, so the hair colour tints it,
    as `hairtex.strands` does for the strand textures) with its alpha (the cards' outline).
    """
    img = Image.open(path).convert('RGBA')
    a = np.asarray(img, np.float64) / 255
    lum = srgb_to_lin(a[..., :3]) @ [0.2126, 0.7152, 0.0722]
    seen = a[..., 3] > 0.5
    lum = lum / max(np.median(lum[seen]) if seen.any() else 0.25, 1e-3) * 0.5
    grey = np.clip(lum, 0, 1) ** (1 / 2.2)
    out = np.stack([grey, grey, grey, a[..., 3]], -1)
    return Image.fromarray(np.uint8(np.clip(out, 0, 1) * 255), 'RGBA')


def save(img, name, size, quality=88):
    img = img.resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, name)
    if name.endswith('.png'):
        img.save(path, optimize=True)
    else:
        img.convert('RGB').save(path, quality=quality, optimize=True, progressive=True)
    return name


# ---- eyes ---------------------------------------------------------------------------------------

def iris_fields(eyes, texture):
    """
    Per eye vertex: (u, v) offset from its iris centre in the texture, the iris radius (UV) and
    1 / the iris' mean linear luminance, so the runtime can tint the iris (eye colour) per pixel.
    """
    img = np.asarray(Image.open(texture).convert('RGB'), np.float64) / 255
    h, w = img.shape[:2]
    lum = img @ [0.2126, 0.7152, 0.0722]
    lin = srgb_to_lin(img) @ [0.2126, 0.7152, 0.0722]
    f = np.zeros((len(eyes['pos']), 4))
    for side in (1, -1):
        sel = eyes['pos'][:, 0] * side > 0
        lo, hi = eyes['uv'][sel].min(0), eyes['uv'][sel].max(0)
        c = (lo + hi) / 2
        ys, xs = np.mgrid[0:h, 0:w]
        u, v = (xs + 0.5) / w, (ys + 0.5) / h
        near = (np.abs(u - c[0]) < (hi[0] - lo[0]) * 0.4) & (np.abs(v - c[1]) < (hi[1] - lo[1]) * 0.4)
        iris = near & (lum < 0.55)
        cu, cv = u[iris].mean(), v[iris].mean()
        r = np.sqrt(iris.sum() / np.pi) / w
        ring = iris & (lum > 0.12)
        f[sel, 0] = eyes['uv'][sel, 0] - cu
        f[sel, 1] = eyes['uv'][sel, 1] - cv
        f[sel, 2] = r
        f[sel, 3] = 1 / max(lin[ring].mean(), 0.02)
        print(f'  iris {side:+d}: centre ({cu:.3f}, {cv:.3f}) radius {r:.3f} linear lum {lin[ring].mean():.3f}')
    return f


# ---- life stages ------------------------------------------------------------------------------

STAGE_SCALE = 5000.0  # int16 position deltas per metre (stage variants)


def write_stage(path, base_parts, stage_parts):
    """A life stage's shape: per part, int16 position deltas from the base (x STAGE_SCALE) and int8 normals."""
    blob = bytearray()
    table = {}
    for name, part in stage_parts.items():
        base = base_parts[name]
        n = len(part['pos'])
        assert n == len(base['pos']), name
        entry = {}

        def add(key, arr):
            nonlocal blob
            while len(blob) % 4:
                blob += b'\0'
            entry[key] = len(blob)
            blob += arr.tobytes()

        d = part['pos'] - base['pos']
        add('positions', np.clip(np.round(np.c_[d, np.zeros(n)] * STAGE_SCALE), -32767, 32767).astype('<i2'))
        nor = part['nor'] / np.maximum(np.linalg.norm(part['nor'], axis=1, keepdims=True), 1e-9)
        add('normals', np.round(np.c_[nor, np.zeros(n)] * 127).astype('i1'))
        table[name] = entry
    open(path, 'wb').write(bytes(blob))
    return table, len(blob)


def follow(base_skin, stage_skin, part, k=4):
    """A garment or beard on a life stage's body: moved with the nearest skin of the base body."""
    tree = cKDTree(base_skin['pos'])
    d, nn = tree.query(part['pos'], k=k)
    w = 1 / np.maximum(d, 1e-4)
    w /= w.sum(1, keepdims=True)
    delta = ((stage_skin['pos'] - base_skin['pos'])[nn] * w[..., None]).sum(1)
    pos = part['pos'] + delta
    return dict(part, pos=pos, nor=smooth_normals(pos, part['idx'], weld_ids(pos)))


def skeleton_entry(name, body):
    pre, post = retarget(name, mirror_q(body.q), mirror_t(body.t))
    ibm = np.array([mirror_m(m) for m in body.ibm])
    return {
        'restT': np.round(mirror_t(body.t), 6).ravel().tolist(),
        'restQ': np.round(mirror_q(body.q), 7).ravel().tolist(),
        # Babylon order (row-major of the row-vector form == glTF column-major).
        'inverseBind': np.round(np.array([m.T.ravel() for m in ibm]), 7).ravel().tolist(),
        'pre': np.round(pre, 7).ravel().tolist(),
        'post': np.round(post, 7).ravel().tolist(),
        'pelvisScale': round(float(body.t[B['pelvis']][2] / src_pelvis_h), 5),
    }


# ---- run -------------------------------------------------------------------------------------

rig = {'version': 3, 'head': HEAD, 'fps': legacy['fps'], 'bodies': {}, 'clips': legacy['clips'], 'fieldScale': FIELD_SCALE}
bodies = {name: Body(name) for name in ('male', 'female')}
channels = [v for v in VISEMES]
for b in bodies.values():
    for c in b.meta['morphs']:
        c = channel_name(c)
        if keep_channel(c) and c not in channels:
            channels.append(c)
CH = {c: i for i, c in enumerate(channels)}
assert all(v in CH for v in VISEMES)

legacy_skulls = {name: legacy_skull(name) for name in ('male', 'female')}
# Quaternius hairstyles (refitted) and MakeHuman's (fitted by MPFB to every body and stage).
HAIR = {'short': 'male', 'long': 'female', 'bun': 'female', 'none': None, 'beard': 'male'}
MH_HAIR = {
    'afro01': 'afro', 'bob02': 'bob', 'braid01': 'braid', 'ponytail01': 'ponytail',
    'short01': 'crop', 'short02': 'tousled', 'short03': 'sideSwept', 'short04': 'layered',
}
BASE_STAGE = 'youngAdult'
STAGES = ['baby', 'child', 'teen', 'adult', 'elder']
GROUPS_ARM = [b for b in BONES if b.startswith(('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'ring', 'pinky', 'thumb'))]
EYES_TEX = None
atlas = Atlas()

for name, body in bodies.items():
    parts_in = body.parts
    skin = parts_in['body']
    dense = dense_weights(skin['joints'], skin['weights'], NBT)
    skin['joints'], skin['weights'] = top4(dense)
    P = {n: body.world[i][:3, 3] for n, i in B.items()}
    lm = Landmarks(P, name)
    arm_w = (skin['weights'] * np.isin(skin['joints'], [B[n] for n in GROUPS_ARM])).sum(1)
    fields = open_head(body_fields(skin, lm, arm_w), skin)
    eye_y = body.W['eye_l'][1, 3]
    scalp = scalp_weights(skin, eye_y)
    skin['fields'] = scalp_fields(fields, skin, scalp)
    print(f'  scalp            verts {(scalp > 0.5).sum()}')
    # A light brown iris (MakeHuman's darker one reads red-black under the warm sun), tinted per Sim.
    tex = {k: v.get('texture') for k, v in body.meta['parts'].items()}
    albedo = clean_scalp(Image.open(tex['body']), skin, scalp, eye_y)
    EYES_TEX = tex['eyes'].replace('brown_eye.png', 'brownlight_eye.png')
    EYES_TEX = EYES_TEX if os.path.exists(EYES_TEX) else tex['eyes']
    parts_in['eyes']['fields'] = iris_fields(parts_in['eyes'], EYES_TEX)
    teeth_of, teeth_tri = clusters(parts_in['teeth'], TEETH_CELL)
    parts = {
        'body': skin, 'eyes': parts_in['eyes'], 'brows': parts_in['eyebrows'], 'lashes': parts_in['eyelashes'],
        'teeth': simplify(parts_in['teeth'], teeth_of, teeth_tri), 'tongue': parts_in['tongue'],
    }
    print(f'  teeth            verts {len(parts_in["teeth"]["pos"])} -> {len(parts["teeth"]["pos"])}')
    mpfb_part = {'eyes': 'eyes', 'brows': 'eyebrows', 'lashes': 'eyelashes', 'teeth': 'teeth', 'tongue': 'tongue', 'body': 'body'}
    for asset, style in MH_HAIR.items():
        parts[f'hair.{style}'] = parts_in[f'hair.{asset}']
        mpfb_part[f'hair.{style}'] = f'hair.{asset}'
    # The low-detail body (MakeHuman's, ~1,600 vertices) for residents far from the camera: the same
    # fields from the same landmarks, so the same cuts hide its skin under its own (coarser) clothes.
    lod = parts_in['lod']
    lod['targets'] = {}
    lod_dense = dense_weights(lod['joints'], lod['weights'], NBT)
    lod['joints'], lod['weights'] = top4(lod_dense)
    lod['fields'] = open_head(body_fields(lod, lm, (lod['weights'] * np.isin(lod['joints'], [B[n] for n in GROUPS_ARM])).sum(1)), lod)
    parts['lod.body'] = lod
    mpfb_part['lod.body'] = 'lod'
    # Garments: MakeHuman's clothes, split into pieces; each one's skin cut fitted to the body
    # vertices its delete group hides.
    hide = skin.pop('hide')
    lod.pop('hide', None)
    items = list(body.meta['clothes'])
    legs = [B[n] for n in BONES if n.startswith(('thigh', 'calf', 'foot', 'ball'))]
    split = {}
    table = {}
    garments = []
    garment_src = {}
    for key, (item, piece, *cutoff) in GARMENTS[name].items():
        kind = key.split('.')[0]
        src = parts_in[f'cloth.{item}']
        if item not in split:
            split[item] = pieces(src, P['pelvis'], legs, skin['pos']) if piece != 'shoes' else {'shoes': np.ones(len(src['pos']), bool)}
            if item not in atlas.cells:
                tint = np.zeros(len(src['pos']), bool) if piece == 'shoes' else np.ones(len(src['pos']), bool)
                flat = split[item]['top'] if item in PLAIN_TOPS else None
                atlas.place(item, item_material(body.meta['clothes'][item]), src, tint, flat)
        keep = split[item][piece]
        if cutoff:
            keep = keep & (src['pos'][:, 1] > lm.knee + cutoff[0] * (lm.hip - lm.knee))
        used, idx = keep_faces(src, keep)
        part = take(src, used, idx)
        part['fields'] = np.tile([1.0, 0.0, CATEGORY[kind], 0.0], (len(used), 1))
        # The skin this piece hides: its item's delete group where the piece is the nearest cloth,
        # and any skin with the piece just outside it (loose sleeves, which the group leaves).
        bit = (hide >> items.index(item)) & 1 > 0
        _, near = cKDTree(src['pos']).query(skin['pos'])
        target = (bit & keep[near]) | covered(skin, part)
        cut, iou, wrong = fit_cut(fields, target, kind)
        if key == 'bottom.skirt':
            # A skirt hangs clear of the legs: hide the thighs down to near its hem, or they show
            # through it as they move.
            cut['leg'] = float(part['pos'][:, 1].min() + 0.04)
            cut['skirt'] = True
        table[key] = {k: (round(float(v), 5) if not isinstance(v, bool) else v) for k, v in cut.items()}
        of, tri = clusters(part, LOD_CLOTH_CELL, uv_cell=0.15)
        lod_part = simplify(part, of, tri)
        part['uv'] = atlas.remap(item, part['uv'])
        lod_part['uv'] = atlas.remap(item, lod_part['uv'])
        parts[key] = part
        parts['lod.' + key] = lod_part
        garments += [key, 'lod.' + key]
        garment_src[key] = (item, used, idx, of, tri)
        print(f'  {key:18s} {item:22s} verts {len(part["pos"]):5d} lod {len(lod_part["pos"]):4d}  cut {table[key]}  iou {iou:.2f} wrongly hidden {wrong}')
    # Hair from the legacy set, refitted to this head.
    target_skull = body.skull(skin)
    legacy_hair = {}
    for style, authored in HAIR.items():
        if style == 'beard' and name != 'male':
            continue
        src_body = authored or name
        hp, _ = legacy_parts(src_body, [f'hair.{style}'])
        legacy_hair[style] = (hp[f'hair.{style}'], legacy_skulls[src_body])
        part = refit_hair(hp[f'hair.{style}'], legacy_skulls[src_body], target_skull)
        part['fields'] = hair_fields(part)
        if style == 'beard':
            part['targets'] = transfer_targets(part, skin)
        parts[f'hair.{style}'] = part
    # The body as chunks (see `body_chunks`); stages split the same way.
    chunks = body_chunks(skin, table)
    chunk_vertices = {}
    del parts['body']
    for key, (mask, hiders) in chunks.items():
        used, part = triangles(skin, mask)
        chunk_vertices[key] = (used, part['idx'])
        parts[key] = part
        print(f'  {key:16s} tris {mask.sum():6d}  hidden by {hiders}')
    for part in parts.values():
        morph = pack_morphs(part, channels)
        if morph:
            part['morph'] = morph
    # Babylon space: the morph deltas mirror like the positions.
    bab = {k: to_babylon(v) for k, v in parts.items()}
    for v in bab.values():
        if 'morph' in v:
            v['morph'] = dict(v['morph'], dpos=mirror_t(v['morph']['dpos']), dnor=mirror_t(v['morph']['dnor']))
    # Hairstyles in files of their own, loaded the first time someone wears one.
    # (Their face morphs stay here: the morph texture is built once, when the set loads.)
    hairs = [k for k in bab if k.startswith('hair.')]
    mesh_table, size = write_parts(os.path.join(OUT, f'{name}.bin'), bab, MORPH_SCALE, NORMAL_SCALE, morph_only=hairs)
    hair_files = {}
    for k in hairs:
        geometry = {kk: vv for kk, vv in bab[k].items() if kk != 'morph'}
        t, hsize = write_parts(os.path.join(OUT, f'{name}.{k}.bin'), {k: geometry})
        hair_files[k] = {'mesh': f'{name}.{k}.bin', 'bytes': hsize, **t[k]}
    for k, v in mesh_table.items():
        if 'morph' in v:
            print(f'  {k:16s} morph verts {v["morph"]["count"]:5d} entries {v["morph"]["ranges"][-1]:6d}')
    height = float(skin['pos'][:, 1].max())

    # Life stages: the same parts reshaped (MPFB fits body, face parts and its hair per stage; the
    # clothes follow the skin; Quaternius hair is refitted to the stage's skull).
    stages = {}
    skins = {}
    for st in STAGES:
        sb = Body(f'{name}.{st}')
        sskin = sb.parts['body']
        sparts = {}
        for key, (used, idx) in chunk_vertices.items():
            sparts[key] = take(sb.parts['body'], used, idx)
        for k, src in mpfb_part.items():
            if k == 'body':
                continue
            sp = sb.parts[src]
            if k == 'teeth':
                assert len(sp['pos']) == len(parts_in['teeth']['pos']), f'{name}.{st}: teeth topology differs'
                sp = simplify(sp, teeth_of, teeth_tri)
            assert len(sp['pos']) == len(parts[k]['pos']), f'{name}.{st}: {k} topology differs'
            assert np.allclose(sp['uv'], parts[k]['uv'], atol=1e-5), f'{name}.{st}: {k} vertex order differs'
            sparts[k] = sp
        for key, (item, used, idx, of, tri) in garment_src.items():
            sp = sb.parts[f'cloth.{item}']
            assert len(sp['pos']) == len(parts_in[f'cloth.{item}']['pos']), f'{name}.{st}: {item} topology differs'
            sparts[key] = take(sp, used, idx)
            sparts['lod.' + key] = simplify(sparts[key], of, tri)
        sskull = sb.skull(sskin)
        for style, (hp, lskull) in legacy_hair.items():
            if style == 'beard':
                sparts['hair.beard'] = follow(skin, sskin, parts['hair.beard'])
            else:
                sparts[f'hair.{style}'] = refit_hair(hp, lskull, sskull)
        sbab = {k: to_babylon(v) for k, v in sparts.items()}
        stable, ssize = write_stage(os.path.join(OUT, f'{name}.{st}.bin'), bab, sbab)
        sheight = float(sskin['pos'][:, 1].max())
        stages[st] = dict(mesh=f'{name}.{st}.bin', bytes=ssize, parts=stable, height=round(sheight, 4), headTop=round(sheight, 4), **skeleton_entry(name, sb))
        # Its own skin when MakeHuman's differs at this age (middle-aged, old): their wrinkles on the
        # young skin's colour (their own blotches and age spots read orange once tinted).
        stex = sb.meta['parts']['body']['texture']
        if stex != body.meta['parts']['body']['texture']:
            if stex not in skins:
                simg = aged_skin(albedo, clean_scalp(Image.open(stex), skin, scalp, eye_y))
                skins[stex] = (save(simg, f'{name}.{st}_albedo.jpg', 1024), skin_reference(simg, skin))
            stages[st]['textures'] = {'albedo': skins[stex][0]}
            stages[st]['skinRef'] = np.round(skins[stex][1], 5).tolist()
        print(f'  stage {st:6s} height {sheight:.3f} bytes {ssize} pelvisScale {stages[st]["pelvisScale"]:.3f}')

    # Textures: MakeHuman skin (CC0).
    ref = skin_reference(albedo, skin)
    textures = {'albedo': save(albedo, f'{name}_albedo.jpg', 1024)}
    textures['brows'] = save(Image.open(tex['eyebrows']).convert('RGBA'), f'{name}_brows.png', 256)
    rig['bodies'][name] = {
        'mesh': f'{name}.bin',
        'bytes': size,
        'parts': mesh_table,
        'height': round(height, 4),
        **skeleton_entry(name, body),
        'skinRef': np.round(ref, 5).tolist(),
        'headTop': round(height, 4),
        'textures': textures,
        'garments': table,
        'lazyParts': hair_files,
        'bodyChunks': {key: hiders for key, (_, hiders) in chunks.items()},
        'stage': BASE_STAGE,
        'stages': stages,
    }
    err = np.abs(np.einsum('nij,njk->nik', body.world, body.ibm) - np.eye(4)).max()
    print(name, 'mesh bytes', size, 'height %.3f' % height, 'skinRef', np.round(ref, 4), 'pelvisScale %.3f' % rig['bodies'][name]['pelvisScale'], 'rest*ibm err %.1e' % err)

# Shared textures: MakeHuman eyes, lashes, teeth, tongue and hair cards; the legacy hair strands and fabric.
tex = {k: v.get('texture') for k, v in bodies['female'].meta['parts'].items()}
save(Image.open(EYES_TEX).convert('RGB'), 'eye_albedo.jpg', 512, 92)
save(Image.open(tex['eyelashes']).convert('RGBA'), 'lashes.png', 256)
save(Image.open(tex['teeth']).convert('RGB'), 'teeth.jpg', 256)
save(Image.open(tex['tongue']).convert('RGB'), 'tongue.jpg', 128)
hair_cards = {}
for asset, style in MH_HAIR.items():
    img = card_texture(tex[f'hair.{asset}'])
    hair_cards[style] = save(img, f'hair_{style}.png', 1024)
cloth_albedo, cloth_normal = atlas.images()
cloth_albedo.save(os.path.join(OUT, 'cloth_albedo.jpg'), quality=88, optimize=True, progressive=True)
cloth_normal.save(os.path.join(OUT, 'cloth_normal.jpg'), quality=90, optimize=True, progressive=True)
print('cloth atlas', atlas.cells)
for f in ('anims.bin', 'hair1_albedo.jpg', 'hair1_normal.jpg', 'hair2_albedo.jpg', 'hair2_normal.jpg'):
    if os.path.abspath(os.path.join(LEGACY, f)) != os.path.abspath(os.path.join(OUT, f)):
        shutil.copyfile(os.path.join(LEGACY, f), os.path.join(OUT, f))
rig['bones'] = ALL_BONES
rig['parents'] = ALL_PARENTS
rig['face'] = {'bones': FACE_BONES}
rig['morphs'] = {'channels': channels, 'scale': MORPH_SCALE, 'normalScale': NORMAL_SCALE}
rig['stageScale'] = STAGE_SCALE
rig['textures'] = {'eyes': 'eye_albedo.jpg', 'lashes': 'lashes.png', 'teeth': 'teeth.jpg', 'tongue': 'tongue.jpg'}
rig['cloth'] = {'albedo': 'cloth_albedo.jpg', 'normal': 'cloth_normal.jpg'}
rig['hairTextures'] = legacy['hairTextures']
rig['hairCards'] = hair_cards
rig['anims'] = 'anims.bin'
rig['clipBones'] = NB0
rig['sourcePelvis'] = legacy['sourcePelvis']
rig['sourceRestQ'] = np.round(src_rest_q, 7).ravel().tolist()
json.dump(rig, open(os.path.join(OUT, 'rig.json'), 'w'), separators=(',', ':'))
print('channels', len(channels), channels)
