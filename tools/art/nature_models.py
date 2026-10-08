# Procedural trees, bushes, hedges and lawn tufts as small .glb files (original, CC0), and the
# shared building blocks garden_models.py uses for the garden catalog.
#
# usage: python3 -I nature_models.py <out_dir>      (writes <out_dir>/*.glb next to foliage.webp / bark.webp)
#
# Every model has up to three primitives:
#   - `nature.bark`   tapered tubes (trunk, limbs, twigs) on `bark.webp` (brown | birch halves)
#   - `nature.leaves` (trees, bushes, flowers) or `nature.grass` (lawn): alpha-tested, double-sided
#     cards on the foliage atlas `foliage.webp` (regions in foliage_atlas.py). The foliage is drawn
#     nearly white and coloured by vertex colours, which also carry the crown's self-shadowing.
#   - `garden.solid` / `garden.glazed` untextured, vertex-coloured parts (pots, stones, planters).
#
# Crowns are built from clumps: limbs end in leaf clumps, and each clump is a few *camera-facing*
# cards (see web/src/render/babylon/foliageCards.ts): TEXCOORD_1/TEXCOORD_2 carry each card's centre
# and the vertex's corner offset, so the renderer turns the cards towards the camera. The static
# card (what shadows and older renderers see) faces out of the clump. Card normals point out of the
# clump and the crown, so a crown shades as a few soft lumps (the painterly look).
#
# Budgets: trees ~0.6-1.5k triangles (full) and ~150-300 (`*_far`, for distant forest instances).
import json
import math
import os
import random
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from foliage_atlas import REGIONS, SIZE as ATLAS  # noqa: E402

BARK_BROWN = (0.02, 0.48)
BARK_BIRCH = (0.52, 0.98)
# Card offsets are packed into one float (see foliageCards.ts).
PACK_STEPS = 4096
PACK_PER_M = 512


def srgb(c):
    return tuple((max(0.0, v) ** 2.2) for v in c)


def norm(v):
    v = np.asarray(v, np.float64)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def pack(dx, dy, cylinder=False):
    enc = lambda v: min(PACK_STEPS - 1, max(0, int(round(v * PACK_PER_M + PACK_STEPS / 2))))
    p = enc(dx) * PACK_STEPS + enc(dy)
    return -1 - p if cylinder else p


STATIC = pack(0, 0)


class Part:
    def __init__(self):
        self.p, self.n, self.uv, self.c, self.i, self.bb = [], [], [], [], [], []

    def vert(self, p, n, uv, c, bb=None):
        p = tuple(float(x) for x in p)
        self.p.append(p)
        self.n.append(tuple(float(x) for x in norm(n)))
        self.uv.append((float(uv[0]), float(uv[1])))
        self.c.append(tuple(float(x) for x in c))
        # Card centre and packed corner offset; static vertices sit on their own centre.
        self.bb.append(bb if bb is not None else (p[0], p[1], p[2], STATIC))
        return len(self.p) - 1

    def tri(self, a, b, c):
        self.i += [a, b, c]

    @property
    def tris(self):
        return len(self.i) // 3

    @property
    def turns(self):
        return any(b[3] != STATIC for b in self.bb)

    def add(self, other):
        base = len(self.p)
        self.p += other.p
        self.n += other.n
        self.uv += other.uv
        self.c += other.c
        self.bb += other.bb
        self.i += [k + base for k in other.i]

    def transform(self, m=None, t=(0, 0, 0)):
        """Applies a 3x3 matrix (rotation / uniform scale) and a translation in place."""
        m = np.eye(3) if m is None else np.asarray(m, float)
        t = np.asarray(t, float)
        s = abs(np.linalg.det(m)) ** (1 / 3)
        self.p = [tuple(m @ np.array(p) + t) for p in self.p]
        self.n = [tuple(norm(m @ np.array(n))) for n in self.n]
        bb = []
        for cx, cy, cz, pk in self.bb:
            c = m @ np.array([cx, cy, cz]) + t
            if pk != STATIC and abs(s - 1) > 1e-6:
                cyl = pk < 0
                q = -1 - pk if cyl else pk
                ix, iy = divmod(q, PACK_STEPS)
                pk = pack((ix - PACK_STEPS / 2) / PACK_PER_M * s, (iy - PACK_STEPS / 2) / PACK_PER_M * s, cyl)
            bb.append((float(c[0]), float(c[1]), float(c[2]), pk))
        self.bb = bb
        return self


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


# ---- bark --------------------------------------------------------------------------

def frames(path):
    """Parallel-transport frames along a polyline."""
    path = [np.asarray(p, np.float64) for p in path]
    tangents = []
    for k in range(len(path)):
        a = path[max(0, k - 1)]
        b = path[min(len(path) - 1, k + 1)]
        tangents.append(norm(b - a))
    ref = np.array([1.0, 0, 0]) if abs(tangents[0][0]) < 0.9 else np.array([0, 0, 1.0])
    nrm = norm(np.cross(np.cross(tangents[0], ref), tangents[0]))
    out = []
    for t in tangents:
        nrm = norm(nrm - t * np.dot(nrm, t))
        out.append((t, nrm, np.cross(t, nrm)))
    return path, out


def tube(part, path, radii, sides, urange, vscale=0.9, colour=(1, 1, 1), cap=False, vrange=None):
    """A tapered tube along `path`. `urange` spans the texture across the girth; v runs along the
    length (repeating every `vscale` metres) or, with `vrange`, stretches once over that range."""
    path, fr = frames(path)
    u0, u1 = urange
    lengths = [0.0]
    for k in range(1, len(path)):
        lengths.append(lengths[-1] + np.linalg.norm(path[k] - path[k - 1]))
    total = max(lengths[-1], 1e-6)
    vof = (lambda L: vrange[0] + (vrange[1] - vrange[0]) * L / total) if vrange else (lambda L: L / vscale)
    cols = colour if isinstance(colour, list) else [colour] * len(path)
    rings = []
    for k, (p, (t, n, b)) in enumerate(zip(path, fr)):
        ring = []
        for s in range(sides + 1):
            a = 2 * math.pi * s / sides
            d = n * math.cos(a) + b * math.sin(a)
            ring.append(part.vert(p + d * radii[k], d, (u0 + (u1 - u0) * s / sides, vof(lengths[k])), cols[k]))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for s in range(sides):
            a, b_, c, d = rings[k][s], rings[k][s + 1], rings[k + 1][s + 1], rings[k + 1][s]
            part.tri(a, c, b_)
            part.tri(a, d, c)
    if cap:
        tip = part.vert(path[-1] + fr[-1][0] * radii[-1] * 0.5, fr[-1][0], ((u0 + u1) / 2, vof(lengths[-1])), cols[-1])
        for s in range(sides):
            part.tri(rings[-1][s], tip, rings[-1][s + 1])


def curve(a, b, bend, steps, rng=None, wobble=0.0):
    """Quadratic curve from a to b, bowed by `bend` (a vector), with optional wobble."""
    a, b, bend = np.asarray(a, float), np.asarray(b, float), np.asarray(bend, float)
    mid = (a + b) / 2 + bend
    pts = []
    for k in range(steps + 1):
        t = k / steps
        p = (1 - t) ** 2 * a + 2 * (1 - t) * t * mid + t * t * b
        if rng and 0 < k < steps:
            p = p + np.array([rng.uniform(-1, 1), rng.uniform(-0.5, 0.5), rng.uniform(-1, 1)]) * wobble
        pts.append(p)
    return pts


def lerp_path(path, t):
    """Point and direction at parameter t (0..1) along a polyline."""
    seg = np.array([np.linalg.norm(path[k + 1] - path[k]) for k in range(len(path) - 1)])
    total = seg.sum()
    d = t * total
    for k, L in enumerate(seg):
        if d <= L or k == len(seg) - 1:
            f = min(1.0, d / max(L, 1e-9))
            return path[k] + (path[k + 1] - path[k]) * f, norm(path[k + 1] - path[k])
        d -= L
    return path[-1], norm(path[-1] - path[-2])


# ---- cards -------------------------------------------------------------------------

def region_uv(name):
    x0, y0, x1, y1 = REGIONS[name]
    return x0 / ATLAS, y0 / ATLAS, x1 / ATLAS, y1 / ATLAS


def region_aspect(name):
    x0, y0, x1, y1 = REGIONS[name]
    return (x1 - x0) / (y1 - y0)


def region_mid(name, inset=0.5):
    u0, v0, u1, v1 = region_uv(name)
    return ((u0 + u1) / 2, v0 + (v1 - v0) * inset)


def card(part, base, up, side, w, h, region, normal_at, colour_at, rows=1, droop=0.0, flip=False):
    """A static quad (optionally bent into `rows` rows) whose bottom edge centre is `base`, growing
    along `up`. `w` is the width for a square region; other regions keep their aspect ratio."""
    u0, v0, u1, v1 = region_uv(region)
    w = w * region_aspect(region)
    if flip:
        u0, u1 = u1, u0
    up, side = norm(up), norm(side)
    face = norm(np.cross(side, up))
    grid = []
    for r in range(rows + 1):
        t = r / rows
        row = []
        for s in (0, 1):
            p = base + side * (s - 0.5) * w + up * h * t + np.array([0, -droop * h * t * t, 0])
            n = normal_at(p, face)
            row.append(part.vert(p, n, (u0 + (u1 - u0) * s, v1 + (v0 - v1) * t), colour_at(p)))
        grid.append(row)
    for r in range(rows):
        a, b, c, d = grid[r][0], grid[r][1], grid[r + 1][1], grid[r + 1][0]
        part.tri(a, b, c)
        part.tri(a, c, d)


def facing_card(part, centre, size, region, normal, colour, face, spin=0.0, cylinder=False, anchor=0.5, flip=False, up_hint=(0, 1, 0)):
    """
    A camera-facing card of height `size` around `centre` (`anchor` 0 = hangs from its top edge,
    0.5 = centred). `spin` rotates the picture in the card (radians). Its static quad faces `face`.
    """
    u0, v0, u1, v1 = region_uv(region)
    if flip:
        u0, u1 = u1, u0
    h = size
    w = size * region_aspect(region)
    face = norm(face)
    up = np.asarray(up_hint, float)
    up = norm(up - face * np.dot(up, face)) if abs(np.dot(norm(up), face)) < 0.98 else norm(np.cross(face, [1.0, 0, 0]))
    side = norm(np.cross(up, face))
    c, s = math.cos(spin), math.sin(spin)
    centre = np.asarray(centre, float)
    ids = []
    for (sx, sy) in ((0, 0), (1, 0), (1, 1), (0, 1)):
        ox = (sx - 0.5) * w
        oy = (sy - (1 - anchor)) * h if anchor != 0.5 else (sy - 0.5) * h
        rx, ry = ox * c - oy * s, ox * s + oy * c
        p = centre + side * rx + up * ry
        uv = (u0 + (u1 - u0) * sx, v1 + (v0 - v1) * sy)
        ids.append(part.vert(p, normal, uv, colour, (centre[0], centre[1], centre[2], pack(rx, ry, cylinder))))
    part.tri(ids[0], ids[1], ids[2])
    part.tri(ids[0], ids[2], ids[3])


class Canopy:
    """Ellipsoid crown used for anchors, bent normals and self-shadowing."""

    def __init__(self, centre, radii, bend=0.82, dark=0.42):
        self.c = np.asarray(centre, float)
        self.r = np.asarray(radii, float)
        self.bend = bend
        self.dark = dark

    def local(self, p):
        return (np.asarray(p) - self.c) / self.r

    def outward(self, p):
        e = self.local(p)
        return norm(e / self.r) if np.linalg.norm(e) > 1e-6 else np.array([0, 1.0, 0])

    def normal(self, p, face, lobe=None):
        sph = self.outward(p)
        if np.dot(face, sph) < 0:
            face = -face
        return norm(sph * self.bend + face * (1 - self.bend))

    def shade(self, p):
        e = self.local(p)
        rad = float(np.linalg.norm(e))
        ao = self.dark + (1 - self.dark) * smoothstep(0.15, 1.0, rad)
        ao *= 0.8 + 0.2 * smoothstep(-0.9, 0.75, float(e[1]))
        return ao

    def point(self, rng, lo=0.55, hi=0.95, up_bias=0.25):
        d = norm([rng.gauss(0, 1), rng.gauss(0, 1) + up_bias, rng.gauss(0, 1)])
        return self.c + d * self.r * rng.uniform(lo, hi)


def jitter_tint(tint, rng, j=0.07):
    t = np.array(tint, float) * (1 + rng.uniform(-j, j))
    warm = rng.uniform(-j, j) * 0.8
    return t * np.array([1 + warm, 1 + warm * 0.3, 1 - warm])


def clump(part, canopy, centre, radius, rng, region, tint, cards, size_k=1.45, spread=0.55, light=1.0, lift=0.25, spin=math.pi):
    """
    One leaf clump: `cards` camera-facing cards scattered over a ball of `radius` around `centre`.
    Shading: darker towards the crown's core and bottom (canopy) and towards the clump's underside.
    """
    centre = np.asarray(centre, float)
    out_c = canopy.outward(centre)
    for k in range(cards):
        if k == 0:
            d = norm(out_c + np.array([0, 0.4, 0]))
            r = radius * 0.15
        else:
            d = norm(np.array([rng.gauss(0, 1), rng.gauss(0, 1) + lift, rng.gauss(0, 1)]) + out_c * 0.6)
            r = radius * rng.uniform(0.25, spread + 0.25)
        p = centre + d * r
        n = norm(d * 0.55 + canopy.outward(p) * 0.45 + np.array([0, 0.12, 0]))
        under = smoothstep(-0.8, 0.6, float(d[1]))
        k_shade = canopy.shade(p) * (0.84 + 0.16 * under) * light
        col = srgb(jitter_tint(tint, rng) * k_shade)
        size = radius * size_k * rng.uniform(0.85, 1.15)
        facing_card(part, p, size, region, n, col, face=norm(d + out_c), spin=rng.uniform(-spin, spin), flip=rng.random() < 0.5)


def scatter_clumps(canopy, rng, seeds, total, radius, min_gap=0.8):
    """Clump centres: the given seeds (limb ends etc.), then points filling the crown's shell."""
    pts = [np.asarray(s, float) for s in seeds]
    tries = 0
    while len(pts) < total and tries < 4000:
        tries += 1
        q = canopy.point(rng, 0.35, 0.78, up_bias=0.35)
        if all(np.linalg.norm(q - p) > radius * min_gap for p in pts):
            pts.append(q)
    return pts


# ---- trees -------------------------------------------------------------------------

def branching(seed, far, *, trunk_h, trunk_r, limbs, canopy, bark=BARK_BROWN, elev=(35, 60), lean=0.0, stems=1, twigs=2, reach=(0.62, 0.82)):
    """Trunk(s), a leader and limbs reaching into the crown. Returns (bark part, limb ends)."""
    rng = random.Random(seed)
    bark_p = Part()
    sides_t, sides_l = (5, 3) if far else (9, 5)
    ends = [canopy.c + np.array([0, canopy.r[1] * 0.55, 0])]
    for st in range(stems):
        off = np.array([0.0, 0, 0]) if st == 0 else np.array([rng.uniform(-0.3, 0.3), 0, rng.uniform(-0.3, 0.3)])
        lean_v = np.array([lean * (1 if st == 0 else -0.7), 0, lean * 0.3])
        top = np.array([0, trunk_h, 0]) + lean_v * trunk_h + off
        steps = 2 if far else 6
        trunk = curve(off, top, [rng.uniform(-0.15, 0.15), 0, rng.uniform(-0.15, 0.15)], steps)
        tr = trunk_r * (1 if st == 0 else 0.75)
        # Root flare at the base, gently tapering up.
        radii = [tr * (1 + 0.65 * max(0, 1 - k / (steps * 0.22)) ** 2) * (1 - 0.3 * k / steps) for k in range(steps + 1)]
        tube(bark_p, trunk, radii, sides_t, bark)
        leader_end = canopy.c + np.array([rng.uniform(-0.2, 0.2), canopy.r[1] * 0.6, rng.uniform(-0.2, 0.2)]) + off * 0.5
        leader = curve(top, leader_end, [rng.uniform(-0.2, 0.2), 0, rng.uniform(-0.2, 0.2)], 2 if far else 4)
        tube(bark_p, leader, np.linspace(tr * 0.66, tr * 0.12, len(leader)), sides_l, bark, cap=True)
        n = limbs if not far else max(3, limbs - 2)
        for k in range(n):
            az = 2 * math.pi * (k + rng.uniform(-0.3, 0.3)) / n + st
            el = math.radians(rng.uniform(*elev))
            t0 = rng.uniform(0.7, 0.98)
            start = trunk[0] + (trunk[-1] - trunk[0]) * t0
            d = np.array([math.cos(az) * math.cos(el), math.sin(el), math.sin(az) * math.cos(el)])
            target = canopy.c + norm(d * canopy.r + np.array([0, 0.1, 0])) * canopy.r * rng.uniform(*reach)
            limb = curve(start, target, [0, -0.2, 0] + d * 0.15, 2 if far else 5, rng, 0.06)
            ends.append(target)
            rl = tr * rng.uniform(0.5, 0.66)
            tube(bark_p, limb, np.linspace(rl, rl * 0.2, len(limb)), sides_l, bark, cap=True)
            if far:
                continue
            for j in range(twigs):
                p, dirv = lerp_path(limb, rng.uniform(0.35, 0.75))
                sd = norm(dirv + np.array([rng.uniform(-0.9, 0.9), rng.uniform(0.0, 0.6), rng.uniform(-0.9, 0.9)]))
                end = canopy.c + norm(canopy.local(p + sd * 2.0)) * canopy.r * rng.uniform(0.6, 0.85)
                twig = curve(p, end, [0, -0.1, 0], 2)
                tube(bark_p, twig, np.linspace(rl * 0.45, rl * 0.1, len(twig)), 4, bark, cap=True)
                ends.append(end)
    return bark_p, ends


def clump_tree(seed, far, *, trunk_h, trunk_r, limbs, crown_c, crown_r, clumps, clump_r, cards, region='clump.broad',
               tint=(0.4, 0.56, 0.22), bark=BARK_BROWN, elev=(35, 60), lean=0.0, stems=1, dark=0.55, size_k=1.6,
               extras=(), reach=(0.62, 0.82)):
    """
    A broadleaf tree: a branching skeleton whose limb ends seed leaf clumps, plus clumps filling the
    rest of the crown. `extras` = [(region, share, tint, size_k)] turns a share of the clumps into
    another kind (blossom clumps).
    """
    rng = random.Random(seed + 1000)
    canopy = Canopy(crown_c, crown_r, dark=dark)
    bark_p, ends = branching(seed, far, trunk_h=trunk_h, trunk_r=trunk_r, limbs=limbs, canopy=canopy, bark=bark, elev=elev, lean=lean, stems=stems, reach=reach)
    leaf_p = Part()
    seeds = [e for e in ends if np.linalg.norm(canopy.local(e)) < 1.05]
    centres = scatter_clumps(canopy, rng, seeds[: clumps], clumps, clump_r)
    per = max(2, cards // 3) if far else cards
    kinds = []
    for region_x, share, tint_x, size_x in extras:
        kinds += [(region_x, tint_x, size_x)] * int(round(len(centres) * share))
    kinds += [(region, tint, size_k)] * (len(centres) - len(kinds))
    rng.shuffle(kinds)
    for c, (reg, tn, sk) in zip(centres, kinds):
        r = clump_r * rng.uniform(0.85, 1.15)
        clump(leaf_p, canopy, c, r, rng, reg, tn, per, size_k=sk * (1.12 if far else 1.0))
    return bark_p, leaf_p, canopy


def cone_tree(seed, far, *, height, base_r, trunk_r=0.2, clump_r=0.8, region='conifer', tint=(0.3, 0.44, 0.4),
              cards=6, tiers=None, column=False, droop=0.0, top=1.0):
    """
    A conifer (spruce, fir) or a columnar tree (cypress): clumps stacked in rings on a cone or a
    spindle, shrinking towards the top.
    """
    rng = random.Random(seed)
    bark_p, leaf_p = Part(), Part()
    trunk = curve([0, 0, 0], [0, height * 0.9, 0], [rng.uniform(-0.08, 0.08), 0, rng.uniform(-0.08, 0.08)], 3 if far else 6)
    tube(bark_p, trunk, np.linspace(trunk_r, trunk_r * 0.15, len(trunk)), 5 if far else 8, BARK_BROWN, cap=True)
    y0 = 0.9 if not column else 0.5
    canopy = Canopy([0, height * 0.5, 0], [base_r, height * 0.55, base_r], dark=0.38)
    tiers = tiers or max(4, int((height - y0) / (clump_r * 0.95)))
    golden = math.pi * (3 - math.sqrt(5))
    per = max(2, cards // 2) if far else cards
    for t in range(tiers):
        u = t / max(1, tiers - 1)
        y = y0 + (height - y0 - clump_r * 0.6 * top) * u
        if column:
            ring_r = base_r * (0.55 + 0.45 * math.sin(math.pi * min(1, 0.15 + u * 0.95))) * (1 - 0.55 * u ** 3)
        else:
            ring_r = base_r * (1 - u) ** 0.95 + 0.15
        cr = clump_r * (0.6 + 0.4 * (1 - u)) if not column else clump_r * (0.75 + 0.25 * (1 - u))
        n = max(1, int(round(2 * math.pi * ring_r / (cr * 1.25))))
        for k in range(n):
            az = t * golden + 2 * math.pi * k / n + rng.uniform(-0.2, 0.2)
            rr = max(0.0, ring_r - cr * 0.5)
            c = np.array([math.cos(az) * rr, y - droop * rr * 0.3, math.sin(az) * rr])
            clump(leaf_p, canopy, c, cr, rng, region, tint, per, size_k=1.5, lift=0.0, spin=0.35)
        # A core clump hides the trunk between the rings.
        if ring_r > cr * 0.7 and not far:
            clump(leaf_p, canopy, np.array([0, y, 0]), cr * 0.8, rng, region, tint, 2, size_k=1.4, light=0.75, spin=0.35)
    clump(leaf_p, canopy, np.array([0, height - clump_r * 0.35, 0]), clump_r * 0.55, rng, region, tint, 3, size_k=1.4, spin=0.2)
    return bark_p, leaf_p


def pine(seed, far, height=9.0, base_r=2.4, tiers=17, per=7, tint=(0.82, 0.92, 0.86), droop=0.22, y0=1.1, column=False, frond=1.0):
    """Pine / spruce: tiers of drooping frond cards on the photographed conifer region (static cards)."""
    rng = random.Random(seed)
    bark_p, leaf_p = Part(), Part()
    trunk = curve([0, 0, 0], [0, height - 1.0, 0], [rng.uniform(-0.1, 0.1), 0, rng.uniform(-0.1, 0.1)], 3 if far else 6)
    tube(bark_p, trunk, np.linspace(0.26, 0.03, len(trunk)), 5 if far else 8, BARK_BROWN, cap=True)
    tiers = max(8, tiers * 2 // 3) if far else tiers
    per = max(4, per - 2) if far else per
    golden = math.pi * (3 - math.sqrt(5))
    y1 = height - 0.7

    def cone_r(y):
        u = (y - y0) / (height - y0)
        if column:
            # A spindle: full low down, rounding off at the top (Italian cypress).
            return base_r * (0.75 + 0.25 * math.sin(math.pi * min(1.0, 0.2 + u))) * (1 - 0.8 * max(0.0, u - 0.6) ** 1.5 / 0.4 ** 1.5) + 0.12
        return base_r * max(0.0, 1 - u) ** 0.9 + 0.3

    def normal_at(p, face):
        r = math.hypot(p[0], p[2]) + 1e-6
        outward = np.array([p[0] / r, 0.55, p[2] / r])
        if np.dot(face, outward) < 0:
            face = -face
        return norm(norm(outward) * 0.75 + face * 0.25)

    def colour_at(tint):
        def f(p):
            r = math.hypot(p[0], p[2])
            depth = smoothstep(0.0, cone_r(p[1]) * 0.9, r)
            k = (0.5 + 0.5 * depth) * (0.8 + 0.2 * smoothstep(y0, height, p[1]))
            return srgb(np.array(tint) * k)
        return f

    for t in range(tiers):
        y = y0 + (y1 - y0) * (t / (tiers - 1)) ** 0.8
        L = cone_r(y) * (1.15 if far else 1.05) * frond
        for k in range(per):
            az = t * golden + 2 * math.pi * k / per + rng.uniform(-0.25, 0.25)
            el = math.radians(rng.uniform(-8, 14) if far else rng.uniform(-6, 18))
            d = np.array([math.cos(az) * math.cos(el), math.sin(el), math.sin(az) * math.cos(el)])
            side = norm(np.cross(d, [0, 1, 0]))
            tilt = rng.uniform(-0.35, 0.35)
            side = norm(side * math.cos(tilt) + np.array([0, 1.0, 0]) * math.sin(tilt))
            t_ = (tint[0] + rng.uniform(-0.06, 0.06), tint[1] + rng.uniform(-0.05, 0.05), tint[2] + rng.uniform(-0.06, 0.06))
            card(leaf_p, np.array([0, y, 0]) - d * 0.15, d, side, L * 0.95, L, 'conifer', normal_at, colour_at(t_), rows=1 if far else 2, droop=droop if not far else droop * 0.7, flip=rng.random() < 0.5)
    for k in range(2):
        a = k * math.pi / 2 + 0.4
        side = np.array([math.cos(a), 0, math.sin(a)])
        card(leaf_p, np.array([0, height - 1.9, 0]), np.array([0, 1.0, 0]), side, 0.6, 1.7, 'conifer', normal_at, colour_at(tuple(t * 1.03 for t in tint)))
    return bark_p, leaf_p


def hanging_strands(part, canopy, rng, n, length, tint):
    """Weeping strands (willow): fountain cards (strands arching out of the top and falling) around
    the crown, turning about the vertical only."""
    for _ in range(n):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.2, 0.75)
        top = canopy.c + np.array([math.cos(a) * canopy.r[0] * r, canopy.r[1] * rng.uniform(0.55, 0.95), math.sin(a) * canopy.r[2] * r])
        L = length * rng.uniform(0.8, 1.15)
        centre = top - np.array([0, L * 0.45, 0])
        n_ = norm(canopy.outward(top) * 0.6 + np.array([0, 0.3, 0]))
        col = srgb(jitter_tint(tint, rng) * canopy.shade(top) * 0.95)
        facing_card(part, centre, L, 'willow', n_, col, face=norm([math.cos(a), 0, math.sin(a)]), cylinder=True, flip=rng.random() < 0.5)


def fruit(part, canopy, rng, n, size, region='apple', tint=(1, 1, 1)):
    """Fruit hanging on the outside of the crown: small camera-facing cards."""
    for _ in range(n):
        p = canopy.point(rng, 0.6, 0.85, up_bias=0.1)
        facing_card(part, p, size, region, canopy.outward(p), srgb(np.array(tint) * rng.uniform(0.9, 1.05)), face=canopy.outward(p))


# ---- bushes, hedges, lawn ----------------------------------------------------------

def bush(seed, size=(1.1, 0.9, 1.0), clumps=6, region='clump.broad', tint=(0.46, 0.62, 0.26), cards=5, flowers=None, stems=4, far=False):
    """A rounded shrub: a few clumps on a mound. `flowers` = (region, tint, clumps share, size_k)."""
    rng = random.Random(seed)
    bark_p, leaf_p = Part(), Part()
    w, h, d = size
    canopy = Canopy([0, h * 0.5, 0], [w * 0.5, h * 0.5, d * 0.5], dark=0.6)
    for k in range(stems):
        a = k * 2 * math.pi / stems + rng.uniform(-0.4, 0.4)
        end = np.array([math.cos(a) * w * 0.2, h * 0.5, math.sin(a) * d * 0.2])
        tube(bark_p, curve([0, 0, 0], end, [0, 0, 0], 2), [0.035, 0.025, 0.012], 4, BARK_BROWN)
    cr = min(w, d) * 0.36
    centres = [np.array([0, h * 0.62, 0])]
    for k in range(clumps - 1):
        a = 2 * math.pi * k / (clumps - 1) + rng.uniform(-0.3, 0.3)
        centres.append(np.array([math.cos(a) * w * 0.24, h * rng.uniform(0.38, 0.55), math.sin(a) * d * 0.24]))
    n_flower = int(round(len(centres) * flowers[2])) if flowers else 0
    for i, c in enumerate(centres):
        r = cr * rng.uniform(0.9, 1.1)
        clump(leaf_p, canopy, c, r, rng, region, tint, max(2, cards // 2) if far else cards, size_k=1.5, light=1.15)
    if flowers:
        reg_f, tint_f, _, sk = flowers
        for i in range(n_flower):
            c = canopy.point(rng, 0.5, 0.75, up_bias=0.8)
            clump(leaf_p, canopy, c, cr * 0.8, rng, reg_f, tint_f, 3, size_k=sk, light=1.1)
    return bark_p, leaf_p


def hedge(seed, length=1.0, height=0.85, depth=0.6, cards=120, card_size=0.42, region='clump.fine', tint=(0.44, 0.62, 0.26)):
    """A clipped hedge segment: cards lying on its top and long faces (the ends meet the next one)."""
    rng = random.Random(seed)
    leaf_p = Part()
    hx, hy, hz = length / 2, height / 2, depth / 2
    c = np.array([0, hy, 0])

    def sdf_normal(p, face):
        q = (np.asarray(p) - c) / np.array([hx, hy, hz])
        g = norm(np.sign(q) * np.abs(q) ** 5)
        if np.dot(face, g) < 0:
            face = -face
        return norm(g * 0.8 + face * 0.2)

    def colour(t):
        def f(p):
            q = np.abs((np.asarray(p) - c) / np.array([hx, hy, hz]))
            edge = smoothstep(0.5, 1.0, max(q[0] * 0.3, q[1], q[2]))
            k = (0.72 + 0.28 * edge) * (0.78 + 0.22 * smoothstep(0, 1, p[1] / height))
            return srgb(np.array(t) * k)
        return f

    for _ in range(cards):
        face = rng.random()
        if face < 0.36:
            p = np.array([rng.uniform(-hx, hx), height - 0.1, rng.uniform(-hz, hz) * 0.85]); out = np.array([0, 1.0, 0])
        elif face < 0.68:
            p = np.array([rng.uniform(-hx, hx), rng.uniform(0.06, height - 0.1), hz - 0.08]); out = np.array([0, 0.15, 1.0])
        else:
            p = np.array([rng.uniform(-hx, hx), rng.uniform(0.06, height - 0.1), -hz + 0.08]); out = np.array([0, 0.15, -1.0])
        rnd = norm([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)])
        tangent = norm(rnd - norm(out) * np.dot(rnd, norm(out)))
        up = norm(tangent + norm(out) * 0.25)
        side = norm(np.cross(up, norm(out)))
        s = card_size * rng.uniform(0.85, 1.15)
        card(leaf_p, p - up * s * 0.45, up, side, s, s, region, sdf_normal, colour(jitter_tint(tint, rng, 0.06)), flip=rng.random() < 0.5)
    return Part(), leaf_p


def grass_tuft(seed, w=0.34, h=0.3, quads=3, flowers=0):
    rng = random.Random(seed)
    p = Part()

    def normal_at(q, face):
        return np.array([0, 1.0, 0]) * 0.92 + face * 0.08 * (1 if face[2] >= 0 else -1)

    def colour(q):
        return srgb(np.array([1.0, 1.02, 0.95]) * (0.78 + 0.27 * smoothstep(0, h, q[1])))

    for k in range(quads):
        a = k * math.pi / quads + rng.uniform(-0.2, 0.2)
        side = np.array([math.cos(a), 0, math.sin(a)])
        up = norm([rng.uniform(-0.12, 0.12), 1, rng.uniform(-0.12, 0.12)])
        card(p, np.array([0, -0.01, 0]), up, side, w, h, 'grass', normal_at, colour)
    heads = [('daisy', (1, 1, 1)), ('five', (1.0, 0.86, 0.3)), ('five', (0.72, 0.55, 1.0)), ('five', (1.0, 0.62, 0.8)), ('cluster', (0.6, 0.72, 1.0))]
    for k in range(flowers):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.02, 0.1)
        base = np.array([math.cos(a) * r, h * rng.uniform(0.55, 0.85), math.sin(a) * r])
        up = norm([rng.uniform(-0.3, 0.3), 0.35, rng.uniform(-0.3, 0.3)] + np.array([math.cos(a), 0, math.sin(a)]) * 0.6)
        side = norm(np.cross(up, [0, 1, 0.01]))
        reg, t = heads[(k + seed) % len(heads)]
        card(p, base, up, side, 0.12, 0.12, reg, lambda q, f: np.array([0, 1.0, 0]), lambda q, t=t: srgb(t))
    return Part(), p


# ---- glb ---------------------------------------------------------------------------

MATERIALS = {
    'nature.bark': {'texture': 1, 'roughness': 0.92},
    'nature.leaves': {'texture': 0, 'roughness': 0.72, 'mask': True},
    'nature.grass': {'texture': 0, 'roughness': 0.8, 'mask': True},
    'garden.solid': {'roughness': 0.86},
    'garden.glazed': {'roughness': 0.32},
    'garden.water': {'roughness': 0.05, 'metallic': 0.0},
}


def write_glb(path, prims):
    """prims: list of (material_name, Part). Two shared external WebP textures."""
    blob = bytearray()
    views, accessors, primitives = [], [], []

    def add(arr, target, comp, typ, minmax=False):
        nonlocal blob
        while len(blob) % 4:
            blob.append(0)
        data = arr.tobytes()
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), **({'target': target} if target else {})})
        blob += data
        acc = {'bufferView': len(views) - 1, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            acc['min'] = [float(v) for v in arr.min(0)]
            acc['max'] = [float(v) for v in arr.max(0)]
        accessors.append(acc)
        return len(accessors) - 1

    materials, mat_index = [], {}
    for name, part in prims:
        if not part.i:
            continue
        pos = np.array(part.p, np.float32)
        attrs = {
            'POSITION': add(pos, 34962, 5126, 'VEC3', True),
            'NORMAL': add(np.array(part.n, np.float32), 34962, 5126, 'VEC3'),
            'TEXCOORD_0': add(np.array(part.uv, np.float32), 34962, 5126, 'VEC2'),
            'COLOR_0': add(np.array(part.c, np.float32), 34962, 5126, 'VEC3'),
        }
        if part.turns:
            bb = np.array(part.bb, np.float64)
            attrs['TEXCOORD_1'] = add(bb[:, [0, 2]].astype(np.float32), 34962, 5126, 'VEC2')
            attrs['TEXCOORD_2'] = add(bb[:, [1, 3]].astype(np.float32), 34962, 5126, 'VEC2')
            assert np.all(np.abs(bb[:, 3]) < 2 ** 24), 'packed card offset out of range'
        big = len(part.p) > 65535
        idx = add(np.array(part.i, np.uint32 if big else np.uint16), 34963, 5125 if big else 5123, 'SCALAR')
        if name not in mat_index:
            spec = MATERIALS[name]
            pbr = {'metallicFactor': spec.get('metallic', 0.0), 'roughnessFactor': spec['roughness']}
            if 'texture' in spec:
                pbr['baseColorTexture'] = {'index': spec['texture']}
            mat = {'name': name, 'pbrMetallicRoughness': pbr}
            if spec.get('mask'):
                mat.update({'alphaMode': 'MASK', 'alphaCutoff': 0.42, 'doubleSided': True})
            mat_index[name] = len(materials)
            materials.append(mat)
        primitives.append({'attributes': attrs, 'indices': idx, 'material': mat_index[name]})
    while len(blob) % 4:
        blob.append(0)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'littlelives tools/art/nature_models.py'},
        'extensionsUsed': ['EXT_texture_webp'],
        'extensionsRequired': ['EXT_texture_webp'],
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': os.path.basename(path)[:-4]}],
        'meshes': [{'primitives': primitives}],
        'materials': materials,
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}, {'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 10497}],
        'images': [{'uri': 'foliage.webp', 'mimeType': 'image/webp'}, {'uri': 'bark.webp', 'mimeType': 'image/webp'}],
        'textures': [{'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': 0}}}, {'sampler': 1, 'extensions': {'EXT_texture_webp': {'source': 1}}}],
        'buffers': [{'byteLength': len(blob)}],
        'bufferViews': views,
        'accessors': accessors,
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    with open(path, 'wb') as f:
        f.write(out)
    return sum(p.tris for _, p in prims)


# ---- species -----------------------------------------------------------------------

GREEN = (0.46, 0.62, 0.25)
PINK = (1.0, 0.7, 0.82)


def trees():
    """name -> builder(far) -> [(material, Part)]"""
    def tree(**kw):
        def build(far):
            bark_p, leaf_p, _ = clump_tree(far=far, **kw)
            return [('nature.bark', bark_p), ('nature.leaves', leaf_p)]
        return build

    def apple(far):
        bark_p, leaf_p, canopy = clump_tree(41, far, trunk_h=1.5, trunk_r=0.17, limbs=5, crown_c=[0, 3.2, 0], crown_r=[2.1, 1.6, 2.1], clumps=14, clump_r=0.9, cards=8, tint=(0.44, 0.6, 0.24), elev=(25, 48))
        if not far:
            fruit(leaf_p, canopy, random.Random(5), 26, 0.3)
        return [('nature.bark', bark_p), ('nature.leaves', leaf_p)]

    def willow(far):
        bark_p, leaf_p, canopy = clump_tree(83, far, trunk_h=2.0, trunk_r=0.28, limbs=6, crown_c=[0, 4.6, 0], crown_r=[3.0, 1.9, 3.0], clumps=14, clump_r=1.0, cards=7, region='clump.fine', tint=(0.56, 0.7, 0.3), elev=(30, 55), size_k=1.5)
        hanging_strands(leaf_p, canopy, random.Random(84), 10 if far else 26, 3.6, (0.5, 0.63, 0.28))
        return [('nature.bark', bark_p), ('nature.leaves', leaf_p)]

    def lemon(far):
        bark_p, leaf_p, canopy = clump_tree(97, far, trunk_h=0.9, trunk_r=0.06, limbs=4, crown_c=[0, 1.45, 0], crown_r=[0.6, 0.55, 0.6], clumps=9, clump_r=0.34, cards=7, tint=(0.36, 0.52, 0.2), elev=(30, 55))
        fruit(leaf_p, canopy, random.Random(9), 12, 0.09, 'fruit', (1.0, 0.86, 0.2))
        return [('nature.bark', bark_p), ('nature.leaves', leaf_p)]

    def spruce(far):
        # Blue spruce: denser, more regular and bluer than the pine, branches down to the ground.
        b, l = pine(57, far, height=9.5, base_r=2.3, tiers=24, per=8, tint=(0.66, 0.86, 1.0), droop=0.3, y0=0.35)
        return [('nature.bark', b), ('nature.leaves', l)]

    def cypress(far):
        b, l = pine(59, far, height=8.0, base_r=0.75, tiers=30, per=6, tint=(0.62, 0.8, 0.62), droop=-0.25, y0=0.4, column=True, frond=1.25)
        return [('nature.bark', b), ('nature.leaves', l)]

    def pine_(far):
        b, l = pine(53, far)
        return [('nature.bark', b), ('nature.leaves', l)]

    return {
        # Broad, rounded shade tree (oak / linden).
        'oak': tree(seed=11, trunk_h=2.4, trunk_r=0.24, limbs=7, crown_c=[0, 4.9, 0], crown_r=[2.9, 2.3, 2.9], clumps=19, clump_r=1.15, cards=9, tint=GREEN),
        # Maple: dense round crown, fresh yellow-green.
        'maple': tree(seed=17, trunk_h=2.2, trunk_r=0.22, limbs=6, crown_c=[0, 4.6, 0], crown_r=[2.6, 2.4, 2.6], clumps=18, clump_r=1.1, cards=9, region='clump.maple', tint=(0.54, 0.68, 0.24)),
        # Slender birch: white bark, airy narrow crown of small leaves, two stems.
        'birch': tree(seed=23, trunk_h=2.8, trunk_r=0.13, limbs=6, crown_c=[0, 5.2, 0], crown_r=[1.9, 2.9, 1.9], clumps=16, clump_r=0.85, cards=7, region='clump.fine', tint=(0.6, 0.72, 0.3), bark=BARK_BIRCH, elev=(50, 72), lean=0.04, stems=2, dark=0.62),
        # Cherry blossom: low spreading crown, mostly pink blossom clumps.
        'blossom': tree(seed=37, trunk_h=1.5, trunk_r=0.18, limbs=6, crown_c=[0, 3.4, 0], crown_r=[2.7, 1.5, 2.7], clumps=17, clump_r=0.95, cards=8, tint=(0.5, 0.64, 0.28), elev=(18, 40), extras=[('clump.blossom', 0.7, PINK, 1.6)], dark=0.65),
        'apple': apple,
        # Japanese maple: small, layered and red.
        'japanese_maple': tree(seed=61, trunk_h=1.0, trunk_r=0.1, limbs=6, crown_c=[0, 2.2, 0], crown_r=[1.8, 1.0, 1.8], clumps=14, clump_r=0.66, cards=7, region='clump.maple', tint=(0.82, 0.24, 0.15), elev=(12, 35), stems=2, lean=0.05, dark=0.6),
        # Magnolia: open crown with big pale pink goblet flowers.
        'magnolia': tree(seed=71, trunk_h=1.3, trunk_r=0.15, limbs=6, crown_c=[0, 3.0, 0], crown_r=[2.0, 1.6, 2.0], clumps=13, clump_r=0.8, cards=7, tint=(0.44, 0.6, 0.26), elev=(35, 60), extras=[('clump.blossom', 0.5, (1.0, 0.86, 0.9), 1.4)]),
        'willow': willow,
        'spruce': spruce,
        'cypress': cypress,
        'pine': pine_,
        'lemon': lemon,
    }


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    report = {}
    for name, build in trees().items():
        if name == 'lemon':
            continue  # potted: garden_models.py
        for far in (False, True):
            fn = f'{name}{"_far" if far else ""}.glb'
            report[fn] = write_glb(os.path.join(out, fn), build(far))
    b, l = bush(61)
    report['bush.glb'] = write_glb(os.path.join(out, 'bush.glb'), [('nature.bark', b), ('nature.leaves', l)])
    b, l = bush(67, tint=(0.36, 0.52, 0.22), flowers=('clump.flower', (1.0, 0.45, 0.75), 0.6, 1.3))
    report['bush_flowering.glb'] = write_glb(os.path.join(out, 'bush_flowering.glb'), [('nature.bark', b), ('nature.leaves', l)])
    b, l = bush(71, size=(0.8, 0.65, 0.8), clumps=4, region='clump.fine', tint=(0.38, 0.54, 0.24), cards=5)
    report['bush_small.glb'] = write_glb(os.path.join(out, 'bush_small.glb'), [('nature.bark', b), ('nature.leaves', l)])
    b, l = hedge(73)
    report['hedge.glb'] = write_glb(os.path.join(out, 'hedge.glb'), [('nature.leaves', l)])
    b, l = grass_tuft(81)
    report['grass_tuft.glb'] = write_glb(os.path.join(out, 'grass_tuft.glb'), [('nature.grass', l)])
    b, l = grass_tuft(83, w=0.26, h=0.24, quads=2, flowers=4)
    report['wildflowers.glb'] = write_glb(os.path.join(out, 'wildflowers.glb'), [('nature.grass', l)])
    for k, v in report.items():
        print(f'{k:24s} {v:6d} tris {os.path.getsize(os.path.join(out, k)) // 1024:5d} KB')


if __name__ == '__main__':
    main()
