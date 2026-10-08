# Bookworm pack models (web/public/assets/packs/bookworm/manifest.json). Conventions: see pack_foodie.py.
# Run: python3 -I pack_bookworm.py [out.json] && python3 -I apply_pack.py bookworm out.json
import math, os, random, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, gltf, placeholder,  # noqa: E402
                       OAK, OAKD, HONEY, WALNUT, BRASS, CHROME, TEAL, MUSTARD, SAGE, RUST, CREAM)
from objects_extra import books  # noqa: E402
from pack_foodie import run  # noqa: E402

LIB = '../../models/'
E, FOOT = {}, {}
WOOD = '#9A6A45'           # warm library walnut (lighter than WALNUT so it never reads black)
SPINES = ['#7A2E2E', '#2F5D62', '#B5653F', '#D6A64A', '#3E5A3A', '#E6DCC6', '#5A4A7A', '#A9583E', '#C9B48A']
PAGE = '#F4EEDF'


def book_stack(x, z, y, n, rnd, w=0.2, d=0.15):
    out = []
    for i in range(n):
        h = rnd.uniform(0.025, 0.045)
        out.append(box([w * rnd.uniform(0.85, 1.1), h, d * rnd.uniform(0.9, 1.1)], [x + rnd.uniform(-0.01, 0.01), y + h / 2, z],
                       rnd.choice(SPINES), 'satin', radius=0.005, rotate=[0, rnd.uniform(-12, 12), 0]))
        y += h
    return out, y


def mug(x, z, y, c=CREAM):
    return [lathe([0.08, 0.09, 0.08], [x, y + 0.045, z], c, 'gloss',
                  [[0, -0.5], [0.45, -0.5], [0.5, 0.5], [0.44, 0.5], [0.38, -0.35], [0, -0.35]], segments=14),
            torus([0.05, 0.012, 0.05], [x + 0.045, y + 0.045, z], c, 'gloss', rotate=[90, 0, 0], segments=10)]


def lamp(x, z, y, shade=CREAM, base=BRASS, h=0.42):
    return [lathe([0.13, 0.04, 0.13], [x, y + 0.02, z], base, 'metal', [[0, -0.5], [0.5, -0.5], [0.4, 0.5], [0, 0.5]], segments=16),
            cyl([0.025, h * 0.55, 0.025], [x, y + 0.04 + h * 0.275, z], base, 'metal', segments=10),
            lathe([0.28, h * 0.42, 0.28], [x, y + h * 0.78, z], shade, 'fabric',
                  [[0.5, -0.5], [0.34, 0.5], [0.31, 0.5], [0.47, -0.5]], segments=20),
            sph([0.07, 0.07, 0.07], [x, y + h * 0.66, z], '#FFF1C8', 'gloss', segments=8)]


# ---- readingNook (2x1, sit at the centre): window seat between two bookcases, arched header ----
def reading_nook():
    rnd = random.Random(3)
    p = []
    for s in (-1, 1):                                                                            # side bookcases
        x = s * 0.73
        p += [box([0.42, 1.5, 0.4], [x, 0.75, -0.25], WOOD, 'wood', radius=0.01),
              box([0.36, 1.32, 0.02], [x, 0.78, -0.44], '#E8DCC6', 'matte', radius=0.003)]     # back
        for y in (0.06, 0.42, 0.78, 1.14):
            p.append(box([0.38, 0.025, 0.36], [x, y, -0.25], WOOD, 'wood', radius=0.004))
        p += books(rnd, x - 0.17, x + 0.17, 0.0725, -0.42, SPINES, fill=0.9, hmax=0.3, dmax=0.26)
        p += books(rnd, x - 0.17, x + 0.17, 0.4325, -0.42, SPINES, fill=0.65, hmax=0.3, dmax=0.26, stack=2)
        p += books(rnd, x - 0.17, x + 0.17, 0.7925, -0.42, SPINES, fill=0.95, hmax=0.3, dmax=0.26)
    # cavity: carve the bookcases' fronts by drawing them as frames: replace solid fronts with posts
    p = [q for q in p if not (q['shape'] == 'box' and q['size'] == [0.42, 1.5, 0.4])]
    for s in (-1, 1):
        x = s * 0.73
        for dx in (-0.195, 0.195):
            p.append(box([0.03, 1.5, 0.4], [x + dx, 0.75, -0.25], WOOD, 'wood', radius=0.006))
        p.append(box([0.42, 0.04, 0.4], [x, 1.5, -0.25], WOOD, 'wood', radius=0.006))
    # header arch over the seat + reading light
    p += [box([1.88, 0.18, 0.42], [0, 1.62, -0.24], WOOD, 'wood', radius=0.012),
          box([1.06, 0.06, 0.4], [0, 1.5, -0.25], WOOD, 'wood', radius=0.008),
          cyl([0.02, 0.18, 0.02], [0, 1.38, -0.1], BRASS, 'metal', segments=8),
          lathe([0.18, 0.12, 0.18], [0, 1.25, -0.1], MUSTARD, 'satin', [[0.5, -0.5], [0.2, 0.5], [0.12, 0.5], [0.46, -0.5]], segments=16)]
    # seat box (drawers) + cushions, seat top 0.45
    p += [box([1.04, 0.36, 0.62], [0, 0.18, -0.13], WOOD, 'wood', radius=0.01),
          box([0.46, 0.22, 0.012], [-0.25, 0.18, 0.186], '#B88A60', 'wood', radius=0.006),
          box([0.46, 0.22, 0.012], [0.25, 0.18, 0.186], '#B88A60', 'wood', radius=0.006),
          sph([0.03, 0.03, 0.02], [-0.25, 0.18, 0.195], BRASS, 'metal', segments=8),
          sph([0.03, 0.03, 0.02], [0.25, 0.18, 0.195], BRASS, 'metal', segments=8),
          cushion([1.02, 0.09, 0.6], [0, 0.405, -0.12], '#C9B48A'),                               # seat cushion
          cushion([0.48, 0.42, 0.14], [-0.25, 0.68, -0.35], '#E6DCC6', rotate=[-8, 0, 0]),       # back cushions
          cushion([0.48, 0.42, 0.14], [0.25, 0.68, -0.35], '#E6DCC6', rotate=[-8, 0, 0]),
          cushion([0.3, 0.28, 0.1], [-0.4, 0.6, -0.22], TEAL, rotate=[-12, 30, 6]),               # throw pillows
          cushion([0.28, 0.26, 0.1], [0.4, 0.6, -0.24], RUST, rotate=[-12, -28, -6]),
          box([0.5, 0.03, 0.62], [0.28, 0.465, -0.1], '#7A2E2E', 'fabric', radius=0.012, rotate=[0, 6, 0]),   # throw
          box([0.03, 0.22, 0.5], [0.53, 0.36, -0.1], '#7A2E2E', 'fabric', radius=0.012)]
    bs, top = book_stack(-0.42, 0.04, 0.45, 3, rnd, 0.16, 0.12)
    p += bs + mug(-0.42, 0.04, top)
    return placeholder(p)


E['model.bookworm.readingNook'] = reading_nook(); FOOT['model.bookworm.readingNook'] = (2, 1)


# ---- libraryWall (2x1): floor-to-ceiling shelves of rare editions, brass rail + rolling ladder ---
def library_wall():
    rnd = random.Random(11)
    p = [box([1.88, 0.06, 0.4], [0, 2.31, -0.25], WOOD, 'wood', radius=0.01),                  # cornice
         box([1.84, 0.1, 0.38], [0, 0.05, -0.25], WOOD, 'wood', radius=0.006),                 # plinth
         box([1.8, 2.24, 0.02], [0, 1.15, -0.44], '#E8DCC6', 'matte', radius=0.003)]            # back
    for x in (-0.91, -0.3, 0.3, 0.91):
        p.append(box([0.04, 2.26, 0.4], [x, 1.15, -0.25], WOOD, 'wood', radius=0.006))       # uprights
    ys = [0.1, 0.52, 0.92, 1.32, 1.72, 2.12]
    for y in ys:
        p.append(box([1.84, 0.03, 0.38], [0, y, -0.25], WOOD, 'wood', radius=0.004))
    bays = [(-0.88, -0.32), (-0.28, 0.28), (0.32, 0.88)]
    for i, y in enumerate(ys[:-1]):
        for j, (a, b) in enumerate(bays):
            k = (i * 3 + j) % 4
            fill = [0.95, 0.7, 0.85, 0.55][k]
            p += books(rnd, a + 0.01, b - 0.01, y + 0.015, -0.43, SPINES, fill=fill, hmax=0.34, dmax=0.28, stack=2 if k == 3 else 0)
    # a globe and a bust on shelves
    p += [sph([0.2, 0.2, 0.2], [0.72, 1.465, -0.26], '#6E9FB4', 'gloss', segments=14),
          torus([0.24, 0.012, 0.24], [0.72, 1.465, -0.26], BRASS, 'metal', rotate=[0, 0, 70], segments=20),
          cyl([0.1, 0.06, 0.1], [0.72, 1.365, -0.26], BRASS, 'metal', segments=12),
          sph([0.12, 0.14, 0.12], [-0.6, 1.0, -0.28], '#E9E4DA', 'satin', segments=10),
          box([0.14, 0.06, 0.12], [-0.6, 0.94, -0.28], '#E9E4DA', 'satin', radius=0.01)]
    # brass rail + ladder leaning on it
    p.append(cyl([0.025, 1.84, 0.025], [0, 1.98, -0.04], BRASS, 'metal', rotate=[0, 0, 90], segments=10))
    for x in (-0.4, 0.4):
        p.append(box([0.03, 0.06, 0.2], [x, 1.98, -0.13], BRASS, 'metal', radius=0.008))
    top, bot = [0.35, 1.98, -0.02], [0.35, 0.0, 0.36]
    for dx in (-0.2, 0.2):
        p.append(rod([top[0] + dx, top[1], top[2]], [bot[0] + dx, bot[1] + 0.02, bot[2]], 0.04, HONEY, 'wood', shape='box', t2=0.06, radius=0.01))
    for k in range(1, 8):
        t = k / 8
        y = top[1] + (bot[1] - top[1]) * t
        z = top[2] + (bot[2] - top[2]) * t
        p.append(box([0.4, 0.025, 0.07], [0.35, y, z], HONEY, 'wood', radius=0.006))
    p += [torus([0.06, 0.02, 0.06], [0.15, 0.03, 0.36], BRASS, 'metal', rotate=[0, 0, 90], segments=10),
          torus([0.06, 0.02, 0.06], [0.55, 0.03, 0.36], BRASS, 'metal', rotate=[0, 0, 90], segments=10)]
    return placeholder(p)


E['model.bookworm.libraryWall'] = library_wall(); FOOT['model.bookworm.libraryWall'] = (2, 1)


# ---- writingBureau (1x1, sit at the centre facing +Z): roll-top bureau in front, typewriter ------
def writing_bureau():
    p = [box([0.82, 0.04, 0.3], [0, 0.75, 0.29], WOOD, 'wood', radius=0.01),                  # writing surface (near edge 0.14)
         box([0.82, 0.42, 0.14], [0, 0.98, 0.385], WOOD, 'wood', radius=0.01),               # pigeonhole hutch (back to room)
         box([0.82, 0.14, 0.2], [0, 1.26, 0.345], '#B88A60', 'wood', radius=0.06),           # rounded roll-top
         box([0.84, 0.03, 0.19], [0, 1.31, 0.35], WOOD, 'wood', radius=0.008)]
    for x in (-0.28, -0.1, 0.1, 0.28):                                                             # pigeonholes (dark mouths face the Sim)
        p.append(box([0.15, 0.12, 0.01], [x, 1.02, 0.31], '#5A3F2E', 'matte', radius=0.004))
    for x, c in ((-0.28, '#F4EEDF'), (0.1, '#E6DCC6'), (0.28, '#C9B48A')):
        p.append(box([0.12, 0.08, 0.06], [x, 0.995, 0.33], c, 'matte', radius=0.004))         # letters in cubbies
    for s in (-1, 1):                                                                               # pedestals with drawers
        x = s * 0.31
        p += [box([0.2, 0.73, 0.28], [x, 0.365, 0.3], WOOD, 'wood', radius=0.008)]
        for y in (0.2, 0.45, 0.62):
            p += [box([0.17, 0.14, 0.012], [x, y, 0.155], '#B88A60', 'wood', radius=0.005),
                  sph([0.025, 0.025, 0.02], [x, y, 0.145], BRASS, 'metal', segments=8)]
    p.append(box([0.44, 0.6, 0.015], [0, 0.42, 0.44], WOOD, 'wood', radius=0.004))            # modesty panel (room side)
    p.append(box([0.36, 0.48, 0.008], [0, 0.42, 0.449], '#B88A60', 'wood', radius=0.004))
    # typewriter facing the Sim (keys toward -Z)
    p += [box([0.32, 0.09, 0.22], [0.0, 0.815, 0.27], '#3F6E73', 'gloss', radius=0.03),
          box([0.3, 0.03, 0.08], [0.0, 0.85, 0.2], '#3F6E73', 'gloss', radius=0.012, rotate=[20, 0, 0]),
          cyl([0.04, 0.36, 0.04], [0.0, 0.88, 0.34], '#2B2C2E', 'satin', rotate=[0, 0, 90], segments=10),   # platen
          box([0.2, 0.16, 0.004], [0.0, 0.95, 0.33], PAGE, 'matte', radius=0.002, rotate=[-12, 0, 0])]      # paper
    for i in range(3):
        for j in range(8):
            p.append(cyl([0.016, 0.01, 0.016], [-0.105 + j * 0.03, 0.85 + i * 0.012, 0.165 + i * 0.022], '#F2EDE2', 'gloss', segments=8))
    p += lamp(-0.28, 0.21, 0.77, shade='#3E5A3A', h=0.34)
    p += mug(0.36, 0.2, 0.77, MUSTARD)
    p += [box([0.2, 0.02, 0.15], [0.16, 0.78, 0.23], PAGE, 'matte', radius=0.004, rotate=[0, 10, 0])]  # manuscript pile
    # chair (seat top 0.45, centred on the Sim)
    p += [box([0.42, 0.04, 0.4], [0, 0.41, -0.1], HONEY, 'wood', radius=0.012),
          cushion([0.38, 0.04, 0.36], [0, 0.45, -0.09], '#7A2E2E', radius=0.018)]
    for dx in (-0.18, 0.18):
        p += [cyl([0.035, 0.4, 0.035], [dx, 0.2, 0.06], HONEY, 'wood', taper=0.8, segments=10),
              cyl([0.035, 0.92, 0.035], [dx, 0.46, -0.28], HONEY, 'wood', taper=0.9, segments=10)]
    p += [box([0.4, 0.14, 0.035], [0, 0.84, -0.28], HONEY, 'wood', radius=0.03),
          box([0.4, 0.04, 0.03], [0, 0.64, -0.28], HONEY, 'wood', radius=0.01)]
    return placeholder(p)


E['model.bookworm.writingBureau'] = writing_bureau(); FOOT['model.bookworm.writingBureau'] = (1, 1)


# ---- teaTrolley (1x1): brass-and-oak trolley with a real porcelain tea set (Poly Haven) ---------
def tea_trolley():
    p = [box([0.74, 0.03, 0.44], [0, 0.78, -0.2], OAK, 'wood', radius=0.01),
         box([0.74, 0.03, 0.44], [0, 0.32, -0.2], OAK, 'wood', radius=0.01)]
    for x in (-0.36, 0.36):
        for z in (-0.4, 0.0):
            p.append(cyl([0.03, 0.78, 0.03], [x, 0.43, z], BRASS, 'metal', segments=10))
            p.append(torus([0.09, 0.025, 0.09], [x, 0.045, z], '#3A3D41', 'satin', rotate=[0, 0, 90], segments=12))
    p += [rod([0.36, 0.9, -0.4], [0.36, 0.9, 0.0], 0.025, BRASS, 'metal')]                    # push handle
    # lower shelf: biscuit tin, cake stand, stacked cups, books
    p += [cyl([0.2, 0.12, 0.2], [-0.2, 0.395, -0.22], '#2F5D62', 'gloss', segments=16),
          cyl([0.21, 0.02, 0.21], [-0.2, 0.465, -0.22], BRASS, 'metal', segments=16),
          lathe([0.24, 0.12, 0.24], [0.14, 0.395, -0.2], '#F6F3EA', 'gloss',
                [[0, -0.5], [0.15, -0.5], [0.08, -0.3], [0.08, 0.3], [0.5, 0.35], [0.5, 0.5], [0, 0.45]], segments=18),
          cyl([0.18, 0.06, 0.18], [0.14, 0.49, -0.2], '#C8964F', 'matte', segments=18),             # cake
          cyl([0.18, 0.015, 0.18], [0.14, 0.525, -0.2], '#F4E9D8', 'satin', segments=18)]           # icing
    # placeholder fallback for the tea set
    fb = p + [lathe([0.2, 0.18, 0.16], [0, 0.885, -0.2], '#F6F3EA', 'gloss',
                    [[0, -0.5], [0.4, -0.5], [0.5, 0.0], [0.35, 0.4], [0, 0.5]], segments=16)]
    return gltf(LIB + 'ph/tea_set_01.glb', [0.62, 0.11, 0.33], align='centre', offset=[0, 0.795, -0.2], parts=p, placeholder=fb)


E['model.bookworm.teaTrolley'] = tea_trolley(); FOOT['model.bookworm.teaTrolley'] = (1, 1)


# ---- firesideLounge (2x2, 2 seats at x = +-0.5): twin velvet wing chairs (Poly Haven), stove ----
def fireside_lounge():
    rnd = random.Random(5)
    p = [cyl([1.7, 0.012, 1.3], [0, 0.006, 0.25], '#9C4A3A', 'fabric', segments=32),           # oval rug
         cyl([1.5, 0.014, 1.12], [0, 0.007, 0.25], '#C9A46E', 'fabric', segments=32)]
    # freestanding cast-iron stove in front of the chairs (fire facing them), flue up
    SX, SZ = 0.0, 0.7
    STOVE = '#4A4E54'
    p += [box([0.5, 0.06, 0.44], [SX, 0.03, SZ], '#B9B0A2', 'satin', radius=0.01),           # hearth stone
          box([0.42, 0.5, 0.36], [SX, 0.37, SZ], STOVE, 'metal', radius=0.04),
          box([0.46, 0.04, 0.4], [SX, 0.64, SZ], STOVE, 'metal', radius=0.015),
          box([0.28, 0.22, 0.02], [SX, 0.37, SZ - 0.185], '#2B2220', 'gloss', radius=0.02),    # door glass facing the chairs
          sph([0.2, 0.1, 0.06], [SX, 0.31, SZ - 0.18], '#F28C28', 'gloss', segments=8),
          sph([0.12, 0.08, 0.05], [SX + 0.05, 0.34, SZ - 0.185], '#FFC24A', 'gloss', segments=8),
          cyl([0.14, 1.3, 0.14], [SX, 1.31, SZ + 0.05], STOVE, 'metal', segments=14),            # flue
          cyl([0.04, 0.12, 0.04], [SX - 0.16, 0.06, SZ - 0.13], STOVE, 'metal'),
          cyl([0.04, 0.12, 0.04], [SX + 0.16, 0.06, SZ - 0.13], STOVE, 'metal')]
    # log basket + a side table between the chairs with books, tea, lamp
    p += [lathe([0.34, 0.24, 0.26], [0.65, 0.12, 0.66], '#C9A46E', 'wood',
                [[0, -0.5], [0.44, -0.5], [0.5, 0.5], [0.46, 0.5], [0.4, -0.35], [0, -0.35]], segments=16)]
    for i in range(3):
        p.append(cyl([0.08, 0.3, 0.08], [0.6 + i * 0.05, 0.25, 0.66], '#8B6B4E', 'bark', rotate=[90, 30 * i, 0], segments=8))
    p += [cyl([0.3, 0.03, 0.3], [0, 0.56, -0.12], WOOD, 'wood', segments=20),
          lathe([0.06, 0.55, 0.06], [0, 0.275, -0.12], WOOD, 'wood', [[0, -0.5], [0.5, -0.5], [0.3, -0.3], [0.4, 0.2], [0.3, 0.5], [0, 0.5]], segments=12),
          cyl([0.24, 0.03, 0.24], [0, 0.015, -0.12], WOOD, 'wood', segments=16)]
    bs, top = book_stack(0.0, -0.12, 0.575, 3, rnd, 0.16, 0.12)
    p += bs + mug(0.05, -0.05, 0.575, '#F6F3EA')
    # low bookcase behind the chairs, against the wall
    p += [box([1.7, 0.6, 0.3], [0, 0.3, -0.78], WOOD, 'wood', radius=0.01),
          ]
    p += books(rnd, -0.78, 0.78, 0.6, -0.9, SPINES, fill=0.35, hmax=0.3, dmax=0.2, stack=0)
    p += lamp(0.6, -0.78, 0.6, shade=CREAM, h=0.5)
    fb = p + [cushion([0.66, 0.9, 0.66], [x, 0.45, 0.0], '#3E5A3A') for x in (-0.5, 0.5)]
    return gltf(LIB + 'ph/fireside_wing_chairs.glb', [1.66, 1.05, 0.66], align='centre', offset=[0, 0, -0.02],
                parts=p, placeholder=fb, footprint=(2, 2))


E['model.bookworm.firesideLounge'] = fireside_lounge(); FOOT['model.bookworm.firesideLounge'] = (2, 2)


# ---- bedsideStack (1x1): a warm wooden drawer chest (Poly Haven) piled with books and a lamp ----
def bedside_stack():
    rnd = random.Random(9)
    H = 0.5
    p = []
    bs, top = book_stack(-0.16, -0.25, H, 5, rnd, 0.22, 0.16)
    p += bs
    bs2, top2 = book_stack(0.05, -0.2, H, 3, rnd, 0.2, 0.15)
    p += bs2
    p += [box([0.16, 0.03, 0.22], [0.05, top2 + 0.03, -0.18], '#7A2E2E', 'satin', radius=0.005, rotate=[0, 0, 12])]  # open book tent
    p += [box([0.16, 0.03, 0.22], [0.18, top2 + 0.03, -0.18], PAGE, 'matte', radius=0.005, rotate=[0, 0, -12])]
    p += lamp(0.26, -0.3, H, shade='#E9D5A8', base=BRASS, h=0.44)
    p += mug(-0.28, -0.08, H, TEAL)
    p += [box([0.1, 0.012, 0.04], [-0.05, H + 0.006, -0.05], '#3A3D41', 'gloss', radius=0.006)]  # reading glasses
    # a leaning floor stack beside the chest
    fs, _ = book_stack(0.3, 0.2, 0.0, 6, rnd, 0.24, 0.18)
    p += fs
    fb = [box([0.8, H, 0.43], [0, H / 2, -0.24], HONEY, 'wood', radius=0.01)] + p
    return gltf(LIB + 'ph/vintage_wooden_drawer_01.glb', [0.8, H, 0.43], align='back', offset=[0, 0, 0.045],
                parts=p, placeholder=fb)


E['model.bookworm.bedsideStack'] = bedside_stack(); FOOT['model.bookworm.bedsideStack'] = (1, 1)


if __name__ == '__main__':
    sys.exit(1 if run('bookworm', sys.argv[1] if len(sys.argv) > 1 else None, E, FOOT) else 0)
