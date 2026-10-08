# Builds the foliage atlas `foliage.webp` used by the procedural nature and garden models
# (nature_models.py, garden_models.py). Everything is drawn here (original, CC0) except three
# regions copied from the older photo atlas `leaves.webp` (conifer fronds, small-leaf sprigs and
# grass; ambientCG CC0, see nature_atlas.py). Needs Pillow, numpy and scipy.
#
# usage: python3 -I foliage_atlas.py <nature_dir> [region…]   (reads leaves.webp, writes foliage.webp;
#        with region names, redraws only those into the existing atlas)
#
# Foliage is drawn nearly white: the models colour it with vertex colours, so one clump serves a
# green oak, a red Japanese maple and a blue spruce. Flower heads are white or pale where they come
# in several colours (tinted per model) and drawn in their own colours where they don't (sunflower,
# daisy). Colour is bled into the transparent parts so mipmaps don't get dark fringes.
#
# The region table (REGIONS) is the contract with the model scripts: they import it.
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SIZE = 2048
SS = 3  # supersampling for drawing

# name: (x0, y0, x1, y1) in pixels of the 2048 x 2048 atlas.
REGIONS = {
    # Leaf clumps (512 x 512): a lobed mass of many small leaves, the building block of crowns.
    'clump.broad': (0, 0, 512, 512),        # ovate leaves: oak, linden, apple, shrubs
    'clump.fine': (512, 0, 1024, 512),      # small leaves: birch, boxwood, hedges
    'clump.maple': (1024, 0, 1536, 512),    # palmate leaves: maples
    'clump.blossom': (1536, 0, 2048, 512),  # five-petal blossoms (tinted): cherry, magnolia, apple
    # Needles and strands.
    'conifer': (0, 512, 512, 1024),         # copied: pine fronds
    'clump.spruce': (512, 512, 1024, 1024), # dense layered needle sprays: spruce, fir, cypress
    'willow': (1024, 512, 1280, 1024),      # hanging strand of narrow leaves
    'sprig': (1280, 512, 1536, 768),        # copied: small-leaf sprig
    'grass': (1280, 768, 1536, 1024),       # copied: lawn grass tuft
    'strap': (1536, 512, 1792, 1024),       # fan of strap leaves: tulips, daffodils, lilies, irises
    'plume': (1792, 512, 2048, 1024),       # ornamental grass with feathery plumes
    # Plant leaves.
    'fern': (0, 1024, 256, 1536),           # fern frond (base at the bottom)
    'monstera': (256, 1024, 512, 1280),     # split tropical leaf (stalk at the bottom)
    'heart': (512, 1024, 768, 1280),        # heart-shaped leaf: hostas, pothos, lilies' pads
    'sword': (768, 1024, 896, 1536),        # tall sword leaf with pale margins: snake plant
    'palm': (896, 1024, 1152, 1536),        # palm frond
    'rosette': (256, 1280, 512, 1536),      # succulent rosette seen from above
    'lettuce': (512, 1280, 768, 1536),      # frilly round leaf: lettuce, cabbage
    'herb': (1152, 1024, 1408, 1280),       # sprig of small round leaves: basil, mint
    'fig': (1152, 1280, 1408, 1536),        # big glossy oval leaf: fiddle-leaf fig, rubber plant
    'feather': (1408, 1024, 1536, 1280),    # feathery carrot top / cosmos foliage
    'stem': (1408, 1280, 1440, 1536),       # plain stem strip (tubes), pale green
    'soil': (1440, 1280, 1536, 1376),       # soil / mulch (opaque)
    'bark.smooth': (1440, 1376, 1536, 1536),  # smooth pale bark strip (tinted): stems of shrubs
    'clump.needle': (1536, 1024, 1792, 1280),  # soft needle tuft: lavender bushes, rosemary
    'clump.flower': (1792, 1024, 2048, 1280),  # mound of tiny flowers among leaves (tinted)
    'clover': (1536, 1280, 1792, 1536),     # low round-leaved ground cover (strawberries, clover)
    'lily.pad': (1792, 1280, 2048, 1536),   # floating round leaf with a notch
    # Flower heads (front or top view unless noted).
    'daisy': (0, 1536, 256, 1792),
    'sunflower': (256, 1536, 512, 1792),
    'rose': (512, 1536, 768, 1792),         # pale, tinted
    'tulip': (768, 1536, 896, 1792),        # side view cup on its stalk top, pale, tinted
    'poppy': (896, 1536, 1152, 1792),       # pale, dark centre
    'pompom': (1152, 1536, 1408, 1792),     # marigold / dahlia, pale
    'star': (1408, 1536, 1664, 1792),       # lily / star flower, pale with freckles
    'five': (1664, 1536, 1920, 1792),       # five-petal flower (geranium, petunia), pale
    'spike': (1920, 1536, 2048, 2048),      # side-view spike of bells (lupin, foxglove), pale
    'lavender': (0, 1792, 128, 2048),       # side-view lavender spike
    'hydrangea': (128, 1792, 384, 2048),    # ball of four-petal florets, pale
    'pansy': (384, 1792, 640, 2048),        # pale with a dark face
    'cluster': (640, 1792, 896, 2048),      # spray of tiny flowers (forget-me-nots, gypsophila), pale
    'daffodil': (896, 1792, 1152, 2048),    # yellow trumpet, front-ish
    'cosmos': (1152, 1792, 1408, 2048),     # eight broad petals, pale
    'magnolia': (1408, 1792, 1664, 2048),   # goblet flower, side view, pale pink
    'fruit': (1664, 1792, 1792, 1920),      # round shiny fruit, pale (tinted: lemon, orange, tomato)
    'apple': (1792, 1792, 1920, 1920),      # red apple with a leaf
    'strawberry': (1664, 1920, 1792, 2048),
    'berry': (1792, 1920, 1920, 2048),      # cluster of small berries, pale
}


def rgb(c):
    return tuple(int(max(0, min(255, round(v * 255)))) for v in c)


class Canvas:
    """
    A supersampled RGBA drawing surface for one region. Pillow replaces pixels when drawing on an
    RGBA image, so translucent ink goes to an overlay that is blended in before the next opaque
    stroke (only the touched box is composited).
    """

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)
        self.ov = Image.new('RGBA', self.im.size, (0, 0, 0, 0))
        self.od = ImageDraw.Draw(self.ov)
        self.box = None

    def P(self, x, y):
        """Normalised (0..1, y down) to supersampled pixels."""
        return (x * self.w * SS, y * self.h * SS)

    def _target(self, ink, pts):
        if ink[3] >= 255:
            self.flush()
            return self.d
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        b = (int(min(xs)) - 8, int(min(ys)) - 8, int(max(xs)) + 9, int(max(ys)) + 9)
        self.box = b if self.box is None else (min(self.box[0], b[0]), min(self.box[1], b[1]), max(self.box[2], b[2]), max(self.box[3], b[3]))
        return self.od

    def flush(self):
        if self.box is None:
            return
        W, H = self.im.size
        b = (max(0, self.box[0]), max(0, self.box[1]), min(W, self.box[2]), min(H, self.box[3]))
        self.box = None
        if b[2] <= b[0] or b[3] <= b[1]:
            return
        part = self.im.crop(b)
        part.alpha_composite(self.ov.crop(b))
        self.im.paste(part, b[:2])
        self.ov.paste((0, 0, 0, 0), b)

    def poly(self, pts, fill, outline=None, width=1):
        px = [self.P(*p) for p in pts]
        self._target(fill, px).polygon(px, fill=fill)
        if outline:
            self._target(outline, px).line(px + [px[0]], fill=outline, width=max(1, int(width * SS)), joint='curve')

    def ellipse(self, cx, cy, rx, ry, fill):
        x0, y0 = self.P(cx - rx, cy - ry)
        x1, y1 = self.P(cx + rx, cy + ry)
        self._target(fill, [(x0, y0), (x1, y1)]).ellipse([x0, y0, x1, y1], fill=fill)

    def line(self, pts, fill, width):
        px = [self.P(*p) for p in pts]
        self._target(fill, px).line(px, fill=fill, width=max(1, int(width * SS)), joint='curve')

    def result(self):
        self.flush()
        return self.im.resize((self.w, self.h), Image.LANCZOS)


# ---- shapes ---------------------------------------------------------------------------

def rot(pts, a, cx=0.0, cy=0.0):
    c, s = math.cos(a), math.sin(a)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]


def leaf_shape(kind, n=14):
    """Unit leaf along +x from (0,0) to (1,0)."""
    pts_top, pts_bot = [], []
    for k in range(n + 1):
        t = k / n
        if kind == 'ovate':
            w = 0.36 * math.sin(math.pi * t ** 0.8) * (1 - 0.15 * t)
        elif kind == 'narrow':
            w = 0.16 * math.sin(math.pi * t ** 0.9)
        elif kind == 'round':
            w = 0.46 * math.sin(math.pi * t ** 0.7)
        elif kind == 'heart':
            w = 0.5 * math.sin(math.pi * min(1, t * 1.05) ** 0.6) * (1 - 0.1 * t)
        elif kind == 'petal':
            w = 0.34 * math.sin(math.pi * t ** 0.65)
        elif kind == 'broadpetal':
            w = 0.48 * math.sin(math.pi * t ** 0.55) ** 0.8
        elif kind == 'needle':
            w = 0.05 * (1 - t) + 0.01
        else:
            w = 0.3 * math.sin(math.pi * t)
        pts_top.append((t, -w))
        pts_bot.append((t, w))
    return pts_top + pts_bot[::-1]


def maple_shape():
    """Palmate five-lobed leaf, unit size, stalk at (0,0) pointing +x."""
    pts = []
    lobes = [(-1.15, 0.62), (-0.6, 0.85), (0.0, 1.0), (0.6, 0.85), (1.15, 0.62)]
    n = 60
    for k in range(n + 1):
        a = -1.5 + 3.0 * k / n
        r = 0.34
        for la, lr in lobes:
            r = max(r, lr * math.exp(-((a - la) / 0.27) ** 2))
        pts.append((r * math.cos(a) * 0.55 + 0.05, r * math.sin(a) * 0.55))
    return [(x * 1.4, y * 1.4) for x, y in pts]


def place(shape, x, y, length, angle, width_k=1.0):
    pts = [(px * length, py * length * width_k) for px, py in shape]
    return rot(pts, angle, x, y)


def blob_field(rng, lobes):
    """Union-of-circles membership test: lobes = [(cx, cy, r)]."""
    def inside(x, y, shrink=0.0):
        return any((x - cx) ** 2 + (y - cy) ** 2 < (r - shrink) ** 2 for cx, cy, r in lobes)

    def nearest(x, y):
        best = None
        for cx, cy, r in lobes:
            d = math.hypot(x - cx, y - cy) / r
            if best is None or d < best[0]:
                best = (d, cx, cy, r)
        return best
    return inside, nearest


def clump_lobes(rng, centre=(0.5, 0.52), main=0.3, n=6, ring=0.2, small=(0.13, 0.19)):
    lobes = [(centre[0], centre[1], main)]
    for k in range(n):
        a = 2 * math.pi * (k + rng.uniform(-0.25, 0.25)) / n - math.pi / 2
        rr = ring * rng.uniform(0.85, 1.1)
        lobes.append((centre[0] + math.cos(a) * rr, centre[1] + math.sin(a) * rr * 0.92, rng.uniform(*small)))
    return lobes


def shade_value(x, y, nearest, rng, light=(-0.45, -0.9)):
    """Lightness of a leaf at (x, y): lit from the top-left, lighter towards the lobe's rim."""
    d, cx, cy, r = nearest(x, y)
    nx, ny = (x - cx) / r, (y - cy) / r
    lam = max(0.0, (nx * light[0] + ny * light[1]) / math.hypot(*light))
    v = 0.58 + 0.26 * lam + 0.16 * min(1.0, d)
    return min(1.0, v * rng.uniform(0.9, 1.06))


def leaf_colour(v, rng, hue=0.05):
    """Near-white foliage colour of lightness v with a slight yellow/blue drift per leaf."""
    w = rng.uniform(-hue, hue)
    return rgb((v * (0.96 + w), v * 1.0, v * (0.9 - w * 1.4)))


def draw_clump(cv, rng, lobes, n_leaves, leaf_len, kind='ovate', base_dark=0.42, outline=0.75, maple=False, stalks=False):
    inside, nearest = blob_field(rng, lobes)
    # Shadowed mass behind the leaves, so gaps read as depth rather than holes.
    for cx, cy, r in lobes:
        cv.ellipse(cx, cy, r * 0.86, r * 0.86, rgb((base_dark * 0.96, base_dark, base_dark * 0.86)) + (255,))
    pts = []
    tries = 0
    while len(pts) < n_leaves and tries < n_leaves * 50:
        tries += 1
        x, y = rng.uniform(0.02, 0.98), rng.uniform(0.02, 0.98)
        if inside(x, y, shrink=leaf_len * 0.25):
            pts.append((x, y))
    # Back to front: inner and lower leaves first, the lit outer leaves last.
    def depth(p):
        d, cx, cy, r = nearest(*p)
        return d * 0.7 - (p[1] - 0.5) * 0.6 + rng.uniform(-0.15, 0.15)
    pts.sort(key=depth)
    shape = maple_shape() if maple else leaf_shape(kind)
    for x, y in pts:
        d, cx, cy, r = nearest(x, y)
        out = math.atan2(y - cy, x - cx)
        a = out + rng.gauss(0, 0.75)
        L = leaf_len * rng.uniform(0.75, 1.2)
        v = shade_value(x, y, nearest, rng)
        poly = place(shape, x - math.cos(a) * L * 0.15, y - math.sin(a) * L * 0.15, L, a, rng.uniform(0.85, 1.15))
        col = leaf_colour(v, rng)
        dark = rgb((v * outline * 0.94, v * outline, v * outline * 0.84))
        cv.poly(poly, col + (255,), dark + (255,), width=0.6)
        if not maple:
            # Midrib and a lighter half, for a little relief.
            tip = (x + math.cos(a) * L * 0.8, y + math.sin(a) * L * 0.8)
            base = (x - math.cos(a) * L * 0.1, y - math.sin(a) * L * 0.1)
            half = place(shape[: len(shape) // 2], x - math.cos(a) * L * 0.15, y - math.sin(a) * L * 0.15, L, a)
            hl = rgb((min(1, v * 1.08), min(1, v * 1.1), min(1, v * 1.0)))
            cv.poly(half + [base], hl + (110,))
            cv.line([base, tip], dark + (160,), 0.5)
        if stalks and rng.random() < 0.15:
            cv.line([(x, y), (x - math.cos(a) * L * 0.5, y - math.sin(a) * L * 0.5)], rgb((0.45, 0.42, 0.36)) + (255,), 0.9)


# ---- regions --------------------------------------------------------------------------

def r_clump_broad(w, h, rng):
    cv = Canvas(w, h)
    draw_clump(cv, rng, clump_lobes(rng), 230, 0.075, 'ovate')
    return cv.result()


def r_clump_fine(w, h, rng):
    cv = Canvas(w, h)
    draw_clump(cv, rng, clump_lobes(rng, n=7, ring=0.22, small=(0.12, 0.17)), 520, 0.045, 'ovate', base_dark=0.45)
    return cv.result()


def r_clump_maple(w, h, rng):
    cv = Canvas(w, h)
    draw_clump(cv, rng, clump_lobes(rng), 300, 0.08, maple=True)
    return cv.result()


def r_clump_blossom(w, h, rng):
    cv = Canvas(w, h)
    lobes = clump_lobes(rng, main=0.28, n=6, ring=0.2)
    inside, nearest = blob_field(rng, lobes)
    for cx, cy, r in lobes:
        cv.ellipse(cx, cy, r * 0.8, r * 0.8, rgb((0.72, 0.66, 0.68)) + (255,))
    pts = []
    while len(pts) < 260:
        x, y = rng.uniform(0, 1), rng.uniform(0, 1)
        if inside(x, y, 0.02):
            pts.append((x, y))
    pts.sort(key=lambda p: p[1] + rng.uniform(-0.2, 0.2))
    for x, y in pts:
        v = shade_value(x, y, nearest, rng)
        R = rng.uniform(0.028, 0.04)
        a0 = rng.uniform(0, 2 * math.pi)
        for k in range(5):
            a = a0 + k * 2 * math.pi / 5
            poly = place(leaf_shape('broadpetal'), x, y, R, a, 1.1)
            c = (min(1, v * 1.05), v * 0.98, v * 1.0)
            cv.poly(poly, rgb(c) + (255,), rgb((v * 0.82, v * 0.76, v * 0.8)) + (255,), 0.4)
        cv.ellipse(x, y, R * 0.28, R * 0.28, rgb((0.95, 0.8, 0.45)) + (255,))
    return cv.result()


def r_clump_spruce(w, h, rng):
    """Layered needle sprays: drooping branchlets densely covered in short needles."""
    cv = Canvas(w, h)
    lobes = clump_lobes(rng, main=0.3, n=6, ring=0.2)
    inside, nearest = blob_field(rng, lobes)
    for cx, cy, r in lobes:
        cv.ellipse(cx, cy, r * 0.78, r * 0.78, rgb((0.4, 0.44, 0.42)) + (255,))
    for k in range(150):
        # A branchlet: a slightly drooping line with needles either side.
        while True:
            x, y = rng.uniform(0.05, 0.95), rng.uniform(0.05, 0.95)
            if inside(x, y, 0.06):
                break
        d, cx, cy, r = nearest(x, y)
        a = math.atan2(y - cy, x - cx) * 0.5 + rng.gauss(0, 0.5)
        L = rng.uniform(0.09, 0.15)
        v = shade_value(x, y, nearest, rng)
        steps = 14
        pts = [(x + math.cos(a) * L * t / steps, y + math.sin(a) * L * t / steps + 0.03 * (t / steps) ** 2) for t in range(steps + 1)]
        for i, (px, py) in enumerate(pts):
            t = i / steps
            nl = 0.028 * (1 - 0.5 * t)
            for sgn in (-1, 1):
                na = a + sgn * 0.9 + rng.gauss(0, 0.15)
                vv = v * rng.uniform(0.85, 1.08)
                cv.line([(px, py), (px + math.cos(na) * nl, py + math.sin(na) * nl)], rgb((vv * 0.92, vv, vv * 0.94)) + (255,), 1.6)
        cv.line(pts, rgb((v * 0.6, v * 0.58, v * 0.5)) + (255,), 0.8)
    return cv.result()


def r_willow(w, h, rng):
    """A fountain of weeping strands: they rise from the top centre, arch outwards and fall."""
    cv = Canvas(w, h)
    for s_ in range(26):
        side = -1 if s_ % 2 else 1
        reach = rng.uniform(0.08, 0.46)
        rise = rng.uniform(0.0, 0.08)
        drop = rng.uniform(0.55, 0.95)
        steps = 46
        pts = []
        for i in range(steps + 1):
            t = i / steps
            # Quadratic arch out, then a long fall that keeps drifting outwards a little.
            x = 0.5 + side * reach * (1 - (1 - min(1, t * 2.2)) ** 2) + side * 0.03 * t
            y = 0.03 + rise * (1 - t) - rise + drop * max(0, t - 0.2) ** 1.25 / 0.8 ** 1.25
            pts.append((x, min(0.99, y + 0.02)))
        v0 = rng.uniform(0.75, 1.0)
        cv.line(pts, rgb((0.55, 0.52, 0.42)) + (255,), 0.6)
        for i in range(4, steps + 1):
            px, py = pts[i]
            t = i / steps
            for sgn in (-1, 1):
                if rng.random() < 0.3:
                    continue
                a = math.pi / 2 + sgn * rng.uniform(0.3, 0.6) - side * 0.2 * (1 - t)
                v = v0 * rng.uniform(0.82, 1.05) * (0.8 + 0.2 * (1 - t))
                poly = place(leaf_shape('narrow'), px, py, rng.uniform(0.045, 0.07) * (1 - 0.25 * t), a)
                cv.poly(poly, leaf_colour(v, rng) + (255,), rgb((v * 0.75, v * 0.78, v * 0.66)) + (255,), 0.4)
    return cv.result()


def r_strap(w, h, rng):
    """Fan of long strap leaves from a point at the bottom centre (side view)."""
    cv = Canvas(w, h)
    n = 9
    for k in range(n):
        t = (k + 0.5) / n
        lean = (t - 0.5) * 1.3 + rng.gauss(0, 0.08)
        L = rng.uniform(0.7, 0.95)
        width = rng.uniform(0.1, 0.14)
        steps = 20
        spine = []
        for i in range(steps + 1):
            u = i / steps
            bend = lean * u + lean * 0.6 * u * u
            spine.append((0.5 + bend * 0.45, 0.99 - L * u * (1 - 0.25 * abs(lean) * u)))
        left, right = [], []
        for i, (px, py) in enumerate(spine):
            u = i / steps
            wv = width * (0.55 + 0.45 * math.sin(math.pi * min(1, u * 1.1) ** 0.5)) * (1 - u ** 3) * 0.5
            left.append((px - wv, py))
            right.append((px + wv, py))
        v = rng.uniform(0.75, 0.98)
        cv.poly(left + right[::-1], leaf_colour(v, rng) + (255,), rgb((v * 0.7, v * 0.74, v * 0.62)) + (255,), 0.6)
        cv.line(spine[:-2], rgb((v * 0.86, v * 0.9, v * 0.8)) + (200,), 0.8)
    return cv.result()


def r_plume(w, h, rng):
    """Fountain grass: arching blades with soft, feathery plumes."""
    cv = Canvas(w, h)
    for k in range(34):
        lean = rng.uniform(-1, 1)
        L = rng.uniform(0.55, 0.9)
        steps = 16
        pts = [(0.5 + lean * 0.42 * (i / steps) ** 1.4, 0.99 - L * (i / steps) * (1 - 0.35 * abs(lean) * (i / steps))) for i in range(steps + 1)]
        v = rng.uniform(0.6, 0.95)
        cv.line(pts, leaf_colour(v, rng) + (255,), rng.uniform(1.0, 1.8))
    for k in range(9):
        lean = rng.uniform(-0.7, 0.7)
        L = rng.uniform(0.85, 0.98)
        steps = 20
        pts = [(0.5 + lean * 0.4 * (i / steps) ** 1.3, 0.99 - L * (i / steps) * (1 - 0.3 * abs(lean) * (i / steps))) for i in range(steps + 1)]
        cv.line(pts, rgb((0.7, 0.68, 0.55)) + (255,), 0.8)
        for i in range(11, steps + 1):
            px, py = pts[i]
            for j in range(9):
                a = rng.uniform(0, 2 * math.pi)
                r = rng.uniform(0.004, 0.03) * (1 - 0.4 * abs(i - 16) / 6)
                cv.ellipse(px + math.cos(a) * r, py + math.sin(a) * r, 0.009, 0.006, rgb((0.97, 0.92, 0.82)) + (200,))
    return cv.result()


def r_fern(w, h, rng):
    """One fern frond, base at the bottom centre, curving slightly."""
    cv = Canvas(w, h)
    steps = 34
    spine = [(0.5 + 0.06 * (i / steps) ** 2, 0.99 - 0.95 * i / steps) for i in range(steps + 1)]
    for i in range(2, steps):
        u = i / steps
        px, py = spine[i]
        L = 0.42 * math.sin(math.pi * min(1, u * 1.08) ** 0.7) * (1 - u * 0.2)
        for sgn in (-1, 1):
            a = -math.pi / 2 + sgn * (1.25 - 0.3 * u)
            v = 0.75 + 0.2 * rng.random()
            # pinna: a narrow leaf with scalloped lobes
            pin = place(leaf_shape('narrow', 18), px, py, L, a, 0.85)
            cv.poly(pin, leaf_colour(v, rng) + (255,), rgb((v * 0.7, v * 0.74, v * 0.6)) + (255,), 0.5)
    cv.line(spine, rgb((0.6, 0.62, 0.48)) + (255,), 1.2)
    return cv.result()


def r_monstera(w, h, rng):
    cv = Canvas(w, h)
    cx, cy = 0.5, 0.48
    pts = []
    n = 80
    for k in range(n + 1):
        a = 2 * math.pi * k / n
        r = 0.42 * (1 - 0.18 * math.cos(a - math.pi / 2)) * (0.92 if math.sin(a) > 0.95 else 1)
        pts.append((cx + math.cos(a) * r * 0.95, cy + math.sin(a) * r * 1.05))
    cv.poly(pts, rgb((0.86, 0.9, 0.82)) + (255,), rgb((0.6, 0.64, 0.55)) + (255,), 0.8)
    # Splits from the rim towards the midrib, and a few holes.
    for side in (-1, 1):
        for k in range(5):
            y = 0.2 + 0.13 * k
            x_edge = cx + side * 0.44
            cv.poly([(x_edge + side * 0.05, y - 0.03), (cx + side * 0.09, y + 0.03), (x_edge + side * 0.05, y + 0.02)], (0, 0, 0, 0))
            if k in (1, 3):
                cv.ellipse(cx + side * 0.18, y + 0.06, 0.035, 0.022, (0, 0, 0, 0))
    cv.line([(cx, 0.98), (cx, cy - 0.38)], rgb((0.7, 0.74, 0.62)) + (255,), 1.6)
    for side in (-1, 1):
        for k in range(6):
            y = 0.2 + 0.12 * k
            cv.line([(cx, y + 0.06), (cx + side * 0.36, y - 0.02)], rgb((0.74, 0.78, 0.68)) + (255,), 0.7)
    return cv.result()


def r_heart(w, h, rng):
    cv = Canvas(w, h)
    pts = place(leaf_shape('heart', 30), 0.5, 0.97, 0.9, -math.pi / 2, 1.0)
    cv.poly(pts, rgb((0.88, 0.92, 0.84)) + (255,), rgb((0.6, 0.65, 0.55)) + (255,), 0.8)
    cv.line([(0.5, 0.97), (0.5, 0.12)], rgb((0.72, 0.76, 0.65)) + (255,), 1.0)
    for k in range(6):
        y = 0.8 - 0.1 * k
        for side in (-1, 1):
            cv.line([(0.5, y), (0.5 + side * 0.25 * (1 - k * 0.1), y - 0.12)], rgb((0.76, 0.8, 0.7)) + (255,), 0.6)
    return cv.result()


def r_sword(w, h, rng):
    cv = Canvas(w, h)
    steps = 30
    left, right = [], []
    for i in range(steps + 1):
        u = i / steps
        wv = 0.4 * (1 - u ** 2.5) + 0.02
        left.append((0.5 - wv, 0.99 - 0.97 * u))
        right.append((0.5 + wv, 0.99 - 0.97 * u))
    cv.poly(left + right[::-1], rgb((0.95, 0.9, 0.55)) + (255,))
    inner_l = [(x + 0.07 * (1 - i / steps), y) for i, (x, y) in enumerate(left)]
    inner_r = [(x - 0.07 * (1 - i / steps), y) for i, (x, y) in enumerate(right)]
    cv.poly(inner_l + inner_r[::-1], rgb((0.62, 0.72, 0.55)) + (255,))
    for k in range(14):
        y = 0.92 - k * 0.062
        cv.line([(0.5 - 0.3 * (1 - (0.99 - y)), y), (0.5 + 0.3 * (1 - (0.99 - y)), y - 0.02)], rgb((0.78, 0.86, 0.66)) + (180,), 2.0)
    return cv.result()


def r_palm(w, h, rng):
    cv = Canvas(w, h)
    steps = 26
    spine = [(0.5 + 0.12 * (i / steps) ** 2, 0.99 - 0.94 * i / steps) for i in range(steps + 1)]
    for i in range(3, steps):
        u = i / steps
        px, py = spine[i]
        L = 0.48 * math.sin(math.pi * min(1, u * 1.05) ** 0.8)
        for sgn in (-1, 1):
            a = -math.pi / 2 + sgn * (1.0 - 0.25 * u) + 0.25
            v = 0.75 + 0.2 * rng.random()
            cv.poly(place(leaf_shape('narrow'), px, py, L, a, 0.7), leaf_colour(v, rng) + (255,), rgb((v * 0.7, v * 0.74, v * 0.6)) + (255,), 0.5)
    cv.line(spine, rgb((0.62, 0.64, 0.5)) + (255,), 1.0)
    return cv.result()


def r_rosette(w, h, rng):
    cv = Canvas(w, h)
    for ring in range(5, 0, -1):
        n = 5 + ring * 2
        L = 0.09 * ring + 0.03
        for k in range(n):
            a = 2 * math.pi * (k + 0.5 * (ring % 2)) / n
            v = 0.62 + 0.08 * (5 - ring) + rng.uniform(-0.04, 0.04)
            poly = place(leaf_shape('petal'), 0.5, 0.5, L, a, 1.3)
            cv.poly(poly, rgb((v * 0.96, v, v * 0.96)) + (255,), rgb((v * 0.8, v * 0.72, v * 0.78)) + (255,), 0.9)
    return cv.result()


def r_lettuce(w, h, rng):
    cv = Canvas(w, h)
    pts = []
    n = 90
    for k in range(n + 1):
        a = 2 * math.pi * k / n
        r = 0.44 + 0.03 * math.sin(a * 14 + rng.uniform(0, 0.3))
        pts.append((0.5 + math.cos(a) * r, 0.52 + math.sin(a) * r * 0.9))
    cv.poly(pts, rgb((0.9, 0.95, 0.8)) + (255,), rgb((0.66, 0.72, 0.56)) + (255,), 1.0)
    for k in range(9):
        a = -math.pi / 2 + (k - 4) * 0.3
        cv.line([(0.5, 0.95), (0.5 + math.cos(a) * 0.4, 0.95 + math.sin(a) * 0.8)], rgb((0.97, 0.99, 0.9)) + (220,), 1.2)
    return cv.result()


def r_herb(w, h, rng):
    cv = Canvas(w, h)
    spine = [(0.5, 0.98), (0.5, 0.1)]
    cv.line(spine, rgb((0.62, 0.66, 0.5)) + (255,), 1.2)
    for k in range(7):
        y = 0.85 - k * 0.11
        L = 0.3 * (1 - k * 0.09)
        for sgn in (-1, 1):
            a = -math.pi / 2 + sgn * 1.0
            v = 0.78 + 0.18 * rng.random()
            cv.poly(place(leaf_shape('round'), 0.5, y, L, a, 1.0), leaf_colour(v, rng) + (255,), rgb((v * 0.68, v * 0.72, v * 0.6)) + (255,), 0.6)
    cv.poly(place(leaf_shape('round'), 0.5, 0.14, 0.12, -math.pi / 2), leaf_colour(0.95, rng) + (255,))
    return cv.result()


def r_fig(w, h, rng):
    cv = Canvas(w, h)
    pts = place(leaf_shape('round', 30), 0.5, 0.97, 0.9, -math.pi / 2, 0.95)
    cv.poly(pts, rgb((0.82, 0.86, 0.78)) + (255,), rgb((0.55, 0.6, 0.5)) + (255,), 0.9)
    # Wavy glossy highlight and veins.
    cv.poly(place(leaf_shape('round', 30)[:31], 0.5, 0.97, 0.9, -math.pi / 2, 0.95) + [(0.5, 0.97)], rgb((0.94, 0.97, 0.9)) + (90,))
    cv.line([(0.5, 0.97), (0.5, 0.1)], rgb((0.9, 0.92, 0.8)) + (255,), 1.2)
    for k in range(6):
        y = 0.82 - 0.12 * k
        for side in (-1, 1):
            cv.line([(0.5, y), (0.5 + side * 0.3, y - 0.1)], rgb((0.9, 0.92, 0.82)) + (200,), 0.7)
    return cv.result()


def r_feather(w, h, rng):
    cv = Canvas(w, h)
    for s in range(5):
        lean = (s - 2) * 0.12 + rng.gauss(0, 0.03)
        steps = 20
        spine = [(0.5 + lean * i / steps, 0.99 - 0.92 * i / steps) for i in range(steps + 1)]
        cv.line(spine, rgb((0.7, 0.75, 0.6)) + (255,), 0.8)
        for i in range(4, steps + 1):
            px, py = spine[i]
            for sgn in (-1, 1):
                for j in range(3):
                    a = -math.pi / 2 + lean + sgn * rng.uniform(0.6, 1.2)
                    L = rng.uniform(0.04, 0.1)
                    v = rng.uniform(0.75, 1.0)
                    cv.line([(px, py), (px + math.cos(a) * L, py + math.sin(a) * L)], leaf_colour(v, rng) + (255,), 0.9)
    return cv.result()


def r_stem(w, h, rng):
    arr = np.zeros((h, w, 4), np.uint8)
    for x in range(w):
        t = abs((x + 0.5) / w - 0.5) * 2
        v = 0.92 - 0.25 * t * t
        arr[:, x, :3] = rgb((v * 0.92, v, v * 0.84))
    arr[..., 3] = 255
    return Image.fromarray(arr, 'RGBA')


def r_soil(w, h, rng):
    nrng = np.random.default_rng(7)
    base = np.array([0.36, 0.26, 0.18])
    noise = ndimage.gaussian_filter(nrng.random((h, w)), 1.2)
    noise = (noise - noise.min()) / (noise.max() - noise.min())
    grit = nrng.random((h, w))
    v = 0.75 + 0.45 * noise + 0.25 * (grit > 0.93) - 0.25 * (grit < 0.05)
    arr = np.zeros((h, w, 4), np.uint8)
    arr[..., :3] = (np.clip(base[None, None] * v[..., None], 0, 1) * 255).astype(np.uint8)
    arr[..., 3] = 255
    return Image.fromarray(arr, 'RGBA')


def r_bark_smooth(w, h, rng):
    nrng = np.random.default_rng(3)
    n = ndimage.gaussian_filter(nrng.random((h, w)), (6, 0.8))
    n = (n - n.min()) / (n.max() - n.min())
    v = 0.72 + 0.28 * n
    arr = np.zeros((h, w, 4), np.uint8)
    arr[..., :3] = (np.clip(np.stack([v * 0.98, v * 0.94, v * 0.88], -1), 0, 1) * 255).astype(np.uint8)
    arr[..., 3] = 255
    return Image.fromarray(arr, 'RGBA')


def r_clump_needle(w, h, rng):
    """Soft mound of short grey-green needles (lavender, rosemary bushes)."""
    cv = Canvas(w, h)
    lobes = clump_lobes(rng, main=0.3, n=5, ring=0.18)
    inside, nearest = blob_field(rng, lobes)
    for cx, cy, r in lobes:
        cv.ellipse(cx, cy, r * 0.85, r * 0.85, rgb((0.45, 0.46, 0.42)) + (255,))
    for k in range(1400):
        x, y = rng.uniform(0, 1), rng.uniform(0, 1)
        if not inside(x, y, 0.01):
            continue
        d, cx, cy, r = nearest(x, y)
        a = math.atan2(y - cy, x - cx) * 0.4 - math.pi / 2 * 0.6 + rng.gauss(0, 0.5)
        L = rng.uniform(0.025, 0.05)
        v = shade_value(x, y, nearest, rng)
        cv.line([(x, y), (x + math.cos(a) * L, y + math.sin(a) * L)], leaf_colour(v, rng, 0.02) + (255,), 1.3)
    return cv.result()


def r_clump_flower(w, h, rng):
    """A mound of leaves sprinkled with tiny pale flowers (the flowers take the tint)."""
    cv = Canvas(w, h)
    lobes = clump_lobes(rng, main=0.3, n=6, ring=0.2)
    inside, nearest = blob_field(rng, lobes)
    for cx, cy, r in lobes:
        cv.ellipse(cx, cy, r * 0.85, r * 0.85, rgb((0.7, 0.7, 0.7)) + (255,))
    pts = []
    while len(pts) < 240:
        x, y = rng.uniform(0, 1), rng.uniform(0, 1)
        if inside(x, y, 0.015):
            pts.append((x, y))
    pts.sort(key=lambda p: p[1] + rng.uniform(-0.2, 0.2))
    for x, y in pts:
        v = shade_value(x, y, nearest, rng)
        R = rng.uniform(0.022, 0.032)
        a0 = rng.uniform(0, 6.3)
        for k in range(5):
            cv.poly(place(leaf_shape('broadpetal'), x, y, R, a0 + k * 1.2566, 1.1), rgb((v, v * 0.97, v * 0.98)) + (255,), rgb((v * 0.8, v * 0.76, v * 0.8)) + (255,), 0.3)
        cv.ellipse(x, y, R * 0.3, R * 0.3, rgb((0.98, 0.86, 0.5)) + (255,))
    return cv.result()


def r_clover(w, h, rng):
    cv = Canvas(w, h)
    lobes = [(0.5, 0.55, 0.42)]
    inside, nearest = blob_field(rng, lobes)
    pts = []
    while len(pts) < 70:
        x, y = rng.uniform(0, 1), rng.uniform(0, 1)
        if inside(x, y, 0.06):
            pts.append((x, y))
    pts.sort(key=lambda p: p[1])
    for x, y in pts:
        v = shade_value(x, y, nearest, rng)
        a0 = rng.uniform(0, 6.3)
        for k in range(3):
            a = a0 + k * 2.094
            cv.poly(place(leaf_shape('heart', 12), x, y, 0.08, a, 1.0), leaf_colour(v, rng) + (255,), rgb((v * 0.7, v * 0.74, v * 0.62)) + (255,), 0.5)
    return cv.result()


def r_lily_pad(w, h, rng):
    cv = Canvas(w, h)
    pts = []
    for k in range(73):
        a = 0.25 + (2 * math.pi - 0.5) * k / 72
        pts.append((0.5 + math.cos(a) * 0.46, 0.5 + math.sin(a) * 0.46))
    cv.poly(pts + [(0.5, 0.5)], rgb((0.84, 0.9, 0.78)) + (255,), rgb((0.6, 0.66, 0.54)) + (255,), 1.0)
    for k in range(12):
        a = 0.4 + (2 * math.pi - 0.8) * k / 11
        cv.line([(0.5, 0.5), (0.5 + math.cos(a) * 0.42, 0.5 + math.sin(a) * 0.42)], rgb((0.9, 0.95, 0.84)) + (200,), 0.8)
    return cv.result()


# Flower heads ----------------------------------------------------------------------

def petals(cv, cx, cy, n, L, kind, colour, edge, rng, a0=0.0, wk=1.0, jitter=0.08):
    for k in range(n):
        a = a0 + 2 * math.pi * k / n + rng.uniform(-jitter, jitter)
        cv.poly(place(leaf_shape(kind), cx, cy, L * rng.uniform(0.92, 1.05), a, wk), rgb(colour) + (255,), rgb(edge) + (255,), 0.6)


def r_daisy(w, h, rng):
    cv = Canvas(w, h)
    petals(cv, 0.5, 0.5, 22, 0.45, 'narrow', (0.99, 0.99, 0.97), (0.82, 0.82, 0.8), rng, wk=1.6)
    petals(cv, 0.5, 0.5, 16, 0.4, 'narrow', (0.96, 0.96, 0.94), (0.8, 0.8, 0.78), rng, a0=0.1, wk=1.5)
    cv.ellipse(0.5, 0.5, 0.13, 0.13, rgb((0.92, 0.7, 0.12)) + (255,))
    cv.ellipse(0.48, 0.48, 0.07, 0.07, rgb((1.0, 0.82, 0.3)) + (255,))
    return cv.result()


def r_sunflower(w, h, rng):
    cv = Canvas(w, h)
    petals(cv, 0.5, 0.5, 24, 0.46, 'petal', (0.98, 0.76, 0.12), (0.82, 0.55, 0.06), rng, wk=0.9)
    petals(cv, 0.5, 0.5, 20, 0.4, 'petal', (1.0, 0.84, 0.2), (0.85, 0.6, 0.1), rng, a0=0.13, wk=0.85)
    cv.ellipse(0.5, 0.5, 0.22, 0.22, rgb((0.3, 0.18, 0.08)) + (255,))
    for k in range(160):
        a = k * 2.39996
        r = 0.2 * math.sqrt(k / 160)
        cv.ellipse(0.5 + math.cos(a) * r, 0.5 + math.sin(a) * r, 0.008, 0.008, rgb((0.45, 0.3, 0.12)) + (255,))
    return cv.result()


def r_rose(w, h, rng):
    cv = Canvas(w, h)
    for ring in range(6, 0, -1):
        n = 3 + ring
        R = 0.07 * ring + 0.04
        v = 0.98 - 0.06 * (6 - ring) * 0.5
        for k in range(n):
            a = ring * 0.7 + 2 * math.pi * k / n
            cx, cy = 0.5 + math.cos(a) * R * 0.4, 0.5 + math.sin(a) * R * 0.4
            cv.ellipse(cx, cy, R * 0.55, R * 0.45, rgb((v * 0.75, v * 0.72, v * 0.74)) + (255,))
            cv.ellipse(cx + math.cos(a) * 0.01, cy + math.sin(a) * 0.01, R * 0.5, R * 0.4, rgb((v, v * 0.97, v * 0.98)) + (255,))
    cv.ellipse(0.5, 0.5, 0.05, 0.05, rgb((0.7, 0.66, 0.68)) + (255,))
    return cv.result()


def r_tulip(w, h, rng):
    """Side view: a cup of three overlapping petals; transparent below the cup."""
    cv = Canvas(w, h)
    cup = [(0.5 + 0.38 * math.sin(t * math.pi) * (1 if t < 0.5 else 1) * (0.8 + 0.2 * math.sin(t * math.pi)), 0) for t in ()]  # noqa
    def petal(cx, wd, v):
        pts = []
        for k in range(21):
            t = k / 20
            y = 0.62 - 0.55 * t
            x = cx + (wd * math.sin(math.pi * (0.15 + 0.85 * t) ** 0.7)) * 1
            pts.append((x, y))
        for k in range(21):
            t = 1 - k / 20
            y = 0.62 - 0.55 * t
            x = cx - (wd * math.sin(math.pi * (0.15 + 0.85 * t) ** 0.7))
            pts.append((x, y))
        cv.poly(pts, rgb((v, v * 0.97, v * 0.97)) + (255,), rgb((v * 0.78, v * 0.74, v * 0.76)) + (255,), 0.8)
    petal(0.34, 0.2, 0.82)
    petal(0.66, 0.2, 0.86)
    petal(0.5, 0.26, 0.98)
    cv.line([(0.5, 0.62), (0.5, 1.0)], rgb((0.62, 0.72, 0.46)) + (255,), 4)
    return cv.result()


def r_poppy(w, h, rng):
    cv = Canvas(w, h)
    for k in range(4):
        a = k * math.pi / 2 + 0.3
        cv.ellipse(0.5 + math.cos(a) * 0.2, 0.5 + math.sin(a) * 0.2, 0.27, 0.25, rgb((0.82, 0.8, 0.8)) + (255,))
        cv.ellipse(0.5 + math.cos(a) * 0.21, 0.5 + math.sin(a) * 0.21, 0.25, 0.23, rgb((0.98, 0.96, 0.96)) + (255,))
    cv.ellipse(0.5, 0.5, 0.12, 0.12, rgb((0.12, 0.1, 0.1)) + (255,))
    cv.ellipse(0.5, 0.5, 0.06, 0.06, rgb((0.5, 0.55, 0.35)) + (255,))
    return cv.result()


def r_pompom(w, h, rng):
    cv = Canvas(w, h)
    for ring in range(9, 0, -1):
        n = 6 + ring * 3
        R = 0.05 * ring
        v = 0.7 + 0.03 * (10 - ring)
        for k in range(n):
            a = 2 * math.pi * (k + 0.5 * (ring % 2)) / n
            cv.poly(place(leaf_shape('broadpetal'), 0.5, 0.5, R + 0.04, a, 0.7), rgb((v, v * 0.97, v * 0.95)) + (255,), rgb((v * 0.75, v * 0.72, v * 0.7)) + (255,), 0.6)
    return cv.result()


def r_star(w, h, rng):
    cv = Canvas(w, h)
    petals(cv, 0.5, 0.5, 3, 0.47, 'petal', (0.92, 0.9, 0.9), (0.72, 0.7, 0.7), rng, a0=0.5, wk=0.9)
    petals(cv, 0.5, 0.5, 3, 0.47, 'petal', (1.0, 0.98, 0.98), (0.78, 0.76, 0.76), rng, a0=0.5 + math.pi / 3, wk=0.9)
    for k in range(30):
        a, r = rng.uniform(0, 6.3), rng.uniform(0.05, 0.22)
        cv.ellipse(0.5 + math.cos(a) * r, 0.5 + math.sin(a) * r, 0.007, 0.007, rgb((0.45, 0.2, 0.15)) + (255,))
    for k in range(6):
        a = k * 1.047 + 0.2
        cv.line([(0.5, 0.5), (0.5 + math.cos(a) * 0.2, 0.5 + math.sin(a) * 0.2)], rgb((0.6, 0.66, 0.4)) + (255,), 1.2)
        cv.ellipse(0.5 + math.cos(a) * 0.2, 0.5 + math.sin(a) * 0.2, 0.018, 0.012, rgb((0.55, 0.28, 0.12)) + (255,))
    return cv.result()


def r_five(w, h, rng):
    cv = Canvas(w, h)
    petals(cv, 0.5, 0.5, 5, 0.46, 'broadpetal', (0.98, 0.97, 0.97), (0.8, 0.78, 0.78), rng, a0=-math.pi / 2, wk=1.05)
    cv.ellipse(0.5, 0.5, 0.09, 0.09, rgb((0.72, 0.68, 0.7)) + (255,))
    cv.ellipse(0.5, 0.5, 0.035, 0.035, rgb((0.95, 0.85, 0.4)) + (255,))
    return cv.result()


def r_spike(w, h, rng):
    """Side view: a tapering spike of bell flowers (lupin, foxglove), base at the bottom."""
    cv = Canvas(w, h)
    cv.line([(0.5, 1.0), (0.5, 0.02)], rgb((0.6, 0.7, 0.45)) + (255,), 2)
    n = 26
    for k in range(n):
        t = k / n
        y = 0.97 - 0.93 * t
        r = 0.36 * (1 - t * 0.75)
        for sgn in (-1, 1, 0):
            x = 0.5 + sgn * r * 0.8 + rng.uniform(-0.03, 0.03)
            v = 0.85 + 0.15 * t
            cv.ellipse(x, y, r * 0.55, 0.022, rgb((v * 0.8, v * 0.78, v * 0.8)) + (255,))
            cv.ellipse(x, y - 0.004, r * 0.5, 0.018, rgb((v, v * 0.98, v)) + (255,))
    return cv.result()


def r_lavender(w, h, rng):
    cv = Canvas(w, h)
    cv.line([(0.5, 1.0), (0.5, 0.04)], rgb((0.66, 0.7, 0.55)) + (255,), 2)
    for k in range(40):
        t = k / 40
        y = 0.55 - 0.5 * t
        for sgn in (-1, 1):
            x = 0.5 + sgn * rng.uniform(0.05, 0.22) * (1 - 0.4 * t)
            v = rng.uniform(0.75, 1.0)
            cv.ellipse(x, y, 0.08, 0.02, rgb((v, v * 0.97, v)) + (255,))
    return cv.result()


def r_hydrangea(w, h, rng):
    cv = Canvas(w, h)
    cv.ellipse(0.5, 0.5, 0.44, 0.44, rgb((0.7, 0.7, 0.72)) + (255,))
    pts = []
    for k in range(150):
        a, r = rng.uniform(0, 6.3), 0.42 * math.sqrt(rng.random())
        pts.append((0.5 + math.cos(a) * r, 0.5 + math.sin(a) * r))
    pts.sort(key=lambda p: -math.hypot(p[0] - 0.5, p[1] - 0.5))
    for x, y in pts:
        d = math.hypot(x - 0.4, y - 0.4)
        v = 1.0 - 0.3 * min(1, d / 0.5)
        a0 = rng.uniform(0, 1.6)
        for k in range(4):
            cv.poly(place(leaf_shape('broadpetal'), x, y, 0.045, a0 + k * 1.5708, 1.1), rgb((v, v, v)) + (255,), rgb((v * 0.8, v * 0.8, v * 0.84)) + (255,), 0.4)
    return cv.result()


def r_pansy(w, h, rng):
    cv = Canvas(w, h)
    for a, sc in [(-2.2, 0.9), (-0.95, 0.9), (math.pi / 2 - 0.6, 1.0), (math.pi / 2 + 0.6, 1.0), (math.pi / 2, 1.05)]:
        cv.ellipse(0.5 + math.cos(a) * 0.2 * sc, 0.5 + math.sin(a) * 0.2 * sc, 0.22 * sc, 0.2 * sc, rgb((0.97, 0.96, 0.97)) + (255,))
    for k in range(9):
        a = math.pi / 2 + (k - 4) * 0.22
        cv.line([(0.5, 0.52), (0.5 + math.cos(a) * 0.22, 0.52 + math.sin(a) * 0.22)], rgb((0.18, 0.12, 0.25)) + (255,), 2.2)
    cv.ellipse(0.5, 0.55, 0.13, 0.11, rgb((0.2, 0.14, 0.28)) + (255,))
    cv.ellipse(0.5, 0.5, 0.035, 0.035, rgb((1.0, 0.85, 0.2)) + (255,))
    return cv.result()


def r_cluster(w, h, rng):
    cv = Canvas(w, h)
    for k in range(90):
        a, r = rng.uniform(0, 6.3), 0.42 * math.sqrt(rng.random())
        x, y = 0.5 + math.cos(a) * r, 0.5 + math.sin(a) * r
        R = rng.uniform(0.03, 0.045)
        a0 = rng.uniform(0, 1.2)
        for j in range(5):
            cv.poly(place(leaf_shape('broadpetal'), x, y, R, a0 + j * 1.2566, 1.1), rgb((0.98, 0.98, 1.0)) + (255,), rgb((0.8, 0.8, 0.84)) + (255,), 0.3)
        cv.ellipse(x, y, R * 0.3, R * 0.3, rgb((1.0, 0.88, 0.3)) + (255,))
    return cv.result()


def r_daffodil(w, h, rng):
    cv = Canvas(w, h)
    petals(cv, 0.5, 0.5, 6, 0.44, 'petal', (1.0, 0.95, 0.55), (0.85, 0.75, 0.3), rng, a0=-math.pi / 2, wk=1.0)
    cv.ellipse(0.5, 0.5, 0.19, 0.19, rgb((0.95, 0.68, 0.12)) + (255,))
    cv.ellipse(0.5, 0.5, 0.15, 0.15, rgb((1.0, 0.78, 0.2)) + (255,))
    cv.ellipse(0.5, 0.5, 0.07, 0.07, rgb((0.85, 0.55, 0.08)) + (255,))
    return cv.result()


def r_cosmos(w, h, rng):
    cv = Canvas(w, h)
    petals(cv, 0.5, 0.5, 8, 0.46, 'broadpetal', (0.98, 0.97, 0.98), (0.8, 0.77, 0.8), rng, wk=0.75)
    for k in range(8):
        a = 2 * math.pi * k / 8
        cv.line([(0.5 + math.cos(a) * 0.1, 0.5 + math.sin(a) * 0.1), (0.5 + math.cos(a) * 0.3, 0.5 + math.sin(a) * 0.3)], rgb((0.86, 0.84, 0.86)) + (255,), 1)
    cv.ellipse(0.5, 0.5, 0.09, 0.09, rgb((0.95, 0.75, 0.15)) + (255,))
    return cv.result()


def r_magnolia(w, h, rng):
    """Side view of a goblet flower: pale petals blushing pink towards the base."""
    cv = Canvas(w, h)
    for cx, wd, v in [(0.3, 0.17, 0.82), (0.7, 0.17, 0.84), (0.42, 0.18, 0.92), (0.58, 0.18, 0.95), (0.5, 0.2, 1.0)]:
        pts = []
        for k in range(41):
            t = k / 40
            a = math.pi * t
            pts.append((cx + math.cos(a) * wd, 0.9 - math.sin(a) * 0.75 * (0.8 + 0.2 * math.sin(a))))
        cv.poly(pts, rgb((v, v * 0.92, v * 0.95)) + (255,), rgb((v * 0.8, v * 0.7, v * 0.75)) + (255,), 0.8)
        cv.poly([(cx - wd * 0.8, 0.9), (cx + wd * 0.8, 0.9), (cx, 0.5)], rgb((v * 0.95, v * 0.62, v * 0.78)) + (150,))
    return cv.result()


def r_fruit(w, h, rng):
    cv = Canvas(w, h)
    cv.ellipse(0.5, 0.54, 0.4, 0.38, rgb((0.78, 0.78, 0.78)) + (255,))
    cv.ellipse(0.48, 0.52, 0.37, 0.35, rgb((0.95, 0.95, 0.95)) + (255,))
    cv.ellipse(0.38, 0.4, 0.1, 0.07, rgb((1.0, 1.0, 1.0)) + (255,))
    cv.ellipse(0.5, 0.16, 0.05, 0.03, rgb((0.45, 0.6, 0.3)) + (255,))
    return cv.result()


def r_apple(w, h, rng):
    cv = Canvas(w, h)
    cv.ellipse(0.5, 0.56, 0.38, 0.36, rgb((0.55, 0.06, 0.05)) + (255,))
    cv.ellipse(0.47, 0.54, 0.34, 0.32, rgb((0.82, 0.14, 0.1)) + (255,))
    cv.ellipse(0.38, 0.44, 0.1, 0.07, rgb((0.98, 0.55, 0.45)) + (255,))
    cv.line([(0.5, 0.25), (0.53, 0.08)], rgb((0.35, 0.25, 0.12)) + (255,), 3)
    cv.poly(place(leaf_shape('ovate'), 0.52, 0.12, 0.3, -0.4), rgb((0.4, 0.62, 0.22)) + (255,))
    return cv.result()


def r_strawberry(w, h, rng):
    cv = Canvas(w, h)
    pts = []
    for k in range(41):
        a = 2 * math.pi * k / 40
        r = 0.36 * (1 + 0.25 * math.sin(a))
        pts.append((0.5 + math.cos(a) * r * 0.85, 0.5 + math.sin(a) * r))
    cv.poly(pts, rgb((0.85, 0.1, 0.12)) + (255,), rgb((0.55, 0.05, 0.06)) + (255,), 1)
    for k in range(30):
        a, r = rng.uniform(0, 6.3), 0.3 * math.sqrt(rng.random())
        cv.ellipse(0.5 + math.cos(a) * r * 0.85, 0.55 + math.sin(a) * r, 0.012, 0.016, rgb((1.0, 0.85, 0.4)) + (255,))
    for k in range(5):
        cv.poly(place(leaf_shape('petal'), 0.5, 0.2, 0.18, -math.pi / 2 + (k - 2) * 0.7), rgb((0.35, 0.6, 0.2)) + (255,))
    return cv.result()


def r_berry(w, h, rng):
    cv = Canvas(w, h)
    for k in range(14):
        a, r = rng.uniform(0, 6.3), 0.3 * math.sqrt(rng.random())
        x, y = 0.5 + math.cos(a) * r, 0.55 + math.sin(a) * r
        cv.ellipse(x, y, 0.12, 0.12, rgb((0.7, 0.7, 0.72)) + (255,))
        cv.ellipse(x - 0.01, y - 0.01, 0.1, 0.1, rgb((0.95, 0.95, 0.97)) + (255,))
        cv.ellipse(x - 0.04, y - 0.04, 0.025, 0.025, rgb((1, 1, 1)) + (255,))
    return cv.result()


def bleed(img):
    """Fill transparent pixels with the nearest opaque colour (keeps alpha)."""
    arr = np.array(img).astype(np.uint8)
    a = arr[..., 3]
    mask = a < 8
    if mask.all() or not mask.any():
        return img
    _, (iy, ix) = ndimage.distance_transform_edt(mask, return_indices=True)
    filled = arr[iy, ix]
    out = arr.copy()
    out[..., :3] = np.where(mask[..., None], filled[..., :3], arr[..., :3])
    return Image.fromarray(out, 'RGBA')


DRAW = {
    'clump.broad': r_clump_broad, 'clump.fine': r_clump_fine, 'clump.maple': r_clump_maple, 'clump.blossom': r_clump_blossom,
    'clump.spruce': r_clump_spruce, 'willow': r_willow, 'strap': r_strap, 'plume': r_plume, 'fern': r_fern,
    'monstera': r_monstera, 'heart': r_heart, 'sword': r_sword, 'palm': r_palm, 'rosette': r_rosette, 'lettuce': r_lettuce,
    'herb': r_herb, 'fig': r_fig, 'feather': r_feather, 'stem': r_stem, 'soil': r_soil, 'bark.smooth': r_bark_smooth,
    'clump.needle': r_clump_needle, 'clump.flower': r_clump_flower, 'clover': r_clover, 'lily.pad': r_lily_pad,
    'daisy': r_daisy, 'sunflower': r_sunflower, 'rose': r_rose, 'tulip': r_tulip, 'poppy': r_poppy, 'pompom': r_pompom,
    'star': r_star, 'five': r_five, 'spike': r_spike, 'lavender': r_lavender, 'hydrangea': r_hydrangea, 'pansy': r_pansy,
    'cluster': r_cluster, 'daffodil': r_daffodil, 'cosmos': r_cosmos, 'magnolia': r_magnolia, 'fruit': r_fruit,
    'apple': r_apple, 'strawberry': r_strawberry, 'berry': r_berry,
}
# From the photo atlas leaves.webp (1024 px; nature_atlas.py regions C, B and E).
COPIED = {'conifer': (0, 512, 512, 1024), 'sprig': (512, 0, 1024, 512), 'grass': (512, 768, 768, 1024)}


def main():
    folder = sys.argv[1]
    only = set(sys.argv[2:])
    out = os.path.join(folder, 'foliage.webp')
    # With region names given, only those are redrawn (into the current atlas).
    atlas = Image.open(out).convert('RGBA') if only else Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    old = Image.open(os.path.join(folder, 'leaves.webp')).convert('RGBA')
    for name, box in COPIED.items():
        x0, y0, x1, y1 = REGIONS[name]
        atlas.paste(old.crop(box).resize((x1 - x0, y1 - y0), Image.LANCZOS), (x0, y0))
    for name, fn in DRAW.items():
        if only and name not in only:
            continue
        x0, y0, x1, y1 = REGIONS[name]
        img = fn(x1 - x0, y1 - y0, random.Random(hash(name) & 0xFFFF if False else sum(map(ord, name))))
        atlas.paste(bleed(img), (x0, y0))
    atlas = bleed(atlas)
    atlas.save(out, 'WEBP', quality=88, method=6)
    print(out, os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    main()
