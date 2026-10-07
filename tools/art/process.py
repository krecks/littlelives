# Converts downloaded texture maps into the game's albedo/normal/arm JPGs.
# usage: python3 -I process.py <src_root> <dst_root>
import sys, os
from PIL import Image, ImageOps, ImageStat
src, dst = sys.argv[1], sys.argv[2]

def lin(c): c /= 255; return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def srgb(c): return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

def save(im, path, size, q):
    im = im.resize((size, size), Image.LANCZOS)
    im.save(path, 'JPEG', quality=q, optimize=True, progressive=False)

def grey_detail(im, target_lin=0.8):
    """Luminance-only detail map whose linear mean is ~target, so a vertex/albedo colour sets the hue."""
    g = ImageOps.grayscale(im)
    mean_lin = sum(lin(v) * n for v, n in enumerate(g.histogram())) / (g.width * g.height)
    k = target_lin / mean_lin
    lut = [max(0, min(255, round(srgb(min(1.0, lin(v) * k)) * 255))) for v in range(256)]
    return g.point(lut).convert('RGB')

# name: (source dir, diffuse, normal, arm, albedoSize, normalSize, greyscale)
SETS = {
  'floor_laminate': ('ph/laminate_floor_02', 1024, 1024, False),
  'wall_plaster':   ('ph/painted_plaster_wall', 1024, 512, True),
  'foliage':        ('ph/forest_leaves_03', 512, 512, True),
  'road_asphalt':   ('ph/asphalt_02', 1024, 1024, False),
  'path_hexpaving': ('ph/hexagonal_concrete_paving', 1024, 1024, False),
  'fabric_linen':   ('ph/rough_linen', 512, 512, True),
  'wood_oak':       ('ph/oak_veneer_01', 512, 512, True),
  'bark':           ('ph/bark_brown_02', 512, 512, False),
}
for name, (d, asize, nsize, grey) in SETS.items():
    out = os.path.join(dst, name); os.makedirs(out, exist_ok=True)
    s = os.path.join(src, d)
    diff = Image.open(os.path.join(s, 'Diffuse.jpg')).convert('RGB')
    save(grey_detail(diff) if grey else diff, os.path.join(out, 'albedo.jpg'), asize, 85)
    save(Image.open(os.path.join(s, 'nor_gl.jpg')).convert('RGB'), os.path.join(out, 'normal.jpg'), nsize, 88)
    save(Image.open(os.path.join(s, 'arm.jpg')).convert('RGB'), os.path.join(out, 'arm.jpg'), 512, 85)

# ambientCG grass: greyscale detail + packed AO/roughness.
g = os.path.join(src, 'acg/Grass001')
out = os.path.join(dst, 'grass'); os.makedirs(out, exist_ok=True)
save(grey_detail(Image.open(os.path.join(g, 'Color.jpg')).convert('RGB'), 0.75), os.path.join(out, 'albedo.jpg'), 1024, 85)
save(Image.open(os.path.join(g, 'NormalGL.jpg')).convert('RGB'), os.path.join(out, 'normal.jpg'), 1024, 88)
ao = ImageOps.grayscale(Image.open(os.path.join(g, 'AmbientOcclusion.jpg'))).resize((512, 512))
ro = ImageOps.grayscale(Image.open(os.path.join(g, 'Roughness.jpg'))).resize((512, 512))
Image.merge('RGB', (ao, ro, Image.new('L', (512, 512), 0))).save(os.path.join(out, 'arm.jpg'), 'JPEG', quality=85)
for root, _, files in os.walk(dst):
    for f in files: print(os.path.join(root, f).replace(dst, ''), os.path.getsize(os.path.join(root, f)))
