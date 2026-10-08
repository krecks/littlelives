"""
Builds the Sim character assets in `web/public/assets/characters/` from CC0 sources by Quaternius:

- Universal Base Characters [Standard] (bodies, faces, hairstyles): https://quaternius.itch.io/universal-base-characters
- Universal Animation Library [Standard] and Universal Animation Library 2 [Standard]:
  https://quaternius.itch.io/universal-animation-library, https://quaternius.itch.io/universal-animation-library-2

Usage: python3 -I tools/characters/build.py <downloads dir> <output dir>
where <downloads dir> holds the three unzipped packs (folders `Universal Base Characters[Standard]`,
`Universal Animation Library[Standard]`, `Universal Animation Library 2[Standard]`, searched recursively).

Output (all little-endian):
- `rig.json`: skeleton, per-body rest pose / inverse binds / retarget constants, mesh part table, clip table.
- `<body>.bin`: mesh parts in Babylon's left-handed space (glTF mirrored in x): body, eyes, brows,
  eyelids, hairstyles and clothes (`top.*`, `bottom.*`, `shoes.*`; see garments.py).
- `anims.bin`: clips as int16 quaternions (source-skeleton local rotations) plus pelvis translations.
- Textures (albedo / normal / cloth folds per body, strand hair, eyes, fabric weave).

The bodies get a warm, stylised-realistic look (slimmer than the superhero sources, a slightly
bigger head and bigger eyes; softer muscle detail) and get a face rig: extra bones under the head (eyes,
lids, jaw, lip corners, brows) with generated eyelids (face.py).

Animations are retargeted at runtime: target local = pre[b] * source local * post[b] (world-space
rest-pose delta), so one animation set drives both bodies.
"""

import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from face import FACE_BONES, LOWER_OPEN, UPPER_OPEN, face_rig, make_lids, stylise  # noqa: E402
from garments import Landmarks, body_fields, shell, skirt, variants  # noqa: E402
from gltfio import Gltf  # noqa: E402
from hairtex import strands  # noqa: E402
from meshops import boundary_edges, geodesic_from, top4, weld_ids  # noqa: E402

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def find(name):
    for root, _dirs, files in os.walk(SRC):
        if name in files and 'Unity' not in root and 'FBX' not in root:
            return os.path.join(root, name)
    raise FileNotFoundError(name)


def find_in(sub, name):
    for root, _dirs, files in os.walk(SRC):
        if name in files and sub in root:
            return os.path.join(root, name)
    raise FileNotFoundError(f'{sub}/{name}')


# ---- math ---------------------------------------------------------------------------------

def qmul(a, b):
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], -1)


def qinv(q):
    return q * np.array([-1, -1, -1, 1.0])


def qmat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def trs(t, q, s):
    m = np.eye(4)
    m[:3, :3] = qmat(q) * np.asarray(s)[None, :]
    m[:3, 3] = t
    return m


S = np.diag([-1.0, 1, 1, 1])


def mirror_q(q):
    q = np.array(q, dtype=np.float64)
    q[..., 1] *= -1
    q[..., 2] *= -1
    return q


def mirror_t(t):
    t = np.array(t, dtype=np.float64)
    t[..., 0] *= -1
    return t


def mirror_m(m):
    return S @ m @ S


# ---- skeleton -------------------------------------------------------------------------------

class Skeleton:
    """Joint rest pose of a glTF skin, in glTF space."""

    def __init__(self, g: Gltf):
        j = g.j
        self.g = g
        skin = j['skins'][0]
        self.nodes = skin['joints']
        self.names = [j['nodes'][k]['name'] for k in self.nodes]
        parent_of = {}
        for i, n in enumerate(j['nodes']):
            for c in n.get('children', []):
                parent_of[c] = i
        self.parent_node = parent_of
        self.parents = []
        for k in self.nodes:
            p = parent_of.get(k)
            self.parents.append(self.nodes.index(p) if p in self.nodes else -1)
        self.t = np.array([j['nodes'][k].get('translation', [0, 0, 0]) for k in self.nodes], np.float64)
        self.q = np.array([j['nodes'][k].get('rotation', [0, 0, 0, 1]) for k in self.nodes], np.float64)
        self.s = np.array([j['nodes'][k].get('scale', [1, 1, 1]) for k in self.nodes], np.float64)
        self.ibm = g.acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1).astype(np.float64)
        # Transform above the root joint (Armature node etc.).
        self.above = np.eye(4)
        k = parent_of.get(self.nodes[0])
        chain = []
        while k is not None:
            chain.append(k)
            k = parent_of.get(k)
        for k in reversed(chain):
            n = j['nodes'][k]
            self.above = self.above @ trs(n.get('translation', [0, 0, 0]), n.get('rotation', [0, 0, 0, 1]), n.get('scale', [1, 1, 1]))

    def world(self, t=None, q=None):
        t = self.t if t is None else t
        q = self.q if q is None else q
        out = np.zeros((len(self.nodes), 4, 4))
        for i, p in enumerate(self.parents):
            local = trs(t[i], q[i], self.s[i])
            out[i] = (out[p] if p >= 0 else self.above) @ local
        return out

    def world_q(self, q):
        """World rotations (quaternions) of a set of local rotations (no scale above the root assumed)."""
        out = np.zeros_like(q)
        for i, p in enumerate(self.parents):
            out[i] = qmul(out[p], q[i]) if p >= 0 else q[i]
        return out


def load(path):
    return Gltf(path)


male_g = load(find('Superhero_Male_FullBody.gltf'))
female_g = load(find('Superhero_Female_FullBody.gltf'))
ual1 = load(find('UAL1_Standard.glb'))
ual2 = load(find('UAL2_Standard.glb'))

sk_m, sk_f, sk_s = Skeleton(male_g), Skeleton(female_g), Skeleton(ual1)
assert sk_m.names == sk_f.names == sk_s.names == Skeleton(ual2).names
BONES = sk_m.names
PARENTS = sk_m.parents
NB = len(BONES)
B = {n: i for i, n in enumerate(BONES)}
HEAD = B['Head']

for sk, nm in ((sk_m, 'male'), (sk_f, 'female')):
    err = np.abs(np.einsum('nij,njk->nik', sk.world(), sk.ibm) - np.eye(4)).max()
    print(f'{nm}: rest * ibm error {err:.2e}')

# ---- retarget constants (mirrored space) ------------------------------------------------

src_world_q = Skeleton.world_q(sk_s, mirror_q(sk_s.q))


def retarget(sk):
    tw = Skeleton.world_q(sk, mirror_q(sk.q))
    C = qmul(qinv(src_world_q), tw)
    pre = np.array([qinv(C[p]) if p >= 0 else [0, 0, 0, 1.0] for p in PARENTS])
    post = C
    return pre, post


# ---- meshes ----------------------------------------------------------------------------------

def prim_arrays(g, mesh_name=None, index=0):
    meshes = g.j['meshes']
    m = [x for x in meshes if x['name'] == mesh_name][0] if mesh_name else meshes[index]
    p = m['primitives'][0]
    a = p['attributes']
    pos = g.acc(a['POSITION']).astype(np.float64)
    nor = g.acc(a['NORMAL']).astype(np.float64)
    uv = g.acc(a['TEXCOORD_0']).astype(np.float64)
    jo = g.acc(a['JOINTS_0']).astype(np.int64)
    we = g.acc(a['WEIGHTS_0']).astype(np.float64)
    idx = g.acc(p['indices']).ravel().astype(np.int64)
    return dict(pos=pos, nor=nor, uv=uv, joints=jo, weights=we, idx=idx, material=p.get('material'))


def to_babylon(part):
    """
    Mirror x (glTF right-handed -> Babylon left-handed, facing +z). The reflection also turns
    glTF's counter-clockwise front faces into Babylon's clockwise ones, so the index order stays.
    """
    out = dict(part)
    out['pos'] = mirror_t(part['pos'])
    out['nor'] = mirror_t(part['nor'])
    return out


def head_dims(sk, body):
    w = body['weights']
    j = body['joints']
    head_w = (w * (j == HEAD)).sum(1)
    pts = body['pos'][head_w > 0.95]
    ph = (sk.ibm[HEAD] @ np.c_[pts, np.ones(len(pts))].T).T[:, :3]
    return ph.min(0), ph.max(0)


def hair_part(path, target_sk, target_dims, source_dims):
    g = load(path)
    hsk = Skeleton(g)
    part = prim_arrays(g)
    p = np.c_[part['pos'], np.ones(len(part['pos']))]
    local = (hsk.ibm[HEAD] @ p.T).T[:, :3]
    # Fit the source head to the target head (per axis, about the head joint).
    (smin, smax), (tmin, tmax) = source_dims, target_dims
    scale = (tmax - tmin) / (smax - smin)
    centre_s = (smax + smin) / 2
    centre_t = (tmax + tmin) / 2
    local = (local - centre_s) * scale + centre_t
    bind = np.linalg.inv(target_sk.ibm[HEAD])
    pos = (bind @ np.c_[local, np.ones(len(local))].T).T[:, :3]
    rot = bind[:3, :3] @ hsk.ibm[HEAD][:3, :3]
    nor = part['nor'] @ rot.T
    nor /= np.linalg.norm(nor, axis=1, keepdims=True)
    part['pos'], part['nor'] = pos, nor
    part['joints'] = np.zeros_like(part['joints'])
    part['joints'][:, 0] = HEAD
    part['weights'] = np.zeros_like(part['weights'])
    part['weights'][:, 0] = 1
    return part


FIELD_SCALE = 4000.0


def write_parts(path, parts):
    """
    Each part: positions f32x3, normals i16x4 (w unused), uv f32x2, joints u8x4, weights u8x4,
    fields i16x4 (value * FIELD_SCALE; see garments.py / hair tips), indices u16.
    """
    blob = bytearray()
    table = {}
    for name, part in parts.items():
        n = len(part['pos'])
        assert n < 65536, name
        w = part['weights']
        w = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
        wq = np.round(w * 255).astype(np.int64)
        # Make the quantised weights sum to exactly 255.
        wq[np.arange(n), np.argmax(wq, 1)] += 255 - wq.sum(1)
        nor = part['nor'] / np.maximum(np.linalg.norm(part['nor'], axis=1, keepdims=True), 1e-9)
        entry = {'vertices': n, 'indices': len(part['idx'])}

        def add(key, arr):
            nonlocal blob
            while len(blob) % 4:
                blob += b'\0'
            entry[key] = len(blob)
            blob += arr.tobytes()

        add('positions', part['pos'].astype('<f4'))
        add('normals', np.c_[np.round(nor * 32767), np.zeros(n)].astype('<i2'))
        add('uvs', part['uv'].astype('<f4'))
        add('joints', part['joints'].astype(np.uint8))
        add('weights', wq.astype(np.uint8))
        f = part.get('fields')
        f = np.zeros((n, 4)) if f is None else np.asarray(f, np.float64)
        add('fields', np.clip(np.round(f * FIELD_SCALE), -32767, 32767).astype('<i2'))
        add('index', part['idx'].astype('<u2'))
        lo, hi = part['pos'].min(0), part['pos'].max(0)
        entry['min'] = np.round(lo, 4).tolist()
        entry['max'] = np.round(hi, 4).tolist()
        table[name] = entry
    open(path, 'wb').write(bytes(blob))
    return table, len(blob)


# ---- body shape -------------------------------------------------------------------------------

# The source bodies have superhero builds; Sims are ordinary people. Each vertex is pulled
# towards the axis of the bones that move it (bone -> child joint), blended by its skin weights,
# so muscles shrink while the skeleton (and every animation) stays the same.
SEGMENTS = {
    'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01', 'neck_01': 'Head',
    'clavicle_l': 'upperarm_l', 'upperarm_l': 'lowerarm_l', 'lowerarm_l': 'hand_l',
    'clavicle_r': 'upperarm_r', 'upperarm_r': 'lowerarm_r', 'lowerarm_r': 'hand_r',
    'thigh_l': 'calf_l', 'calf_l': 'foot_l', 'thigh_r': 'calf_r', 'calf_r': 'foot_r',
}
SLIM = {
    'male': {'clavicle': 0.74, 'upperarm': 0.76, 'lowerarm': 0.84, 'spine_03': 0.85, 'spine_02': 0.89, 'spine_01': 0.94, 'neck': 0.9, 'thigh': 0.9, 'calf': 0.9},
    'female': {'clavicle': 0.86, 'upperarm': 0.84, 'lowerarm': 0.9, 'spine_03': 0.9, 'spine_02': 0.94, 'spine_01': 0.97, 'neck': 0.93, 'thigh': 0.94, 'calf': 0.93},
}


SLIM_X = {
    'male': {'spine_03': 0.9, 'spine_02': 0.94, 'clavicle': 0.92},
    'female': {'spine_03': 0.96},
}


def slim(sk, part, gender):
    world = sk.world()
    P = {n: world[B[n]][:3, 3] for n in BONES}
    pos = part['pos']
    out = np.zeros_like(pos)
    for slot in range(part['joints'].shape[1]):
        j = part['joints'][:, slot]
        w = part['weights'][:, slot]
        moved = pos.copy()
        for name, child in SEGMENTS.items():
            key = next((k for k in SLIM[gender] if name.startswith(k)), None)
            if key is None:
                continue
            sel = j == B[name]
            if not sel.any():
                continue
            a, b = P[name], P[child]
            ab = b - a
            t = np.clip(((pos[sel] - a) @ ab) / (ab @ ab), 0, 1)
            c = a + t[:, None] * ab
            # Narrower sideways than front-to-back on the upper torso (less of a superhero V).
            fx = SLIM_X[gender].get(key, 1.0)
            moved[sel] = c + (pos[sel] - c) * SLIM[gender][key] * np.array([fx, 1.0, 1.0])
        out += w[:, None] * moved
    tot = part['weights'].sum(1, keepdims=True)
    out = np.where(tot > 1e-6, out / np.maximum(tot, 1e-6), pos)
    part = dict(part)
    part['pos'] = out
    return part


# ---- textures -------------------------------------------------------------------------------

def save_jpg(img, name, size, quality=88, mode='RGB'):
    img.convert(mode).resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), quality=quality, optimize=True, progressive=True)


def srgb_to_lin(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def skin_reference(albedo, roughness):
    a = np.asarray(albedo.convert('RGB').resize((512, 512)), np.float64) / 255
    r = np.asarray(roughness.convert('RGB').resize((512, 512)), np.float64) / 255
    skin = r[..., 1] < 0.9  # underwear is white in the roughness map
    lin = srgb_to_lin(a[skin])
    return np.median(lin, 0)


# ---- clips ------------------------------------------------------------------------------------

CLIPS = [
    # key, source, animation, loop
    ('idle', ual1, 'Idle_Loop', True),
    ('talk', ual1, 'Idle_Talking_Loop', True),
    ('walk', ual1, 'Walk_Loop', True),
    ('jog', ual1, 'Jog_Fwd_Loop', True),
    ('sit', ual1, 'Sitting_Idle_Loop', True),
    ('sitTalk', ual1, 'Sitting_Talking_Loop', True),
    ('sitDown', ual1, 'Sitting_Enter', False),
    ('standUp', ual1, 'Sitting_Exit', False),
    ('sitHands', ual1, 'Driving_Loop', True),
    ('interact', ual1, 'Interact', False),
    ('pickUp', ual1, 'PickUp_Table', False),
    ('dance', ual1, 'Dance_Loop', True),
    ('punchJab', ual1, 'Punch_Jab', False),
    ('punchCross', ual1, 'Punch_Cross', False),
    ('hit', ual1, 'Hit_Chest', False),
    ('kneel', ual1, 'Fixing_Kneeling', True),
    ('crouch', ual1, 'Crouch_Idle_Loop', True),
    ('death', ual1, 'Death01', False),
    ('eat', ual2, 'Consume', False),
    ('water', ual2, 'Farm_Watering', True),
    ('harvest', ual2, 'Farm_Harvest', True),
    ('foldArms', ual2, 'Idle_FoldArms_Loop', True),
    ('no', ual2, 'Idle_No_Loop', True),
    ('yes', ual2, 'Yes', False),
    ('layToIdle', ual2, 'LayToIdle', False),
    ('phone', ual2, 'Idle_TalkingPhone_Loop', True),
    ('open', ual2, 'Chest_Open', False),
    ('rail', ual2, 'Idle_Rail_Loop', True),
    # Hands busy in front of the body (cooking, washing up, typing standing, painting).
    ('spell', ual1, 'Spell_Simple_Idle_Loop', True),
    ('push', ual1, 'Push_Loop', True),
    ('plant', ual2, 'Farm_PlantSeed', False),
    ('lantern', ual2, 'Idle_Lantern_Loop', True),
    ('chop', ual2, 'TreeChopping_Loop', True),
]
FPS = 30


def sample_clip(g, anim_name):
    j = g.j
    anim = [a for a in j['animations'] if a['name'] == anim_name][0]
    sk = Skeleton(g)
    node_to_bone = {k: i for i, k in enumerate(sk.nodes)}
    duration = max(g.acc(s['input']).max() for s in anim['samplers'])
    n = int(round(duration * FPS)) + 1
    times = np.arange(n) / FPS
    q = np.tile(sk.q, (n, 1, 1))
    t = np.tile(sk.t, (n, 1, 1))
    for c in anim['channels']:
        b = node_to_bone.get(c['target']['node'])
        if b is None:
            continue
        s = anim['samplers'][c['sampler']]
        ti = g.acc(s['input']).ravel()
        v = g.acc(s['output']).astype(np.float64)
        if c['target']['path'] == 'rotation':
            for k in range(v.shape[1]):
                q[:, b, k] = np.interp(times, ti, v[:, k])
            q[:, b] /= np.linalg.norm(q[:, b], axis=1, keepdims=True)
        elif c['target']['path'] == 'translation':
            for k in range(3):
                t[:, b, k] = np.interp(times, ti, v[:, k])
    return q, t, sk


def stride_speed(q, t, sk):
    """Ground speed (m/s, source scale) of the planted foot in an in-place walk cycle."""
    feet = []
    for f in ('ball_l', 'ball_r'):
        ys, zs = [], []
        for i in range(len(q)):
            w = sk.world(t[i], q[i])
            p = w[B[f]][:3, 3]
            ys.append(p[1]); zs.append(p[2])
        ys, zs = np.array(ys), np.array(zs)
        low = ys < np.percentile(ys, 35)
        v = -np.diff(zs) * FPS
        feet.append(np.median(v[low[:-1]]))
    return float(np.mean(feet))


# ---- rasterising (UV space) -------------------------------------------------------------------

def raster_attrs(part, attrs, size):
    """Interpolates per-vertex `attrs` (n, k) over the UV layout; returns (size, size, k) and a hit mask."""
    tri = part['idx'].reshape(-1, 3)
    H = W = size
    acc = np.zeros((H, W, attrs.shape[1]))
    hit = np.zeros((H, W), bool)
    pix = part['uv'] * [W, H]
    for t in tri:
        a, b, c = pix[t]
        xmin = max(int(np.floor(min(a[0], b[0], c[0]))), 0); xmax = min(int(np.ceil(max(a[0], b[0], c[0]))), W - 1)
        ymin = max(int(np.floor(min(a[1], b[1], c[1]))), 0); ymax = min(int(np.ceil(max(a[1], b[1], c[1]))), H - 1)
        if xmax < xmin or ymax < ymin:
            continue
        xs, ys = np.meshgrid(np.arange(xmin, xmax + 1) + 0.5, np.arange(ymin, ymax + 1) + 0.5)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        l3 = 1 - l1 - l2
        inside = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        if not inside.any():
            continue
        v = l1[..., None] * attrs[t[0]] + l2[..., None] * attrs[t[1]] + l3[..., None] * attrs[t[2]]
        yy, xx = ys[inside].astype(int), xs[inside].astype(int)
        acc[yy, xx] = v[inside]
        hit[yy, xx] = True
    return acc, hit


def pad_islands(img, hit, steps=8):
    filled = hit.copy()
    for _ in range(steps):
        grown = img.copy()
        newf = filled.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh_img = np.roll(img, (dy, dx), (0, 1))
            sh_f = np.roll(filled, (dy, dx), (0, 1))
            take = sh_f & ~newf
            grown[take] = sh_img[take]
            newf |= take
        img, filled = grown, newf
    return img


def bake_folds(body, fields, lm, size, seed):
    """
    Tangent-space normal map of soft cloth folds in the body's UV layout (used by every garment
    cut from the body): rings at the elbows, knees and ankles, bunching above the waist, diagonal
    drape from the armpits and the crotch, plus a low wrinkle noise. Heights come from the body's 3D
    fields, so they are continuous across UV seams.
    """
    rng = np.random.default_rng(seed)
    pos = body['pos']
    attrs = np.c_[pos, fields[:, 0]]
    acc, hit = raster_attrs(body, attrs, size)
    x, y, z, sl = [acc[..., i] for i in range(4)]
    ax = np.abs(x)
    noise = gaussian_filter(rng.standard_normal((size, size)), 3)
    noise /= noise.std() + 1e-9
    te = np.linalg.norm(lm.el - lm.sh) / np.linalg.norm(lm.wr - lm.sh)
    L = np.linalg.norm(lm.wr - lm.sh)
    arm = sl > -0.2
    h = np.zeros((size, size))
    # Elbow rings (strongest on the inside of the elbow) and sleeve-end bunching.
    h += arm * np.exp(-((sl - te) / 0.11) ** 2) * np.sin(2 * np.pi * sl * L / 0.021 + 1.5 * noise) * 1.0
    h += arm * np.exp(-((sl - 0.9) / 0.06) ** 2) * np.sin(2 * np.pi * sl * L / 0.017 + noise) * 0.6
    leg = (~arm) & (y < lm.hip)
    h += leg * np.exp(-((y - lm.knee) / 0.07) ** 2) * np.sin(2 * np.pi * y / 0.024 + 1.5 * noise + ax * 30) * 1.0
    h += leg * np.exp(-((y - lm.ankle - 0.07) / 0.05) ** 2) * np.sin(2 * np.pi * y / 0.02 + noise) * 0.8
    torso = (~arm) & (y >= lm.hip)
    h += torso * np.exp(-((y - lm.waist - 0.05) / 0.045) ** 2) * np.sin(2 * np.pi * y / 0.028 + 2 * noise) * 0.55
    # Diagonal drape from the armpits down the sides, and from the crotch along the thighs.
    h += torso * smoothstep(lm.waist, lm.waist + 0.25, y) * smoothstep(0.05, 0.14, ax) * np.sin(2 * np.pi * (y + 0.7 * ax) / 0.06 + noise) * 0.35
    h += smoothstep(lm.hip - 0.18, lm.hip - 0.02, y) * smoothstep(lm.hip + 0.03, lm.hip - 0.02, y) * np.sin(2 * np.pi * (y - 1.3 * ax) / 0.032 + noise) * 0.5
    h += noise * 0.1
    h = np.where(hit, h, 0)
    h = gaussian_filter(h, 1.2)
    k = 0.9
    gy, gx = np.gradient(h)
    n = np.stack([-gx * k, gy * k, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    img = pad_islands(np.clip(n * 0.5 + 0.5, 0, 1), hit)
    img[~hit & ~pad_islands(hit[..., None].astype(float), hit)[..., 0].astype(bool)] = [0.5, 0.5, 1.0]
    return Image.fromarray(np.uint8(img * 255))


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def soften_normal(normal_img, body, head_w, size):
    """Flattens the source's superhero muscle relief on the body; the face keeps its detail."""
    nm = np.asarray(normal_img.convert('RGB').resize((size, size), Image.LANCZOS), np.float64) / 255 * 2 - 1
    acc, hit = raster_attrs(body, head_w[:, None], size)
    hw = gaussian_filter(np.where(hit, acc[..., 0], 0.0), 3)
    blur = np.stack([gaussian_filter(nm[..., i], 2.5) for i in range(3)], -1)
    keep = 0.4 + 0.6 * hw[..., None]
    xy = blur[..., :2] * (1 - hw[..., None]) + nm[..., :2] * hw[..., None]
    xy = xy * keep
    z = np.sqrt(np.clip(1 - (xy ** 2).sum(-1), 0.05, 1))
    out = np.concatenate([xy, z[..., None]], -1)
    return Image.fromarray(np.uint8(np.clip(out * 0.5 + 0.5, 0, 1) * 255))


# ---- face bones -----------------------------------------------------------------------------

NB0 = NB
FACE_INDEX = {n: NB0 + i for i, n in enumerate(FACE_BONES)}
NBT = NB0 + len(FACE_BONES)


def extend_skeleton(sk, pivots):
    """Appends the face bones (children of the head, same orientation as the head at rest)."""
    world = sk.world()
    Hw = world[HEAD]
    R = Hw[:3, :3]
    ts, qs, ss, ibms = [], [], [], []
    for name in FACE_BONES:
        p = np.asarray(pivots[name] if pivots else Hw[:3, 3], np.float64)
        ts.append(R.T @ (p - Hw[:3, 3]))
        qs.append([0, 0, 0, 1.0])
        ss.append([1, 1, 1.0])
        W = np.eye(4)
        W[:3, :3] = R
        W[:3, 3] = p
        ibms.append(np.linalg.inv(W))
    sk.names = sk.names + FACE_BONES
    sk.parents = sk.parents + [HEAD] * len(FACE_BONES)
    sk.t = np.concatenate([sk.t, np.array(ts)])
    sk.q = np.concatenate([sk.q, np.array(qs)])
    sk.s = np.concatenate([sk.s, np.array(ss)])
    sk.ibm = np.concatenate([sk.ibm, np.array(ibms)])


# ---- run -------------------------------------------------------------------------------------

rig = {'version': 2, 'head': HEAD, 'fps': FPS, 'bodies': {}, 'clips': {}, 'fieldScale': FIELD_SCALE}
src_pelvis_h = sk_s.t[B['pelvis']][2]

bodies = {
    'male': dict(g=male_g, sk=sk_m, body='Sphere.005_Retopology.004', eyes='Face.001', brows='Face',
                 albedo='T_Superhero_Male_Dark.png', normal='T_Superhero_Male_Normal.png', rough='T_Superhero_Male_Roughness.png'),
    'female': dict(g=female_g, sk=sk_f, body='Superhero_Female', eyes='Eyes', brows='Eyebrows',
                   albedo='T_Superhero_Female_Dark_BaseColor.png', normal='T_Superhero_Female_Normal.png', rough='T_Superhero_Female_Roughness.png'),
}

# 1. Slim + stylise every body first (hair is fitted to the stylised heads).
state = {}
src_dims = {}
for name, cfg in bodies.items():
    sk, g = cfg['sk'], cfg['g']
    body = slim(sk, prim_arrays(g, cfg['body']), name)
    eyes = prim_arrays(g, cfg['eyes'])
    brows = prim_arrays(g, cfg['brows'])
    H = sk.world()[HEAD][:3, 3]
    head_w = (body['weights'] * (body['joints'] == HEAD)).sum(1)
    # The hairstyles were authored on the original heads: measure them before stylising.
    src_dims[name] = head_dims(sk, body)
    eye_c = stylise(body, eyes, brows, H, head_w)
    state[name] = dict(body=body, eyes=eyes, brows=brows, H=H, head_w=head_w, eye_c=eye_c)
    print(name, 'eyes', {k: (np.round(c, 4).tolist(), round(r, 4)) for k, (c, r) in eye_c.items()})
dims = {k: head_dims(bodies[k]['sk'], v['body']) for k, v in state.items()}

HAIR_DIR = 'Rigged to Head Bone'
hair_files = {
    'short': ('Hair_SimpleParted.gltf', 'male'),
    'long': ('Hair_Long.gltf', 'female'),
    'bun': ('Hair_Buns.gltf', 'female'),
    'none': {'male': ('Hair_Buzzed.gltf', 'male'), 'female': ('Hair_BuzzedFemale.gltf', 'female')},
    'beard': ('Hair_Beard.gltf', 'male'),
}


def hair_fields(part):
    """fields.x = distance (m) from the hair's open edges (strand tips are cut there)."""
    weld = weld_ids(part['pos'])
    be = boundary_edges(weld[part['idx'].reshape(-1, 3)].ravel())
    rep = {}
    for k, w in enumerate(weld):
        rep.setdefault(w, k)
    on_edge = np.zeros(weld.max() + 1, bool)
    on_edge[be.ravel()] = True
    # Only the ends (fringe, nape, long tips) get ragged strand tips; open edges of clumps over the
    # crown and against the scalp stay solid. Ends: open edges low on the head or facing down/out.
    pos, nor = part['pos'], part['nor']
    top = pos[:, 1].max()
    low = pos[:, 1] < top - 0.09
    seeds = np.where(on_edge[weld] & low)[0]
    d = geodesic_from(seeds, pos, part['idx'], 0.1)
    f = np.zeros((len(pos), 4))
    f[:, 0] = np.where(low | (d < 0.1), d, 0.1)
    f[:, 0] = np.maximum(f[:, 0], 0.1 * (1 - low))
    return f


base_dir = os.path.dirname(find('Superhero_Male_FullBody.gltf'))
GROUPS_ARM = [b for b in BONES if b.startswith(('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'ring', 'pinky', 'thumb'))]
garment_table = {}
skel_done = False
for name, cfg in bodies.items():
    sk, g = cfg['sk'], cfg['g']
    st = state[name]
    body, eyes, brows = st['body'], st['eyes'], st['brows']
    # 2. Face rig (pivots + weights) and eyelids.
    fr = face_rig(body, eyes, brows, st['eye_c'], st['H'], HEAD, FACE_INDEX, NBT)
    print(name, 'mouth y %.4f front %.4f back %.4f corners %s' % (fr['mouth']['y'], fr['mouth']['front'], fr['mouth']['back'],
          {k: np.round(v, 4).tolist() for k, v in fr['mouth']['corners'].items()}))
    lids = make_lids(body, st['eye_c'], FACE_INDEX, NBT)
    for part, dense in ((body, fr['body']), (eyes, fr['eyes']), (brows, fr['brows']), (lids, lids['dense'])):
        part['joints'], part['weights'] = top4(dense)
    # Lid fields: x = v from the margin (0) to the far edge (1), +2 on lower lids (fainter lashes).
    lower = np.zeros(len(lids['uv']))
    lower[np.isin(lids['joints'][:, 0], [FACE_INDEX['lidL_l'], FACE_INDEX['lidL_r']])] = 2
    lids['fields'] = np.c_[lids['uv'][:, 1] + lower, np.zeros((len(lids['uv']), 3))]
    body_dense = fr['body']
    # 3. Clothes from the stylised body.
    world = sk.world()
    P = {n: world[i][:3, 3] for n, i in B.items()}
    lm = Landmarks(P, name)
    arm_ids = [B[n] for n in GROUPS_ARM]
    arm_w = (body['weights'] * np.isin(body['joints'], arm_ids)).sum(1)
    fields = body_fields(body, lm, arm_w)
    # Inside of the mouth: sleeve field -3 (the shader darkens it; still "torso" for clothes).
    fields[fr['mouth']['inner'], 0] = -3.0
    body['fields'] = fields
    parts = {'body': body, 'eyes': eyes, 'brows': brows, 'lids': lids}
    table = {}
    for kind, vs in variants(lm, name).items():
        for vname, cut in vs.items():
            key = f'{kind}.{vname}'
            if cut.get('skirt'):
                part = skirt(body, P, lm, B, NBT)
            else:
                part = shell(body, body_dense, fields, kind, vname, cut, lm)
            parts[key] = part
            table[key] = {k: (round(float(v), 5) if not isinstance(v, bool) else v) for k, v in cut.items()}
            print(f'  {key:16s} verts {len(part["pos"]):5d} tris {len(part["idx"]) // 3:5d}')
    garment_table[name] = table
    # 4. Hair fitted to the (stylised) head.
    for style, spec in hair_files.items():
        if isinstance(spec, dict):
            spec = spec[name]
        if style == 'beard' and name != 'male':
            continue
        f, authored = spec
        hp = hair_part(find_in(HAIR_DIR, f), sk, dims[name], src_dims[authored])
        hp['fields'] = hair_fields(hp)
        parts[f'hair.{style}'] = hp
    bab = {k: to_babylon(v) for k, v in parts.items()}
    mesh_table, size = write_parts(os.path.join(OUT, f'{name}.bin'), bab)

    # 5. Skeleton with face bones; retarget constants.
    extend_skeleton(sk, fr['pivots'])
    if not skel_done:
        extend_skeleton(sk_s, None)
        BONES = BONES + FACE_BONES
        PARENTS = PARENTS + [HEAD] * len(FACE_BONES)
        src_world_q = Skeleton.world_q(sk_s, mirror_q(sk_s.q))
        skel_done = True
    pre, post = retarget(sk)
    tq = mirror_q(sk.q)
    tt = mirror_t(sk.t)
    ibm = np.array([mirror_m(m) for m in sk.ibm])
    height = float(body['pos'][:, 1].max())

    # 6. Textures.
    albedo = Image.open(os.path.join(base_dir, cfg['albedo']))
    rough = Image.open(os.path.join(base_dir, cfg['rough']))
    ref = skin_reference(albedo, rough)
    save_jpg(albedo, f'{name}_albedo.jpg', 1024)
    head_w = (body['weights'] * np.isin(body['joints'], [HEAD] + list(FACE_INDEX.values()))).sum(1)
    soften_normal(Image.open(os.path.join(base_dir, cfg['normal'])), body, head_w, 1024).save(os.path.join(OUT, f'{name}_normal.jpg'), quality=90, optimize=True, progressive=True)
    bake_folds(body, fields, lm, 512, 7 if name == 'male' else 11).save(os.path.join(OUT, f'{name}_folds.jpg'), quality=90, optimize=True)

    rig['bodies'][name] = {
        'mesh': f'{name}.bin',
        'bytes': size,
        'parts': mesh_table,
        'height': round(height, 4),
        'restT': np.round(tt, 6).ravel().tolist(),
        'restQ': np.round(tq, 7).ravel().tolist(),
        # Babylon order (row-major of the row-vector form == glTF column-major).
        'inverseBind': np.round(np.array([m.T.ravel() for m in ibm]), 7).ravel().tolist(),
        'pre': np.round(pre, 7).ravel().tolist(),
        'post': np.round(post, 7).ravel().tolist(),
        'pelvisScale': round(float(sk.t[B['pelvis']][2] / src_pelvis_h), 5),
        'skinRef': np.round(ref, 5).tolist(),
        'headTop': round(height, 4),
        'textures': {'albedo': f'{name}_albedo.jpg', 'normal': f'{name}_normal.jpg', 'folds': f'{name}_folds.jpg'},
        'garments': table,
    }
    print(name, 'mesh bytes', size, 'height', height, 'skinRef', ref)

rig['bones'] = BONES
rig['parents'] = PARENTS
rig['face'] = {'bones': FACE_BONES, 'upperOpen': UPPER_OPEN, 'lowerOpen': LOWER_OPEN}

# Hair / eye textures.
for k, seed in (('1', 3), ('2', 5)):
    alb, nrm = strands(find_in(HAIR_DIR, f'T_Hair_{k}_BaseColor.png'), find_in('Normals Unity - Godot', f'T_Hair_{k}_Normal.png'), 1024, seed)
    alb.save(os.path.join(OUT, f'hair{k}_albedo.jpg'), quality=88, optimize=True, progressive=True)
    nrm.save(os.path.join(OUT, f'hair{k}_normal.jpg'), quality=88, optimize=True, progressive=True)
save_jpg(Image.open(os.path.join(base_dir, 'T_Eye_Brown.png')), 'eye_albedo.jpg', 256, 92)
# Fabric weave (tiling): normal xy in RG, albedo detail in B. From Poly Haven "Rough Linen" (CC0).
FABRIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../web/public/assets/textures/fabric_linen')
fa = np.asarray(Image.open(os.path.join(FABRIC, 'albedo.jpg')).convert('L').resize((256, 256), Image.LANCZOS), np.float64) / 255
fa = np.clip(0.5 + (fa - fa.mean()) * 1.6, 0, 1)
fn = np.asarray(Image.open(os.path.join(FABRIC, 'normal.jpg')).convert('RGB').resize((256, 256), Image.LANCZOS), np.float64) / 255
Image.fromarray(np.uint8(np.stack([fn[..., 0], fn[..., 1], fa], -1) * 255)).save(os.path.join(OUT, 'fabric.jpg'), quality=90)
rig['fabric'] = 'fabric.jpg'
rig['hairTextures'] = {
    'short': 'hair1', 'none': 'hair1', 'beard': 'hair1', 'long': 'hair2', 'bun': 'hair2',
}

# Clips: the clip skeleton's bones only (`clipBones`); face bones keep their rest rotation and the
# runtime animates them.
blob = bytearray()
for key, g, anim_name, loop in CLIPS:
    q, t, sk = sample_clip(g, anim_name)
    if loop and len(q) > 2:
        d = np.abs(np.abs((q[0] * q[-1]).sum(-1)) - 1).max()
        if d < 1e-4:
            q, t = q[:-1], t[:-1]
    speed = stride_speed(q, t, sk) if key in ('walk', 'jog') else 0.0
    qm = mirror_q(q)
    # Keep quaternions in one hemisphere per bone for clean interpolation.
    for i in range(1, len(qm)):
        flip = (qm[i] * qm[i - 1]).sum(-1) < 0
        qm[i][flip] *= -1
    pelvis = mirror_t(t[:, B['pelvis']])
    entry = {'frames': len(q), 'loop': loop, 'offset': len(blob)}
    blob += np.round(qm * 32767).astype('<i2').tobytes()
    entry['pelvisOffset'] = len(blob)
    blob += pelvis.astype('<f4').tobytes()
    if speed:
        entry['speed'] = round(speed, 4)
    rig['clips'][key] = entry
    print(f'clip {key:10s} {anim_name:24s} frames {len(q):4d} loop {loop} speed {speed:.3f}')
open(os.path.join(OUT, 'anims.bin'), 'wb').write(bytes(blob))
rig['anims'] = 'anims.bin'
rig['clipBones'] = NB0
rig['sourcePelvis'] = mirror_t(sk_s.t[B['pelvis']]).round(5).tolist()
# Rest pose of the animation skeleton (T-pose, straight fingers): used to relax the clips' fists.
rig['sourceRestQ'] = np.round(mirror_q(sk_s.q), 7).ravel().tolist()
json.dump(rig, open(os.path.join(OUT, 'rig.json'), 'w'), separators=(',', ':'))
print('anims bytes', len(blob))
