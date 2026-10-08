# Romantic pack models (`model.romantic.*`): candlelit bistro table, heart-shaped petal tub,
# love-letter bureau, rose-gold vanity, brass-horn gramophone, rose-arbour swing. Primitive parts in
# blush, rose, cream and gold. Conventions as furniture.py: 1 unit = 1 m, origin at the footprint
# centre on the floor, front +Z, back against the wall at -Z; seats centred on z = 0 with tops at
# ~0.45 m (characters.ts DEFAULT_SEAT); multi-slot seats at x = +-0.5.
# Run: python3 -I pack_romantic.py [out.json]  then  python3 -I apply_pack.py romantic out.json
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, gltf, placeholder,  # noqa: E402
                       validate_parts, CHROME, BRASS, OAK, WHITE, CREAM, HONEY)

TRAIT = 'romantic'
FOOT = {o['model']: tuple(o['footprint']) for o in
        json.load(open(os.path.join(HERE, '..', '..', 'web', 'public', 'content', 'packs', TRAIT + '.json')))['objects']}
E = {}

BLUSH, BLUSHD, ROSE, ROSED, IVORY, GOLD, ROSEGOLD, LEAF = '#E8B4B8', '#D99AA0', '#C8475A', '#9E2F44', '#F4EDE4', BRASS, '#D4A28C', '#5E8F4E'


def candle(x, z, y, h=0.22, col='#FBF6EC', holder=GOLD):
    return [lathe([0.07, 0.06, 0.07], [x, y + 0.03, z], holder, 'metal',
                  profile=[[0, -0.5], [0.5, -0.5], [0.5, -0.3], [0.2, -0.1], [0.2, 0.3], [0.4, 0.5], [0, 0.5]]),
            cyl([0.028, h, 0.028], [x, y + 0.06 + h / 2, z], col, 'satin'),
            sph([0.02, 0.04, 0.02], [x, y + 0.08 + h, z], '#FFD27A', 'gloss', segments=8)]


def wine_glass(x, z, y, wine=None):
    p = [lathe([0.07, 0.17, 0.07], [x, y + 0.085, z], '#EEF4F4', 'glass',
               profile=[[0, -0.5], [0.45, -0.5], [0.45, -0.47], [0.06, -0.42], [0.05, 0.0], [0.42, 0.12], [0.5, 0.5]])]
    if wine: p.append(sph([0.06, 0.035, 0.06], [x, y + 0.115, z], wine, 'gloss', segments=10))
    return p


def rose(x, y, z, c=ROSE, s=0.05):
    return [sph([s, s * 0.85, s], [x, y, z], c, 'satin', segments=8)]


def velvet_chair(x, z=0.0, fabric=BLUSH, frame=GOLD):
    p = [cushion([0.44, 0.1, 0.42], [x, 0.4, z], fabric, radius=0.045),
         cushion([0.42, 0.46, 0.09], [x, 0.7, z - 0.21], fabric, rotate=[-8, 0, 0], radius=0.04)]
    for dx in (-0.18, 0.18):
        p += [cyl([0.03, 0.36, 0.03], [x + dx, 0.18, z + 0.16], frame, 'metal', taper=0.6),
              cyl([0.03, 0.36, 0.03], [x + dx, 0.18, z - 0.17], frame, 'metal', taper=0.6)]
    return p


# ---- Candlelit table for two (2x1): Sims side by side at x = +-0.5 facing the table ----------
ct = [box([1.62, 0.03, 0.3], [0, 0.745, 0.29], OAK, 'wood', radius=0.008),
      box([1.68, 0.012, 0.32], [0, 0.766, 0.29], IVORY, 'fabric', radius=0.004),           # tablecloth
      box([1.68, 0.2, 0.012], [0, 0.67, 0.449], IVORY, 'fabric', radius=0.004),           # front drop
      box([0.012, 0.2, 0.32], [-0.84, 0.67, 0.29], IVORY, 'fabric', radius=0.004),
      box([0.012, 0.2, 0.32], [0.84, 0.67, 0.29], IVORY, 'fabric', radius=0.004),
      box([1.7, 0.004, 0.12], [0, 0.774, 0.3], ROSED, 'fabric', radius=0.002)]           # runner
for x in (-0.78, 0.78):
    ct.append(cyl([0.04, 0.73, 0.04], [x, 0.365, 0.2], GOLD, 'metal', taper=0.7))
for s in (-1, 1):
    x = s * 0.5
    ct += [cyl([0.26, 0.015, 0.26], [x, 0.782, 0.26], '#FBFAF7', 'gloss'),
           torus([0.25, 0.01, 0.25], [x, 0.79, 0.26], GOLD, 'metal'),
           part('blob', [0.1, 0.05, 0.08], [x, 0.81, 0.26], '#C77D4F', 'matte', noise=0.15),   # dessert
           box([0.012, 0.004, 0.17], [x - 0.16, 0.778, 0.26], GOLD, 'metal', radius=0.002),
           box([0.012, 0.004, 0.17], [x + 0.16, 0.778, 0.26], GOLD, 'metal', radius=0.002)]
    ct += wine_glass(x + s * 0.2, 0.38, 0.775, wine='#8E1F33')
    ct += velvet_chair(x, 0.0)
ct += candle(-0.12, 0.33, 0.775, 0.26) + candle(0.12, 0.33, 0.775, 0.22)
ct += [lathe([0.06, 0.18, 0.06], [0, 0.865, 0.37], '#EEF4F4', 'glass',
             profile=[[0, -0.5], [0.5, -0.5], [0.5, -0.2], [0.2, 0.3], [0.25, 0.5], [0, 0.5]]),   # bud vase
       rod([0, 0.86, 0.37], [0.01, 1.07, 0.37], 0.008, LEAF, 'satin')] + rose(0.01, 1.09, 0.37, s=0.065)
for x, z in [(-0.3, 0.38), (0.25, 0.4), (-0.05, 0.22), (0.38, 0.33)]:
    ct.append(sph([0.03, 0.006, 0.025], [x, 0.777, z], ROSE, 'satin', segments=6))         # petals
E['model.romantic.candlelitTable'] = placeholder(ct)


# ---- Heart-shaped petal tub (2x2): two Sims sit in it at x = +-0.5 ---------------------------
def heart(k, y, h, color, finish, cz=0.15, a=1.03):
    """A heart (two lobes on a 45-degree square) pointing to +Z, scaled by k about the origin."""
    r, hd = a / 2, a / math.sqrt(2)
    sq = [box([a * k, h, a * k], [0, y, cz * k], color, finish, radius=min(0.03, h * 0.4), rotate=[0, 45, 0])]
    lobes = [cyl([2 * r * k, h, 2 * r * k], [s * hd / 2 * k, y, (cz - hd / 2) * k], color, finish, segments=32) for s in (-1, 1)]
    return sq + lobes


ht = heart(1.0, 0.04, 0.08, IVORY, 'gloss')                                                # plinth
ht += heart(0.96, 0.31, 0.46, BLUSH, 'gloss')                                              # body (rim 0.54)
ht += heart(0.86, 0.538, 0.012, '#C7E6EE', 'gloss')                                        # water
for i in range(22):
    a = i * 2.39996
    rr = 0.12 + 0.55 * math.sqrt((i + 0.5) / 22)
    x, z = rr * math.cos(a) * 0.95, -0.1 + rr * math.sin(a) * 0.75
    ht.append(sph([0.045, 0.008, 0.035], [round(x, 3), 0.546, round(z, 3)], ROSE if i % 3 else '#E07A8A', 'satin', segments=6, rotate=[0, i * 37 % 180, 0]))
for x, z in [(-0.18, -0.35), (0.25, -0.42), (0.05, 0.3)]:
    ht.append(sph([0.09, 0.05, 0.09], [x, 0.55, z], '#FBFAF7', 'gloss', segments=8))        # bubbles
ht += [lathe([0.12, 0.14, 0.12], [0.62, 0.61, 0.33], '#C9CCD0', 'chrome',
             profile=[[0, -0.5], [0.38, -0.5], [0.5, 0.5], [0.46, 0.5], [0.34, -0.4], [0, -0.4]])]  # ice bucket on rim
ht += [cyl([0.035, 0.16, 0.035], [0.62, 0.7, 0.33], '#2E5B3A', 'gloss', rotate=[0, 0, 15]),
       box([0.34, 0.08, 0.24], [-0.78, 0.04, 0.78], IVORY, 'fabric', radius=0.03),           # towels
       box([0.32, 0.07, 0.22], [-0.78, 0.115, 0.78], BLUSH, 'fabric', radius=0.03)]
for x, z, h in [(-0.85, -0.82, 0.3), (-0.72, -0.86, 0.2), (0.85, -0.82, 0.26), (0.73, -0.87, 0.18)]:
    ht += candle(x, z, 0.0, h, holder=ROSEGOLD)
for x, z in [(0.78, 0.82), (0.62, 0.86)]:
    ht += [rod([x, 0.0, z], [x, 0.4, z], 0.012, LEAF, 'satin')] + rose(x, 0.42, z, s=0.08)
ht.append(lathe([0.16, 0.3, 0.16], [0.7, 0.15, 0.82], IVORY, 'gloss',
                profile=[[0, -0.5], [0.4, -0.5], [0.5, 0.0], [0.3, 0.4], [0.32, 0.5], [0, 0.5]]))   # floor vase
E['model.romantic.heartTub'] = placeholder(ht)

# ---- Love-letter bureau (1x1): seated at z = 0, pigeonhole desk in front ---------------------
lb = [box([0.84, 0.03, 0.3], [0, 0.745, 0.3], IVORY, 'satin', radius=0.01),
      box([0.8, 0.1, 0.27], [0, 0.68, 0.31], IVORY, 'satin', radius=0.008),
      box([0.3, 0.06, 0.01], [0, 0.68, 0.175], '#EFE3D3', 'satin', radius=0.006),         # drawer front
      sph([0.025, 0.025, 0.02], [0, 0.68, 0.168], GOLD, 'metal', segments=8)]
for x in (-0.39, 0.39):
    for z in (0.18, 0.42):
        lb.append(cyl([0.035, 0.63, 0.035], [x, 0.315, z], IVORY, 'satin', taper=0.6, segments=10))
lb += [box([0.8, 0.38, 0.1], [0, 0.95, 0.4], IVORY, 'satin', radius=0.01),               # pigeonhole hutch
       box([0.84, 0.03, 0.1], [0, 1.155, 0.4], GOLD, 'metal', radius=0.006)]
for x in (-0.2, 0.0, 0.2):
    lb.append(box([0.015, 0.34, 0.09], [x, 0.95, 0.35], '#EFE3D3', 'satin', radius=0.004))
lb.append(box([0.78, 0.015, 0.09], [0, 0.95, 0.35], '#EFE3D3', 'satin', radius=0.004))
for x, y, c in [(-0.3, 0.8, '#F8F2E8'), (-0.1, 1.0, BLUSH), (0.1, 0.8, '#F8F2E8'), (0.3, 1.0, '#F2D7C6'), (-0.3, 1.0, '#F8F2E8')]:
    lb.append(box([0.14, 0.09, 0.06], [x, y + 0.01, 0.345], c, 'matte', radius=0.004))   # letters in cubbies
lb += [box([0.22, 0.003, 0.28], [-0.05, 0.762, 0.27], '#FBF7EE', 'matte', radius=0.002, rotate=[0, 8, 0]),  # open letter
       part('capsule', [0.03, 0.26, 0.012], [0.2, 0.82, 0.28], '#FBFBF8', 'satin', rotate=[0, -20, -55]),  # quill
       lathe([0.06, 0.06, 0.06], [0.3, 0.79, 0.34], '#2E3C6E', 'gloss',
             profile=[[0, -0.5], [0.5, -0.5], [0.5, 0.1], [0.2, 0.3], [0.2, 0.5], [0, 0.5]]),   # inkpot
       cyl([0.05, 0.012, 0.05], [0.18, 0.766, 0.36], ROSED, 'gloss'),                      # wax seal
       box([0.012, 0.012, 0.1], [0.28, 0.766, 0.22], ROSED, 'satin', rotate=[0, 30, 0]),
       box([0.16, 0.05, 0.11], [-0.3, 0.785, 0.34], '#F2D7C6', 'matte', radius=0.004),     # envelopes
       box([0.165, 0.052, 0.02], [-0.3, 0.786, 0.34], ROSE, 'satin', radius=0.003)]
lb += candle(-0.33, 0.22, 0.76, 0.16)
lb += velvet_chair(0.0, 0.0, BLUSH, IVORY)
E['model.romantic.letterBureau'] = placeholder(lb)

# ---- Rose-gold vanity (1x1) --------------------------------------------------------------------
va = [box([0.8, 0.06, 0.36], [0, 0.73, -0.27], IVORY, 'satin', radius=0.015),
      box([0.76, 0.14, 0.33], [0, 0.63, -0.27], IVORY, 'satin', radius=0.01),
      box([0.34, 0.1, 0.01], [0, 0.63, -0.1], '#EFE3D3', 'satin', radius=0.008),
      sph([0.03, 0.03, 0.02], [0, 0.63, -0.093], ROSEGOLD, 'metal', segments=8)]
for x in (-0.36, 0.36):
    for z in (-0.42, -0.12):
        va.append(cyl([0.035, 0.57, 0.035], [x, 0.285, z], ROSEGOLD, 'metal', taper=0.5, segments=10))
va += [cyl([0.5, 0.02, 0.72], [0, 1.24, -0.42], '#DCE6EA', 'gloss', rotate=[90, 0, 0], segments=32),   # oval mirror
       torus([0.54, 0.04, 0.76], [0, 1.24, -0.425], ROSEGOLD, 'metal', rotate=[90, 0, 0], segments=32),
       box([0.04, 0.12, 0.04], [0, 0.82, -0.43], ROSEGOLD, 'metal', radius=0.01)]
for i, (x, h, c) in enumerate([(-0.3, 0.12, '#F2B8C6'), (-0.22, 0.09, '#F2C77F'), (-0.15, 0.14, '#E8C9F0')]):
    va += [lathe([0.06, h, 0.06], [x, 0.76 + h / 2, -0.24], c, 'glass',
                 profile=[[0, -0.5], [0.5, -0.5], [0.5, 0.2], [0.2, 0.35], [0.2, 0.5], [0, 0.5]]),
           sph([0.04, 0.04, 0.04], [x, 0.78 + h, -0.24], ROSEGOLD, 'metal', segments=8)]
va += [box([0.16, 0.08, 0.12], [0.25, 0.8, -0.24], BLUSHD, 'satin', radius=0.02),         # jewellery box
       box([0.17, 0.012, 0.13], [0.25, 0.846, -0.24], ROSEGOLD, 'metal', radius=0.006),
       lathe([0.08, 0.14, 0.08], [0.1, 0.83, -0.36], IVORY, 'gloss',
             profile=[[0, -0.5], [0.4, -0.5], [0.5, 0.1], [0.3, 0.4], [0.35, 0.5], [0, 0.5]]),
       part('blob', [0.12, 0.1, 0.1], [0.1, 0.95, -0.36], LEAF, 'foliage', noise=0.15)]
va += rose(0.07, 0.97, -0.34) + rose(0.13, 0.98, -0.37, '#E07A8A') + rose(0.1, 1.0, -0.33, IVORY)
va += [cyl([0.42, 0.34, 0.42], [0, 0.2, 0.17], BLUSH, 'fabric', segments=28),               # pouf
       cyl([0.44, 0.08, 0.44], [0, 0.4, 0.17], BLUSH, 'fabric', taper=0.92, segments=28),
       torus([0.42, 0.03, 0.42], [0, 0.03, 0.17], ROSEGOLD, 'metal')]
for a in range(0, 360, 60):
    va.append(sph([0.025, 0.02, 0.025], [0.12 * math.cos(math.radians(a)), 0.445, 0.17 + 0.12 * math.sin(math.radians(a))], BLUSHD, 'fabric', segments=6))
E['model.romantic.vanity'] = placeholder(va)

# ---- Brass-horn gramophone on a record cabinet (1x1) -----------------------------------------
gr = [box([0.62, 0.68, 0.42], [0, 0.38, -0.2], HONEY, 'wood', radius=0.015),
      box([0.66, 0.03, 0.46], [0, 0.735, -0.2], '#8A5E3C', 'wood', radius=0.01),
      box([0.28, 0.5, 0.012], [-0.15, 0.4, 0.016], '#B5835A', 'wood', radius=0.01),
      box([0.28, 0.5, 0.012], [0.15, 0.4, 0.016], '#B5835A', 'wood', radius=0.01),
      sph([0.025, 0.025, 0.02], [-0.03, 0.42, 0.026], GOLD, 'metal', segments=8),
      sph([0.025, 0.025, 0.02], [0.03, 0.42, 0.026], GOLD, 'metal', segments=8)]
for x in (-0.27, 0.27):
    for z in (-0.38, -0.02):
        gr.append(cyl([0.04, 0.05, 0.04], [x, 0.025, z], GOLD, 'metal'))
gr += [box([0.38, 0.13, 0.36], [0, 0.815, -0.18], '#8A5E3C', 'wood', radius=0.012),         # gramophone base
       cyl([0.3, 0.012, 0.3], [0.02, 0.886, -0.16], '#3A2E2A', 'gloss', segments=28),          # record
       cyl([0.1, 0.014, 0.1], [0.02, 0.888, -0.16], ROSE, 'satin'),
       rod([0.15, 0.9, -0.3], [0.08, 0.92, -0.08], 0.014, GOLD, 'metal'),                     # tone arm
       cyl([0.06, 0.12, 0.06], [0.15, 0.94, -0.3], GOLD, 'metal'),
       rod([0.15, 1.0, -0.3], [0.03, 1.08, -0.3], 0.03, GOLD, 'metal'),                      # horn neck
       lathe([0.46, 0.44, 0.46], [0.0, 1.27, -0.14], GOLD, 'metal', rotate=[34, 0, 0],
             profile=[[0, -0.5], [0.05, -0.5], [0.07, -0.2], [0.13, 0.1], [0.26, 0.33], [0.5, 0.5],
                      [0.47, 0.5], [0.24, 0.35], [0.11, 0.12], [0.04, -0.15], [0, -0.3]]),
       box([0.3, 0.3, 0.012], [0.22, 0.15, 0.2], ROSE, 'matte', radius=0.004, rotate=[-12, 20, 0]),   # record sleeves
       box([0.3, 0.3, 0.012], [0.2, 0.15, 0.22], '#3E6F9E', 'matte', radius=0.004, rotate=[-18, 14, 0])]
gr += rose(-0.22, 0.765, -0.06, s=0.07) + [rod([-0.22, 0.75, -0.06], [-0.1, 0.752, -0.0], 0.008, LEAF, 'satin')]
E['model.romantic.gramophone'] = placeholder(gr)

# ---- Rose-arbour swing (2x1): porch swing for two under an arch of climbing roses ------------
PAINT = '#F2EFE8'
ra = []
for x in (-0.88, 0.88):
    for z in (-0.36, 0.36):
        ra.append(box([0.07, 2.12, 0.07], [x, 1.06, z], PAINT, 'satin', radius=0.012))   # posts
    for i in range(5):                                                                     # lattice
        y0 = 0.2 + i * 0.36
        ra.append(rod([x, y0, -0.33], [x, y0 + 0.36, 0.33], 0.02, PAINT, 'satin', shape='box', t2=0.02))
        ra.append(rod([x, y0, 0.33], [x, y0 + 0.36, -0.33], 0.02, PAINT, 'satin', shape='box', t2=0.02))
arc = [(-0.88 + 1.76 * t / 8, 2.12 + 0.3 * math.sin(math.pi * t / 8)) for t in range(9)]
for z in (-0.36, 0.36):
    for (x0, y0), (x1, y1) in zip(arc, arc[1:]):
        ra.append(rod([x0, y0, z], [x1, y1, z], 0.06, PAINT, 'satin', shape='box', t2=0.07))
for x, y in arc[1:-1]:
    ra.append(box([0.04, 0.04, 0.82], [x, y + 0.03, 0], PAINT, 'satin', radius=0.008))    # roof slats
ra.append(box([1.82, 0.08, 0.08], [0, 2.1, 0.0], PAINT, 'satin', radius=0.015))            # swing beam
# swing (seat top 0.45, hips at z = 0)
ra += [box([1.6, 0.05, 0.42], [0, 0.405, -0.01], PAINT, 'satin', radius=0.012),
       cushion([1.56, 0.06, 0.4], [0, 0.44, 0.0], BLUSH, radius=0.03),
       box([1.6, 0.42, 0.04], [0, 0.66, -0.24], PAINT, 'satin', radius=0.012, rotate=[-10, 0, 0]),
       cushion([0.36, 0.3, 0.1], [-0.6, 0.66, -0.16], ROSE, rotate=[-12, 15, 0]),
       cushion([0.34, 0.28, 0.1], [0.62, 0.65, -0.16], IVORY, rotate=[-12, -15, 0])]
for s in (-1, 1):
    ra += [box([0.05, 0.22, 0.42], [s * 0.78, 0.55, 0.0], PAINT, 'satin', radius=0.012),   # arms
           rod([s * 0.78, 0.66, 0.15], [s * 0.78, 2.08, 0.0], 0.014, GOLD, 'metal'),        # chains
           rod([s * 0.78, 0.86, -0.25], [s * 0.78, 2.08, 0.0], 0.014, GOLD, 'metal')]
# climbing roses
rnd = [0.13, 0.71, 0.42, 0.88, 0.27, 0.56, 0.05, 0.93, 0.36, 0.64, 0.19, 0.81]
k = 0
for x in (-0.82, 0.82):
    for z in (-0.3, 0.3):
        for y in (0.5, 1.1, 1.65):
            ra.append(part('blob', [0.2, 0.3, 0.18], [x, y + rnd[k % 12] * 0.2, z], LEAF if k % 2 else '#4F7F3E', 'foliage', noise=0.2))
            ra += rose(x + (0.06 if x < 0 else -0.06), y + 0.12, z + (0.04 if z < 0 else -0.04), ROSE if k % 3 else '#E07A8A', 0.07)
            k += 1
for i, (x, y) in enumerate(arc[1:-1]):
    ra.append(part('blob', [0.3, 0.16, 0.72], [x, y + 0.08, 0], '#4F7F3E' if i % 2 else LEAF, 'foliage', noise=0.22))
    ra += rose(x, y + 0.17, -0.25 + 0.17 * (i % 4), ROSE if i % 2 else '#E07A8A', 0.08)
E['model.romantic.roseArbourSwing'] = placeholder(ra)


def main(path):
    bad = 0
    for k, e in E.items():
        fp = FOOT[k]
        parts = e.get('parts', []) if 'url' in e else e['placeholder']
        issues = validate_parts(k, parts, fp)
        if 'url' in e:
            w, h, d = e['fit']
            if w > fp[0] - 0.08 + 1e-6 or d > fp[1] - 0.08 + 1e-6: issues.append(f'fit {e["fit"]} exceeds {fp}')
        fins = sorted({p['material'].split('.')[-1] for p in parts})
        print(f'{k:40s} {"glTF+" if "url" in e else ""}{len(parts)} parts {",".join(fins)}')
        for s in issues: print('   !', s)
        bad += len(issues)
    assert set(E) == set(FOOT), set(FOOT) ^ set(E)
    json.dump(E, open(path, 'w'), indent=2)
    print(f'{len(E)} entries -> {path}; {bad} issue(s)')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else f'pack_{TRAIT}.json')
