# Extra placeholder models: new objects (gym, hobby, furniture) and style variants
# (`model.<key>@modern|@cozy|@minimal`) of the existing furniture. Same conventions as models.py:
# 1 unit = 1 m, origin at the footprint centre on the floor, front = +Z, back against the wall at -Z.
# Run: python3 -I objects_extra.py [out.json]  (default: objects_extra.json). It validates every
# part (fields, colours, footprint bounds, finish count) and exits non-zero on violations.
import json, math, random, re, sys

F = 'material.finish.'
def part(shape, size, at, color, finish=None, **kw):
    p = {'shape': shape, 'size': [round(v, 4) for v in size], 'at': [round(v, 4) for v in at], 'color': color}
    if finish: p['material'] = F + finish
    if 'rotate' in kw: kw['rotate'] = [round(v, 2) for v in kw['rotate']]
    p.update(kw)
    return p
def box(size, at, color, finish=None, **kw): return part('box', size, at, color, finish, **kw)
def cyl(size, at, color, finish=None, **kw): return part('cylinder', size, at, color, finish, **kw)
def cone(size, at, color, finish=None, **kw): return part('cone', size, at, color, finish, **kw)
def sph(size, at, color, finish=None, **kw): return part('sphere', size, at, color, finish, **kw)
def blob(size, at, color, finish=None, **kw): return part('blob', size, at, color, finish, **kw)

# ---- rotation helpers (match Babylon's Quaternion.FromEulerAngles: roll z, then pitch x, then yaw y)
def rot(v, r):
    x, y, z = v
    ax, ay, az = (math.radians(a) for a in r)
    c, s = math.cos(az), math.sin(az); x, y = x * c - y * s, x * s + y * c
    c, s = math.cos(ax), math.sin(ax); y, z = y * c - z * s, y * s + z * c
    c, s = math.cos(ay), math.sin(ay); x, z = x * c + z * s, -x * s + z * c
    return [x, y, z]
def add(a, b): return [a[i] + b[i] for i in range(3)]
def on(pivot, r, local):
    """Point `local` in a frame rotated by `r` around `pivot` (for parts on tilted surfaces)."""
    return add(pivot, rot(local, r))
def align_y(d):
    """Euler rotation (deg) that turns the local +Y axis to direction d."""
    l = math.sqrt(sum(c * c for c in d)); dx, dy, dz = (c / l for c in d)
    return [math.degrees(math.acos(max(-1.0, min(1.0, dy)))), math.degrees(math.atan2(dx, dz)), 0]
def rod(a, b, t, color, finish=None, shape='cylinder', t2=None, **kw):
    """A cylinder (or box) of thickness t running from point a to point b."""
    d = [b[i] - a[i] for i in range(3)]
    length = math.sqrt(sum(c * c for c in d))
    mid = [(a[i] + b[i]) / 2 for i in range(3)]
    return part(shape, [t, length, t2 or t], mid, color, finish, rotate=align_y(d), **kw)

M = {}      # key -> parts
FOOT = {}   # key -> footprint [x, z] tiles

# =============================================================================================
# Task 1: new objects
# =============================================================================================

# ---- Treadmill (1x2): belt along z, console at the -z end, the Sim walks facing -z ----------
DK, FR, BELT = '#2A2C30', '#6A6E74', '#18191B'
CON = [0, 1.3, -0.58]; CR = [-35, 0, 0]          # console pivot, tilted to face the runner
tm = [
    box([0.66, 0.1, 1.56], [0, 0.09, 0.12], DK, 'satin', radius=0.02),            # deck
    box([0.07, 0.05, 1.56], [-0.33, 0.165, 0.12], FR, 'metal', radius=0.015),     # side rails
    box([0.07, 0.05, 1.56], [0.33, 0.165, 0.12], FR, 'metal', radius=0.015),
    box([0.56, 0.016, 1.5], [0, 0.148, 0.12], BELT, 'matte', radius=0.006),       # belt
    box([0.6, 0.07, 0.06], [0, 0.1, 0.88], DK, 'satin', radius=0.02),             # rear end cap
    box([0.7, 0.2, 0.3], [0, 0.15, -0.78], DK, 'satin', radius=0.05),             # motor hood
    box([0.705, 0.025, 0.24], [0, 0.205, -0.78], '#3C8DBF', 'satin', radius=0.01),  # accent band
]
for x in (-0.28, 0.28):
    for z in (-0.86, 0.84):
        tm.append(box([0.06, 0.04, 0.08], [x, 0.02, z], BELT, 'matte', radius=0.01))     # feet
for s in (-1, 1):
    tm.append(rod([s * 0.3, 0.2, -0.8], [s * 0.3, 1.22, -0.62], 0.06, FR, 'metal', shape='box', t2=0.08, radius=0.02))  # uprights
    tm.append(rod([s * 0.33, 1.14, -0.6], [s * 0.33, 1.06, -0.28], 0.04, FR, 'metal'))   # handlebars
    tm.append(rod([s * 0.33, 1.08, -0.42], [s * 0.33, 1.06, -0.3], 0.05, BELT, 'matte'))  # foam grips
tm += [
    box([0.72, 0.3, 0.1], CON, DK, 'satin', radius=0.03, rotate=CR),                 # console
    box([0.34, 0.16, 0.006], on(CON, CR, [0, 0.03, 0.052]), '#0E2230', 'gloss', rotate=CR),  # screen
    box([0.6, 0.02, 0.006], on(CON, CR, [0, -0.07, 0.051]), '#3C8DBF', 'satin', rotate=CR),  # light strip
    cyl([0.07, 0.18, 0.07], [0.39, 1.0, -0.68], '#4A90C2', 'satin'),                 # water bottle
    cyl([0.075, 0.03, 0.075], [0.39, 0.9, -0.68], FR, 'metal'),                      # bottle holder
]
for i, (x, c) in enumerate([(-0.25, '#D9533F'), (-0.19, '#E8E8E5'), (0.19, '#E8E8E5'), (0.25, '#3E8EDE')]):
    tm.append(box([0.04, 0.03, 0.01], on(CON, CR, [x, -0.1, 0.052]), c, 'satin', radius=0.004, rotate=CR))  # buttons
tm.append(sph([0.03, 0.03, 0.03], on(CON, CR, [0, -0.11, 0.06]), '#D9533F', 'satin', segments=6))  # safety key
M['model.treadmill'] = tm; FOOT['model.treadmill'] = (1, 2)

# ---- Weight bench (1x2): bench along z, barbell rack at -z ----------------------------------
FR, PAD, RED, BAR, PLATE = '#34373C', '#2B2B2E', '#B33A32', '#D0D3D6', '#1C1C1E'
wb = [
    box([0.28, 0.09, 1.1], [0, 0.45, -0.05], PAD, 'satin', radius=0.035),           # pad
    box([0.26, 0.025, 1.06], [0, 0.393, -0.05], FR, 'metal', radius=0.006),         # pad board
    box([0.07, 0.07, 1.0], [0, 0.345, -0.05], FR, 'metal', radius=0.012),           # main beam
    rod([0, 0.31, 0.42], [0, 0.18, 0.62], 0.05, FR, 'metal', shape='box', radius=0.01),  # leg-hold arm
]
for z in (-0.42, 0.38):
    wb += [
        box([0.06, 0.3, 0.06], [0, 0.18, z], FR, 'metal', radius=0.01),             # leg posts
        box([0.44, 0.05, 0.07], [0, 0.03, z], FR, 'metal', radius=0.012),           # feet
    ]
    for s in (-1, 1):
        wb.append(box([0.05, 0.05, 0.075], [s * 0.21, 0.025, z], PLATE, 'matte', radius=0.012))  # rubber caps
for s in (-1, 1):
    wb += [
        cyl([0.1, 0.16, 0.1], [s * 0.1, 0.18, 0.66], PLATE, 'matte', rotate=[0, 0, 90]),     # foam rollers
        box([0.06, 1.2, 0.06], [s * 0.3, 0.62, -0.76], FR, 'metal', radius=0.012),           # rack posts
        box([0.08, 0.04, 0.36], [s * 0.3, 0.02, -0.74], FR, 'metal', radius=0.01),           # rack bases
        rod([s * 0.3, 0.04, -0.58], [s * 0.3, 0.42, -0.74], 0.04, FR, 'metal', shape='box', radius=0.008),  # braces
        box([0.05, 0.05, 0.1], [s * 0.3, 1.02, -0.69], RED, 'satin', radius=0.012),          # J-hooks
        box([0.05, 0.06, 0.02], [s * 0.3, 1.06, -0.645], RED, 'satin', radius=0.006),
        cyl([0.4, 0.03, 0.4], [s * 0.35, 1.07, -0.69], PLATE, 'matte', rotate=[0, 0, 90]),   # plates
        cyl([0.3, 0.03, 0.3], [s * 0.383, 1.07, -0.69], PLATE, 'matte', rotate=[0, 0, 90]),
        cyl([0.05, 0.025, 0.05], [s * 0.41, 1.07, -0.69], BAR, 'chrome', rotate=[0, 0, 90]),  # collars
    ]
wb += [
    box([0.54, 0.05, 0.05], [0, 0.26, -0.76], FR, 'metal', radius=0.01),           # rack cross brace
    cyl([0.028, 0.86, 0.028], [0, 1.07, -0.69], BAR, 'chrome', rotate=[0, 0, 90]),  # bar
]
for z in (0.3, 0.02):                                                               # dumbbells on the floor
    wb += [
        cyl([0.03, 0.24, 0.03], [0.37, 0.05, z], BAR, 'chrome', rotate=[90, 0, 0]),
        cyl([0.1, 0.06, 0.1], [0.37, 0.05, z - 0.085], PLATE, 'matte', rotate=[90, 0, 0], segments=6),
        cyl([0.1, 0.06, 0.1], [0.37, 0.05, z + 0.085], PLATE, 'matte', rotate=[90, 0, 0], segments=6),
    ]
M['model.weightBench'] = wb; FOOT['model.weightBench'] = (1, 2)

# ---- Chess table (1x1): 64 squares (merged, sharp boxes), two finishes ---------------------
TOP_Y = 0.72
ct = [
    box([0.62, 0.04, 0.62], [0, 0.7, 0], '#6E4B32', 'wood', radius=0.012),          # top
    box([0.54, 0.08, 0.54], [0, 0.64, 0], '#5A3C27', 'wood', radius=0.008),         # apron
    box([0.46, 0.012, 0.46], [0, TOP_Y + 0.006, 0], '#3B2618', 'wood', radius=0.004),  # board frame
]
for x in (-0.24, 0.24):
    for z in (-0.24, 0.24):
        ct.append(cyl([0.045, 0.62, 0.045], [x, 0.31, z], '#5A3C27', 'wood', taper=0.7, segments=10))  # legs
SQ, BY = 0.05, TOP_Y + 0.012 + 0.002
for i in range(8):
    for j in range(8):
        c = '#E9D7B4' if (i + j) % 2 == 0 else '#4A2E1C'
        ct.append(box([SQ, 0.004, SQ], [-0.175 + SQ * i, BY, -0.175 + SQ * j], c, 'wood', radius=0))
BT = BY + 0.002
def sq(i, j): return -0.175 + SQ * i, -0.175 + SQ * j
def pawn(i, j, c):
    x, z = sq(i, j)
    return [cyl([0.026, 0.03, 0.026], [x, BT + 0.015, z], c, 'gloss', taper=0.45, segments=10),
            sph([0.02, 0.02, 0.02], [x, BT + 0.036, z], c, 'gloss', segments=6)]
def tall(i, j, c, h, top):
    x, z = sq(i, j)
    p = [cyl([0.032, h, 0.032], [x, BT + h / 2, z], c, 'gloss', taper=0.5, segments=10)]
    if top == 'king':
        p.append(box([0.008, 0.024, 0.008], [x, BT + h + 0.012, z], c, 'gloss', radius=0.002))
    elif top == 'queen':
        p.append(sph([0.022, 0.016, 0.022], [x, BT + h + 0.005, z], c, 'gloss', segments=6))
    else:  # rook: flat crown
        p[0]['taper'] = 0.8
        p.append(cyl([0.03, 0.012, 0.03], [x, BT + h + 0.006, z], c, 'gloss', segments=8))
    return p
IV, EB = '#F2EDE2', '#1E1C1B'
for i, j in [(1, 6), (2, 5), (4, 4), (6, 6)]: ct += pawn(i, j, IV)
for i, j in [(2, 1), (3, 3), (5, 1), (6, 2)]: ct += pawn(i, j, EB)
ct += tall(4, 7, IV, 0.07, 'king') + tall(0, 7, IV, 0.045, 'rook') + tall(3, 6, IV, 0.06, 'queen')
ct += tall(4, 0, EB, 0.07, 'king') + tall(5, 3, EB, 0.06, 'queen') + tall(7, 0, EB, 0.045, 'rook')
ct += [cyl([0.026, 0.03, 0.026], [0.27, TOP_Y + 0.015, 0.2], EB, 'gloss', taper=0.45, segments=10, rotate=[0, 0, 90])]  # captured pawn
M['model.chessTable'] = ct; FOOT['model.chessTable'] = (1, 1)

# ---- Computer desk (2x1): desk across x, monitor + keyboard, office chair at +z -------------
DESK, LEG, CH = '#B08660', '#2B2D30', '#2C2E33'
cd = [
    box([1.8, 0.035, 0.56], [0, 0.7375, -0.16], DESK, 'wood', radius=0.01),        # top
    box([1.62, 0.3, 0.015], [0, 0.55, -0.4], LEG, 'metal', radius=0.004),           # modesty panel
    box([0.4, 0.4, 0.5], [0.58, 0.5, -0.17], DESK, 'wood', radius=0.01),           # drawer pedestal
]
for s in (-1, 1):
    cd += [
        box([0.05, 0.72, 0.05], [s * 0.84, 0.36, -0.38], LEG, 'metal', radius=0.01),
        box([0.05, 0.72, 0.05], [s * 0.84, 0.36, 0.06], LEG, 'metal', radius=0.01),
        box([0.05, 0.03, 0.52], [s * 0.84, 0.015, -0.16], LEG, 'metal', radius=0.008),
        box([0.05, 0.03, 0.52], [s * 0.84, 0.705, -0.16], LEG, 'metal', radius=0.008),
    ]
for y in (0.6, 0.4):
    cd += [box([0.38, 0.18, 0.015], [0.58, y, 0.0875], '#C29B72', 'wood', radius=0.006),   # drawer fronts
           box([0.14, 0.015, 0.02], [0.58, y + 0.06, 0.1], LEG, 'metal', radius=0.006)]   # pulls
cd += [
    box([0.24, 0.012, 0.18], [0, 0.761, -0.33], LEG, 'metal', radius=0.006),       # monitor base
    box([0.04, 0.24, 0.025], [0, 0.88, -0.36], LEG, 'metal', radius=0.008),         # neck
    box([0.64, 0.38, 0.03], [0, 1.02, -0.33], '#16171A', 'satin', radius=0.008),    # monitor body
    box([0.62, 0.35, 0.004], [0, 1.025, -0.3135], '#0B1620', 'gloss', radius=0.002),  # screen
    box([0.44, 0.02, 0.14], [0, 0.765, -0.06], '#2A2B2E', 'satin', radius=0.008),   # keyboard
    box([0.42, 0.006, 0.12], [0, 0.777, -0.06], '#3A3B3F', 'satin', radius=0.003),  # keys
    box([0.22, 0.003, 0.18], [0.32, 0.7565, -0.06], '#3E4A5C', 'satin', radius=0.01),  # mouse pad
    sph([0.06, 0.035, 0.1], [0.32, 0.77, -0.06], '#2A2B2E', 'satin', segments=8),  # mouse
    cyl([0.08, 0.1, 0.08], [-0.5, 0.805, -0.2], '#C4573A', 'satin'),                # mug
    box([0.015, 0.06, 0.04], [-0.455, 0.805, -0.2], '#C4573A', 'satin', radius=0.007),
    box([0.21, 0.012, 0.3], [-0.72, 0.761, -0.2], '#F4F2EC', 'satin', radius=0.002, rotate=[0, 10, 0]),  # papers
    cyl([0.12, 0.02, 0.12], [-0.72, 0.765, -0.36], LEG, 'metal'),                   # desk lamp
    rod([-0.72, 0.775, -0.36], [-0.68, 1.1, -0.34], 0.018, LEG, 'metal'),
    rod([-0.68, 1.1, -0.34], [-0.52, 1.14, -0.26], 0.018, LEG, 'metal'),
    cyl([0.13, 0.1, 0.13], [-0.5, 1.1, -0.25], LEG, 'metal', taper=0.45),
]
CZ = 0.2                                                                            # chair
cd += [
    cyl([0.07, 0.04, 0.07], [0, 0.07, CZ], LEG, 'metal'),
    cyl([0.045, 0.3, 0.045], [0, 0.23, CZ], '#9EA3A8', 'metal'),                    # gas lift
    box([0.2, 0.04, 0.2], [0, 0.39, CZ], LEG, 'metal', radius=0.01),
    box([0.48, 0.08, 0.46], [0, 0.45, CZ], CH, 'satin', radius=0.035),              # seat
    box([0.44, 0.52, 0.06], [0, 0.82, 0.38], CH, 'satin', radius=0.03, rotate=[8, 0, 0]),  # back
    box([0.05, 0.3, 0.03], [0, 0.55, 0.405], LEG, 'metal', radius=0.008),
]
for k in range(5):
    a = math.radians(36 + 72 * k)
    cd += [box([0.04, 0.03, 0.22], [0.11 * math.sin(a), 0.06, CZ + 0.11 * math.cos(a)], LEG, 'metal', radius=0.01, rotate=[0, 36 + 72 * k, 0]),
           sph([0.045, 0.045, 0.045], [0.22 * math.sin(a), 0.0225, CZ + 0.22 * math.cos(a)], '#151618', 'satin', segments=6)]
for s in (-1, 1):
    cd += [box([0.03, 0.2, 0.04], [s * 0.22, 0.58, 0.22], LEG, 'metal', radius=0.008),   # armrests
           box([0.06, 0.025, 0.24], [s * 0.22, 0.69, 0.2], CH, 'satin', radius=0.01)]
M['model.computerDesk'] = cd; FOOT['model.computerDesk'] = (2, 1)

# ---- Easel (1x1): wooden A-frame, landscape on the canvas -----------------------------------
EW, EWD = '#B98B5E', '#9A6E47'
LEAN = math.degrees(math.atan2(0.22, 1.72))      # front legs lean back by this much
ER = [-LEAN, 0, 0]
CP = [0, 1.2, 0.16 - 0.128 * 1.2]                # canvas pivot on the leg plane
es = [
    rod([-0.3, 0.012, 0.16], [-0.05, 1.72, -0.06], 0.045, EW, 'wood', shape='box', t2=0.03, radius=0.008),  # front legs
    rod([0.3, 0.012, 0.16], [0.05, 1.72, -0.06], 0.045, EW, 'wood', shape='box', t2=0.03, radius=0.008),
    rod([0, 0.012, -0.4], [0, 1.64, -0.08], 0.04, EW, 'wood', shape='box', t2=0.03, radius=0.008),       # back leg
    box([0.12, 0.08, 0.07], [0, 1.69, -0.06], EWD, 'wood', radius=0.015),          # top block
    box([0.47, 0.03, 0.02], [0, 0.45, 0.16 - 0.128 * 0.45], EW, 'wood', radius=0.006, rotate=ER),  # brace
    box([0.64, 0.025, 0.09], [0, 0.83, 0.105], EWD, 'wood', radius=0.006),         # canvas tray
    box([0.64, 0.04, 0.012], [0, 0.85, 0.148], EWD, 'wood', radius=0.004),         # tray lip
    box([0.56, 0.72, 0.025], on(CP, ER, [0, 0, 0.035]), '#F3EFE6', 'matte', radius=0.004, rotate=ER),  # canvas
    box([0.1, 0.06, 0.05], on(CP, ER, [0, 0.38, 0.035]), EWD, 'wood', radius=0.01, rotate=ER),        # clamp
    # painting (layers stacked a few mm apart)
    box([0.52, 0.3, 0.003], on(CP, ER, [0, 0.19, 0.049]), '#9CC3DB', 'matte', radius=0, rotate=ER),  # sky
    box([0.52, 0.38, 0.003], on(CP, ER, [0, -0.15, 0.049]), '#7FA35B', 'matte', radius=0, rotate=ER),  # field
    sph([0.34, 0.2, 0.004], on(CP, ER, [-0.11, 0.04, 0.051]), '#5E8445', 'matte', segments=10, rotate=ER),  # hill
    sph([0.24, 0.12, 0.004], on(CP, ER, [0.15, 0.03, 0.0515]), '#6E9450', 'matte', segments=10, rotate=ER),
    box([0.2, 0.05, 0.003], on(CP, ER, [0.05, -0.2, 0.051]), '#5E8FB0', 'matte', radius=0, rotate=ER),  # pond
    cyl([0.07, 0.003, 0.07], on(CP, ER, [0.16, 0.24, 0.051]), '#F2C14E', 'matte', rotate=[90 - LEAN, 0, 0]),  # sun
    cyl([0.16, 0.012, 0.09], [0.14, 0.849, 0.1], '#D2B48A', 'wood'),               # palette
    cyl([0.07, 0.07, 0.07], [0.33, 0.035, 0.3], '#7E9AA8', 'satin', taper=0.9),    # brush jar
]
for k, c in enumerate(['#D9483B', '#F2C14E', '#3E6FB0', '#F0EDE6']):
    es.append(sph([0.022, 0.012, 0.022], [0.09 + k * 0.032, 0.857, 0.1 + (k % 2) * 0.02 - 0.01], c, 'satin', segments=6))  # paint dabs
for k, (dx, dz, c) in enumerate([(-0.012, 0.0, '#C9A77C'), (0.012, 0.01, '#B33A32'), (0.0, -0.012, '#2B2B2E')]):
    a, b = [0.33 + dx, 0.03, 0.3 + dz], [0.33 + dx * 4, 0.3, 0.3 + dz * 4]
    es.append(rod(a, b, 0.008, c, 'satin'))                                       # brushes
M['model.easel'] = es; FOOT['model.easel'] = (1, 1)

# ---- Mirror (1x1): cheval floor mirror tilting between two posts ---------------------------
MW, BRASS = '#7A563A', '#B8925A'
MP, MR = [0, 0.95, -0.05], [-6, 0, 0]
mi = [
    box([0.53, 1.53, 0.008], on(MP, MR, [0, 0, 0.006]), '#E3E8EC', 'chrome', radius=0.003, rotate=MR),  # glass
    box([0.58, 1.58, 0.012], on(MP, MR, [0, 0, -0.012]), '#5A3F2A', 'wood', radius=0.004, rotate=MR),  # backing
    box([0.68, 0.045, 0.06], on(MP, MR, [0, 0.83, 0]), MW, 'wood', radius=0.012, rotate=MR),          # crown
    sph([0.07, 0.07, 0.04], on(MP, MR, [0, 0.875, 0]), MW, 'wood', segments=8, rotate=MR),          # crest
    box([0.75, 0.04, 0.035], [0, 0.06, -0.05], MW, 'wood', radius=0.008),                         # stretcher
]
for s in (-1, 1):
    mi += [
        box([0.05, 1.62, 0.045], on(MP, MR, [s * 0.285, 0, 0]), MW, 'wood', radius=0.012, rotate=MR),   # stiles
        box([0.62, 0.05, 0.045], on(MP, MR, [0, s * 0.785, 0]), MW, 'wood', radius=0.012, rotate=MR),   # rails
        box([0.045, 1.0, 0.045], [s * 0.35, 0.5, -0.05], MW, 'wood', radius=0.01),          # posts
        box([0.06, 0.045, 0.56], [s * 0.35, 0.0225, -0.05], MW, 'wood', radius=0.012),      # feet
        sph([0.06, 0.06, 0.06], [s * 0.35, 1.02, -0.05], MW, 'wood', segments=8),          # finials
        cyl([0.05, 0.03, 0.05], [s * 0.386, 0.95, -0.05], BRASS, 'metal', rotate=[0, 0, 90]),  # pivot knobs
    ]
M['model.mirror'] = mi; FOOT['model.mirror'] = (1, 1)

# ---- Workbench (2x1): bench, vice, pegboard with tools, toolbox -----------------------------
WT, WL, PEG, STEEL = '#B88A5A', '#9C7046', '#B9946A', '#8F949A'
wk = [
    box([1.8, 0.06, 0.6], [0, 0.88, -0.13], WT, 'wood', radius=0.01),             # top
    box([1.7, 0.1, 0.03], [0, 0.8, 0.15], WL, 'wood', radius=0.006),               # apron
    box([1.64, 0.03, 0.5], [0, 0.18, -0.135], WL, 'wood', radius=0.006),           # lower shelf
    box([1.8, 0.9, 0.025], [0, 1.37, -0.43], PEG, 'wood', radius=0.004),           # pegboard
    box([1.8, 0.025, 0.14], [0, 1.83, -0.37], WL, 'wood', radius=0.006),           # top shelf
    cyl([0.12, 0.14, 0.12], [-0.62, 1.912, -0.36], STEEL, 'metal'),                # paint cans
    cyl([0.1, 0.11, 0.1], [-0.47, 1.897, -0.36], '#3E6FB0', 'satin'),
    cyl([0.08, 0.12, 0.08], [0.6, 1.902, -0.36], '#D8D2C4', 'satin'),              # jar
    # hammer, wrench, screwdrivers, saw, pliers, tape on the pegboard
    box([0.03, 0.28, 0.02], [-0.7, 1.3, -0.405], '#D9BC94', 'wood', radius=0.008),
    box([0.13, 0.035, 0.03], [-0.7, 1.45, -0.4], STEEL, 'metal', radius=0.006),
    box([0.025, 0.24, 0.01], [-0.53, 1.32, -0.41], STEEL, 'metal', radius=0.004, rotate=[0, 0, 12]),
    box([0.05, 0.04, 0.01], [-0.555, 1.44, -0.41], STEEL, 'metal', radius=0.004, rotate=[0, 0, 12]),
    box([0.36, 0.11, 0.004], [0.02, 1.58, -0.414], '#C9CCD0', 'metal', radius=0.002),   # saw blade
    box([0.11, 0.1, 0.025], [0.25, 1.6, -0.405], RED, 'satin', radius=0.012),         # saw handle
    rod([0.44, 1.2, -0.41], [0.47, 1.4, -0.41], 0.016, RED, 'satin'),                 # pliers
    rod([0.5, 1.2, -0.41], [0.47, 1.4, -0.41], 0.016, RED, 'satin'),
    box([0.03, 0.05, 0.012], [0.47, 1.42, -0.41], STEEL, 'metal', radius=0.004),
    box([0.07, 0.07, 0.04], [0.66, 1.45, -0.4], '#E0B03C', 'satin', radius=0.012),     # tape measure
    # vice on the front-left corner
    box([0.16, 0.06, 0.16], [-0.62, 0.94, 0.06], '#3E5B78', 'satin', radius=0.012),
    box([0.18, 0.1, 0.04], [-0.62, 1.02, 0.05], '#3E5B78', 'satin', radius=0.01),
    box([0.18, 0.09, 0.04], [-0.62, 1.015, 0.14], '#3E5B78', 'satin', radius=0.01),
    cyl([0.025, 0.16, 0.025], [-0.62, 0.99, 0.2], STEEL, 'metal', rotate=[90, 0, 0]),
    cyl([0.015, 0.2, 0.015], [-0.62, 0.99, 0.28], STEEL, 'metal', rotate=[0, 0, 90]),
    # toolbox, plank, pencil
    box([0.4, 0.16, 0.2], [0.5, 0.99, -0.25], '#B5372E', 'satin', radius=0.015),
    box([0.405, 0.012, 0.205], [0.5, 1.03, -0.25], '#8E2A23', 'satin', radius=0.004),
    box([0.2, 0.02, 0.02], [0.5, 1.11, -0.25], STEEL, 'metal', radius=0.006),
    box([0.02, 0.04, 0.02], [0.41, 1.09, -0.25], STEEL, 'metal', radius=0.005),
    box([0.02, 0.04, 0.02], [0.59, 1.09, -0.25], STEEL, 'metal', radius=0.005),
    box([0.6, 0.03, 0.12], [-0.05, 0.925, 0.0], '#D9BC94', 'wood', radius=0.006, rotate=[0, 8, 0]),
    cyl([0.01, 0.16, 0.01], [0.15, 0.916, 0.08], '#E0B03C', 'satin', rotate=[0, 30, 90], segments=6),
    # lower shelf: crate and bucket
    box([0.4, 0.22, 0.3], [0.45, 0.305, -0.15], '#C9A77C', 'wood', radius=0.01),
    cyl([0.24, 0.24, 0.24], [-0.45, 0.315, -0.15], STEEL, 'metal', taper=1.15),
]
for x, c in [(-0.36, '#B33A32'), (-0.3, '#E0B03C'), (-0.24, '#3E6FB0')]:
    wk += [cyl([0.028, 0.1, 0.028], [x, 1.42, -0.4], c, 'satin', segments=8),
           cyl([0.008, 0.12, 0.008], [x, 1.31, -0.4], STEEL, 'metal', segments=6)]
for x in (-0.84, 0.84):
    for z in (-0.39, 0.12):
        wk.append(box([0.07, 0.85, 0.07], [x, 0.425, z], WL, 'wood', radius=0.01))  # legs
M['model.workbench'] = wk; FOOT['model.workbench'] = (2, 1)

# ---- Telescope (1x1): tripod, tube pointing up and back, eyepiece at the front -------------
TM, TUBE, BLACK, CHR = '#3A3D42', '#22314F', '#1A1A1C', '#D0D3D6'
te = [
    box([0.1, 0.1, 0.1], [0, 1.0, 0], TM, 'metal', radius=0.015),                  # mount head
    box([0.03, 0.16, 0.07], [0.075, 1.1, 0], TM, 'metal', radius=0.008),           # fork arm
    cyl([0.26, 0.015, 0.26], [0, 0.45, 0], TM, 'metal', segments=3),               # accessory tray
    cyl([0.03, 0.05, 0.03], [0.04, 0.48, 0.02], CHR, 'chrome'),                    # spare eyepieces
    cyl([0.03, 0.05, 0.03], [-0.03, 0.48, -0.03], CHR, 'chrome'),
]
for a_deg in (180, 60, 300):
    a = math.radians(a_deg)
    top = [0.05 * math.sin(a), 0.97, 0.05 * math.cos(a)]
    foot = [0.36 * math.sin(a), 0.012, 0.36 * math.cos(a)]
    k = (0.97 - 0.45) / 0.97
    mid = [top[0] + (foot[0] - top[0]) * k, 0.45, top[2] + (foot[2] - top[2]) * k]
    te += [rod(top, foot, 0.035, TM, 'metal', shape='box', t2=0.025, radius=0.008),
           rod([0, 0.45, 0], mid, 0.012, TM, 'metal'),                             # tray arms
           sph([0.04, 0.03, 0.04], [foot[0], 0.015, foot[2]], BLACK, 'matte', segments=6)]
TA = 35
d = [0, math.sin(math.radians(TA)), -math.cos(math.radians(TA))]                    # toward the objective
up = [0, math.cos(math.radians(TA)), math.sin(math.radians(TA))]
TR = align_y(d)
C = [0, 1.18, -0.012]
def along(t, u=0.0): return [C[i] + d[i] * t + up[i] * u for i in range(3)]
te += [
    cyl([0.12, 0.84, 0.12], C, TUBE, 'gloss', rotate=TR),                          # tube
    cyl([0.135, 0.16, 0.135], along(0.36), BLACK, 'matte', rotate=TR),             # dew shield
    cyl([0.1, 0.05, 0.1], along(-0.43), BLACK, 'matte', rotate=TR),                # rear cell
    cyl([0.04, 0.07, 0.04], along(-0.48), CHR, 'chrome', rotate=TR),               # focuser
    cyl([0.035, 0.07, 0.035], along(-0.48, 0.05), BLACK, 'matte', rotate=align_y(up)),  # eyepiece
    cyl([0.135, 0.03, 0.135], along(-0.15), CHR, 'chrome', rotate=TR),             # tube rings
    cyl([0.135, 0.03, 0.135], along(0.15), CHR, 'chrome', rotate=TR),
    cyl([0.035, 0.22, 0.035], along(0.05, 0.1), TUBE, 'gloss', rotate=TR),         # finder scope
    box([0.02, 0.04, 0.02], along(0.05, 0.075), CHR, 'chrome', radius=0.005, rotate=TR),
]
M['model.telescope'] = te; FOOT['model.telescope'] = (1, 1)

# ---- Piano (2x1): upright, keys facing +z, bench in front -----------------------------------
BK = '#141414'
pi = [
    box([1.48, 1.18, 0.3], [0, 0.63, -0.29], BK, 'gloss', radius=0.012),           # case
    box([1.52, 0.04, 0.33], [0, 1.24, -0.285], BK, 'gloss', radius=0.012),         # lid
    box([1.46, 0.04, 0.29], [0, 0.02, -0.29], '#0E0E0E', 'gloss', radius=0.006),   # plinth
    box([1.34, 0.38, 0.035], [0, 1.0, -0.125], BK, 'gloss', radius=0.01),          # upper panel
    box([1.3, 0.04, 0.03], [0, 0.79, -0.12], BK, 'gloss', radius=0.006),           # name board
    box([1.34, 0.56, 0.02], [0, 0.34, -0.13], '#1B1B1B', 'gloss', radius=0.006),   # lower panel
    box([1.33, 0.06, 0.25], [0, 0.69, -0.02], BK, 'gloss', radius=0.008),          # key bed
    box([1.3, 0.022, 0.15], [0, 0.731, 0.025], '#F4F1EA', 'satin', radius=0.002),  # white keys
    box([0.7, 0.025, 0.05], [0, 0.86, -0.09], BK, 'gloss', radius=0.006),          # music ledge
    box([0.44, 0.3, 0.004], [0, 1.0, -0.102], '#F7F3E8', 'satin', radius=0.001, rotate=[-8, 0, 0]),  # sheet music
]
for s in (-1, 1):
    pi += [box([0.07, 0.16, 0.3], [s * 0.7, 0.75, -0.02], BK, 'gloss', radius=0.015),   # cheek blocks
           box([0.06, 0.62, 0.06], [s * 0.64, 0.35, 0.04], BK, 'gloss', radius=0.012),  # front legs
           box([0.07, 0.04, 0.12], [s * 0.64, 0.02, 0.02], BK, 'gloss', radius=0.01)]   # toe blocks
WK = 1.3 / 35
for o in range(5):
    for k in (0, 1, 3, 4, 5):
        pi.append(box([0.02, 0.014, 0.09], [-0.65 + (o * 7 + k + 1) * WK, 0.749, -0.02], '#0C0C0C', 'gloss', radius=0.002))
for x in (-0.08, 0, 0.08):
    pi.append(box([0.035, 0.02, 0.1], [x, 0.07, -0.08], BRASS, 'metal', radius=0.006))  # pedals
pi += [
    box([0.76, 0.06, 0.32], [0, 0.47, 0.27], BK, 'gloss', radius=0.012),           # bench
    box([0.72, 0.05, 0.28], [0, 0.525, 0.27], '#7A2E2E', 'fabric', radius=0.025),  # cushion
    box([0.66, 0.06, 0.24], [0, 0.42, 0.27], BK, 'gloss', radius=0.008),           # bench apron
]
for x in (-0.33, 0.33):
    for z in (0.15, 0.39):
        pi.append(box([0.05, 0.44, 0.05], [x, 0.22, z], BK, 'gloss', radius=0.01))
M['model.piano'] = pi; FOOT['model.piano'] = (2, 1)

# ---- Floor lamp (1x1): bronze stand, warm cream fabric shade --------------------------------
BRZ = '#3A3530'
la = [
    cyl([0.3, 0.03, 0.3], [0, 0.015, 0], BRZ, 'metal', taper=0.92),                # base
    cyl([0.2, 0.03, 0.2], [0, 0.045, 0], BRZ, 'metal', taper=0.5),
    cyl([0.024, 1.38, 0.024], [0, 0.75, 0], BRZ, 'metal'),                          # pole
    cyl([0.04, 0.03, 0.04], [0, 0.5, 0], BRASS, 'metal'),                           # collars
    cyl([0.04, 0.03, 0.04], [0, 1.0, 0], BRASS, 'metal'),
    cyl([0.05, 0.08, 0.05], [0, 1.47, 0], BRASS, 'metal'),                          # socket
    sph([0.07, 0.09, 0.07], [0, 1.54, 0], '#FFF4D6', 'satin'),                      # bulb
    rod([-0.035, 1.45, 0], [0, 1.73, 0], 0.008, BRASS, 'metal'),                   # harp
    rod([0.035, 1.45, 0], [0, 1.73, 0], 0.008, BRASS, 'metal'),
    cyl([0.44, 0.34, 0.44], [0, 1.6, 0], '#F2E6CC', 'fabric', taper=0.72),          # shade
    cyl([0.448, 0.016, 0.448], [0, 1.436, 0], '#E3D2B0', 'fabric'),                 # trims
    cyl([0.325, 0.016, 0.325], [0, 1.764, 0], '#E3D2B0', 'fabric'),
    sph([0.035, 0.035, 0.035], [0, 1.79, 0], BRASS, 'metal', segments=8),           # finial
    cyl([0.004, 0.12, 0.004], [0.04, 1.37, 0], BRASS, 'metal', segments=4),         # pull chain
    sph([0.015, 0.02, 0.015], [0.04, 1.3, 0], BRASS, 'metal', segments=6),
]
M['model.lamp'] = la; FOOT['model.lamp'] = (1, 1)

# ---- Dining table (2x1): table for two, one chair at each end facing the middle ------------
OAK, OAKD = '#A9744A', '#8A5A36'
dt = [
    box([1.0, 0.04, 0.8], [0, 0.745, 0], OAK, 'wood', radius=0.015),               # top
    box([0.9, 0.08, 0.7], [0, 0.665, 0], OAKD, 'wood', radius=0.008),              # apron
    box([0.24, 0.005, 0.82], [0, 0.7675, 0], '#E8DCC0', 'fabric', radius=0.002),    # runner
    cyl([0.1, 0.18, 0.1], [0, 0.855, 0], '#D8D2C4', 'gloss', taper=0.65),           # vase
]
for x in (-0.42, 0.42):
    for z in (-0.32, 0.32):
        dt.append(cyl([0.06, 0.725, 0.06], [x, 0.3625, z], OAKD, 'wood', taper=0.7, segments=12))  # legs
for x, z, c in [(-0.025, 0.01, '#D9483B'), (0.025, -0.015, '#F2C14E'), (0.0, 0.03, '#F0EDE6')]:
    dt.append(sph([0.06, 0.05, 0.06], [x, 0.96, z], c, 'satin', segments=6))      # flowers
for s in (-1, 1):
    dt += [
        cyl([0.24, 0.015, 0.24], [s * 0.3, 0.7725, 0], '#F5F3EE', 'gloss'),             # plate
        cyl([0.06, 0.11, 0.06], [s * 0.3, 0.82, s * 0.2], '#DCE6EA', 'gloss', taper=1.1),  # glass
        box([0.17, 0.004, 0.015], [s * 0.3, 0.767, 0.15], '#B9BDC1', 'satin', radius=0.002),   # cutlery
        box([0.17, 0.004, 0.015], [s * 0.3, 0.767, -0.15], '#B9BDC1', 'satin', radius=0.002),
    ]
    cx = s * 0.7                                                                     # chair, back outward
    dt += [
        box([0.42, 0.04, 0.42], [cx, 0.45, 0], OAK, 'wood', radius=0.012),         # seat
        box([0.38, 0.04, 0.38], [cx, 0.49, 0], '#9DAF8C', 'fabric', radius=0.018),  # cushion
        box([0.035, 0.43, 0.035], [s * 0.52, 0.215, -0.18], OAKD, 'wood', radius=0.008),  # front legs
        box([0.035, 0.43, 0.035], [s * 0.52, 0.215, 0.18], OAKD, 'wood', radius=0.008),
        box([0.035, 0.95, 0.035], [s * 0.885, 0.475, -0.18], OAKD, 'wood', radius=0.008),  # back posts
        box([0.035, 0.95, 0.035], [s * 0.885, 0.475, 0.18], OAKD, 'wood', radius=0.008),
        box([0.04, 0.08, 0.4], [s * 0.885, 0.9, 0], OAK, 'wood', radius=0.015),     # top rail
        box([0.33, 0.025, 0.02], [cx, 0.15, -0.18], OAKD, 'wood', radius=0.006),    # stretchers
        box([0.33, 0.025, 0.02], [cx, 0.15, 0.18], OAKD, 'wood', radius=0.006),
    ]
    for z in (-0.1, 0.0, 0.1):
        dt.append(box([0.02, 0.36, 0.04], [s * 0.885, 0.68, z], OAK, 'wood', radius=0.006))  # slats
M['model.diningTable'] = dt; FOOT['model.diningTable'] = (2, 1)

# =============================================================================================
# Task 2: style variants. modern = dark greys/black/chrome, gloss; cozy = warm wood, cream,
# earthy fabrics, rounder; minimal = white/light oak/pale, thin, very clean.
# =============================================================================================
LOAK = '#D6B98F'          # light oak (minimal)
HONEY = '#9C6B43'         # warm wood (cozy)
CHROME = '#D0D3D6'
CREAM = '#EFE5D3'
RUST, MUSTARD, SAGE, ROSE = '#B5653F', '#D6A64A', '#9DAF8C', '#C98E86'

# ---- Fridge (1x1) ------------------------------------------------------------------------
GR = '#2F3236'
v = [
    box([0.78, 0.08, 0.56], [0, 0.04, -0.14], '#141518', 'satin', radius=0.01),    # plinth
    box([0.82, 1.82, 0.6], [0, 0.99, -0.14], GR, 'metal', radius=0.02),            # cabinet
    box([0.405, 1.08, 0.05], [-0.2075, 1.33, 0.185], GR, 'metal', radius=0.012),   # french doors
    box([0.405, 1.08, 0.05], [0.2075, 1.33, 0.185], GR, 'metal', radius=0.012),
    box([0.82, 0.68, 0.05], [0, 0.43, 0.185], GR, 'metal', radius=0.012),          # freezer drawer
    box([0.5, 0.022, 0.022], [0, 0.7, 0.25], CHROME, 'chrome', radius=0.008),       # drawer bar
    box([0.18, 0.3, 0.006], [-0.2, 1.3, 0.213], '#0F1012', 'gloss', radius=0.01),  # dispenser panel
    box([0.11, 0.15, 0.004], [-0.2, 1.26, 0.217], '#22252A', 'gloss', radius=0.008),
    box([0.08, 0.025, 0.004], [-0.2, 1.41, 0.217], '#2A6F9E', 'gloss', radius=0.003),  # display
]
for s in (-1, 1):
    v += [box([0.022, 0.7, 0.022], [s * 0.035, 1.33, 0.25], CHROME, 'chrome', radius=0.008),   # bar handles
          box([0.02, 0.02, 0.045], [s * 0.035, 1.02, 0.225], CHROME, 'chrome', radius=0.005),
          box([0.02, 0.02, 0.045], [s * 0.035, 1.64, 0.225], CHROME, 'chrome', radius=0.005),
          box([0.02, 0.02, 0.045], [s * 0.22, 0.7, 0.225], CHROME, 'chrome', radius=0.005)]
M['model.fridge@modern'] = v

BUTTER = '#EFE2BF'
v = [
    box([0.74, 1.6, 0.58], [0, 0.88, -0.15], BUTTER, 'gloss', radius=0.09),        # rounded body
    box([0.7, 1.1, 0.06], [0, 0.66, 0.16], BUTTER, 'gloss', radius=0.05),          # door
    box([0.7, 0.42, 0.06], [0, 1.44, 0.16], BUTTER, 'gloss', radius=0.05),         # freezer door
    box([0.72, 0.02, 0.02], [0, 1.22, 0.18], CHROME, 'chrome', radius=0.008),       # trim
    box([0.05, 0.2, 0.05], [0.29, 1.0, 0.215], CHROME, 'chrome', radius=0.02),      # lever handles
    box([0.05, 0.12, 0.05], [0.29, 1.36, 0.215], CHROME, 'chrome', radius=0.02),
    box([0.14, 0.03, 0.008], [0, 1.12, 0.193], CHROME, 'chrome', radius=0.006),     # badge
    box([0.16, 0.2, 0.004], [-0.13, 0.8, 0.192], '#FBF7EE', 'satin', radius=0.002),  # child's drawing
    box([0.1, 0.06, 0.003], [-0.13, 0.76, 0.195], '#7FA35B', 'satin', radius=0.001),
    cyl([0.11, 0.16, 0.11], [0.15, 1.76, -0.15], '#C46B4A', 'satin'),              # cookie jar
    sph([0.1, 0.06, 0.1], [0.15, 1.85, -0.15], '#C46B4A', 'satin', segments=8),
]
for x, z in [(-0.3, -0.38), (0.3, -0.38), (-0.3, 0.08), (0.3, 0.08)]:
    v.append(cyl([0.05, 0.08, 0.05], [x, 0.04, z], CHROME, 'chrome', taper=0.7))   # legs
for y in (0.3, 1.0, 1.5):
    v.append(box([0.03, 0.08, 0.03], [-0.355, y, 0.17], CHROME, 'chrome', radius=0.01))  # hinges
for (x, y), c in zip([(-0.18, 0.9), (-0.07, 0.69), (0.1, 0.85)], ['#D9483B', '#F2C14E', '#4E9C9A']):
    v.append(cyl([0.03, 0.01, 0.03], [x, y, 0.195], c, 'satin', rotate=[90, 0, 0], segments=8))  # magnets
M['model.fridge@cozy'] = v

v = [
    box([0.7, 0.07, 0.54], [0, 0.035, -0.16], LOAK, 'wood', radius=0.006),         # oak plinth
    box([0.76, 1.84, 0.6], [0, 0.99, -0.15], '#F4F4F1', 'satin', radius=0.01),     # cabinet
    box([0.76, 1.18, 0.035], [0, 0.66, 0.1675], '#F4F4F1', 'satin', radius=0.008),  # doors
    box([0.76, 0.64, 0.035], [0, 1.59, 0.1675], '#F4F4F1', 'satin', radius=0.008),
    box([0.76, 0.012, 0.006], [0, 1.26, 0.18], '#C9C9C5', 'matte', radius=0.001),  # shadow gap
    box([0.014, 0.5, 0.03], [0.35, 0.95, 0.2], LOAK, 'wood', radius=0.006),         # oak pulls
    box([0.014, 0.25, 0.03], [0.35, 1.45, 0.2], LOAK, 'wood', radius=0.006),
    cyl([0.1, 0.18, 0.1], [-0.15, 2.0, -0.2], '#E7E1D6', 'satin', taper=0.8),      # jug
    cyl([0.07, 0.1, 0.07], [0.05, 1.96, -0.25], '#C9C9C5', 'matte', taper=1.2),    # small pot
]
M['model.fridge@minimal'] = v

# ---- Sink (1x1) --------------------------------------------------------------------------
def tap_arc(x, z0, z1, ybase, h, t, color, finish):
    """Gooseneck: column, arc over the basin, short drop."""
    return [cyl([t * 1.6, 0.03, t * 1.6], [x, ybase + 0.015, z0], color, finish),
            rod([x, ybase, z0], [x, ybase + h, z0], t, color, finish),
            rod([x, ybase + h, z0], [x, ybase + h + 0.05, (z0 * 2 + z1) / 3], t, color, finish),
            rod([x, ybase + h + 0.05, (z0 * 2 + z1) / 3], [x, ybase + h + 0.03, z1], t, color, finish),
            rod([x, ybase + h + 0.03, z1], [x, ybase + h - 0.04, z1 + 0.01], t, color, finish)]
v = [
    box([0.84, 0.1, 0.5], [0, 0.05, -0.18], '#111214', 'satin', radius=0.005),     # plinth
    box([0.88, 0.76, 0.56], [0, 0.48, -0.165], '#2B2D30', 'satin', radius=0.006),  # cabinet
    box([0.435, 0.74, 0.02], [-0.2225, 0.48, 0.125], '#2B2D30', 'satin', radius=0.004),  # doors
    box([0.435, 0.74, 0.02], [0.2225, 0.48, 0.125], '#2B2D30', 'satin', radius=0.004),
    box([0.015, 0.3, 0.025], [-0.04, 0.66, 0.15], CHROME, 'chrome', radius=0.006),  # bar pulls
    box([0.015, 0.3, 0.025], [0.04, 0.66, 0.15], CHROME, 'chrome', radius=0.006),
    box([0.9, 0.03, 0.6], [0, 0.875, -0.145], '#1A1A1C', 'gloss', radius=0.004),   # black quartz
    box([0.5, 0.004, 0.36], [0, 0.892, -0.13], '#9EA3A8', 'metal', radius=0.01),   # undermount basin
    box([0.46, 0.004, 0.32], [0, 0.894, -0.13], '#5F6368', 'metal', radius=0.008),
    cyl([0.05, 0.003, 0.05], [0, 0.897, -0.13], CHROME, 'chrome'),                  # drain
    cyl([0.06, 0.14, 0.06], [0.3, 0.96, -0.37], '#26282B', 'satin'),               # soap pump
    cyl([0.02, 0.04, 0.02], [0.3, 1.05, -0.37], CHROME, 'chrome'),
]
v += tap_arc(0, -0.39, -0.2, 0.89, 0.3, 0.026, CHROME, 'chrome')
v.append(rod([0.02, 1.0, -0.39], [0.08, 1.04, -0.39], 0.014, CHROME, 'chrome'))     # lever
M['model.sink@modern'] = v

SAGE_C = '#A7B59A'
v = [
    box([0.84, 0.1, 0.5], [0, 0.05, -0.18], '#8E9C82', 'satin', radius=0.005),     # plinth
    box([0.88, 0.76, 0.56], [0, 0.48, -0.165], SAGE_C, 'satin', radius=0.008),     # cabinet
    box([0.62, 0.24, 0.52], [0, 0.74, -0.12], '#F6F4EE', 'gloss', radius=0.03),    # apron-front sink
    box([0.54, 0.004, 0.42], [0, 0.862, -0.13], '#DAD6CD', 'gloss', radius=0.04),  # basin inside
    box([0.13, 0.04, 0.6], [-0.385, 0.88, -0.145], '#B5824F', 'wood', radius=0.006),  # butcher block
    box([0.13, 0.04, 0.6], [0.385, 0.88, -0.145], '#B5824F', 'wood', radius=0.006),
    box([0.62, 0.04, 0.08], [0, 0.88, -0.405], '#B5824F', 'wood', radius=0.006),
    box([0.02, 0.26, 0.18], [0.41, 1.03, -0.36], '#C9925A', 'wood', radius=0.02, rotate=[0, 0, 6]),  # cutting board
    rod([-0.1, 0.9, -0.4], [0.1, 0.9, -0.4], 0.024, BRASS, 'metal'),                # bridge tap
    rod([0, 0.9, -0.4], [0, 1.1, -0.4], 0.024, BRASS, 'metal'),
    rod([0, 1.1, -0.4], [0, 1.1, -0.28], 0.022, BRASS, 'metal'),
    rod([0, 1.1, -0.28], [0, 1.04, -0.26], 0.022, BRASS, 'metal'),
]
for s in (-1, 1):
    v += [box([0.42, 0.48, 0.02], [s * 0.215, 0.36, 0.125], '#B3C0A6', 'satin', radius=0.006),  # shaker doors
          box([0.32, 0.38, 0.012], [s * 0.215, 0.36, 0.138], '#A2B095', 'satin', radius=0.004),
          sph([0.03, 0.03, 0.025], [s * 0.05, 0.52, 0.15], BRASS, 'metal', segments=8),          # knobs
          cyl([0.04, 0.06, 0.04], [s * 0.1, 0.91, -0.4], BRASS, 'metal'),                         # tap bodies
          box([0.07, 0.012, 0.012], [s * 0.1, 0.95, -0.4], BRASS, 'metal', radius=0.004)]         # cross handles
M['model.sink@cozy'] = v

v = [
    box([0.84, 0.08, 0.5], [0, 0.04, -0.18], '#E2E0DA', 'satin', radius=0.004),    # recessed plinth
    box([0.88, 0.78, 0.54], [0, 0.47, -0.175], '#F3F2EE', 'satin', radius=0.004),  # cabinet
    box([0.436, 0.76, 0.018], [-0.221, 0.47, 0.101], '#F3F2EE', 'satin', radius=0.003),  # flush doors
    box([0.436, 0.76, 0.018], [0.221, 0.47, 0.101], '#F3F2EE', 'satin', radius=0.003),
    box([0.12, 0.012, 0.02], [-0.06, 0.82, 0.118], LOAK, 'wood', radius=0.004),     # oak finger pulls
    box([0.12, 0.012, 0.02], [0.06, 0.82, 0.118], LOAK, 'wood', radius=0.004),
    box([0.9, 0.025, 0.58], [0, 0.8725, -0.155], LOAK, 'wood', radius=0.004),       # oak top
    box([0.46, 0.12, 0.34], [0, 0.945, -0.14], '#FAFAF8', 'satin', radius=0.05),   # vessel basin
    box([0.4, 0.004, 0.28], [0, 1.0055, -0.14], '#E8E7E3', 'satin', radius=0.04),
    rod([0, 0.885, -0.38], [0, 1.18, -0.38], 0.018, CHROME, 'chrome'),             # slim tap
    rod([0, 1.18, -0.38], [0, 1.18, -0.24], 0.016, CHROME, 'chrome'),
    rod([0.02, 1.08, -0.38], [0.07, 1.08, -0.38], 0.01, CHROME, 'chrome'),
    cyl([0.07, 0.1, 0.07], [0.33, 0.935, -0.34], '#E9E3D8', 'satin'),               # cup
    rod([0.32, 0.93, -0.34], [0.31, 1.06, -0.35], 0.01, LOAK, 'wood'),              # toothbrush
]
M['model.sink@minimal'] = v

# ---- Bed (2x2) ---------------------------------------------------------------------------
CHAR = '#2E3034'
v = [
    box([1.5, 0.1, 1.7], [0, 0.05, 0.05], '#141517', 'metal', radius=0.01),        # floating plinth
    box([1.76, 0.24, 1.86], [0, 0.22, 0], CHAR, 'fabric', radius=0.03),            # upholstered frame
    box([1.86, 1.0, 0.1], [0, 0.6, -0.89], CHAR, 'fabric', radius=0.03),           # headboard
    box([1.64, 0.22, 1.76], [0, 0.45, 0.04], '#E3E4E6', 'fabric', radius=0.06),    # mattress
    box([1.7, 0.1, 1.18], [0, 0.58, 0.35], '#4A4E55', 'fabric', radius=0.05),      # duvet
    box([1.71, 0.06, 0.18], [0, 0.62, -0.17], '#D6D8DC', 'fabric', radius=0.03),   # sheet fold
    box([1.72, 0.03, 0.4], [0, 0.645, 0.62], '#8C9097', 'fabric', radius=0.015),   # throw
]
for x in (-0.69, -0.23, 0.23, 0.69):
    v.append(box([0.44, 0.82, 0.06], [x, 0.66, -0.82], '#3A3D42', 'fabric', radius=0.03))  # channels
for s in (-1, 1):
    v += [box([0.68, 0.16, 0.4], [s * 0.38, 0.62, -0.6], '#C9CCD1', 'fabric', radius=0.07),   # pillows
          box([0.5, 0.3, 0.12], [s * 0.3, 0.7, -0.38], '#6B7079', 'fabric', radius=0.05, rotate=[-15, 0, 0]),
          box([0.03, 0.03, 0.12], [s * 0.8, 1.05, -0.77], CHROME, 'chrome', radius=0.01),    # reading lights
          sph([0.06, 0.06, 0.06], [s * 0.8, 1.03, -0.71], CHROME, 'chrome', segments=8)]
M['model.bed@modern'] = v

v = [
    box([1.62, 0.24, 1.74], [0, 0.46, 0], '#F3EEE3', 'fabric', radius=0.07),       # mattress
    box([1.7, 0.08, 1.26], [0, 0.6, 0.25], '#E7DCC6', 'fabric', radius=0.04),      # quilt
    box([1.72, 0.08, 0.06], [0, 1.12, -0.9], HONEY, 'wood', radius=0.03),          # headboard rails
    box([1.72, 0.08, 0.06], [0, 0.56, -0.9], HONEY, 'wood', radius=0.02),
    box([1.64, 0.3, 0.05], [0, 0.42, 0.9], HONEY, 'wood', radius=0.015),           # footboard
    box([1.72, 0.06, 0.07], [0, 0.6, 0.9], HONEY, 'wood', radius=0.025),
    sph([0.34, 0.3, 0.14], [0, 0.73, -0.48], RUST, 'fabric', segments=10),         # round cushion
    box([1.0, 0.05, 0.3], [0.25, 0.665, 0.7], '#C8B48F', 'fabric', radius=0.02, rotate=[0, 8, 0]),  # knitted throw
]
for x in (-0.6, -0.4, -0.2, 0.0, 0.2, 0.4, 0.6):
    v.append(cyl([0.035, 0.5, 0.035], [x, 0.84, -0.9], HONEY, 'wood', taper=0.85, segments=8))  # spindles
for s in (-1, 1):
    v += [cyl([0.08, 1.2, 0.08], [s * 0.86, 0.6, -0.9], HONEY, 'wood', segments=12),   # posts
          sph([0.1, 0.1, 0.1], [s * 0.86, 1.24, -0.9], HONEY, 'wood', segments=10),   # finials
          cyl([0.08, 0.6, 0.08], [s * 0.86, 0.3, 0.88], HONEY, 'wood', segments=12),
          sph([0.09, 0.09, 0.09], [s * 0.86, 0.64, 0.88], HONEY, 'wood', segments=10),
          box([0.05, 0.2, 1.72], [s * 0.84, 0.3, 0], HONEY, 'wood', radius=0.012),   # side rails
          box([0.03, 0.3, 1.26], [s * 0.86, 0.47, 0.25], '#E7DCC6', 'fabric', radius=0.012),  # quilt drape
          box([0.66, 0.18, 0.42], [s * 0.38, 0.66, -0.66], '#F6F1E6', 'fabric', radius=0.08)]  # pillows
PATCH = [RUST, CREAM, MUSTARD, SAGE, ROSE, CREAM]
for r, z in enumerate((-0.17, 0.25, 0.67)):
    for c, x in enumerate((-0.63, -0.21, 0.21, 0.63)):
        v.append(box([0.4, 0.012, 0.4], [x, 0.645, z], PATCH[(r * 4 + c) % 5], 'fabric', radius=0.005))  # patchwork
M['model.bed@cozy'] = v

v = [
    box([1.7, 0.08, 1.84], [0, 0.22, 0], LOAK, 'wood', radius=0.01),               # slim frame
    box([1.7, 0.5, 0.04], [0, 0.48, -0.9], LOAK, 'wood', radius=0.015),            # low headboard
    box([1.62, 0.22, 1.78], [0, 0.37, 0.03], '#F7F6F3', 'fabric', radius=0.06),    # mattress
    box([1.66, 0.08, 1.2], [0, 0.5, 0.32], '#F1EFEA', 'fabric', radius=0.04),      # duvet
    box([1.67, 0.05, 0.16], [0, 0.53, -0.2], '#FFFFFF', 'fabric', radius=0.025),   # fold
    box([1.68, 0.025, 0.34], [0, 0.553, 0.68], '#D9D6CF', 'fabric', radius=0.012),  # throw
]
for x in (-0.8, 0.8):
    for z in (-0.84, 0.86):
        v.append(cyl([0.04, 0.18, 0.04], [x, 0.09, z], LOAK, 'wood', taper=0.8))   # legs
for s in (-1, 1):
    v.append(box([0.66, 0.14, 0.4], [s * 0.38, 0.53, -0.62], '#FFFFFF', 'fabric', radius=0.06))
M['model.bed@minimal'] = v

# ---- Toilet (1x1) ------------------------------------------------------------------------
v = [
    box([0.5, 0.95, 0.12], [0, 0.475, -0.38], '#3A3C40', 'satin', radius=0.01),    # concealed cistern
    box([0.22, 0.14, 0.012], [0, 0.82, -0.314], CHROME, 'chrome', radius=0.004),    # flush plate
    box([0.1, 0.12, 0.006], [-0.054, 0.82, -0.306], '#B9BDC1', 'chrome', radius=0.003),
    box([0.1, 0.12, 0.006], [0.054, 0.82, -0.306], '#B9BDC1', 'chrome', radius=0.003),
    box([0.36, 0.26, 0.52], [0, 0.32, -0.06], '#1E1F21', 'gloss', radius=0.12),    # wall-hung bowl
    box([0.37, 0.03, 0.5], [0, 0.465, -0.05], '#2A2B2E', 'gloss', radius=0.015),   # seat
    box([0.36, 0.44, 0.02], [0, 0.69, -0.295], '#2A2B2E', 'gloss', radius=0.04, rotate=[-8, 0, 0]),  # lid up
    cyl([0.16, 0.015, 0.16], [0.36, 0.0075, -0.33], CHROME, 'chrome'),              # paper stand
    cyl([0.02, 0.7, 0.02], [0.36, 0.36, -0.36], CHROME, 'chrome'),
    rod([0.36, 0.7, -0.36], [0.36, 0.7, -0.24], 0.012, CHROME, 'chrome'),
    cyl([0.11, 0.1, 0.11], [0.36, 0.7, -0.28], '#F4F4F2', 'satin', rotate=[90, 0, 0]),  # roll
]
M['model.toilet@modern'] = v

PC = '#F3EDE0'
v = [
    cyl([0.28, 0.22, 0.34], [0, 0.11, -0.02], PC, 'gloss', taper=1.2),             # pedestal
    cyl([0.38, 0.2, 0.48], [0, 0.32, 0.0], PC, 'gloss', taper=1.12),               # bowl
    cyl([0.42, 0.035, 0.52], [0, 0.437, 0.01], '#8A5A36', 'wood'),                  # wooden seat
    box([0.4, 0.46, 0.03], [0, 0.69, -0.2], '#8A5A36', 'wood', radius=0.06, rotate=[-10, 0, 0]),  # lid up
    box([0.46, 0.38, 0.18], [0, 0.62, -0.33], PC, 'gloss', radius=0.05),           # tank
    box([0.48, 0.035, 0.2], [0, 0.828, -0.33], PC, 'gloss', radius=0.015),         # tank lid
    box([0.08, 0.015, 0.015], [-0.17, 0.74, -0.235], BRASS, 'metal', radius=0.005),  # lever
    sph([0.03, 0.03, 0.02], [-0.21, 0.74, -0.235], BRASS, 'metal', segments=8),
    sph([0.03, 0.025, 0.03], [-0.15, 0.02, 0.0], BRASS, 'metal', segments=8),      # bolt caps
    sph([0.03, 0.025, 0.03], [0.15, 0.02, 0.0], BRASS, 'metal', segments=8),
    cyl([0.11, 0.1, 0.11], [0.12, 0.895, -0.33], '#FBFAF6', 'gloss'),              # spare roll
    cyl([0.06, 0.08, 0.06], [-0.12, 0.885, -0.33], '#E7D8BC', 'gloss'),            # candle
]
M['model.toilet@cozy'] = v

v = [
    box([0.5, 0.9, 0.1], [0, 0.45, -0.4], '#EDEBE6', 'satin', radius=0.006),       # cistern panel
    box([0.52, 0.025, 0.12], [0, 0.9125, -0.39], LOAK, 'wood', radius=0.006),      # oak shelf
    cyl([0.06, 0.01, 0.06], [0, 0.75, -0.345], '#E0DED8', 'satin', rotate=[90, 0, 0]),  # flush button
    box([0.28, 0.22, 0.46], [0, 0.11, -0.2], '#FAFAF8', 'gloss', radius=0.08),     # back-to-wall pan
    box([0.37, 0.22, 0.56], [0, 0.3, -0.16], '#FAFAF8', 'gloss', radius=0.1),
    box([0.38, 0.02, 0.52], [0, 0.42, -0.15], '#FFFFFF', 'satin', radius=0.01),    # seat
    box([0.38, 0.02, 0.5], [0, 0.44, -0.15], '#FFFFFF', 'satin', radius=0.01),     # closed lid
    cyl([0.07, 0.12, 0.07], [0.15, 0.985, -0.39], '#E9E3D8', 'satin', taper=0.8),  # bud vase
    rod([0.15, 1.0, -0.39], [0.13, 1.16, -0.37], 0.006, LOAK, 'wood'),              # dried stem
]
M['model.toilet@minimal'] = v

# ---- Shower (1x1) ------------------------------------------------------------------------
BLK = '#1A1A1A'
v = [
    box([0.9, 0.05, 0.9], [0, 0.025, 0], '#2A2B2E', 'gloss', radius=0.01),         # slate tray
    box([0.6, 0.004, 0.04], [0, 0.052, -0.3], BLK, 'metal', radius=0.002),         # linear drain
    box([0.9, 2.05, 0.03], [0, 1.075, -0.435], '#3B3D41', 'gloss', radius=0.004),  # back wall
    box([0.03, 2.05, 0.87], [-0.435, 1.075, 0.0], '#3B3D41', 'gloss', radius=0.004),  # side wall
    box([0.006, 2.0, 0.004], [0, 1.075, -0.418], '#25262A', 'gloss', radius=0),     # vertical seam
    box([0.6, 1.95, 0.012], [0.15, 1.025, 0.435], '#FFFFFF', 'glass', radius=0.003),  # glass front
    box([0.012, 1.95, 0.84], [0.435, 1.025, 0.0], '#FFFFFF', 'glass', radius=0.003),  # glass side
    box([0.016, 0.016, 0.85], [0.15, 2.0, 0.005], BLK, 'metal', radius=0.004),     # stabiliser bar
    box([0.02, 0.02, 0.22], [0, 2.04, -0.31], BLK, 'metal', radius=0.006),         # rain arm
    box([0.3, 0.012, 0.3], [0, 2.025, -0.2], BLK, 'metal', radius=0.01),           # square rain head
    box([0.08, 0.16, 0.012], [0.2, 1.1, -0.414], BLK, 'metal', radius=0.006),      # mixer plate
    cyl([0.04, 0.03, 0.04], [0.2, 1.13, -0.395], BLK, 'metal', rotate=[90, 0, 0]),
    box([0.3, 0.32, 0.004], [-0.15, 1.2, -0.418], '#1C1D20', 'gloss', radius=0.003),  # niche
    box([0.3, 0.012, 0.08], [-0.15, 1.04, -0.38], BLK, 'metal', radius=0.003),     # niche ledge
    cyl([0.05, 0.16, 0.05], [-0.22, 1.126, -0.385], '#E0E0E0', 'satin'),           # bottles
    cyl([0.05, 0.13, 0.05], [-0.15, 1.111, -0.385], '#4A4E55', 'satin'),
]
for y in (0.65, 1.25, 1.85):
    v += [box([0.86, 0.006, 0.004], [0, y, -0.418], '#25262A', 'gloss', radius=0),   # tile seams
          box([0.004, 0.006, 0.84], [-0.418, y, 0.0], '#25262A', 'gloss', radius=0)]
M['model.shower@modern'] = v

TILE = '#E9DCC4'
v = [
    box([0.9, 0.07, 0.9], [0, 0.035, 0], '#EDE6D8', 'gloss', radius=0.02),         # tray
    box([0.9, 2.0, 0.03], [0, 1.07, -0.435], TILE, 'gloss', radius=0.004),         # back wall
    box([0.03, 2.0, 0.87], [-0.435, 1.07, 0.0], TILE, 'gloss', radius=0.004),      # side wall
    box([0.87, 0.15, 0.006], [0.015, 1.25, -0.418], '#C97B5A', 'gloss', radius=0),  # terracotta band
    box([0.006, 0.15, 0.85], [-0.418, 1.25, 0.0], '#C97B5A', 'gloss', radius=0),
    rod([-0.42, 2.0, 0.41], [0.41, 2.0, 0.41], 0.02, BRASS, 'metal'),              # L curtain rail
    rod([0.41, 2.0, -0.42], [0.41, 2.0, 0.41], 0.02, BRASS, 'metal'),
    rod([0.25, 1.1, -0.4], [0.25, 1.88, -0.4], 0.025, BRASS, 'metal'),             # exposed riser
    rod([0.25, 1.88, -0.4], [0.25, 1.94, -0.26], 0.022, BRASS, 'metal'),
    cyl([0.12, 0.06, 0.12], [0.25, 1.91, -0.25], BRASS, 'metal', taper=1.7),       # rose head
    cyl([0.07, 0.05, 0.07], [0.25, 1.1, -0.405], BRASS, 'metal', rotate=[90, 0, 0]),  # mixer hub
    box([0.16, 0.014, 0.014], [0.25, 1.1, -0.375], BRASS, 'metal', radius=0.005),  # cross handle
    box([0.014, 0.16, 0.014], [0.25, 1.1, -0.375], BRASS, 'metal', radius=0.005),
    box([0.18, 0.02, 0.12], [-0.33, 1.1, -0.35], HONEY, 'wood', radius=0.006),     # soap shelf
    box([0.08, 0.03, 0.05], [-0.33, 1.125, -0.35], '#E7C6A8', 'gloss', radius=0.012),  # soap
]
for k, z in enumerate((-0.24, -0.12, 0.0, 0.12, 0.24)):
    v.append(box([0.6, 0.025, 0.09], [0, 0.0825, z], HONEY, 'wood', radius=0.008))  # duckboard
for k, x in enumerate((0.07, 0.15, 0.23, 0.31, 0.38)):                           # curtain folds, front
    v.append(box([0.1, 1.7, 0.015], [x, 1.13, 0.41], ['#F2EBDD', '#DCCFB6'][k % 2], 'fabric', radius=0.004, rotate=[0, 30 if k % 2 else -30, 0]))
for k, z in enumerate((-0.3, -0.22, -0.14)):                                     # gathered on the side
    v.append(box([0.1, 1.7, 0.015], [0.41, 1.13, z], ['#F2EBDD', '#DCCFB6'][k % 2], 'fabric', radius=0.004, rotate=[0, 60 if k % 2 else 120, 0]))
M['model.shower@cozy'] = v

v = [
    box([0.9, 0.04, 0.9], [0, 0.02, 0], '#F7F7F5', 'gloss', radius=0.006),         # flush tray
    box([0.9, 2.05, 0.03], [0, 1.065, -0.435], '#F2F1ED', 'gloss', radius=0.004),  # back wall
    box([0.5, 0.004, 0.03], [0, 0.042, -0.38], CHROME, 'chrome', radius=0.002),     # linear drain
    box([0.6, 1.95, 0.01], [-0.14, 1.015, 0.435], '#FFFFFF', 'glass', radius=0.003),  # single panel
    box([0.6, 0.02, 0.02], [-0.14, 0.05, 0.435], CHROME, 'chrome', radius=0.004),   # floor channel
    box([0.01, 0.01, 0.86], [-0.43, 1.99, 0.0], CHROME, 'chrome', radius=0.003),    # wall bar
    cyl([0.018, 1.2, 0.018], [0.25, 1.4, -0.405], CHROME, 'chrome'),                # riser
    cyl([0.24, 0.008, 0.24], [0.25, 2.0, -0.3], CHROME, 'chrome'),                  # round head
    box([0.015, 0.015, 0.12], [0.25, 2.0, -0.37], CHROME, 'chrome', radius=0.005),
    cyl([0.06, 0.03, 0.06], [0.25, 1.1, -0.405], CHROME, 'chrome', rotate=[90, 0, 0]),  # mixer
    box([0.3, 0.03, 0.24], [0.22, 0.42, -0.15], LOAK, 'wood', radius=0.008),       # oak stool
    box([0.03, 0.38, 0.2], [0.1, 0.22, -0.15], LOAK, 'wood', radius=0.006),
    box([0.03, 0.38, 0.2], [0.34, 0.22, -0.15], LOAK, 'wood', radius=0.006),
    cyl([0.05, 0.15, 0.05], [0.2, 0.51, -0.15], '#FFFFFF', 'gloss'),                # bottle
]
M['model.shower@minimal'] = v

# ---- Sofa (2x1) --------------------------------------------------------------------------
FAB, FAB2 = '#3A3C40', '#46494E'
v = [
    box([1.86, 0.18, 0.84], [0, 0.22, 0], FAB, 'fabric', radius=0.02),             # base
    box([1.62, 0.36, 0.16], [0, 0.49, -0.34], FAB, 'fabric', radius=0.03),         # back frame
    box([0.4, 0.36, 0.12], [-0.55, 0.62, -0.12], '#8A8F96', 'fabric', radius=0.05, rotate=[-12, 0, 12]),  # accent pillows
    box([0.36, 0.32, 0.12], [0.58, 0.61, -0.12], '#B0B4BA', 'fabric', radius=0.05, rotate=[-12, 0, -10]),
]
for s in (-1, 1):
    v += [box([0.12, 0.48, 0.84], [s * 0.87, 0.37, 0], FAB, 'fabric', radius=0.02),      # square arms
          box([0.8, 0.14, 0.68], [s * 0.405, 0.38, 0.07], FAB2, 'fabric', radius=0.04),   # seat cushions
          box([0.8, 0.36, 0.14], [s * 0.405, 0.6, -0.24], FAB2, 'fabric', radius=0.05, rotate=[-8, 0, 0]),  # back cushions
          box([0.03, 0.02, 0.72], [s * 0.82, 0.01, 0], CHROME, 'chrome', radius=0.006)]    # runners
    for z in (-0.34, 0.34):
        v.append(box([0.03, 0.13, 0.03], [s * 0.82, 0.065, z], CHROME, 'chrome', radius=0.008))  # legs
M['model.sofa@modern'] = v

SOF = '#E6D9C2'
v = [
    box([1.7, 0.24, 0.8], [0, 0.27, 0], SOF, 'fabric', radius=0.05),               # base
    box([1.5, 0.5, 0.2], [0, 0.62, -0.3], SOF, 'fabric', radius=0.08),             # back
    cyl([0.2, 1.5, 0.2], [0, 0.87, -0.3], SOF, 'fabric', rotate=[0, 0, 90]),       # rounded top
    box([0.38, 0.36, 0.14], [-0.52, 0.71, -0.03], RUST, 'fabric', radius=0.06, rotate=[-12, 0, 10]),   # pillows
    box([0.34, 0.32, 0.13], [0.53, 0.7, -0.03], MUSTARD, 'fabric', radius=0.06, rotate=[-12, 0, -8]),
    box([0.3, 0.24, 0.12], [0.2, 0.67, -0.02], SAGE, 'fabric', radius=0.05, rotate=[-14, 0, 4]),
    box([0.26, 0.03, 0.6], [0.8, 0.715, 0.0], '#C8B48F', 'fabric', radius=0.012),  # knitted throw
    box([0.03, 0.36, 0.56], [0.935, 0.53, 0.0], '#C8B48F', 'fabric', radius=0.012),
]
for s in (-1, 1):
    v += [box([0.18, 0.42, 0.8], [s * 0.84, 0.36, 0], SOF, 'fabric', radius=0.06),         # arms
          cyl([0.24, 0.8, 0.24], [s * 0.83, 0.58, 0], SOF, 'fabric', rotate=[90, 0, 0]),     # rolled arm tops
          box([0.72, 0.16, 0.62], [s * 0.365, 0.47, 0.08], CREAM, 'fabric', radius=0.07),    # seat cushions
          box([0.7, 0.42, 0.18], [s * 0.36, 0.72, -0.16], CREAM, 'fabric', radius=0.09, rotate=[-10, 0, 0])]
    for z in (-0.33, 0.33):
        v.append(cyl([0.06, 0.15, 0.06], [s * 0.78, 0.075, z], '#7A5234', 'wood', taper=0.7, segments=10))  # turned feet
M['model.sofa@cozy'] = v

LIN = '#E9E6E0'
v = [
    box([1.84, 0.06, 0.78], [0, 0.24, 0], LOAK, 'wood', radius=0.01),              # oak frame
    box([1.76, 0.3, 0.03], [0, 0.42, -0.4], LOAK, 'wood', radius=0.006),           # back panel
    box([1.74, 0.14, 0.68], [0, 0.34, 0.04], LIN, 'fabric', radius=0.04),          # bench cushion
    box([1.74, 0.4, 0.14], [0, 0.56, -0.31], LIN, 'fabric', radius=0.05, rotate=[-6, 0, 0]),  # back cushion
    box([0.4, 0.34, 0.12], [0.55, 0.6, -0.15], '#D4CFC6', 'fabric', radius=0.05, rotate=[-10, 0, -6]),
]
for s in (-1, 1):
    v.append(box([0.04, 0.34, 0.76], [s * 0.9, 0.44, 0], LOAK, 'wood', radius=0.012))  # thin oak arms
    for z in (-0.33, 0.33):
        v.append(cyl([0.045, 0.21, 0.045], [s * 0.86, 0.105, z], LOAK, 'wood', taper=0.7, segments=10))
M['model.sofa@minimal'] = v

# ---- TV (1x1) ----------------------------------------------------------------------------
v = [
    box([0.8, 0.11, 0.32], [0, 0.055, -0.24], '#0E0F10', 'metal', radius=0.004),   # recessed plinth
    box([0.9, 0.32, 0.4], [0, 0.27, -0.24], '#151618', 'gloss', radius=0.006),     # console
    box([0.44, 0.28, 0.012], [-0.222, 0.27, -0.034], '#1C1D20', 'gloss', radius=0.004),  # drawer fronts
    box([0.44, 0.28, 0.012], [0.222, 0.27, -0.034], '#1C1D20', 'gloss', radius=0.004),
    box([0.26, 0.012, 0.14], [0, 0.436, -0.33], CHROME, 'chrome', radius=0.004),    # stand plate
    box([0.04, 0.16, 0.02], [0, 0.51, -0.37], CHROME, 'chrome', radius=0.006),      # neck
    box([0.88, 0.5, 0.02], [0, 0.83, -0.36], '#0F1012', 'satin', radius=0.004),    # thin panel
    box([0.87, 0.49, 0.003], [0, 0.83, -0.3485], '#050608', 'gloss', radius=0.002),  # screen
    box([0.6, 0.06, 0.08], [0, 0.46, -0.13], '#1E1F22', 'satin', radius=0.02),     # soundbar
    box([0.04, 0.26, 0.2], [0.38, 0.56, -0.3], '#26282B', 'satin', radius=0.01),   # game console
    box([0.04, 0.012, 0.15], [-0.3, 0.436, -0.12], '#1E1F22', 'satin', radius=0.006),  # remote
]
M['model.tv@modern'] = v

TW = '#8A5A36'
v = [
    box([0.9, 0.38, 0.38], [0, 0.39, -0.25], TW, 'wood', radius=0.015),            # cabinet
    box([0.42, 0.32, 0.012], [-0.22, 0.39, -0.054], '#A06C42', 'wood', radius=0.006),  # door
    sph([0.03, 0.03, 0.02], [-0.06, 0.39, -0.045], '#5A3F2A', 'wood', segments=8),  # knob
    box([0.4, 0.02, 0.34], [0.21, 0.45, -0.25], TW, 'wood', radius=0.004),         # shelf
    box([0.36, 0.18, 0.28], [0.21, 0.32, -0.22], '#B89B6E', 'fabric', radius=0.03),  # basket
    box([0.04, 0.12, 0.16], [0.1, 0.52, -0.25], '#7B2F2A', 'satin', radius=0.004),  # books
    box([0.04, 0.11, 0.15], [0.145, 0.515, -0.25], '#C9B27A', 'satin', radius=0.004),
    box([0.035, 0.1, 0.15], [0.185, 0.51, -0.25], '#3E5B3A', 'satin', radius=0.004),
    box([0.06, 0.06, 0.04], [0, 0.61, -0.34], '#2B2622', 'satin', radius=0.01),    # TV neck
    box([0.3, 0.016, 0.16], [0, 0.588, -0.33], '#2B2622', 'satin', radius=0.006),  # TV base
    box([0.8, 0.48, 0.05], [0, 0.88, -0.34], '#2B2622', 'satin', radius=0.02),     # TV body
    box([0.76, 0.43, 0.004], [0, 0.885, -0.3135], '#050608', 'gloss', radius=0.003),  # screen
    box([0.16, 0.03, 0.22], [-0.34, 0.595, -0.2], '#7B2F2A', 'satin', radius=0.004),  # book stack
    box([0.15, 0.03, 0.2], [-0.34, 0.625, -0.2], '#C9B27A', 'satin', radius=0.004),
    cyl([0.07, 0.08, 0.07], [-0.34, 0.68, -0.2], CREAM, 'satin'),                   # mug
    cyl([0.1, 0.2, 0.1], [0.36, 0.68, -0.15], '#C46B4A', 'satin', taper=0.7),       # vase
]
for s in (-1, 1):
    for z in (-0.4, -0.1):
        v.append(cyl([0.04, 0.2, 0.04], [s * 0.4, 0.1, z], TW, 'wood', taper=0.6, rotate=[0, 0, -s * 6]))  # splayed legs
M['model.tv@cozy'] = v

v = [
    box([0.9, 0.26, 0.36], [0, 0.33, -0.26], '#F2F1ED', 'satin', radius=0.01),     # white console
    box([0.88, 0.004, 0.004], [0, 0.33, -0.078], '#DAD8D2', 'satin', radius=0),     # drawer line
    box([0.1, 0.015, 0.015], [-0.22, 0.43, -0.075], LOAK, 'wood', radius=0.005),    # oak pulls
    box([0.1, 0.015, 0.015], [0.22, 0.43, -0.075], LOAK, 'wood', radius=0.005),
    box([0.86, 0.49, 0.012], [0, 0.82, -0.36], '#D9D8D4', 'satin', radius=0.003),  # thin TV
    box([0.85, 0.48, 0.003], [0, 0.82, -0.3525], '#0A0B0D', 'gloss', radius=0.002),
    cyl([0.08, 0.2, 0.08], [0.34, 0.56, -0.2], '#E9E3D8', 'satin', taper=0.75),    # vase
    rod([0.34, 0.6, -0.2], [0.3, 0.86, -0.19], 0.008, '#8A6A4A', 'wood'),           # branch
]
for s in (-1, 1):
    v += [box([0.012, 0.115, 0.012], [s * 0.34, 0.5175, -0.36], '#D9D8D4', 'satin', radius=0.003),  # TV feet
          box([0.012, 0.006, 0.12], [s * 0.34, 0.463, -0.34], '#D9D8D4', 'satin', radius=0.002)]
    for z in (-0.4, -0.12):
        v.append(cyl([0.03, 0.2, 0.03], [s * 0.4, 0.1, z], LOAK, 'wood'))         # thin oak legs
M['model.tv@minimal'] = v

# ---- Bookshelf (1x1) ---------------------------------------------------------------------
def books(rnd, x0, x1, y, zback, palette, fill=1.0, hmax=0.33, dmax=0.24, stack=0.0):
    """Upright books from x0 to x0 + fill*(x1-x0); optionally a lying stack after them."""
    out, x, end = [], x0, x0 + (x1 - x0) * fill
    while True:
        w, h, d = rnd.uniform(0.025, 0.05), rnd.uniform(0.6, 1.0) * hmax, rnd.uniform(0.17, dmax)
        if x + w > end: break
        out.append(box([w, h, d], [x + w / 2, y + h / 2, zback + d / 2], rnd.choice(palette), 'satin', radius=0.004))
        x += w + 0.002
    yy = y
    for k in range(int(stack)):
        w, h, d = rnd.uniform(0.18, 0.24), rnd.uniform(0.025, 0.04), rnd.uniform(0.16, 0.2)
        cx = min(x + 0.02 + w / 2, x1 - w / 2)
        out.append(box([w, h, d], [cx, yy + h / 2, zback + d / 2], rnd.choice(palette), 'satin', radius=0.004))
        yy += h
    return out

rnd = random.Random(21)
DW = '#3B302A'
v = []
for x in (-0.42, 0.42):
    for z in (-0.43, -0.11):
        v.append(box([0.025, 1.9, 0.025], [x, 0.95, z], BLK, 'metal', radius=0.006))   # posts
for y in (0.06, 0.5, 0.94, 1.38, 1.84):
    v.append(box([0.86, 0.025, 0.34], [0, y, -0.27], DW, 'wood', radius=0.005))         # walnut shelves
v += [rod([-0.41, 0.08, -0.44], [0.41, 1.82, -0.44], 0.012, BLK, 'metal'),              # X brace
      rod([0.41, 0.08, -0.44], [-0.41, 1.82, -0.44], 0.012, BLK, 'metal')]
MOD = ['#1E1F22', '#3A3C40', '#6B7079', '#B9BCC1', '#E6E6E3', '#2F3A4E']
v += books(rnd, -0.4, 0.4, 0.0725, -0.42, MOD, fill=0.6, hmax=0.34, stack=0)
v += books(rnd, -0.4, 0.4, 0.5125, -0.42, MOD, fill=0.45, hmax=0.32, stack=3)
v += books(rnd, -0.4, 0.4, 0.9525, -0.42, MOD, fill=0.55, hmax=0.32)
v += books(rnd, 0.0, 0.4, 1.3925, -0.42, MOD, fill=1.0, hmax=0.3)
v += [sph([0.12, 0.12, 0.12], [0.25, 1.0125, -0.28], CHROME, 'chrome', segments=12),     # sculpture
      cyl([0.1, 0.22, 0.1], [-0.28, 1.5025, -0.28], '#151618', 'chrome', taper=0.6),       # black vase
      box([0.2, 0.26, 0.02], [-0.25, 1.98, -0.4], '#151618', 'metal', radius=0.004, rotate=[-8, 0, 0])]  # frame
M['model.bookshelf@modern'] = v

rnd = random.Random(8)
v = [
    box([0.86, 1.86, 0.02], [0, 0.95, -0.43], '#7E5638', 'wood', radius=0.004),     # back
    box([0.035, 1.86, 0.34], [-0.415, 0.95, -0.27], HONEY, 'wood', radius=0.008),  # sides
    box([0.035, 1.86, 0.34], [0.415, 0.95, -0.27], HONEY, 'wood', radius=0.008),
    box([0.9, 0.05, 0.38], [0, 1.9, -0.26], HONEY, 'wood', radius=0.015),          # crown
    box([0.86, 0.08, 0.34], [0, 0.06, -0.27], '#7E5638', 'wood', radius=0.006),    # kick
    sph([0.07, 0.06, 0.07], [-0.36, 1.94, -0.26], HONEY, 'wood', segments=8),      # corner knobs
    sph([0.07, 0.06, 0.07], [0.36, 1.94, -0.26], HONEY, 'wood', segments=8),
]
for y in (0.52, 0.94, 1.36):
    v.append(box([0.8, 0.025, 0.33], [0, y - 0.0125, -0.27], HONEY, 'wood', radius=0.005))
EARTH = ['#7B2F2A', '#A2482E', '#C9B27A', '#3E5B3A', '#8C6A4A', '#D8D2C4', '#5E4B3A', '#B5653F', '#6E7F5A']
v += books(rnd, -0.39, 0.39, 0.1, -0.42, EARTH, fill=0.85, hmax=0.33)
v += books(rnd, -0.39, 0.39, 0.52, -0.42, EARTH, fill=0.55, hmax=0.33, stack=2)
v += books(rnd, -0.39, 0.39, 0.94, -0.42, EARTH, fill=0.6, hmax=0.32)
v += books(rnd, -0.39, 0.39, 1.36, -0.42, EARTH, fill=0.35, hmax=0.3)
v += [cyl([0.14, 0.13, 0.14], [0.25, 1.425, -0.27], '#B9673F', 'satin', taper=1.2),    # terracotta pot
      blob([0.26, 0.2, 0.24], [0.25, 1.57, -0.27], '#587833', 'foliage', noise=0.25),
      blob([0.16, 0.2, 0.14], [0.31, 1.47, -0.18], '#64853A', 'foliage', noise=0.25),   # trailing
      box([0.14, 0.18, 0.02], [0.24, 1.03, -0.36], '#C9A77C', 'satin', radius=0.006, rotate=[-10, 0, 0])]  # photo
M['model.bookshelf@cozy'] = v

rnd = random.Random(4)
v = []
for s in (-1, 1):
    v.append(box([0.02, 1.8, 0.32], [s * 0.41, 0.9, -0.28], LOAK, 'wood', radius=0.004))  # thin sides
for y in (0.12, 0.56, 1.0, 1.44, 1.79):
    v.append(box([0.8, 0.02, 0.32], [0, y, -0.28], LOAK, 'wood', radius=0.004))         # thin shelves
PALE = ['#F2F0EA', '#D9D3C7', '#BFC5C2', '#E8DCCB', '#A7A9A4', '#FFFFFF']
v += books(rnd, -0.38, 0.38, 0.13, -0.42, PALE, fill=0.45, hmax=0.32)
v += books(rnd, 0.05, 0.38, 0.57, -0.42, PALE, fill=0.6, hmax=0.3, stack=2)
v += books(rnd, -0.38, 0.38, 1.01, -0.42, PALE, fill=0.3, hmax=0.3)
v += [cyl([0.1, 0.24, 0.1], [0.24, 1.13, -0.28], '#FAFAF8', 'satin', taper=0.6),       # white vase
      sph([0.14, 0.14, 0.14], [-0.2, 0.64, -0.28], '#E9E3D8', 'satin', segments=12),   # ceramic orb
      box([0.26, 0.32, 0.02], [-0.1, 1.61, -0.4], '#F7F6F3', 'satin', radius=0.004, rotate=[-8, 0, 0]),  # print
      box([0.2, 0.24, 0.004], [-0.1, 1.615, -0.387], '#BFC5C2', 'satin', radius=0, rotate=[-8, 0, 0])]
M['model.bookshelf@minimal'] = v

# ---- Armchair (1x1) ----------------------------------------------------------------------
LEA, LEA2 = '#1E1F22', '#2A2B2E'
v = [
    box([0.7, 0.12, 0.66], [0, 0.32, 0], LEA, 'satin', radius=0.03),                # seat shell
    box([0.58, 0.1, 0.58], [0, 0.42, 0.04], LEA2, 'satin', radius=0.04),           # cushion
    box([0.7, 0.5, 0.12], [0, 0.62, -0.29], LEA, 'satin', radius=0.04, rotate=[-10, 0, 0]),  # back
    box([0.58, 0.42, 0.08], [0, 0.66, -0.21], LEA2, 'satin', radius=0.04, rotate=[-10, 0, 0]),
    box([0.34, 0.3, 0.1], [0.08, 0.62, -0.12], '#6B7079', 'fabric', radius=0.04, rotate=[-14, 0, -8]),  # pillow
]
for s in (-1, 1):
    v += [box([0.08, 0.26, 0.62], [s * 0.31, 0.51, -0.01], LEA, 'satin', radius=0.03),          # arms
          box([0.025, 0.025, 0.66], [s * 0.36, 0.0125, 0], CHROME, 'chrome', radius=0.008),     # sled runners
          box([0.025, 0.025, 0.62], [s * 0.36, 0.25, 0], CHROME, 'chrome', radius=0.008)]
    for z in (-0.31, 0.31):
        v.append(box([0.025, 0.24, 0.025], [s * 0.36, 0.13, z], CHROME, 'chrome', radius=0.008))
M['model.armchair@modern'] = v

TER = '#B36A47'
v = [
    box([0.72, 0.22, 0.7], [0, 0.27, 0], TER, 'fabric', radius=0.05),              # base
    box([0.54, 0.14, 0.56], [0, 0.44, 0.06], CREAM, 'fabric', radius=0.06),        # seat cushion
    box([0.66, 0.66, 0.16], [0, 0.74, -0.27], TER, 'fabric', radius=0.07, rotate=[-8, 0, 0]),  # back
    box([0.32, 0.3, 0.12], [0, 0.66, -0.12], SAGE, 'fabric', radius=0.05, rotate=[-14, 0, 0]),  # pillow
    box([0.2, 0.02, 0.4], [0.33, 0.705, 0.04], '#E8DCC0', 'fabric', radius=0.008),  # throw on arm
    box([0.02, 0.3, 0.4], [0.425, 0.56, 0.04], '#E8DCC0', 'fabric', radius=0.008),
]
for s in (-1, 1):
    v += [box([0.1, 0.4, 0.28], [s * 0.32, 0.86, -0.2], TER, 'fabric', radius=0.04, rotate=[0, s * 12, 0]),  # wings
          box([0.12, 0.26, 0.62], [s * 0.32, 0.5, 0], TER, 'fabric', radius=0.05),                        # arms
          cyl([0.16, 0.62, 0.16], [s * 0.33, 0.62, 0], TER, 'fabric', rotate=[90, 0, 0])]                   # rolls
    for z in (-0.28, 0.28):
        v.append(cyl([0.05, 0.16, 0.05], [s * 0.3, 0.08, z], '#6E4A2F', 'wood', taper=0.65, segments=10))
M['model.armchair@cozy'] = v

v = [
    box([0.62, 0.04, 0.58], [0, 0.33, 0], LOAK, 'wood', radius=0.01),              # seat frame
    box([0.6, 0.12, 0.58], [0, 0.41, 0.03], LIN, 'fabric', radius=0.04),           # seat cushion
    box([0.58, 0.48, 0.1], [0, 0.7, -0.26], LIN, 'fabric', radius=0.05, rotate=[-14, 0, 0]),  # back cushion
    box([0.62, 0.04, 0.04], [0, 0.95, -0.34], LOAK, 'wood', radius=0.012),         # top rail
]
for s in (-1, 1):
    v += [rod([s * 0.33, 0.012, 0.3], [s * 0.33, 0.56, 0.26], 0.035, LOAK, 'wood'),           # front legs
          rod([s * 0.33, 0.012, -0.33], [s * 0.33, 0.4, -0.24], 0.035, LOAK, 'wood'),          # back legs
          rod([s * 0.31, 0.35, -0.25], [s * 0.31, 0.96, -0.36], 0.03, LOAK, 'wood'),      # back posts
          box([0.05, 0.03, 0.62], [s * 0.33, 0.575, -0.01], LOAK, 'wood', radius=0.012)]  # arm rails
M['model.armchair@minimal'] = v

# ---- Plant (1x1) -------------------------------------------------------------------------
rnd = random.Random(13)
v = [
    cyl([0.32, 0.52, 0.32], [0, 0.26, 0], '#1C1D20', 'gloss', segments=24),        # tall pot
    cyl([0.33, 0.012, 0.33], [0, 0.526, 0], '#26282B', 'gloss', segments=24),      # rim
    cyl([0.28, 0.01, 0.28], [0, 0.522, 0], '#2E241C', 'matte'),                    # soil
]
for k in range(10):                                                                # snake plant leaves
    a = math.radians(k * 137.5)
    r0 = 0.03 + 0.05 * (k % 3) / 2
    base = [r0 * math.sin(a), 0.52, r0 * math.cos(a)]
    h = rnd.uniform(0.5, 0.9)
    lean = rnd.uniform(0.03, 0.12)
    tip = [base[0] + lean * math.sin(a), 0.52 + h, base[2] + lean * math.cos(a)]
    v.append(rod(base, tip, 0.075, rnd.choice(['#2F5A35', '#3B6B3F', '#4A7A45']), 'foliage', shape='cone', t2=0.022, segments=8))
for x, z in [(0.1, 0.08), (-0.08, 0.1)]:
    v.append(sph([0.04, 0.025, 0.035], [x, 0.535, z], '#E6E6E3', 'gloss', segments=6))  # pebbles
M['model.plant@modern'] = v

rnd = random.Random(17)
v = [
    cyl([0.36, 0.03, 0.36], [0, 0.32, 0], HONEY, 'wood'),                           # stand top
    cyl([0.3, 0.26, 0.3], [0, 0.465, 0], '#B9673F', 'matte', taper=1.25),          # terracotta pot
    cyl([0.39, 0.05, 0.39], [0, 0.6, 0], '#C27449', 'matte'),                      # rim
    cyl([0.33, 0.01, 0.33], [0, 0.62, 0], '#3B2B20', 'matte'),                     # soil
]
for k in range(3):
    a = math.radians(30 + k * 120)
    v.append(rod([0.13 * math.cos(a), 0.31, 0.13 * math.sin(a)], [0.2 * math.cos(a), 0.012, 0.2 * math.sin(a)], 0.03, HONEY, 'wood'))  # legs
LEAF = ['#4D6B2C', '#5B7A33', '#66873A', '#587833']
for k, (x, y, z, sz) in enumerate([(0, 0.82, 0, 0.36), (0.1, 0.76, 0.08, 0.28), (-0.1, 0.78, -0.06, 0.3),
                                   (0.05, 0.95, -0.08, 0.26), (-0.06, 0.9, 0.1, 0.24)]):
    v.append(blob([sz, sz * 0.85, sz], [x, y, z], LEAF[k % 4], 'foliage', noise=0.25))
for k in range(3):                                                                 # trailing vines
    a = math.radians(70 + k * 115)
    for j in range(4):
        r, y = 0.2 + 0.02 * j, 0.62 - 0.11 * j
        v.append(blob([0.09, 0.08, 0.09], [r * math.cos(a + 0.15 * j), y, r * math.sin(a + 0.15 * j)], LEAF[(k + j) % 4], 'foliage', noise=0.2))
M['model.plant@cozy'] = v

rnd = random.Random(29)
v = [
    cyl([0.3, 0.32, 0.3], [0, 0.34, 0], '#F4F3EF', 'satin', segments=24),          # white pot
    cyl([0.27, 0.01, 0.27], [0, 0.495, 0], '#3B2B20', 'matte'),                    # soil
    cyl([0.31, 0.02, 0.31], [0, 0.24, 0], LOAK, 'wood'),                           # stand collar
    cyl([0.035, 0.85, 0.035], [0, 0.92, 0], '#6B5440', 'wood', taper=0.6),         # trunk
]
for k in range(4):
    a = math.radians(45 + k * 90)
    v.append(rod([0.17 * math.cos(a), 0.01, 0.17 * math.sin(a)], [0.13 * math.cos(a), 0.25, 0.13 * math.sin(a)], 0.025, LOAK, 'wood'))
for k in range(12):                                                                # fiddle-leaf fig leaves
    t = k / 11
    a = k * 137.5
    y = 0.75 + 0.75 * t
    r = 0.11 - 0.03 * t
    tilt = -20 - 15 * t
    ar = math.radians(a)
    v.append(sph([0.17, 0.025, 0.26], [r * math.sin(ar), y, r * math.cos(ar)], rnd.choice(['#3E6B35', '#4A7A3D', '#557F42']),
                 'foliage', segments=8, rotate=[tilt, a, 0]))
M['model.plant@minimal'] = v

for base, fp in [('fridge', (1, 1)), ('sink', (1, 1)), ('bed', (2, 2)), ('toilet', (1, 1)), ('shower', (1, 1)),
                 ('sofa', (2, 1)), ('tv', (1, 1)), ('bookshelf', (1, 1)), ('armchair', (1, 1)), ('plant', (1, 1))]:
    for style in ('modern', 'cozy', 'minimal'):
        FOOT[f'model.{base}@{style}'] = fp

# =============================================================================================
# Validation
# =============================================================================================
SHAPES = {'box', 'cylinder', 'cone', 'sphere', 'capsule', 'blob'}
FINISHES = {F + f for f in 'matte satin gloss metal chrome fabric wood bark foliage skin glass'.split()}
HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
MARGIN = 0.045   # ~5 cm inside the footprint

def half_extents(p):
    sx, sy, sz = p['size']
    if p['shape'] in ('cylinder', 'cone'):
        top = p.get('taper', 1 if p['shape'] == 'cylinder' else 0)
        k = max(1.0, top)
        return sx * k / 2, sy / 2, sz * k / 2
    if p['shape'] == 'blob':
        k = 1 + p.get('noise', 0.18)
        return sx * k / 2, sy * k / 2, sz * k / 2
    return sx / 2, sy / 2, sz / 2

def bounds(p):
    hx, hy, hz = half_extents(p)
    r = p.get('rotate', [0, 0, 0])
    pts = [add(p['at'], rot([a * hx, b * hy, c * hz], r)) for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)]
    return [min(q[i] for q in pts) for i in range(3)], [max(q[i] for q in pts) for i in range(3)]

def validate(key, parts, fp):
    issues = []
    lx, lz = fp[0] / 2 - MARGIN, fp[1] / 2 - MARGIN
    for i, p in enumerate(parts):
        for f in ('shape', 'size', 'at', 'color', 'material'):
            if f not in p: issues.append(f'part {i}: missing {f}')
        if p.get('shape') not in SHAPES: issues.append(f'part {i}: bad shape {p.get("shape")}')
        if not HEX.match(p.get('color', '')): issues.append(f'part {i}: bad colour {p.get("color")}')
        if p.get('material') not in FINISHES: issues.append(f'part {i}: bad finish {p.get("material")}')
        if len(p['size']) != 3 or min(p['size']) <= 0: issues.append(f'part {i}: bad size {p["size"]}')
        lo, hi = bounds(p)
        if lo[0] < -lx - 1e-4 or hi[0] > lx + 1e-4: issues.append(f'part {i} ({p["shape"]} at {p["at"]}): x {lo[0]:.3f}..{hi[0]:.3f} exceeds ±{lx:.3f}')
        if lo[2] < -lz - 1e-4 or hi[2] > lz + 1e-4: issues.append(f'part {i} ({p["shape"]} at {p["at"]}): z {lo[2]:.3f}..{hi[2]:.3f} exceeds ±{lz:.3f}')
        if lo[1] < -0.002: issues.append(f'part {i} ({p["shape"]} at {p["at"]}): below floor y={lo[1]:.3f}')
    fins = {p.get('material') for p in parts}
    if len(fins) > 4: issues.append(f'{len(fins)} finishes (max 4): {sorted(f.split(".")[-1] for f in fins)}')
    return issues

if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else 'objects_extra.json'
    bad = 0
    for k, parts in M.items():
        issues = validate(k, parts, FOOT[k])
        fins = sorted({p['material'].split('.')[-1] for p in parts})
        print(f'{k:28s} {len(parts):3d} parts  {",".join(fins)}')
        for s in issues:
            print('   !', s)
        bad += len(issues)
    out = {k: {'type': 'model', 'placeholder': parts} for k, parts in M.items()}
    with open(path, 'w') as f:
        json.dump(out, f, indent=2)
    print(f'{len(out)} models, {sum(len(v) for v in M.values())} parts -> {path}; {bad} violation(s)')
    sys.exit(1 if bad else 0)
