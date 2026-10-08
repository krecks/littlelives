# Outgoing pack models (`model.outgoing.*`): party bar, conversation sectional, karaoke stage,
# video-call nook, light-up dance floor, party photo wall. Primitive parts plus the Poly Haven wine
# bottles (CC0). Conventions as furniture.py: 1 unit = 1 m, origin at the footprint centre on the
# floor, front +Z, back against the wall at -Z; seats centred on z = 0 with tops at ~0.45 m
# (characters.ts DEFAULT_SEAT).
# Run: python3 -I pack_outgoing.py [out.json]  then  python3 -I apply_pack.py outgoing out.json
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, gltf, placeholder,  # noqa: E402
                       validate_parts, CHROME, BRASS, OAK, OAKD, WHITE, CREAM)

TRAIT = 'outgoing'
FOOT = {o['model']: tuple(o['footprint']) for o in
        json.load(open(os.path.join(HERE, '..', '..', 'web', 'public', 'content', 'packs', TRAIT + '.json')))['objects']}
LIB = '../../models/'
E = {}

CORAL, TURQ, SUNNY, MAGENTA, PLUM, MINT = '#E8735A', '#3FA9A5', '#F2C14E', '#D64B8A', '#6B4A7E', '#9ED9C8'
WALNUT = '#8A5E3C'


def glass(at, h=0.16, r=0.07, color='#E8F2F2', drink=None):
    """A cocktail/wine glass (lathe) with an optional drink inside."""
    p = [lathe([r, h, r], [at[0], at[1] + h / 2, at[2]], color, 'glass',
               profile=[[0.0, -0.5], [0.42, -0.5], [0.42, -0.46], [0.06, -0.42], [0.05, 0.0], [0.5, 0.2], [0.5, 0.5]])]
    if drink:
        p.append(cyl([r * 0.8, h * 0.18, r * 0.8], [at[0], at[1] + h * 0.78, at[2]], drink, 'gloss', taper=1.15))
    return p


def bottle(at, h, color, cap=BRASS, label=CREAM):
    x, y, z = at
    return [lathe([0.075, h, 0.075], [x, y + h / 2, z], color, 'gloss',
                  profile=[[0.0, -0.5], [0.5, -0.5], [0.5, 0.1], [0.38, 0.22], [0.17, 0.3], [0.17, 0.5], [0.0, 0.5]]),
            cyl([0.077, h * 0.22, 0.077], [x, y + h * 0.32, z], label, 'satin'),
            cyl([0.03, 0.03, 0.03], [x, y + h + 0.012, z], cap, 'metal')]


def stool(x, z, top=CORAL, frame=BRASS, h=0.74):
    return [cushion([0.32, 0.06, 0.32], [x, h - 0.03, z], top, radius=0.03),
            cyl([0.3, 0.03, 0.3], [x, h - 0.075, z], OAK, 'wood'),
            cyl([0.04, h - 0.1, 0.04], [x, (h - 0.1) / 2 + 0.02, z], frame, 'metal'),
            torus([0.26, 0.018, 0.26], [x, 0.28, z], frame, 'metal'),
            cyl([0.3, 0.025, 0.3], [x, 0.0125, z], frame, 'metal', taper=0.8)]


# ---- Party bar (2x1): back bar with bottles, front counter, two stools ---------------------
bar = [
    # back bar cabinet against the wall
    box([1.82, 0.88, 0.26], [0, 0.44, -0.31], WALNUT, 'wood', radius=0.012),
    box([1.84, 0.03, 0.28], [0, 0.895, -0.31], OAK, 'wood', radius=0.008),
    box([1.8, 0.03, 0.18], [0, 1.28, -0.36], OAK, 'wood', radius=0.006),       # shelves
    box([1.8, 0.03, 0.18], [0, 1.62, -0.36], OAK, 'wood', radius=0.006),
    box([1.8, 0.02, 0.012], [0, 1.262, -0.27], SUNNY, 'gloss', radius=0.004),  # LED strips
    box([1.8, 0.02, 0.012], [0, 1.602, -0.27], SUNNY, 'gloss', radius=0.004),
    box([0.03, 0.75, 0.16], [-0.89, 1.45, -0.36], BRASS, 'metal', radius=0.006),  # shelf uprights
    box([0.03, 0.75, 0.16], [0.89, 1.45, -0.36], BRASS, 'metal', radius=0.006),
    # front counter
    box([1.5, 0.98, 0.24], [0, 0.49, 0.0], CORAL, 'satin', radius=0.03),
    box([1.62, 0.05, 0.38], [0, 1.0, 0.06], OAK, 'wood', radius=0.012),
]
for x in (-0.55, -0.18, 0.18, 0.55):                                          # fluted front panels
    bar.append(box([0.3, 0.86, 0.02], [x, 0.48, 0.125], '#F08C75', 'satin', radius=0.01))
bar += [box([1.46, 0.03, 0.03], [0, 0.2, 0.17], BRASS, 'metal', radius=0.012),  # foot rail
        box([0.03, 0.12, 0.03], [-0.6, 0.14, 0.145], BRASS, 'metal', radius=0.008),
        box([0.03, 0.12, 0.03], [0.6, 0.14, 0.145], BRASS, 'metal', radius=0.008)]
for i, (x, c) in enumerate([(-0.75, '#2E7D5B'), (-0.62, '#B5372E'), (-0.5, '#E8B04A'), (-0.38, '#6B4A7E'),
                            (0.32, '#3FA9A5'), (0.45, '#D64B8A'), (0.6, '#2E5B8E'), (0.75, '#E07A2E')]):
    bar += bottle([x, 1.635, -0.36], 0.24 + 0.04 * (i % 3), c)
for x, c in [(-0.7, '#F2E6CC'), (-0.45, '#D9EEF0'), (0.4, '#D9EEF0'), (0.7, '#F2E6CC')]:
    bar += glass([x, 1.295, -0.36], h=0.14, r=0.07)
bar += glass([-0.4, 1.025, 0.08], drink=MAGENTA) + glass([0.12, 1.025, 0.14], drink=SUNNY)
bar += [cyl([0.08, 0.2, 0.08], [0.45, 1.125, 0.02], CHROME, 'chrome', taper=0.75),  # shaker
        sph([0.07, 0.05, 0.07], [0.45, 1.24, 0.02], CHROME, 'chrome', segments=10),
        lathe([0.2, 0.08, 0.2], [-0.1, 1.065, 0.02], '#F5F3EE', 'gloss',
              profile=[[0.0, -0.5], [0.3, -0.5], [0.5, 0.5], [0.45, 0.5], [0.28, -0.3], [0.0, -0.3]]),
        sph([0.06, 0.06, 0.06], [-0.13, 1.1, 0.02], '#9CCB4A', 'satin', segments=8),       # limes
        sph([0.06, 0.06, 0.06], [-0.07, 1.1, 0.04], '#9CCB4A', 'satin', segments=8),
        sph([0.06, 0.06, 0.06], [-0.1, 1.1, -0.02], SUNNY, 'satin', segments=8)]
bar += stool(-0.5, 0.28) + stool(0.5, 0.28)
E['model.outgoing.partyBar'] = gltf(LIB + 'ph/wine_bottles_01.glb', [0.5, 0.3, 0.1], align='centre',
                                    offset=[0.2, 0.91, -0.31], parts=bar, placeholder=bar, footprint=(2, 1))

# ---- Conversation sectional (2x2): L-sofa; Sims sit at x = +-0.5 on the centre line --------
VEL, VEL2 = TURQ, '#4FB8B3'
sec = [
    box([1.9, 0.3, 0.86], [0, 0.17, -0.02], VEL, 'fabric', radius=0.05),                  # main base
    box([0.56, 0.3, 0.52], [0.66, 0.17, 0.66], VEL, 'fabric', radius=0.05),               # chaise base
    cushion([0.84, 0.13, 0.66], [-0.5, 0.385, 0.06], VEL2, radius=0.05),                   # seat cushions (top 0.45)
    cushion([0.64, 0.13, 0.66], [0.32, 0.385, 0.06], VEL2, radius=0.05),
    cushion([0.5, 0.13, 0.54], [0.66, 0.385, 0.65], VEL2, radius=0.05),                    # chaise cushion
    box([1.9, 0.42, 0.2], [0, 0.6, -0.36], VEL, 'fabric', radius=0.06),                   # back
    box([0.18, 0.3, 1.38], [-0.86, 0.47, 0.06], VEL, 'fabric', radius=0.07),               # left arm (rounded)
    box([0.16, 0.24, 1.36], [0.86, 0.44, 0.25], VEL, 'fabric', radius=0.06),              # right side
    cushion([0.66, 0.36, 0.16], [-0.42, 0.68, -0.2], VEL2, rotate=[-12, 0, 0]),             # back cushions
    cushion([0.66, 0.36, 0.16], [0.3, 0.68, -0.2], VEL2, rotate=[-12, 0, 0]),
    cushion([0.34, 0.3, 0.1], [-0.6, 0.66, -0.08], SUNNY, rotate=[-15, 20, 0]),             # throw pillows
    cushion([0.32, 0.3, 0.1], [0.62, 0.66, -0.06], CORAL, rotate=[-15, -18, 0]),
    cushion([0.28, 0.26, 0.1], [0.76, 0.6, 0.3], '#F4EDE4', rotate=[-10, -80, 0]),
]
for x in (-0.86, 0.86):                                                                     # feet
    for z in (-0.4, 0.38):
        sec.append(cyl([0.05, 0.04, 0.05], [x, 0.02, z], BRASS, 'metal'))
sec.append(cyl([0.05, 0.04, 0.05], [0.86, 0.02, 0.88], BRASS, 'metal'))
# console behind the sofa
sec += [box([1.8, 0.04, 0.34], [0, 0.82, -0.75], OAK, 'wood', radius=0.01),
        box([1.76, 0.04, 0.3], [0, 0.2, -0.75], OAK, 'wood', radius=0.008)]
for x in (-0.86, 0.86):
    for z in (-0.89, -0.61):
        sec.append(box([0.03, 0.8, 0.03], [x, 0.4, z], BRASS, 'metal', radius=0.006))
sec += [lathe([0.22, 0.3, 0.22], [-0.6, 0.99, -0.76], '#F4EDE4', 'gloss',
              profile=[[0.0, -0.5], [0.3, -0.5], [0.5, -0.1], [0.36, 0.3], [0.2, 0.5], [0.0, 0.5]]),   # lamp base
        cyl([0.34, 0.24, 0.34], [-0.6, 1.3, -0.76], '#FBEFD6', 'fabric', taper=0.8),           # shade
        cyl([0.18, 0.18, 0.18], [0.55, 0.93, -0.76], '#E9E6E0', 'satin', taper=0.85),         # plant pot
        sph([0.34, 0.3, 0.3], [0.55, 1.15, -0.76], '#5E8F4E', 'foliage', segments=10),
        box([0.3, 0.06, 0.2], [0.1, 0.87, -0.76], CORAL, 'matte', radius=0.008),             # books
        box([0.28, 0.05, 0.19], [0.1, 0.925, -0.76], SUNNY, 'matte', radius=0.008)]
for i, c in enumerate([TURQ, CORAL, SUNNY, PLUM]):
    sec.append(box([0.24, 0.035, 0.18], [0.0 + 0.0, 0.24 + 0.04 * i, -0.75], c, 'matte', radius=0.006))  # magazines
# pouf with a tray in the free front-left corner
sec += [cyl([0.46, 0.36, 0.46], [-0.52, 0.18, 0.7], SUNNY, 'fabric', segments=24),
        torus([0.46, 0.06, 0.46], [-0.52, 0.34, 0.7], '#E8B04A', 'fabric'),
        cyl([0.3, 0.02, 0.3], [-0.52, 0.37, 0.7], OAK, 'wood'),
        cyl([0.07, 0.09, 0.07], [-0.46, 0.425, 0.66], '#F5F3EE', 'gloss'),
        cyl([0.07, 0.09, 0.07], [-0.58, 0.425, 0.74], MAGENTA, 'gloss')]
E['model.outgoing.conversationSectional'] = placeholder(sec)

# ---- Karaoke stage (2x1): low stage, two mics, lyrics screen, speakers ---------------------
STAGE = '#7A5A8E'
ks = [box([1.9, 0.14, 0.9], [0, 0.07, 0.0], STAGE, 'satin', radius=0.02),
      box([1.86, 0.015, 0.86], [0, 0.1475, 0.0], OAK, 'wood', radius=0.004),
      box([1.9, 0.025, 0.02], [0, 0.07, 0.445], MAGENTA, 'gloss', radius=0.006),            # light strip
      # lyrics screen on a stand at the back
      box([0.96, 0.56, 0.05], [0, 1.35, -0.36], '#E9E6E0', 'satin', radius=0.015),
      box([0.92, 0.52, 0.004], [0, 1.35, -0.333], '#26305A', 'gloss', radius=0.006)]
for i, (w, y) in enumerate([(0.6, 1.47), (0.7, 1.38), (0.5, 1.29), (0.62, 1.2)]):
    ks.append(box([w, 0.035, 0.002], [0, y, -0.33], SUNNY if i == 1 else '#F2F2F0', 'gloss', radius=0.006))
ks += [box([0.05, 1.0, 0.05], [0, 0.6, -0.4], '#9EA3A8', 'metal', radius=0.01),
       box([0.5, 0.03, 0.18], [0, 0.165, -0.36], '#9EA3A8', 'metal', radius=0.01)]
for s in (-1, 1):                                                                            # speakers
    x = s * 0.74
    ks += [box([0.34, 0.62, 0.32], [x, 0.46, -0.24], '#E4E1DA', 'satin', radius=0.03),
           cyl([0.2, 0.02, 0.2], [x, 0.38, -0.075], '#3A3D41', 'satin', rotate=[90, 0, 0]),
           cyl([0.1, 0.022, 0.1], [x, 0.38, -0.072], CORAL, 'gloss', rotate=[90, 0, 0]),
           cyl([0.1, 0.02, 0.1], [x, 0.62, -0.075], '#3A3D41', 'satin', rotate=[90, 0, 0])]
    mx = s * 0.36                                                                           # mic stands
    ks += [cyl([0.22, 0.02, 0.22], [mx, 0.16, 0.12], '#9EA3A8', 'metal'),
           cyl([0.022, 1.2, 0.022], [mx, 0.75, 0.12], CHROME, 'chrome'),
           rod([mx, 1.33, 0.12], [mx, 1.4, 0.2], 0.02, CHROME, 'chrome'),
           part('capsule', [0.06, 0.2, 0.06], [mx, 1.44, 0.25], MAGENTA if s < 0 else TURQ, 'gloss', rotate=[50, 0, 0]),
           sph([0.085, 0.085, 0.085], [mx, 1.51, 0.31], '#C9CCD0', 'metal', segments=10)]
for x in (-0.9, 0.9):                                                                        # floor spots
    ks += [cyl([0.12, 0.12, 0.12], [x * 0.92, 0.24, 0.33], '#3A3D41', 'satin', rotate=[-35, 0, 0], taper=1.3),
           cyl([0.1, 0.01, 0.1], [x * 0.92, 0.29, 0.36], SUNNY, 'gloss', rotate=[-35, 0, 0])]
E['model.outgoing.karaokeStage'] = placeholder(ks)

# ---- Video-call nook (1x1): seated at z = 0, desk with laptop and ring light in front -------
vc = [box([0.84, 0.03, 0.27], [0, 0.74, 0.31], OAK, 'wood', radius=0.008)]
for x in (-0.39, 0.39):
    for z in (0.21, 0.41):
        vc.append(cyl([0.03, 0.725, 0.03], [x, 0.3625, z], WHITE, 'satin', taper=0.7))
vc += [  # laptop facing the Sim (-Z)
    box([0.34, 0.015, 0.23], [0, 0.763, 0.29], '#D9DADB', 'metal', radius=0.008),
    box([0.34, 0.22, 0.012], [0, 0.88, 0.41], '#D9DADB', 'metal', radius=0.008, rotate=[-12, 0, 0]),
    box([0.31, 0.19, 0.002], [0, 0.88, 0.401], '#3B6E8F', 'gloss', radius=0.004, rotate=[-12, 0, 0]),
    sph([0.09, 0.1, 0.002], [0, 0.88, 0.399], '#E8B892', 'gloss', segments=8, rotate=[-12, 0, 0]),  # friend's face
    # ring light
    cyl([0.12, 0.015, 0.12], [0.32, 0.763, 0.37], '#3A3D41', 'satin'),
    cyl([0.015, 0.36, 0.015], [0.32, 0.94, 0.37], '#3A3D41', 'satin'),
    torus([0.26, 0.035, 0.26], [0.32, 1.22, 0.37], '#FFF6E2', 'gloss', rotate=[90, 0, 0]),
    # mug, notebook, plant
    cyl([0.07, 0.09, 0.07], [-0.28, 0.8, 0.26], CORAL, 'gloss'),
    box([0.14, 0.012, 0.2], [-0.3, 0.762, 0.33], SUNNY, 'matte', radius=0.004, rotate=[0, -10, 0]),
    lathe([0.11, 0.1, 0.11], [-0.33, 0.805, 0.38], '#F4EDE4', 'satin', profile=[[0, -0.5], [0.4, -0.5], [0.5, 0.5], [0, 0.5]]),
    sph([0.15, 0.13, 0.13], [-0.33, 0.9, 0.38], '#5E8F4E', 'foliage', segments=10),
]
# chair: seat centred on the Sim (z = 0, top 0.45)
vc += [cushion([0.44, 0.08, 0.42], [0, 0.41, -0.02], TURQ, radius=0.03),
       cushion([0.44, 0.42, 0.08], [0, 0.68, -0.25], TURQ, rotate=[-8, 0, 0], radius=0.035)]
for x in (-0.19, 0.19):
    vc += [cyl([0.03, 0.38, 0.03], [x, 0.19, 0.14], OAK, 'wood', taper=0.7),
           cyl([0.03, 0.38, 0.03], [x, 0.19, -0.18], OAK, 'wood', taper=0.7)]
E['model.outgoing.videoCallNook'] = placeholder(vc)

# ---- Dance floor (2x2): glowing tiles, mirror ball on a gantry, speaker towers -------------
df = [box([1.88, 0.06, 1.88], [0, 0.03, 0], '#E4E1DA', 'satin', radius=0.01)]
TILE = [MAGENTA, TURQ, SUNNY, '#8E6BD6', '#58C7E8', CORAL]
for i in range(4):
    for j in range(4):
        c = TILE[(i * 3 + j * 2) % len(TILE)]
        df.append(box([0.43, 0.012, 0.43], [-0.675 + 0.45 * i, 0.066, -0.675 + 0.45 * j], c, 'gloss', radius=0.004))
for s in (-1, 1):
    df += [box([0.06, 2.3, 0.06], [s * 0.9, 1.15, 0.0], '#C9CCD0', 'metal', radius=0.01),         # gantry posts
           box([0.2, 0.04, 0.3], [s * 0.85, 0.02, 0.0], '#C9CCD0', 'metal', radius=0.01),
           box([0.22, 0.86, 0.22], [s * 0.8, 0.5, -0.8], '#E4E1DA', 'satin', radius=0.02),         # speaker towers
           cyl([0.15, 0.02, 0.15], [s * 0.8, 0.62, -0.685], '#3A3D41', 'satin', rotate=[90, 0, 0]),
           cyl([0.08, 0.022, 0.08], [s * 0.8, 0.62, -0.682], MAGENTA, 'gloss', rotate=[90, 0, 0]),
           cyl([0.1, 0.02, 0.1], [s * 0.8, 0.82, -0.685], '#3A3D41', 'satin', rotate=[90, 0, 0])]
df += [box([1.86, 0.06, 0.06], [0, 2.3, 0.0], '#C9CCD0', 'metal', radius=0.01),
       cyl([0.01, 0.25, 0.01], [0, 2.15, 0.0], CHROME, 'chrome'),
       sph([0.34, 0.34, 0.34], [0, 1.88, 0.0], '#E8EEF2', 'chrome', segments=8),               # mirror ball
       cyl([0.1, 0.14, 0.1], [-0.7, 2.2, 0.0], '#3A3D41', 'satin', rotate=[0, 0, 40], taper=1.3),  # spots
       cyl([0.1, 0.14, 0.1], [0.7, 2.2, 0.0], '#3A3D41', 'satin', rotate=[0, 0, -40], taper=1.3)]
E['model.outgoing.danceFloor'] = placeholder(df)

# ---- Party photo wall (1x1): cork board on legs with snapshots, string lights, balloons ----
pw = [box([0.84, 1.0, 0.04], [0, 1.2, -0.36], '#C9A27A', 'matte', radius=0.01),
      box([0.88, 0.05, 0.06], [0, 1.715, -0.36], OAK, 'wood', radius=0.012),
      box([0.88, 0.05, 0.06], [0, 0.685, -0.36], OAK, 'wood', radius=0.012)]
for x in (-0.42, 0.42):
    pw += [box([0.05, 1.74, 0.05], [x, 0.87, -0.36], OAK, 'wood', radius=0.012),
           box([0.06, 0.04, 0.34], [x, 0.02, -0.28], OAK, 'wood', radius=0.012)]
PHOTO = [CORAL, TURQ, SUNNY, MAGENTA, '#8E6BD6', '#7FB069', '#58C7E8', '#E8B04A']
spots = [(-0.27, 1.45, 6), (0.0, 1.5, -4), (0.26, 1.44, 8), (-0.24, 1.15, -7), (0.03, 1.18, 3),
         (0.28, 1.12, -5), (-0.14, 0.88, 4), (0.16, 0.86, -8)]
for i, (x, y, r) in enumerate(spots):
    pw += [box([0.17, 0.2, 0.008], [x, y, -0.335], '#FAFAF7', 'satin', radius=0.003, rotate=[0, 0, r]),
           box([0.14, 0.13, 0.004], [x, y + 0.02, -0.33], PHOTO[i % len(PHOTO)], 'gloss', radius=0.003, rotate=[0, 0, r]),
           sph([0.022, 0.022, 0.012], [x, y + 0.09, -0.326], ['#D9483B', '#3E8EDE', SUNNY][i % 3], 'gloss', segments=6)]
# string lights draped across the top
pts = [(-0.42 + 0.84 * t / 8, 1.66 - 0.09 * math.sin(math.pi * t / 8)) for t in range(9)]
for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
    pw.append(rod([x0, y0, -0.32], [x1, y1, -0.32], 0.006, '#3A3D41', 'satin'))
for x, y in pts[1:-1]:
    pw.append(sph([0.035, 0.045, 0.035], [x, y - 0.03, -0.31], '#FFE9A8', 'gloss', segments=8))
# balloons
for x, y, z, c in [(0.3, 1.92, -0.25, CORAL), (0.32, 2.04, -0.18, TURQ), (0.22, 2.0, -0.15, SUNNY)]:
    pw += [sph([0.2, 0.24, 0.2], [x, y, z], c, 'gloss', segments=12),
           rod([x, y - 0.12, z], [0.36, 1.66, -0.33], 0.004, '#F2F2F0', 'matte')]
pw += [box([0.3, 0.2, 0.22], [0.15, 0.1, -0.05], SUNNY, 'satin', radius=0.01),           # gift box
       box([0.04, 0.205, 0.225], [0.15, 0.1025, -0.05], MAGENTA, 'satin', radius=0.004),
       box([0.305, 0.205, 0.04], [0.15, 0.1025, -0.05], MAGENTA, 'satin', radius=0.004)]
E['model.outgoing.photoWall'] = placeholder(pw)


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
