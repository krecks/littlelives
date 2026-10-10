"""Helpers shared by the character builds (build.py: Quaternius sources; build_mpfb.py: MPFB bodies)."""

import os

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

from gltfio import Gltf  # noqa: F401
from meshops import boundary_edges, geodesic_from, weld_ids

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


FIELD_SCALE = 4000.0


def write_parts(path, parts, morph_scale=None, normal_scale=None, morph_only=()):
    """
    Each part: positions f32x3, normals i16x4 (w unused), uv f32x2, joints u8x4, weights u8x4,
    fields i16x4 (value * FIELD_SCALE; see garments.py / hair tips), indices u16.

    Parts with face morphs (`part['morph']`, see build_mpfb.py) add the vertices any morph moves
    (`morphVerts`, u16) and per channel, in order, the moved vertices' slots in that list (`morphSlots`,
    u16), position deltas (`morphPositions`, i16x4, * morph_scale) and normal deltas (`morphNormals`,
    i8x4, * normal_scale); `morph.ranges[c]..ranges[c + 1]` are channel c's entries. Parts in
    `morph_only` get just their morphs (their geometry is written elsewhere, loaded on demand).
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

        if name not in morph_only:
            add('positions', part['pos'].astype('<f4'))
            add('normals', np.c_[np.round(nor * 32767), np.zeros(n)].astype('<i2'))
            add('uvs', part['uv'].astype('<f4'))
            add('joints', part['joints'].astype(np.uint8))
            add('weights', wq.astype(np.uint8))
            f = part.get('fields')
            f = np.zeros((n, 4)) if f is None else np.asarray(f, np.float64)
            add('fields', np.clip(np.round(f * FIELD_SCALE), -32767, 32767).astype('<i2'))
            add('index', part['idx'].astype('<u2'))
        m = part.get('morph')
        if m is not None:
            e = len(m['slots'])
            entry['morph'] = {'count': len(m['verts']), 'ranges': [int(r) for r in m['ranges']]}
            add('morphVerts', np.asarray(m['verts']).astype('<u2'))
            add('morphSlots', np.asarray(m['slots']).astype('<u2'))
            add('morphPositions', np.clip(np.round(np.c_[m['dpos'], np.zeros(e)] * morph_scale), -32767, 32767).astype('<i2'))
            add('morphNormals', np.clip(np.round(np.c_[m['dnor'], np.zeros(e)] * normal_scale), -127, 127).astype('i1'))
            for k in ('morphVerts', 'morphSlots', 'morphPositions', 'morphNormals'):
                entry['morph'][k] = entry.pop(k)
        lo, hi = part['pos'].min(0), part['pos'].max(0)
        entry['min'] = np.round(lo, 4).tolist()
        entry['max'] = np.round(hi, 4).tolist()
        table[name] = entry
    open(path, 'wb').write(bytes(blob))
    return table, len(blob)


def save_jpg(img, out, name, size, quality=88, mode='RGB'):
    img.convert(mode).resize((size, size), Image.LANCZOS).save(os.path.join(out, name), quality=quality, optimize=True, progressive=True)


def srgb_to_lin(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


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
