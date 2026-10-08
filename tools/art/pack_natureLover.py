# Nature Lover pack models (web/public/assets/packs/natureLover/manifest.json): cedar, terracotta,
# sage and lots of greenery.
# Run: python3 -I pack_natureLover.py [--apply]
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import box, cyl, cone, sph, rod, part, lathe, torus, cushion, mat, on, CHROME, BRASS  # noqa: E402
from pack_shapes import LIB, POT, DOME, JAR, leafy, sling, run  # noqa: E402

E = {}
CEDAR, CEDARD, SOIL, TERRA, SAGE = '#C27C4E', '#A3653E', '#5A4030', '#C7744F', '#8FA88A'
GREEN, GREEN2, GREEN3 = '#5E8F4E', '#78A85A', '#4F8A45'
CANVAS = '#EDE4D3'


def pot(x, y, z, d=0.14, h=0.12, color=TERRA):
    return lathe([d, h, d], [x, y + h / 2, z], color, 'satin', POT, segments=16)


# ---- Raised veggie bed (2x1): cedar box with lettuce, carrots and staked tomatoes -------------
H = 0.45
p = [box([1.84, H, 0.84], [0, H / 2, 0.0], CEDAR, 'wood', radius=0.012),                       # box
     box([1.76, 0.02, 0.76], [0, H - 0.04, 0.0], SOIL, 'matte', radius=0.006)]                   # soil
for x in (-0.91, 0.91):
    for z in (-0.41, 0.41):
        p.append(box([0.07, H + 0.04, 0.07], [x * 0.98, (H + 0.04) / 2, z * 0.98], CEDARD, 'wood', radius=0.01))  # corner posts
for z in (-0.43, 0.43):
    p.append(box([1.86, 0.04, 0.05], [0, H, z * 0.98], CEDARD, 'wood', radius=0.01))           # top rails
for i in range(4):                                                                               # lettuce row (front)
    x = -0.7 + i * 0.22
    p.append(part('blob', [0.2, 0.13, 0.2], [x, H + 0.03, 0.22], ['#9BCB5A', '#7FB84A'][i % 2], 'foliage', noise=0.3))
for i in range(6):                                                                               # carrots (middle)
    x = -0.72 + i * 0.13
    p += [cyl([0.04, 0.03, 0.04], [x, H - 0.015, -0.05], '#F28C28', 'satin'),
          cone([0.1, 0.16, 0.1], [x, H + 0.06, -0.05], GREEN2, 'foliage', taper=0.0, segments=7)]
for x in (0.3, 0.68):                                                                            # tomato plants (back right)
    p += [rod([x, H - 0.02, -0.22], [x, H + 0.85, -0.22], 0.02, '#B08E66', 'wood'),
          part('blob', [0.3, 0.55, 0.3], [x, H + 0.4, -0.2], GREEN3, 'foliage', noise=0.3)]
    for j in range(5):
        a = j * 1.3
        p.append(sph([0.07, 0.07, 0.07], [x + math.cos(a) * 0.13, H + 0.22 + j * 0.1, -0.2 + math.sin(a) * 0.13], '#D9483B', 'gloss', segments=10))
p += [part('blob', [0.34, 0.2, 0.3], [0.5, H + 0.08, 0.18], GREEN, 'foliage', noise=0.25),       # courgette leaves
      part('capsule', [0.07, 0.24, 0.07], [0.45, H + 0.04, 0.3], '#4F7D3A', 'satin', rotate=[0, 30, 80]),
      box([0.1, 0.16, 0.02], [-0.85, H + 0.08, 0.38], '#F2F2F0', 'matte', radius=0.004)]        # plant label
E['model.natureLover.veggieBed'] = {'type': 'model', 'placeholder': p}

# ---- Potting bench (2x1): sage-painted bench, pegboard tools, pots and seedlings -----------------
TOP = 0.88
p = [box([1.76, 0.05, 0.6], [0, TOP - 0.025, -0.13], '#D9B98C', 'wood', radius=0.01),         # worktop
     box([1.7, 0.03, 0.5], [0, 0.22, -0.15], '#C9A274', 'wood', radius=0.008),                 # lower shelf
     box([1.76, 0.86, 0.04], [0, TOP + 0.43, -0.41], SAGE, 'satin', radius=0.012),             # back board
     box([1.76, 0.03, 0.18], [0, TOP + 0.62, -0.33], '#D9B98C', 'wood', radius=0.008)]          # top shelf
for x in (-0.84, 0.84):
    for z in (-0.39, 0.12):
        p.append(box([0.06, TOP - 0.05, 0.06], [x, (TOP - 0.05) / 2, z], SAGE, 'satin', radius=0.01))
for i, x in enumerate((-0.6, -0.3, 0.0, 0.3, 0.6)):                                           # pots on the top shelf
    p.append(pot(x, TOP + 0.635, -0.33, d=0.13 - (i % 2) * 0.02, h=0.11))
    p += leafy(x, TOP + 0.8, -0.33, 0.14, [GREEN, GREEN2, '#9BCB5A'][i % 3], n=2, seed=i)
p += [rod([-0.75, TOP + 0.35, -0.385], [-0.75, TOP + 0.12, -0.385], 0.02, '#6C7A89', 'metal'),   # hanging trowel
      box([0.08, 0.14, 0.012], [-0.75, TOP + 0.06, -0.385], '#8A9096', 'metal', radius=0.02),
      rod([-0.6, TOP + 0.35, -0.385], [-0.6, TOP + 0.12, -0.385], 0.02, '#B08E66', 'wood'),     # fork
      box([0.07, 0.12, 0.012], [-0.6, TOP + 0.06, -0.385], '#8A9096', 'metal', radius=0.004),
      part('torus', [0.2, 0.025, 0.2], [0.72, TOP + 0.3, -0.385], '#3F7A45', 'satin', rotate=[90, 0, 0], segments=18),  # coiled twine
      box([0.5, 0.06, 0.3], [-0.2, TOP + 0.03, -0.12], '#3A3D41', 'satin', radius=0.008)]     # seedling tray
for i in range(4):
    for j in range(2):
        p.append(part('blob', [0.08, 0.07, 0.08], [-0.38 + i * 0.12, TOP + 0.08, -0.19 + j * 0.13], ['#9BCB5A', '#7FB84A'][(i + j) % 2], 'foliage', noise=0.3))
p += [pot(0.25, TOP, -0.15, d=0.2, h=0.18), part('blob', [0.26, 0.3, 0.26], [0.25, TOP + 0.3, -0.15], '#7FB84A', 'foliage', noise=0.3),
      sph([0.05, 0.05, 0.05], [0.3, TOP + 0.4, -0.08], '#F28DB2', 'satin', segments=8),
      sph([0.05, 0.05, 0.05], [0.2, TOP + 0.43, -0.18], '#F6C744', 'satin', segments=8),
      lathe([0.2, 0.18, 0.12], [0.62, TOP + 0.09, -0.08], '#8EA5A0', 'metal', JAR, segments=14),   # watering can
      rod([0.68, TOP + 0.08, -0.08], [0.84, TOP + 0.2, -0.08], 0.02, '#8EA5A0', 'metal'),
      torus([0.12, 0.02, 0.12], [0.62, TOP + 0.2, -0.08], '#8EA5A0', 'metal', rotate=[90, 0, 0])]
for i in range(3):                                                                               # sacks and a pot stack below
    p.append(cushion([0.32, 0.3, 0.26], [-0.55 + i * 0.36, 0.385, -0.16], ['#D8C49C', '#CDB78C', '#E2D2AE'][i], radius=0.1, rotate=[0, (i - 1) * 12, 0]))
p += [pot(0.55, 0.235, -0.12, d=0.24, h=0.16), pot(0.55, 0.36, -0.12, d=0.22, h=0.12)]
E['model.natureLover.pottingBench'] = {'type': 'model', 'placeholder': p}

# ---- Bird feeder post (1x1): cedar post, feeder house, hanging seed tube, visiting birds -------
p = [box([0.08, 1.5, 0.08], [0, 0.75, -0.05], CEDARD, 'wood', radius=0.012),                   # post
     box([0.36, 0.03, 0.3], [0, 1.5, -0.05], CEDAR, 'wood', radius=0.008),                     # feeding tray
     box([0.38, 0.03, 0.04], [0, 1.53, 0.1], CEDAR, 'wood', radius=0.006),
     box([0.38, 0.03, 0.04], [0, 1.53, -0.2], CEDAR, 'wood', radius=0.006),
     box([0.26, 0.18, 0.2], [0, 1.6, -0.05], '#E8E0CF', 'satin', radius=0.008),                 # little house
     box([0.32, 0.03, 0.17], [0, 1.73, 0.02], '#5E7F9A', 'satin', radius=0.008, rotate=[30, 0, 0]),   # roof
     box([0.32, 0.03, 0.17], [0, 1.73, -0.12], '#5E7F9A', 'satin', radius=0.008, rotate=[-30, 0, 0]),
     cyl([0.06, 0.01, 0.06], [0, 1.62, 0.052], '#3A3D41', 'matte', rotate=[90, 0, 0]),          # entry hole
     part('blob', [0.28, 0.02, 0.22], [0, 1.52, -0.05], '#C9A66B', 'matte', noise=0.3),           # seed
     rod([0.04, 1.3, -0.05], [0.25, 1.32, -0.05], 0.02, CEDARD, 'wood'),                         # arm
     lathe([0.08, 0.28, 0.08], [0.25, 1.13, -0.05], '#E6F0F2', 'glass', JAR, segments=12),        # seed tube
     cyl([0.06, 0.2, 0.06], [0.25, 1.11, -0.05], '#C9A66B', 'matte'),
     cyl([0.12, 0.015, 0.12], [0.25, 0.985, -0.05], '#5E7F9A', 'satin')]
for (x, y, z, body, breast) in [(0.1, 1.55, 0.12, '#4F7FC4', '#D9733B'), (-0.12, 1.56, 0.11, '#8A6A4A', '#E2C8A0'), (0.33, 1.0, 0.03, '#E8C23A', '#E8C23A')]:
    p += [sph([0.07, 0.06, 0.1], [x, y, z], body, 'satin', segments=10),                          # birds
          sph([0.05, 0.05, 0.05], [x, y + 0.045, z + 0.035], body, 'satin', segments=10),
          sph([0.05, 0.04, 0.05], [x, y - 0.01, z + 0.02], breast, 'satin', segments=8),
          cone([0.02, 0.03, 0.02], [x, y + 0.045, z + 0.07], '#E8B34A', 'satin', taper=0.0, rotate=[90, 0, 0], segments=6)]
for i in range(8):                                                                               # flower ring at the base
    a = i * math.pi / 4
    x, z = math.cos(a) * 0.26, -0.05 + math.sin(a) * 0.26
    p.append(part('blob', [0.16, 0.14, 0.16], [x, 0.1, z], [GREEN, GREEN2][i % 2], 'foliage', noise=0.3))
    p.append(sph([0.05, 0.05, 0.05], [x, 0.19, z], ['#F28DB2', '#F6C744', '#B8A1E3', '#FFFFFF'][i % 4], 'satin', segments=8))
E['model.natureLover.birdFeeder'] = {'type': 'model', 'placeholder': p}

# ---- Garden hammock (2x1): canvas sling on a curved cedar stand (low point 0.5 m) -------------
p = sling(-0.72, 0.72, 0.86, 0.48, 0.0, 0.62, [CANVAS, '#7FA87A', CANVAS, CANVAS, '#7FA87A', CANVAS], segs=12)
p += [box([1.7, 0.08, 0.1], [0, 0.05, 0.0], CEDAR, 'wood', radius=0.02)]
for s in (-1, 1):
    p += [rod([s * 0.62, 0.06, 0.0], [s * 0.9, 1.08, 0.0], 0.08, CEDAR, 'wood', shape='box', radius=0.02),
          box([0.1, 0.05, 0.62], [s * 0.66, 0.035, 0.0], CEDARD, 'wood', radius=0.015),
          rod([s * 0.88, 1.02, 0.0], [s * 0.72, 0.86, -0.3], 0.012, '#D9CDB4', 'matte'),
          rod([s * 0.88, 1.02, 0.0], [s * 0.72, 0.86, 0.3], 0.012, '#D9CDB4', 'matte'),
          box([0.04, 0.04, 0.66], [s * 0.72, 0.86, 0.0], CEDARD, 'wood', radius=0.012)]
p += [cushion([0.42, 0.12, 0.3], [-0.55, 0.76, 0.0], '#E8B07A', rotate=[0, 0, -25], radius=0.05),
      part('blob', [0.3, 0.03, 0.2], [0.35, 0.02, 0.32], '#9BCB5A', 'foliage', noise=0.3)]      # grass tuft
E['model.natureLover.gardenHammock'] = {'type': 'model', 'placeholder': p}

# ---- Cedar outdoor shower (1x1): slatted cedar walls on two sides, duckboard, copper rain head ---
p = []
for i in range(12):                                                                              # back wall slats
    x = -0.41 + i * 0.074
    p.append(box([0.065, 1.9, 0.03], [x, 1.0, -0.43], CEDAR if i % 2 else CEDARD, 'wood', radius=0.006))
for i in range(11):                                                                              # left wall slats
    z = -0.35 + i * 0.077
    p.append(box([0.03, 1.9, 0.065], [-0.43, 1.0, z], CEDAR if i % 2 else CEDARD, 'wood', radius=0.006))
for y in (0.06, 1.97):
    p += [box([0.9, 0.05, 0.05], [0.0, y, -0.43], CEDARD, 'wood', radius=0.01),
          box([0.05, 0.05, 0.86], [-0.43, y, 0.0], CEDARD, 'wood', radius=0.01)]
for i in range(7):                                                                               # duckboard
    p.append(box([0.78, 0.03, 0.08], [0.02, 0.05, -0.33 + i * 0.11], CEDAR, 'wood', radius=0.006))
p += [box([0.06, 0.03, 0.74], [-0.3, 0.02, 0.0], CEDARD, 'wood', radius=0.006),
      box([0.06, 0.03, 0.74], [0.32, 0.02, 0.0], CEDARD, 'wood', radius=0.006),
      rod([0.15, 0.05, -0.39], [0.15, 2.05, -0.39], 0.035, '#C27A4A', 'metal'),                  # copper pipe
      rod([0.15, 2.05, -0.39], [0.15, 2.05, -0.1], 0.03, '#C27A4A', 'metal'),
      cyl([0.3, 0.03, 0.3], [0.15, 2.02, -0.08], '#C27A4A', 'metal', segments=24),               # rain head
      cyl([0.08, 0.04, 0.08], [0.15, 1.1, -0.36], '#C27A4A', 'metal', rotate=[90, 0, 0]),         # valve
      box([0.04, 0.4, 0.2], [-0.4, 1.3, 0.25], '#F2F2F0', 'fabric', radius=0.02),                 # towel
      box([0.14, 0.06, 0.1], [-0.37, 1.0, -0.2], '#B08E66', 'wood', radius=0.01),                 # soap shelf
      box([0.08, 0.04, 0.05], [-0.36, 1.05, -0.2], '#F2D6A0', 'satin', radius=0.015),
      pot(0.3, 0.0, 0.3, d=0.18, h=0.16),
      part('blob', [0.22, 0.36, 0.22], [0.3, 0.36, 0.3], GREEN2, 'foliage', noise=0.3)]
for i, (x, z) in enumerate([(0.12, 0.38), (0.36, 0.08), (-0.2, 0.38), (0.36, -0.14)]):
    p.append(part('blob', [0.09, 0.05, 0.08], [x, 0.03, z], ['#B8B4AE', '#9EA0A6', '#CFC9C0'][i % 3], 'satin', noise=0.15))
E['model.natureLover.cedarShower'] = {'type': 'model', 'placeholder': p}

# ---- Moss terrarium (1x1): glass cloche over a little forest on a walnut pedestal -------------
WAL = '#8A5E3C'
p = [lathe([0.34, 0.7, 0.34], [0, 0.35, -0.1], WAL, 'wood', [[0, -0.5], [0.5, -0.5], [0.45, -0.42], [0.18, -0.3], [0.13, 0.3], [0.3, 0.42], [0.5, 0.5], [0, 0.5]], segments=24),  # pedestal
     cyl([0.4, 0.04, 0.4], [0, 0.72, -0.1], WAL, 'wood', segments=28),
     cyl([0.36, 0.04, 0.36], [0, 0.76, -0.1], SOIL, 'matte', segments=24),                       # soil
     lathe([0.38, 0.46, 0.38], [0, 0.97, -0.1], '#E1EEEC', 'glass', DOME, segments=28),           # cloche
     sph([0.06, 0.05, 0.06], [0, 1.22, -0.1], '#E1EEEC', 'glass', segments=10)]                   # knob
p += [part('blob', [0.3, 0.1, 0.3], [0, 0.8, -0.1], '#4F8A3C', 'foliage', noise=0.35),          # moss mound
      part('blob', [0.12, 0.08, 0.1], [0.08, 0.83, -0.05], '#B8B4AE', 'satin', noise=0.2),        # rock
      cone([0.1, 0.24, 0.1], [-0.07, 0.94, -0.12], GREEN3, 'foliage', taper=0.0, segments=7),    # tiny fir
      cone([0.07, 0.16, 0.07], [0.06, 0.9, -0.16], GREEN, 'foliage', taper=0.0, segments=7),
      sph([0.025, 0.02, 0.025], [-0.02, 0.84, -0.0], '#E4572E', 'satin', segments=8),             # toadstool
      cyl([0.008, 0.03, 0.008], [-0.02, 0.825, -0.0], '#F2F2F0', 'satin', segments=6),
      lathe([0.06, 0.16, 0.06], [0.24, 0.8, 0.05], '#8EC6D8', 'gloss', JAR, segments=12),         # mister bottle
      box([0.04, 0.05, 0.03], [0.24, 0.9, 0.05], '#F2F2F0', 'satin', radius=0.008),
      part('blob', [0.4, 0.004, 0.3], [0, 0.002, 0.25], '#7FA87A', 'matte', noise=0.1)]          # round mossy rug
E['model.natureLover.mossTerrarium'] = {'type': 'model', 'placeholder': p}

# ---- Fern glasshouse (2x2): white-framed glass room; bench for two (seat top 0.45 at z 0) -------
FR = '#F2F2F0'
W, D, HW, HR = 1.86, 1.86, 2.0, 2.45
gp = [box([W, 0.12, D], [0, 0.06, 0], '#C9C2B4', 'satin', radius=0.01),                         # stone base
      box([W - 0.06, 0.012, D - 0.06], [0, 0.126, 0], '#B8A88E', 'matte', radius=0.004)]          # gravel floor
for x in (-W / 2 + 0.03, W / 2 - 0.03):
    for z in (-D / 2 + 0.03, D / 2 - 0.03):
        gp.append(box([0.05, HW, 0.05], [x, HW / 2, z], FR, 'satin', radius=0.008))             # corner posts
gp += [box([W, 0.05, 0.05], [0, HW, -D / 2 + 0.03], FR, 'satin', radius=0.008),
       box([W, 0.05, 0.05], [0, HW, D / 2 - 0.03], FR, 'satin', radius=0.008),
       box([0.05, 0.05, D], [-W / 2 + 0.03, HW, 0], FR, 'satin', radius=0.008),
       box([0.05, 0.05, D], [W / 2 - 0.03, HW, 0], FR, 'satin', radius=0.008),
       box([0.05, 0.05, D], [0, HR, 0], FR, 'satin', radius=0.008)]                                # ridge
# Glass: back and side walls, two roof planes; the front stays open (doorway).
ang = math.degrees(math.atan2(HR - HW, W / 2))
roof_len = math.hypot(W / 2, HR - HW)
gp += [box([W - 0.08, HW - 0.15, 0.012], [0, HW / 2 + 0.05, -D / 2 + 0.03], '#DCEBEA', 'glass', radius=0.003),
       box([0.012, HW - 0.15, D - 0.08], [-W / 2 + 0.03, HW / 2 + 0.05, 0], '#DCEBEA', 'glass', radius=0.003),
       box([0.012, HW - 0.15, D - 0.08], [W / 2 - 0.03, HW / 2 + 0.05, 0], '#DCEBEA', 'glass', radius=0.003),
       box([roof_len, 0.012, D - 0.04], [-W / 4, (HW + HR) / 2, 0], '#DCEBEA', 'glass', radius=0.003, rotate=[0, 0, ang]),
       box([roof_len, 0.012, D - 0.04], [W / 4, (HW + HR) / 2, 0], '#DCEBEA', 'glass', radius=0.003, rotate=[0, 0, -ang])]
for z in (-0.45, 0.0, 0.45):                                                                      # glazing bars
    gp += [box([0.03, HW - 0.15, 0.03], [-W / 2 + 0.03, HW / 2 + 0.05, z], FR, 'satin', radius=0.006),
           box([0.03, HW - 0.15, 0.03], [W / 2 - 0.03, HW / 2 + 0.05, z], FR, 'satin', radius=0.006)]
for x in (-0.45, 0.0, 0.45):
    gp.append(box([0.03, HW - 0.15, 0.03], [x, HW / 2 + 0.05, -D / 2 + 0.03], FR, 'satin', radius=0.006))
gp.append(box([W, 0.04, 0.04], [0, 0.95, -D / 2 + 0.04], FR, 'satin', radius=0.006))
# Bench for two Sims (x = +-0.5), seat top 0.45, facing the open front
gp += [box([1.4, 0.05, 0.42], [0, 0.42, -0.02], CEDAR, 'wood', radius=0.012),
       box([1.4, 0.3, 0.04], [0, 0.66, -0.25], CEDAR, 'wood', radius=0.012, rotate=[-10, 0, 0]),
       cushion([0.6, 0.04, 0.36], [-0.5, 0.465, -0.01], '#E8B07A', 'satin', radius=0.015),
       cushion([0.6, 0.04, 0.36], [0.5, 0.465, -0.01], '#E8B07A', 'satin', radius=0.015)]
for x in (-0.64, 0.64):
    gp += [box([0.05, 0.3, 0.38], [x, 0.27, -0.02], CEDARD, 'wood', radius=0.01)]
# Plants: back shelf (ferns from Poly Haven via the url), orchids, a palm, hanging pots
gp += [box([1.7, 0.04, 0.3], [0, 0.78, -0.72], CEDAR, 'wood', radius=0.008)]
for x in (-0.72, 0.72):
    gp.append(box([0.04, 0.66, 0.26], [x, 0.45, -0.72], CEDARD, 'wood', radius=0.006))
for i, x in enumerate((-0.5, 0.0, 0.5)):
    gp += [lathe([0.14, 0.12, 0.14], [x + 0.18, 0.86, -0.66], '#F2F2F0', 'gloss', POT, segments=14),    # orchids
           rod([x + 0.18, 0.92, -0.66], [x + 0.2, 1.18, -0.65], 0.008, '#5C7A3A', 'matte'),
           sph([0.06, 0.05, 0.03], [x + 0.21, 1.18, -0.64], ['#E88CC2', '#FFFFFF', '#C98BE0'][i], 'satin', segments=8),
           sph([0.06, 0.05, 0.03], [x + 0.2, 1.1, -0.635], ['#E88CC2', '#FFFFFF', '#C98BE0'][i], 'satin', segments=8)]
for s in (-1, 1):                                                                                   # potted palms in the front corners
    gp += [pot(s * 0.64, 0.13, 0.6, d=0.3, h=0.26)]
    for k in range(5):
        a = k * 72
        gp.append(part('blob', [0.3, 0.05, 0.13], on([s * 0.64, 0.85, 0.6], [0, a, 0], [0.11, -0.04, 0]), GREEN2, 'foliage', noise=0.2, rotate=[0, a, -25]))
    gp.append(rod([s * 0.64, 0.38, 0.6], [s * 0.64, 0.85, 0.6], 0.04, '#8A6A4A', 'wood'))
for x in (-0.68, 0.68):                                                                             # hanging baskets
    gp += [rod([x, HW, -0.3], [x, 1.72, -0.3], 0.008, '#8A6A4A', 'matte'),
           lathe([0.2, 0.14, 0.2], [x, 1.65, -0.3], TERRA, 'satin', POT, segments=14),
           part('blob', [0.26, 0.26, 0.26], [x, 1.6, -0.3], '#5E8F4E', 'foliage', noise=0.35)]
E['model.natureLover.glasshouse'] = {
    'type': 'model', 'url': LIB + 'ph/fern_02.glb', 'fit': [1.5, 0.5, 0.26], 'align': 'centre', 'offset': [0, 0.8, -0.72],
    'parts': gp, 'placeholder': gp}

if __name__ == '__main__':
    sys.exit(1 if run('natureLover', E) else 0)
