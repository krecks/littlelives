# Lazy pack models (web/public/assets/packs/lazy/manifest.json).
# Run: python3 -I pack_lazy.py [--apply]
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import box, cyl, cone, sph, rod, part, lathe, torus, cushion, mat, on, CHROME  # noqa: E402
from pack_shapes import LIB, JAR, BOWL, glass_with_drink, leafy, run  # noqa: E402

E = {}
CLOUD, LILAC, SKY, BLUSH = '#F7F7FA', '#CFC6EA', '#B7CDEA', '#F2C6CF'
OAK, BIRCH = '#CDB08A', '#E3CFA8'

# ---- Snoozecloud bed (2x2): two Sims lie side by side, mattress top 0.5, head at -Z --------------
p = [cushion([1.86, 0.26, 1.86], [0, 0.15, 0.0], '#E9E4F4', radius=0.11),                    # puffy base
     cushion([1.74, 0.2, 1.7], [0, 0.39, 0.08], CLOUD, radius=0.09),                            # mattress (top ~0.5)
     cushion([1.8, 0.12, 1.12], [0, 0.5, 0.37], SKY, radius=0.06),                               # duvet
     cushion([1.81, 0.06, 0.2], [0, 0.535, -0.24], '#FFFFFF', radius=0.03),                      # sheet fold
     cushion([1.82, 0.05, 0.5], [0, 0.565, 0.62], LILAC, radius=0.025)]                          # throw
for i, (x, y, s) in enumerate([(-0.66, 0.62, 0.48), (-0.34, 0.78, 0.58), (0.0, 0.84, 0.62), (0.34, 0.78, 0.58),
                               (0.66, 0.62, 0.48), (-0.52, 1.0, 0.44), (0.5, 1.0, 0.46), (0.0, 1.12, 0.42)]):
    p.append(sph([s, s * 0.82, 0.26], [x, y, -0.76], CLOUD if i % 3 else '#EEE8F8', 'satin', segments=16))  # cloud headboard
for s in (-1, 1):
    p += [cushion([0.68, 0.18, 0.4], [s * 0.42, 0.58, -0.6], '#FFFFFF', radius=0.08),           # pillows
          cushion([0.44, 0.3, 0.12], [s * 0.36, 0.66, -0.4], BLUSH if s < 0 else LILAC, rotate=[-18, 0, 0], radius=0.05),
          box([0.12, 0.12, 0.12], [s * 0.82, 0.06, 0.82], BIRCH, 'wood', radius=0.03)]           # feet
p += [box([0.14, 0.03, 0.08], [0.82, 0.56, 0.2], '#F2F2F0', 'gloss', radius=0.012),             # remote
      box([0.05, 0.005, 0.02], [0.82, 0.578, 0.2], '#7FB3E8', 'gloss', radius=0.002)]
E['model.lazy.snoozecloudBed'] = {'type': 'model', 'placeholder': p}

# ---- Nap pod (1x1): egg chair opening to the front, seat top 0.45 ------------------------------
SHELL = [[0.0, -0.5], [0.32, -0.42], [0.46, -0.22], [0.5, 0.0], [0.49, 0.12], [0.45, 0.12], [0.46, 0.0], [0.42, -0.2],
         [0.3, -0.36], [0.0, -0.43]]           # half-egg shell, open at the top (rotated to face the front)
p = [lathe([0.9, 0.86, 1.08], [0, 0.72, 0.0], '#F4F4F2', 'gloss', SHELL, rotate=[72, 0, 0], segments=32),  # shell
     cushion([0.62, 0.12, 0.52], [0, 0.39, 0.02], '#7E95B8', radius=0.05),                       # seat (top 0.45)
     cushion([0.6, 0.62, 0.14], [0, 0.72, -0.3], '#8FA6C6', rotate=[-10, 0, 0], radius=0.06),   # back cushion
     cushion([0.26, 0.2, 0.14], [0.18, 0.56, -0.12], '#F2C6CF', rotate=[-20, 20, 0], radius=0.05),
     cyl([0.12, 0.2, 0.12], [0, 0.12, -0.04], CHROME, 'chrome', taper=0.7),                       # stem
     cyl([0.56, 0.04, 0.56], [0, 0.02, -0.04], CHROME, 'chrome', segments=28),                    # base disc
     part('blob', [0.5, 0.05, 0.3], [0, 0.03, 0.24], '#E6DCCB', 'fabric', noise=0.08)]          # shaggy rug
E['model.lazy.napPod'] = {'type': 'model', 'placeholder': p}

# ---- Heated quilt table (2x1): kotatsu in front, two poufs at the centre line (seat top 0.45) -----
QUILT = '#C96A5B'
p = [cushion([1.7, 0.58, 0.44], [0, 0.3, 0.23], QUILT, radius=0.08),                           # quilt draped to the floor
     box([1.6, 0.012, 0.3], [0, 0.6, 0.23], '#E8B07A', 'fabric', radius=0.004),                 # quilt top band
     box([1.74, 0.035, 0.42], [0, 0.625, 0.23], OAK, 'wood', radius=0.012),                      # table top
     lathe([0.28, 0.08, 0.28], [0, 0.68, 0.25], '#F2EEE6', 'gloss', BOWL, segments=16)]          # fruit bowl
for dx, dz in ((-0.05, 0.22), (0.05, 0.27), (0.0, 0.3), (-0.02, 0.2)):
    p.append(sph([0.07, 0.065, 0.07], [dx, 0.715, dz], '#F28C28', 'gloss', segments=10))       # mandarins
for s in (-1, 1):
    x = s * 0.5
    p += [cushion([0.5, 0.4, 0.46], [x, 0.21, -0.12], '#E8D7B8', radius=0.15),                   # pouf (top ~0.41)
          cushion([0.46, 0.06, 0.44], [x, 0.43, -0.12], '#F3E7CF', radius=0.03),                 # cushion (top 0.45)
          cushion([0.44, 0.3, 0.1], [x, 0.6, -0.37], '#B9C7A8' if s < 0 else '#C9B8D8', rotate=[-12, 0, 0], radius=0.05),
          cyl([0.09, 0.09, 0.09], [x + s * 0.12, 0.687, 0.16], '#F2F2F0', 'gloss')]               # tea mugs
p += [box([0.2, 0.012, 0.14], [0.6, 0.65, 0.32], '#F2F2F0', 'satin', radius=0.004),           # snack plate
      sph([0.05, 0.025, 0.05], [0.58, 0.66, 0.31], '#E8C27A', 'satin', segments=8),
      sph([0.05, 0.025, 0.05], [0.63, 0.66, 0.34], '#E8C27A', 'satin', segments=8)]
E['model.lazy.quiltTable'] = {'type': 'model', 'placeholder': p}

# ---- Delivery locker (1x1): smart parcel lockers with a touch screen and an order waiting --------
BODY, DOOR, ACC = '#EEF2F0', '#CFE7DC', '#F28C28'
p = [box([0.86, 1.86, 0.44], [0, 0.93, -0.22], BODY, 'satin', radius=0.02)]
for col, x in enumerate((-0.28, 0.0, 0.28)):
    for row, (y, h) in enumerate(((0.32, 0.5), (0.86, 0.5), (1.4, 0.5))):
        if col == 1 and row == 1: continue
        p.append(box([0.26, h - 0.03, 0.02], [x, y, 0.005], DOOR if (col + row) % 2 else '#DCEFE6', 'satin', radius=0.008))
        p.append(box([0.012, 0.08, 0.02], [x + 0.1, y, 0.02], '#8A9096', 'metal', radius=0.004))
        p.append(sph([0.016, 0.016, 0.008], [x - 0.09, y + h / 2 - 0.07, 0.018], '#7FB800' if (row + col) % 3 else ACC, 'gloss', segments=6))
p += [box([0.26, 0.47, 0.03], [0.0, 0.86, 0.008], '#2B3440', 'satin', radius=0.012),          # screen bezel
      box([0.22, 0.3, 0.004], [0.0, 0.92, 0.025], '#2E7DB8', 'gloss', radius=0.006),           # touch screen
      box([0.18, 0.05, 0.003], [0.0, 0.98, 0.028], '#F2F2F0', 'gloss', radius=0.003),
      box([0.08, 0.08, 0.003], [0.0, 0.85, 0.028], ACC, 'gloss', radius=0.01),
      box([0.86, 0.1, 0.46], [0, 1.91, -0.21], ACC, 'satin', radius=0.02),                     # roof band
      box([0.4, 0.06, 0.004], [0, 1.91, 0.022], '#FFFFFF', 'gloss', radius=0.004),             # logo strip
      box([0.32, 0.22, 0.24], [0.2, 0.11, 0.24], '#C8A27A', 'matte', radius=0.008),            # parcel
      box([0.33, 0.02, 0.05], [0.2, 0.2, 0.24], '#E9DFC8', 'matte', radius=0.004),
      box([0.22, 0.26, 0.14], [-0.22, 0.13, 0.22], '#F2EEE6', 'matte', radius=0.02),           # takeout bag
      box([0.12, 0.08, 0.004], [-0.22, 0.16, 0.292], '#D7263D', 'matte', radius=0.004)]
E['model.lazy.deliveryLocker'] = {'type': 'model', 'placeholder': p}

# ---- Vibration plate (1x1) ----------------------------------------------------------------------
LIME = '#9BD45A'
p = [box([0.62, 0.14, 0.6], [0, 0.07, 0.1], '#F2F2F0', 'gloss', radius=0.05),                  # base
     box([0.52, 0.02, 0.46], [0, 0.15, 0.12], '#3D4A57', 'matte', radius=0.02),                 # grip pad
     box([0.5, 0.004, 0.44], [0, 0.161, 0.12], '#4C5B6A', 'matte', radius=0.02),
     box([0.64, 0.02, 0.62], [0, 0.03, 0.1], LIME, 'satin', radius=0.01),                       # accent band
     rod([0, 0.12, -0.22], [0, 1.0, -0.3], 0.09, '#F2F2F0', 'gloss', shape='box', t2=0.07, radius=0.02),  # column
     box([0.5, 0.06, 0.1], [0, 1.02, -0.27], '#F2F2F0', 'gloss', radius=0.03),                  # handlebar
     box([0.08, 0.07, 0.1], [-0.23, 1.02, -0.25], LIME, 'satin', radius=0.03),
     box([0.08, 0.07, 0.1], [0.23, 1.02, -0.25], LIME, 'satin', radius=0.03),
     box([0.22, 0.14, 0.04], [0, 1.1, -0.28], '#2B3440', 'satin', radius=0.02, rotate=[-30, 0, 0]),
     box([0.18, 0.08, 0.003], on([0, 1.1, -0.28], [-30, 0, 0], [0, 0, 0.022]), '#6CC3F0', 'gloss', rotate=[-30, 0, 0]),
     cyl([0.07, 0.2, 0.07], [0.3, 0.1, -0.3], '#7FC4E8', 'gloss')]                                # water bottle
E['model.lazy.vibePlate'] = {'type': 'model', 'placeholder': p}

# ---- Smart hub (1x1): Poly Haven side table with a smart speaker, tablet dock and smart bulb -----
parts = [cyl([0.13, 0.2, 0.13], [-0.12, 0.7, -0.22], '#BFC3C7', 'fabric', segments=20),      # smart speaker
         torus([0.13, 0.012, 0.13], [-0.12, 0.8, -0.22], '#4FD1C5', 'gloss', segments=20),     # glowing ring
         cyl([0.12, 0.012, 0.12], [-0.12, 0.806, -0.22], '#2B3440', 'satin', segments=20),
         box([0.2, 0.02, 0.1], [0.12, 0.61, -0.2], '#F2F2F0', 'satin', radius=0.008),           # dock
         box([0.26, 0.18, 0.012], [0.12, 0.7, -0.2], '#2B3440', 'satin', radius=0.012, rotate=[-15, 0, 0]),  # tablet
         box([0.23, 0.15, 0.003], on([0.12, 0.7, -0.2], [-15, 0, 0], [0, 0, 0.007]), '#3C8DBF', 'gloss', rotate=[-15, 0, 0]),
         box([0.07, 0.05, 0.003], on([0.12, 0.7, -0.2], [-15, 0, 0], [-0.06, 0.03, 0.009]), '#F2C14E', 'gloss', rotate=[-15, 0, 0]),
         box([0.07, 0.05, 0.003], on([0.12, 0.7, -0.2], [-15, 0, 0], [0.04, 0.03, 0.009]), '#7FB800', 'gloss', rotate=[-15, 0, 0]),
         cyl([0.2, 0.06, 0.2], [0.0, 0.03, 0.26], '#F2F2F0', 'gloss', segments=24),             # robot vacuum
         cyl([0.06, 0.012, 0.06], [0.0, 0.066, 0.26], '#4FD1C5', 'gloss', segments=12)]
E['model.lazy.smartHub'] = {
    'type': 'model', 'url': LIB + 'ph/side_table_01.glb', 'fit': [0.6, 0.6, 0.44], 'align': 'back', 'offset': [0, 0, 0.04],
    'parts': parts, 'placeholder': [box([0.6, 0.6, 0.44], [0, 0.3, -0.24], OAK, 'wood', radius=0.02)] + parts}

if __name__ == '__main__':
    sys.exit(1 if run('lazy', E) else 0)
