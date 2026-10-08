# Converts downloaded house/interior texture maps (Poly Haven + ambientCG, all CC0) into the
# game's albedo/normal/arm JPGs. Needs Pillow + numpy.
# usage: python3 -I process_house.py <src_root> <dst_root>
#   <src_root>/ph/<id>/{Diffuse,nor_gl,arm}.jpg               (ph_tex.py output)
#   <src_root>/acg/<Id>/{Color,NormalGL,Roughness[,AmbientOcclusion]}.jpg  (unzipped ambientCG 1K-JPG)
#
# Orientation: textures load with invertY=false, so image row 0 lands at v=0. Wall/roof UVs have
# v increasing upwards, so sets with a clear "up" (lap siding, roof slates) are stored flipped
# vertically (normal G inverted to match) and look upright in game.
import sys, os
import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]

def to_lin(a): return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
def to_srgb(a): return np.where(a <= 0.0031308, 12.92 * a, 1.055 * np.power(a, 1 / 2.4) - 0.055)

def wrap_blur(img, radius):
    """Gaussian blur that wraps around the edges, so tiling stays seamless."""
    w, h = img.size
    big = Image.new(img.mode, (w * 3, h * 3))
    for i in range(3):
        for j in range(3): big.paste(img, (i * w, j * h))
    return big.filter(ImageFilter.GaussianBlur(radius)).crop((w, h, 2 * w, 2 * h))

def grey_detail(im, target_lin, contrast=1.0, flatten=0):
    """Luminance-only detail map with linear mean ~target_lin (the manifest colour sets the hue).
    contrast < 1 softens the detail; flatten > 0 divides out blotches larger than ~flatten px
    (less visible repetition at a distance). Highlights are soft-clipped so dark lines survive."""
    g = im.convert('L')
    lin = to_lin(np.asarray(g, dtype=np.float64) / 255)
    lin = np.maximum(lin, 1e-4)
    if flatten:
        low = to_lin(np.asarray(wrap_blur(g, flatten), dtype=np.float64) / 255)
        lin = lin / np.maximum(low, 1e-4) * low.mean()
    m = np.exp(np.log(lin).mean())
    lin = np.exp(np.log(m) + contrast * (np.log(lin) - np.log(m)))
    k = 1.0
    for _ in range(30):  # solve for the gain that hits the target mean after the soft clip
        x = lin * k
        y = np.where(x < 0.9, x, 0.9 + 0.1 * (1 - np.exp(-(x - 0.9) / 0.1)))
        k *= target_lin / y.mean()
    out = (to_srgb(np.clip(y, 0, 1)) * 255).round().astype(np.uint8)
    return Image.fromarray(out, 'L').convert('RGB')

def orient(im, op, normal=False):
    if op == 'flipv':
        im = im.transpose(Image.FLIP_TOP_BOTTOM)
        if normal:
            r, g, b = im.split(); im = Image.merge('RGB', (r, g.point(lambda v: 255 - v), b))
    elif op == 'rot90':  # 90 deg counter-clockwise: tangent-space (x, y) -> (-y, x)
        im = im.transpose(Image.ROTATE_90)
        if normal:
            r, g, b = im.split(); im = Image.merge('RGB', (g.point(lambda v: 255 - v), r, b))
    elif isinstance(op, tuple) and op[0] == 'stagger':
        # Shift each board strip sideways by its own amount (wrapping, so it stays seamless):
        # staggers the butt joints instead of lining them up in one vertical seam.
        # cuts: rows (current pixels) of the board edges; same seed -> same shifts for every map.
        _, cuts, seed = op
        a = np.asarray(im); h, w = a.shape[:2]
        a = np.roll(a, -cuts[0], axis=0); rows = [c - cuts[0] for c in cuts] + [h]
        rng = np.random.default_rng(seed); out = a.copy()
        for r0, r1 in zip(rows, rows[1:]):
            out[r0:r1] = np.roll(a[r0:r1], int(rng.integers(w // 8, w - w // 8)), axis=1)
        im = Image.fromarray(np.roll(out, cuts[0], axis=0))
    elif op == 'stack2v':  # 2:1 source -> square without stretching (two copies stacked)
        w, h = im.size; out = Image.new(im.mode, (w, h * 2)); out.paste(im, (0, 0)); out.paste(im, (0, h)); im = out
    return im

def save(im, path, size, q):
    if im.size != (size, size): im = im.resize((size, size), Image.LANCZOS)
    im.save(path, 'JPEG', quality=q, optimize=True, progressive=False)

def load_maps(kind, d):
    s = os.path.join(src, kind, d)
    o = lambda f: Image.open(os.path.join(s, f))
    if kind == 'ph':
        return o('Diffuse.jpg').convert('RGB'), o('nor_gl.jpg').convert('RGB'), o('arm.jpg').convert('RGB')
    rough = o('Roughness.jpg').convert('L')
    ao = o('AmbientOcclusion.jpg').convert('L') if os.path.exists(os.path.join(s, 'AmbientOcclusion.jpg')) \
        else Image.new('L', rough.size, 255)
    if ao.size != rough.size: ao = ao.resize(rough.size, Image.LANCZOS)
    arm = Image.merge('RGB', (ao, rough, Image.new('L', rough.size, 0)))  # AO, roughness, metal 0
    return o('Color.jpg').convert('RGB'), o('NormalGL.jpg').convert('RGB'), arm

# WoodSiding009 is 1024x512 with 8 boards; board edges (steepest displacement drop) at these rows.
_SIDING_EDGES = [3, 66, 131, 195, 257, 319, 386, 452]
SIDING_STAGGER = ('stagger', _SIDING_EDGES + [r + 512 for r in _SIDING_EDGES], 7)

# name: (kind, source, albedo size, normal size, grey params or None (keep colour), orientation ops)
SETS = {
  'siding_wood':      ('acg', 'WoodSiding009',        1024, 1024, dict(target_lin=0.68),                ['stack2v', SIDING_STAGGER, 'flipv']),
  'brick':            ('ph',  'red_brick_03',         1024, 1024, None,                                 []),
  'roof_shingles':    ('ph',  'grey_roof_tiles_02',   1024, 1024, dict(target_lin=0.6),                 ['flipv']),
  'stone_foundation': ('ph',  'rustic_stone_wall_02', 1024, 1024, None,                                 []),
  'floor_wood':       ('acg', 'WoodFloor040',         1024, 1024, None,                                 []),
  'floor_tile':       ('acg', 'Tiles141',             1024, 1024, None,                                 []),
  'carpet':           ('acg', 'Carpet012',            512,  512,  dict(target_lin=0.6, flatten=48),     []),
  'wallpaper':        ('acg', 'Plaster001',           1024, 512,  dict(target_lin=0.75, contrast=0.6),  []),
  'painted_wood':     ('acg', 'PaintedWood008A',      512,  512,  dict(target_lin=0.75, contrast=0.45), []),
  'grass_lush':       ('acg', 'Grass004',             1024, 1024, dict(target_lin=0.7, flatten=40),     []),
  'door_wood':        ('acg', 'Wood066',              1024, 1024, None,                                 ['rot90']),
}
# Optional roughness remap (arm G, min..max -> lo..hi): the scanned maps of these read too glossy.
ROUGH = {'grass_lush': (0.75, 1.0), 'brick': (0.7, 0.95)}

def remap_rough(arm, lo, hi):
    a = np.asarray(arm).copy(); g = a[..., 1].astype(np.float64)
    a[..., 1] = np.clip((lo + (g - g.min()) / max(1, g.max() - g.min()) * (hi - lo)) * 255, 0, 255).round()
    return Image.fromarray(a)

only = set(sys.argv[3:])
for name, (kind, d, asize, nsize, grey, ops) in SETS.items():
    if only and name not in only: continue
    out = os.path.join(dst, name); os.makedirs(out, exist_ok=True)
    alb, nor, arm = load_maps(kind, d)
    for op in ops:
        alb, nor, arm = orient(alb, op), orient(nor, op, normal=True), orient(arm, op)
    if grey: alb = grey_detail(alb, **grey)
    if name in ROUGH: arm = remap_rough(arm, *ROUGH[name])
    save(alb, os.path.join(out, 'albedo.jpg'), asize, 85)
    save(nor, os.path.join(out, 'normal.jpg'), nsize, 88)
    save(arm, os.path.join(out, 'arm.jpg'), 512, 85)
    sz = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f'{name:18s} {kind}:{d:22s} {sz // 1024} KB')
