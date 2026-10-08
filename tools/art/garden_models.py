# The garden catalog's models (original, CC0): flowers, shrubs, potted and house plants, fruit and
# vegetables and garden decor, as small .glb files next to the trees (same textures, see
# nature_models.py for the card and material conventions).
#
# usage: python3 -I garden_models.py <out_dir>      (writes <out_dir>/garden_*.glb)
#
# Conventions: 1 unit = 1 metre, origin at the footprint centre on the floor, front facing +Z,
# kept ~4 cm inside the footprint (1 x 1 m unless noted). Foliage and flower heads are cards on the
# foliage atlas (`nature.leaves`, so they sway in the wind); pots, beds, stone and water are
# untextured vertex-coloured meshes (`garden.solid`, `garden.glazed`, `garden.water`).
import math
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nature_models import (  # noqa: E402
    BARK_BROWN, Canopy, Part, bush, card, clump, clump_tree, curve, facing_card, hedge, norm, region_uv,
    rot_y, smoothstep, srgb, trees, tube, write_glb,
)

UP = np.array([0, 1.0, 0])
STEM = (0.46, 0.64, 0.26)
LEAF = (0.48, 0.68, 0.28)
# Flower heads read at the game's camera distance only a little larger than life.
HEAD_SCALE = 1.3
# Small plants sit low in the sun and their crowns are thin: lighter than a tree's self-shadowing.
MOUND_LIGHT = 1.3


# ---- solid meshes ------------------------------------------------------------------

def lathe(part, profile, segments=20, colour=(0.7, 0.4, 0.25), y_shade=True, jitter=0.0, rng=None, ribs=0, rib_depth=0.0):
    """Revolves `profile` [(radius, y), ...] (bottom to top, outside then inside) around the y axis."""
    rings = []
    n = len(profile)
    for k, (r, y) in enumerate(profile):
        # Profile normal from the neighbouring points (outward in r, up/down in y).
        r0, y0 = profile[max(0, k - 1)]
        r1, y1 = profile[min(n - 1, k + 1)]
        tr, ty = r1 - r0, y1 - y0
        nr, ny = ty, -tr
        L = math.hypot(nr, ny) or 1
        nr, ny = nr / L, ny / L
        ring = []
        for s in range(segments + 1):
            a = 2 * math.pi * s / segments
            rr = r * (1 - rib_depth * (0.5 - 0.5 * math.cos(a * ribs))) if ribs else r
            p = (math.cos(a) * rr, y, math.sin(a) * rr)
            nrm = (math.cos(a) * nr, ny, math.sin(a) * nr)
            c = colour(y) if callable(colour) else colour
            k_ = 1.0
            if jitter and rng:
                k_ = 1 + rng.uniform(-jitter, jitter)
            ring.append(part.vert(p, nrm, (0, 0), srgb(np.array(c) * k_)))
        rings.append(ring)
    for k in range(n - 1):
        for s in range(segments):
            a, b, c, d = rings[k][s], rings[k][s + 1], rings[k + 1][s + 1], rings[k + 1][s]
            part.tri(a, c, b)
            part.tri(a, d, c)


def box(part, centre, size, colour, top_colour=None, bevel=0.0):
    """An axis-aligned box (flat normals)."""
    cx, cy, cz = centre
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    faces = [
        ((1, 0, 0), [(hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)]),
        ((-1, 0, 0), [(-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz), (-hx, -hy, -hz)]),
        ((0, 1, 0), [(-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz)]),
        ((0, -1, 0), [(-hx, -hy, hz), (-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz)]),
        ((0, 0, 1), [(hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz), (-hx, -hy, hz)]),
        ((0, 0, -1), [(-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz), (hx, -hy, -hz)]),
    ]
    for n, quad in faces:
        c = top_colour if (top_colour and n[1] == 1) else colour
        shade = 1.0 if n[1] == 1 else 0.9 if n[1] == 0 else 0.7
        ids = [part.vert((cx + x, cy + y, cz + z), n, (0, 0), srgb(np.array(c) * shade)) for x, y, z in quad]
        part.tri(ids[0], ids[1], ids[2])
        part.tri(ids[0], ids[2], ids[3])


def ellipsoid(part, centre, radii, colour, segments=14, rings=9, ribs=0, rib_depth=0.0, dark_bottom=0.75):
    cx, cy, cz = centre
    grid = []
    for i in range(rings + 1):
        v = i / rings
        th = math.pi * v
        row = []
        for j in range(segments + 1):
            ph = 2 * math.pi * j / segments
            k = 1 - rib_depth * (0.5 - 0.5 * math.cos(ph * ribs)) if ribs else 1
            n = np.array([math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)])
            p = np.array([cx, cy, cz]) + n * np.array(radii) * np.array([k, 1, k])
            c = np.array(colour) * (dark_bottom + (1 - dark_bottom) * (0.5 + 0.5 * n[1]))
            row.append(part.vert(p, norm(n / np.array(radii)), (0, 0), srgb(c)))
        grid.append(row)
    for i in range(rings):
        for j in range(segments):
            a, b, c, d = grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]
            part.tri(a, b, c)
            part.tri(a, c, d)


def disc(part, centre, radius, region=None, colour=(1, 1, 1), segments=20, wobble=0.0, rng=None, dome=0.0, normal=(0, 1, 0)):
    """A flat (or slightly domed) disc; on an atlas region it maps the region's middle."""
    cx, cy, cz = centre
    if region:
        u0, v0, u1, v1 = region_uv(region)
        uc, vc, ur, vr = (u0 + u1) / 2, (v0 + v1) / 2, (u1 - u0) * 0.45, (v1 - v0) * 0.45
    else:
        uc = vc = ur = vr = 0
    mid = part.vert((cx, cy + dome, cz), normal, (uc, vc), srgb(colour))
    ids = []
    for s in range(segments):
        a = 2 * math.pi * s / segments
        r = radius * (1 + (rng.uniform(-wobble, wobble) if rng and wobble else 0))
        ids.append(part.vert((cx + math.cos(a) * r, cy, cz + math.sin(a) * r), normal, (uc + math.cos(a) * ur, vc + math.sin(a) * vr), srgb(np.array(colour) * 0.92)))
    for s in range(segments):
        part.tri(mid, ids[(s + 1) % segments], ids[s])


def soil_patch(leaf, rng, radius=0.42, height=0.035, colour=(1.0, 0.92, 0.84), square=False):
    """Soil / mulch under a planting (on the atlas' soil region, so it shares the leaves' draw)."""
    if square:
        u0, v0, u1, v1 = region_uv('soil')
        h = radius
        pts = [(-h, -h), (h, -h), (h, h), (-h, h)]
        ids = [leaf.vert((x, height, z), UP, (u0 + (u1 - u0) * (x / h * 0.45 + 0.5), v0 + (v1 - v0) * (z / h * 0.45 + 0.5)), srgb(colour)) for x, z in pts]
        leaf.tri(ids[0], ids[2], ids[1])
        leaf.tri(ids[0], ids[3], ids[2])
        return
    disc(leaf, (0, height * 0.3, 0), radius, 'soil', colour, segments=18, wobble=0.08, rng=rng, dome=height)


def pot(solid, radius=0.18, height=0.3, colour=(0.72, 0.4, 0.26), rim=True, flare=1.18, base=0.0, glazed=None):
    """A flower pot (terracotta by default) standing on y = `base`; returns the soil height."""
    r0, r1 = radius / flare, radius
    prof = [(0.0, base), (r0, base), (r0 * 1.0, base + 0.01), (r1, base + height * 0.86)]
    if rim:
        prof += [(r1 * 1.08, base + height * 0.86), (r1 * 1.08, base + height), (r1 * 0.94, base + height)]
    else:
        prof += [(r1, base + height), (r1 * 0.94, base + height)]
    prof += [(r1 * 0.9, base + height * 0.9)]
    target = solid
    lathe(target, prof, 22, lambda y: np.array(colour) * (0.86 + 0.14 * smoothstep(base, base + height, y)))
    return base + height * 0.9


def soil_top(leaf, y, radius):
    disc(leaf, (0, y, 0), radius, 'soil', (0.8, 0.75, 0.7), segments=16)


def wood_box(solid, w, d, h, colour=(0.55, 0.38, 0.24), plank=0.12, base=0.0, leg=0.0):
    """A planter made of horizontal planks (alternating shades) on optional legs."""
    rng = random.Random(int(w * 100 + d * 10 + h))
    y = base + leg
    k = 0
    while y < base + leg + h - 1e-6:
        ph = min(plank, base + leg + h - y)
        shade = 0.9 + 0.12 * (k % 2) + rng.uniform(-0.03, 0.03)
        c = tuple(np.array(colour) * shade)
        box(solid, (0, y + ph / 2, d / 2 - 0.015), (w, ph * 0.94, 0.03), c)
        box(solid, (0, y + ph / 2, -d / 2 + 0.015), (w, ph * 0.94, 0.03), c)
        box(solid, (w / 2 - 0.015, y + ph / 2, 0), (0.03, ph * 0.94, d - 0.06), c)
        box(solid, (-w / 2 + 0.015, y + ph / 2, 0), (0.03, ph * 0.94, d - 0.06), c)
        y += ph
        k += 1
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(solid, (sx * (w / 2 - 0.03), base + (leg + h) / 2, sz * (d / 2 - 0.03)), (0.06, leg + h + 0.02, 0.06), tuple(np.array(colour) * 0.8))
    return base + leg + h - 0.03


# ---- plant parts -------------------------------------------------------------------

def stem(leaf, path, r0, r1=None, colour=STEM, sides=4):
    u0, v0, u1, v1 = region_uv('stem')
    r1 = r0 * 0.6 if r1 is None else r1
    tube(leaf, path, np.linspace(r0, r1, len(path)), sides, (u0, u1), colour=srgb(colour), vrange=(v1, v0))


def soft_normal(up=0.65):
    def f(p, face):
        if face[1] < 0:
            face = -face
        return norm(face * (1 - up) + UP * up)
    return f


def blade(leaf, base, direction, length, region, colour, rng, droop=0.15, rows=2, width=None, up=0.6):
    """A leaf or frond card growing from `base` along `direction` (side view sprites)."""
    d = norm(direction)
    side = norm(np.cross(d, [rng.uniform(-0.3, 0.3), 1.0, rng.uniform(-0.3, 0.3)] if abs(d[1]) < 0.95 else [1.0, 0, 0.2]))
    w = length if width is None else width
    col = srgb(np.array(colour) * rng.uniform(0.92, 1.06))
    card(leaf, np.asarray(base, float), d, side, w, length, region, soft_normal(up), lambda p: col, rows=rows, droop=droop, flip=rng.random() < 0.5)


def head(leaf, centre, size, region, colour, facing=(0, 1, 0), rng=None, spin=None):
    """A flower head (front-view sprite) at `centre`, facing `facing`."""
    size *= HEAD_SCALE
    f = norm(facing)
    ref = np.array([1.0, 0, 0]) if abs(f[0]) < 0.9 else np.array([0, 0, 1.0])
    side = norm(np.cross(f, ref))
    up = norm(np.cross(side, f))
    if spin is not None:
        c, s = math.cos(spin), math.sin(spin)
        side, up = side * c + up * s, up * c - side * s
    base = np.asarray(centre, float) - up * size / 2
    col = srgb(colour)
    card(leaf, base, up, side, size, size, region, lambda p, fc: norm(f * 0.5 + UP * 0.5), lambda p: col, flip=bool(rng and rng.random() < 0.5))


def upright(leaf, centre, size, region, colour, rng, normal=(0, 0.6, 0.8)):
    """A side-view sprite that turns about the vertical towards the camera (tulip cups, spikes)."""
    facing_card(leaf, centre, size, region, norm(normal), srgb(colour), face=(0, 0, 1.0), cylinder=True, flip=rng.random() < 0.5)


def grid_points(rng, n, half=0.38, jitter=0.06):
    """Roughly even planting positions in a square bed."""
    k = max(1, int(round(math.sqrt(n))))
    pts = []
    for i in range(k):
        for j in range(k):
            x = -half + 2 * half * (i + 0.5) / k + rng.uniform(-jitter, jitter)
            z = -half + 2 * half * (j + 0.5) / k + rng.uniform(-jitter, jitter)
            pts.append((x, z))
    rng.shuffle(pts)
    return pts[:n] if n <= len(pts) else pts


def disc_points(rng, n, radius=0.38):
    pts = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        r = radius * math.sqrt((i + 0.5) / n)
        a = i * golden + rng.uniform(-0.2, 0.2)
        pts.append((math.cos(a) * r + rng.uniform(-0.03, 0.03), math.sin(a) * r + rng.uniform(-0.03, 0.03)))
    return pts


def leaf_mound(leaf, rng, centre, radius, height, region='clump.fine', tint=LEAF, clumps=4, cards=4):
    """A low mound of foliage (camera-facing clumps)."""
    canopy = Canopy([centre[0], height * 0.5, centre[1]], [radius, height * 0.6, radius], dark=0.75)
    for k in range(clumps):
        a = 2 * math.pi * k / clumps + rng.uniform(-0.3, 0.3)
        r = radius * (0.45 if clumps > 1 else 0)
        c = np.array([centre[0] + math.cos(a) * r, height * rng.uniform(0.45, 0.6), centre[1] + math.sin(a) * r])
        clump(leaf, canopy, c, radius * 0.55, rng, region, tint, cards, size_k=1.5, light=MOUND_LIGHT)
    return canopy


# ---- flowers (1 x 1 beds) ----------------------------------------------------------

def tulips(seed, colours):
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    soil_patch(leaf, rng)
    for i, (x, z) in enumerate(disc_points(rng, 26, 0.4)):
        h = rng.uniform(0.34, 0.46)
        for k in range(2):
            a = rng.uniform(0, 2 * math.pi)
            blade(leaf, (x, 0.03, z), [math.cos(a) * 0.35, 1, math.sin(a) * 0.35], h * 0.65, 'strap', LEAF, rng, droop=0.1, width=0.1)
        top = np.array([x + rng.uniform(-0.03, 0.03), h, z + rng.uniform(-0.03, 0.03)])
        stem(leaf, curve([x, 0.03, z], top, [0.01, 0, 0.01], 3), 0.008)
        upright(leaf, top + np.array([0, 0.06, 0]), 0.16, 'tulip', colours[i % len(colours)], rng)
    return [('nature.leaves', leaf), ('garden.solid', solid)]


def daffodils(seed):
    rng = random.Random(seed)
    leaf = Part()
    soil_patch(leaf, rng)
    for (x, z) in disc_points(rng, 24, 0.4):
        h = rng.uniform(0.3, 0.4)
        for k in range(2):
            a = rng.uniform(0, 2 * math.pi)
            blade(leaf, (x, 0.03, z), [math.cos(a) * 0.3, 1, math.sin(a) * 0.3], h * 0.8, 'strap', LEAF, rng, droop=0.12, width=0.09)
        a = rng.uniform(0, 2 * math.pi)
        top = np.array([x, h, z])
        stem(leaf, curve([x, 0.03, z], top, [0, 0, 0], 2), 0.007)
        head(leaf, top + np.array([math.cos(a) * 0.03, 0, math.sin(a) * 0.03]), 0.11, 'daffodil', (1, 1, 1), facing=(math.cos(a), 0.9, math.sin(a)), rng=rng)
    return [('nature.leaves', leaf)]


def daisies(seed):
    rng = random.Random(seed)
    leaf = Part()
    soil_patch(leaf, rng)
    for c in [(-0.18, -0.15), (0.18, -0.12), (0.0, 0.2), (-0.22, 0.2), (0.24, 0.22)]:
        leaf_mound(leaf, rng, c, 0.2, 0.16, 'clump.broad', (0.42, 0.6, 0.26), clumps=2, cards=3)
    for (x, z) in disc_points(rng, 46, 0.42):
        h = rng.uniform(0.18, 0.3)
        stem(leaf, [np.array([x, 0.05, z]), np.array([x, h, z])], 0.004)
        head(leaf, (x, h, z), rng.uniform(0.08, 0.1), 'daisy', (1, 1, 1), facing=(rng.uniform(-0.3, 0.3), 1, rng.uniform(-0.3, 0.3)), rng=rng)
    return [('nature.leaves', leaf)]


def sunflowers(seed):
    rng = random.Random(seed)
    leaf = Part()
    soil_patch(leaf, rng)
    for i, (x, z) in enumerate([(-0.2, -0.18), (0.2, -0.16), (0.0, 0.05), (-0.22, 0.22), (0.22, 0.24)]):
        h = rng.uniform(1.45, 1.85)
        top = np.array([x + rng.uniform(-0.05, 0.05), h, z + 0.05])
        path = curve([x, 0.03, z], top, [0, 0, 0.04], 5)
        stem(leaf, path, 0.022, 0.014)
        for k in range(6):
            t = 0.2 + 0.12 * k
            p = path[0] + (path[-1] - path[0]) * t
            a = k * 2.4 + rng.uniform(-0.3, 0.3)
            blade(leaf, p, [math.cos(a), 0.35, math.sin(a)], rng.uniform(0.2, 0.28), 'heart', (0.4, 0.58, 0.22), rng, droop=0.25, up=0.5)
        a = rng.uniform(-0.6, 0.6)
        head(leaf, top + np.array([0, 0.02, 0.05]), rng.uniform(0.3, 0.36), 'sunflower', (1, 1, 1), facing=(math.sin(a), 0.55, math.cos(a)), rng=rng)
    return [('nature.leaves', leaf)]


def poppies(seed):
    rng = random.Random(seed)
    leaf = Part()
    soil_patch(leaf, rng)
    for (x, z) in disc_points(rng, 9, 0.32):
        for k in range(3):
            a = rng.uniform(0, 6.3)
            blade(leaf, (x, 0.03, z), [math.cos(a) * 0.6, 0.6, math.sin(a) * 0.6], 0.18, 'feather', (0.46, 0.6, 0.3), rng, droop=0.1)
    for (x, z) in disc_points(rng, 30, 0.42):
        h = rng.uniform(0.38, 0.6)
        top = np.array([x + rng.uniform(-0.06, 0.06), h, z + rng.uniform(-0.06, 0.06)])
        stem(leaf, curve([x, 0.03, z], top, [rng.uniform(-0.05, 0.05), 0, rng.uniform(-0.05, 0.05)], 3), 0.005)
        col = (0.95, 0.18, 0.1) if rng.random() < 0.8 else (1.0, 0.5, 0.15)
        head(leaf, top, rng.uniform(0.1, 0.13), 'poppy', col, facing=(rng.uniform(-0.4, 0.4), 1, rng.uniform(-0.4, 0.4)), rng=rng)
    return [('nature.leaves', leaf)]


def mound_flowers(seed, region, colours, n=22, size=(0.08, 0.1), mound_tint=(0.4, 0.58, 0.24), mound_region='clump.fine', height=0.28, mounds=5):
    """Bedding plants: low leafy mounds dotted with flower heads (marigolds, pansies, ...)."""
    rng = random.Random(seed)
    leaf = Part()
    soil_patch(leaf, rng)
    for c in disc_points(rng, mounds + 3, 0.3):
        leaf_mound(leaf, rng, c, 0.18, height * 0.75, mound_region, mound_tint, clumps=2, cards=3)
    for i, (x, z) in enumerate(disc_points(rng, int(n * 1.5), 0.4)):
        y = height * rng.uniform(0.75, 1.05)
        head(leaf, (x, y, z), rng.uniform(*size), region, colours[i % len(colours)], facing=(rng.uniform(-0.35, 0.35), 1, rng.uniform(-0.35, 0.35)), rng=rng)
    return [('nature.leaves', leaf)]


def lilies(seed):
    rng = random.Random(seed)
    leaf = Part()
    soil_patch(leaf, rng)
    for (x, z) in disc_points(rng, 9, 0.32):
        for k in range(6):
            a = rng.uniform(0, 6.3)
            blade(leaf, (x, 0.03, z), [math.cos(a) * 0.5, 1, math.sin(a) * 0.5], 0.42, 'strap', LEAF, rng, droop=0.18, width=0.14)
        h = rng.uniform(0.7, 0.85)
        top = np.array([x, h, z])
        stem(leaf, curve([x, 0.03, z], top, [0, 0, 0], 3), 0.009)
        for k in range(rng.choice((2, 3))):
            a = rng.uniform(0, 6.3)
            col = (1.0, 0.55, 0.2) if (k + int(x * 10)) % 2 else (1.0, 0.7, 0.8)
            head(leaf, top + np.array([math.cos(a) * 0.06, 0.01, math.sin(a) * 0.06]), 0.17, 'star', col, facing=(math.cos(a), 0.7, math.sin(a)), rng=rng)
    return [('nature.leaves', leaf)]


def spikes(seed, colours, region='spike', n=10, height=(0.75, 1.0), size=0.42, foliage='clump.maple'):
    """Tall flower spikes over a mound of leaves (lupins, foxgloves)."""
    rng = random.Random(seed)
    leaf = Part()
    soil_patch(leaf, rng)
    for c in disc_points(rng, 4, 0.22):
        leaf_mound(leaf, rng, c, 0.2, 0.3, foliage, (0.42, 0.6, 0.26), clumps=2, cards=3)
    for i, (x, z) in enumerate(disc_points(rng, n, 0.34)):
        h = rng.uniform(*height)
        stem(leaf, [np.array([x, 0.1, z]), np.array([x, h - size * 0.6, z])], 0.01)
        upright(leaf, (x, h - size / 2, z), size, region, colours[i % len(colours)], rng)
    return [('nature.leaves', leaf)]


def lavender(seed, size=1.0):
    rng = random.Random(seed)
    leaf = Part()
    canopy = leaf_mound(leaf, rng, (0, 0), 0.34 * size, 0.38 * size, 'clump.needle', (0.62, 0.72, 0.6), clumps=5, cards=4)
    for k in range(40):
        a = rng.uniform(0, 6.3)
        r = rng.uniform(0.0, 0.32) * size
        base = np.array([math.cos(a) * r, 0.3 * size, math.sin(a) * r])
        top = base + np.array([math.cos(a) * 0.1, rng.uniform(0.25, 0.38) * size, math.sin(a) * 0.1])
        stem(leaf, [base, top], 0.004, colour=(0.55, 0.62, 0.45))
        upright(leaf, top + np.array([0, 0.05 * size, 0]), 0.2 * size, 'lavender', (0.66, 0.5, 0.95), rng)
    return [('nature.leaves', leaf)]


def cosmos(seed):
    rng = random.Random(seed)
    leaf = Part()
    soil_patch(leaf, rng)
    for (x, z) in disc_points(rng, 8, 0.3):
        for k in range(3):
            a = rng.uniform(0, 6.3)
            blade(leaf, (x, 0.03, z), [math.cos(a) * 0.3, 1, math.sin(a) * 0.3], rng.uniform(0.4, 0.55), 'feather', (0.45, 0.62, 0.28), rng, droop=0.05)
    cols = [(1.0, 0.55, 0.78), (1, 1, 1), (0.9, 0.3, 0.6), (1.0, 0.75, 0.85)]
    for i, (x, z) in enumerate(disc_points(rng, 28, 0.4)):
        h = rng.uniform(0.6, 0.85)
        top = np.array([x + rng.uniform(-0.08, 0.08), h, z + rng.uniform(-0.08, 0.08)])
        stem(leaf, curve([x, 0.03, z], top, [rng.uniform(-0.04, 0.04), 0, 0], 3), 0.004)
        head(leaf, top, rng.uniform(0.09, 0.12), 'cosmos', cols[i % 4], facing=(rng.uniform(-0.5, 0.5), 1, rng.uniform(-0.5, 0.5)), rng=rng)
    return [('nature.leaves', leaf)]


def meadow(seed):
    """A patch of wild meadow: grasses with a mix of wildflowers."""
    rng = random.Random(seed)
    leaf = Part()
    for (x, z) in disc_points(rng, 14, 0.38):
        for k in range(2):
            a = k * math.pi / 2 + rng.uniform(0, 1)
            side = np.array([math.cos(a), 0, math.sin(a)])
            col = srgb(np.array([0.9, 1.0, 0.8]) * rng.uniform(0.85, 1.05))
            card(leaf, np.array([x, 0, z]), norm([rng.uniform(-0.15, 0.15), 1, rng.uniform(-0.15, 0.15)]), side, 0.32, rng.uniform(0.32, 0.45), 'grass', soft_normal(0.8), lambda p, col=col: col)
    mix = [('daisy', (1, 1, 1)), ('poppy', (0.95, 0.2, 0.1)), ('cluster', (0.55, 0.65, 1.0)), ('five', (1.0, 0.9, 0.3)), ('cosmos', (0.95, 0.55, 0.85))]
    for i, (x, z) in enumerate(disc_points(rng, 24, 0.42)):
        h = rng.uniform(0.25, 0.5)
        stem(leaf, [np.array([x, 0, z]), np.array([x, h, z])], 0.004)
        reg, col = mix[i % len(mix)]
        head(leaf, (x, h, z), rng.uniform(0.07, 0.1), reg, col, facing=(rng.uniform(-0.4, 0.4), 1, rng.uniform(-0.4, 0.4)), rng=rng)
    return [('nature.leaves', leaf)]


def flowerbed(seed):
    """The classic raised wooden flower bed, now with mixed bedding flowers."""
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    top = wood_box(solid, 0.92, 0.92, 0.24, (0.5, 0.36, 0.25), plank=0.12)
    soil_patch(leaf, rng, radius=0.43, height=top, square=True)
    for c in disc_points(rng, 5, 0.24):
        canopy = Canopy([c[0], top + 0.1, c[1]], [0.2, 0.12, 0.2], dark=0.6)
        clump(leaf, canopy, np.array([c[0], top + 0.1, c[1]]), 0.13, rng, 'clump.fine', LEAF, 3, size_k=1.5, light=MOUND_LIGHT)
    cols = [(1.0, 0.3, 0.35), (1.0, 0.85, 0.3), (0.75, 0.55, 1.0), (1, 1, 1), (1.0, 0.6, 0.8)]
    regs = ['five', 'pompom', 'five', 'daisy', 'cosmos']
    for i, (x, z) in enumerate(grid_points(rng, 25, 0.36, 0.04)):
        head(leaf, (x, top + rng.uniform(0.13, 0.2), z), rng.uniform(0.08, 0.1), regs[i % 5], cols[(i * 3) % 5], facing=(rng.uniform(-0.3, 0.3), 1, rng.uniform(-0.3, 0.3)), rng=rng)
    return [('nature.leaves', leaf), ('garden.solid', solid)]


def potted_geraniums(seed):
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    y = pot(solid, 0.24, 0.34)
    soil_top(leaf, y, 0.22)
    canopy = Canopy([0, y + 0.15, 0], [0.3, 0.18, 0.3], dark=0.6)
    for k in range(14):
        a = rng.uniform(0, 6.3)
        r = rng.uniform(0.05, 0.25)
        blade(leaf, (math.cos(a) * r * 0.4, y, math.sin(a) * r * 0.4), [math.cos(a), 0.7, math.sin(a)], 0.16, 'heart', (0.42, 0.6, 0.26), rng, droop=0.15, up=0.7)
    for k in range(9):
        a = rng.uniform(0, 6.3)
        r = rng.uniform(0.0, 0.2)
        c = np.array([math.cos(a) * r, y + rng.uniform(0.2, 0.3), math.sin(a) * r])
        stem(leaf, [np.array([c[0] * 0.5, y, c[2] * 0.5]), c], 0.004)
        clump(leaf, canopy, c, 0.06, rng, 'cluster', (0.95, 0.2, 0.22), 2, size_k=1.8, light=1.2)
    return [('nature.leaves', leaf), ('garden.solid', solid)]


def flower_box(seed):
    """A long painted planter box with petunias (sits along a wall or path)."""
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    top = wood_box(solid, 0.9, 0.36, 0.3, (0.86, 0.86, 0.84), plank=0.1, leg=0.12)
    soil_patch(leaf, rng, radius=0.17, height=top, square=False)
    for x in np.linspace(-0.36, 0.36, 5):
        canopy = Canopy([x, top + 0.1, 0], [0.16, 0.12, 0.16], dark=0.6)
        clump(leaf, canopy, np.array([x, top + 0.08, 0]), 0.12, rng, 'clump.broad', LEAF, 3, size_k=1.6, light=MOUND_LIGHT)
    cols = [(0.9, 0.3, 0.75), (1, 1, 1), (0.6, 0.4, 0.95)]
    for i in range(22):
        x = rng.uniform(-0.42, 0.42)
        z = rng.uniform(-0.2, 0.2)
        trail = abs(z) > 0.14
        y = top + (rng.uniform(-0.12, 0.0) if trail else rng.uniform(0.08, 0.16))
        f = (0, 0.3, math.copysign(1, z)) if trail else (rng.uniform(-0.3, 0.3), 1, rng.uniform(-0.3, 0.3))
        head(leaf, (x, y, z * (1.25 if trail else 1)), rng.uniform(0.08, 0.1), 'five', cols[i % 3], facing=f, rng=rng)
    return [('nature.leaves', leaf), ('garden.solid', solid)]


# ---- shrubs --------------------------------------------------------------------------

def topiary_ball(seed, r=0.42, tint=(0.42, 0.6, 0.26)):
    rng = random.Random(seed)
    leaf = Part()
    canopy = Canopy([0, r, 0], [r, r, r], dark=0.7, bend=0.9)
    golden = math.pi * (3 - math.sqrt(5))
    n = 26
    for i in range(n):
        y = 1 - 2 * (i + 0.5) / n
        rr = math.sqrt(1 - y * y)
        a = i * golden
        d = np.array([math.cos(a) * rr, y, math.sin(a) * rr])
        c = canopy.c + d * r * 0.62
        clump(leaf, canopy, c, r * 0.38, rng, 'clump.fine', tint, 3, size_k=1.5, spread=0.3, light=1.15)
    return [('nature.leaves', leaf)]


def topiary_cone(seed):
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    top = wood_box(solid, 0.5, 0.5, 0.42, (0.3, 0.32, 0.34), plank=0.42)
    soil_patch(leaf, rng, 0.22, top, square=True)
    canopy = Canopy([0, top + 0.6, 0], [0.3, 0.6, 0.3], dark=0.6)
    tube(leaf, [np.array([0, top, 0]), np.array([0, top + 0.2, 0])], [0.025, 0.02], 5, region_uv('bark.smooth')[0::2], colour=srgb((0.45, 0.35, 0.25)), vrange=region_uv('bark.smooth')[1::2])
    for t in range(9):
        u = t / 8
        y = top + 0.12 + u * 1.05
        rr = 0.3 * (1 - u) + 0.04
        n = max(1, int(round(2 * math.pi * rr / 0.16)))
        for k in range(n):
            a = 2 * math.pi * k / n + t
            c = np.array([math.cos(a) * rr * 0.7, y, math.sin(a) * rr * 0.7])
            clump(leaf, canopy, c, max(0.07, rr * 0.55), rng, 'clump.fine', (0.42, 0.6, 0.26), 2, size_k=1.6, spread=0.3, light=1.15)
    return [('nature.leaves', leaf), ('garden.solid', solid)]


def flowering_shrub(seed, region, colour, size=(0.95, 0.95, 0.95), n=14, head_size=0.16, foliage='clump.broad', tint=(0.38, 0.56, 0.24)):
    """A rounded shrub dotted with big flower heads (hydrangea, roses, peonies)."""
    rng = random.Random(seed)
    bark_p, leaf_p = bush(seed, size=size, clumps=6, region=foliage, tint=tint, cards=5)
    w, h, d = size
    canopy = Canopy([0, h * 0.5, 0], [w * 0.5, h * 0.5, d * 0.5])
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        y = 1 - 1.6 * (i + 0.5) / n
        rr = math.sqrt(max(0.0, 1 - y * y))
        a = i * golden + rng.uniform(-0.2, 0.2)
        dvec = np.array([math.cos(a) * rr, y, math.sin(a) * rr])
        c = canopy.c + dvec * canopy.r * 0.86
        if c[1] < 0.18:
            continue
        cols = colour if isinstance(colour, list) else [colour]
        col = np.array(cols[i % len(cols)]) * rng.uniform(0.92, 1.05)
        head(leaf_p, c, head_size * rng.uniform(0.85, 1.15), region, tuple(col), facing=norm(dvec + UP * 0.6), rng=rng, spin=rng.uniform(0, 6.3))
    return [('nature.bark', bark_p), ('nature.leaves', leaf_p)]


def fern(seed, size=1.0, tint=(0.36, 0.56, 0.2), base=0.0, fronds=16):
    rng = random.Random(seed)
    leaf = Part()
    for k in range(fronds):
        a = 2 * math.pi * k / fronds + rng.uniform(-0.2, 0.2)
        el = rng.uniform(0.7, 1.25)
        L = rng.uniform(0.55, 0.75) * size
        d = [math.cos(a) * math.cos(el), math.sin(el) + 0.2, math.sin(a) * math.cos(el)]
        blade(leaf, (math.cos(a) * 0.03, base, math.sin(a) * 0.03), d, L, 'fern', tint, rng, droop=0.35, rows=3, up=0.55)
    return leaf


def ornamental_grass(seed):
    rng = random.Random(seed)
    leaf = Part()
    for k in range(12):
        a = k * math.pi / 12 + rng.uniform(-0.1, 0.1)
        side = np.array([math.cos(a), 0, math.sin(a)])
        col = srgb(np.array([0.6, 0.7, 0.4]) * rng.uniform(0.85, 1.0))
        card(leaf, np.array([rng.uniform(-0.08, 0.08), 0, rng.uniform(-0.08, 0.08)]), norm([rng.uniform(-0.15, 0.15), 1, rng.uniform(-0.15, 0.15)]), side, 1.4, rng.uniform(1.0, 1.25), 'plume', soft_normal(0.6), lambda p, col=col: col)
    return [('nature.leaves', leaf)]


def hosta(seed):
    rng = random.Random(seed)
    leaf = Part()
    for k in range(22):
        a = 2 * math.pi * k / 22 + rng.uniform(-0.15, 0.15)
        el = rng.uniform(0.6, 1.1)
        L = rng.uniform(0.3, 0.4)
        blade(leaf, (math.cos(a) * 0.04, 0, math.sin(a) * 0.04), [math.cos(a) * math.cos(el), math.sin(el), math.sin(a) * math.cos(el)], L, 'heart', (0.36, 0.54, 0.42), rng, droop=0.3, rows=2, up=0.45)
    for k in range(5):
        a = rng.uniform(0, 6.3)
        stem(leaf, [np.array([math.cos(a) * 0.06, 0, math.sin(a) * 0.06]), np.array([math.cos(a) * 0.12, 0.62, math.sin(a) * 0.12])], 0.005)
        upright(leaf, (math.cos(a) * 0.12, 0.68, math.sin(a) * 0.12), 0.2, 'spike', (0.85, 0.78, 1.0), rng)
    return [('nature.leaves', leaf)]


# ---- edibles -------------------------------------------------------------------------

def veg_patch(seed):
    """Rows of lettuce, carrots and cabbages in a low bed."""
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    top = wood_box(solid, 0.92, 0.92, 0.14, (0.5, 0.38, 0.27), plank=0.14)
    soil_patch(leaf, rng, 0.43, top, square=True)
    rows = [-0.28, 0.0, 0.28]
    for ri, z in enumerate(rows):
        for x in np.linspace(-0.3, 0.3, 4):
            p = np.array([x + rng.uniform(-0.02, 0.02), top, z + rng.uniform(-0.02, 0.02)])
            if ri == 1:  # carrots: feathery tops
                for k in range(4):
                    a = rng.uniform(0, 6.3)
                    blade(leaf, p, [math.cos(a) * 0.4, 1, math.sin(a) * 0.4], 0.2, 'feather', (0.4, 0.62, 0.24), rng, droop=0.1)
                ellipsoid(solid, p + np.array([0, 0.005, 0]), (0.025, 0.012, 0.025), (0.95, 0.5, 0.12), 8, 4)
            else:  # lettuce / cabbage rosettes
                tint = (0.6, 0.8, 0.32) if ri == 0 else (0.48, 0.62, 0.55)
                for k in range(7):
                    a = 2 * math.pi * k / 7 + rng.uniform(-0.2, 0.2)
                    blade(leaf, p, [math.cos(a), 0.9, math.sin(a)], 0.13, 'lettuce', tint, rng, droop=0.1, up=0.7)
                head(leaf, p + np.array([0, 0.06, 0]), 0.09, 'lettuce', tuple(np.array(tint) * 1.1), facing=(0, 1, 0), rng=rng)
    return [('nature.leaves', leaf), ('garden.solid', solid)]


def tomatoes(seed):
    rng = random.Random(seed)
    leaf, solid, bark = Part(), Part(), Part()
    soil_patch(leaf, rng)
    for x in (-0.25, 0.0, 0.25):
        z = rng.uniform(-0.1, 0.1)
        tube(bark, [np.array([x, 0, z]), np.array([x, 1.2, z])], [0.012, 0.01], 4, BARK_BROWN)
        canopy = Canopy([x, 0.65, z], [0.22, 0.55, 0.22], dark=0.6)
        for k in range(5):
            c = np.array([x + rng.uniform(-0.08, 0.08), 0.25 + k * 0.2, z + rng.uniform(-0.08, 0.08)])
            clump(leaf, canopy, c, 0.13, rng, 'herb', (0.38, 0.56, 0.24), 3, size_k=1.7)
        for k in range(7):
            a = rng.uniform(0, 6.3)
            c = np.array([x + math.cos(a) * 0.12, rng.uniform(0.3, 1.0), z + math.sin(a) * 0.12])
            col = (0.95, 0.15, 0.08) if rng.random() < 0.75 else (1.0, 0.6, 0.1)
            facing_card(leaf, c, 0.07, 'fruit', norm([math.cos(a), 0.3, math.sin(a)]), srgb(col), face=(math.cos(a), 0, math.sin(a)))
    return [('nature.bark', bark), ('nature.leaves', leaf), ('garden.solid', solid)]


def strawberries(seed):
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    top = wood_box(solid, 0.92, 0.92, 0.18, (0.62, 0.48, 0.32), plank=0.09)
    soil_patch(leaf, rng, 0.43, top, square=True)
    for (x, z) in grid_points(rng, 9, 0.3, 0.03):
        for k in range(5):
            a = 2 * math.pi * k / 5 + rng.uniform(-0.2, 0.2)
            blade(leaf, (x, top, z), [math.cos(a), 0.8, math.sin(a)], 0.12, 'clover', (0.42, 0.6, 0.26), rng, droop=0.05, up=0.7)
        for k in range(3):
            a = rng.uniform(0, 6.3)
            c = (x + math.cos(a) * 0.1, top + 0.03, z + math.sin(a) * 0.1)
            facing_card(leaf, c, 0.05, 'strawberry', (0, 1, 0), srgb((1, 1, 1)), face=(math.cos(a), 0.3, math.sin(a)))
        head(leaf, (x + rng.uniform(-0.05, 0.05), top + 0.1, z + rng.uniform(-0.05, 0.05)), 0.04, 'five', (1, 1, 1), rng=rng)
    return [('nature.leaves', leaf), ('garden.solid', solid)]


def herb_planter(seed):
    """A raised wooden herb planter on legs: basil, rosemary and chives."""
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    top = wood_box(solid, 0.86, 0.5, 0.26, (0.55, 0.4, 0.26), plank=0.13, leg=0.42)
    soil_patch(leaf, rng, 0.2, top)
    # Basil
    canopy = Canopy([-0.27, top + 0.12, 0], [0.14, 0.12, 0.14], dark=0.6)
    for k in range(4):
        c = np.array([-0.27 + rng.uniform(-0.05, 0.05), top + 0.1 + rng.uniform(0, 0.05), rng.uniform(-0.05, 0.05)])
        clump(leaf, canopy, c, 0.12, rng, 'herb', (0.55, 0.8, 0.28), 3, size_k=1.8, light=MOUND_LIGHT)
    # Rosemary
    for k in range(14):
        a = rng.uniform(0, 6.3)
        blade(leaf, (0.0 + math.cos(a) * 0.03, top, math.sin(a) * 0.03), [math.cos(a) * 0.4, 1, math.sin(a) * 0.4], 0.26, 'lavender', (0.4, 0.5, 0.4), rng, droop=0.05, rows=1)
    canopy = Canopy([0, top + 0.12, 0], [0.12, 0.14, 0.12], dark=0.6)
    clump(leaf, canopy, np.array([0, top + 0.12, 0]), 0.12, rng, 'clump.needle', (0.55, 0.66, 0.52), 4, size_k=1.7, light=MOUND_LIGHT)
    # Chives with purple pompoms
    for k in range(10):
        a = rng.uniform(0, 6.3)
        blade(leaf, (0.27, top, 0), [math.cos(a) * 0.15, 1, math.sin(a) * 0.15], 0.25, 'strap', (0.4, 0.62, 0.28), rng, droop=0.05, width=0.05)
    for k in range(4):
        a = rng.uniform(0, 6.3)
        head(leaf, (0.27 + math.cos(a) * 0.04, top + 0.27, math.sin(a) * 0.04), 0.05, 'pompom', (0.8, 0.55, 0.95), facing=(math.cos(a), 1, math.sin(a)), rng=rng)
    return [('nature.leaves', leaf), ('garden.solid', solid)]


def pumpkins(seed):
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    soil_patch(leaf, rng)
    for k in range(16):
        a = rng.uniform(0, 6.3)
        r = rng.uniform(0.05, 0.38)
        blade(leaf, (math.cos(a) * r, 0.03, math.sin(a) * r), [math.cos(a), 0.5, math.sin(a)], rng.uniform(0.2, 0.28), 'heart', (0.38, 0.56, 0.24), rng, droop=0.2, up=0.7)
    for (x, z, s) in [(-0.2, 0.15, 1.0), (0.18, -0.12, 0.8), (0.12, 0.24, 0.6)]:
        R = 0.15 * s
        ellipsoid(solid, (x, R * 0.75, z), (R, R * 0.78, R), (0.98, 0.55, 0.12), 18, 9, ribs=10, rib_depth=0.12, dark_bottom=0.7)
        tube(solid, [np.array([x, R * 1.45, z]), np.array([x + 0.02, R * 1.75, z])], [0.018, 0.012], 5, (0, 0), colour=srgb((0.4, 0.32, 0.18)))
    return [('nature.leaves', leaf), ('garden.solid', solid)]


# ---- house plants --------------------------------------------------------------------

def monstera(seed):
    rng = random.Random(seed)
    leaf, glazed = Part(), Part()
    y = pot(glazed, 0.24, 0.4, (0.92, 0.9, 0.86), rim=False, flare=1.05)
    soil_top(leaf, y, 0.22)
    for k in range(9):
        a = 2 * math.pi * k / 9 + rng.uniform(-0.2, 0.2)
        el = rng.uniform(0.6, 1.1)
        L = rng.uniform(0.5, 0.75)
        tip = np.array([math.cos(a) * math.cos(el) * L, y + math.sin(el) * L, math.sin(a) * math.cos(el) * L])
        stem(leaf, curve([0, y, 0], tip, [0, 0.1, 0], 3), 0.012, 0.009)
        blade(leaf, tip - np.array([0, 0.02, 0]), [math.cos(a), 0.45, math.sin(a)], rng.uniform(0.38, 0.48), 'monstera', (0.3, 0.5, 0.22), rng, droop=0.12, rows=2, up=0.55)
    return [('nature.leaves', leaf), ('garden.glazed', glazed)]


def fiddle_fig(seed):
    rng = random.Random(seed)
    leaf, solid, bark = Part(), Part(), Part()
    y = pot(solid, 0.22, 0.38, (0.82, 0.8, 0.76), rim=False, flare=1.12)
    soil_top(leaf, y, 0.2)
    trunk = curve([0, y, 0], [0.03, 1.55, 0.02], [0.04, 0, 0], 4)
    tube(bark, trunk, np.linspace(0.025, 0.012, len(trunk)), 6, BARK_BROWN)
    for k in range(30):
        t = 0.35 + 0.65 * (k / 29)
        p = trunk[0] + (trunk[-1] - trunk[0]) * t
        a = k * 2.4
        blade(leaf, p, [math.cos(a), 0.7, math.sin(a)], rng.uniform(0.26, 0.34), 'fig', (0.32, 0.52, 0.22), rng, droop=0.15, up=0.5)
    return [('nature.bark', bark), ('nature.leaves', leaf), ('garden.solid', solid)]


def snake_plant(seed):
    rng = random.Random(seed)
    leaf, glazed = Part(), Part()
    y = pot(glazed, 0.17, 0.26, (0.2, 0.22, 0.25), rim=False, flare=1.0)
    soil_top(leaf, y, 0.15)
    for k in range(10):
        a = 2 * math.pi * k / 10 + rng.uniform(-0.2, 0.2)
        r = rng.uniform(0.02, 0.09)
        L = rng.uniform(0.5, 0.75)
        base = np.array([math.cos(a) * r, y - 0.01, math.sin(a) * r])
        d = norm([math.cos(a) * 0.12, 1, math.sin(a) * 0.12])
        side = norm(np.cross(d, [math.cos(a + 1.6), 0, math.sin(a + 1.6)]))
        col = srgb(np.array((0.62, 0.8, 0.5)) * rng.uniform(0.9, 1.05))
        card(leaf, base, d, side, L, L, 'sword', soft_normal(0.4), lambda p, col=col: col, flip=rng.random() < 0.5)
    return [('nature.leaves', leaf), ('garden.glazed', glazed)]


def cactus_trio(seed):
    rng = random.Random(seed)
    leaf, solid = Part(), Part()
    for (x, z, h, r, kind) in [(-0.18, -0.08, 0.55, 0.07, 'column'), (0.17, -0.1, 0.22, 0.09, 'ball'), (0.02, 0.18, 0.38, 0.06, 'arms')]:
        sub = Part()
        y = pot(sub, 0.12, 0.16, (0.75, 0.45, 0.3))
        green = (0.36, 0.55, 0.32)
        if kind == 'ball':
            ellipsoid(sub, (0, y + r * 0.9, 0), (r, r, r), green, 16, 8, ribs=12, rib_depth=0.1)
            ellipsoid(sub, (0, y + r * 1.9, 0), (0.02, 0.015, 0.02), (1.0, 0.45, 0.6), 8, 4)
        else:
            prof = [(0.0, y), (r, y), (r, y + h - r), (r * 0.7, y + h - r * 0.3), (0.0, y + h)]
            lathe(sub, prof, 14, green, ribs=8, rib_depth=0.16)
            if kind == 'arms':
                for sgn in (-1, 1):
                    arm = [np.array([0, y + h * 0.45, 0]), np.array([sgn * 0.08, y + h * 0.45, 0]), np.array([sgn * 0.09, y + h * 0.7, 0])]
                    tube(sub, arm, [0.03, 0.03, 0.025], 8, (0, 0), colour=srgb(green), cap=True)
        sub.transform(t=(x, 0, z))
        solid.add(sub)
    return [('garden.solid', solid)]


def succulent_bowl(seed):
    rng = random.Random(seed)
    leaf, glazed = Part(), Part()
    prof = [(0.0, 0.0), (0.16, 0.0), (0.3, 0.12), (0.32, 0.15), (0.29, 0.15), (0.27, 0.13)]
    lathe(glazed, prof, 24, (0.35, 0.55, 0.65))
    soil_top(leaf, 0.13, 0.28)
    tints = [(0.62, 0.8, 0.62), (0.75, 0.68, 0.8), (0.55, 0.72, 0.68), (0.8, 0.8, 0.6)]
    for i, (x, z) in enumerate(disc_points(rng, 7, 0.2)):
        head(leaf, (x, 0.17, z), rng.uniform(0.11, 0.16), 'rosette', tints[i % 4], facing=(rng.uniform(-0.2, 0.2), 1, rng.uniform(-0.2, 0.2)), rng=rng, spin=rng.uniform(0, 6.3))
    return [('nature.leaves', leaf), ('garden.glazed', glazed)]


def fern_stand(seed):
    """A Boston fern spilling over a pot on a wooden plant stand."""
    rng = random.Random(seed)
    solid = Part()
    for a in (0.3, 0.3 + 2.094, 0.3 + 4.189):
        box(solid, (math.cos(a) * 0.14, 0.25, math.sin(a) * 0.14), (0.04, 0.5, 0.04), (0.45, 0.32, 0.2))
    lathe(solid, [(0.0, 0.48), (0.22, 0.48), (0.22, 0.52), (0.0, 0.52)], 18, (0.5, 0.36, 0.22))
    y = pot(solid, 0.18, 0.24, (0.9, 0.88, 0.84), base=0.52, rim=False)
    leaf = fern(seed, size=0.85, base=y, fronds=18, tint=(0.46, 0.68, 0.24))
    soil_top(leaf, y, 0.16)
    return [('nature.leaves', leaf), ('garden.solid', solid)]


def parlour_palm(seed):
    rng = random.Random(seed)
    leaf, glazed = Part(), Part()
    y = pot(glazed, 0.2, 0.32, (0.85, 0.72, 0.55), rim=False, flare=1.1)
    soil_top(leaf, y, 0.18)
    for k in range(10):
        a = 2 * math.pi * k / 10 + rng.uniform(-0.2, 0.2)
        el = rng.uniform(0.7, 1.2)
        L = rng.uniform(0.5, 0.7)
        base = np.array([0, y, 0])
        mid = base + np.array([math.cos(a) * 0.08, L * 0.4, math.sin(a) * 0.08])
        stem(leaf, [base, mid], 0.008)
        blade(leaf, mid, [math.cos(a) * math.cos(el), math.sin(el), math.sin(a) * math.cos(el)], L, 'palm', (0.36, 0.56, 0.24), rng, droop=0.3, rows=3, up=0.5)
    return [('nature.leaves', leaf), ('garden.glazed', glazed)]


def orchid(seed):
    rng = random.Random(seed)
    leaf, glazed, solid = Part(), Part(), Part()
    lathe(solid, [(0.0, 0.0), (0.14, 0.0), (0.14, 0.04), (0.06, 0.06), (0.05, 0.5), (0.16, 0.54), (0.16, 0.57), (0.0, 0.57)], 16, (0.35, 0.25, 0.18))
    y = pot(glazed, 0.11, 0.16, (0.95, 0.95, 0.95), base=0.57, rim=False, flare=1.0)
    soil_top(leaf, y, 0.1)
    for k in range(5):
        a = 2 * math.pi * k / 5
        blade(leaf, (0, y, 0), [math.cos(a), 0.3, math.sin(a)], 0.18, 'fig', (0.35, 0.55, 0.25), rng, droop=0.2, up=0.6)
    for s in range(2):
        a = s * 2.5 + 0.4
        path = curve([0, y, 0], [math.cos(a) * 0.2, y + 0.42, math.sin(a) * 0.2], [0, 0.12, 0], 6)
        stem(leaf, path, 0.004, colour=(0.4, 0.45, 0.3))
        for k in range(5):
            p = path[2 + k // 2 + (k % 2)] if k < 4 else path[-1]
            p = p + np.array([math.cos(a) * 0.03 * k, -0.02, math.sin(a) * 0.03 * k])
            head(leaf, p, 0.08, 'star', (1.0, 0.75, 0.92) if s else (1, 1, 1), facing=(math.cos(a), 0.4, math.sin(a)), rng=rng)
    return [('nature.leaves', leaf), ('garden.glazed', glazed), ('garden.solid', solid)]


def bonsai(seed):
    rng = random.Random(seed)
    solid, glazed = Part(), Part()
    # Low stand and a shallow rectangular tray.
    box(solid, (0, 0.18, 0), (0.62, 0.04, 0.42), (0.32, 0.22, 0.15))
    for sx in (-1, 1):
        box(solid, (sx * 0.26, 0.08, 0), (0.06, 0.16, 0.36), (0.3, 0.2, 0.14))
    box(glazed, (0, 0.24, 0), (0.48, 0.08, 0.32), (0.22, 0.32, 0.42))
    bark_p, leaf_p, canopy = clump_tree(seed, False, trunk_h=0.18, trunk_r=0.035, limbs=4, crown_c=[0, 0.45, 0], crown_r=[0.3, 0.12, 0.24], clumps=7, clump_r=0.11, cards=5, region='clump.fine', tint=(0.36, 0.52, 0.22), elev=(5, 25), lean=0.35, dark=0.6)
    bark_p.transform(t=(0, 0.27, 0))
    leaf_p.transform(t=(0, 0.27, 0))
    box(solid, (0, 0.278, 0), (0.44, 0.005, 0.28), (0.4, 0.5, 0.3))
    return [('nature.bark', bark_p), ('nature.leaves', leaf_p), ('garden.solid', solid), ('garden.glazed', glazed)]


def lemon_tree(seed):
    rng = random.Random(seed)
    solid = Part()
    y = pot(solid, 0.26, 0.42, (0.74, 0.42, 0.27))
    prims = trees()['lemon'](False)
    leaf = dict(prims)['nature.leaves']
    bark = dict(prims)['nature.bark']
    for p in (leaf, bark):
        p.transform(t=(0, y, 0))
    soil_top(leaf, y, 0.24)
    return [('nature.bark', bark), ('nature.leaves', leaf), ('garden.solid', solid)]


# ---- decor ---------------------------------------------------------------------------

STONE = (0.72, 0.7, 0.66)


def stone_colour(base=STONE, rng=None):
    def f(y):
        n = 0.94 + 0.06 * math.sin(y * 37.0)
        return np.array(base) * n
    return f


def birdbath(seed):
    solid, water = Part(), Part()
    prof = [(0.0, 0.0), (0.2, 0.0), (0.2, 0.06), (0.1, 0.1), (0.07, 0.2), (0.06, 0.55), (0.09, 0.62), (0.32, 0.7), (0.34, 0.76), (0.3, 0.77), (0.26, 0.72), (0.0, 0.7)]
    lathe(solid, prof, 26, stone_colour())
    disc(water, (0, 0.735, 0), 0.27, None, (0.32, 0.5, 0.58), segments=24)
    # A bird on the rim.
    ellipsoid(solid, (0.24, 0.81, 0.05), (0.05, 0.035, 0.03), (0.45, 0.32, 0.22), 10, 6)
    ellipsoid(solid, (0.2, 0.84, 0.05), (0.025, 0.025, 0.025), (0.5, 0.36, 0.25), 8, 5)
    ellipsoid(solid, (0.175, 0.84, 0.05), (0.012, 0.006, 0.006), (0.95, 0.65, 0.2), 6, 3)
    return [('garden.solid', solid), ('garden.water', water)]


def fountain(seed):
    solid, water = Part(), Part()
    prof = [(0.0, 0.0), (0.46, 0.0), (0.46, 0.32), (0.43, 0.34), (0.4, 0.3), (0.12, 0.28), (0.1, 0.62), (0.26, 0.7), (0.27, 0.76), (0.24, 0.76), (0.22, 0.72), (0.07, 0.72), (0.06, 1.0), (0.12, 1.06), (0.12, 1.1), (0.0, 1.14)]
    lathe(solid, prof, 30, stone_colour())
    disc(water, (0, 0.29, 0), 0.41, None, (0.3, 0.5, 0.58), segments=30)
    disc(water, (0, 0.74, 0), 0.23, None, (0.35, 0.55, 0.62), segments=24)
    return [('garden.solid', solid), ('garden.water', water)]


def gnome(seed):
    glazed = Part()
    ellipsoid(glazed, (0, 0.03, 0), (0.08, 0.03, 0.08), (0.35, 0.3, 0.25), 12, 4)
    lathe(glazed, [(0.0, 0.03), (0.075, 0.03), (0.09, 0.08), (0.08, 0.17), (0.06, 0.2), (0.0, 0.2)], 14, (0.25, 0.4, 0.75))
    ellipsoid(glazed, (0, 0.235, 0.0), (0.055, 0.05, 0.05), (0.98, 0.8, 0.68), 12, 7)
    ellipsoid(glazed, (0, 0.245, 0.05), (0.014, 0.014, 0.014), (0.95, 0.55, 0.5), 8, 4)
    lathe(glazed, [(0.0, 0.17), (0.06, 0.2), (0.045, 0.24), (0.0, 0.215)], 12, (0.98, 0.98, 0.96))
    glazed2 = Part()
    lathe(glazed2, [(0.0, 0.26), (0.062, 0.26), (0.04, 0.33), (0.015, 0.39), (0.0, 0.41)], 14, (0.9, 0.15, 0.12))
    glazed.add(glazed2)
    glazed.transform(np.eye(3) * 1.4)
    return [('garden.glazed', glazed)]


def pond(seed):
    """A 2 x 2 garden pond: stone rim, water, lily pads and reeds."""
    rng = random.Random(seed)
    solid, water, leaf = Part(), Part(), Part()
    n = 22
    for k in range(n):
        a = 2 * math.pi * k / n
        r = 0.82 + 0.06 * math.sin(a * 3)
        R = rng.uniform(0.1, 0.15)
        ellipsoid(solid, (math.cos(a) * r, 0.04, math.sin(a) * r * 0.95), (R, R * 0.6, R * 0.85), np.array(STONE) * rng.uniform(0.85, 1.05), 10, 5)
    disc(water, (0, 0.05, 0), 0.8, None, (0.22, 0.38, 0.4), segments=40)
    for k in range(7):
        a, r = rng.uniform(0, 6.3), rng.uniform(0.1, 0.55)
        head(leaf, (math.cos(a) * r, 0.056, math.sin(a) * r), rng.uniform(0.16, 0.24), 'lily.pad', (0.42, 0.6, 0.3), facing=(0, 1, 0), rng=rng, spin=rng.uniform(0, 6.3))
    for k in range(2):
        a, r = rng.uniform(0, 6.3), rng.uniform(0.15, 0.4)
        head(leaf, (math.cos(a) * r, 0.08, math.sin(a) * r), 0.1, 'star', (1.0, 0.82, 0.9), facing=(0, 1, 0), rng=rng)
    for k in range(10):
        a = rng.uniform(-0.6, 0.9)
        base = np.array([math.cos(a) * 0.72, 0.05, math.sin(a) * 0.72])
        blade(leaf, base, [rng.uniform(-0.15, 0.15), 1, rng.uniform(-0.15, 0.15)], rng.uniform(0.5, 0.75), 'strap', (0.45, 0.62, 0.3), rng, droop=0.05, width=0.18)
    return [('garden.solid', solid), ('garden.water', water), ('nature.leaves', leaf)]


def stone_lantern(seed):
    solid = Part()
    lathe(solid, [(0.0, 0.0), (0.2, 0.0), (0.2, 0.08), (0.08, 0.1), (0.06, 0.45), (0.0, 0.45)], 8, stone_colour())
    box(solid, (0, 0.5, 0), (0.3, 0.1, 0.3), STONE)
    box(solid, (0, 0.64, 0), (0.22, 0.18, 0.22), STONE)
    box(solid, (0, 0.64, 0), (0.1, 0.1, 0.23), (1.0, 0.85, 0.5))
    box(solid, (0, 0.64, 0), (0.23, 0.1, 0.1), (1.0, 0.85, 0.5))
    lathe(solid, [(0.0, 0.73), (0.26, 0.73), (0.25, 0.77), (0.08, 0.86), (0.04, 0.9), (0.05, 0.95), (0.0, 0.98)], 6, stone_colour())
    return [('garden.solid', solid)]


def wheelbarrow(seed):
    rng = random.Random(seed)
    solid, leaf = Part(), Part()
    tray = Part()
    top = wood_box(tray, 0.56, 0.7, 0.26, (0.35, 0.55, 0.5), plank=0.26, base=0.28)
    solid.add(tray)
    # Wheel at the front, handles at the back.
    ellipsoid(solid, (0, 0.17, 0.38), (0.04, 0.17, 0.17), (0.2, 0.2, 0.2), 16, 8)
    for sx in (-1, 1):
        tube(solid, [np.array([sx * 0.22, 0.3, 0.3]), np.array([sx * 0.24, 0.45, -0.46])], [0.02, 0.02], 6, (0, 0), colour=srgb((0.4, 0.3, 0.2)))
        tube(solid, [np.array([sx * 0.2, 0.28, -0.2]), np.array([sx * 0.2, 0.0, -0.22])], [0.018, 0.018], 6, (0, 0), colour=srgb((0.25, 0.25, 0.25)))
    soil_patch(leaf, rng, 0.25, top, square=True)
    cols = [(1.0, 0.35, 0.4), (1.0, 0.8, 0.3), (0.95, 0.95, 0.95), (0.7, 0.5, 1.0)]
    for c in disc_points(rng, 4, 0.18):
        canopy = Canopy([c[0], top + 0.1, c[1]], [0.14, 0.1, 0.14], dark=0.6)
        clump(leaf, canopy, np.array([c[0], top + 0.08, c[1]]), 0.12, rng, 'clump.broad', LEAF, 3, size_k=1.6, light=MOUND_LIGHT)
    for i, (x, z) in enumerate(disc_points(rng, 18, 0.24)):
        head(leaf, (x, top + rng.uniform(0.12, 0.2), z), 0.08, 'five', cols[i % 4], facing=(rng.uniform(-0.4, 0.4), 1, rng.uniform(-0.4, 0.4)), rng=rng)
    return [('garden.solid', solid), ('nature.leaves', leaf)]


def boulder(seed):
    rng = random.Random(seed)
    solid, leaf = Part(), Part()
    for (x, z, r, h) in [(0.0, 0.0, 0.34, 0.28), (0.24, 0.16, 0.18, 0.16), (-0.22, 0.2, 0.14, 0.11)]:
        ellipsoid(solid, (x, h * 0.35, z), (r, h, r * 0.85), np.array(STONE) * rng.uniform(0.8, 0.95), 12, 7, dark_bottom=0.6)
    for k in range(6):
        a = rng.uniform(0, 6.3)
        p = (math.cos(a) * 0.38, 0, math.sin(a) * 0.38)
        side = np.array([math.cos(a + 1.5), 0, math.sin(a + 1.5)])
        col = srgb((0.9, 1.0, 0.8))
        card(leaf, np.array(p), UP, side, 0.28, 0.24, 'grass', soft_normal(0.8), lambda q: col)
    return [('garden.solid', solid), ('nature.leaves', leaf)]


# ---- catalog -------------------------------------------------------------------------

MODELS = {
    # flowers
    'tulips': lambda: tulips(101, [(0.95, 0.15, 0.15), (1.0, 0.85, 0.2), (1.0, 0.55, 0.75), (1, 1, 1), (0.95, 0.4, 0.15)]),
    'daffodils': lambda: daffodils(103),
    'daisies': lambda: daisies(105),
    'sunflowers': lambda: sunflowers(107),
    'poppies': lambda: poppies(109),
    'marigolds': lambda: mound_flowers(111, 'pompom', [(1.0, 0.6, 0.1), (1.0, 0.8, 0.15), (0.95, 0.45, 0.08)], n=22, size=(0.08, 0.1)),
    'pansies': lambda: mound_flowers(113, 'pansy', [(0.7, 0.5, 1.0), (1.0, 0.9, 0.35), (1, 1, 1), (0.55, 0.35, 0.95)], n=26, size=(0.07, 0.085), mound_region='clover', height=0.16, mounds=6),
    'lilies': lambda: lilies(115),
    'lupins': lambda: spikes(117, [(0.6, 0.45, 1.0), (1.0, 0.55, 0.8), (0.5, 0.55, 1.0), (1.0, 0.95, 0.95)]),
    'forget_me_nots': lambda: mound_flowers(119, 'cluster', [(0.5, 0.65, 1.0), (0.6, 0.72, 1.0)], n=28, size=(0.1, 0.13), mound_tint=(0.42, 0.6, 0.28), height=0.2, mounds=6),
    'cosmos': lambda: cosmos(121),
    'meadow': lambda: meadow(123),
    'flowerbed': lambda: flowerbed(125),
    'geraniums': lambda: potted_geraniums(127),
    'flower_box': lambda: flower_box(129),
    # shrubs
    'boxwood': lambda: topiary_ball(201),
    'topiary_cone': lambda: topiary_cone(203),
    'hydrangea': lambda: flowering_shrub(205, 'hydrangea', [(0.55, 0.62, 1.0), (0.7, 0.6, 1.0)], n=16, head_size=0.24),
    'rosebush': lambda: flowering_shrub(207, 'rose', (0.9, 0.12, 0.16), size=(0.85, 1.0, 0.85), n=18, head_size=0.13, tint=(0.32, 0.5, 0.22)),
    'azalea': lambda: flowering_shrub(209, 'cluster', [(1.0, 0.35, 0.65), (0.95, 0.25, 0.55)], size=(1.0, 0.8, 1.0), n=26, head_size=0.2, foliage='clump.fine'),
    'lavender': lambda: lavender(211),
    'fern': lambda: [('nature.leaves', fern(213))],
    'grass': lambda: ornamental_grass(215),
    'hosta': lambda: hosta(217),
    'hedge': lambda: [('nature.leaves', hedge(73, length=0.96, height=0.95, depth=0.6)[1])],
    # edibles
    'veg_patch': lambda: veg_patch(301),
    'tomatoes': lambda: tomatoes(303),
    'strawberries': lambda: strawberries(305),
    'herbs': lambda: herb_planter(307),
    'pumpkins': lambda: pumpkins(309),
    'lemon_tree': lambda: lemon_tree(311),
    # house plants
    'monstera': lambda: monstera(401),
    'fiddle_fig': lambda: fiddle_fig(403),
    'snake_plant': lambda: snake_plant(405),
    'cacti': lambda: cactus_trio(407),
    'succulents': lambda: succulent_bowl(409),
    'boston_fern': lambda: fern_stand(411),
    'palm': lambda: parlour_palm(413),
    'orchid': lambda: orchid(415),
    'bonsai': lambda: bonsai(417),
    # decor
    'birdbath': lambda: birdbath(501),
    'fountain': lambda: fountain(503),
    'gnome': lambda: gnome(505),
    'pond': lambda: pond(507),
    'lantern': lambda: stone_lantern(509),
    'wheelbarrow': lambda: wheelbarrow(511),
    'boulder': lambda: boulder(513),
}


def main():
    out = sys.argv[1]
    only = set(sys.argv[2:])
    os.makedirs(out, exist_ok=True)
    for name, build in MODELS.items():
        if only and name not in only:
            continue
        fn = f'garden_{name}.glb'
        tris = write_glb(os.path.join(out, fn), build())
        print(f'{fn:28s} {tris:6d} tris {os.path.getsize(os.path.join(out, fn)) // 1024:5d} KB')


if __name__ == '__main__':
    main()
