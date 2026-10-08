# Gloomy pack models (web/public/assets/packs/gloomy/manifest.json): moody, but readable — plum,
# slate blue, smoky mauve, candlelight; dark tones only as accents.
# Run: python3 -I pack_gloomy.py [--apply]
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import box, cyl, cone, sph, rod, part, lathe, torus, cushion, mat, on, CHROME, BRASS  # noqa: E402
from pack_shapes import LIB, JAR, TUB, VASE, candle, leafy, run  # noqa: E402

E = {}
PLUM, MAUVE, SLATE, SMOKE, INK = '#6B4A6E', '#9C7FA0', '#5E6F8C', '#A7A9B4', '#3A3550'
WALNUT, ROSEWOOD = '#7A5234', '#8A4A35'

# ---- Record cabinet (1x1): Poly Haven mid-century slatted console + turntable and sleeves --------
TOP = 0.62
parts = [box([0.4, 0.08, 0.32], [-0.14, TOP + 0.04, -0.2], '#8C6E8F', 'satin', radius=0.012),   # turntable plinth
         cyl([0.28, 0.02, 0.28], [-0.16, TOP + 0.09, -0.2], '#C9CCD0', 'metal', segments=28),     # platter
         cyl([0.27, 0.006, 0.27], [-0.16, TOP + 0.103, -0.2], '#26222E', 'gloss', segments=28),   # record
         cyl([0.08, 0.008, 0.08], [-0.16, TOP + 0.106, -0.2], '#C25B7A', 'gloss', segments=16),   # label
         rod([0.02, TOP + 0.1, -0.33], [-0.08, TOP + 0.11, -0.16], 0.012, CHROME, 'chrome'),      # tonearm
         cyl([0.035, 0.03, 0.035], [0.02, TOP + 0.095, -0.33], CHROME, 'chrome'),
         box([0.07, 0.02, 0.05], [0.08, TOP + 0.09, -0.08], '#3A3550', 'satin', radius=0.006)]
for i, (c, x, a) in enumerate([('#5E6F8C', 0.16, -8), ('#9C7FA0', 0.2, -4), ('#C9B37E', 0.24, 0)]):
    parts.append(box([0.31, 0.31, 0.012], [x + 0.04, TOP + 0.155, -0.33 + i * 0.03], c, 'matte', radius=0.004, rotate=[a, 0, 0]))  # sleeves
parts += candle(0.33, TOP, -0.1, h=0.1, d=0.06) + [
    lathe([0.14, 0.2, 0.14], [0.36, 0.1, 0.32], '#B7A9C6', 'gloss', VASE, segments=16),          # floor vase
    rod([0.36, 0.18, 0.32], [0.33, 0.62, 0.3], 0.008, '#6E5A3E', 'matte'),                       # dried branches
    rod([0.36, 0.18, 0.32], [0.42, 0.55, 0.33], 0.008, '#6E5A3E', 'matte'),
    part('blob', [0.06, 0.05, 0.06], [0.33, 0.63, 0.3], '#C9A0B8', 'matte', noise=0.2)]
E['model.gloomy.recordCabinet'] = {
    'type': 'model', 'url': LIB + 'ph/modern_wooden_cabinet.glb', 'fit': [0.9, 0.62, 0.42], 'align': 'back', 'offset': [0, 0, 0.04],
    'parts': parts, 'placeholder': [box([0.9, 0.62, 0.42], [0, 0.31, -0.25], WALNUT, 'wood', radius=0.02)] + parts}

# ---- Cello (1x1): the Sim sits on the stool at the centre, cello leaning back between the knees ---
TILT = [-14, 0, 0]
B = [0, 0.02, 0.3]                       # end-pin foot
def c_at(y, z=0.0):
    return on(B, TILT, [0, y, z])
p = [cyl([0.4, 0.05, 0.4], [0, 0.42, -0.08], ROSEWOOD, 'wood', segments=24),                   # stool top
     cushion([0.38, 0.05, 0.38], [0, 0.455, -0.08], PLUM, radius=0.02),                          # cushion (top 0.48)
     cyl([0.05, 0.4, 0.05], [0, 0.2, -0.08], ROSEWOOD, 'wood'),
     cyl([0.34, 0.03, 0.34], [0, 0.015, -0.08], ROSEWOOD, 'wood', segments=20),
     rod(B, c_at(0.2), 0.014, CHROME, 'chrome'),                                                 # end pin
     part('sphere', [0.46, 0.4, 0.17], c_at(0.42), '#9A4A26', 'gloss', rotate=TILT, segments=20),   # lower bout
     part('sphere', [0.36, 0.34, 0.16], c_at(0.7), '#9A4A26', 'gloss', rotate=TILT, segments=20),   # upper bout
     box([0.3, 0.22, 0.15], c_at(0.56), '#9A4A26', 'gloss', radius=0.06, rotate=TILT),            # waist
     box([0.08, 0.2, 0.02], c_at(0.5, 0.085), '#2E2420', 'gloss', radius=0.01, rotate=TILT),     # tailpiece
     box([0.1, 0.03, 0.03], c_at(0.6, 0.09), '#E6D3B0', 'matte', radius=0.006, rotate=TILT),     # bridge
     box([0.05, 0.62, 0.03], c_at(0.98, 0.08), '#2E2420', 'gloss', radius=0.01, rotate=TILT),    # fingerboard
     box([0.045, 0.3, 0.04], c_at(1.22, 0.04), '#9A4A26', 'gloss', radius=0.012, rotate=TILT),   # neck / pegbox
     sph([0.07, 0.08, 0.06], c_at(1.4, 0.04), '#9A4A26', 'gloss', rotate=TILT, segments=12)]      # scroll
for x in (-0.06, 0.06):
    p.append(box([0.012, 0.11, 0.004], c_at(0.58, 0.088), '#2E2420', 'matte', radius=0.002, rotate=[TILT[0], 0, x * 60]))  # f-holes
    p[-1]['at'][0] = x
for x in (-0.015, -0.005, 0.005, 0.015):
    p.append(box([0.003, 0.82, 0.003], c_at(0.92, 0.098), '#E3E3E3', 'chrome', rotate=TILT))   # strings
    p[-1]['at'][0] = x
p += [rod([0.26, 0.02, 0.3], [0.27, 1.02, 0.31], 0.02, INK, 'metal'),                             # music stand
      box([0.36, 0.28, 0.02], [0.24, 1.08, 0.3], INK, 'metal', radius=0.008, rotate=[20, -25, 0]),
      box([0.3, 0.23, 0.005], on([0.24, 1.08, 0.3], [20, -25, 0], [0, 0.01, -0.014]), '#EFE6D3', 'matte', rotate=[20, -25, 0]),
      cyl([0.24, 0.015, 0.24], [0.27, 0.008, 0.3], INK, 'metal', segments=18),
      rod([-0.28, 0.03, 0.12], [-0.12, 0.6, 0.32], 0.01, '#6E5A3E', 'wood')]                    # bow resting against the stool
E['model.gloomy.cello'] = {'type': 'model', 'placeholder': p}

# ---- Candlelit writing desk (2x1): chair at the centre line, desk in front (near edge z 0.2) -----
p = [box([1.5, 0.04, 0.26], [0, 0.76, 0.32], ROSEWOOD, 'wood', radius=0.012),                    # desk top
     box([1.42, 0.1, 0.22], [0, 0.69, 0.33], WALNUT, 'wood', radius=0.008),                       # apron with drawer
     box([0.36, 0.06, 0.012], [0.42, 0.69, 0.218], '#8A5A40', 'wood', radius=0.006),
     sph([0.03, 0.03, 0.02], [0.42, 0.69, 0.21], BRASS, 'metal', segments=8),
     box([1.5, 0.26, 0.05], [0, 0.92, 0.42], ROSEWOOD, 'wood', radius=0.012),                     # back gallery
     box([1.44, 0.02, 0.14], [0, 1.05, 0.38], WALNUT, 'wood', radius=0.006)]                      # shelf
for x in (-0.7, 0.7):
    for z in (0.22, 0.42):
        p.append(cyl([0.05, 0.72, 0.05], [x, 0.36, z], WALNUT, 'wood', taper=0.7, segments=12))
p += [box([0.42, 0.012, 0.24], [0.0, 0.787, 0.31], '#EFE6D3', 'matte', radius=0.004, rotate=[0, -6, 0]),  # open journal
      box([0.02, 0.016, 0.24], [0.0, 0.79, 0.31], PLUM, 'matte', radius=0.004, rotate=[0, -6, 0]),
      box([0.3, 0.003, 0.004], [-0.1, 0.795, 0.28], '#3A3550', 'matte'),
      box([0.24, 0.003, 0.004], [-0.1, 0.795, 0.31], '#3A3550', 'matte'),
      cyl([0.06, 0.05, 0.06], [0.3, 0.805, 0.3], '#2E3348', 'gloss', segments=12),                 # inkwell
      rod([0.3, 0.83, 0.3], [0.36, 1.02, 0.36], 0.01, '#EFE6D3', 'matte'),                         # quill
      part('blob', [0.04, 0.14, 0.02], [0.345, 0.97, 0.345], '#EFE6D3', 'matte', noise=0.1, rotate=[0, 0, -18]),
      box([0.22, 0.05, 0.16], [-0.5, 0.805, 0.36], SLATE, 'matte', radius=0.006),                  # book stack
      box([0.2, 0.04, 0.15], [-0.5, 0.85, 0.36], MAUVE, 'matte', radius=0.006, rotate=[0, 10, 0]),
      box([0.21, 0.045, 0.14], [-0.5, 0.89, 0.36], '#8C6E8F', 'matte', radius=0.006, rotate=[0, -6, 0]),
      lathe([0.08, 0.2, 0.08], [0.6, 0.88, 0.38], '#B7A9C6', 'gloss', VASE, segments=12),          # bud vase + wilted rose
      rod([0.6, 0.94, 0.38], [0.64, 1.07, 0.36], 0.006, '#5C6B3A', 'matte'),
      sph([0.05, 0.05, 0.05], [0.65, 1.06, 0.35], '#8A2E46', 'satin', segments=8)]
p += candle(-0.25, 0.78, 0.38, h=0.14, d=0.05) + candle(-0.18, 0.78, 0.4, h=0.09, d=0.045) + candle(0.5, 1.06, 0.38, h=0.12, d=0.05)
p += [cyl([0.12, 0.01, 0.12], [-0.215, 0.785, 0.39], BRASS, 'metal', segments=14)]               # candle dish
# Chair: high back, plum velvet, seat top 0.45 centred on the Sim (z ~ -0.05)
p += [box([0.48, 0.05, 0.44], [0, 0.4, -0.06], WALNUT, 'wood', radius=0.012),
      cushion([0.44, 0.06, 0.4], [0, 0.44, -0.05], PLUM, radius=0.025),
      cushion([0.42, 0.62, 0.06], [0, 0.82, -0.28], PLUM, rotate=[-6, 0, 0], radius=0.025),
      box([0.48, 0.06, 0.06], [0, 1.16, -0.31], WALNUT, 'wood', radius=0.02, rotate=[-6, 0, 0])]
for x in (-0.21, 0.21):
    p += [cyl([0.04, 0.4, 0.04], [x, 0.2, 0.13], WALNUT, 'wood', taper=0.75, segments=10),
          box([0.045, 1.2, 0.045], [x, 0.6, -0.29], WALNUT, 'wood', radius=0.01, rotate=[-6, 0, 0])]
E['model.gloomy.journalDesk'] = {'type': 'model', 'placeholder': p}

# ---- Rainfall lamp (1x1): glass column of falling water, lit from the base --------------------
p = [lathe([0.42, 0.14, 0.42], [0, 0.07, -0.05], '#6F7E96', 'metal', [[0, -0.5], [0.5, -0.5], [0.5, 0.3], [0.42, 0.5], [0, 0.5]], segments=32),
     cyl([0.34, 0.03, 0.34], [0, 0.155, -0.05], '#BFE3F2', 'gloss', segments=28),                 # lit pool
     lathe([0.36, 1.2, 0.36], [0, 0.77, -0.05], '#D9E8EE', 'glass', [[0.5, -0.5], [0.5, 0.5], [0.47, 0.5], [0.47, -0.5]], segments=32),
     lathe([0.4, 0.08, 0.4], [0, 1.41, -0.05], '#6F7E96', 'metal', [[0, -0.5], [0.42, -0.5], [0.5, -0.2], [0.5, 0.5], [0, 0.5]], segments=32)]
for i in range(14):
    a = i * 2.4
    r = 0.04 + (i * 7 % 5) * 0.022
    x, z = math.cos(a) * r, -0.05 + math.sin(a) * r
    p.append(cyl([0.006, 1.1, 0.006], [x, 0.76, z], '#A9D8EE', 'gloss', segments=6))            # water strands
for i in range(5):
    a = i * 1.3
    p.append(torus([0.08 + i * 0.05, 0.006, 0.08 + i * 0.05], [0, 0.172, -0.05], '#E6F6FC', 'gloss', segments=24))  # ripples
for i, (x, z) in enumerate([(0.3, 0.2), (0.36, 0.1), (-0.3, 0.22), (0.24, 0.3), (-0.36, 0.08)]):
    p.append(part('blob', [0.09, 0.05, 0.08], [x, 0.03, z], ['#B8B4AE', '#9EA0A6', '#CFC9C0'][i % 3], 'satin', noise=0.15))  # pebbles
E['model.gloomy.rainLamp'] = {'type': 'model', 'placeholder': p}

# ---- Window seat (2x1): built-in bench for two (seat top 0.45 at z 0) under a rainy window ------
FRAME, BENCH = '#D8D6DE', '#7E8BA6'
p = [box([1.84, 0.38, 0.62], [0, 0.19, -0.08], BENCH, 'satin', radius=0.02),                     # bench box
     cushion([1.8, 0.08, 0.6], [0, 0.41, -0.07], MAUVE, radius=0.035),                           # seat cushion (top 0.45)
     box([1.84, 0.03, 0.02], [0, 0.2, 0.235], '#6E7A94', 'satin', radius=0.008)]                  # drawer line
for x in (-0.45, 0.45):
    p += [box([0.86, 0.26, 0.012], [x, 0.18, 0.232], '#8592AD', 'satin', radius=0.006),
          box([0.14, 0.02, 0.02], [x, 0.24, 0.243], BRASS, 'metal', radius=0.006)]
p += [box([1.84, 1.5, 0.08], [0, 1.22, -0.41], FRAME, 'satin', radius=0.02),                     # window wall
      box([1.5, 1.04, 0.012], [0, 1.24, -0.364], '#6F8FB8', 'glass', radius=0.004),              # rainy glass
      box([1.52, 0.06, 0.06], [0, 0.72, -0.37], FRAME, 'satin', radius=0.012),                     # sill
      box([0.05, 1.04, 0.04], [0, 1.24, -0.36], FRAME, 'satin', radius=0.008),                     # mullions
      box([1.5, 0.04, 0.04], [0, 1.4, -0.36], FRAME, 'satin', radius=0.008)]
for i in range(10):                                                                                # raindrops on the glass
    x = -0.66 + i * 0.145
    y = 0.9 + (i * 37 % 7) * 0.09
    p.append(sph([0.025, 0.035, 0.008], [x, y, -0.355], '#E3F0F8', 'gloss', segments=6))
p += [cushion([0.5, 0.36, 0.14], [-0.62, 0.62, -0.28], SLATE, rotate=[-10, 0, 8], radius=0.06),    # pillows
      cushion([0.44, 0.32, 0.12], [0.66, 0.6, -0.28], '#C9B37E', rotate=[-10, 0, -6], radius=0.05),
      cushion([0.7, 0.04, 0.5], [0.15, 0.47, -0.02], '#A7A9B4', rotate=[0, 12, 0], radius=0.015),  # throw
      box([0.04, 0.24, 0.5], [0.52, 0.32, 0.06], '#A7A9B4', 'fabric', radius=0.015, rotate=[0, 12, 0]),
      box([0.16, 0.03, 0.22], [-0.2, 0.47, 0.05], PLUM, 'matte', radius=0.006, rotate=[0, -20, 0]),   # book
      cyl([0.08, 0.09, 0.08], [0.82, 0.78, -0.38], '#E8E4EC', 'gloss')]                             # mug on the sill
p += candle(-0.8, 0.75, -0.37, h=0.12) + candle(-0.72, 0.75, -0.38, h=0.08)
E['model.gloomy.windowSeat'] = {'type': 'model', 'placeholder': p}

# ---- Moonstone soaking tub (2x2): deep round stone tub, the Sim sits at the centre (water ~0.5) ---
STONE = '#BDB7AD'
p = [lathe([1.5, 0.66, 1.5], [0, 0.33, 0.05], STONE, 'satin', TUB, segments=40),                # tub
     cyl([1.24, 0.02, 1.24], [0, 0.52, 0.05], '#8FC1D4', 'glass', segments=40),                  # water
     part('blob', [0.4, 0.02, 0.3], [0.25, 0.535, 0.25], '#F2F6F8', 'gloss', noise=0.3),         # bath foam
     part('blob', [0.3, 0.02, 0.24], [-0.3, 0.535, 0.0], '#F2F6F8', 'gloss', noise=0.3),
     box([1.84, 0.5, 0.3], [0, 0.25, -0.78], '#A39D93', 'satin', radius=0.03),                    # candle ledge
     box([1.86, 0.04, 0.32], [0, 0.51, -0.78], '#CFC9C0', 'satin', radius=0.012),
     cushion([0.8, 0.025, 0.4], [0.1, 0.0125, 0.74], MAUVE, radius=0.01)]                          # bath mat
for i, x in enumerate((-0.75, -0.62, -0.52, 0.55, 0.68)):
    p += candle(x, 0.53, -0.76 + (i % 2) * 0.04, h=0.08 + (i % 3) * 0.05, d=0.06)
p += [cushion([0.36, 0.08, 0.26], [0.2, 0.57, -0.78], '#EDE8F2', radius=0.03),                   # folded towels
      cushion([0.34, 0.07, 0.25], [0.2, 0.645, -0.78], MAUVE, radius=0.03),
      lathe([0.16, 0.18, 0.16], [-0.25, 0.62, -0.8], '#B7A9C6', 'gloss', VASE, segments=14)]
p += [part('blob', [0.2, 0.22, 0.2], [-0.25, 0.8, -0.8], '#6E8F72', 'foliage', noise=0.25)]
E['model.gloomy.soakingTub'] = {'type': 'model', 'placeholder': p}

if __name__ == '__main__':
    sys.exit(1 if run('gloomy', E) else 0)
