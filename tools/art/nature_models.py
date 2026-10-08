# Procedural low-poly trees, bushes, hedges and lawn tufts as small .glb files (original, CC0).
#
# usage: python3 -I nature_models.py <out_dir>      (writes <out_dir>/*.glb next to leaves.webp / bark.webp)
#
# Every model has up to two primitives:
#   - `nature.bark`   tapered tubes (trunk, limbs, twigs) on `bark.webp` (brown | birch halves)
#   - `nature.leaves` (trees, bushes) or `nature.grass` (lawn) alpha-tested, double-sided cards on
#     `leaves.webp` (layout in nature_atlas.py). Card normals are bent towards the canopy's
#     ellipsoid so the crown shades as one soft volume (no per-card faceting), and the vertex
#     colours carry canopy self-shadowing (darker inside and underneath) plus per-card tint.
# The renderer (render/babylon/nature.ts) recognises the material names and adds wind sway.
# Textures are external (EXT_texture_webp) files in the same folder (the glTF loader rejects `..`),
# shared by all the models.
#
# Budgets: trees ~1.5-2.5k triangles (full) and ~300 (`*_far`, for distant forest instances).
import json
import math
import os
import random
import struct
import sys

import numpy as np

ATLAS = 1024.0
REG = {
    'A': (0, 0, 512, 512), 'B': (512, 0, 1024, 512), 'C': (0, 512, 512, 1024), 'D': (512, 512, 1024, 768),
    'E': (512, 768, 768, 1024), 'F': (768, 768, 1024, 896), 'G': (768, 896, 896, 1024), 'H': (896, 896, 1024, 1024),
}
BARK_BROWN = (0.02, 0.48)
BARK_BIRCH = (0.52, 0.98)


def srgb(c):
    return tuple((max(0.0, v) ** 2.2) for v in c)


def norm(v):
    v = np.asarray(v, np.float64)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


class Part:
    def __init__(self):
        self.p, self.n, self.uv, self.c, self.i = [], [], [], [], []

    def vert(self, p, n, uv, c):
        self.p.append(tuple(float(x) for x in p))
        self.n.append(tuple(float(x) for x in norm(n)))
        self.uv.append((float(uv[0]), float(uv[1])))
        self.c.append(tuple(float(x) for x in c))
        return len(self.p) - 1

    def tri(self, a, b, c):
        self.i += [a, b, c]

    @property
    def tris(self):
        return len(self.i) // 3


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


def tube(part, path, radii, sides, urange, vscale=0.9, colour=(1, 1, 1), cap=False):
    path, fr = frames(path)
    u0, u1 = urange
    length = 0.0
    rings = []
    for k, (p, (t, n, b)) in enumerate(zip(path, fr)):
        if k:
            length += np.linalg.norm(path[k] - path[k - 1])
        ring = []
        for s in range(sides + 1):
            a = 2 * math.pi * s / sides
            d = n * math.cos(a) + b * math.sin(a)
            ring.append(part.vert(p + d * radii[k], d, (u0 + (u1 - u0) * s / sides, length / vscale), colour))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for s in range(sides):
            a, b_, c, d = rings[k][s], rings[k][s + 1], rings[k + 1][s + 1], rings[k + 1][s]
            part.tri(a, c, b_)
            part.tri(a, d, c)
    if cap:
        tip = part.vert(path[-1] + fr[-1][0] * radii[-1] * 0.5, fr[-1][0], ((u0 + u1) / 2, length / vscale), colour)
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


# ---- leaf cards --------------------------------------------------------------------

def region_uv(r):
    x0, y0, x1, y1 = r
    return x0 / ATLAS, y0 / ATLAS, x1 / ATLAS, y1 / ATLAS


def card(part, base, up, side, w, h, region, normal_at, colour_at, rows=1, droop=0.0, flip=False):
    """A quad (optionally bent into `rows` rows) whose bottom edge centre is `base`, growing along `up`."""
    u0, v0, u1, v1 = region_uv(REG[region])
    w = w * (u1 - u0) / (v1 - v0)  # keep the region's aspect ratio (w is given for square cells)
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


class Canopy:
    """Ellipsoid crown used for anchors, bent normals and self-shadowing."""

    def __init__(self, centre, radii, bend=0.82, dark=0.42):
        self.c = np.asarray(centre, float)
        self.r = np.asarray(radii, float)
        self.bend = bend
        self.dark = dark

    def local(self, p):
        return (np.asarray(p) - self.c) / self.r

    def normal(self, p, face, lobe=None):
        e = self.local(p)
        sph = norm(e / self.r) if np.linalg.norm(e) > 1e-6 else np.array([0, 1.0, 0])
        if lobe is not None:
            # Lumpy crowns: half the bend follows the card's own lobe (cauliflower shading).
            lc, lr = lobe
            sph = norm(sph * 0.55 + norm((np.asarray(p) - lc) / lr) * 0.45)
        if np.dot(face, sph) < 0:
            face = -face
        return norm(sph * self.bend + face * (1 - self.bend))

    def shade(self, p):
        e = self.local(p)
        rad = float(np.linalg.norm(e))
        ao = self.dark + (1 - self.dark) * smoothstep(0.2, 1.05, rad)
        ao *= 0.78 + 0.22 * smoothstep(-0.9, 0.7, float(e[1]))
        return ao

    def point(self, rng, lo=0.55, hi=0.95, up_bias=0.25):
        while True:
            d = norm([rng.gauss(0, 1), rng.gauss(0, 1) + up_bias, rng.gauss(0, 1)])
            return self.c + d * self.r * rng.uniform(lo, hi)


def tinted(canopy, tint, jitter, rng):
    t = np.array(tint) * np.array([1 + rng.uniform(-jitter, jitter), 1 + rng.uniform(-jitter, jitter) * 0.6, 1 + rng.uniform(-jitter, jitter)])
    warm = rng.uniform(-0.06, 0.06)
    t = t * np.array([1 + warm, 1, 1 - warm])

    def f(p):
        return srgb(t * canopy.shade(p))
    return f


def leaf_cards(part, canopy, anchors, rng, size, region, tint, jitter=0.08, rows=1, droop=0.0, hang=0.0, extra_up=0.35):
    for a in anchors:
        lobe = None
        if isinstance(a, tuple):
            a, lobe = a
        out = norm(canopy.local(a) / canopy.r)
        if lobe is not None:
            out = norm(out + norm(a - lobe[0]))
        # Cards face outwards (and a little up, towards the usual high camera) so the crown reads
        # full from any side and few cards are seen edge-on; the twig points out / up in the plane.
        face = norm(out + np.array([rng.gauss(0, 0.45), rng.gauss(0, 0.3) + 0.35, rng.gauss(0, 0.45)]))
        want = out * (1 - hang) + np.array([0, extra_up - hang * 1.6, 0]) + np.array([rng.gauss(0, 0.5), rng.gauss(0, 0.3), rng.gauss(0, 0.5)])
        up = want - face * np.dot(want, face)
        if np.linalg.norm(up) < 1e-3:
            up = np.cross(face, [1.0, 0, 0])
        up = norm(up)
        side = norm(np.cross(up, face))
        h = size * rng.uniform(0.8, 1.2)
        base = np.asarray(a) - up * h * 0.38
        card(part, base, up, side, h, h, region, lambda p, f, lobe=lobe: canopy.normal(p, f, lobe), tinted(canopy, tint, jitter, rng), rows=rows, droop=droop, flip=rng.random() < 0.5)


# ---- species -----------------------------------------------------------------------

def broadleaf(seed, far, *, height, trunk_h, trunk_r, limbs, crown_c, crown_r, cards, card_size, bark=BARK_BROWN,
              leaf_region='A', leaf_tint=(0.9, 0.95, 0.85), elev=(35, 60), extras=(), hang=0.0, lean=0.0, stems=1, dark=0.42):
    rng = random.Random(seed)
    bark_p, leaf_p = Part(), Part()
    canopy = Canopy(crown_c, crown_r, dark=dark)
    sides_t, sides_l = (5, 3) if far else (8, 5)
    branches = []
    lobes = [canopy.c + np.array([0, canopy.r[1] * 0.45, 0])]
    for st in range(stems):
        off = np.array([0.0, 0, 0]) if st == 0 else np.array([rng.uniform(-0.3, 0.3), 0, rng.uniform(-0.3, 0.3)])
        lean_v = np.array([lean * (1 if st == 0 else -0.7), 0, lean * 0.3 * (1 if st == 0 else 1)])
        top = np.array([0, trunk_h, 0]) + lean_v * trunk_h + off
        steps = 2 if far else 5
        trunk = curve(off, top, [rng.uniform(-0.15, 0.15), 0, rng.uniform(-0.15, 0.15)], steps)
        tr = trunk_r * (1 if st == 0 else 0.75)
        radii = [tr * (1 + 0.5 * max(0, 1 - k / (steps * 0.25)) ** 2) * (1 - 0.35 * k / steps) for k in range(steps + 1)]
        tube(bark_p, trunk, radii, sides_t, bark)
        # Leader on up into the crown.
        leader_end = canopy.c + np.array([rng.uniform(-0.2, 0.2), canopy.r[1] * 0.72, rng.uniform(-0.2, 0.2)]) + off * 0.5
        leader = curve(top, leader_end, [rng.uniform(-0.2, 0.2), 0, rng.uniform(-0.2, 0.2)], 2 if far else 3)
        tube(bark_p, leader, np.linspace(tr * 0.62, tr * 0.12, len(leader)), sides_l, bark, cap=True)
        branches.append((leader, 0.6))
        n = max(3, limbs // (1 if far else 1)) if not far else max(3, limbs - 2)
        for k in range(n):
            az = 2 * math.pi * (k + rng.uniform(-0.3, 0.3)) / n + st
            el = math.radians(rng.uniform(*elev))
            t0 = rng.uniform(0.62, 0.95)
            start = trunk[0] + (trunk[-1] - trunk[0]) * t0
            d = np.array([math.cos(az) * math.cos(el), math.sin(el), math.sin(az) * math.cos(el)])
            target = canopy.c + norm(d * canopy.r + np.array([0, 0.2, 0])) * canopy.r * rng.uniform(0.62, 0.82)
            limb = curve(start, target, [0, -0.25, 0] + d * 0.1, 2 if far else 4, rng, 0.06)
            lobes.append(np.maximum(target, [-1e9, canopy.c[1] - canopy.r[1] * 0.2, -1e9]))
            rl = tr * rng.uniform(0.45, 0.6)
            tube(bark_p, limb, np.linspace(rl, rl * 0.18, len(limb)), sides_l, bark, cap=True)
            branches.append((limb, 1.0))
            if far:
                continue
            for j in range(2):
                p, dirv = lerp_path(limb, rng.uniform(0.4, 0.8))
                sd = norm(dirv + np.array([rng.uniform(-0.9, 0.9), rng.uniform(0.0, 0.6), rng.uniform(-0.9, 0.9)]))
                end = canopy.c + norm(canopy.local(p + sd * 2.0)) * canopy.r * rng.uniform(0.75, 0.9)
                twig = curve(p, end, [0, -0.1, 0], 2)
                tube(bark_p, twig, np.linspace(rl * 0.45, rl * 0.1, len(twig)), 4, bark, cap=True)
                branches.append((twig, 0.8))
    # Leaf anchors: lobes of foliage around the limb ends (an irregular, cloud-like crown), some
    # along the branches, and a few filling the shell between the lobes.
    anchors = []
    lobe_r = float(np.mean(canopy.r)) * 0.52
    per_lobe = int(cards * 0.62 / len(lobes))
    for lc in lobes:
        lr = lobe_r * rng.uniform(0.85, 1.15)
        for _ in range(per_lobe):
            q = lc + norm([rng.gauss(0, 1), rng.gauss(0, 1) + 0.3, rng.gauss(0, 1)]) * lr * rng.uniform(0.35, 0.95)
            if np.linalg.norm(canopy.local(q)) < 1.08:
                anchors.append((q, (lc, lr)))
    per = max(1, int(cards * 0.15 / max(1, len(branches))))
    for path, w in branches:
        for _ in range(per):
            p, _ = lerp_path(path, rng.uniform(0.45, 1.0))
            anchors.append(p)
    while len(anchors) < cards:
        anchors.append(canopy.point(rng, 0.45, 0.85))
    rng.shuffle(anchors)
    main = anchors
    for kind in extras:
        region, share, tint, size_k = kind
        k = int(len(anchors) * share)
        extra, main = main[:k], main[k:]
        leaf_cards(leaf_p, canopy, extra, rng, card_size * size_k, region, tint, 0.05, hang=hang)
    leaf_cards(leaf_p, canopy, main, rng, card_size, leaf_region, leaf_tint, hang=hang)
    return bark_p, leaf_p


def fruit_cards(part, canopy, rng, n, size):
    for _ in range(n):
        p = canopy.point(rng, 0.88, 1.0, up_bias=-0.2)
        for rot in (0, math.pi / 2):
            side = np.array([math.cos(rot + p[0]), 0, math.sin(rot + p[0])])
            card(part, p - np.array([0, size * 0.7, 0]), np.array([0, 1.0, 0]), side, size, size, 'G', canopy.normal, lambda q: srgb((1, 1, 1)))


def conifer(seed, far, height=9.0, base_r=2.4):
    rng = random.Random(seed)
    bark_p, leaf_p = Part(), Part()
    trunk = curve([0, 0, 0], [0, height - 1.0, 0], [rng.uniform(-0.1, 0.1), 0, rng.uniform(-0.1, 0.1)], 3 if far else 6)
    tube(bark_p, trunk, np.linspace(0.24, 0.03, len(trunk)), 5 if far else 8, BARK_BROWN, cap=True)
    tiers = 11 if far else 17
    per = 5 if far else 7
    golden = math.pi * (3 - math.sqrt(5))
    y0, y1 = 1.1, height - 0.7

    def cone_r(y):
        return base_r * max(0.0, 1 - (y - y0) / (height - y0)) ** 0.9 + 0.3

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
        L = cone_r(y) * (1.15 if far else 1.05)
        for k in range(per):
            az = t * golden + 2 * math.pi * k / per + rng.uniform(-0.25, 0.25)
            el = math.radians(rng.uniform(-8, 14) if far else rng.uniform(-6, 18))
            d = np.array([math.cos(az) * math.cos(el), math.sin(el), math.sin(az) * math.cos(el)])
            side = norm(np.cross(d, [0, 1, 0]))
            tilt = rng.uniform(-0.35, 0.35)
            side = norm(side * math.cos(tilt) + np.array([0, 1.0, 0]) * math.sin(tilt))
            tint = (0.82 + rng.uniform(-0.06, 0.06), 0.92 + rng.uniform(-0.05, 0.05), 0.86 + rng.uniform(-0.06, 0.06))
            card(leaf_p, np.array([0, y, 0]) - d * 0.15, d, side, L * 0.95, L, 'C', normal_at, colour_at(tint), rows=1 if far else 2, droop=0.22 if not far else 0.15, flip=rng.random() < 0.5)
    # Spire: a few steep fronds around the leader.
    for k in range(2):
        a = k * math.pi / 2 + 0.4
        side = np.array([math.cos(a), 0, math.sin(a)])
        card(leaf_p, np.array([0, height - 1.9, 0]), np.array([0, 1.0, 0]), side, 0.6, 1.7, 'C', normal_at, colour_at((0.85, 0.95, 0.88)))
    return bark_p, leaf_p


def bush(seed, size=(1.1, 0.9, 1.0), cards=64, card_size=0.5, region='B', tint=(0.78, 0.9, 0.74), flowers=None):
    rng = random.Random(seed)
    bark_p, leaf_p = Part(), Part()
    w, h, d = size
    canopy = Canopy([0, h * 0.5, 0], [w * 0.42, h * 0.42, d * 0.42], bend=0.88, dark=0.4)
    for k in range(4):
        a = k * math.pi / 2 + rng.uniform(-0.4, 0.4)
        end = np.array([math.cos(a) * w * 0.22, h * 0.55, math.sin(a) * d * 0.22])
        tube(bark_p, curve([0, 0, 0], end, [0, 0, 0], 2), [0.035, 0.025, 0.012], 4, BARK_BROWN)
    anchors = [canopy.point(rng, 0.5, 0.92, up_bias=0.35) for _ in range(cards)]
    leaf_cards(leaf_p, canopy, anchors, rng, card_size, region, tint, extra_up=0.5)
    if flowers:
        region_f, tint_f, n, fsize = flowers
        fl = [canopy.point(rng, 0.9, 1.05, up_bias=0.9) for _ in range(n)]
        leaf_cards(leaf_p, canopy, fl, rng, fsize, region_f, tint_f, 0.05, extra_up=0.9)
    return bark_p, leaf_p


def hedge(seed, length=1.0, height=0.85, depth=0.6, cards=110, card_size=0.36):
    rng = random.Random(seed)
    leaf_p = Part()
    hx, hy, hz = length / 2, height / 2, depth / 2
    c = np.array([0, hy, 0])

    def sdf_normal(p, face):
        q = (np.asarray(p) - c) / np.array([hx, hy, hz])
        g = norm(np.sign(q) * np.abs(q) ** 5)
        if np.dot(face, g) < 0:
            face = -face
        return norm(g * 0.85 + face * 0.15)

    def colour(p):
        y = (p[1]) / height
        q = np.abs((np.asarray(p) - c) / np.array([hx, hy, hz]))
        edge = smoothstep(0.5, 1.0, max(q[0] * 0.3, q[1], q[2]))
        k = (0.55 + 0.45 * edge) * (0.72 + 0.28 * smoothstep(0, 1, y))
        return srgb(np.array(tint) * k)

    for _ in range(cards):
        # Points on the top and the two long faces (the ends are hidden by the next segment).
        face = rng.random()
        if face < 0.36:
            p = np.array([rng.uniform(-hx, hx), height - 0.12, rng.uniform(-hz, hz) * 0.85]); out = np.array([0, 1.0, 0])
        elif face < 0.68:
            p = np.array([rng.uniform(-hx, hx), rng.uniform(0.08, height - 0.1), hz - 0.1]); out = np.array([0, 0.2, 1.0])
        else:
            p = np.array([rng.uniform(-hx, hx), rng.uniform(0.08, height - 0.1), -hz + 0.1]); out = np.array([0, 0.2, -1.0])
        tint = (0.66 * rng.uniform(0.92, 1.08), 0.84 * rng.uniform(0.95, 1.05), 0.66 * rng.uniform(0.92, 1.08))
        # Cards lie almost flat on the faces (clipped look), tilted out a little.
        rnd = norm([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)])
        tangent = norm(rnd - out * np.dot(rnd, norm(out)))
        up = norm(tangent + norm(out) * 0.3)
        p = p - norm(out) * 0.04
        side = norm(np.cross(up, norm([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)])))
        s = card_size * rng.uniform(0.85, 1.15)
        card(leaf_p, p - up * s * 0.45, up, side, s, s, 'B', sdf_normal, colour, flip=rng.random() < 0.5)
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
        card(p, np.array([0, -0.01, 0]), up, side, w, h, 'E', normal_at, colour)
    tints = [(1.0, 0.86, 0.3), (1, 1, 1), (0.72, 0.52, 1.0), (1.0, 0.62, 0.8)]
    for k in range(flowers):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.02, 0.1)
        base = np.array([math.cos(a) * r, h * rng.uniform(0.55, 0.85), math.sin(a) * r])
        up = norm([rng.uniform(-0.3, 0.3), 0.35, rng.uniform(-0.3, 0.3)] + np.array([math.cos(a), 0, math.sin(a)]) * 0.6)
        side = norm(np.cross(up, [0, 1, 0.01]))
        t = tints[k % len(tints)]
        card(p, base, up, side, 0.14, 0.14, 'H', lambda q, f: np.array([0, 1.0, 0]), lambda q, t=t: srgb(t))
    return Part(), p


# ---- glb ---------------------------------------------------------------------------

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

    materials = []
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
        big = len(part.p) > 65535
        idx = add(np.array(part.i, np.uint32 if big else np.uint16), 34963, 5125 if big else 5123, 'SCALAR')
        bark = name == 'nature.bark'
        mat = {'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': 1 if bark else 0}, 'metallicFactor': 0.0, 'roughnessFactor': 0.92 if bark else 0.72}}
        if not bark:
            mat.update({'alphaMode': 'MASK', 'alphaCutoff': 0.42, 'doubleSided': True})
        materials.append(mat)
        primitives.append({'attributes': attrs, 'indices': idx, 'material': len(materials) - 1})
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
        'images': [{'uri': 'leaves.webp', 'mimeType': 'image/webp'}, {'uri': 'bark.webp', 'mimeType': 'image/webp'}],
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


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    PINK = (1.0, 0.66, 0.8)
    trees = {
        # Broad, rounded deciduous tree (oak / linden).
        'oak': lambda far: broadleaf(11, far, height=7.2, trunk_h=2.5, trunk_r=0.2, limbs=6, crown_c=[0, 4.7, 0], crown_r=[2.7, 2.2, 2.7], cards=85 if far else 250, card_size=(1.8 if far else 1.25), leaf_tint=(0.86, 0.94, 0.8)),
        # Slender birch: white bark, airy narrow crown of small hanging leaves, two stems.
        'birch': lambda far: broadleaf(23, far, height=8.0, trunk_h=2.6, trunk_r=0.12, limbs=5, crown_c=[0, 5.0, 0], crown_r=[2.0, 2.9, 2.0], cards=60 if far else 240, card_size=(1.6 if far else 1.05), bark=BARK_BIRCH, leaf_region='F', leaf_tint=(1.0, 1.0, 0.86), elev=(50, 70), hang=0.35, lean=0.04, stems=2, dark=0.55),
        # Cherry blossom: low spreading crown, pink blossom cards among light leaves.
        'blossom': lambda far: broadleaf(37, far, height=5.2, trunk_h=1.5, trunk_r=0.17, limbs=5, crown_c=[0, 3.4, 0], crown_r=[2.6, 1.5, 2.6], cards=55 if far else 220, card_size=(1.7 if far else 1.1), leaf_tint=(0.92, 1.0, 0.82), elev=(22, 42), extras=[('D', 0.62, PINK, 0.8)], dark=0.6),
        # Apple tree: compact rounded crown with fruit.
        'apple': lambda far: broadleaf(41, far, height=5.0, trunk_h=1.6, trunk_r=0.16, limbs=5, crown_c=[0, 3.3, 0], crown_r=[2.1, 1.6, 2.1], cards=50 if far else 210, card_size=(1.6 if far else 1.05), leaf_tint=(0.8, 0.9, 0.72), elev=(28, 50)),
    }
    report = {}
    for name, build in trees.items():
        for far in (False, True):
            bark_p, leaf_p = build(far)
            if name == 'apple' and not far:
                fruit_cards(leaf_p, Canopy([0, 3.3, 0], [2.1, 1.6, 2.1]), random.Random(5), 16, 0.32)
            fn = f'{name}{"_far" if far else ""}.glb'
            report[fn] = write_glb(os.path.join(out, fn), [('nature.bark', bark_p), ('nature.leaves', leaf_p)])
    for far in (False, True):
        bark_p, leaf_p = conifer(53, far)
        fn = f'pine{"_far" if far else ""}.glb'
        report[fn] = write_glb(os.path.join(out, fn), [('nature.bark', bark_p), ('nature.leaves', leaf_p)])
    b, l = bush(61)
    report['bush.glb'] = write_glb(os.path.join(out, 'bush.glb'), [('nature.bark', b), ('nature.leaves', l)])
    b, l = bush(67, tint=(0.82, 0.92, 0.78), flowers=('D', (1.0, 0.55, 0.85), 18, 0.24))
    report['bush_flowering.glb'] = write_glb(os.path.join(out, 'bush_flowering.glb'), [('nature.bark', b), ('nature.leaves', l)])
    b, l = bush(71, size=(0.8, 0.65, 0.8), cards=40, card_size=0.4, region='A', tint=(0.72, 0.86, 0.7))
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
