# Energetic pack models (web/public/assets/packs/energetic/manifest.json).
# Run: python3 -I pack_energetic.py [--apply]
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import box, cyl, cone, sph, rod, part, lathe, torus, cushion, mat, on, CHROME  # noqa: E402
from pack_shapes import LIB, JAR, NET, BOWL, glass_with_drink, leafy, run  # noqa: E402

E = {}
WHITE, GREY, STEEL = '#F2F2F0', '#9EA3A8', '#C3C7CB'
ORANGE, TEAL, LIME, BLUE, CORAL = '#E8692E', '#3FA7A0', '#8CC63F', '#3A86FF', '#F2706B'
HOLDS = ['#E4572E', '#F2C14E', '#4CB5AE', '#7B5EA7', '#7FB800', '#F25F9C', '#3A86FF']

# ---- Bouldering wall (2x1): overhanging plywood panel with holds over a crash mat -----------------
LEAN = [12, 0, 0]                    # top leans 12 degrees towards +Z (overhang)
PIV = [0, 0.02, -0.38]               # wall foot
H = 2.3
p = [box([1.84, H, 0.04], on(PIV, LEAN, [0, H / 2, 0]), '#E3C79C', 'wood', radius=0.008, rotate=LEAN)]
for x in (-0.9, 0.9):                                                       # timber edges
    p.append(box([0.06, H, 0.08], on(PIV, LEAN, [x, H / 2, -0.015]), '#C9A274', 'wood', radius=0.01, rotate=LEAN))
p.append(box([1.86, 0.08, 0.08], on(PIV, LEAN, [0, H - 0.04, -0.015]), '#C9A274', 'wood', radius=0.01, rotate=LEAN))
for x in (-0.84, 0.84):                                                     # steel A-frame behind
    p += [box([0.06, 2.2, 0.06], [x, 1.1, -0.42], '#6C7A89', 'metal', radius=0.01),
          rod([x, 2.12, -0.42], on(PIV, LEAN, [x, H - 0.12, -0.05]), 0.05, '#6C7A89', 'metal', shape='box', radius=0.01),
          rod([x, 1.1, -0.42], on(PIV, LEAN, [x, 1.15, -0.05]), 0.045, '#6C7A89', 'metal', shape='box', radius=0.01)]
holds = [(-0.62, 0.35), (-0.18, 0.42), (0.35, 0.3), (0.7, 0.55), (-0.45, 0.75), (0.05, 0.8), (0.52, 0.95), (-0.75, 1.1),
         (-0.25, 1.2), (0.28, 1.3), (0.72, 1.42), (-0.55, 1.55), (0.0, 1.62), (0.45, 1.75), (-0.3, 1.95), (0.2, 2.05),
         (0.66, 2.1), (-0.7, 1.9)]
for i, (x, y) in enumerate(holds):
    c = HOLDS[i % len(HOLDS)]
    s = 0.07 + (i * 37 % 5) * 0.012
    p.append(part('blob', [s, s * 0.8, 0.05], on(PIV, LEAN, [x, y, 0.035]), c, 'satin', noise=0.25, rotate=LEAN))
for x, y, c in [(-0.1, 1.0, '#F2C14E'), (0.5, 1.95, '#4CB5AE'), (-0.6, 0.55, '#F25F9C')]:            # volumes
    p.append(box([0.22, 0.16, 0.1], on(PIV, LEAN, [x, y, 0.06]), c, 'satin', radius=0.03, rotate=[LEAN[0] - 25, 20, 0]))
p += [cushion([1.86, 0.22, 0.8], [0, 0.11, 0.04], '#2F6FA8', radius=0.06),                     # crash mat
      box([1.87, 0.02, 0.81], [0, 0.11, 0.04], '#F2C14E', 'fabric', radius=0.008),             # mat seam band
      cyl([0.12, 0.14, 0.12], [0.82, 0.29, 0.32], '#E8692E', 'fabric', taper=0.85),            # chalk bag
      box([0.2, 0.03, 0.12], [-0.7, 0.235, 0.3], '#F2F2F0', 'fabric', radius=0.01)]            # towel
E['model.energetic.boulderingWall'] = {'type': 'model', 'placeholder': p}

# ---- Spin bike (1x2): a recumbent trainer, so the seat matches the standard 0.45 m sitting height ---
p = [cushion([0.44, 0.09, 0.42], [0, 0.405, 0.0], '#2F3B4A', radius=0.035),                 # seat (top 0.45)
     cushion([0.42, 0.52, 0.09], [0, 0.72, -0.27], '#2F3B4A', rotate=[-18, 0, 0], radius=0.04),  # backrest
     box([0.46, 0.04, 0.3], [0, 0.34, -0.02], WHITE, 'gloss', radius=0.012),
     box([0.1, 0.3, 0.12], [0, 0.18, -0.02], WHITE, 'gloss', radius=0.02),                     # seat post
     rod([0, 0.06, -0.62], [0, 0.18, 0.62], 0.1, WHITE, 'gloss', shape='box', t2=0.12, radius=0.03),  # main beam
     box([0.6, 0.05, 0.08], [0, 0.025, -0.66], GREY, 'satin', radius=0.02),                    # rear stabiliser
     box([0.56, 0.05, 0.08], [0, 0.025, 0.86], GREY, 'satin', radius=0.02),                    # front stabiliser
     cyl([0.48, 0.16, 0.48], [0, 0.36, 0.66], WHITE, 'gloss', rotate=[0, 0, 90]),            # flywheel housing
     cyl([0.38, 0.17, 0.38], [0, 0.36, 0.66], ORANGE, 'satin', rotate=[0, 0, 90]),          # flywheel accent
     box([0.2, 0.32, 0.22], [0, 0.18, 0.66], WHITE, 'gloss', radius=0.04)]
for s in (-1, 1):
    p += [rod([s * 0.1, 0.36, 0.66], [s * 0.14, 0.26, 0.56], 0.025, STEEL, 'metal', shape='box'),   # cranks
          box([0.1, 0.025, 0.06], [s * 0.17, 0.26, 0.55], '#3A3D41', 'satin', radius=0.01),          # pedals
          rod([s * 0.24, 0.34, 0.12], [s * 0.24, 0.5, 0.12], 0.025, STEEL, 'metal'),                 # side grips
          rod([s * 0.24, 0.5, 0.12], [s * 0.24, 0.5, -0.12], 0.03, '#3A3D41', 'satin')]
p += [rod([0, 0.44, 0.72], [0, 1.0, 0.62], 0.05, WHITE, 'gloss', shape='box', t2=0.05, radius=0.015),  # console stalk
      box([0.42, 0.28, 0.04], [0, 1.08, 0.6], WHITE, 'satin', radius=0.02, rotate=[-35, 0, 0]),
      box([0.38, 0.23, 0.004], on([0, 1.08, 0.6], [-35, 0, 0], [0, 0, -0.022]), '#1E4F7A', 'gloss', rotate=[-35, 0, 0]),  # route screen
      box([0.2, 0.06, 0.003], on([0, 1.08, 0.6], [-35, 0, 0], [-0.05, 0.03, -0.0245]), '#7FB800', 'gloss', rotate=[-35, 0, 0]),
      rod([-0.22, 0.98, 0.56], [0.22, 0.98, 0.56], 0.03, '#3A3D41', 'satin'),                    # handlebar
      cyl([0.07, 0.18, 0.07], [0.2, 0.42, 0.78], BLUE, 'gloss')]                                  # bottle
E['model.energetic.spinBike'] = {'type': 'model', 'placeholder': p}

# ---- Trampoline (2x2) ------------------------------------------------------------------------
p = [torus([1.86, 0.1, 1.86], [0, 0.62, 0], '#2F8F83', 'fabric', segments=36),              # safety pad
     cyl([1.62, 0.02, 1.62], [0, 0.6, 0], '#4F6585', 'matte', segments=36),                     # jumping mat
     torus([1.7, 0.03, 1.7], [0, 0.585, 0], STEEL, 'metal', segments=36),                       # spring ring
     torus([1.84, 0.04, 1.84], [0, 0.56, 0], '#8A9096', 'metal', segments=36)]                   # frame
for i in range(6):
    a = math.radians(i * 60 + 30)
    x, z = math.cos(a) * 0.86, math.sin(a) * 0.86
    p += [rod([x * 1.02, 0.02, z * 1.02], [x, 0.56, z], 0.04, '#8A9096', 'metal')]
    nx, nz = math.cos(a + math.radians(30)) * 0.86, math.sin(a + math.radians(30)) * 0.86
    p.append(rod([x * 1.02, 0.03, z * 1.02], [nx * 1.02, 0.03, nz * 1.02], 0.035, '#8A9096', 'metal'))   # base ring
for x in (-0.12, 0.12):                                                                          # ladder at the front
    p.append(rod([x, 0.025, 0.93], [x, 0.56, 0.84], 0.03, '#8A9096', 'metal'))
for y in (0.18, 0.38):
    p.append(box([0.26, 0.025, 0.06], [0, y, 0.91 - (y / 0.56) * 0.1], '#3A3D41', 'satin', radius=0.008))
p += [sph([0.22, 0.22, 0.22], [0.35, 0.73, -0.2], ORANGE, 'gloss', segments=14)]               # ball
E['model.energetic.trampoline'] = {'type': 'model', 'placeholder': p}

# ---- Streetball hoop (1x1): weighted base at the back, board and rim towards the front ----------
p = [box([0.6, 0.22, 0.5], [0, 0.11, -0.2], '#2F5D8A', 'satin', radius=0.06),               # water base
     box([0.5, 0.02, 0.4], [0, 0.225, -0.2], '#3E73A8', 'satin', radius=0.01),
     cyl([0.12, 0.08, 0.12], [0.18, 0.26, -0.3], '#E8E8E5', 'satin'),                         # fill cap
     rod([0, 0.2, -0.3], [0, 2.32, -0.18], 0.09, '#7D858D', 'metal', shape='box', t2=0.09, radius=0.02),   # pole
     rod([0, 2.25, -0.2], [0, 2.4, -0.05], 0.06, '#7D858D', 'metal', shape='box', radius=0.015),
     box([0.86, 0.56, 0.04], [0, 2.55, -0.02], '#F4F4F2', 'gloss', radius=0.02),             # backboard
     box([0.86, 0.04, 0.045], [0, 2.81, -0.02], '#D7263D', 'satin', radius=0.01),              # border
     box([0.86, 0.04, 0.045], [0, 2.29, -0.02], '#D7263D', 'satin', radius=0.01),
     box([0.04, 0.56, 0.045], [-0.41, 2.55, -0.02], '#D7263D', 'satin', radius=0.01),
     box([0.04, 0.56, 0.045], [0.41, 2.55, -0.02], '#D7263D', 'satin', radius=0.01),
     box([0.3, 0.025, 0.045], [0, 2.6, -0.015], '#D7263D', 'satin', radius=0.005),             # target square
     box([0.3, 0.025, 0.045], [0, 2.42, -0.015], '#D7263D', 'satin', radius=0.005),
     box([0.025, 0.2, 0.045], [-0.14, 2.51, -0.015], '#D7263D', 'satin', radius=0.005),
     box([0.025, 0.2, 0.045], [0.14, 2.51, -0.015], '#D7263D', 'satin', radius=0.005),
     torus([0.46, 0.022, 0.46], [0, 2.4, 0.22], ORANGE, 'metal', segments=24),                 # rim
     box([0.1, 0.03, 0.06], [0, 2.4, 0.02], ORANGE, 'metal', radius=0.008),
     lathe([0.44, 0.34, 0.44], [0, 2.22, 0.22], '#F4F4F2', 'glass', NET, segments=18),         # net
     sph([0.24, 0.24, 0.24], [0.28, 0.12, 0.3], ORANGE, 'gloss', segments=14),                  # ball
     box([0.005, 0.24, 0.24], [0.28, 0.12, 0.3], '#3A2A20', 'matte', radius=0.002)]
E['model.energetic.streetballHoop'] = {'type': 'model', 'placeholder': p}

# ---- Power blender station (1x1): Kenney kitchen cabinet + blender, fruit and smoothies ----------
TOP = 0.9
parts = [
    box([0.18, 0.1, 0.16], [-0.18, TOP + 0.05, -0.12], WHITE, 'gloss', radius=0.03),          # blender motor base
    box([0.1, 0.02, 0.004], [-0.18, TOP + 0.05, -0.039], LIME, 'gloss', radius=0.004),
    lathe([0.15, 0.26, 0.15], [-0.18, TOP + 0.23, -0.12], '#E6F0F2', 'glass', JAR, segments=16),   # jar
    cyl([0.13, 0.15, 0.13], [-0.18, TOP + 0.18, -0.12], '#9BCB5A', 'gloss', taper=1.1),        # green smoothie
    cyl([0.12, 0.03, 0.12], [-0.18, TOP + 0.37, -0.12], '#3A3D41', 'satin'),                    # lid
    lathe([0.32, 0.1, 0.32], [0.16, TOP + 0.05, -0.1], '#C8956B', 'wood', [[0, -0.5], [0.3, -0.5], [0.45, -0.1], [0.5, 0.5], [0.45, 0.5], [0.38, 0.0], [0.25, -0.35], [0, -0.35]]),  # fruit bowl
    sph([0.08, 0.08, 0.08], [0.1, TOP + 0.1, -0.08], ORANGE, 'gloss', segments=10),
    sph([0.08, 0.08, 0.08], [0.2, TOP + 0.1, -0.13], '#D7263D', 'gloss', segments=10),
    sph([0.07, 0.07, 0.07], [0.15, TOP + 0.13, -0.05], LIME, 'gloss', segments=10),
    part('capsule', [0.045, 0.2, 0.045], [0.2, TOP + 0.12, -0.04], '#F2C94C', 'satin', rotate=[0, 30, 75]),  # banana
    box([0.26, 0.015, 0.16], [0.12, TOP + 0.008, 0.12], '#D9B98C', 'wood', radius=0.006),       # board
    sph([0.06, 0.03, 0.06], [0.08, TOP + 0.03, 0.12], '#F2E05C', 'satin', segments=10),        # lemon halves
    sph([0.06, 0.03, 0.06], [0.16, TOP + 0.03, 0.13], '#F2E05C', 'satin', segments=10),
] + glass_with_drink(-0.04, TOP, 0.12, '#F07AA0') + glass_with_drink(-0.32, TOP, 0.12, '#F2A93B')
E['model.energetic.powerBlender'] = {
    'type': 'model', 'url': LIB + 'kenney/kitchenCabinet.glb', 'fit': [0.82, 0.9, 0.6], 'align': 'back', 'offset': [0, 0, 0.04],
    'materials': {'wood': mat('satin', '#DDEFE6'), 'woodDark': mat('satin', '#CDE6DA'), 'metal': mat('gloss', '#F4F4F2')},
    'parts': parts, 'placeholder': [box([0.8, 0.9, 0.6], [0, 0.45, -0.16], '#DDEFE6', 'satin', radius=0.02)] + parts}

# ---- Contrast rain shower (1x1): Kenney cubicle, wide rain head, hot/cold dials -------------------
parts = [box([0.4, 0.025, 0.4], [0, 2.02, -0.02], CHROME, 'chrome', radius=0.01),             # square rain head
         box([0.36, 0.004, 0.36], [0, 2.005, -0.02], '#B9DDF0', 'gloss', radius=0.006),
         rod([0, 2.04, -0.4], [0, 2.04, -0.04], 0.03, CHROME, 'chrome'),                       # arm
         cyl([0.08, 0.03, 0.08], [-0.1, 1.15, -0.385], '#D9483B', 'gloss', rotate=[90, 0, 0]),  # hot dial
         cyl([0.08, 0.03, 0.08], [0.1, 1.15, -0.385], '#3A86FF', 'gloss', rotate=[90, 0, 0]),   # cold dial
         box([0.34, 0.12, 0.012], [0, 1.15, -0.395], '#E8E8E5', 'satin', radius=0.01),
         box([0.6, 0.012, 0.6], [0, 0.075, 0], '#7FC4C0', 'satin', radius=0.004),               # mint anti-slip mat
         box([0.04, 0.3, 0.14], [0.36, 1.25, -0.33], '#F2F2F0', 'fabric', radius=0.02)]         # towel
E['model.energetic.contrastShower'] = {
    'type': 'model', 'url': LIB + 'kenney/shower.glb', 'fit': [0.9, 2.15, 0.9], 'align': 'centre',
    'materials': {'carpetWhite': mat('gloss', '#EEF3F2'), 'metalDark': mat('metal', '#8E979E'), 'glass': mat('glass', '#D6E8EC'),
                  'metal': mat('chrome', CHROME)},
    'parts': parts, 'placeholder': [box([0.86, 0.1, 0.86], [0, 0.05, 0], '#EEF3F2', 'gloss', radius=0.02)] + parts}

# ---- Recovery pod (1x2): padded lounger (top 0.5) under a tinted canopy, head at -Z ---------------
p = [box([0.82, 0.3, 1.86], [0, 0.17, 0.0], WHITE, 'gloss', radius=0.12),                    # shell base
     box([0.84, 0.03, 1.88], [0, 0.04, 0.0], '#3FA7A0', 'satin', radius=0.012),                # glow strip
     cushion([0.68, 0.14, 1.66], [0, 0.43, 0.04], '#D8DDE2', radius=0.06),                      # mattress (top 0.5)
     cushion([0.5, 0.1, 0.3], [0, 0.53, -0.7], '#ECEFF2', radius=0.045),                        # headrest
     cushion([0.24, 0.12, 0.62], [-0.13, 0.54, 0.5], TEAL, radius=0.05),                        # compression boots
     cushion([0.24, 0.12, 0.62], [0.13, 0.54, 0.5], TEAL, radius=0.05),
     part('sphere', [0.8, 0.82, 1.0], [0, 0.42, -0.35], '#8FB9C9', 'glass', segments=20),       # tinted canopy
     torus([0.8, 0.03, 1.0], [0, 0.42, -0.35], WHITE, 'gloss', segments=32),                      # canopy rim
     box([0.06, 0.3, 0.3], [0.38, 0.5, 0.55], WHITE, 'gloss', radius=0.03),                     # control pod
     box([0.004, 0.16, 0.2], [0.413, 0.54, 0.55], '#1E4F7A', 'gloss', radius=0.004),
     box([0.004, 0.03, 0.12], [0.414, 0.6, 0.55], '#7FE0D8', 'gloss', radius=0.002)]
E['model.energetic.recoveryPod'] = {'type': 'model', 'placeholder': p}

if __name__ == '__main__':
    sys.exit(1 if run('energetic', E) else 0)
