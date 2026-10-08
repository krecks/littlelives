# Foodie pack models (web/public/assets/packs/foodie/manifest.json).
# Conventions as in furniture.py: 1 unit = 1 m, origin at the footprint centre on the floor, front +Z,
# back against the wall at -Z, ~4.5 cm inside the footprint. Pack objects use characters.ts
# DEFAULT_SEAT (seat top 0.45 m, hips on the footprint centre line, facing +Z).
# Run: python3 -I pack_foodie.py [out.json] && python3 -I apply_pack.py foodie out.json
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, mat, gltf, placeholder,  # noqa: E402
                       validate_parts, WHITE, OFFWHITE, OAK, OAKD, HONEY, WALNUT, BRASS, CHROME, STEEL,
                       TEAL, MUSTARD, SAGE, RUST, CREAM, SCREEN)

LIB = '../../models/'
E, FOOT = {}, {}
TERRA, SOIL, BASIL, THYME, ROSEMARY = '#C46A43', '#5A4030', '#5E9E3E', '#86A06E', '#4E7C52'
COPPER = '#C27A4A'


def pot(x, z, y=0.0, d=0.18, h=0.16, color=TERRA):
    """Terracotta pot (lathe) with a rim; returns parts with the soil top at y + h."""
    return [lathe([d, h, d], [x, y + h / 2, z], color, 'matte',
                  [[0.0, -0.5], [0.36, -0.5], [0.44, 0.25], [0.5, 0.3], [0.5, 0.5], [0.44, 0.5], [0.0, 0.42]], segments=16)]


def herbs(x, z, y, kind, d=0.18):
    if kind == 'basil':
        return [sph([d * 1.1, d * 0.75, d * 1.1], [x, y + d * 0.3, z], BASIL, 'foliage', segments=10),
                sph([d * 0.7, d * 0.55, d * 0.7], [x + d * 0.15, y + d * 0.55, z - d * 0.1], '#6FB04A', 'foliage', segments=8)]
    if kind == 'thyme':
        return [part('blob', [d * 1.2, d * 0.6, d * 1.2], [x, y + d * 0.25, z], THYME, 'foliage', noise=0.25)]
    out = []  # rosemary: upright needle sprigs
    for i in range(7):
        a = i * 2.4
        out.append(cone([0.035, d * 1.3, 0.035], [x + math.cos(a) * d * 0.22, y + d * 0.62, z + math.sin(a) * d * 0.22],
                        ROSEMARY, 'foliage', taper=0.15, segments=6, rotate=[math.cos(a) * 8, 0, math.sin(a) * 8]))
    return out


# ---- herbGarden (1x1): wooden planter crate on a stand, herbs, tools ------------------------
def herb_garden():
    p = []
    # stand: four legs + lower slatted shelf
    for x in (-0.38, 0.38):
        for z in (-0.4, -0.06):
            p.append(box([0.045, 0.62, 0.045], [x, 0.31, z], HONEY, 'wood', radius=0.008))
    for z in (-0.36, -0.23, -0.1):
        p.append(box([0.78, 0.02, 0.09], [0, 0.18, z], HONEY, 'wood', radius=0.004))
    p += [box([0.8, 0.03, 0.06], [0, 0.6, -0.4], HONEY, 'wood', radius=0.006),
          box([0.8, 0.03, 0.06], [0, 0.6, -0.06], HONEY, 'wood', radius=0.006)]
    # trough planter (the real crate model sits on top; soil + herbs inside)
    p.append(box([0.8, 0.02, 0.33], [0, 0.95, -0.26], SOIL, 'matte', radius=0.005))
    p += herbs(-0.26, -0.26, 0.96, 'basil', 0.2) + herbs(0.0, -0.26, 0.96, 'rosemary', 0.2) + herbs(0.27, -0.26, 0.96, 'thyme', 0.22)
    for x, label in ((-0.26, '#F2EDE2'), (0.0, '#F2EDE2'), (0.27, '#F2EDE2')):
        p.append(box([0.08, 0.05, 0.006], [x, 0.92, -0.06], label, 'matte', radius=0.003, rotate=[-15, 0, 0]))  # chalk tags
    # lower shelf: two pots with seedlings + a trowel
    p += pot(-0.22, -0.24, 0.19) + [sph([0.16, 0.12, 0.16], [-0.22, 0.4, -0.24], '#6FB04A', 'foliage', segments=8)]
    p += pot(0.18, -0.24, 0.19, d=0.15, h=0.13) + [sph([0.13, 0.1, 0.13], [0.18, 0.36, -0.24], BASIL, 'foliage', segments=8)]
    p += [box([0.05, 0.012, 0.12], [0.36, 0.2, -0.22], '#9EA3A8', 'metal', radius=0.004, rotate=[0, 25, 0]),
          box([0.03, 0.025, 0.09], [0.34, 0.205, -0.32], HONEY, 'wood', radius=0.01, rotate=[0, 25, 0])]
    # a basket of picked herbs at the front
    p += [lathe([0.22, 0.1, 0.16], [-0.2, 0.05, 0.25], '#C9A46E', 'wood',
                [[0.0, -0.5], [0.42, -0.5], [0.5, 0.5], [0.46, 0.5], [0.38, -0.3], [0.0, -0.3]], segments=14),
          sph([0.16, 0.08, 0.12], [-0.2, 0.1, 0.25], BASIL, 'foliage', segments=8)]
    return gltf(LIB + 'ph/planter_box_01.glb', [0.84, 0.39, 0.38], align='back', offset=[0, 0.615, 0.045],
                parts=p, placeholder=[box([0.84, 0.36, 0.38], [0, 0.8, -0.26], HONEY, 'wood', radius=0.01)] + p)


E['model.foodie.herbGarden'] = herb_garden(); FOOT['model.foodie.herbGarden'] = (1, 1)


# ---- deliPantry (1x1): tall cream pantry, glass upper doors, hanging salami, cheese, bread -----
def deli_pantry():
    BODY, TRIM = '#EDE4D0', HONEY
    p = [box([0.84, 0.92, 0.46], [0, 0.5, -0.22], BODY, 'satin', radius=0.012),             # lower carcass
         box([0.03, 0.96, 0.44], [-0.405, 1.44, -0.225], BODY, 'satin', radius=0.006),         # upper sides
         box([0.03, 0.96, 0.44], [0.405, 1.44, -0.225], BODY, 'satin', radius=0.006),
         box([0.86, 0.05, 0.46], [0, 1.965, -0.22], TRIM, 'wood', radius=0.01),              # crown
         box([0.82, 0.08, 0.44], [0, 0.04, -0.22], TRIM, 'wood', radius=0.006),              # plinth
         box([0.88, 0.04, 0.5], [0, 0.94, -0.195], '#F3EFE8', 'gloss', radius=0.008)]         # marble counter ledge
    # lower doors (closed)
    for x in (-0.205, 0.205):
        p += [box([0.39, 0.78, 0.02], [x, 0.5, 0.015], BODY, 'satin', radius=0.008),
              box([0.3, 0.64, 0.012], [x, 0.5, 0.028], '#E4D9C1', 'satin', radius=0.006),
              box([0.014, 0.12, 0.02], [x - math.copysign(0.15, x), 0.62, 0.045], BRASS, 'metal', radius=0.005)]
    # open upper shelves behind glass doors
    for y in (1.2, 1.5, 1.78):
        p.append(box([0.78, 0.02, 0.38], [0, y, -0.24], TRIM, 'wood', radius=0.004))
    p += [box([0.78, 0.86, 0.006], [0, 1.47, -0.44], '#E2D6BC', 'matte', radius=0.002)]       # back panel
    jars = [('#C98A3A', -0.3), ('#9DB86A', -0.18), ('#B5653F', -0.06)]
    for c, x in jars:
        p += [cyl([0.09, 0.15, 0.09], [x, 1.285, -0.22], c, 'gloss', segments=12),
              cyl([0.095, 0.03, 0.095], [x, 1.375, -0.22], BRASS, 'metal', segments=12)]
    p += [cyl([0.22, 0.08, 0.22], [0.2, 1.25, -0.24], MUSTARD, 'satin', segments=20),            # cheese wheels
          cyl([0.2, 0.08, 0.2], [0.21, 1.33, -0.24], '#E9C46A', 'satin', segments=20),
          part('capsule', [0.12, 0.32, 0.12], [-0.12, 1.57, -0.24], '#C8964F', 'matte', rotate=[0, 0, 90]),  # loaves
          part('capsule', [0.1, 0.26, 0.1], [0.2, 1.565, -0.22], '#B98143', 'matte', rotate=[0, 30, 90]),
          cyl([0.07, 0.24, 0.07], [-0.3, 1.63, -0.26], '#6E2B33', 'gloss', segments=10),        # wine
          cyl([0.07, 0.24, 0.07], [-0.22, 1.63, -0.26], '#3E5A3A', 'gloss', segments=10)]
    for x in (-0.24, -0.08, 0.1, 0.25):                                                            # hanging salami
        p += [cyl([0.006, 0.06, 0.006], [x, 1.73, -0.12], '#E9E1CF', 'matte', segments=4),
              part('capsule', [0.06, 0.2, 0.06], [x, 1.6, -0.12], '#8E3B2E', 'matte')]
    p.append(box([0.78, 0.02, 0.02], [0, 1.765, -0.12], BRASS, 'metal', radius=0.006))         # rail
    for x in (-0.405, 0.0, 0.405):                                                                  # open shelf stiles
        p.append(box([0.03, 0.86, 0.03], [x, 1.47, 0.0], BODY, 'satin', radius=0.006))
    p.append(box([0.84, 0.05, 0.03], [0, 1.88, 0.0], BODY, 'satin', radius=0.006))
    # counter: board with cheese wedge + bread
    p += [box([0.4, 0.02, 0.24], [0.08, 0.97, 0.04], OAKD, 'wood', radius=0.006),
          part('cone', [0.12, 0.07, 0.12], [0.0, 1.015, 0.04], '#F0C75E', 'satin', segments=3, rotate=[0, 30, 0]),
          part('capsule', [0.08, 0.18, 0.08], [0.17, 1.02, 0.05], '#C8964F', 'matte', rotate=[0, 70, 90]),
          sph([0.05, 0.05, 0.05], [-0.3, 1.0, 0.05], '#B33A32', 'gloss', segments=8),           # tomatoes
          sph([0.05, 0.05, 0.05], [-0.25, 1.0, 0.08], '#C9483B', 'gloss', segments=8)]
    return placeholder(p)


E['model.foodie.deliPantry'] = deli_pantry(); FOOT['model.foodie.deliPantry'] = (1, 1)


# ---- espressoBar (1x1): a lever espresso machine on a wooden cart -----------------------------
def espresso_bar():
    W = '#2F5D62'  # deep teal cart body
    p = [box([0.76, 0.04, 0.5], [0, 0.88, -0.2], OAK, 'wood', radius=0.01),                  # top
         box([0.72, 0.03, 0.46], [0, 0.42, -0.2], OAK, 'wood', radius=0.008),                # middle shelf
         box([0.72, 0.03, 0.46], [0, 0.12, -0.2], OAK, 'wood', radius=0.008)]                # bottom shelf
    for x in (-0.35, 0.35):
        for z in (-0.42, 0.02):
            p.append(box([0.04, 0.84, 0.04], [x, 0.5, z], W, 'satin', radius=0.01))
            p.append(cyl([0.07, 0.025, 0.07], [x, 0.045, z], '#3A3D41', 'satin', rotate=[0, 0, 90], segments=12))  # castors
    p += [box([0.6, 0.02, 0.02], [0, 0.94, 0.06], BRASS, 'metal', radius=0.008),             # towel rail
          box([0.18, 0.12, 0.005], [0.18, 0.89, 0.065], '#F2EDE2', 'fabric', radius=0.004)]  # towel
    # machine: copper boiler dome on a cream body, two group heads, levers
    p += [box([0.42, 0.3, 0.3], [-0.06, 1.05, -0.25], '#EFE6D4', 'gloss', radius=0.04),
          lathe([0.22, 0.24, 0.22], [-0.06, 1.32, -0.27], COPPER, 'metal',
                [[0.0, -0.5], [0.5, -0.5], [0.5, 0.1], [0.3, 0.42], [0.08, 0.5], [0.0, 0.5]], segments=20),
          sph([0.05, 0.05, 0.05], [-0.06, 1.46, -0.27], BRASS, 'metal', segments=10),       # eagle finial
          box([0.4, 0.02, 0.18], [-0.06, 0.915, -0.12], CHROME, 'chrome', radius=0.004)]    # drip tray
    for x in (-0.16, 0.04):
        p += [cyl([0.07, 0.05, 0.07], [x, 1.0, -0.08], CHROME, 'chrome', segments=12),       # group head
              rod([x, 1.08, -0.1], [x, 1.32, 0.0], 0.02, CHROME, 'chrome'),                   # lever
              sph([0.04, 0.05, 0.04], [x, 1.33, 0.005], '#2B2C2E', 'gloss', segments=8),
              lathe([0.06, 0.05, 0.06], [x, 0.95, -0.08], '#F6F3EA', 'gloss',               # cup
                    [[0, -0.5], [0.4, -0.5], [0.5, 0.5], [0.42, 0.5], [0.34, -0.3], [0, -0.3]], segments=12)]
    p += [rod([0.12, 1.12, -0.2], [0.17, 1.0, -0.06], 0.012, CHROME, 'chrome'),             # steam wand
          cyl([0.09, 0.12, 0.09], [0.25, 0.96, -0.12], CHROME, 'chrome', taper=0.85),         # milk jug
          lathe([0.12, 0.2, 0.12], [0.26, 1.0, -0.33], '#F2EDE2', 'gloss',                   # grinder hopper
                [[0, -0.5], [0.35, -0.5], [0.35, -0.1], [0.5, 0.5], [0, 0.5]], segments=14),
          sph([0.1, 0.06, 0.1], [0.26, 1.08, -0.33], '#5A3A26', 'satin', segments=8)]        # beans
    # cups + bean sacks below
    for i, x in enumerate((-0.25, -0.17, -0.09)):
        p.append(lathe([0.07, 0.06, 0.07], [x, 0.465, -0.15], '#F6F3EA' if i != 1 else TEAL, 'gloss',
                       [[0, -0.5], [0.4, -0.5], [0.5, 0.5], [0.42, 0.5], [0.34, -0.3], [0, -0.3]], segments=12))
    p += [box([0.24, 0.2, 0.16], [0.18, 0.23, -0.22], '#C9A46E', 'fabric', radius=0.05),     # bean sacks
          box([0.2, 0.16, 0.14], [-0.15, 0.21, -0.2], '#B98E5A', 'fabric', radius=0.05),
          cyl([0.12, 0.2, 0.12], [0.2, 0.535, -0.25], '#3E5A3A', 'gloss', segments=12)]        # syrup bottle
    return placeholder(p)


E['model.foodie.espressoBar'] = espresso_bar(); FOOT['model.foodie.espressoBar'] = (1, 1)


# ---- cookbookLectern (1x1): turned-wood lectern with an open cookbook, cookbook stack ---------
def cookbook_lectern():
    p = [cyl([0.36, 0.05, 0.36], [0, 0.025, -0.05], WALNUT, 'wood', segments=20),
         lathe([0.12, 0.9, 0.12], [0, 0.5, -0.05], WALNUT, 'wood',
               [[0, -0.5], [0.42, -0.5], [0.3, -0.38], [0.22, -0.2], [0.25, 0.0], [0.2, 0.3], [0.32, 0.45], [0.5, 0.5], [0, 0.5]], segments=16),
         box([0.56, 0.04, 0.42], [0, 1.02, -0.04], WALNUT, 'wood', radius=0.012, rotate=[25, 0, 0]),   # slanted desk
         box([0.5, 0.03, 0.03], [0, 0.93, 0.15], HONEY, 'wood', radius=0.008, rotate=[25, 0, 0])]      # book ledge
    # open cookbook on the desk (two page blocks + cover)
    R = [25, 0, 0]
    piv = [0, 1.02, -0.04]
    from furniture import on
    p += [box([0.48, 0.012, 0.34], on(piv, R, [0, 0.026, 0]), '#B33A32', 'satin', radius=0.004, rotate=R),
          box([0.22, 0.03, 0.31], on(piv, R, [-0.115, 0.045, 0]), '#F6F1E4', 'matte', radius=0.012, rotate=[25, 0, -4]),
          box([0.22, 0.03, 0.31], on(piv, R, [0.115, 0.045, 0]), '#F6F1E4', 'matte', radius=0.012, rotate=[25, 0, 4]),
          box([0.12, 0.002, 0.08], on(piv, R, [-0.11, 0.062, -0.04]), '#E9C46A', 'matte', rotate=R),   # recipe photo
          box([0.012, 0.002, 0.26], on(piv, R, [0.09, 0.062, 0.0]), '#C9483B', 'matte', rotate=R)]    # ribbon
    # stack of cookbooks + a wooden spoon jar on a low stool to the side
    p += [cyl([0.3, 0.42, 0.3], [0.3, 0.21, -0.28], HONEY, 'wood', taper=0.85, segments=14)]
    y = 0.42
    for w, h, c, r in ((0.26, 0.05, TEAL, 6), (0.24, 0.04, MUSTARD, -8), (0.25, 0.06, '#B33A32', 3), (0.22, 0.04, SAGE, 12)):
        p.append(box([w, h, w * 0.75], [0.3, y + h / 2, -0.28], c, 'satin', radius=0.006, rotate=[0, r, 0]))
        y += h
    p += [lathe([0.1, 0.14, 0.1], [-0.32, 0.07, -0.3], '#F2EDE2', 'gloss',
                [[0, -0.5], [0.45, -0.5], [0.5, 0.5], [0.44, 0.5], [0, 0.4]], segments=14),
          rod([-0.32, 0.12, -0.3], [-0.34, 0.32, -0.32], 0.018, OAKD, 'wood'),
          rod([-0.32, 0.12, -0.3], [-0.29, 0.3, -0.27], 0.018, OAKD, 'wood'),
          sph([0.05, 0.03, 0.04], [-0.34, 0.33, -0.32], OAKD, 'wood', segments=6)]
    return placeholder(p)


E['model.foodie.cookbookLectern'] = cookbook_lectern(); FOOT['model.foodie.cookbookLectern'] = (1, 1)


# ---- pizzaOven (2x1, outdoor): brick base, plastered dome, chimney, wood store, prep counter ---
def pizza_oven():
    BRICK, PLASTER, STONE = '#A4614A', '#E8DAC4', '#C9C1B4'
    ox = -0.38
    p = [box([0.16, 0.7, 0.84], [ox - 0.45, 0.35, -0.03], BRICK, 'matte', radius=0.02),         # pillars
         box([0.16, 0.7, 0.84], [ox + 0.45, 0.35, -0.03], BRICK, 'matte', radius=0.02),
         box([1.06, 0.18, 0.84], [ox, 0.79, -0.03], BRICK, 'matte', radius=0.02),             # lintel block
         box([0.76, 0.7, 0.04], [ox, 0.35, -0.42], '#6E4535', 'matte', radius=0.004),           # niche back
         box([0.76, 0.04, 0.8], [ox, 0.02, -0.03], STONE, 'satin', radius=0.004),               # niche floor
         box([1.12, 0.06, 0.86], [ox, 0.89, -0.02], STONE, 'satin', radius=0.012)]             # hearth slab
    for i in range(3):
        for j in range(4 - i):
            p.append(cyl([0.1, 0.5, 0.1], [ox - 0.2 + j * 0.13 + i * 0.065, 0.1 + i * 0.09, 0.12], '#8B6B4E', 'bark',
                         rotate=[90, 0, 0], segments=8))                                            # logs
    p += [lathe([0.92, 0.62, 0.76], [ox, 1.23, -0.06], PLASTER, 'matte',                          # dome
                [[0, -0.5], [0.5, -0.5], [0.49, -0.2], [0.43, 0.1], [0.32, 0.33], [0.16, 0.47], [0, 0.5]], segments=28),
          cyl([0.46, 0.16, 0.46], [ox, 1.02, 0.34], BRICK, 'matte', rotate=[90, 0, 0], segments=20),  # brick arch ring
          cyl([0.32, 0.03, 0.3], [ox, 1.0, 0.41], '#2B2220', 'matte', rotate=[90, 0, 0], segments=20),   # dark mouth
          sph([0.16, 0.08, 0.08], [ox - 0.04, 0.97, 0.4], '#F28C28', 'gloss', segments=8),       # embers
          sph([0.1, 0.06, 0.08], [ox + 0.06, 0.98, 0.41], '#FFC24A', 'gloss', segments=8),
          cyl([0.12, 0.42, 0.12], [ox + 0.12, 1.66, -0.2], '#3E4146', 'metal', segments=14),    # chimney
          cyl([0.18, 0.04, 0.18], [ox + 0.12, 1.88, -0.2], '#3E4146', 'metal', segments=14),
          cyl([0.05, 0.02, 0.05], [ox + 0.2, 1.24, 0.38], BRASS, 'metal', rotate=[90, 0, 0])]  # thermometer
    # prep counter on the right
    cx = 0.56
    p += [box([0.74, 0.84, 0.64], [cx, 0.42, -0.13], STONE, 'satin', radius=0.012),
          box([0.78, 0.05, 0.66], [cx, 0.865, -0.12], '#E9E3D8', 'gloss', radius=0.01),
          box([0.6, 0.6, 0.02], [cx, 0.42, 0.18], OAK, 'wood', radius=0.008),                  # door
          box([0.1, 0.014, 0.02], [cx, 0.62, 0.2], '#3E4146', 'metal', radius=0.005)]
    # pizza on a peel + toppings jars + basil
    p += [box([0.3, 0.015, 0.3], [cx - 0.08, 0.9, -0.08], OAKD, 'wood', radius=0.06),
          box([0.05, 0.015, 0.34], [cx - 0.08, 0.9, 0.2], OAKD, 'wood', radius=0.01),
          cyl([0.26, 0.02, 0.26], [cx - 0.08, 0.915, -0.08], '#E8C27A', 'matte', segments=20),
          cyl([0.22, 0.008, 0.22], [cx - 0.08, 0.928, -0.08], '#C9483B', 'satin', segments=20)]
    for dx, dz in ((-0.05, -0.04), (0.04, -0.1), (-0.12, -0.12), (0.0, 0.0)):
        p.append(cyl([0.04, 0.01, 0.04], [cx - 0.08 + dx, 0.935, -0.08 + dz], '#F4EBD5', 'satin', segments=8))  # mozzarella
    p += [cyl([0.08, 0.12, 0.08], [cx + 0.24, 0.95, -0.36], '#F2EDE2', 'gloss', segments=12),
          cyl([0.08, 0.16, 0.08], [cx + 0.12, 0.97, -0.38], '#7A8F3A', 'gloss', segments=12),   # olive oil
          sph([0.14, 0.1, 0.14], [cx + 0.24, 1.05, -0.36], BASIL, 'foliage', segments=8)]
    return placeholder(p)


E['model.foodie.pizzaOven'] = pizza_oven(); FOOT['model.foodie.pizzaOven'] = (2, 1)


# ---- chefsIsland (2x1): marble island across the front with knee space, two stools ------------
def chefs_island():
    CAB, MARBLE = '#5F9095', '#F1EEEA'
    p = [box([1.86, 0.05, 0.44], [0, 0.805, 0.22], MARBLE, 'gloss', radius=0.012)]            # marble top (near edge z 0.0)
    for x in (-0.79, 0.79):                                                                        # end cabinets
        p += [box([0.26, 0.76, 0.42], [x, 0.4, 0.22], CAB, 'satin', radius=0.01),
              box([0.22, 0.2, 0.012], [x, 0.62, 0.007], CAB, 'satin', radius=0.006),
              box([0.22, 0.44, 0.012], [x, 0.27, 0.007], CAB, 'satin', radius=0.006),
              box([0.08, 0.012, 0.016], [x, 0.66, -0.004], BRASS, 'metal', radius=0.005),
              box([0.08, 0.012, 0.016], [x, 0.44, -0.004], BRASS, 'metal', radius=0.005)]
    p += [box([1.32, 0.7, 0.03], [0, 0.42, 0.42], CAB, 'satin', radius=0.008),                 # front panel (room side)
          box([1.32, 0.06, 0.32], [0, 0.73, 0.27], CAB, 'satin', radius=0.006),                # apron
          box([1.34, 0.03, 0.03], [0, 0.12, 0.42], BRASS, 'metal', radius=0.008),              # foot rail
          box([0.5, 0.008, 0.3], [0, 0.833, 0.24], '#22262B', 'gloss', radius=0.006)]          # induction hob
    for dx in (-0.12, 0.12):
        p.append(torus([0.16, 0.004, 0.16], [dx, 0.838, 0.24], '#C9483B', 'gloss', segments=20))  # hob rings
    p += [cyl([0.22, 0.09, 0.22], [-0.12, 0.88, 0.24], COPPER, 'metal', segments=20),          # copper pan
          rod([-0.23, 0.9, 0.24], [-0.42, 0.91, 0.24], 0.018, '#5A3A26', 'wood'),
          lathe([0.26, 0.2, 0.26], [0.12, 0.93, 0.26], '#E9E3D8', 'gloss',                     # stock pot
                [[0, -0.5], [0.46, -0.5], [0.5, -0.4], [0.5, 0.45], [0.47, 0.5], [0, 0.5]], segments=20),
          box([0.36, 0.02, 0.22], [0.58, 0.84, 0.2], OAK, 'wood', radius=0.008),               # chopping board
          sph([0.08, 0.07, 0.08], [0.52, 0.88, 0.2], '#C9483B', 'gloss', segments=8),           # tomato
          part('capsule', [0.04, 0.16, 0.04], [0.65, 0.865, 0.18], '#E2832E', 'satin', rotate=[0, 40, 90]),  # carrot
          sph([0.12, 0.1, 0.12], [0.66, 0.89, 0.27], BASIL, 'foliage', segments=8),
          box([0.16, 0.006, 0.03], [0.5, 0.853, 0.27], CHROME, 'chrome', radius=0.003),         # knife
          box([0.24, 0.12, 0.012], [-0.58, 0.9, 0.36], '#F4EFE2', 'matte', radius=0.004, rotate=[-20, 0, 0]),  # menu card
          lathe([0.2, 0.08, 0.2], [-0.58, 0.87, 0.16], '#F6F3EA', 'gloss',                     # tasting plate
                [[0, -0.5], [0.5, -0.4], [0.5, -0.3], [0.2, -0.3], [0, -0.3]], segments=20),
          sph([0.06, 0.03, 0.06], [-0.58, 0.87, 0.16], '#B33A32', 'satin', segments=8)]
    for x in (-0.5, 0.5):                                                                          # bar stools (seat 0.45)
        p += [cushion([0.38, 0.06, 0.36], [x, 0.43, -0.12], '#C9A46E', radius=0.025),
              lathe([0.34, 0.03, 0.32], [x, 0.39, -0.12], OAK, 'wood', [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], segments=20),
              box([0.36, 0.22, 0.03], [x, 0.6, -0.3], OAK, 'wood', radius=0.012, rotate=[-8, 0, 0])]  # low backrest
        for dx, dz in ((-0.14, -0.26), (0.14, -0.26), (-0.14, 0.02), (0.14, 0.02)):
            p.append(cyl([0.03, 0.38, 0.03], [x + dx, 0.19, -0.12 + (dz + 0.12) * 0.9], OAKD, 'wood', taper=0.8, segments=8))
        p.append(box([0.3, 0.02, 0.02], [x, 0.15, 0.0], OAKD, 'wood', radius=0.006))              # footrest
    return placeholder(p)


E['model.foodie.chefsIsland'] = chefs_island(); FOOT['model.foodie.chefsIsland'] = (2, 1)


# ---- common: validate + write --------------------------------------------------------------
def check_fit(key, e, fp):
    issues = []
    if 'url' not in e: return issues
    w, h, d = e['fit']
    ox, oy, oz = e.get('offset', [0, 0, 0])
    lx, lz = fp[0] / 2 - 0.045, fp[1] / 2 - 0.045
    z0 = (-fp[1] / 2 + oz) if e.get('align') == 'back' else (oz - d / 2)
    if abs(ox) + w / 2 > lx + 1e-4: issues.append(f'fit x {ox}±{w / 2} exceeds ±{lx}')
    if z0 < -lz - 1e-4 - 0.0 and e.get('align') == 'back' and oz < 0.045: issues.append(f'fit back z {z0:.3f} beyond -{lz}')
    if z0 + d > lz + 1e-4: issues.append(f'fit front z {z0 + d:.3f} exceeds {lz}')
    return issues


def run(trait, out=None, entries=None, foot=None):
    """Validates entries (default: this module's) and writes them to out (default pack_<trait>.json)."""
    E_, FOOT_ = entries if entries is not None else E, foot if foot is not None else FOOT
    bad = 0
    for k, e in E_.items():
        parts = e.get('parts', []) if 'url' in e else e['placeholder']
        issues = validate_parts(k, parts, FOOT_[k]) + check_fit(k, e, FOOT_[k])
        fins = sorted({p['material'].split('.')[-1] for p in parts})
        print(f'{k:34s} {"glTF " + e["url"].split("/")[-1] if "url" in e else "parts"} {len(parts)} parts {",".join(fins)}')
        for s in issues: print('   !', s)
        bad += len(issues)
    out = out or f'pack_{trait}.json'
    json.dump(E_, open(out, 'w'), indent=2)
    print(f'{len(E_)} entries -> {out}; {bad} issue(s)')
    return bad


if __name__ == '__main__':
    sys.exit(1 if run('foodie', sys.argv[1] if len(sys.argv) > 1 else None) else 0)
