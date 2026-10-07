# Generates realistic-ish placeholder models for the manifest (1 unit = 1 m, origin at the
# footprint centre on the floor, front = +Z). Run: python3 -I models.py -> models.json
import json, random

F = 'material.finish.'
def part(shape, size, at, color, finish=None, **kw):
    p = {'shape': shape, 'size': [round(v, 4) for v in size], 'at': [round(v, 4) for v in at], 'color': color}
    if finish: p['material'] = F + finish
    p.update(kw)
    return p
def box(size, at, color, finish=None, **kw): return part('box', size, at, color, finish, **kw)
def cyl(size, at, color, finish=None, **kw): return part('cylinder', size, at, color, finish, **kw)

M = {}

# ---- Kitchen -----------------------------------------------------------------------------
WHITE_APPL = '#E8E8E5'
M['model.fridge'] = [
    box([0.72, 0.08, 0.64], [0, 0.04, -0.15], '#1F2023', 'satin', radius=0.01),          # plinth
    box([0.72, 1.8, 0.62], [0, 0.98, -0.16], WHITE_APPL, 'satin', radius=0.025),        # cabinet
    box([0.7, 1.12, 0.04], [0, 0.65, 0.165], WHITE_APPL, 'satin', radius=0.015),        # fridge door
    box([0.7, 0.62, 0.04], [0, 1.54, 0.165], WHITE_APPL, 'satin', radius=0.015),        # freezer door
    box([0.025, 0.42, 0.03], [0.29, 0.98, 0.205], '#C9CCD0', 'chrome', radius=0.01),     # handles
    box([0.025, 0.26, 0.03], [0.29, 1.37, 0.205], '#C9CCD0', 'chrome', radius=0.01),
]
M['model.sink'] = [
    box([0.9, 0.1, 0.56], [0, 0.05, -0.2], '#1F2023', 'satin', radius=0.005),            # plinth
    box([0.9, 0.76, 0.58], [0, 0.48, -0.2], '#D8D3C9', 'satin', radius=0.01),            # cabinet
    box([0.43, 0.68, 0.02], [-0.222, 0.48, 0.095], '#E1DCD2', 'satin', radius=0.008),   # doors
    box([0.43, 0.68, 0.02], [0.222, 0.48, 0.095], '#E1DCD2', 'satin', radius=0.008),
    box([0.94, 0.04, 0.64], [0, 0.88, -0.18], '#3A3936', 'gloss', radius=0.01),           # stone top
    box([0.52, 0.012, 0.38], [0, 0.906, -0.15], '#A9ADB2', 'metal', radius=0.03),        # basin rim
    box([0.46, 0.008, 0.32], [0, 0.909, -0.15], '#6E7276', 'metal', radius=0.02),        # basin floor (darker)
    cyl([0.04, 0.26, 0.04], [0, 1.03, -0.42], '#D5D8DC', 'chrome'),                     # tap
    box([0.025, 0.025, 0.2], [0, 1.15, -0.33], '#D5D8DC', 'chrome', radius=0.012),       # spout
    box([0.02, 0.02, 0.1], [0.08, 0.95, -0.42], '#D5D8DC', 'chrome', radius=0.009),      # lever
]

# ---- Bedroom -----------------------------------------------------------------------------
OAK = '#C29B72'
M['model.bed'] = [
    box([1.72, 0.26, 1.98], [0, 0.2, 0.0], OAK, 'wood', radius=0.02),                    # frame
    box([1.84, 1.0, 0.08], [0, 0.5, -0.96], OAK, 'wood', radius=0.025),                  # headboard
    box([0.08, 0.12, 0.08], [-0.8, 0.06, 0.92], '#6B4E36', 'wood', radius=0.01),         # feet
    box([0.08, 0.12, 0.08], [0.8, 0.06, 0.92], '#6B4E36', 'wood', radius=0.01),
    box([1.62, 0.22, 1.9], [0, 0.44, 0.0], '#EEECE6', 'fabric', radius=0.07),            # mattress
    box([1.68, 0.1, 1.32], [0, 0.57, 0.3], '#6E8299', 'fabric', radius=0.05),            # duvet
    box([1.7, 0.03, 0.42], [0, 0.6, 0.72], '#C5B497', 'fabric', radius=0.015),           # throw
    box([0.66, 0.14, 0.42], [-0.39, 0.62, -0.68], '#F4F2EE', 'fabric', radius=0.065),    # pillows
    box([0.66, 0.14, 0.42], [0.39, 0.62, -0.68], '#F4F2EE', 'fabric', radius=0.065),
]

# ---- Bathroom ----------------------------------------------------------------------------
PORC = '#F5F5F2'
M['model.toilet'] = [
    cyl([0.3, 0.2, 0.36], [0, 0.1, -0.02], PORC, 'gloss', taper=1.15),                   # pedestal
    cyl([0.38, 0.2, 0.5], [0, 0.3, 0.02], PORC, 'gloss', taper=1.12),                    # bowl
    cyl([0.42, 0.035, 0.52], [0, 0.418, 0.03], '#FFFFFF', 'gloss'),                     # seat
    box([0.44, 0.4, 0.17], [0, 0.6, -0.3], PORC, 'gloss', radius=0.04),                 # tank
    box([0.46, 0.03, 0.19], [0, 0.815, -0.3], PORC, 'gloss', radius=0.012),              # tank lid
    cyl([0.05, 0.012, 0.05], [0, 0.835, -0.3], '#C9CCD0', 'chrome'),                    # flush
]
M['model.shower'] = [
    box([0.9, 0.07, 0.9], [0, 0.035, 0], PORC, 'gloss', radius=0.02),                    # tray
    box([0.62, 0.006, 0.62], [0, 0.072, 0], '#E2E2DE', 'gloss', radius=0.04),            # tray recess
    box([0.9, 2.0, 0.03], [0, 1.07, -0.435], '#E6E3DC', 'gloss', radius=0.005),          # tiled back wall
    box([0.012, 1.95, 0.88], [-0.435, 1.05, 0.0], '#FFFFFF', 'glass', radius=0.004),      # glass side
    box([0.02, 1.95, 0.02], [-0.435, 1.05, 0.44], '#C9CCD0', 'chrome', radius=0.008),    # frame
    box([0.5, 1.95, 0.012], [0.2, 1.05, 0.44], '#FFFFFF', 'glass', radius=0.004),         # glass door
    box([0.02, 1.95, 0.02], [-0.04, 1.05, 0.44], '#C9CCD0', 'chrome', radius=0.008),
    box([0.88, 0.02, 0.02], [0.0, 2.03, 0.44], '#C9CCD0', 'chrome', radius=0.008),
    cyl([0.022, 1.15, 0.022], [0.25, 1.4, -0.4], '#D5D8DC', 'chrome'),                  # riser
    cyl([0.22, 0.02, 0.22], [0.25, 2.0, -0.3], '#D5D8DC', 'chrome'),                    # rain head
    box([0.02, 0.02, 0.12], [0.25, 1.99, -0.37], '#D5D8DC', 'chrome', radius=0.009),
    cyl([0.07, 0.05, 0.07], [0.25, 1.1, -0.405], '#D5D8DC', 'chrome', rotate=[90, 0, 0]),  # mixer
]

# ---- Living room -------------------------------------------------------------------------
WALNUT = '#7A563A'
M['model.tv'] = [
    box([0.96, 0.4, 0.42], [0, 0.24, -0.2], WALNUT, 'wood', radius=0.012),                # console
    box([0.92, 0.04, 0.02], [0, 0.28, 0.012], '#5A3F2A', 'wood', radius=0.005),          # drawer line
    box([0.06, 0.04, 0.38], [-0.4, 0.02, -0.2], '#1F2023', 'metal', radius=0.01),        # feet
    box([0.06, 0.04, 0.38], [0.4, 0.02, -0.2], '#1F2023', 'metal', radius=0.01),
    box([0.3, 0.015, 0.16], [0, 0.448, -0.24], '#1C1D20', 'metal', radius=0.006),        # stand base
    box([0.05, 0.12, 0.03], [0, 0.5, -0.28], '#1C1D20', 'metal', radius=0.008),          # neck
    box([0.92, 0.54, 0.035], [0, 0.82, -0.27], '#121316', 'satin', radius=0.008),        # body / bezel
    box([0.9, 0.51, 0.005], [0, 0.825, -0.25], '#050608', 'gloss', radius=0.002),        # screen
]
random.seed(7)
BOOKS = ['#7B2F2A', '#2F4B6E', '#C9B27A', '#3E5B3A', '#8C6A4A', '#D8D2C4', '#4A3B5A', '#A2482E', '#2B2B2E', '#5E7F8C']
shelf = [
    box([0.9, 1.9, 0.03], [0, 0.95, -0.475], '#8E6A48', 'wood', radius=0.005),           # back
    box([0.035, 1.9, 0.36], [-0.43, 0.95, -0.3], OAK, 'wood', radius=0.008),           # sides
    box([0.035, 1.9, 0.36], [0.43, 0.95, -0.3], OAK, 'wood', radius=0.008),
    box([0.9, 0.035, 0.37], [0, 1.9, -0.3], OAK, 'wood', radius=0.008),                 # top
    box([0.86, 0.08, 0.34], [0, 0.04, -0.3], '#8E6A48', 'wood', radius=0.005),           # kick
]
levels = [0.1, 0.52, 0.94, 1.36]
for y in levels + [1.76]:
    if y > 0.1:
        shelf.append(box([0.83, 0.025, 0.34], [0, y - 0.0125, -0.3], OAK, 'wood', radius=0.005))
for y in levels:
    x = -0.4
    while x < 0.36:
        w = random.uniform(0.025, 0.05)
        h = random.uniform(0.22, 0.33)
        d = random.uniform(0.18, 0.24)
        if random.random() < 0.08:  # gap
            x += 0.06
            continue
        if x + w > 0.4: break
        shelf.append(box([w, h, d], [x + w / 2, y + h / 2, -0.32 + (0.24 - d) / 2], random.choice(BOOKS), 'satin', radius=0.004))
        x += w + 0.002
M['model.bookshelf'] = shelf

# ---- Outdoors ----------------------------------------------------------------------------
IRON = '#26282B'
bench = []
for sx in (-0.78, 0.78):  # cast-iron side frames
    bench += [
        box([0.05, 0.44, 0.05], [sx, 0.22, 0.2], IRON, 'metal', radius=0.01),
        box([0.05, 0.86, 0.05], [sx, 0.43, -0.16], IRON, 'metal', radius=0.01, rotate=[-8, 0, 0]),
        box([0.05, 0.05, 0.46], [sx, 0.43, 0.03], IRON, 'metal', radius=0.01),
        box([0.06, 0.04, 0.42], [sx, 0.66, 0.06], IRON, 'metal', radius=0.015),          # armrest
        box([0.04, 0.22, 0.04], [sx, 0.55, 0.24], IRON, 'metal', radius=0.01),
    ]
for i, z in enumerate([-0.1, 0.0, 0.1, 0.2]):
    bench.append(box([1.74, 0.035, 0.085], [0, 0.46, z], '#9A6E4A', 'wood', radius=0.01))
for i, y in enumerate([0.6, 0.72, 0.84]):
    bench.append(box([1.74, 0.085, 0.03], [0, y, -0.2 - (y - 0.6) * 0.14], '#9A6E4A', 'wood', radius=0.01, rotate=[-8, 0, 0]))
M['model.bench'] = bench

fb = [
    box([0.94, 0.26, 0.94], [0, 0.13, 0], '#7B5B41', 'wood', radius=0.015),              # timber edging
    box([0.84, 0.02, 0.84], [0, 0.255, 0], '#3B2B20', 'matte', radius=0.01),             # soil
]
random.seed(3)
for i in range(6):
    x, z = random.uniform(-0.3, 0.3), random.uniform(-0.3, 0.3)
    fb.append(part('blob', [0.28, 0.22, 0.28], [x, 0.36, z], random.choice(['#4D6B2C', '#5B7A33', '#45622A']), 'foliage', noise=0.25))
FLOWERS = ['#D9483B', '#F2C14E', '#F0EDE6', '#C2477A', '#E8873A', '#8E6BBF']
for i in range(14):
    x, z = random.uniform(-0.36, 0.36), random.uniform(-0.36, 0.36)
    fb.append(part('sphere', [0.07, 0.05, 0.07], [x, 0.43 + random.uniform(0, 0.12), z], random.choice(FLOWERS), 'satin', segments=5))
M['model.flowerbed'] = fb

# Deciduous tree, ~5.5 m before random scaling.
LEAF = ['#5A7A33', '#66873A', '#526F2F', '#6E8F40', '#5E7E35']
tree = [
    cyl([0.36, 2.9, 0.36], [0, 1.45, 0], '#D9D2C8', 'bark', taper=0.5, segments=10),
    cyl([0.12, 1.5, 0.12], [0.45, 3.0, 0.1], '#D9D2C8', 'bark', taper=0.4, segments=6, rotate=[0, 0, -38]),
    cyl([0.11, 1.4, 0.11], [-0.4, 3.1, -0.15], '#D9D2C8', 'bark', taper=0.4, segments=6, rotate=[12, 0, 35]),
]
for size, at, c in [
    ([2.9, 2.3, 2.8], [0, 4.1, 0], 0), ([2.0, 1.7, 2.0], [0.95, 4.5, 0.4], 1), ([2.1, 1.8, 2.0], [-1.0, 4.3, -0.4], 2),
    ([1.7, 1.5, 1.7], [0.2, 5.2, -0.5], 3), ([1.7, 1.3, 1.6], [-0.3, 3.5, 0.9], 4), ([1.5, 1.3, 1.5], [0.7, 3.6, -0.8], 2),
]:
    tree.append(part('blob', size, at, LEAF[c], 'foliage', noise=0.24))
M['model.tree'] = tree

NEEDLE = ['#34522F', '#3B5B33', '#426439', '#304C2C']
pine = [cyl([0.3, 2.0, 0.3], [0, 1.0, 0], '#D2C6B8', 'bark', taper=0.6, segments=8)]
for i, (d, h, y) in enumerate([(2.7, 2.0, 1.9), (2.2, 1.9, 3.0), (1.75, 1.8, 4.0), (1.25, 1.6, 4.9), (0.7, 1.3, 5.7)]):
    pine.append(part('cone', [d, h, d], [0, y, 0], NEEDLE[i % 4], 'foliage', segments=11))
M['model.pine'] = pine

M['model.bush'] = [
    part('blob', [1.1, 0.8, 1.0], [0, 0.38, 0], '#587833', 'foliage', noise=0.22),
    part('blob', [0.8, 0.65, 0.8], [0.32, 0.5, 0.15], '#64853A', 'foliage', noise=0.22),
    part('blob', [0.7, 0.55, 0.7], [-0.3, 0.42, -0.2], '#506E2E', 'foliage', noise=0.22),
]
M['model.rock'] = [
    part('blob', [1.0, 0.55, 0.85], [0, 0.16, 0], '#8E8A82', 'matte', noise=0.3),
    part('blob', [0.5, 0.32, 0.45], [0.42, 0.08, 0.22], '#9A958C', 'matte', noise=0.3),
]
tuft = []
random.seed(11)
for i in range(6):
    a = i / 6 * 360 + random.uniform(-20, 20)
    lean = random.uniform(8, 22)
    h = random.uniform(0.2, 0.34)
    import math
    r = 0.03
    tuft.append(part('cone', [0.03, h, 0.012], [math.cos(math.radians(a)) * r, h / 2, math.sin(math.radians(a)) * r],
                     random.choice(['#5B7A33', '#678A3A', '#4F6D2C', '#728F42']), 'foliage', segments=3,
                     rotate=[lean * math.sin(math.radians(a)), a, -lean * math.cos(math.radians(a))]))
M['model.grassTuft'] = tuft
fl = []
random.seed(5)
for i in range(3):
    x, z = random.uniform(-0.08, 0.08), random.uniform(-0.08, 0.08)
    h = random.uniform(0.18, 0.28)
    fl.append(part('cylinder', [0.008, h, 0.008], [x, h / 2, z], '#4F6D2C', 'foliage', segments=3))
    fl.append(part('sphere', [0.05, 0.03, 0.05], [x, h, z], random.choice(FLOWERS), 'satin', segments=5))
M['model.flowers'] = fl

# ---- Characters --------------------------------------------------------------------------
# Tint slots: body = outfit, skin, hair. Untinted parts (shoes, eyes) share one dark mesh.
DARK = '#222226'
W = '#FFFFFF'
PANTS = '#9A9AA2'
sim = [
    # Trousers are a darker shade of the outfit colour (vertex colour x per-Sim tint).
    part('capsule', [0.13, 0.84, 0.14], [-0.088, 0.46, 0], PANTS, 'fabric', tint='body'),    # legs
    part('capsule', [0.13, 0.84, 0.14], [0.088, 0.46, 0], PANTS, 'fabric', tint='body'),
    box([0.33, 0.18, 0.21], [0, 0.88, 0], PANTS, 'fabric', tint='body', radius=0.075),        # hips
    box([0.36, 0.42, 0.22], [0, 1.12, 0], W, 'fabric', tint='body', radius=0.09),         # torso
    box([0.43, 0.15, 0.21], [0, 1.31, -0.005], W, 'fabric', tint='body', radius=0.07),   # shoulders
    part('capsule', [0.095, 0.6, 0.1], [-0.235, 1.06, -0.01], W, 'fabric', tint='body', rotate=[0, 0, -4]),  # arms
    part('capsule', [0.095, 0.6, 0.1], [0.235, 1.06, -0.01], W, 'fabric', tint='body', rotate=[0, 0, 4]),
    part('sphere', [0.08, 0.1, 0.06], [-0.255, 0.74, 0], W, 'skin', tint='skin'),        # hands
    part('sphere', [0.08, 0.1, 0.06], [0.255, 0.74, 0], W, 'skin', tint='skin'),
    cyl([0.1, 0.12, 0.1], [0, 1.42, 0], W, 'skin', tint='skin'),                          # neck
    part('sphere', [0.19, 0.235, 0.215], [0, 1.585, 0.005], W, 'skin', tint='skin', segments=16),  # head
    part('sphere', [0.035, 0.045, 0.04], [0, 1.575, 0.11], W, 'skin', tint='skin', segments=6),    # nose
    part('sphere', [0.04, 0.06, 0.04], [-0.096, 1.585, 0], W, 'skin', tint='skin', segments=6),    # ears
    part('sphere', [0.04, 0.06, 0.04], [0.096, 1.585, 0], W, 'skin', tint='skin', segments=6),
    box([0.1, 0.075, 0.25], [-0.088, 0.037, 0.035], DARK, 'satin', radius=0.03),           # shoes
    box([0.1, 0.075, 0.25], [0.088, 0.037, 0.035], DARK, 'satin', radius=0.03),
    part('sphere', [0.022, 0.026, 0.012], [-0.038, 1.61, 0.1], '#1A1A1C', 'satin', segments=6),  # eyes
    part('sphere', [0.022, 0.026, 0.012], [0.038, 1.61, 0.1], '#1A1A1C', 'satin', segments=6),
]
M['model.sim'] = sim
CAP = dict(tint='hair', material=F + 'satin')
def hair(shape, size, at, **kw):
    p = part(shape, size, at, W, **kw); p.update(CAP); return p
M['model.hair.short'] = [
    hair('blob', [0.205, 0.135, 0.23], [0, 1.66, -0.012], noise=0.08),
]
M['model.hair.long'] = [
    hair('blob', [0.21, 0.14, 0.235], [0, 1.66, -0.012], noise=0.08),
    hair('box', [0.21, 0.36, 0.08], [0, 1.48, -0.085], radius=0.035),
]
M['model.hair.bun'] = [
    hair('blob', [0.205, 0.135, 0.23], [0, 1.66, -0.012], noise=0.06),
    hair('sphere', [0.1, 0.1, 0.1], [0, 1.72, -0.11]),
]

out = {}
for k, parts in M.items():
    out[k] = {'type': 'model', 'placeholder': parts}
json.dump(out, open('models.json', 'w'), indent=2)
print(len(out), 'models;', sum(len(v['placeholder']) for v in out.values()), 'parts')
