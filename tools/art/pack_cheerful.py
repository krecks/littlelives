# Cheerful pack models (web/public/assets/packs/cheerful/manifest.json).
# Run: python3 -I pack_cheerful.py [--apply]
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import box, cyl, cone, sph, rod, part, lathe, torus, cushion, mat, on, CHROME, BRASS  # noqa: E402
from pack_shapes import LIB, JAR, BOWL, glass_with_drink, leafy, sling, arc_beam, run  # noqa: E402

E = {}
CHERRY, AMBER, MINT, CORAL, SUN, SKY, LAV = '#D7263D', '#F6A609', '#9ED8C6', '#F28D8D', '#F6C744', '#6EC1E4', '#B8A1E3'
WHITE = '#F4F4F2'

# ---- Jukebox (1x1): rounded cabinet with an arched glowing top --------------------------------
p = [box([0.74, 0.08, 0.5], [0, 0.04, -0.2], CHROME, 'chrome', radius=0.02),                     # plinth
     box([0.7, 1.0, 0.46], [0, 0.58, -0.2], CHERRY, 'gloss', radius=0.06),                       # body
     cyl([0.7, 0.46, 0.7], [0, 1.08, -0.2], CHERRY, 'gloss', rotate=[90, 0, 0], segments=32),   # arched top
     cyl([0.6, 0.47, 0.6], [0, 1.08, -0.2], AMBER, 'gloss', rotate=[90, 0, 0], segments=32),    # glowing arch band
     cyl([0.5, 0.48, 0.5], [0, 1.08, -0.2], '#FFE29A', 'gloss', rotate=[90, 0, 0], segments=32),
     cyl([0.4, 0.49, 0.4], [0, 1.08, -0.2], '#5B3A8C', 'gloss', rotate=[90, 0, 0], segments=32),  # window
     box([0.4, 0.2, 0.47], [0, 0.98, -0.2], '#5B3A8C', 'gloss', radius=0.01),
     cyl([0.26, 0.012, 0.26], [0, 1.02, 0.045], '#2B2433', 'gloss', rotate=[90, 0, 0]),         # record
     cyl([0.08, 0.014, 0.08], [0, 1.02, 0.047], SUN, 'gloss', rotate=[90, 0, 0]),
     box([0.5, 0.3, 0.02], [0, 0.42, 0.035], '#E9D8B0', 'fabric', radius=0.01),                 # speaker grille
     box([0.52, 0.32, 0.015], [0, 0.42, 0.03], BRASS, 'metal', radius=0.012),
     box([0.46, 0.1, 0.02], [0, 0.7, 0.036], '#FFF2C8', 'gloss', radius=0.008),                  # song cards
     box([0.46, 0.012, 0.024], [0, 0.76, 0.036], CHROME, 'chrome', radius=0.004)]
for i, x in enumerate((-0.15, -0.05, 0.05, 0.15)):
    p.append(cyl([0.03, 0.03, 0.03], [x, 0.63, 0.04], [SUN, CORAL, MINT, SKY][i], 'gloss', rotate=[90, 0, 0], segments=10))  # buttons
for s in (-1, 1):
    p += [cyl([0.07, 0.86, 0.07], [s * 0.33, 0.55, 0.02], AMBER, 'gloss', segments=14),          # bubble tubes
          cyl([0.05, 0.84, 0.05], [s * 0.33, 0.55, 0.02], '#FFE29A', 'gloss', segments=12),
          sph([0.09, 0.09, 0.09], [s * 0.33, 1.0, 0.02], CHROME, 'chrome', segments=10)]
E['model.cheerful.jukebox'] = {'type': 'model', 'placeholder': p}

# ---- Karaoke machine (1x1): speaker cabinet with a lyrics screen, mic stand, little spotlight ----
SPK = '#8A6BC0'
parts = [box([0.46, 0.34, 0.04], [0, 1.08, -0.2], '#2B2433', 'satin', radius=0.02, rotate=[-10, 0, 0]),   # lyrics screen
         box([0.42, 0.29, 0.004], on([0, 1.08, -0.2], [-10, 0, 0], [0, 0, 0.022]), '#3B2A6B', 'gloss', rotate=[-10, 0, 0]),
         box([0.32, 0.03, 0.003], on([0, 1.08, -0.2], [-10, 0, 0], [0, 0.04, 0.025]), '#FFFFFF', 'gloss', rotate=[-10, 0, 0]),
         box([0.24, 0.03, 0.003], on([0, 1.08, -0.2], [-10, 0, 0], [-0.02, -0.02, 0.025]), SUN, 'gloss', rotate=[-10, 0, 0]),
         box([0.06, 0.12, 0.04], [0, 0.9, -0.22], '#2B2433', 'satin', radius=0.01),
         cyl([0.26, 0.02, 0.26], [0.18, 0.01, 0.25], '#3A3D41', 'satin', segments=20),              # mic stand base
         rod([0.18, 0.02, 0.25], [0.18, 1.35, 0.25], 0.022, CHROME, 'chrome'),
         rod([0.18, 1.35, 0.25], [0.1, 1.42, 0.19], 0.018, CHROME, 'chrome'),
         part('capsule', [0.05, 0.2, 0.05], [0.08, 1.44, 0.17], '#2B2433', 'satin', rotate=[50, 0, 40]),   # mic
         sph([0.065, 0.065, 0.065], [0.05, 1.5, 0.13], '#C9CCD0', 'metal', segments=10),
         rod([-0.32, 0.02, 0.28], [-0.32, 1.7, 0.28], 0.025, '#3A3D41', 'satin'),                  # spotlight pole
         cyl([0.24, 0.02, 0.24], [-0.32, 0.01, 0.28], '#3A3D41', 'satin', segments=20),
         cone([0.16, 0.2, 0.16], [-0.3, 1.72, 0.24], '#EAEAEA', 'gloss', taper=0.55, rotate=[60, 30, 0]),
         cyl([0.12, 0.01, 0.12], on([-0.3, 1.72, 0.24], [60, 30, 0], [0, -0.1, 0]), '#FFF4B0', 'gloss', rotate=[60, 30, 0]),
         cyl([0.42, 0.004, 0.42], [0.0, 0.003, 0.18], '#F6E3A0', 'gloss', segments=24)]      # spotlight pool
E['model.cheerful.karaokeMachine'] = {
    'type': 'model', 'url': LIB + 'kenney/speaker.glb', 'fit': [0.5, 0.86, 0.42], 'align': 'back', 'offset': [0, 0, 0.04],
    'materials': {'wood': mat('gloss', SPK), 'metalMedium': mat('satin', '#54456E')},
    'parts': parts, 'placeholder': [box([0.5, 0.86, 0.42], [0, 0.43, -0.25], SPK, 'gloss', radius=0.03)] + parts}

# ---- Mocktail cart (1x1): brass bar cart under a striped canopy ---------------------------------
p = []
for y in (0.3, 0.8):
    p.append(box([0.78, 0.03, 0.46], [0, y, -0.06], MINT, 'gloss', radius=0.012))                  # shelves
    for z in (-0.29, 0.17):
        p.append(box([0.8, 0.03, 0.02], [0, y + 0.03, z], BRASS, 'metal', radius=0.008))          # gallery rails
for x in (-0.39, 0.39):
    for z in (-0.29, 0.17):
        p.append(cyl([0.025, 1.6, 0.025], [x, 0.8, z], BRASS, 'metal', segments=10))              # posts up to canopy
for x in (-0.36, 0.36):
    p.append(torus([0.14, 0.03, 0.14], [x, 0.07, 0.2], '#F2F2F0', 'satin', rotate=[0, 0, 90], segments=16))  # wheels
for i in range(6):                                                                                 # striped canopy
    c = CORAL if i % 2 else WHITE
    p.append(box([0.14, 0.03, 0.56], [-0.35 + i * 0.14, 1.62, -0.06], c, 'fabric', radius=0.01, rotate=[0, 0, 0]))
for i in range(6):
    c = CORAL if i % 2 else WHITE
    p.append(box([0.14, 0.1, 0.012], [-0.35 + i * 0.14, 1.56, 0.22], c, 'fabric', radius=0.004))  # scalloped valance
TOP = 0.835
p += [lathe([0.12, 0.26, 0.12], [-0.24, TOP + 0.13, -0.16], '#E6F0F2', 'glass', JAR, segments=14),   # pitcher
      cyl([0.1, 0.16, 0.1], [-0.24, TOP + 0.09, -0.16], '#FF9A3C', 'gloss'),
      lathe([0.2, 0.14, 0.2], [0.18, TOP + 0.07, -0.18], CHROME, 'chrome', BOWL, segments=16),         # ice bucket
      sph([0.05, 0.05, 0.05], [0.16, TOP + 0.13, -0.17], '#E6F7FF', 'gloss', segments=6),
      sph([0.05, 0.05, 0.05], [0.21, TOP + 0.13, -0.2], '#E6F7FF', 'gloss', segments=6),
      part('blob', [0.12, 0.17, 0.12], [0.3, TOP + 0.085, 0.05], '#E8B33C', 'satin', noise=0.1),      # pineapple
      cone([0.1, 0.12, 0.1], [0.3, TOP + 0.22, 0.05], '#4F9A3E', 'foliage', taper=0.0, segments=8),
      sph([0.07, 0.07, 0.07], [0.12, TOP + 0.035, 0.08], '#F2E05C', 'gloss', segments=10),             # lemons/limes
      sph([0.07, 0.07, 0.07], [0.06, TOP + 0.035, 0.1], '#8CC63F', 'gloss', segments=10),
      sph([0.08, 0.08, 0.08], [0.0, TOP + 0.04, 0.06], '#F28C28', 'gloss', segments=10)]
p += glass_with_drink(-0.08, TOP, 0.1, '#F07AA0') + glass_with_drink(-0.2, TOP, 0.08, '#F6C744') + glass_with_drink(-0.32, TOP, 0.1, '#7FD4C1')
p += [box([0.3, 0.2, 0.2], [-0.15, 0.415, -0.08], '#F2F2F0', 'satin', radius=0.03),             # mini fridge drawer
      box([0.12, 0.012, 0.012], [-0.15, 0.47, 0.025], CHROME, 'chrome', radius=0.004)]
for i, c in enumerate(('#F07AA0', '#7FD4C1', '#F6C744')):
    p.append(cyl([0.07, 0.24, 0.07], [0.12 + i * 0.09, 0.435, -0.12], c, 'gloss', taper=0.6))    # syrup bottles
E['model.cheerful.mocktailCart'] = {'type': 'model', 'placeholder': p}

# ---- Rainbow hammock (2x1): a striped sling on a curved wooden stand (low point 0.5 m) --------
STRIPES = ['#E4572E', '#F28C28', '#F6C744', '#8CC63F', '#3FA7D6', '#7B5EA7']
p = sling(-0.74, 0.74, 0.86, 0.48, 0.0, 0.62, STRIPES, segs=12)
p += [box([1.7, 0.07, 0.09], [0, 0.05, 0.0], '#C9905A', 'wood', radius=0.02)]                      # base beam
for s in (-1, 1):
    p += [rod([s * 0.8, 0.06, 0.0], [s * 0.9, 1.05, 0.0], 0.07, '#C9905A', 'wood', shape='box', radius=0.02),  # end posts
          box([0.08, 0.04, 0.6], [s * 0.88, 0.04, 0.0], '#C9905A', 'wood', radius=0.015),           # feet
          rod([s * 0.86, 1.0, 0.0], [s * 0.74, 0.86, -0.3], 0.012, '#EDE4D3', 'matte'),             # ropes
          rod([s * 0.86, 1.0, 0.0], [s * 0.74, 0.86, 0.3], 0.012, '#EDE4D3', 'matte'),
          box([0.04, 0.04, 0.66], [s * 0.74, 0.86, 0.0], '#B07A4A', 'wood', radius=0.012)]          # spreader bars
p += [cushion([0.42, 0.12, 0.3], [-0.55, 0.76, 0.0], WHITE, rotate=[0, 0, -25], radius=0.05),     # pillow
      cushion([0.5, 0.03, 0.4], [0.3, 0.5, 0.05], '#F6E3A0', rotate=[0, 15, 0], radius=0.012)]       # little throw
E['model.cheerful.rainbowHammock'] = {'type': 'model', 'placeholder': p}

# ---- Sunrise stretch lamp (1x1): big dawn disc on a slim stand, yoga mat in front ---------------
C = [0, 1.25, -0.3]
p = [cyl([0.3, 0.03, 0.3], [0, 0.015, -0.3], '#F2F2F0', 'gloss', segments=24),                # base
     rod([0, 0.03, -0.3], [0, 0.95, -0.3], 0.03, '#E9DCC7', 'metal'),
     cyl([0.76, 0.06, 0.76], C, '#F4F1EA', 'gloss', rotate=[90, 0, 0], segments=40),           # disc housing
     cyl([0.66, 0.065, 0.66], C, '#FFB347', 'gloss', rotate=[90, 0, 0], segments=40),          # glowing face
     cyl([0.5, 0.07, 0.5], C, '#FFCF6E', 'gloss', rotate=[90, 0, 0], segments=40),
     cyl([0.3, 0.075, 0.3], C, '#FFE7A8', 'gloss', rotate=[90, 0, 0], segments=32),
     torus([0.78, 0.03, 0.78], C, '#E9DCC7', 'metal', rotate=[90, 0, 0], segments=40),
     box([0.6, 0.012, 0.36], [0, 0.006, 0.14], '#F29E8E', 'matte', radius=0.004),              # yoga mat
     cyl([0.12, 0.6, 0.12], [0.0, 0.06, 0.38], '#E9876F', 'matte', rotate=[0, 0, 90]),           # rolled end
     part('blob', [0.66, 0.003, 0.5], [0, 0.002, 0.12], '#FFE1A8', 'gloss', noise=0.05)]           # warm light pool
E['model.cheerful.sunriseLamp'] = {'type': 'model', 'placeholder': p}

# ---- Party booth (2x2): horseshoe booth for two (Sims at x = +-0.5, z = 0), round table, lights ---
BOOTH, PIPING = '#F28D8D', '#F6C744'
p = [cushion([1.86, 0.4, 0.62], [0, 0.2, -0.05], '#E57B7B', radius=0.08),                      # seat base
     cushion([1.8, 0.1, 0.56], [0, 0.4, -0.04], BOOTH, radius=0.04),                            # seat (top 0.45)
     cushion([1.86, 0.62, 0.22], [0, 0.72, -0.42], BOOTH, rotate=[-8, 0, 0], radius=0.08),     # backrest
     box([1.86, 0.03, 0.24], [0, 1.04, -0.44], PIPING, 'satin', radius=0.012),
     box([1.9, 1.6, 0.06], [0, 0.8, -0.9], '#7A5FB8', 'satin', radius=0.02)]                    # back panel
for s in (-1, 1):
    p += [cushion([0.3, 0.72, 1.0], [s * 0.8, 0.36, 0.4], BOOTH, radius=0.08),                 # side wings
          box([0.3, 0.03, 1.0], [s * 0.8, 0.73, 0.4], PIPING, 'satin', radius=0.012)]
p += [lathe([0.62, 0.04, 0.62], [0, 0.72, 0.52], '#F4F4F2', 'gloss', [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], segments=32),  # table
      cyl([0.08, 0.68, 0.08], [0, 0.36, 0.52], BRASS, 'metal'),
      cyl([0.4, 0.03, 0.4], [0, 0.015, 0.52], BRASS, 'metal', segments=24),
      box([0.34, 0.22, 0.02], [0, 0.86, 0.6], '#2B2433', 'satin', radius=0.012, rotate=[12, 0, 0]),   # party screen
      box([0.31, 0.19, 0.003], on([0, 0.86, 0.6], [12, 0, 0], [0, 0, -0.012]), '#E84F9A', 'gloss', rotate=[12, 0, 0]),
      box([0.12, 0.012, 0.08], [0, 0.745, 0.62], '#2B2433', 'satin', radius=0.004)]
p += glass_with_drink(-0.18, 0.74, 0.42, '#F6C744') + glass_with_drink(0.18, 0.74, 0.42, '#7FD4C1')
p += [lathe([0.18, 0.06, 0.18], [0.12, 0.77, 0.62], '#F4F4F2', 'gloss', [[0, -0.5], [0.3, -0.5], [0.5, 0.5], [0.42, 0.5], [0.25, -0.3], [0, -0.3]]),  # popcorn bowl
      part('blob', [0.15, 0.06, 0.15], [0.12, 0.8, 0.62], '#FFF3C4', 'matte', noise=0.3)]
COLS = ['#F6C744', '#6EC1E4', '#F28D8D', '#8CC63F', '#B8A1E3', '#F28C28']
for i in range(13):                                                                                # marquee bulbs on the back panel
    x = -0.84 + i * 0.14
    p.append(sph([0.06, 0.06, 0.06], [x, 1.56, -0.86], COLS[i % 6], 'gloss', segments=8))
    p.append(sph([0.05, 0.05, 0.05], [x + 0.07, 1.3 + 0.06 * math.sin(i), -0.86], COLS[(i + 3) % 6], 'gloss', segments=8))
for i, (x, y) in enumerate([(-0.6, 1.0), (-0.3, 1.18), (0.1, 0.98), (0.45, 1.15), (0.7, 0.95), (-0.05, 1.4)]):
    p.append(box([0.05, 0.05, 0.01], [x, y, -0.865], COLS[i], 'gloss', radius=0.01, rotate=[0, 0, 30 * i]))  # confetti
E['model.cheerful.partyBooth'] = {'type': 'model', 'placeholder': p}

if __name__ == '__main__':
    sys.exit(1 if run('cheerful', E) else 0)
