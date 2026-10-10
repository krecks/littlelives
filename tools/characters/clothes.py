"""
MakeHuman's clothes (CC0, fitted by MPFB to every body and life stage) as the game's garments:

- `pieces`: a suit split into its top and bottom (UV islands, by height against the pelvis), so tops and bottoms combine freely;
- `fit_cut`: the garment's coverage cut (the runtime's skin discard, see garments.py `coverage`)
  fitted to the body vertices the item's MakeHuman delete group hides, erring towards showing skin;
- `Atlas`: the items' textures in one detail atlas (tops and bottoms as greyscale detail, median 0.5
  linear, tinted per Sim; shoes keep their colours) and one normal atlas, with each garment's UVs
  moved into its cell.

Garment vertices carry (1, 0, category, 0) in `fields` (no hem band; categories as garments.py).
"""

import os

import numpy as np
from PIL import Image
from scipy import sparse
from scipy.ndimage import binary_dilation
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from common import raster_attrs, srgb_to_lin
from garments import BOTTOM, SHOES, TOP, coverage

CATEGORY = {'top': TOP, 'bottom': BOTTOM, 'shoes': SHOES}

# The body's skin is discarded where a garment's coverage exceeds this (= the shader's MARGIN).
MARGIN = 0.02
# Skin wrongly hidden costs this much more than skin wrongly shown (which the garment covers anyway).
FALSE_HIDE = 4.0


def pieces(part, pelvis, legs, body_pos):
    """
    {'top': vertex mask, 'bottom': vertex mask} of a suit by its UV islands (a shirt and trousers may
    be one welded mesh, never one island): an island is part of the bottom when it sits low and is
    either on the legs (bone indices `legs`) or close to the skin (waistbands, belts); anything else
    low (a jacket's pocket flaps, standing off the body) stays with the top.
    """
    tri = part['idx'].reshape(-1, 3)
    n = len(part['pos'])
    a = np.concatenate([tri[:, 0], tri[:, 1]])
    b = np.concatenate([tri[:, 1], tri[:, 2]])
    g = sparse.coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n))
    _, label = connected_components(g, directed=False)
    leg_w = (part['weights'] * np.isin(part['joints'], legs)).sum(1)
    gap, _ = cKDTree(body_pos).query(part['pos'])
    scale = part['pos'][:, 1].max() / 1.7
    top = np.zeros(n, bool)
    for c in np.unique(label):
        sel = label == c
        low = part['pos'][sel, 1].mean() < pelvis[1] + 0.12 * scale
        top[sel] = not (low and (leg_w[sel].mean() > 0.5 or gap[sel].mean() < 0.022))
    return {'top': top, 'bottom': ~top}


def subset(part, keep):
    """The faces of `part` whose vertices are all kept: (kept vertex ids, index buffer into them)."""
    tri = part['idx'].reshape(-1, 3)
    tri = tri[keep[tri].all(1)]
    used = np.unique(tri)
    remap = np.full(len(part['pos']), -1)
    remap[used] = np.arange(len(used))
    return used, remap[tri].ravel()


def covered(skin, cloth, reach=0.04):
    """Body vertices with `cloth` just outside them (along the skin's normal, within `reach` m)."""
    d, nn = cKDTree(cloth['pos']).query(skin['pos'])
    out = cloth['pos'][nn] - skin['pos']
    facing = (out * skin['nor']).sum(1) > 0.5 * np.maximum(d, 1e-9)
    return (d < reach) & facing


def fit_cut(fields, target, kind):
    """
    The cut (garments.py variant dict) whose coverage best reproduces `target` (body vertices the
    garment hides): started from the target's extent, then a coordinate search per parameter.
    """
    f = fields
    y = f[:, 1]
    q = lambda a, p: float(np.quantile(a, p)) if len(a) else 0.0  # noqa: E731
    if kind == 'top':
        torso = target & (f[:, 0] < -0.5)
        init = {'sleeve': q(f[target, 0], 0.97), 'hem': q(y[torso], 0.03)}
    elif kind == 'bottom':
        init = {'waist': q(y[target], 0.97), 'leg': q(y[target], 0.03)}
    else:
        init = {'shoe': q(y[target], 0.97)}

    def score(cut):
        pred = coverage(f, cut, kind) > MARGIN
        return (pred & target).sum() - FALSE_HIDE * (pred & ~target).sum()

    grids = {
        'sleeve': np.linspace(-1.0, 1.05, 83),
        'hem': np.arange(y.min(), y.max(), 0.005),
        'crew': np.linspace(-0.12, 0.12, 49),
        'scoop': np.linspace(-0.12, 0.12, 49),
        'waist': np.arange(y.min(), y.max(), 0.005),
        'leg': np.arange(y.min() - 0.05, y.max(), 0.005),
        'shoe': np.arange(y.min() - 0.05, y.max() * 0.5, 0.0025),
    }
    best = None
    for neck in (['crew', 'scoop'] if kind == 'top' else [None]):
        cut = dict(init, **({neck: 0.0} if neck else {}))
        for _ in range(3):
            for k in list(cut):
                vals = grids[k]
                scores = [score(dict(cut, **{k: v})) for v in vals]
                cut[k] = float(vals[int(np.argmax(scores))])
        s = score(cut)
        if best is None or s > best[0]:
            best = (s, cut)
    cut = best[1]
    pred = coverage(f, cut, kind) > MARGIN
    iou = (pred & target).sum() / max((pred | target).sum(), 1)
    return cut, iou, int((pred & ~target).sum())


# ---- textures -----------------------------------------------------------------------------------

def mhmat(path):
    """Texture paths of a MakeHuman material (diffuse, normal, ao; None where absent)."""
    out = {'diffuse': None, 'normal': None, 'ao': None}
    keys = {'diffuseTexture': 'diffuse', 'normalmapTexture': 'normal', 'aomapTexture': 'ao'}
    base = os.path.dirname(path)
    for line in open(path, encoding='utf-8', errors='replace'):
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0] in keys:
            p = os.path.join(base, parts[1].strip())
            out[keys[parts[0]]] = p if os.path.exists(p) else None
    return out


def item_material(mhclo):
    for line in open(mhclo, encoding='utf-8', errors='replace'):
        if line.startswith('material '):
            return mhmat(os.path.join(os.path.dirname(mhclo), line.split(None, 1)[1].strip()))
    raise ValueError(f'{mhclo}: no material')


class Atlas:
    """Square atlas of `grid` x `grid` cells of `cell` px, each with a `pad` px gutter."""

    def __init__(self, grid=4, cell=512, pad=8):
        self.grid, self.cell, self.pad = grid, cell, pad
        size = grid * cell
        self.detail = np.full((size, size, 3), 0.5)
        self.normal = np.tile([0.5, 0.5, 1.0], (size, size, 1))
        self.cells = {}

    def place(self, item, textures, part, tint, flat=None):
        """
        Adds an item's textures to the next cell. `part`: the item's mesh (uv, idx); `tint`: per
        vertex, True where the garment is tinted per Sim (its UV islands set the median the detail is
        normalised to). `flat`: per vertex, pieces drawn without the diffuse's pattern (tees whose
        print is a MakeHuman logo): only the ambient occlusion shades them.
        """
        k = len(self.cells)
        assert k < self.grid * self.grid, 'atlas full'
        self.cells[item] = k
        inner = self.cell - 2 * self.pad
        diff = Image.open(textures['diffuse']).convert('RGB').resize((inner, inner), Image.LANCZOS)
        lin = srgb_to_lin(np.asarray(diff, np.float64) / 255)
        ao = np.ones((inner, inner))
        if textures['ao']:
            ao = np.asarray(Image.open(textures['ao']).convert('L').resize((inner, inner), Image.LANCZOS), np.float64) / 255
        lum = lin @ [0.2126, 0.7152, 0.0722]
        out = lin
        if tint.any():
            region = islands(part, tint, inner)
            # Greyscale detail with the folds' occlusion, median 0.5 (the shader: colour * detail * 2),
            # its contrast compressed: white trims and stonewash would read as skin in a dark colour.
            grey = 0.5 * np.clip(lum / max(np.median(lum[region]), 1e-3), 0.05, None) ** 0.55
            if flat is not None and flat.any():
                grey = np.where(islands(part, flat, inner), 0.5, grey)
            grey = np.clip(grey * (0.4 + 0.6 * ao), 0, 0.72)
            out = np.where(region[..., None], grey[..., None], lin)
        cell = self.slice(k)
        self.detail[cell] = edge_pad(out, self.pad)
        if textures['normal']:
            nrm = np.asarray(Image.open(textures['normal']).convert('RGB').resize((inner, inner), Image.LANCZOS), np.float64) / 255
            self.normal[cell] = edge_pad(nrm, self.pad)

    def slice(self, k):
        r, c = divmod(k, self.grid)
        return (slice(r * self.cell, (r + 1) * self.cell), slice(c * self.cell, (c + 1) * self.cell))

    def remap(self, item, uv):
        """An item's UVs (glTF, 0..1) moved into its cell."""
        r, c = divmod(self.cells[item], self.grid)
        size = self.grid * self.cell
        inner = self.cell - 2 * self.pad
        u = np.clip(uv, 0, 1)
        return np.c_[(c * self.cell + self.pad + u[:, 0] * inner) / size, (r * self.cell + self.pad + u[:, 1] * inner) / size]

    def images(self):
        lin = np.clip(self.detail, 0, 1)
        srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
        return (Image.fromarray(np.uint8(np.round(srgb * 255)), 'RGB'),
                Image.fromarray(np.uint8(np.round(np.clip(self.normal, 0, 1) * 255)), 'RGB'))


def islands(part, keep, size):
    """Texels (size x size) covered by the triangles of `part` whose vertices are all in `keep`, grown 2 px."""
    tri = part['idx'].reshape(-1, 3)
    tri = tri[keep[tri].all(1)]
    _, hit = raster_attrs({'uv': np.clip(part['uv'], 0, 1), 'idx': tri.ravel()}, np.zeros((len(part['uv']), 1)), size)
    return binary_dilation(hit, iterations=2)


def edge_pad(img, pad):
    return np.pad(img, ((pad, pad), (pad, pad), (0, 0)), mode='edge')
