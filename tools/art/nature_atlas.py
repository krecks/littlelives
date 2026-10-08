# Builds the foliage atlas (leaf-cluster cards, blossoms, grass, fruit) and the bark atlas used by
# the procedural nature models (see nature_models.py). Needs Pillow, numpy and scipy.
#
# usage: python3 -I nature_atlas.py <leafsets_dir> <bark_albedo.jpg> <out_dir>
#   <leafsets_dir> holds the unzipped ambientCG 1K-JPG downloads LeafSet024/, LeafSet004/,
#   LeafSet019/ and LeafSet002/ (CC0, https://ambientcg.com/list?type=Atlas).
#
# Atlas layout (leaves.webp, 1024 x 1024, straight alpha, colour bled into the transparent parts so
# mipmaps don't get dark fringes):
#   A (0,0)-(512,512)       broadleaf twig cluster (LeafSet024)       deciduous trees, fruit trees
#   B (512,0)-(1024,512)    small-leaf sprig cluster (LeafSet002)     bushes, hedges
#   C (0,512)-(512,1024)    conifer fronds (LeafSet019)               pines / firs
#   D (512,512)-(1024,768)  white blossom cluster (procedural)        tinted per card: blossoms, flowering bushes
#   E (512,768)-(768,1024)  grass tuft (procedural)                   lawn tufts
#   F (768,768)-(1024,896)  birch leaf cluster (LeafSet004, small)    birches
#   G (768,896)-(896,1024)  apples (procedural)                       fruit trees
#   H (896,896)-(1024,1024) wildflower heads (procedural, white)      lawn flowers (tinted)
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SS = 2  # supersampling factor for compositing


def load_sprites(folder, set_id, rotate=0):
    col = Image.open(os.path.join(folder, f'LeafSet{set_id}', f'LeafSet{set_id}_1K-JPG_Color.jpg')).convert('RGB')
    op = Image.open(os.path.join(folder, f'LeafSet{set_id}', f'LeafSet{set_id}_1K-JPG_Opacity.jpg')).convert('L')
    a = np.array(op)
    lab, k = ndimage.label(a > 100)
    sprites = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None:
            continue
        ys, xs = sl
        if (ys.stop - ys.start) * (xs.stop - xs.start) < 4000:
            continue
        box = (max(0, xs.start - 3), max(0, ys.start - 3), min(1024, xs.stop + 3), min(1024, ys.stop + 3))
        mask = (lab[box[1]:box[3], box[0]:box[2]] == i + 1)
        mask = ndimage.binary_dilation(mask, iterations=2)
        alpha = (np.array(op.crop(box)).astype(np.float32) * mask).clip(0, 255).astype(np.uint8)
        rgba = col.crop(box).convert('RGBA')
        rgba.putalpha(Image.fromarray(alpha))
        if rotate:
            rgba = rgba.rotate(rotate, expand=True, resample=Image.BICUBIC)
        sprites.append(rgba)
    return sprites


def normalise(sprites, target):
    """Scale colours so the sprites' mean opaque colour is `target` (sRGB 0..255)."""
    acc = np.zeros(3)
    n = 0
    for s in sprites:
        arr = np.array(s).astype(np.float32)
        m = arr[..., 3] > 128
        acc += arr[m][:, :3].sum(0)
        n += m.sum()
    mean = acc / max(1, n)
    gain = np.array(target, np.float32) / mean
    out = []
    for s in sprites:
        arr = np.array(s).astype(np.float32)
        arr[..., :3] = (arr[..., :3] * gain).clip(0, 255)
        out.append(Image.fromarray(arr.astype(np.uint8), 'RGBA'))
    return out


def shade(sprite, k, warm=0.0):
    arr = np.array(sprite).astype(np.float32)
    arr[..., :3] *= k
    arr[..., 0] *= 1 + warm
    arr[..., 2] *= 1 - warm
    arr[..., :3] = arr[..., :3].clip(0, 255)
    return Image.fromarray(arr.astype(np.uint8), 'RGBA')


def paste_rot(canvas, sprite, base, angle_deg, length):
    """Pastes `sprite` (stem at its bottom centre, tip up) with the stem at `base`, pointing `angle_deg`
    (0 = up, positive = clockwise), scaled so its height is `length` pixels."""
    s = length / sprite.height
    sp = sprite.resize((max(1, int(sprite.width * s)), max(1, int(sprite.height * s))), Image.LANCZOS)
    # Pad so the stem (bottom centre) is the centre, then rotate about it.
    w, h = sp.size
    pad = Image.new('RGBA', (w, h * 2), (0, 0, 0, 0))
    pad.paste(sp, (0, 0))
    rot = pad.rotate(-angle_deg, expand=True, resample=Image.BICUBIC)
    cx, cy = rot.width / 2, rot.height / 2
    canvas.alpha_composite(rot, (int(base[0] - cx), int(base[1] - cy)))


def draw_twig(draw, pts, width, colour):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        draw.line([(x0, y0), (x1, y1)], fill=colour, width=max(1, int(width)))


def cluster(sprites, size, rng, count, length, spread, twig=(92, 70, 48, 255), twigs=5, droop=0.0):
    """A twig spray: a main stem from the bottom centre with side twigs, leaves alternating along them."""
    W = H = size * SS
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    origin = (W / 2, H * 0.98)
    top = (W / 2 + rng.uniform(-0.05, 0.05) * W, H * 0.3)
    stems = [[origin, top]]
    for i in range(twigs):
        t = 0.12 + 0.72 * i / max(1, twigs - 1)
        p = (origin[0] + (top[0] - origin[0]) * t, origin[1] + (top[1] - origin[1]) * t)
        side = -1 if i % 2 else 1
        ang = math.radians(side * rng.uniform(30, 60) + droop * side)
        L = spread * W * (1.0 - 0.45 * t) * rng.uniform(0.8, 1.1)
        stems.append([p, (p[0] + math.sin(ang) * L, p[1] - math.cos(ang) * L)])
    for s in stems:
        draw_twig(draw, s, 3 * SS, twig)
    leaves = []
    for n in range(count):
        st = stems[n % len(stems)]
        t = rng.uniform(0.15, 1.0) if n >= len(stems) else 1.0
        (x0, y0), (x1, y1) = st
        p = (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
        base = math.degrees(math.atan2(x1 - x0, -(y1 - y0)))
        ang = base + (0 if t >= 0.99 else (1 if n % 2 else -1) * rng.uniform(25, 70)) + rng.uniform(-12, 12)
        L = length * SS * rng.uniform(0.75, 1.15) * (1.0 - 0.25 * (1 - t))
        leaves.append((rng.random(), p, ang, L))
    # Back to front: leaves drawn first are darker (inside the cluster).
    leaves.sort(key=lambda l: l[0])
    for i, (_, p, ang, L) in enumerate(leaves):
        k = 0.62 + 0.5 * (i / max(1, len(leaves) - 1)) + rng.uniform(-0.06, 0.06)
        paste_rot(canvas, shade(rng.choice(sprites), k, rng.uniform(-0.05, 0.08)), p, ang, L)
    return fit(canvas, size)


def fit(canvas, size, margin=4):
    """Crops to the content and scales it into a size x size cell (bottom-centre anchored)."""
    bbox = canvas.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        return canvas.resize((size, size))
    x0, y0, x1, y1 = bbox
    w, h = x1 - x0, y1 - y0
    s = (size - 2 * margin) / max(w, h)
    crop = canvas.crop(bbox).convert('RGBa').resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS).convert('RGBA')
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.alpha_composite(crop, ((size - crop.width) // 2, size - margin - crop.height))
    return out


def fronds(sprites, size, rng):
    """Conifer: a fan of needle fronds from the bottom centre."""
    W = H = size * SS
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    origin = (W / 2, H * 0.99)
    items = []
    for i in range(9):
        ang = -50 + 100 * i / 8 + rng.uniform(-6, 6)
        L = H * rng.uniform(0.62, 0.9) * (1 - abs(ang) / 160)
        items.append((abs(ang) * -1 + rng.uniform(-20, 20), ang, L))
    items.sort(key=lambda t: t[0])
    for i, (_, ang, L) in enumerate(items):
        k = 0.7 + 0.45 * i / 8
        paste_rot(canvas, shade(rng.choice(sprites), k, rng.uniform(-0.03, 0.05)), origin, ang, L)
    return fit(canvas, size)


def blossoms(w, h, rng, count=26, radius=(26, 40), petals=5, centre=(250, 196, 70)):
    """White five-petal blossoms (tinted per card in the models)."""
    W, H = w * SS, h * SS
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    # A few twigs and leaves behind the flowers.
    for _ in range(5):
        x0, y0 = rng.uniform(0.2, 0.8) * W, H * 0.98
        x1, y1 = rng.uniform(0.05, 0.95) * W, rng.uniform(0.15, 0.5) * H
        d.line([(x0, y0), (x1, y1)], fill=(96, 72, 56, 255), width=3 * SS)
    flowers = sorted(((rng.random(), rng.gauss(0.5, 0.2) * W, rng.uniform(0.22, 0.85) * H) for _ in range(count)), key=lambda f: f[0])
    for i, (_, cx, cy) in enumerate(flowers):
        cx = min(W - 60, max(60, cx))
        r = rng.uniform(*radius) * SS
        rot = rng.uniform(0, 2 * math.pi)
        depth = 0.78 + 0.22 * i / max(1, count - 1)
        for p in range(petals):
            a = rot + p * 2 * math.pi / petals
            px, py = cx + math.cos(a) * r * 0.55, cy + math.sin(a) * r * 0.55
            pts = []
            for k in range(20):
                t = k / 20 * 2 * math.pi
                ex, ey = math.cos(t) * r * 0.55, math.sin(t) * r * 0.38
                pts.append((px + ex * math.cos(a) - ey * math.sin(a), py + ex * math.sin(a) + ey * math.cos(a)))
            v = int(255 * depth * rng.uniform(0.92, 1.0))
            d.polygon(pts, fill=(int(v * 0.86), int(v * 0.8), int(v * 0.84), 255), outline=(int(v * 0.72), int(v * 0.66), int(v * 0.7), 255))
            # Lighter outer half of the petal (soft, painterly volume).
            inner = [(px + (x - px) * 0.72 + math.cos(a) * r * 0.1, py + (y - py) * 0.72 + math.sin(a) * r * 0.1) for x, y in pts]
            d.polygon(inner, fill=(v, int(v * 0.98), int(v * 0.97), 255))
        cr = r * 0.22
        d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=tuple(int(c * depth) for c in centre) + (255,))
        for _ in range(6):
            a = rng.uniform(0, 2 * math.pi)
            sx, sy = cx + math.cos(a) * cr * 1.2, cy + math.sin(a) * cr * 1.2
            d.ellipse([sx - SS * 2, sy - SS * 2, sx + SS * 2, sy + SS * 2], fill=(200, 140, 40, 255))
    canvas = canvas.filter(ImageFilter.GaussianBlur(0.6 * SS))
    return canvas.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')


def grass(size, rng, blades=46):
    W = H = size * SS
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    items = sorted(((rng.random(), rng.gauss(0.5, 0.13) * W) for _ in range(blades)), key=lambda b: b[0])
    for i, (_, bx) in enumerate(items):
        height = H * rng.uniform(0.55, 0.97)
        lean = rng.uniform(-0.35, 0.35) * height
        width = rng.uniform(5, 9) * SS
        pts_l, pts_r = [], []
        for k in range(13):
            t = k / 12
            x = bx + lean * t * t
            y = H - height * t
            w = width * (1 - t) ** 0.9
            pts_l.append((x - w / 2, y))
            pts_r.append((x + w / 2, y))
        k = 0.7 + 0.35 * i / blades
        base = np.array([88, 118, 46]) * k
        tip = np.array([150, 176, 82]) * k
        # Two-tone blade (dark base, light tip) drawn as bands.
        for s in range(12):
            c = base + (tip - base) * (s / 11)
            poly = [pts_l[s], pts_l[s + 1], pts_r[s + 1], pts_r[s]]
            d.polygon(poly, fill=tuple(int(v) for v in c) + (255,))
    return canvas.convert('RGBa').resize((size, size), Image.LANCZOS).convert('RGBA')


def apples(w, h, rng, leaf):
    W, H = w * SS, h * SS
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    d.line([(W * 0.5, 0), (W * 0.5, H * 0.3)], fill=(90, 66, 44, 255), width=4 * SS)
    paste_rot(canvas, shade(leaf, 0.9), (W * 0.5, H * 0.25), -55, H * 0.38)
    paste_rot(canvas, shade(leaf, 1.0), (W * 0.5, H * 0.25), 60, H * 0.36)
    for (cx, cy, r) in [(0.3, 0.62, 0.22), (0.7, 0.6, 0.21), (0.5, 0.78, 0.2)]:
        cx, cy, r = cx * W, cy * H, r * W
        d.line([(W * 0.5, H * 0.28), (cx, cy - r)], fill=(90, 66, 44, 255), width=2 * SS)
        yy, xx = np.mgrid[0:H, 0:W]
        dist = np.hypot(xx - cx, yy - cy) / r
        m = dist <= 1
        hl = np.clip(1 - np.hypot(xx - (cx - r * 0.35), yy - (cy - r * 0.35)) / (r * 0.9), 0, 1)
        shadev = np.clip(1.05 - dist * 0.35 - np.clip((yy - cy) / r, 0, 1) * 0.35, 0, 1)
        arr = np.array(canvas).astype(np.float32)
        col = np.stack([200 * shadev + 55 * hl, 38 * shadev + 90 * hl ** 2, 30 * shadev + 50 * hl ** 2], -1)
        arr[m, :3] = col[m]
        arr[m, 3] = 255
        canvas = Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGBA')
        d = ImageDraw.Draw(canvas)
    return canvas.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')


def wildflowers(size, rng):
    """Four small daisy-like heads (white petals, yellow centres), tinted per card."""
    return blossoms(size, size, rng, count=7, radius=(30, 40), petals=8, centre=(240, 190, 60))


def bleed(img):
    """Fills transparent pixels with nearby opaque colours (keeps alpha) so filtering doesn't darken edges."""
    arr = np.array(img).astype(np.float32)
    a = arr[..., 3:4] / 255.0
    rgb = arr[..., :3] * a
    acc_rgb, acc_a = rgb.copy(), a.copy()
    filled = arr[..., :3].copy()
    known = a[..., 0] > 0.5
    for sigma in (2, 4, 8, 16, 32, 64):
        br = ndimage.gaussian_filter(rgb, (sigma, sigma, 0))
        ba = ndimage.gaussian_filter(a, (sigma, sigma, 0))
        est = br / np.maximum(ba, 1e-4)
        take = (~known) & (ba[..., 0] > 1e-3)
        filled[take] = est[take]
        known = known | take
    arr[..., :3] = np.where(a > 0.5, arr[..., :3], filled)
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGBA')


def birch_bark(w, h, rng):
    """Procedural white birch bark with dark lenticels and patches (tiles vertically)."""
    yy, xx = np.mgrid[0:h, 0:w]
    base = np.full((h, w, 3), (226, 222, 210), np.float32)
    noise = ndimage.gaussian_filter(np.random.RandomState(3).rand(h, w), (1.5, 6), mode='wrap')
    noise = (noise - noise.mean()) / noise.std()
    base *= (1 + 0.05 * noise)[..., None]
    img = Image.fromarray(base.clip(0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for _ in range(90):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        lw, lh = rng.uniform(6, 34), rng.uniform(1.5, 4)
        c = int(rng.uniform(40, 80))
        for dy in (0, -h, h):
            d.ellipse([x - lw / 2, y + dy - lh / 2, x + lw / 2, y + dy + lh / 2], fill=(c, c - 4, c - 8))
    for _ in range(14):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        pw, ph = rng.uniform(10, 40), rng.uniform(8, 30)
        c = int(rng.uniform(60, 100))
        for dy in (0, -h, h):
            d.ellipse([x - pw / 2, y + dy - ph / 2, x + pw / 2, y + dy + ph / 2], fill=(c, c - 6, c - 12))
    return img.filter(ImageFilter.GaussianBlur(0.7))


def main():
    leafdir, bark_path, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    rng = random.Random(7)
    broad = normalise(load_sprites(leafdir, '024'), (128, 166, 66))
    small = normalise(load_sprites(leafdir, '002'), (112, 150, 64))
    birch = normalise(load_sprites(leafdir, '004'), (146, 178, 74))
    conifer = normalise(load_sprites(leafdir, '019', rotate=-90), (74, 112, 64))

    atlas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    atlas.alpha_composite(cluster(broad, 512, rng, count=52, length=112, spread=0.44, twigs=7), (0, 0))
    atlas.alpha_composite(cluster(small, 512, rng, count=40, length=150, spread=0.38, twigs=6), (512, 0))
    atlas.alpha_composite(fronds(conifer, 512, rng), (0, 512))
    atlas.alpha_composite(blossoms(512, 256, rng), (512, 512))
    atlas.alpha_composite(grass(256, rng), (512, 768))
    atlas.alpha_composite(cluster(birch, 256, rng, count=48, length=50, spread=0.4, twigs=7, droop=25), (768, 768))
    # The birch cell is 256 wide but only 128 tall: squeeze the 256 cluster into it.
    cell = atlas.crop((768, 768, 1024, 1024)).resize((256, 128), Image.LANCZOS)
    atlas.paste((0, 0, 0, 0), (768, 768, 1024, 1024))
    atlas.alpha_composite(cell, (768, 768))
    atlas.alpha_composite(apples(128, 128, rng, broad[0]), (768, 896))
    atlas.alpha_composite(wildflowers(128, rng), (896, 896))
    # Slightly stronger alpha keeps clusters full in the smaller mip levels.
    arr = np.array(atlas).astype(np.float32)
    arr[..., 3] = (arr[..., 3] * 1.12).clip(0, 255)
    atlas = bleed(Image.fromarray(arr.astype(np.uint8), 'RGBA'))
    atlas.save(os.path.join(out, 'leaves.webp'), quality=88, method=6)
    atlas.save(os.path.join(out, '_preview_leaves.png'))

    bark = Image.new('RGB', (512, 512))
    brown = Image.open(bark_path).convert('RGB').resize((256, 512), Image.LANCZOS)
    bark.paste(brown, (0, 0))
    bark.paste(birch_bark(256, 512, rng), (256, 0))
    bark.save(os.path.join(out, 'bark.webp'), quality=85, method=6)


if __name__ == '__main__':
    main()
