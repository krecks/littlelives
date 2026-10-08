# Slob pack models (web/public/assets/packs/slob/manifest.json): comfy, a bit messy, bright plastic.
# Conventions: see pack_foodie.py. Run: python3 -I pack_slob.py [out.json] && python3 -I apply_pack.py slob out.json
import math, os, random, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, mat, gltf, placeholder,  # noqa: E402
                       OAK, OAKD, HONEY, CHROME, TEAL, MUSTARD, RUST, CREAM)
from pack_foodie import run  # noqa: E402

LIB = '../../models/'
E, FOOT = {}, {}
POP = ['#E8473B', '#F2A541', '#3E8EDE', '#6CC27A', '#9B59B6', '#F2D14E']
CYAN = '#3FD0E0'


def can(x, z, y, c, lying=False, rot=0):
    r = [90, rot, 0] if lying else [0, rot, 0]
    yy = y + (0.033 if lying else 0.06)
    return [cyl([0.066, 0.12, 0.066], [x, yy, z], c, 'gloss', rotate=r, segments=12)]


def chip_bag(x, z, y, c, rot=0, tilt=0):
    return [cushion([0.16, 0.22, 0.06], [x, y + 0.11, z], c, rotate=[tilt, rot, 0], radius=0.025)]


def wrapper(x, z, c):
    return [part('blob', [0.08, 0.05, 0.07], [x, 0.035, z], c, 'satin', noise=0.35)]


# ---- microwaveCart (1x1): rolling cart, microwave (Kenney, restyled), frozen-dinner stacks ------
def microwave_cart():
    FR = '#D9533F'
    p = [box([0.7, 0.03, 0.46], [0, 0.8, -0.22], '#E9E4DA', 'satin', radius=0.01),
         box([0.66, 0.03, 0.42], [0, 0.42, -0.22], '#E9E4DA', 'satin', radius=0.01),
         box([0.66, 0.03, 0.42], [0, 0.1, -0.22], '#E9E4DA', 'satin', radius=0.01)]
    for x in (-0.33, 0.33):
        for z in (-0.42, -0.02):
            p += [cyl([0.035, 0.76, 0.035], [x, 0.46, z], FR, 'metal', segments=10),
                  torus([0.07, 0.022, 0.07], [x, 0.035, z], '#3A3D41', 'satin', rotate=[0, 0, 90], segments=12)]
    # frozen dinners stacked (cartons), a pizza box, cutlery jar
    rnd = random.Random(4)
    y = 0.435
    for i in range(4):
        h = 0.045
        p.append(box([0.26, h, 0.2], [-0.16 + rnd.uniform(-0.02, 0.02), y + h / 2, -0.22], POP[i % 6], 'satin', radius=0.008,
                     rotate=[0, rnd.uniform(-10, 10), 0]))
        y += h
    p += [box([0.3, 0.04, 0.3], [0.16, 0.455, -0.22], '#E9D8B4', 'matte', radius=0.006),       # pizza box
          box([0.2, 0.002, 0.08], [0.16, 0.476, -0.22], '#C9483B', 'matte'),
          box([0.28, 0.035, 0.22], [0.0, 0.135, -0.22], '#3E8EDE', 'satin', radius=0.008),     # cool box below
          box([0.28, 0.035, 0.22], [0.0, 0.17, -0.2], '#F2A541', 'satin', radius=0.008)]
    p += can(0.24, -0.06, 0.815, '#E8473B') + can(-0.28, -0.08, 0.815, '#6CC27A')
    p += [lathe([0.07, 0.12, 0.07], [0.28, 0.875, -0.38], '#E9E4DA', 'gloss',
                [[0, -0.5], [0.45, -0.5], [0.5, 0.5], [0, 0.4]], segments=10),
          rod([0.28, 0.9, -0.38], [0.3, 1.0, -0.4], 0.012, CHROME, 'chrome'),
          rod([0.28, 0.9, -0.38], [0.26, 0.99, -0.36], 0.012, CHROME, 'chrome')]
    p += wrapper(0.3, 0.3, '#F2D14E') + wrapper(-0.25, 0.28, '#E8473B')
    # Kenney kitchenMicrowave: carpetWhite = body, metalMedium = side panel, metalDark = display, glass = door
    fb = [box([0.5, 0.3, 0.38], [0, 0.965, -0.24], '#F2EDE2', 'gloss', radius=0.02)] + p
    return gltf(LIB + 'kenney/kitchenMicrowave.glb', [0.52, 0.32, 0.4], {
        'carpetWhite': mat('gloss', '#F2EDE2'), 'metalMedium': mat('satin', '#C9CBCC'),
        'metalDark': mat('gloss', '#2E3A46'), 'glass': mat('gloss', '#3A4652')},
        align='back', offset=[-0.04, 0.815, 0.06], parts=p, placeholder=fb)


E['model.slob.microwaveCart'] = microwave_cart(); FOOT['model.slob.microwaveCart'] = (1, 1)


# ---- beanbag (1x1, sit + lie): a huge wipe-clean beanbag, snack bag and a controller nearby -----
def beanbag():
    BB = '#E07A2E'
    p = [part('blob', [0.84, 0.36, 0.84], [0, 0.2, 0.0], BB, 'satin', noise=0.08),             # body
         part('blob', [0.8, 0.5, 0.36], [0, 0.4, -0.24], BB, 'satin', noise=0.1),              # raised back
         part('blob', [0.56, 0.12, 0.5], [0, 0.4, 0.04], '#EB8C40', 'satin', noise=0.1),       # seat dimple (top ~0.46)
         torus([0.6, 0.03, 0.56], [0, 0.03, 0.0], '#C8642A', 'satin', segments=24)]             # base seam
    p += chip_bag(0.28, 0.3, -0.04, '#F2D14E', rot=30, tilt=70)
    p += [box([0.14, 0.035, 0.09], [-0.34, 0.018, 0.32], '#3A4250', 'satin', radius=0.02, rotate=[0, -25, 0]),
          sph([0.02, 0.012, 0.02], [-0.31, 0.04, 0.32], '#E8473B', 'gloss', segments=6)]
    p += can(-0.38, -0.32, 0.0, '#3E8EDE', lying=True, rot=40) + wrapper(0.3, -0.36, '#E8473B') + wrapper(0.38, 0.1, '#6CC27A')
    return placeholder(p)


E['model.slob.beanbag'] = beanbag(); FOOT['model.slob.beanbag'] = (1, 1)


# ---- snackNightstand (1x1, sit on it): padded-top nightstand, side drawer open and full of snacks -
def snack_nightstand():
    NS = '#6E9FC0'
    p = [box([0.56, 0.38, 0.46], [0, 0.19, -0.02], NS, 'satin', radius=0.02),                  # cabinet
         cushion([0.56, 0.08, 0.46], [0, 0.41, -0.02], '#F2D14E', radius=0.035),              # padded top (0.45)
         box([0.012, 0.13, 0.4], [0.284, 0.26, -0.02], '#5A8BAE', 'satin', radius=0.006),     # drawer fronts (side)
         box([0.012, 0.13, 0.4], [0.284, 0.1, -0.02], '#5A8BAE', 'satin', radius=0.006)]
    # top drawer pulled out to +X, overflowing
    p += [box([0.16, 0.1, 0.38], [0.36, 0.27, -0.02], '#E9E4DA', 'satin', radius=0.008),
          box([0.012, 0.13, 0.42], [0.445, 0.27, -0.02], '#5A8BAE', 'satin', radius=0.006),
          box([0.02, 0.02, 0.1], [0.44, 0.29, -0.02], '#E9E4DA', 'gloss', radius=0.008)]
    for i, (dz, c) in enumerate(((-0.12, '#E8473B'), (0.0, '#F2A541'), (0.12, '#6CC27A'))):
        p += chip_bag(0.36, -0.02 + dz, 0.25, c, rot=90, tilt=-15 + i * 12)
    p += [cyl([0.09, 0.02, 0.09], [0.36, 0.33, 0.14], '#8E5A3A', 'matte', segments=12),         # cookies
          cyl([0.09, 0.02, 0.09], [0.37, 0.35, 0.13], '#A06A42', 'matte', segments=12)]
    p += [box([0.03, 0.03, 0.04], [0.296, 0.1, -0.02], '#E9E4DA', 'gloss', radius=0.01)]        # lower pull
    # floor clutter: cans, wrappers, an alarm clock knocked over
    p += can(-0.36, 0.26, 0.0, '#3E8EDE', lying=True, rot=70) + can(-0.38, -0.3, 0.0, '#E8473B')
    p += wrapper(-0.2, 0.36, '#F2D14E') + wrapper(0.2, 0.34, '#9B59B6')
    p += [cyl([0.12, 0.06, 0.12], [-0.34, 0.06, -0.06], '#F2EDE2', 'gloss', rotate=[90, 0, 30], segments=14),
          cyl([0.09, 0.008, 0.09], [-0.345, 0.06, -0.03], '#2E3A46', 'gloss', rotate=[90, 0, 30], segments=14)]
    return placeholder(p)


E['model.slob.snackNightstand'] = snack_nightstand(); FOOT['model.slob.snackNightstand'] = (1, 1)


# ---- spritzStation (1x1): narrow shelf unit with a round mirror and an arsenal of sprays -------
def spritz_station():
    p = [box([0.6, 0.03, 0.26], [0, 0.92, -0.3], '#F2EDE2', 'satin', radius=0.01),             # vanity top
         box([0.56, 0.03, 0.24], [0, 0.42, -0.3], '#F2EDE2', 'satin', radius=0.01)]
    for x in (-0.28, 0.28):
        p.append(box([0.04, 0.92, 0.24], [x, 0.46, -0.3], '#9B59B6', 'satin', radius=0.012))
    p += [cyl([0.46, 0.03, 0.46], [0, 1.35, -0.42], '#9B59B6', 'satin', rotate=[90, 0, 0], segments=28),  # mirror frame
          cyl([0.4, 0.01, 0.4], [0, 1.35, -0.403], '#DCE6EA', 'chrome', rotate=[90, 0, 0], segments=28),
          box([0.04, 0.28, 0.03], [0, 1.03, -0.43], '#9B59B6', 'satin', radius=0.01)]
    # sprays + dry shampoo on the top, more on the lower shelf
    for i, (c, h) in enumerate((('#3E8EDE', 0.22), ('#E8473B', 0.18), ('#F2D14E', 0.24), ('#6CC27A', 0.2), ('#F2A541', 0.16))):
        x = -0.22 + i * 0.11
        p += [cyl([0.06, h, 0.06], [x, 0.935 + h / 2, -0.3], c, 'gloss', segments=12),
              cyl([0.045, 0.04, 0.045], [x, 0.955 + h, -0.3], '#E9E4DA', 'satin', segments=10)]
    for i, c in enumerate(('#9B59B6', '#3E8EDE', '#E8473B')):
        p += [cyl([0.07, 0.16, 0.07], [-0.18 + i * 0.12, 0.515, -0.3], c, 'gloss', segments=12)]
    p += [box([0.24, 0.04, 0.2], [0.16, 0.455, -0.3], '#F7F7F7', 'fabric', radius=0.015),      # towels
          box([0.36, 0.5, 0.03], [0.24, 0.74, -0.16], '#6CC27A', 'fabric', radius=0.015, rotate=[0, 0, -8]),  # draped towel
          part('blob', [0.42, 0.18, 0.34], [-0.14, 0.115, 0.14], '#6E9FC0', 'fabric', noise=0.25),  # laundry pile
          part('blob', [0.26, 0.12, 0.22], [0.08, 0.08, 0.24], '#E8473B', 'fabric', noise=0.25)]
    p += can(0.3, 0.3, 0.0, '#F2D14E', lying=True, rot=-30)
    return placeholder(p)


E['model.slob.spritzStation'] = spritz_station(); FOOT['model.slob.spritzStation'] = (1, 1)


# ---- arcadeCabinet (1x1): upright retro cabinet, lit marquee, tilted screen, stick + buttons ----
def arcade_cabinet():
    SIDE, BODY = '#6A4BB5', '#4660C2'
    p = []
    for x in (-0.33, 0.33):                                                                          # side panels
        p += [box([0.04, 1.84, 0.6], [x, 0.92, -0.145], SIDE, 'gloss', radius=0.015),
              box([0.042, 0.2, 0.6], [x, 0.5, -0.145], '#F2A541', 'gloss', radius=0.01),        # side art stripes
              box([0.042, 0.06, 0.6], [x, 0.66, -0.145], '#E8473B', 'gloss', radius=0.01)]
    p += [box([0.62, 0.84, 0.56], [0, 0.42, -0.17], BODY, 'satin', radius=0.012),              # lower body
          box([0.62, 1.0, 0.1], [0, 1.34, -0.4], BODY, 'satin', radius=0.012),               # back
          box([0.66, 0.06, 0.6], [0, 1.85, -0.145], SIDE, 'gloss', radius=0.012),             # top
          box([0.62, 0.24, 0.1], [0, 1.7, 0.08], '#F2D14E', 'gloss', radius=0.012, rotate=[-10, 0, 0]),   # marquee
          box([0.5, 0.12, 0.004], [0, 1.71, 0.135], '#E8473B', 'gloss', radius=0.01, rotate=[-10, 0, 0]),
          box([0.6, 0.5, 0.06], [0, 1.28, -0.04], '#1B2240', 'gloss', radius=0.012, rotate=[-18, 0, 0]),  # screen bezel
          box([0.48, 0.38, 0.004], [0, 1.28, -0.005], '#3BA3E0', 'gloss', radius=0.008, rotate=[-18, 0, 0]),  # screen glow
          box([0.12, 0.1, 0.004], [-0.1, 1.3, 0.0], '#F2D14E', 'gloss', radius=0.004, rotate=[-18, 0, 0]),     # sprites
          box([0.08, 0.06, 0.004], [0.12, 1.2, -0.02], '#E8473B', 'gloss', radius=0.004, rotate=[-18, 0, 0]),
          box([0.62, 0.08, 0.3], [0, 0.98, 0.15], BODY, 'satin', radius=0.012, rotate=[12, 0, 0]),   # control deck
          box([0.58, 0.004, 0.24], [0, 1.02, 0.16], '#F2A541', 'gloss', radius=0.006, rotate=[12, 0, 0]),
          cyl([0.03, 0.08, 0.03], [-0.14, 1.07, 0.15], '#2B2C2E', 'satin', segments=8),       # joystick
          sph([0.06, 0.06, 0.06], [-0.14, 1.12, 0.15], '#E8473B', 'gloss', segments=10)]
    for i, (dx, dz) in enumerate(((0.06, 0.12), (0.13, 0.11), (0.2, 0.12), (0.08, 0.2), (0.15, 0.19))):
        p.append(cyl([0.04, 0.02, 0.04], [dx, 1.035 + (0.15 - dz) * 0.2, dz], POP[i], 'gloss', segments=10))
    p += [box([0.22, 0.26, 0.012], [0, 0.5, 0.115], '#3A3D41', 'satin', radius=0.01),           # coin door
          box([0.03, 0.06, 0.004], [-0.05, 0.55, 0.122], '#E8473B', 'gloss', radius=0.006),
          box([0.03, 0.06, 0.004], [0.05, 0.55, 0.122], '#E8473B', 'gloss', radius=0.006),
          box([0.62, 0.05, 0.56], [0, 0.025, -0.17], '#2B2C2E', 'satin', radius=0.006)]
    p += can(0.38, 0.2, 0.0, '#6CC27A') + wrapper(-0.3, 0.32, '#F2D14E')
    return placeholder(p)


E['model.slob.arcadeCabinet'] = arcade_cabinet(); FOOT['model.slob.arcadeCabinet'] = (1, 1)


# ---- gamingRecliner (2x1, one seat at the centre): racing-style recliner with LED trim, side
#      mini-fridge table on the right, console dock and headset on the left -----------------------
def gaming_recliner():
    C1, C2 = '#5A6680', '#E8473B'
    p = [cushion([0.82, 0.3, 0.66], [0, 0.17, -0.06], C1, radius=0.06),                          # base
         cushion([0.6, 0.12, 0.58], [0, 0.39, -0.02], C2, radius=0.05),                         # seat (top 0.45)
         cushion([0.66, 0.78, 0.16], [0, 0.72, -0.27], C1, rotate=[-14, 0, 0], radius=0.07),   # tall back
         cushion([0.42, 0.62, 0.06], [0, 0.74, -0.18], C2, rotate=[-14, 0, 0], radius=0.03),   # racing stripe panel
         cushion([0.3, 0.14, 0.1], [0, 1.02, -0.24], '#F2EDE2', rotate=[-14, 0, 0], radius=0.04),  # headrest pillow
         cushion([0.5, 0.1, 0.24], [0, 0.34, 0.32], C1, rotate=[10, 0, 0], radius=0.04)]       # footrest out
    for s in (-1, 1):
        p += [cushion([0.14, 0.32, 0.66], [s * 0.36, 0.45, -0.06], C1, radius=0.05),
              box([0.008, 0.02, 0.6], [s * 0.432, 0.32, -0.06], CYAN, 'gloss', radius=0.006)]   # LED strips
    p += [box([0.8, 0.02, 0.008], [0, 0.04, 0.27], CYAN, 'gloss', radius=0.006),
          cyl([0.08, 0.02, 0.08], [0.36, 0.62, 0.12], '#2B2C2E', 'satin', segments=12),          # cup holder + soda
          cyl([0.066, 0.12, 0.066], [0.36, 0.69, 0.12], '#E8473B', 'gloss', segments=12)]
    # right: mini-fridge side table
    fx = 0.7
    p += [box([0.38, 0.56, 0.42], [fx, 0.28, -0.12], '#E9E4DA', 'gloss', radius=0.03),
          box([0.34, 0.5, 0.012], [fx, 0.28, 0.096], '#DCE6EA', 'glass', radius=0.02),
          box([0.36, 0.02, 0.008], [fx, 0.05, 0.1], CYAN, 'gloss', radius=0.004)]
    for i, c in enumerate(('#E8473B', '#3E8EDE', '#6CC27A')):
        p += [cyl([0.066, 0.12, 0.066], [fx - 0.1 + i * 0.1, 0.38, -0.08], c, 'gloss', segments=10)]
    p += chip_bag(fx, -0.12, 0.56, '#F2D14E', rot=20, tilt=-60)
    # left: console dock with a headset stand
    lx = -0.7
    p += [box([0.36, 0.4, 0.36], [lx, 0.2, -0.14], C1, 'satin', radius=0.03),
          box([0.3, 0.07, 0.24], [lx, 0.435, -0.16], '#E9E4DA', 'gloss', radius=0.015),         # console
          box([0.08, 0.008, 0.002], [lx + 0.05, 0.44, -0.039], CYAN, 'gloss', radius=0.002),
          cyl([0.025, 0.36, 0.025], [lx, 0.65, -0.24], '#5C6168', 'metal', segments=8),
          torus([0.2, 0.03, 0.08], [lx, 0.84, -0.24], C2, 'satin', rotate=[90, 0, 0], segments=20),   # headset band
          cyl([0.09, 0.05, 0.09], [lx - 0.1, 0.76, -0.24], C1, 'satin', rotate=[0, 0, 90], segments=14),  # ear cups
          cyl([0.09, 0.05, 0.09], [lx + 0.1, 0.76, -0.24], C1, 'satin', rotate=[0, 0, 90], segments=14),
          box([0.14, 0.03, 0.08], [lx + 0.08, 0.455, 0.0], '#E9E4DA', 'gloss', radius=0.02)]     # controller
    p += wrapper(0.3, 0.38, '#F2A541') + wrapper(-0.45, 0.32, '#9B59B6') + can(-0.3, 0.38, 0.0, '#3E8EDE', lying=True, rot=15)
    return placeholder(p)


E['model.slob.gamingRecliner'] = gaming_recliner(); FOOT['model.slob.gamingRecliner'] = (2, 1)


if __name__ == '__main__':
    sys.exit(1 if run('slob', sys.argv[1] if len(sys.argv) > 1 else None, E, FOOT) else 0)
