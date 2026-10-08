# Neat pack models (web/public/assets/packs/neat/manifest.json): crisp whites, birch and soft pastels.
# Conventions: see pack_foodie.py. Run: python3 -I pack_neat.py [out.json] && python3 -I apply_pack.py neat out.json
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, mat, gltf, placeholder,  # noqa: E402
                       WHITE, OAK, OAKD, BIRCH, CHROME, TEAL, MUSTARD, SAGE)
from pack_foodie import run  # noqa: E402

LIB = '../../models/'
E, FOOT = {}, {}
W = '#F4F3EF'
PASTEL = ['#9FD3C7', '#F2C6A0', '#B8C9E8', '#E9D58A', '#D9B8D6', '#A8D5A2']
CORAL = '#E8846B'


def towels(x, z, y, n, w=0.26, d=0.2, colors=PASTEL):
    out = []
    for i in range(n):
        out.append(cushion([w, 0.045, d], [x, y + 0.0225 + i * 0.047, z], colors[i % len(colors)], radius=0.018))
    return out


def bottle(x, z, y, c, h=0.22, d=0.08):
    return [lathe([d, h, d], [x, y + h / 2, z], c, 'gloss', [[0, -0.5], [0.5, -0.5], [0.5, 0.25], [0.22, 0.4], [0.22, 0.5], [0, 0.5]], segments=12),
            cyl([d * 0.42, 0.03, d * 0.42], [x, y + h + 0.015, z], W, 'satin', segments=10)]


# ---- steamMopDock (1x1): slim white dock tower with a docked steam mop, refills and a bucket ----
def steam_mop_dock():
    p = [box([0.42, 1.25, 0.2], [0, 0.625, -0.34], W, 'satin', radius=0.03),                     # dock tower
         box([0.36, 0.3, 0.012], [0, 1.0, -0.234], '#DDEFF0', 'gloss', radius=0.01),           # status panel
         box([0.1, 0.012, 0.004], [-0.08, 1.06, -0.227], TEAL, 'gloss', radius=0.003),
         box([0.16, 0.012, 0.004], [0.04, 1.02, -0.227], TEAL, 'gloss', radius=0.003),
         sph([0.03, 0.03, 0.01], [0.12, 0.94, -0.228], '#6CC27A', 'gloss', segments=6),
         box([0.44, 0.04, 0.34], [0, 0.02, -0.28], '#DADCDC', 'satin', radius=0.01),           # base plate
         box([0.38, 0.02, 0.12], [0, 0.55, -0.18], OAK, 'wood', radius=0.006)]                 # refill shelf
    for i, c in enumerate(('#9FD3C7', '#B8C9E8', '#9FD3C7')):
        p += bottle(-0.12 + i * 0.12, -0.18, 0.56, c, h=0.16, d=0.07)
    # the mop docked against the tower
    p += [cyl([0.03, 1.05, 0.03], [0.02, 0.62, -0.2], '#E2E4E4', 'satin', segments=10),         # pole
          box([0.14, 0.05, 0.04], [0.02, 1.16, -0.2], TEAL, 'gloss', radius=0.02),              # grip
          box([0.11, 0.3, 0.1], [0.02, 0.32, -0.17], TEAL, 'gloss', radius=0.04),               # water tank
          box([0.34, 0.06, 0.14], [0.02, 0.05, -0.12], '#E2E4E4', 'satin', radius=0.03),        # mop head
          box([0.32, 0.02, 0.13], [0.02, 0.015, -0.12], '#F7F7F7', 'fabric', radius=0.01)]      # microfibre pad
    # bucket + spare pads
    p += [lathe([0.28, 0.26, 0.28], [-0.28, 0.13, 0.12], '#9FD3C7', 'satin',
                [[0, -0.5], [0.42, -0.5], [0.5, 0.5], [0.46, 0.5], [0.38, -0.4], [0, -0.4]], segments=18),
          torus([0.26, 0.012, 0.26], [-0.28, 0.27, 0.12], '#E2E4E4', 'satin', rotate=[0, 0, 70], segments=16),
          box([0.22, 0.02, 0.14], [0.28, 0.01, 0.15], '#F7F7F7', 'fabric', radius=0.01),
          box([0.22, 0.02, 0.14], [0.28, 0.03, 0.15], '#B8C9E8', 'fabric', radius=0.01)]
    return placeholder(p)


E['model.neat.steamMopDock'] = steam_mop_dock(); FOOT['model.neat.steamMopDock'] = (1, 1)


# ---- laundryCenter (2x1): stacked washer/dryer (Kenney, restyled) + folding counter, rail -------
def laundry_center():
    cx = 0.45
    p = [box([0.9, 0.9, 0.56], [cx, 0.45, -0.17], W, 'satin', radius=0.012),                       # counter cabinet
         box([0.94, 0.04, 0.58], [cx, 0.92, -0.155], OAK, 'wood', radius=0.01)]                   # birch-oak top
    p = p[1:] + [box([0.9, 0.04, 0.56], [cx, 0.42, -0.17], W, 'satin', radius=0.006)]            # open cubbies: shelf
    for x in (cx - 0.44, cx, cx + 0.44):
        p.append(box([0.03, 0.88, 0.56], [x, 0.45, -0.17], W, 'satin', radius=0.006))
    p += [box([0.9, 0.04, 0.56], [cx, 0.02, -0.17], W, 'satin', radius=0.006),
          box([0.9, 0.88, 0.02], [cx, 0.45, -0.44], '#E6E5E0', 'matte', radius=0.004)]
    p += towels(cx - 0.22, -0.14, 0.44, 4) + towels(cx + 0.22, -0.14, 0.44, 3, colors=['#F7F7F7', '#B8C9E8', '#F7F7F7'])
    # lower cubbies: woven baskets
    for x, c in ((cx - 0.22, '#D8C29C'), (cx + 0.22, '#CDB48A')):
        p.append(cushion([0.34, 0.3, 0.42], [x, 0.19, -0.16], c, radius=0.04))
    # on the counter: neatly folded stack, detergent bottles, iron on a mini board
    p += towels(cx - 0.18, -0.2, 0.94, 3, w=0.3, d=0.22, colors=['#F7F7F7', '#9FD3C7', '#F7F7F7'])
    p += bottle(cx + 0.32, -0.3, 0.94, '#9FD3C7', h=0.24) + bottle(cx + 0.2, -0.34, 0.94, '#B8C9E8', h=0.2)
    p += [box([0.42, 0.02, 0.2], [cx + 0.12, 0.95, 0.02], '#B8C9E8', 'fabric', radius=0.02),
          lathe([0.12, 0.08, 0.2], [cx + 0.12, 0.995, 0.02], W, 'gloss',                        # iron
                [[0, -0.5], [0.5, -0.5], [0.4, 0.2], [0, 0.5]], segments=3, rotate=[0, 0, 0])]
    # hanging rail over the counter with shirts on hangers
    p += [cyl([0.02, 0.86, 0.02], [cx, 1.72, -0.29], CHROME, 'chrome', rotate=[0, 0, 90], segments=8),
          cyl([0.02, 0.8, 0.02], [cx - 0.42, 1.32, -0.31], CHROME, 'chrome', segments=8),
          cyl([0.02, 0.8, 0.02], [cx + 0.42, 1.32, -0.31], CHROME, 'chrome', segments=8)]
    for i, c in enumerate(('#B8C9E8', '#F7F7F7', '#F2C6A0', '#A8D5A2')):
        x = cx - 0.27 + i * 0.18
        p += [box([0.05, 0.03, 0.015], [x, 1.7, -0.29], OAK, 'wood', radius=0.005),
              box([0.3, 0.42, 0.04], [x, 1.46, -0.29], c, 'fabric', radius=0.03, rotate=[0, 70, 0])]
    # Kenney washerDryerStacked: metalLight = body, metalMedium = trims, metalDark = displays,
    # metal = porthole rings, glass = portholes, _defaultMat = details.
    fb = [box([0.68, 1.72, 0.6], [-0.56, 0.86, -0.15], W, 'gloss', radius=0.02)] + p
    return gltf(LIB + 'kenney/washerDryerStacked.glb', [0.68, 1.72, 0.62], {
        'metalLight': mat('gloss', '#F7F7F5'), 'metalMedium': mat('satin', '#D5D7D8'), 'metalDark': mat('gloss', '#2E3A46'),
        'metal': mat('chrome', CHROME), 'glass': mat('glass', '#C9E0E8'), '_defaultMat': mat('satin', '#C3C6C8')},
        align='back', offset=[-0.56, 0, 0.045], parts=p, placeholder=fb, footprint=(2, 1))


E['model.neat.laundryCenter'] = laundry_center(); FOOT['model.neat.laundryCenter'] = (2, 1)


# ---- rainShowerTower (1x1): glass enclosure (Kenney shower) with a ceiling rain head, steam
#      column and a teak bench ---------------------------------------------------------------------
def rain_shower_tower():
    p = [box([0.44, 0.02, 0.44], [0, 2.09, 0.0], CHROME, 'chrome', radius=0.01),                  # rain head
         box([0.4, 0.004, 0.4], [0, 2.078, 0.0], '#B9BDC1', 'metal', radius=0.008),
         cyl([0.03, 0.06, 0.03], [0, 2.13, 0.0], CHROME, 'chrome', segments=8),
         box([0.03, 0.03, 0.42], [0, 2.15, -0.21], CHROME, 'chrome', radius=0.008),           # arm to the back
         box([0.16, 1.2, 0.04], [-0.24, 1.15, -0.4], '#E9E7E2', 'gloss', radius=0.01),        # steam column
         box([0.2, 0.12, 0.012], [0.22, 1.25, -0.415], '#1F2A33', 'gloss', radius=0.01),      # control panel
         box([0.12, 0.04, 0.004], [0.22, 1.27, -0.408], TEAL, 'gloss', radius=0.004)]
    for k in range(5):
        p.append(cyl([0.04, 0.01, 0.04], [-0.24, 0.75 + k * 0.18, -0.378], CHROME, 'chrome', rotate=[90, 0, 0], segments=10))  # jets
    # teak bench along the back, towel and a plant
    p += [box([0.72, 0.04, 0.28], [0.0, 0.45, -0.24], '#B07A4A', 'wood', radius=0.01)]
    for x in (-0.3, 0.3):
        p.append(box([0.04, 0.43, 0.24], [x, 0.215, -0.24], '#B07A4A', 'wood', radius=0.008))
    p += towels(0.2, -0.26, 0.47, 2, w=0.24, d=0.2, colors=['#F7F7F7', '#9FD3C7'])
    p += bottle(-0.22, -0.3, 0.47, '#F2C6A0', h=0.16, d=0.06) + bottle(-0.12, -0.3, 0.47, '#B8C9E8', h=0.18, d=0.06)
    fb = [box([0.9, 0.06, 0.9], [0, 0.03, 0], W, 'gloss', radius=0.02)] + p
    return gltf(LIB + 'kenney/shower.glb', [0.9, 2.18, 0.9], {
        'carpetWhite': mat('satin', W), 'metalDark': mat('chrome', CHROME), 'glass': mat('glass', '#DCE8EA'),
        'metal': mat('chrome', CHROME)}, align='centre', parts=p, placeholder=fb)


E['model.neat.rainShowerTower'] = rain_shower_tower(); FOOT['model.neat.rainShowerTower'] = (1, 1)


# ---- organizerDesk (2x1, sit at the centre facing +Z): white desk with a cubby hutch along the
#      front edge (labelled bins facing the Sim), label maker, ledger ------------------------------
def organizer_desk():
    p = [box([1.6, 0.035, 0.34], [0, 0.745, 0.28], BIRCH, 'wood', radius=0.008)]                 # desk top (near edge 0.11)
    for x in (-0.78, 0.78):
        p += [box([0.04, 0.73, 0.32], [x, 0.365, 0.28], W, 'satin', radius=0.008)]
    p += [box([1.56, 0.6, 0.015], [0, 0.42, 0.44], BIRCH, 'wood', radius=0.004)]                  # modesty panel (room side)
    # hutch: 2 rows x 5 cubbies, open toward the Sim
    HZ, HD = 0.37, 0.16
    p += [box([1.6, 0.02, HD], [0, 1.22, HZ], W, 'satin', radius=0.006),
          box([1.6, 0.02, HD], [0, 0.99, HZ], W, 'satin', radius=0.006),
          box([1.6, 0.5, 0.012], [0, 1.0, HZ + HD / 2 - 0.006], BIRCH, 'wood', radius=0.004)]
    for i in range(6):
        p.append(box([0.02, 0.48, HD], [-0.79 + i * 0.316, 1.0, HZ], W, 'satin', radius=0.004))
    for r, y in enumerate((0.765, 1.0)):
        for i in range(5):
            x = -0.632 + i * 0.316
            c = PASTEL[(i + r * 2) % len(PASTEL)]
            p += [box([0.27, 0.19, HD - 0.02], [x, y + 0.105, HZ + 0.005], c, 'satin', radius=0.02),   # bins
                  box([0.1, 0.04, 0.004], [x, y + 0.14, HZ - HD / 2 + 0.004], W, 'matte', radius=0.004)]  # labels
    # desk surface: ledger, label maker, pen cup, calculator, tape
    p += [box([0.36, 0.02, 0.24], [0.12, 0.773, 0.22], '#3E6E73', 'satin', radius=0.006),
          box([0.33, 0.012, 0.21], [0.12, 0.789, 0.22], '#F6F3EA', 'matte', radius=0.004),
          box([0.008, 0.002, 0.2], [0.12, 0.796, 0.22], '#3E6E73', 'matte'),
          box([0.1, 0.05, 0.16], [-0.35, 0.79, 0.22], '#E8846B', 'gloss', radius=0.02),        # label maker
          box([0.06, 0.004, 0.08], [-0.35, 0.816, 0.2], '#2E3A46', 'gloss', radius=0.004),
          cyl([0.08, 0.11, 0.08], [0.55, 0.818, 0.32], SAGE, 'satin', segments=12),
          box([0.12, 0.015, 0.16], [-0.6, 0.77, 0.22], '#D5D7D8', 'satin', radius=0.01)]
    for dx in (-0.015, 0.0, 0.018):
        p.append(cyl([0.01, 0.16, 0.01], [0.55 + dx, 0.89, 0.32 + dx], [MUSTARD, TEAL, CORAL][int((dx + 0.015) * 60) % 3], 'satin', segments=6))
    # chair (seat top 0.45)
    p += [cushion([0.46, 0.06, 0.44], [0, 0.42, -0.12], '#B8C9E8', radius=0.025),
          cushion([0.44, 0.34, 0.06], [0, 0.72, -0.33], '#B8C9E8', rotate=[-6, 0, 0], radius=0.025)]
    for dx in (-0.2, 0.2):
        for dz in (-0.3, 0.06):
            p.append(cyl([0.03, 0.39, 0.03], [dx, 0.195, dz], OAK, 'wood', taper=0.8, segments=8))
    p += [box([0.03, 0.3, 0.03], [-0.2, 0.55, -0.32], OAK, 'wood', radius=0.008),
          box([0.03, 0.3, 0.03], [0.2, 0.55, -0.32], OAK, 'wood', radius=0.008)]
    return placeholder(p)


E['model.neat.organizerDesk'] = organizer_desk(); FOOT['model.neat.organizerDesk'] = (2, 1)


# ---- robotVacuumDock (1x1): self-emptying dock tower, the robot out on a round rug -------------
def robot_vacuum_dock():
    p = [cyl([0.86, 0.012, 0.86], [0, 0.006, 0.0], '#D5D7D8', 'fabric', segments=32),           # round rug
         cyl([0.7, 0.014, 0.7], [0, 0.007, 0.0], '#E6E5E0', 'fabric', segments=32),
         box([0.38, 0.46, 0.24], [0, 0.23, -0.31], W, 'gloss', radius=0.05),                     # dock tower
         box([0.3, 0.2, 0.012], [0, 0.32, -0.186], '#DDEFF0', 'glass', radius=0.03),             # dust bin window
         box([0.2, 0.12, 0.01], [0, 0.32, -0.192], '#B9BDC1', 'matte', radius=0.02),
         box([0.36, 0.02, 0.14], [0, 0.03, -0.14], '#DADCDC', 'satin', radius=0.01),            # ramp
         sph([0.03, 0.03, 0.01], [0.13, 0.42, -0.19], '#6CC27A', 'gloss', segments=6)]
    # the robot: disc body, bumper, lidar turret, LED ring
    rx, rz = 0.06, 0.16
    p += [lathe([0.36, 0.09, 0.36], [rx, 0.06, rz], '#E9E7E2', 'gloss',
                [[0, -0.5], [0.46, -0.5], [0.5, -0.2], [0.5, 0.3], [0.46, 0.5], [0, 0.5]], segments=28),
          torus([0.34, 0.02, 0.34], [rx, 0.106, rz], TEAL, 'gloss', segments=28),
          cyl([0.09, 0.035, 0.09], [rx, 0.123, rz - 0.06], '#3A4250', 'satin', segments=16),
          box([0.22, 0.04, 0.03], [rx, 0.05, rz + 0.17], '#3A4250', 'satin', radius=0.015),
          cyl([0.08, 0.004, 0.08], [rx + 0.12, 0.02, rz + 0.12], '#9EA3A8', 'metal', segments=8)]   # side brush
    # small plant beside the dock to give it height
    p += [lathe([0.18, 0.2, 0.18], [0.31, 0.1, -0.31], W, 'satin',
                [[0, -0.5], [0.4, -0.5], [0.5, 0.5], [0, 0.5]], segments=16),
          part('blob', [0.22, 0.3, 0.22], [0.31, 0.34, -0.31], '#6FA35A', 'foliage', noise=0.2)]
    return placeholder(p)


E['model.neat.robotVacuumDock'] = robot_vacuum_dock(); FOOT['model.neat.robotVacuumDock'] = (1, 1)


# ---- entryConsole (1x1): slim birch console, shoe shelf, key tray, tulips, leaning mirror ------
def entry_console():
    p = [box([0.86, 0.035, 0.3], [0, 0.8, -0.28], BIRCH, 'wood', radius=0.008),
         box([0.82, 0.025, 0.26], [0, 0.22, -0.28], BIRCH, 'wood', radius=0.006)]               # shoe shelf
    for x in (-0.41, 0.41):
        for z in (-0.41, -0.15):
            p.append(box([0.03, 0.79, 0.03], [x, 0.395, z], W, 'satin', radius=0.008))
    # shoes, neatly paired
    for i, c in enumerate(('#B33A32', '#3E6E73', '#E9D58A')):
        x = -0.27 + i * 0.27
        for dx in (-0.045, 0.045):
            p += [cushion([0.075, 0.07, 0.22], [x + dx, 0.267, -0.27], c, radius=0.03),
                  box([0.075, 0.015, 0.22], [x + dx, 0.24, -0.27], '#F4F3EF', 'satin', radius=0.006)]
    # top: key tray, keys, bowl, vase with tulips
    p += [box([0.2, 0.02, 0.12], [-0.2, 0.828, -0.26], OAKD, 'wood', radius=0.01),
          torus([0.04, 0.006, 0.04], [-0.22, 0.842, -0.26], '#C9A24A', 'metal', segments=10),
          box([0.05, 0.004, 0.012], [-0.18, 0.84, -0.25], '#C9A24A', 'metal', radius=0.002),
          lathe([0.16, 0.06, 0.16], [0.02, 0.85, -0.27], '#E9E7E2', 'gloss',
                [[0, -0.5], [0.3, -0.5], [0.5, 0.5], [0.45, 0.5], [0, -0.2]], segments=16),
          lathe([0.12, 0.22, 0.12], [0.28, 0.93, -0.3], '#B8C9E8', 'gloss',
                [[0, -0.5], [0.4, -0.5], [0.5, -0.1], [0.25, 0.4], [0.28, 0.5], [0, 0.5]], segments=14)]
    for k in range(5):
        a = k * 1.25
        x, z = 0.28 + math.cos(a) * 0.035, -0.3 + math.sin(a) * 0.035
        p += [cyl([0.008, 0.2, 0.008], [x, 1.12, z], '#5E8F4E', 'satin', segments=5),
              sph([0.045, 0.06, 0.045], [x, 1.23, z], ['#E8846B', '#F2C6A0', '#F7F7F7', '#E8846B', '#D9B8D6'][k], 'satin', segments=8)]
    # tall mirror leaning on the wall above, coat hooks beside it with a tote and a scarf
    p += [box([0.5, 0.9, 0.03], [0.0, 1.32, -0.41], W, 'satin', radius=0.02, rotate=[-3, 0, 0]),
          box([0.44, 0.84, 0.006], [0.0, 1.32, -0.393], '#DCE6EA', 'chrome', radius=0.012, rotate=[-3, 0, 0]),
          box([0.03, 0.4, 0.03], [-0.36, 1.42, -0.43], OAK, 'wood', radius=0.008)]
    for y in (1.5, 1.32):
        p.append(cyl([0.02, 0.06, 0.02], [-0.36, y, -0.4], '#C9A24A', 'metal', rotate=[90, 0, 0], segments=6))
    p += [cushion([0.2, 0.24, 0.06], [-0.34, 1.2, -0.37], '#D8C29C', radius=0.02),             # tote
          box([0.06, 0.4, 0.02], [-0.33, 1.25, -0.37], '#E8846B', 'fabric', radius=0.01)]       # scarf
    return placeholder(p)


E['model.neat.entryConsole'] = entry_console(); FOOT['model.neat.entryConsole'] = (1, 1)


if __name__ == '__main__':
    sys.exit(1 if run('neat', sys.argv[1] if len(sys.argv) > 1 else None, E, FOOT) else 0)
