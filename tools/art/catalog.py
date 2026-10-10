# Model entries for the 0.20 catalogue (`model.<id>[@modern|@cozy|@minimal]`): the furniture, lighting,
# decor, kids', hobby and garden things in web/public/content/furniture.json.
#
# Sources: the Kenney Furniture Kit and Poly Haven library built by build_library.py (models/kenney,
# models/ph; CC0), restyled with the game's finishes (`fit`, `materials`, `parts`; see
# render/babylon/models.ts), and primitive-part models drawn here (original, CC0). Same conventions as
# furniture.py: 1 unit = 1 m, origin at the footprint centre on the floor, front +Z, back against the
# wall at -Z. Things on a wall (content `layer: wall`) hang with their back on the wall face
# (z = -0.43 in a 1-deep footprint: half a wall's thickness in front of the tile edge); things on the
# ceiling hang from 2.8 m.
#
# Style direction as in furniture.py: modern = white, light grey, white oak, black-metal accents;
# cozy = warm woods, cream, earthy fabrics; minimal = white, birch, pale linen.
#
# Run: python3 -I -B catalog.py   (writes web/public/assets/catalog/manifest.json, a manifest listed in the base
# manifest's `packs`; one entry per line keeps it small, and its file urls are relative to that folder)
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import objects_extra as OX                                          # noqa: E402
from objects_extra import box, cyl, cone, sph, rod, part            # noqa: E402
from furniture import (mat, gltf, placeholder, recolor, shift, cushion, lathe, torus, office_chair,  # noqa: E402
                       WHITE, OFFWHITE, LGREY, MGREY, OAK, OAKD, BIRCH, HONEY, WALNUT, BLACKMETAL, STEEL,
                       CHROME, BRASS, TEAL, COGNAC, MUSTARD, SAGE, RUST, CREAM, SCREEN)

E = {}
FOOT = {}
KEN, PH = 'models/kenney/', 'models/ph/'
WALL_Z = 0.075        # `align: back` offset that puts a wall thing's back on the wall face
CEILING = 2.8
LINEN, SAND, CLAY, NAVY, BLUSH, OLIVE = '#E7E0D4', '#D9C7A7', '#C98F6B', '#3E5470', '#E4B8AE', '#8C9468'
BULB = '#FFF1CF'
FOLIAGE = '#5E8F4E'


def add(key, entry, fp=(1, 1)):
    E['model.' + key] = entry
    FOOT['model.' + key] = fp


def wall_gltf(url, size, y, materials=None, parts=None, fp=(1, 1), rotationY=None):
    """A thing on a wall: `size` [w, h, d] with its bottom at `y` and its back on the wall face."""
    e = gltf(url, size, materials, parts, align='back', offset=[0, y, WALL_Z], rotationY=rotationY, footprint=fp,
             placeholder=[box([size[0], size[1], max(size[2], 0.02)], [0, y + size[1] / 2, -fp[1] / 2 + WALL_Z + size[2] / 2], LGREY, 'satin')])
    return e


def books(x0, x1, y, z, depth=0.2, seed=1, colors=(TEAL, RUST, MUSTARD, SAGE, CREAM, NAVY, CLAY)):
    """A row of books standing on a shelf from x0 to x1 (bottom at y)."""
    p, x, k = [], x0, seed
    while x < x1 - 0.03:
        k = (k * 7 + 3) % 11
        w = 0.025 + (k % 4) * 0.008
        h = 0.17 + (k % 5) * 0.02
        if x + w > x1: break
        p.append(box([w, h, depth], [x + w / 2, y + h / 2, z], colors[k % len(colors)], 'matte', radius=0.003))
        x += w + 0.004
        if k % 7 == 0: x += 0.06
    return p


def chair_facing_front(x, z, wood, seat, fin='wood', seat_h=0.46, back_h=0.92):
    """A simple dining chair whose sitter faces +Z (seat centred on (x, z))."""
    return [
        box([0.42, 0.04, 0.4], [x, seat_h - 0.04, z], wood, fin, radius=0.012),
        cushion([0.38, 0.04, 0.36], [x, seat_h - 0.005, z + 0.01], seat, radius=0.018),
        box([0.035, seat_h - 0.05, 0.035], [x - 0.18, (seat_h - 0.05) / 2, z + 0.17], wood, fin, radius=0.008),
        box([0.035, seat_h - 0.05, 0.035], [x + 0.18, (seat_h - 0.05) / 2, z + 0.17], wood, fin, radius=0.008),
        box([0.035, back_h, 0.035], [x - 0.18, back_h / 2, z - 0.18], wood, fin, radius=0.008),
        box([0.035, back_h, 0.035], [x + 0.18, back_h / 2, z - 0.18], wood, fin, radius=0.008),
        box([0.4, 0.1, 0.035], [x, back_h - 0.07, z - 0.18], wood, fin, radius=0.015),
        box([0.4, 0.04, 0.03], [x, back_h - 0.28, z - 0.18], wood, fin, radius=0.01),
    ]


# =============================================================================================
# Kitchen: appliances
# =============================================================================================
FRIDGE_MATS = {'metalLight': mat('gloss', '#F3F3F1'), 'metalDark': mat('satin', '#B9BCBF'), 'metal': mat('chrome', CHROME),
               'glass': mat('gloss', '#DADDE0')}
add('fridgeMini', gltf(KEN + 'kitchenFridgeSmall.glb', [0.6, 0.86, 0.58], FRIDGE_MATS, offset=[0, 0, 0.04], parts=[
    box([0.5, 0.02, 0.4], [0, 0.87, -0.12], OAK, 'wood', radius=0.006),                         # board on top
    cyl([0.1, 0.12, 0.1], [-0.14, 0.94, -0.14], '#E9E6E0', 'gloss', taper=0.8),                   # jar
    sph([0.09, 0.08, 0.09], [0.12, 0.92, -0.1], '#D9483B', 'satin', segments=8)]))                # apple


def builtin_fridge(cab, door, cab_fin='satin', handle=CHROME):
    return gltf(KEN + 'kitchenFridgeBuiltIn.glb', [0.82, 2.02, 0.64], {
        'wood': mat(cab_fin, cab), 'woodDark': mat(cab_fin, door), 'metalLight': mat('gloss', '#F2F1EE'),
        'metal': mat('chrome', handle), 'glass': mat('gloss', '#DADDE0')}, offset=[0, 0, 0.04])


add('fridgeBuiltIn', builtin_fridge('#EDEBE6', '#E2DFD8'))
add('fridgeBuiltIn@modern', builtin_fridge('#F4F4F2', OAK, 'gloss', BLACKMETAL))
add('fridgeBuiltIn@cozy', builtin_fridge(SAGE, '#8FA27E', 'satin', BRASS))
add('fridgeBuiltIn@minimal', builtin_fridge(BIRCH, '#F2F1EE', 'wood'))

# Gas range: the kit's stove (oven, hob) on a cabinet body, restyled per style.
def gas_range(body, steel=STEEL, fin='satin', knob='#3A3D41'):
    return gltf(KEN + 'kitchenStove.glb', [0.92, 0.92, 0.64], {
        'metal': mat('metal', steel), 'wood': mat(fin, body), 'metalDark': mat('satin', '#2F3236'),
        'carpetWhite': mat('gloss', '#F2F1EE'), 'glass': mat('gloss', '#1D2228')}, offset=[0, 0, 0.04], parts=[
        cyl([0.26, 0.1, 0.26], [-0.2, 0.97, -0.05], '#B9BDC1', 'metal'),                         # pot
        cyl([0.3, 0.025, 0.3], [0.2, 0.935, 0.02], '#2F3236', 'satin'),                          # pan
        rod([0.33, 0.94, 0.08], [0.45, 0.945, 0.2], 0.025, knob, 'satin', shape='box')])


add('stoveGas', gas_range('#EDEBE6'))
add('stoveGas@modern', gas_range('#F4F4F2', fin='gloss'))
add('stoveGas@cozy', gas_range('#C9B79C', steel='#D8C9A6', knob=WALNUT))
add('stoveGas@minimal', gas_range(BIRCH, fin='wood'))

# Electric cooker: the Poly Haven stove (a freestanding enamel cooker).
add('stoveElectric', gltf(PH + 'electric_stove.glb', [0.62, 0.98, 0.62], offset=[0, 0, 0.04], align='back'))

COUNTER = {'metal': mat('chrome', CHROME), 'wood': mat('satin', '#EDEBE6'), 'woodDark': mat('satin', '#E2DFD8')}
COUNTER_STYLES = {
    '': ({'wood': mat('satin', '#EDEBE6'), 'woodDark': mat('satin', '#E2DFD8'), 'metal': mat('chrome', CHROME)}, '#E8E6E1', 'gloss'),
    '@modern': ({'wood': mat('gloss', '#F4F4F2'), 'woodDark': mat('wood', OAK), 'metal': mat('metal', BLACKMETAL)}, '#3A3D41', 'satin'),
    '@cozy': ({'wood': mat('satin', SAGE), 'woodDark': mat('wood', HONEY), 'metal': mat('metal', BRASS)}, HONEY, 'wood'),
    '@minimal': ({'wood': mat('wood', BIRCH), 'woodDark': mat('satin', '#F2F2F0'), 'metal': mat('satin', '#F2F2F0')}, '#F2F2F0', 'satin'),
}
def corner_counter(m, top, tfin):
    """A deep corner unit (fills its tile, for the corner of an L): a door at the front, a worktop over all."""
    body, door, handle = m['wood'], m['woodDark'], m['metal']
    def fin(x): return x['finish'].split('.')[-1]
    return [box([1.0, 0.84, 0.96], [0, 0.48, -0.02], body['color'], fin(body), radius=0.012),
            box([1.0, 0.08, 0.94], [0, 0.04, -0.03], '#2F3236', 'satin', radius=0.006),
            box([0.46, 0.7, 0.02], [0.24, 0.47, 0.465], door['color'], fin(door), radius=0.01),
            box([0.46, 0.7, 0.02], [-0.24, 0.47, 0.465], door['color'], fin(door), radius=0.01),
            box([0.012, 0.14, 0.02], [0.03, 0.62, 0.48], handle['color'], fin(handle), radius=0.004),
            box([0.012, 0.14, 0.02], [-0.03, 0.62, 0.48], handle['color'], fin(handle), radius=0.004),
            box([1.0, 0.04, 1.0], [0, 0.94, 0.0], top, tfin, radius=0.006),
            cyl([0.14, 0.18, 0.14], [-0.3, 1.05, -0.3], '#E8E6E1', 'gloss', taper=0.85),            # utensil pot
            cyl([0.02, 0.2, 0.02], [-0.32, 1.17, -0.3], OAK, 'wood'), cyl([0.02, 0.2, 0.02], [-0.28, 1.16, -0.31], OAK, 'wood')]


# Worktops sit on the kit cabinets (their tops are wood-coloured): a slab per style.
for sfx, (m, top, tfin) in COUNTER_STYLES.items():
    slab = box([1.0, 0.04, 0.66], [0, 0.94, -0.15], top, tfin, radius=0.006)
    add('counter' + sfx, gltf(KEN + 'kitchenCabinetDrawer.glb', [1.0, 0.92, 0.62], dict(m), offset=[0, 0, 0.05], parts=[slab]))
    add('counterCorner' + sfx, placeholder(corner_counter(m, top, tfin)))
    add('wallCabinet' + sfx, wall_gltf(KEN + 'kitchenCabinetUpperDouble.glb', [1.0, 0.72, 0.36], 1.45, dict(m)))
    add('pantry' + sfx, gltf(KEN + 'bookcaseClosedDoors.glb', [0.92, 2.06, 0.62], {'wood': m['wood'], 'metal': m['metal']},
                             offset=[0, 0, 0.04]))
    # Counters with an appliance on top (kit sets): a microwave, a coffee machine, a toaster and blender.
    appliance = {'metalMedium': mat('satin', '#3A3D41'), 'carpetWhite': mat('gloss', '#F2F1EE'), 'metalDark': mat('satin', '#2F3236'),
                 'glass': mat('gloss', '#1D2228')}
    add('microwave' + sfx, gltf(KEN + 'microwaveCounter.glb', [1.0, 1.26, 0.62], {**m, **appliance}, offset=[0, 0, 0.05], parts=[slab]))
    add('coffeeMachine' + sfx, gltf(KEN + 'coffeeCounter.glb', [1.0, 1.26, 0.62], {**m, **appliance}, offset=[0, 0, 0.05], parts=[
        slab, cyl([0.08, 0.1, 0.08], [0.32, 1.01, 0.05], TEAL, 'gloss'), cyl([0.08, 0.1, 0.08], [0.42, 1.01, 0.0], CREAM, 'gloss')]))
    add('breakfastCounter' + sfx, gltf(KEN + 'breakfastCounter.glb', [1.0, 1.4, 0.62], {**m, **appliance}, offset=[0, 0, 0.05], parts=[
        slab, cyl([0.26, 0.06, 0.26], [-0.28, 0.99, 0.05], '#E9E6E0', 'gloss'),
        sph([0.08, 0.07, 0.08], [-0.3, 1.04, 0.04], '#F2C14E', 'satin', segments=8),
        sph([0.08, 0.07, 0.08], [-0.24, 1.04, 0.08], '#D9483B', 'satin', segments=8)]))


def dishwasher(body, panel, fin='satin', handle=CHROME, top=OAK, top_fin='wood'):
    return placeholder([
        box([0.98, 0.84, 0.58], [0, 0.48, -0.13], body, fin, radius=0.012),
        box([0.98, 0.08, 0.56], [0, 0.04, -0.14], '#2F3236', 'satin', radius=0.006),               # plinth
        box([0.9, 0.72, 0.02], [0, 0.48, 0.165], panel, 'metal' if fin == 'metal' else fin, radius=0.012),  # door
        box([0.9, 0.08, 0.02], [0, 0.89, 0.165], '#2F3236', 'satin', radius=0.01),                # control strip
        box([0.5, 0.02, 0.03], [0, 0.8, 0.19], handle, 'chrome' if handle == CHROME else 'metal', radius=0.008),
        sph([0.025, 0.025, 0.012], [0.32, 0.89, 0.177], '#5EC28B', 'gloss', segments=6),
        box([1.0, 0.04, 0.66], [0, 0.94, -0.15], top, top_fin, radius=0.006),
    ])


add('dishwasher', dishwasher('#EDEBE6', STEEL, 'satin', CHROME, '#E8E6E1', 'gloss'))
add('dishwasher@modern', dishwasher('#F4F4F2', '#F4F4F2', 'gloss', BLACKMETAL, '#3A3D41', 'satin'))
add('dishwasher@cozy', dishwasher(SAGE, SAGE, 'satin', BRASS, HONEY, 'wood'))
add('dishwasher@minimal', dishwasher('#F2F2F0', BIRCH, 'satin', '#F2F2F0', '#F2F2F0', 'satin'))


def farmhouse_sink(cab, top=OAK, top_fin='wood', tap=CHROME):
    return placeholder([
        box([0.98, 0.84, 0.58], [0, 0.48, -0.13], cab, 'satin', radius=0.012),
        box([0.98, 0.08, 0.56], [0, 0.04, -0.14], '#2F3236', 'satin', radius=0.006),
        box([0.4, 0.62, 0.02], [-0.22, 0.42, 0.165], cab, 'satin', radius=0.01),                    # doors
        box([0.4, 0.62, 0.02], [0.22, 0.42, 0.165], cab, 'satin', radius=0.01),
        box([0.012, 0.12, 0.02], [-0.04, 0.62, 0.18], tap, 'chrome', radius=0.004),
        box([0.012, 0.12, 0.02], [0.04, 0.62, 0.18], tap, 'chrome', radius=0.004),
        box([1.0, 0.04, 0.66], [-0.0, 0.94, -0.15], top, top_fin, radius=0.006),
        box([0.66, 0.26, 0.5], [0, 0.83, -0.08], '#F6F5F2', 'gloss', radius=0.03),                 # apron basin
        box([0.58, 0.02, 0.4], [0, 0.955, -0.1], '#D9DEE0', 'gloss', radius=0.02),                 # water/basin floor
        cyl([0.04, 0.3, 0.04], [0, 1.1, -0.38], tap, 'chrome'),                                      # gooseneck tap
        rod([0, 1.25, -0.38], [0, 1.22, -0.2], 0.03, tap, 'chrome'),
        cyl([0.05, 0.03, 0.05], [0.12, 0.975, -0.4], tap, 'chrome'),
        box([0.2, 0.1, 0.06], [0.36, 1.01, -0.36], '#E8E6E1', 'gloss', radius=0.02),                # soap dish
        cyl([0.06, 0.16, 0.06], [-0.36, 1.04, -0.38], TEAL, 'gloss', taper=0.8),
    ])


add('farmhouseSink', farmhouse_sink('#EDEBE6'))
add('farmhouseSink@modern', farmhouse_sink('#F4F4F2', '#3A3D41', 'satin', BLACKMETAL))
add('farmhouseSink@cozy', farmhouse_sink(SAGE, HONEY, 'wood', BRASS))
add('farmhouseSink@minimal', farmhouse_sink('#F2F2F0', '#F2F2F0', 'satin'))

add('rangeHood', wall_gltf(KEN + 'hoodModern.glb', [0.9, 0.7, 0.5], 1.55, {
    'metalMedium': mat('metal', STEEL), '_defaultMat': mat('satin', '#3A3D41')}))
add('rangeHood@cozy', wall_gltf(KEN + 'hoodModern.glb', [0.9, 0.7, 0.5], 1.55, {
    'metalMedium': mat('satin', '#E8DFCF'), '_defaultMat': mat('wood', HONEY)}))


def island(body, top, top_fin, stool, legs):
    p = [box([1.84, 0.86, 0.56], [0, 0.47, -0.16], body, 'satin', radius=0.014),
         box([1.84, 0.08, 0.54], [0, 0.04, -0.16], '#2F3236', 'satin', radius=0.006),
         box([1.94, 0.05, 0.82], [0, 0.925, -0.04], top, top_fin, radius=0.01)]            # worktop with overhang at the front
    for x in (-0.68, -0.23, 0.23, 0.68):
        p.append(box([0.42, 0.6, 0.02], [x, 0.5, -0.45], body, 'satin', radius=0.01))     # (back doors, seen from the room behind)
    p += [cyl([0.3, 0.02, 0.3], [-0.45, 0.96, -0.1], '#F2F1EE', 'gloss'),                   # fruit bowl
          sph([0.08, 0.07, 0.08], [-0.48, 1.0, -0.1], '#F2C14E', 'satin', segments=8),
          sph([0.08, 0.07, 0.08], [-0.42, 1.0, -0.06], '#D9483B', 'satin', segments=8),
          box([0.4, 0.03, 0.28], [0.4, 0.965, -0.2], OAK, 'wood', radius=0.01)]              # chopping board
    for x in (-0.5, 0.5):                                                                   # two stools at the front
        p += [cyl([0.36, 0.05, 0.36], [x, 0.7, 0.28], stool, 'fabric', segments=16),
              cyl([0.05, 0.66, 0.05], [x, 0.36, 0.28], legs, 'metal'),
              torus([0.3, 0.02, 0.3], [x, 0.26, 0.28], legs, 'metal'),
              cyl([0.32, 0.02, 0.32], [x, 0.01, 0.28], legs, 'metal')]
    return p


add('kitchenIsland', placeholder(island('#EDEBE6', '#E8E6E1', 'gloss', SAGE, CHROME)), (2, 1))
add('kitchenIsland@modern', placeholder(island('#F4F4F2', '#3A3D41', 'satin', '#9AA4AB', BLACKMETAL)), (2, 1))
add('kitchenIsland@cozy', placeholder(island(SAGE, HONEY, 'wood', RUST, BRASS)), (2, 1))
add('kitchenIsland@minimal', placeholder(island('#F2F2F0', BIRCH, 'wood', LINEN, '#D9D9D6')), (2, 1))

STOOL = lambda seat, wood, fin='wood': {'wood': mat(fin, wood), 'carpet': mat('fabric', seat)}  # noqa: E731
add('barStool', gltf(KEN + 'stoolBar.glb', [0.42, 0.74, 0.42], STOOL(SAGE, OAK), align='centre'))
add('barStool@modern', gltf(KEN + 'stoolBarSquare.glb', [0.4, 0.74, 0.4], STOOL('#9AA4AB', BLACKMETAL, 'metal'), align='centre'))
add('barStool@cozy', gltf(KEN + 'stoolBar.glb', [0.42, 0.74, 0.42], STOOL(RUST, HONEY), align='centre'))
add('barStool@minimal', gltf(KEN + 'stoolBarSquare.glb', [0.4, 0.74, 0.4], STOOL(LINEN, BIRCH), align='centre'))

# =============================================================================================
# Dining
# =============================================================================================
def bistro(top, frame, seat, top_fin='wood', frame_fin='metal'):
    p = [cyl([0.62, 0.035, 0.62], [0, 0.735, 0.17], top, top_fin, segments=28),
         cyl([0.06, 0.7, 0.06], [0, 0.37, 0.17], frame, frame_fin),
         cyl([0.42, 0.03, 0.42], [0, 0.015, 0.17], frame, frame_fin, segments=20),
         cyl([0.12, 0.12, 0.12], [0.12, 0.81, 0.24], '#F2F1EE', 'gloss', taper=0.8),            # cup
         cyl([0.16, 0.012, 0.16], [0.12, 0.756, 0.24], '#F2F1EE', 'gloss'),
         cyl([0.08, 0.14, 0.08], [-0.15, 0.82, 0.1], '#DCE6EA', 'gloss', taper=0.7),             # little vase
         sph([0.06, 0.05, 0.06], [-0.15, 0.91, 0.1], '#D9483B', 'satin', segments=6)]
    p += chair_facing_front(0, -0.24, frame, seat, frame_fin)
    return p


add('bistroSet', placeholder(bistro(OAK, BLACKMETAL, SAGE)))
add('bistroSet@modern', placeholder(bistro('#F1F0EC', BLACKMETAL, '#9AA4AB', 'gloss')))
add('bistroSet@cozy', placeholder(bistro(HONEY, WALNUT, RUST, 'wood', 'wood')))
add('bistroSet@minimal', placeholder(bistro(BIRCH, '#F2F2F0', LINEN, 'wood', 'satin')))


def dining_long(top, frame, seat, top_fin='wood', frame_fin='wood', glass=False, runner='#E8DCC0'):
    """2x1 table for two seated at the back half facing +Z, with two more chairs drawn across the table."""
    p = []
    if glass:
        p += [box([1.7, 0.02, 0.62], [0, 0.75, 0.16], '#DCE6E8', 'glass', radius=0.01)]
        for x in (-0.7, 0.7):
            p += [box([0.05, 0.74, 0.5], [x, 0.37, 0.16], frame, frame_fin, radius=0.01)]       # sled legs
            p += [box([0.05, 0.05, 0.56], [x, 0.025, 0.16], frame, frame_fin, radius=0.01)]
    else:
        p += [box([1.76, 0.06, 0.66], [0, 0.735, 0.15], top, top_fin, radius=0.012),
              box([1.62, 0.08, 0.5], [0, 0.66, 0.15], frame, frame_fin, radius=0.006)]
        for x in (-0.8, 0.8):
            for z in (-0.12, 0.42):
                p.append(box([0.08, 0.7, 0.08], [x, 0.35, z], frame, frame_fin, radius=0.01))
        p.append(box([0.3, 0.005, 0.62], [0, 0.768, 0.15], runner, 'fabric', radius=0.002))
    p += [cyl([0.14, 0.24, 0.14], [0, 0.88, 0.18], '#E8E6E1', 'gloss', taper=0.6),             # vase with stems
          sph([0.16, 0.12, 0.16], [0, 1.04, 0.18], SAGE, 'foliage', segments=8)]
    for s in (-1, 1):
        x = s * 0.5
        p += [cyl([0.26, 0.015, 0.26], [x, 0.775, 0.06], '#F5F3EE', 'gloss'),
              cyl([0.06, 0.11, 0.06], [x + s * 0.18, 0.83, 0.18], '#DCE6EA', 'gloss', taper=1.1),
              cyl([0.26, 0.015, 0.26], [x, 0.775, 0.36], '#F5F3EE', 'gloss')]
        p += chair_facing_front(x, -0.22, frame if not glass else '#3A3C40', seat, 'wood' if frame_fin == 'wood' else 'metal')
    return p


def far_chairs(p, wood, seat, fin):
    """Two chairs across the table (facing -Z, their backs to the room): drawn, not sat on."""
    out = list(p)
    for x in (-0.5, 0.5):
        out += [box([0.42, 0.04, 0.34], [x, 0.42, 0.29], wood, fin, radius=0.012),
                cushion([0.38, 0.035, 0.3], [x, 0.455, 0.28], seat, radius=0.016),
                box([0.4, 0.42, 0.035], [x, 0.66, 0.44], wood, fin, radius=0.015),
                box([0.035, 0.42, 0.035], [x - 0.18, 0.21, 0.14], wood, fin, radius=0.008),
                box([0.035, 0.42, 0.035], [x + 0.18, 0.21, 0.14], wood, fin, radius=0.008)]
    return out


add('diningGlass', placeholder(dining_long('#DCE6E8', CHROME, '#C9CBCC', frame_fin='chrome', glass=True)), (2, 1))
add('diningGlass@modern', placeholder(dining_long('#DCE6E8', BLACKMETAL, '#9AA4AB', frame_fin='metal', glass=True)), (2, 1))
add('diningGlass@minimal', placeholder(dining_long('#DCE6E8', '#F2F2F0', LINEN, frame_fin='satin', glass=True)), (2, 1))
add('diningOak', placeholder(dining_long(OAK, OAKD, SAGE)), (2, 1))
add('diningOak@modern', placeholder(dining_long('#F1F0EC', OAK, '#9AA4AB', top_fin='satin')), (2, 1))
add('diningOak@cozy', placeholder(dining_long(WALNUT, HONEY, RUST, runner='#D9C7A7')), (2, 1))
add('diningOak@minimal', placeholder(dining_long(BIRCH, '#E3CFA8', LINEN, runner='#F2F0EA')), (2, 1))

CHAIR_K = lambda wood, seat, fin='wood', seat_fin='fabric': {'wood': mat(fin, wood), 'carpet': mat(seat_fin, seat)}  # noqa: E731
add('diningChair', gltf(PH + 'painted_wooden_chair_01.glb', [0.43, 0.96, 0.54], align='centre'))
add('diningChair@modern', gltf(KEN + 'chairModernFrameCushion.glb', [0.46, 0.88, 0.5], {
    'metal': mat('metal', BLACKMETAL), 'carpetBlue': mat('fabric', '#B9BCBE')}, align='centre'))
add('diningChair@cozy', gltf(KEN + 'chairCushion.glb', [0.46, 0.92, 0.5], CHAIR_K(HONEY, RUST), align='centre'))
add('diningChair@minimal', gltf(KEN + 'chairRounded.glb', [0.46, 0.9, 0.5], {'wood': mat('wood', BIRCH)}, align='centre'))

# =============================================================================================
# Living: seating, tables, media, storage
# =============================================================================================
SOFA_K = lambda fabric, wood, wfin='wood': {'carpet': mat('fabric', fabric), 'wood': mat(wfin, wood)}  # noqa: E731
add('loveseat', gltf(KEN + 'loungeSofa.glb', [1.84, 0.84, 0.84], SOFA_K(SAGE, OAK), offset=[0, 0, 0.04], parts=[
    cushion([0.36, 0.3, 0.12], [-0.6, 0.6, -0.12], CREAM, rotate=[-12, 8, 0])]), (2, 1))
add('loveseat@modern', gltf(KEN + 'loungeSofa.glb', [1.84, 0.84, 0.84], SOFA_K('#B9BCBE', BLACKMETAL, 'metal'), offset=[0, 0, 0.04], parts=[
    cushion([0.36, 0.3, 0.12], [-0.6, 0.6, -0.12], COGNAC, rotate=[-12, 8, 0])]), (2, 1))
add('loveseat@cozy', gltf(KEN + 'loungeSofa.glb', [1.84, 0.84, 0.84], SOFA_K(RUST, WALNUT), offset=[0, 0, 0.04], parts=[
    cushion([0.36, 0.3, 0.12], [-0.6, 0.6, -0.12], MUSTARD, rotate=[-12, 8, 0]),
    cushion([0.36, 0.3, 0.12], [0.6, 0.6, -0.12], CREAM, rotate=[-12, -8, 0])]), (2, 1))
add('loveseat@minimal', gltf(KEN + 'loungeSofa.glb', [1.84, 0.84, 0.84], SOFA_K(LINEN, BIRCH), offset=[0, 0, 0.04]), (2, 1))


def sofa3(fabric, base, cushion_col, base_fin='wood', legs=None):
    """A 3-wide sofa with three seat cushions; two sitters at x = +-0.75 (seat ~0.44 m)."""
    p = [box([2.82, 0.2, 0.86], [0, 0.22, -0.03], fabric, 'fabric', radius=0.05),            # base
         box([2.82, 0.5, 0.22], [0, 0.62, -0.35], fabric, 'fabric', radius=0.08),             # back
         box([0.2, 0.32, 0.86], [-1.31, 0.48, -0.03], fabric, 'fabric', radius=0.08),         # arms
         box([0.2, 0.32, 0.86], [1.31, 0.48, -0.03], fabric, 'fabric', radius=0.08)]
    for x in (-0.8, 0.0, 0.8):
        p += [cushion([0.78, 0.12, 0.62], [x, 0.38, 0.06], fabric),
              cushion([0.74, 0.4, 0.16], [x, 0.62, -0.2], fabric, rotate=[-10, 0, 0])]
    p += [cushion([0.4, 0.34, 0.12], [-0.98, 0.66, -0.12], cushion_col, rotate=[-12, 10, 0]),
          cushion([0.4, 0.34, 0.12], [0.98, 0.66, -0.12], cushion_col, rotate=[-12, -10, 0]),
          box([0.7, 0.04, 0.5], [0.95, 0.5, -0.05], cushion_col, 'fabric', radius=0.02, rotate=[0, 0, 4])]  # throw
    for x in (-1.32, 1.32):
        for z in (-0.38, 0.32):
            p.append(cyl([0.05, 0.12, 0.05], [x, 0.06, z], legs or base, base_fin, taper=0.8))
    return p


add('sofaThree', placeholder(sofa3('#C9C6BE', OAKD, SAGE)), (3, 1))
add('sofaThree@modern', placeholder(sofa3('#9AA4AB', BLACKMETAL, COGNAC, 'metal')), (3, 1))
add('sofaThree@cozy', placeholder(sofa3('#B98F6A', WALNUT, MUSTARD)), (3, 1))
add('sofaThree@minimal', placeholder(sofa3(LINEN, BIRCH, '#F2F0EA')), (3, 1))

add('sofaDesign', gltf(KEN + 'loungeDesignSofa.glb', [1.86, 0.74, 0.84], {
    'carpetBlue': mat('fabric', TEAL), 'metal': mat('metal', BRASS)}, offset=[0, 0, 0.04]), (2, 1))
add('sofaDesign@modern', gltf(KEN + 'loungeDesignSofa.glb', [1.86, 0.74, 0.84], {
    'carpetBlue': mat('fabric', '#D2D4D5'), 'metal': mat('metal', BLACKMETAL)}, offset=[0, 0, 0.04]), (2, 1))
add('sofaDesign@cozy', gltf(KEN + 'loungeDesignSofa.glb', [1.86, 0.74, 0.84], {
    'carpetBlue': mat('fabric', COGNAC), 'metal': mat('wood', WALNUT)}, offset=[0, 0, 0.04]), (2, 1))
add('sofaDesign@minimal', gltf(KEN + 'loungeDesignSofa.glb', [1.86, 0.74, 0.84], {
    'carpetBlue': mat('fabric', '#ECE7DD'), 'metal': mat('wood', BIRCH)}, offset=[0, 0, 0.04]), (2, 1))

add('armchairLounge', gltf(KEN + 'loungeChair.glb', [0.82, 0.84, 0.84], SOFA_K(SAGE, OAK), offset=[0, 0, 0.04]))
add('armchairLounge@modern', gltf(KEN + 'loungeChair.glb', [0.82, 0.84, 0.84], SOFA_K('#B9BCBE', BLACKMETAL, 'metal'), offset=[0, 0, 0.04]))
add('armchairLounge@cozy', gltf(KEN + 'loungeChair.glb', [0.82, 0.84, 0.84], SOFA_K(RUST, WALNUT), offset=[0, 0, 0.04]))
add('armchairLounge@minimal', gltf(KEN + 'loungeChair.glb', [0.82, 0.84, 0.84], SOFA_K(LINEN, BIRCH), offset=[0, 0, 0.04]))
add('armchairLeather', gltf(PH + 'modern_arm_chair_01.glb', [0.76, 0.95, 0.88], offset=[0, 0, 0.05]))
add('armchairDesign', gltf(PH + 'mid_century_lounge_chair.glb', [0.78, 0.9, 0.9], offset=[0, 0, 0.04]))

add('pouf', gltf(PH + 'Ottoman_01.glb', [0.72, 0.46, 0.5], align='centre'))

COFFEE_K = {'': {'wood': mat('wood', OAK)}, '@modern': {'wood': mat('gloss', '#F1F0EC')}, '@cozy': {'wood': mat('wood', WALNUT)},
            '@minimal': {'wood': mat('wood', BIRCH)}}
for sfx, m in COFFEE_K.items():
    add('coffeeTable' + sfx, gltf(KEN + 'tableCoffee.glb', [1.3, 0.42, 0.74], m, align='centre', parts=[
        box([0.3, 0.03, 0.22], [0.3, 0.435, 0.05], TEAL, 'matte', radius=0.004, rotate=[0, 10, 0]),     # magazines
        box([0.3, 0.02, 0.22], [0.31, 0.46, 0.04], CREAM, 'matte', radius=0.004, rotate=[0, -6, 0]),
        cyl([0.18, 0.06, 0.18], [-0.32, 0.45, 0.0], '#E9E6E0', 'gloss')]), (2, 1))
add('coffeeTableGlass', gltf(KEN + 'tableCoffeeGlass.glb', [1.3, 0.42, 0.74], {
    'metal': mat('chrome', CHROME), 'glass': mat('glass', '#DCE6E8')}, align='centre', parts=[
    box([0.3, 0.03, 0.22], [0.3, 0.435, 0.05], MUSTARD, 'matte', radius=0.004, rotate=[0, 10, 0]),
    sph([0.2, 0.14, 0.2], [-0.3, 0.49, 0.0], '#5E8F4E', 'foliage', segments=8),
    cyl([0.14, 0.08, 0.14], [-0.3, 0.46, 0.0], '#F2F2F0', 'gloss')]), (2, 1))
add('coffeeTableGlass@modern', gltf(KEN + 'tableCoffeeGlass.glb', [1.3, 0.42, 0.74], {
    'metal': mat('metal', BLACKMETAL), 'glass': mat('glass', '#DCE6E8')}, align='centre'), (2, 1))
add('coffeeTableMarble', gltf(PH + 'coffee_table_round_01.glb', [0.9, 0.42, 0.9], align='centre', parts=[
    cyl([0.1, 0.16, 0.1], [0.12, 0.5, 0.05], '#E8E6E1', 'gloss', taper=0.6),
    box([0.24, 0.03, 0.18], [-0.12, 0.435, -0.08], NAVY, 'matte', radius=0.004, rotate=[0, 14, 0])]))

add('sideTable', gltf(PH + 'side_table_01.glb', [0.55, 0.55, 0.45], align='centre'))
SIDE_K = lambda wood, fin, knob: {'wood': mat(fin, wood), '_defaultMat': mat(fin, wood), 'metal': mat('metal', knob)}  # noqa: E731
add('sideTable@modern', gltf(KEN + 'sideTableDrawers.glb', [0.6, 0.55, 0.45], SIDE_K('#F1F0EC', 'gloss', BLACKMETAL), align='centre'))
add('sideTable@minimal', gltf(KEN + 'sideTableDrawers.glb', [0.6, 0.55, 0.45], SIDE_K(BIRCH, 'wood', '#F2F2F0'), align='centre'))


def tv_wall(frame='#2A2C30', w=1.24, h=0.72):
    y = 0.92
    return placeholder([
        box([w, h, 0.05], [0, y + h / 2, -0.43 + 0.04], frame, 'satin', radius=0.012),
        box([w - 0.03, h - 0.03, 0.004], [0, y + h / 2, -0.43 + 0.066], SCREEN, 'gloss', radius=0.004),
        box([w * 0.7, h * 0.55, 0.002], [0, y + h / 2 + 0.03, -0.43 + 0.0685], '#2E5470', 'gloss', radius=0.004),  # picture glow
        box([0.3, 0.2, 0.03], [0, y + h / 2, -0.43 + 0.012], '#3A3D41', 'metal', radius=0.006),                  # bracket
        box([0.9, 0.06, 0.08], [0, y - 0.12, -0.43 + 0.05], '#3A3D41', 'satin', radius=0.02),                    # soundbar
    ])


add('tvWall', tv_wall(), (2, 1))
add('tvRetro', gltf(KEN + 'tvRetroUnit.glb', [0.92, 0.9, 0.46], {
    'wood': mat('wood', HONEY), 'metal': mat('metal', STEEL), 'metalMedium': mat('satin', '#3A3D41'),
    'metalDark': mat('gloss', '#22303E')}, offset=[0, 0, 0.04]))


def home_cinema(unit, top, fin='wood'):
    p = [box([1.86, 0.42, 0.44], [0, 0.25, -0.22], unit, fin, radius=0.012),
         box([1.88, 0.03, 0.45], [0, 0.475, -0.22], top, fin, radius=0.008)]
    for x in (-0.62, 0.0, 0.62):
        p.append(box([0.58, 0.3, 0.012], [x, 0.25, 0.006], top, fin, radius=0.006))
    for x in (-0.86, 0.86):
        p += [box([0.04, 0.06, 0.4], [x, 0.03, -0.22], BLACKMETAL, 'metal', radius=0.006)]
    p += [box([1.7, 0.96, 0.04], [0, 1.08, -0.4], '#2A2C30', 'satin', radius=0.012),                  # big screen
          box([1.66, 0.92, 0.004], [0, 1.08, -0.378], SCREEN, 'gloss', radius=0.004),
          box([1.2, 0.6, 0.002], [0, 1.1, -0.375], '#3B5E7A', 'gloss', radius=0.004),
          box([1.0, 0.07, 0.09], [0, 0.53, -0.12], '#3A3D41', 'satin', radius=0.025)]                  # soundbar
    for x in (-0.9, 0.9):                                                                               # tower speakers
        p += [box([0.16, 0.9, 0.2], [x, 0.94, -0.3], '#3A3D41', 'satin', radius=0.02),
              cyl([0.11, 0.02, 0.11], [x, 1.2, -0.195], '#22252A', 'satin', rotate=[90, 0, 0]),
              cyl([0.11, 0.02, 0.11], [x, 0.9, -0.195], '#22252A', 'satin', rotate=[90, 0, 0])]
    p += [box([0.36, 0.05, 0.26], [0.45, 0.525, -0.25], '#22252A', 'satin', radius=0.01),             # player
          sph([0.03, 0.03, 0.01], [0.6, 0.53, -0.115], '#5EC28B', 'gloss', segments=6)]
    return p


add('homeCinema', placeholder(home_cinema(OAKD, OAK)), (2, 1))
add('homeCinema@modern', placeholder(home_cinema('#F1F0EC', '#F1F0EC', 'gloss')), (2, 1))
add('homeCinema@cozy', placeholder(home_cinema(WALNUT, HONEY)), (2, 1))
add('homeCinema@minimal', placeholder(home_cinema(BIRCH, '#F2F2F0', 'wood')), (2, 1))

add('stereo', gltf(KEN + 'stereoUnit.glb', [0.92, 0.82, 0.42], {
    'wood': mat('wood', OAK), 'metalMedium': mat('satin', '#3A3D41'), 'metal': mat('metal', STEEL)}, offset=[0, 0, 0.04]))
add('stereo@cozy', gltf(KEN + 'stereoUnit.glb', [0.92, 0.82, 0.42], {
    'wood': mat('wood', WALNUT), 'metalMedium': mat('satin', '#3A3530'), 'metal': mat('metal', BRASS)}, offset=[0, 0, 0.04]))
add('stereo@minimal', gltf(KEN + 'stereoUnit.glb', [0.92, 0.82, 0.42], {
    'wood': mat('wood', BIRCH), 'metalMedium': mat('satin', '#E6E4DF'), 'metal': mat('satin', '#F2F2F0')}, offset=[0, 0, 0.04]))
add('boombox', gltf(PH + 'boombox.glb', [0.52, 0.34, 0.14], align='centre', offset=[0, 0.42, 0.0], parts=[
    box([0.6, 0.42, 0.44], [0, 0.21, 0], HONEY, 'wood', radius=0.01),                                    # crate
    box([0.52, 0.34, 0.38], [0, 0.215, 0.0], '#9E6E43', 'wood', radius=0.01),
    box([0.24, 0.03, 0.24], [-0.14, 0.435, 0.08], '#2A2C30', 'satin', radius=0.004, rotate=[0, 15, 0])]))  # record sleeve

BOOK_K = lambda wood, fin='wood': {'wood': mat(fin, wood)}  # noqa: E731
for sfx, (wood, fin) in {'': (OAK, 'wood'), '@modern': ('#F1F0EC', 'satin'), '@cozy': (WALNUT, 'wood'),
                         '@minimal': (BIRCH, 'wood')}.items():
    add('bookcaseLow' + sfx, gltf(KEN + 'bookcaseOpenLow.glb', [0.92, 0.9, 0.42], BOOK_K(wood, fin), offset=[0, 0, 0.04], parts=
        books(-0.4, 0.36, 0.06, -0.24, 0.22, 3) + books(-0.4, 0.38, 0.47, -0.24, 0.22, 5) + [
            cyl([0.12, 0.12, 0.12], [0.3, 0.96, -0.2], '#E8E6E1', 'gloss', taper=0.8),
            sph([0.2, 0.18, 0.2], [0.3, 1.08, -0.2], FOLIAGE, 'foliage', segments=8)]))
    add('bookcaseWide' + sfx, gltf(KEN + 'bookcaseClosedWide.glb', [1.86, 2.0, 0.44], BOOK_K(wood, fin), offset=[0, 0, 0.04], parts=
        books(-0.85, 0.85, 0.06, -0.26, 0.24, 1) + books(-0.85, 0.6, 0.55, -0.26, 0.24, 4) + books(-0.6, 0.85, 1.04, -0.26, 0.24, 6)
        + books(-0.85, 0.3, 1.53, -0.26, 0.24, 2) + [
            sph([0.18, 0.16, 0.18], [0.55, 1.65, -0.24], FOLIAGE, 'foliage', segments=8),
            cyl([0.12, 0.12, 0.12], [0.55, 1.59, -0.24], '#E8E6E1', 'gloss', taper=0.8)]), (2, 1))
add('shelvingIndustrial', gltf(PH + 'steel_frame_shelves_03.glb', [1.86, 1.83, 0.57], offset=[0, 0, 0.04], parts=
    books(-0.8, 0.0, 0.92, -0.2, 0.22, 7) + books(0.1, 0.8, 1.38, -0.2, 0.22, 2) + [
        cyl([0.14, 0.14, 0.14], [0.55, 0.99, -0.2], CLAY, 'satin', taper=0.8),
        sph([0.24, 0.2, 0.24], [0.55, 1.13, -0.2], FOLIAGE, 'foliage', segments=8)]), (2, 1))


def fireplace(stone, mantel, fin='satin', mantel_fin='wood'):
    p = [box([1.84, 1.25, 0.42], [0, 0.625, -0.27], stone, fin, radius=0.015),          # chimney breast
         box([1.84, 1.55, 0.3], [0, 2.025, -0.33], stone, fin, radius=0.015),           # flue up to the ceiling
         box([1.96, 0.07, 0.52], [0, 1.27, -0.22], mantel, mantel_fin, radius=0.01),    # mantel shelf
         box([1.96, 0.1, 0.62], [0, 0.05, -0.17], '#8E8A84', 'matte', radius=0.01),     # hearth
         box([0.92, 0.7, 0.2], [0, 0.46, -0.16], '#2A2624', 'matte', radius=0.02),      # firebox
         box([0.8, 0.6, 0.02], [0, 0.44, -0.05], '#1B1716', 'matte', radius=0.01)]
    for x, r in ((-0.18, 12), (0.12, -18), (0.0, 80)):                                   # logs
        p.append(cyl([0.1, 0.5, 0.1], [x, 0.2, -0.12], '#6B4A33', 'bark', rotate=[0, r, 90]))
    p += [part('blob', [0.42, 0.28, 0.16], [0, 0.34, -0.1], '#FF9A3C', 'gloss', noise=0.25),       # flames
          part('blob', [0.26, 0.36, 0.1], [0.04, 0.42, -0.09], '#FFD27A', 'gloss', noise=0.3)]
    p += [cyl([0.1, 0.24, 0.1], [-0.65, 1.42, -0.25], '#E8E6E1', 'gloss', taper=0.7),            # mantel things
          box([0.3, 0.38, 0.03], [0.55, 1.5, -0.38], '#F2F0EA', 'satin', radius=0.006),
          box([0.24, 0.3, 0.005], [0.55, 1.5, -0.364], TEAL, 'matte', radius=0.004),
          cyl([0.06, 0.12, 0.06], [-0.4, 1.36, -0.25], CREAM, 'satin'),
          cyl([0.06, 0.18, 0.06], [-0.3, 1.39, -0.25], CREAM, 'satin')]
    return p


add('fireplace', placeholder(fireplace('#E7E3DC', OAK)), (2, 1))
add('fireplace@modern', placeholder(fireplace('#3A3D41', OAK, 'matte')), (2, 1))
add('fireplace@cozy', placeholder(fireplace('#B9A48C', WALNUT, 'matte')), (2, 1))
add('fireplace@minimal', placeholder(fireplace('#F4F3EF', BIRCH)), (2, 1))

# =============================================================================================
# Bedroom
# =============================================================================================
BED_K = lambda frame, sheet, cover, ffin='wood': {'wood': mat(ffin, frame), 'carpetWhite': mat('fabric', sheet),  # noqa: E731
                                                 'carpet': mat('fabric', cover), 'metal': mat('metal', BLACKMETAL)}
pillow1 = cushion([0.62, 0.14, 0.36], [0, 0.6, -0.74], '#FFFFFF')
add('bedSingle', gltf(KEN + 'bedSingle.glb', [0.98, 0.9, 1.96], BED_K(OAK, '#F7F7F5', SAGE), offset=[0, 0, 0.02], parts=[pillow1]), (1, 2))
add('bedSingle@modern', gltf(KEN + 'bedSingle.glb', [0.98, 0.9, 1.96], BED_K('#F1F0EC', '#FFFFFF', '#9AA7B0', 'satin'), offset=[0, 0, 0.02], parts=[pillow1]), (1, 2))
add('bedSingle@cozy', gltf(KEN + 'bedSingle.glb', [0.98, 0.9, 1.96], BED_K(HONEY, CREAM, RUST), offset=[0, 0, 0.02], parts=[pillow1]), (1, 2))
add('bedSingle@minimal', gltf(KEN + 'bedSingle.glb', [0.98, 0.9, 1.96], BED_K(BIRCH, '#FFFFFF', LINEN), offset=[0, 0, 0.02], parts=[pillow1]), (1, 2))
add('bedBunk', gltf(KEN + 'bedBunk.glb', [0.98, 1.9, 1.96], BED_K(OAK, '#F7F7F5', TEAL), offset=[0, 0, 0.02]), (1, 2))
add('bedBunk@cozy', gltf(KEN + 'bedBunk.glb', [0.98, 1.9, 1.96], BED_K(HONEY, CREAM, RUST), offset=[0, 0, 0.02]), (1, 2))
add('bedBunk@minimal', gltf(KEN + 'bedBunk.glb', [0.98, 1.9, 1.96], BED_K('#F2F2F0', '#FFFFFF', LINEN, 'satin'), offset=[0, 0, 0.02]), (1, 2))


def futon(base, mattress, cover):
    """Low double platform: mattress top ~0.4 m, two sleepers at x = +-0.5."""
    p = [box([1.96, 0.18, 1.96], [0, 0.11, 0.0], base, 'wood', radius=0.01),
         box([1.86, 0.2, 1.86], [0, 0.3, 0.02], mattress, 'fabric', radius=0.06),
         box([1.88, 0.06, 1.2], [0, 0.42, 0.34], cover, 'fabric', radius=0.03),
         box([1.96, 0.5, 0.06], [0, 0.42, -0.95], base, 'wood', radius=0.01)]                # low headboard
    for s in (-1, 1):
        p += [cushion([0.66, 0.14, 0.36], [s * 0.45, 0.46, -0.7], '#FFFFFF'),
              box([0.02, 0.04, 1.96], [s * 0.97, 0.03, 0], base, 'wood', radius=0.005)]
    return p


add('bedFuton', placeholder(futon(BIRCH, '#F4F2EE', LINEN)), (2, 2))
add('bedFuton@modern', placeholder(futon('#3A3D41', '#F4F2EE', '#9AA4AB')), (2, 2))
add('bedFuton@cozy', placeholder(futon(HONEY, CREAM, RUST)), (2, 2))


def king_bed(head, frame, sheet, throw, ffin='fabric'):
    p = [box([1.96, 0.3, 1.94], [0, 0.25, 0.0], frame, ffin, radius=0.05),
         box([1.98, 1.3, 0.14], [0, 0.75, -0.9], head, 'fabric', radius=0.06),               # tall headboard
         box([1.86, 0.22, 1.84], [0, 0.48, 0.04], '#F8F8F6', 'fabric', radius=0.07),          # mattress (top 0.59)
         box([1.92, 0.08, 1.3], [0, 0.6, 0.32], sheet, 'fabric', radius=0.04),               # duvet
         box([1.94, 0.04, 0.5], [0, 0.66, 0.66], throw, 'fabric', radius=0.015),
         box([0.04, 0.32, 0.5], [0.97, 0.52, 0.66], throw, 'fabric', radius=0.015),
         box([0.04, 0.32, 0.5], [-0.97, 0.52, 0.66], throw, 'fabric', radius=0.015)]
    for x in (-0.66, -0.22, 0.22, 0.66):
        p.append(box([0.42, 1.1, 0.04], [x, 0.78, -0.82], head, 'fabric', radius=0.04))     # channel tufts
    for s in (-1, 1):
        p += [cushion([0.66, 0.16, 0.4], [s * 0.44, 0.66, -0.66], '#FFFFFF'),
              cushion([0.5, 0.3, 0.12], [s * 0.38, 0.75, -0.46], throw, rotate=[-15, 0, 0])]
    return p


add('bedKing', placeholder(king_bed('#CFC9BD', '#D9D4CA', '#F1F0EC', SAGE)), (2, 2))
add('bedKing@modern', placeholder(king_bed('#9AA4AB', '#B9BCBE', '#F6F6F4', COGNAC)), (2, 2))
add('bedKing@cozy', placeholder(king_bed(RUST, '#B98F6A', CREAM, MUSTARD)), (2, 2))
add('bedKing@minimal', placeholder(king_bed(LINEN, '#ECE7DD', '#FFFFFF', '#E3CFA8')), (2, 2))

NIGHT_K = lambda wood, fin, knob: {'wood': mat(fin, wood), '_defaultMat': mat(fin, wood), 'metal': mat('metal', knob)}  # noqa: E731
for sfx, (wood, fin, knob) in {'': (OAK, 'wood', BRASS), '@modern': ('#F1F0EC', 'gloss', BLACKMETAL), '@cozy': (WALNUT, 'wood', BRASS),
                               '@minimal': (BIRCH, 'wood', '#F2F2F0')}.items():
    add('nightstand' + sfx, gltf(KEN + 'cabinetBedDrawerTable.glb', [0.52, 0.56, 0.44], NIGHT_K(wood, fin, knob), offset=[0, 0, 0.04], parts=[
        box([0.16, 0.03, 0.22], [0.1, 0.575, -0.08], TEAL, 'matte', radius=0.004),
        cyl([0.08, 0.1, 0.08], [-0.12, 0.61, -0.06], '#E8E6E1', 'gloss')]))
    add('nightstandLamp' + sfx, gltf(KEN + 'nightstandLamp.glb', [0.52, 1.1, 0.44], {
        **NIGHT_K(wood, fin, knob), 'lamp': mat('fabric', '#F4EBD8')}, offset=[0, 0, 0.04]))


def dresser(wood, fin, knob):
    """A low chest of drawers (three rows of two), things on top."""
    p = [box([1.4, 0.8, 0.5], [0, 0.46, -0.18], wood, fin, radius=0.012),
         box([1.44, 0.03, 0.52], [0, 0.875, -0.17], wood, fin, radius=0.008)]
    for x in (-0.68, 0.68):
        for z in (-0.38, 0.02):
            p.append(box([0.04, 0.08, 0.04], [x, 0.04, z], wood, fin, radius=0.008))
    for y in (0.24, 0.48, 0.72):
        for x in (-0.35, 0.35):
            p += [box([0.66, 0.2, 0.02], [x, y, 0.075], wood, fin, radius=0.008),
                  box([0.12, 0.018, 0.02], [x, y + 0.03, 0.092], knob, 'metal', radius=0.006)]
    p += [box([0.36, 0.46, 0.03], [0.32, 1.12, -0.3], '#F2F0EA', 'satin', radius=0.006, rotate=[-6, 0, 0]),   # framed photo
          box([0.3, 0.38, 0.005], [0.32, 1.12, -0.283], TEAL, 'matte', radius=0.004, rotate=[-6, 0, 0]),
          cyl([0.12, 0.22, 0.12], [-0.45, 1.0, -0.2], CREAM, 'gloss', taper=0.7),
          box([0.22, 0.06, 0.16], [-0.12, 0.92, -0.16], '#E6DFD3', 'satin', radius=0.02)]
    return p


for sfx, (wood, fin, knob) in {'': (OAK, 'wood', BRASS), '@modern': ('#F1F0EC', 'gloss', BLACKMETAL), '@cozy': (WALNUT, 'wood', BRASS),
                               '@minimal': (BIRCH, 'wood', '#D9D9D6')}.items():
    add('dresser' + sfx, placeholder(dresser(wood, fin, knob)), (2, 1))


def wardrobe(body, door, fin, handle):
    p = [box([1.84, 2.06, 0.6], [0, 1.08, -0.14], body, fin, radius=0.012),
         box([1.84, 0.06, 0.58], [0, 0.03, -0.14], '#2F3236', 'satin', radius=0.006)]
    for x in (-0.46, 0.46):
        p += [box([0.9, 1.96, 0.02], [x, 1.08, 0.165], door, fin, radius=0.01),
              box([0.02, 0.4, 0.03], [x - 0.04 if x > 0 else x + 0.04, 1.1, 0.185], handle, 'metal', radius=0.008)]
    p += [box([0.4, 0.3, 0.32], [-0.5, 2.27, -0.18], '#C9B79C', 'matte', radius=0.02),       # boxes on top
          box([0.32, 0.22, 0.3], [-0.08, 2.23, -0.18], '#E6DFD3', 'matte', radius=0.02)]
    return p


add('wardrobe', placeholder(wardrobe('#EDEBE6', OAK, 'satin', BRASS)), (2, 1))
add('wardrobe@modern', placeholder(wardrobe('#F4F4F2', '#F4F4F2', 'gloss', BLACKMETAL)), (2, 1))
add('wardrobe@cozy', placeholder(wardrobe(WALNUT, HONEY, 'wood', BRASS)), (2, 1))
add('wardrobe@minimal', placeholder(wardrobe(BIRCH, '#F2F2F0', 'wood', '#D9D9D6')), (2, 1))


def dressing_table(wood, fin, seat, frame):
    p = [box([0.86, 0.04, 0.4], [0, 0.74, 0.22], wood, fin, radius=0.01),                     # top
         box([0.3, 0.14, 0.38], [-0.26, 0.65, 0.22], wood, fin, radius=0.01),                  # drawers
         box([0.3, 0.14, 0.38], [0.26, 0.65, 0.22], wood, fin, radius=0.01)]
    for x in (-0.4, 0.4):
        for z in (0.06, 0.38):
            p.append(cyl([0.035, 0.72, 0.035], [x, 0.36, z], frame, 'metal' if frame == BRASS else 'wood', taper=0.8))
    p += [box([0.62, 0.76, 0.03], [0, 1.16, 0.41], frame, 'metal' if frame == BRASS else 'wood', radius=0.12),
          box([0.54, 0.66, 0.006], [0, 1.15, 0.38], '#CFDCE2', 'gloss', radius=0.1),            # mirror
          cyl([0.05, 0.1, 0.05], [0.3, 0.81, 0.3], BLUSH, 'gloss'), cyl([0.04, 0.12, 0.04], [0.35, 0.82, 0.32], '#E8E6E1', 'gloss'),
          box([0.16, 0.04, 0.1], [-0.28, 0.78, 0.18], '#2A2C30', 'satin', radius=0.01),
          cyl([0.42, 0.36, 0.42], [0, 0.22, -0.22], seat, 'fabric', segments=20),                 # pouf stool
          cyl([0.44, 0.06, 0.44], [0, 0.42, -0.22], seat, 'fabric', segments=20)]
    return p


add('dressingTable', placeholder(dressing_table(OAK, 'wood', BLUSH, BRASS)))
add('dressingTable@modern', placeholder(dressing_table('#F1F0EC', 'gloss', '#9AA4AB', BLACKMETAL)))
add('dressingTable@cozy', placeholder(dressing_table(WALNUT, 'wood', RUST, BRASS)))
add('dressingTable@minimal', placeholder(dressing_table(BIRCH, 'wood', LINEN, BIRCH)))

MIRROR_K = lambda frame, ffin: {'wood': mat(ffin, frame), 'metal': mat('gloss', '#CFDCE2'), 'glass': mat('gloss', '#CFDCE2')}  # noqa: E731
add('mirrorWall', wall_gltf(KEN + 'bathroomMirror.glb', [0.62, 0.9, 0.08], 1.0, MIRROR_K(BLACKMETAL, 'metal')))
add('mirrorWall@cozy', wall_gltf(PH + 'ornate_mirror_01.glb', [0.53, 0.82, 0.03], 1.05))
add('mirrorWall@minimal', wall_gltf(KEN + 'bathroomMirror.glb', [0.62, 0.9, 0.08], 1.0, MIRROR_K(BIRCH, 'wood')))

# =============================================================================================
# Bathroom
# =============================================================================================
add('toiletCompact', gltf(KEN + 'toiletSquare.glb', [0.42, 0.78, 0.62], {
    'carpetWhite': mat('gloss', '#F6F6F4'), 'metalLight': mat('chrome', CHROME)}, offset=[0, 0, 0.06]))


def smart_toilet(panel, fin):
    return placeholder([
        box([0.9, 1.2, 0.16], [0, 0.6, -0.36], panel, fin, radius=0.01),                     # wall panel (cistern)
        box([0.18, 0.12, 0.02], [0, 1.0, -0.275], '#2A2C30', 'gloss', radius=0.01),          # flush plate
        sph([0.03, 0.03, 0.01], [0.04, 1.0, -0.263], '#5EC28B', 'gloss', segments=6),
        part('lathe', [0.42, 0.34, 0.56], [0, 0.26, -0.03], '#F6F6F4', 'gloss',
             profile=[[0, -0.5], [0.36, -0.45], [0.5, 0.2], [0.48, 0.5], [0, 0.5]], segments=24),   # wall-hung bowl
        cyl([0.44, 0.04, 0.58], [0, 0.44, -0.03], '#F6F6F4', 'gloss', segments=24),          # seat (0.44)
        box([0.12, 0.1, 0.1], [0, 0.34, -0.27], '#F6F6F4', 'gloss', radius=0.04),
        box([0.14, 0.06, 0.06], [0.36, 0.7, -0.25], '#3A3D41', 'satin', radius=0.02),        # remote
        cyl([0.12, 0.11, 0.12], [-0.34, 0.8, -0.28], '#FFFFFF', 'fabric', rotate=[0, 0, 90]),  # paper roll
    ])


add('toiletSmart', smart_toilet('#E4E3DF', 'satin'))
add('toiletSmart@modern', smart_toilet('#3A3D41', 'matte'))
add('toiletSmart@cozy', smart_toilet(HONEY, 'wood'))

TUB_K = lambda body, tap: {'carpetWhite': mat('gloss', body), 'metalLight': mat('chrome', tap), 'metalDark': mat('satin', '#9AA4AB')}  # noqa: E731
add('bathtub', gltf(KEN + 'bathtub.glb', [1.82, 0.6, 0.86], TUB_K('#F6F6F4', CHROME), offset=[0, 0, 0.04], parts=[
    box([1.56, 0.02, 0.6], [0, 0.48, -0.08], '#BFE0E6', 'glass', radius=0.03)]), (2, 1))


def clawfoot(body, outer, feet):
    p = [part('lathe', [1.7, 0.56, 0.78], [0, 0.42, -0.02], outer, 'gloss',
              profile=[[0, -0.5], [0.42, -0.5], [0.48, -0.2], [0.5, 0.5], [0.46, 0.5], [0.44, -0.3], [0, -0.3]], segments=28),
         part('lathe', [1.6, 0.06, 0.7], [0, 0.6, -0.02], '#F6F6F4', 'gloss', profile=[[0.46, -0.5], [0.5, 0.5], [0.44, 0.5], [0.44, -0.5]], segments=28),
         box([1.36, 0.02, 0.5], [0, 0.5, -0.02], '#BFE0E6', 'glass', radius=0.12)]
    for x in (-0.6, 0.6):
        for z in (-0.24, 0.2):
            p.append(sph([0.1, 0.16, 0.1], [x, 0.08, z], feet, 'metal', segments=8))
    p += [cyl([0.035, 0.5, 0.035], [-0.78, 0.85, -0.02], feet, 'metal'),                     # tap column
          rod([-0.78, 1.08, -0.02], [-0.66, 1.06, -0.02], 0.03, feet, 'metal'),
          box([0.36, 0.06, 0.24], [0.62, 0.65, -0.05], '#FFFFFF', 'fabric', radius=0.02),     # folded towel
          cyl([0.06, 0.1, 0.06], [0.5, 0.67, -0.02], CREAM, 'satin')]                         # candle
    return p


add('bathtubClawfoot', placeholder(clawfoot('#F6F6F4', '#F6F6F4', BRASS)), (2, 1))
add('bathtubClawfoot@modern', placeholder(clawfoot('#F6F6F4', '#3A3D41', BLACKMETAL)), (2, 1))
add('bathtubClawfoot@cozy', placeholder(clawfoot('#F6F6F4', SAGE, BRASS)), (2, 1))


def shower_stall(curtain, tray='#F6F6F4', metal=CHROME):
    return placeholder([
        box([0.9, 0.08, 0.9], [0, 0.04, 0], tray, 'gloss', radius=0.03),
        box([0.86, 2.0, 0.04], [0, 1.08, -0.42], '#E4E8EA', 'satin', radius=0.006),            # tiled back
        box([0.04, 2.0, 0.86], [-0.42, 1.08, 0], '#E4E8EA', 'satin', radius=0.006),
        cyl([0.02, 0.9, 0.02], [0.42, 1.95, 0], metal, 'chrome', rotate=[90, 0, 0]),          # curtain rail
        cyl([0.02, 0.9, 0.02], [0, 1.95, 0.42], metal, 'chrome', rotate=[0, 0, 90]),
        box([0.04, 1.65, 0.58], [0.42, 1.08, -0.12], curtain, 'fabric', radius=0.02),          # curtain, half drawn
        box([0.3, 1.65, 0.04], [0.26, 1.08, 0.42], curtain, 'fabric', radius=0.02),
        cyl([0.03, 0.7, 0.03], [-0.2, 1.6, -0.39], metal, 'chrome'),                           # riser and head
        cyl([0.14, 0.03, 0.14], [-0.2, 1.96, -0.32], metal, 'chrome', rotate=[20, 0, 0]),
        box([0.2, 0.1, 0.08], [0.15, 1.2, -0.38], '#FFFFFF', 'satin', radius=0.02),            # shelf
        cyl([0.05, 0.14, 0.05], [0.12, 1.32, -0.38], TEAL, 'gloss'),
    ])


add('showerStall', shower_stall('#CFE0E4'))
add('showerStall@cozy', shower_stall('#E8D8BE', metal=BRASS))
add('showerStall@minimal', shower_stall('#F4F3EF'))


def walk_in(stone, metal):
    return placeholder([
        box([0.92, 0.04, 0.92], [0, 0.02, 0], stone, 'matte', radius=0.01),
        box([0.88, 2.2, 0.04], [0, 1.12, -0.43], stone, 'matte', radius=0.006),
        box([0.02, 2.0, 0.6], [0.42, 1.04, -0.1], '#DCE6E8', 'glass', radius=0.004),         # glass panel
        box([0.03, 2.0, 0.03], [0.42, 1.04, 0.2], metal, 'metal', radius=0.008),
        cyl([0.03, 0.5, 0.03], [0, 2.0, -0.4], metal, 'metal'),
        rod([0, 2.24, -0.4], [0, 2.24, -0.12], 0.025, metal, 'metal'),
        cyl([0.34, 0.02, 0.34], [0, 2.22, -0.08], metal, 'metal', segments=20),                # rain head
        box([0.06, 0.14, 0.04], [-0.25, 1.1, -0.4], metal, 'metal', radius=0.01),
        box([0.4, 0.04, 0.12], [-0.12, 1.3, -0.37], stone, 'matte', radius=0.01),             # niche shelf
        cyl([0.05, 0.16, 0.05], [-0.22, 1.4, -0.37], '#F2F1EE', 'gloss'),
        cyl([0.05, 0.12, 0.05], [-0.12, 1.38, -0.37], SAGE, 'gloss'),
        box([0.3, 0.02, 0.06], [0, 0.045, 0.2], '#3A3D41', 'metal', radius=0.004),            # drain
    ])


add('showerWalkIn', walk_in('#C9C6C0', BLACKMETAL))
add('showerWalkIn@modern', walk_in('#8E8A84', BLACKMETAL))
add('showerWalkIn@cozy', walk_in('#D9C7A7', BRASS))
add('showerWalkIn@minimal', walk_in('#F4F3EF', CHROME))

add('sinkPedestal', gltf(KEN + 'bathroomSink.glb', [0.56, 0.96, 0.5], {
    '_defaultMat': mat('gloss', '#F6F6F4'), 'carpetWhite': mat('gloss', '#F6F6F4'), 'metalLight': mat('chrome', CHROME)}, offset=[0, 0, 0.05]))


def double_vanity(cab, top, fin, tap):
    p = [box([1.86, 0.78, 0.52], [0, 0.45, -0.17], cab, fin, radius=0.012),
         box([1.86, 0.06, 0.5], [0, 0.03, -0.17], '#2F3236', 'satin', radius=0.006),
         box([1.9, 0.04, 0.56], [0, 0.86, -0.15], top, 'gloss', radius=0.008)]
    for x in (-0.68, -0.23, 0.23, 0.68):
        p += [box([0.43, 0.62, 0.02], [x, 0.44, 0.1], cab, fin, radius=0.01),
              box([0.14, 0.015, 0.02], [x, 0.7, 0.118], tap, 'metal', radius=0.004)]
    for x in (-0.48, 0.48):
        p += [part('lathe', [0.5, 0.14, 0.38], [x, 0.94, -0.12], '#F6F6F4', 'gloss',
                   profile=[[0, -0.5], [0.4, -0.45], [0.5, 0.5], [0.46, 0.5], [0.36, -0.3], [0, -0.3]], segments=24),
              cyl([0.03, 0.22, 0.03], [x, 0.98, -0.36], tap, 'metal'),
              rod([x, 1.08, -0.36], [x, 1.06, -0.24], 0.02, tap, 'metal'),
              box([0.66, 0.76, 0.03], [x, 1.5, -0.42], '#CFDCE2', 'gloss', radius=0.04)]           # mirrors
    p += [cyl([0.06, 0.16, 0.06], [0.0, 0.96, -0.3], TEAL, 'gloss'), cyl([0.07, 0.1, 0.07], [0.1, 0.93, -0.32], '#F2F1EE', 'gloss')]
    return p


add('vanityDouble', placeholder(double_vanity('#EDEBE6', '#F4F4F2', 'satin', CHROME)), (2, 1))
add('vanityDouble@modern', placeholder(double_vanity(OAK, '#F4F4F2', 'wood', BLACKMETAL)), (2, 1))
add('vanityDouble@cozy', placeholder(double_vanity(SAGE, '#E8E2D6', 'satin', BRASS)), (2, 1))
add('vanityDouble@minimal', placeholder(double_vanity(BIRCH, '#F4F4F2', 'wood', CHROME)), (2, 1))


def towel_rail(metal, towel):
    z = -0.43
    return placeholder([
        cyl([0.025, 0.7, 0.025], [0, 1.2, z + 0.07], metal, 'chrome' if metal == CHROME else 'metal', rotate=[0, 0, 90]),
        cyl([0.025, 0.7, 0.025], [0, 0.95, z + 0.07], metal, 'chrome' if metal == CHROME else 'metal', rotate=[0, 0, 90]),
        box([0.03, 0.06, 0.07], [-0.34, 1.2, z + 0.035], metal, 'metal', radius=0.01),
        box([0.03, 0.06, 0.07], [0.34, 1.2, z + 0.035], metal, 'metal', radius=0.01),
        box([0.03, 0.31, 0.03], [-0.34, 1.075, z + 0.07], metal, 'metal', radius=0.01),
        box([0.03, 0.31, 0.03], [0.34, 1.075, z + 0.07], metal, 'metal', radius=0.01),
        box([0.44, 0.5, 0.05], [-0.06, 1.0, z + 0.09], towel, 'fabric', radius=0.02),          # towels over the bars
        box([0.3, 0.32, 0.04], [0.16, 0.86, z + 0.1], '#FFFFFF', 'fabric', radius=0.02),
    ])


add('towelRail', towel_rail(CHROME, '#9DC6CF'))
add('towelRail@modern', towel_rail(BLACKMETAL, '#C9C6BE'))
add('towelRail@cozy', towel_rail(BRASS, RUST))
add('mirrorCabinet', wall_gltf(KEN + 'bathroomCabinet.glb', [0.56, 0.76, 0.18], 1.2, {
    'wood': mat('satin', '#F2F1EE'), 'woodDark': mat('satin', '#E4E3DF'), 'metal': mat('gloss', '#CFDCE2')}))
add('mirrorCabinet@cozy', wall_gltf(KEN + 'bathroomCabinet.glb', [0.56, 0.76, 0.18], 1.2, {
    'wood': mat('wood', HONEY), 'woodDark': mat('wood', WALNUT), 'metal': mat('gloss', '#CFDCE2')}))
LAUNDRY_K = {'metalLight': mat('gloss', '#F4F4F2'), 'metalMedium': mat('satin', '#C9CBCC'), 'metalDark': mat('satin', '#3A3D41'),
             'metal': mat('chrome', CHROME), 'glass': mat('glass', '#BFD3DA'), '_defaultMat': mat('satin', '#9AA4AB')}
add('laundryWasher', gltf(KEN + 'washer.glb', [0.62, 0.88, 0.62], LAUNDRY_K, offset=[0, 0, 0.04], parts=[
    box([0.3, 0.08, 0.22], [0.08, 0.92, -0.1], '#FFFFFF', 'fabric', radius=0.02)]))
add('laundryDryer', gltf(KEN + 'dryer.glb', [0.62, 0.88, 0.62], LAUNDRY_K, offset=[0, 0, 0.04], parts=[
    part('lathe', [0.4, 0.2, 0.3], [-0.06, 0.98, -0.08], '#C9B79C', 'matte',
         profile=[[0, -0.5], [0.44, -0.5], [0.5, 0.5], [0.46, 0.5], [0.4, -0.4], [0, -0.4]], segments=16),   # laundry basket
    box([0.3, 0.1, 0.22], [-0.06, 1.04, -0.08], '#E9E2D4', 'fabric', radius=0.03)]))

# =============================================================================================
# Kids
# =============================================================================================
def kids_bed(frame, sheet, cover, rail):
    p = [box([0.96, 0.24, 1.9], [0, 0.18, 0.0], frame, 'satin', radius=0.03),
         box([0.88, 0.16, 1.82], [0, 0.36, 0.02], sheet, 'fabric', radius=0.05),             # mattress (top 0.44)
         box([0.9, 0.05, 1.1], [0, 0.45, 0.36], cover, 'fabric', radius=0.02),
         box([0.96, 0.7, 0.06], [0, 0.42, -0.95], frame, 'satin', radius=0.03),               # headboard
         cushion([0.58, 0.12, 0.3], [0, 0.49, -0.7], '#FFFFFF')]
    for z in (-0.6, -0.2, 0.2):                                                               # guard rail
        p.append(box([0.03, 0.22, 0.03], [0.46, 0.55, z], rail, 'satin', radius=0.01))
    p += [box([0.03, 0.03, 0.9], [0.46, 0.66, -0.2], rail, 'satin', radius=0.01)]
    for i, (x, c) in enumerate(((-0.2, MUSTARD), (0.0, TEAL), (0.2, RUST))):              # stars on the headboard
        p.append(part('cylinder', [0.12, 0.012, 0.12], [x, 0.6, -0.915], c, 'satin', rotate=[90, 0, 0], segments=5))
    p.append(sph([0.18, 0.2, 0.14], [0.22, 0.52, -0.5], '#C08A52', 'fabric', segments=10))   # plush toy
    return p


add('kidsBed', placeholder(kids_bed('#9DC6CF', '#F7F7F5', '#F2C14E', '#F2F2F0')), (1, 2))
add('kidsBed@cozy', placeholder(kids_bed('#E4B8AE', CREAM, SAGE, '#F2F2F0')), (1, 2))
add('kidsBed@minimal', placeholder(kids_bed('#F2F2F0', '#FFFFFF', LINEN, BIRCH)), (1, 2))


def toy_box():
    p = [box([0.8, 0.46, 0.5], [0, 0.23, -0.18], '#F2C14E', 'satin', radius=0.03),
         box([0.82, 0.05, 0.52], [0, 0.6, -0.36], '#E9A23B', 'satin', radius=0.02, rotate=[-60, 0, 0]),  # open lid
         box([0.1, 0.1, 0.1], [-0.2, 0.5, -0.15], '#D9483B', 'satin', radius=0.02),
         sph([0.16, 0.16, 0.16], [0.15, 0.52, -0.12], '#3E8EDE', 'gloss', segments=10),        # ball
         box([0.1, 0.1, 0.1], [0.32, 0.05, 0.25], '#5EC28B', 'satin', radius=0.02),             # blocks spilled
         box([0.1, 0.1, 0.1], [0.2, 0.05, 0.3], '#D9483B', 'satin', radius=0.02, rotate=[0, 30, 0]),
         box([0.1, 0.1, 0.1], [0.26, 0.15, 0.28], '#3E8EDE', 'satin', radius=0.02)]
    for x in (-0.25, 0.0, 0.25):
        p.append(box([0.16, 0.14, 0.01], [x, 0.28, 0.072], ['#D9483B', '#5EC28B', '#3E8EDE'][int((x + 0.25) / 0.25)], 'satin', radius=0.02))
    return p


add('toyBox', placeholder(toy_box()))


def play_mat():
    p = [box([0.92, 0.02, 0.92], [0, 0.01, 0], '#9DC6CF', 'fabric', radius=0.01)]
    for (x, z), c in zip(((-0.3, -0.3), (0.3, -0.3), (-0.3, 0.3), (0.3, 0.3)), ('#F2C14E', '#E4B8AE', '#B5D99C', '#F2F2F0')):
        p.append(box([0.3, 0.004, 0.3], [x, 0.022, z], c, 'fabric', radius=0.01))
    for i, (x, y, z, c) in enumerate(((-0.05, 0.06, -0.1, '#D9483B'), (0.07, 0.06, -0.1, '#3E8EDE'), (0.01, 0.16, -0.1, '#F2C14E'),
                                      (0.2, 0.06, 0.1, '#5EC28B'), (-0.25, 0.06, 0.15, '#3E8EDE'))):
        p.append(box([0.1, 0.1, 0.1], [x, y, z], c, 'satin', radius=0.02, rotate=[0, i * 17, 0]))
    p += [sph([0.12, 0.12, 0.12], [0.3, 0.08, -0.25], '#D9483B', 'gloss', segments=10)]
    return p


add('playMat', placeholder(play_mat()))
add('kidsChalkboard', gltf(PH + 'standing_chalkboard_01.glb', [0.62, 1.0, 0.5], align='centre', parts=[
    box([0.5, 0.04, 0.06], [0, 0.42, 0.18], '#F2F2F0', 'matte', radius=0.01)]))


def doll_house(wall, roof, trim):
    p = [box([0.8, 0.04, 0.42], [0, 0.02, -0.15], trim, 'wood', radius=0.01),
         box([0.76, 0.66, 0.38], [0, 0.37, -0.16], wall, 'satin', radius=0.01),
         box([0.72, 0.02, 0.36], [0, 0.36, -0.14], trim, 'wood', radius=0.004)]               # floor between storeys
    for s in (-1, 1):
        p.append(box([0.44, 0.03, 0.42], [s * 0.19, 0.83, -0.16], roof, 'satin', radius=0.01, rotate=[0, 0, -s * 38]))
    p += [box([0.16, 0.12, 0.004], [-0.2, 0.17, 0.032], '#2A2C30', 'matte', radius=0.004),     # open front: rooms inside
          box([0.12, 0.08, 0.1], [0.18, 0.08, -0.1], RUST, 'fabric', radius=0.02),             # tiny sofa
          box([0.14, 0.04, 0.1], [-0.18, 0.42, -0.1], '#9DC6CF', 'fabric', radius=0.01),       # tiny bed
          box([0.06, 0.12, 0.06], [0.2, 0.44, -0.1], MUSTARD, 'satin', radius=0.01),
          box([0.12, 0.16, 0.02], [0.0, 0.62, 0.02], '#BFE0E6', 'glass', radius=0.01)]
    return p


add('dollHouse', placeholder(doll_house('#F4EBD8', '#D9483B', HONEY)))
add('dollHouse@modern', placeholder(doll_house('#F4F4F2', '#3A3D41', OAK)))


def rocking_horse(body, mane, rocker):
    """A rocking horse whose rider faces +Z (saddle ~0.56 m)."""
    p = []
    for x in (-0.12, 0.12):                                                                   # curved rockers along z
        for i in range(6):
            a0, a1 = math.radians(-16 + i * 32 / 6), math.radians(-16 + (i + 1) * 32 / 6)
            pa = [x, 1.62 - math.cos(a0) * 1.6, math.sin(a0) * 1.6]
            pb = [x, 1.62 - math.cos(a1) * 1.6, math.sin(a1) * 1.6]
            p.append(rod(pa, pb, 0.04, rocker, 'wood'))
    for x in (-0.12, 0.12):
        for z in (-0.2, 0.2):
            p.append(rod([x, 0.04, z * 1.4], [x * 0.6, 0.38, z * 0.7], 0.04, rocker, 'wood'))
    p += [cyl([0.2, 0.5, 0.18], [0, 0.44, 0], body, 'satin', rotate=[90, 0, 0], segments=14),   # body
          rod([0, 0.48, 0.18], [0, 0.72, 0.3], 0.12, body, 'satin'),                            # neck
          box([0.11, 0.12, 0.24], [0, 0.74, 0.38], body, 'satin', radius=0.04, rotate=[15, 0, 0]),  # head
          box([0.04, 0.24, 0.05], [0, 0.66, 0.2], mane, 'fabric', radius=0.02, rotate=[-40, 0, 0]),
          rod([0, 0.46, -0.24], [0, 0.3, -0.34], 0.04, mane, 'fabric'),                         # tail
          box([0.2, 0.03, 0.2], [0, 0.545, -0.02], '#D9483B', 'fabric', radius=0.02),             # saddle
          cyl([0.02, 0.24, 0.02], [0, 0.66, 0.28], '#2A2C30', 'metal', rotate=[0, 0, 90])]          # handle
    return p


add('rockingHorse', placeholder(rocking_horse('#F2F0EA', '#C08A52', '#C9A27A')))


def kids_desk(top, chair):
    p = [box([0.76, 0.03, 0.44], [0, 0.56, 0.2], top, 'wood', radius=0.01)]
    for x in (-0.34, 0.34):
        for z in (0.02, 0.38):
            p.append(cyl([0.04, 0.54, 0.04], [x, 0.27, z], '#F2F2F0', 'satin'))
    p += [box([0.3, 0.005, 0.22], [-0.12, 0.578, 0.2], '#FFFFFF', 'matte', radius=0.002),         # drawing
          box([0.2, 0.004, 0.14], [-0.12, 0.581, 0.2], '#9DC6CF', 'matte', radius=0.002),
          cyl([0.08, 0.1, 0.08], [0.24, 0.62, 0.3], '#F2C14E', 'satin'),                          # crayon cup
          cyl([0.01, 0.1, 0.01], [0.23, 0.69, 0.3], '#D9483B', 'satin'), cyl([0.01, 0.1, 0.01], [0.25, 0.69, 0.31], '#3E8EDE', 'satin')]
    p += chair_facing_front(0, -0.2, chair, chair, 'satin', seat_h=0.36, back_h=0.68)
    return p


add('kidsDesk', placeholder(kids_desk(BIRCH, '#9DC6CF')))
add('kidsDesk@cozy', placeholder(kids_desk(HONEY, '#E4B8AE')))
def teddy(fur, muzzle, bow):
    """A big sitting teddy bear, facing +Z."""
    return [sph([0.5, 0.5, 0.42], [0, 0.28, -0.02], fur, 'fabric', segments=14),                 # body
            sph([0.28, 0.24, 0.1], [0, 0.3, 0.17], muzzle, 'fabric', segments=12),               # tummy
            sph([0.4, 0.38, 0.36], [0, 0.68, 0.0], fur, 'fabric', segments=14),                  # head
            sph([0.16, 0.12, 0.12], [0, 0.64, 0.17], muzzle, 'fabric', segments=10),             # snout
            sph([0.06, 0.04, 0.04], [0, 0.67, 0.23], '#2A2624', 'gloss', segments=8),            # nose
            sph([0.04, 0.04, 0.03], [-0.08, 0.74, 0.16], '#2A2624', 'gloss', segments=6),        # eyes
            sph([0.04, 0.04, 0.03], [0.08, 0.74, 0.16], '#2A2624', 'gloss', segments=6),
            sph([0.14, 0.14, 0.08], [-0.15, 0.86, -0.02], fur, 'fabric', segments=10),          # ears
            sph([0.14, 0.14, 0.08], [0.15, 0.86, -0.02], fur, 'fabric', segments=10),
            sph([0.14, 0.26, 0.14], [-0.26, 0.36, 0.06], fur, 'fabric', segments=10),           # arms
            sph([0.14, 0.26, 0.14], [0.26, 0.36, 0.06], fur, 'fabric', segments=10),
            sph([0.18, 0.14, 0.3], [-0.14, 0.08, 0.2], fur, 'fabric', segments=10),             # legs
            sph([0.18, 0.14, 0.3], [0.14, 0.08, 0.2], fur, 'fabric', segments=10),
            box([0.2, 0.08, 0.06], [0, 0.5, 0.15], bow, 'satin', radius=0.03)]                    # bow


add('teddyBear', placeholder(teddy('#C08A52', '#E9D5B5', '#D9483B')))

# =============================================================================================
# Office
# =============================================================================================
def desk(top, legs, chair, top_fin='wood', leg_fin='metal', w=1.54, laptop=False, lamp=None):
    p = [box([w, 0.035, 0.42], [0, 0.735, 0.24], top, top_fin, radius=0.008)]
    for s in (-1, 1):
        p += [box([0.04, 0.72, 0.04], [s * (w / 2 - 0.04), 0.36, 0.06], legs, leg_fin, radius=0.006),
              box([0.04, 0.72, 0.04], [s * (w / 2 - 0.04), 0.36, 0.42], legs, leg_fin, radius=0.006)]
    p.append(box([w - 0.1, 0.06, 0.02], [0, 0.69, 0.43], legs, leg_fin, radius=0.006))
    if laptop:
        p += [box([0.34, 0.015, 0.24], [0.02, 0.76, 0.2], '#C9CBCC', 'metal', radius=0.008),
              box([0.34, 0.22, 0.012], [0.02, 0.87, 0.32], '#C9CBCC', 'metal', radius=0.008, rotate=[-15, 0, 0]),
              box([0.31, 0.19, 0.003], [0.02, 0.87, 0.313], '#2E5470', 'gloss', radius=0.004, rotate=[-15, 0, 0])]
    else:
        p += [box([0.42, 0.012, 0.3], [-0.1, 0.758, 0.2], '#FFFFFF', 'matte', radius=0.002, rotate=[0, 8, 0]),   # paper
              cyl([0.012, 0.15, 0.012], [0.05, 0.76, 0.2], '#2A2C30', 'satin', rotate=[0, 0, 85]),             # pen
              box([0.2, 0.06, 0.28], [0.45, 0.78, 0.26], MUSTARD, 'matte', radius=0.006)]                    # notebooks
    if lamp:
        p += [cyl([0.13, 0.02, 0.13], [-w / 2 + 0.2, 0.763, 0.36], lamp, 'metal'),
              rod([-w / 2 + 0.2, 0.77, 0.36], [-w / 2 + 0.24, 1.1, 0.31], 0.018, lamp, 'metal'),
              rod([-w / 2 + 0.24, 1.1, 0.31], [-w / 2 + 0.35, 1.06, 0.22], 0.016, lamp, 'metal'),
              cone([0.12, 0.1, 0.12], [-w / 2 + 0.37, 1.03, 0.2], lamp, 'metal', taper=0.4, rotate=[35, 0, 0]),
              sph([0.05, 0.05, 0.05], [-w / 2 + 0.37, 0.995, 0.18], BULB, 'gloss', segments=8)]
    p += office_chair(-0.17, chair, legs if leg_fin == 'metal' else BLACKMETAL)
    return p


add('deskWriting', placeholder(desk(OAK, BLACKMETAL, SAGE, lamp=BLACKMETAL)), (2, 1))
add('deskWriting@modern', placeholder(desk('#F1F0EC', BLACKMETAL, '#8E979E', 'gloss', lamp=BLACKMETAL)), (2, 1))
add('deskWriting@cozy', placeholder(desk(HONEY, WALNUT, RUST, leg_fin='wood', lamp='#2F6B4F')), (2, 1))
add('deskWriting@minimal', placeholder(desk(BIRCH, '#F2F2F0', '#E6E2DA', leg_fin='satin', lamp='#F2F2F0')), (2, 1))
add('deskLaptop', placeholder(desk(OAK, BLACKMETAL, '#5F6E7A', w=0.9, laptop=True)))
add('deskLaptop@modern', placeholder(desk('#F1F0EC', BLACKMETAL, '#8E979E', 'gloss', w=0.9, laptop=True)))
add('deskLaptop@cozy', placeholder(desk(HONEY, WALNUT, RUST, leg_fin='wood', w=0.9, laptop=True)))
add('deskLaptop@minimal', placeholder(desk(BIRCH, '#F2F2F0', '#E6E2DA', leg_fin='satin', w=0.9, laptop=True)))


def gaming_pc(accent):
    p = desk('#2F3236', '#2F3236', '#2F3236', 'satin', w=1.7)
    p = [q for q in p if q['at'][1] < 0.74 or q['at'][2] < 0.0]           # bare desk and chair
    p += [box([1.7, 0.035, 0.44], [0, 0.735, 0.24], '#2F3236', 'satin', radius=0.008),
          box([1.6, 0.004, 0.36], [0, 0.755, 0.22], '#3A3D41', 'matte', radius=0.004),          # desk mat
          box([1.62, 0.01, 0.01], [0, 0.74, 0.465], accent, 'gloss', radius=0.003)]             # LED strip
    for x, ry in ((-0.36, 18), (0.36, -18)):                                                    # two monitors angled in
        p += [box([0.62, 0.36, 0.03], [x, 1.03, 0.38], '#22252A', 'satin', radius=0.01, rotate=[0, ry, 0]),
              box([0.6, 0.34, 0.004], [x, 1.03, 0.3635], '#3B2E6E' if x < 0 else '#2E5470', 'gloss', radius=0.004, rotate=[0, ry, 0]),
              box([0.05, 0.22, 0.03], [x, 0.84, 0.41], '#22252A', 'satin', radius=0.01)]
    p += [box([0.46, 0.02, 0.15], [0, 0.765, 0.17], '#22252A', 'satin', radius=0.006),
          box([0.44, 0.004, 0.13], [0, 0.777, 0.17], accent, 'gloss', radius=0.004),                  # backlit keys
          box([0.08, 0.025, 0.12], [0.36, 0.765, 0.17], '#22252A', 'satin', radius=0.03),
          box([0.24, 0.5, 0.48], [0.62, 0.25, 0.2], '#22252A', 'satin', radius=0.01),                 # tower under the desk
          box([0.005, 0.4, 0.38], [0.5, 0.26, 0.2], accent, 'glass', radius=0.004),
          box([0.16, 0.2, 0.14], [-0.66, 0.85, 0.36], '#22252A', 'satin', radius=0.02),               # speaker
          cyl([0.06, 0.1, 0.06], [-0.5, 0.8, 0.38], accent, 'gloss')]
    p += office_chair(-0.17, '#3A3D41', '#22252A')
    return p


add('computerGaming', placeholder(gaming_pc('#6E5CE6')), (2, 1))
add('computerGaming@cozy', placeholder(gaming_pc('#F2A23C')), (2, 1))
add('officeChair', gltf(KEN + 'chairDesk.glb', [0.64, 1.06, 0.6], {
    'metalMedium': mat('metal', BLACKMETAL), 'carpet': mat('fabric', '#5F6E7A')}, align='centre'))
add('officeChair@cozy', gltf(KEN + 'chairDesk.glb', [0.64, 1.06, 0.6], {
    'metalMedium': mat('metal', '#3A3530'), 'carpet': mat('fabric', RUST)}, align='centre'))
add('officeChair@minimal', gltf(KEN + 'chairDesk.glb', [0.64, 1.06, 0.6], {
    'metalMedium': mat('satin', '#F2F2F0'), 'carpet': mat('fabric', LINEN)}, align='centre'))

# =============================================================================================
# Hobbies
# =============================================================================================
def guitar_stand(metal=BLACKMETAL):
    return [rod([0, 0.02, 0.12], [0, 0.62, -0.02], 0.03, metal, 'metal'),
            rod([0, 0.06, 0.12], [-0.16, 0.0, -0.06], 0.025, metal, 'metal'),
            rod([0, 0.06, 0.12], [0.16, 0.0, -0.06], 0.025, metal, 'metal'),
            rod([-0.12, 0.2, 0.08], [0.12, 0.2, 0.08], 0.03, metal, 'metal'),
            sph([0.05, 0.05, 0.05], [0, 0.63, -0.03], '#2A2C30', 'satin', segments=8)]


add('ukulele', gltf(PH + 'Ukulele_01.glb', [0.23, 0.69, 0.07], align='centre', offset=[0, 0.14, 0.04], parts=guitar_stand()))


def electric_guitar(body, amp):
    p = guitar_stand()
    p += [box([0.36, 0.44, 0.05], [0, 0.42, 0.06], body, 'gloss', radius=0.12, rotate=[-12, 0, 0]),    # body
          box([0.2, 0.2, 0.052], [0.02, 0.36, 0.064], '#F2F2F0', 'gloss', radius=0.05, rotate=[-12, 0, 0]),  # pickguard
          box([0.05, 0.62, 0.03], [0, 0.92, -0.04], '#C9A27A', 'wood', radius=0.01, rotate=[-12, 0, 0]),     # neck
          box([0.08, 0.16, 0.03], [0, 1.28, -0.12], '#2A2C30', 'gloss', radius=0.02, rotate=[-12, 0, 0])]    # head
    p += [box([0.46, 0.4, 0.28], [0.0, 0.2, -0.28], amp, 'matte', radius=0.02),                              # amp behind
          box([0.4, 0.26, 0.004], [0, 0.18, -0.138], '#4A4D52', 'fabric', radius=0.01),
          box([0.4, 0.06, 0.004], [0, 0.36, -0.138], '#C9A27A', 'satin', radius=0.004)]
    return p


add('guitarElectric', placeholder(electric_guitar('#D9483B', '#2A2C30')))
add('guitarElectric@modern', placeholder(electric_guitar('#F2F2F0', '#3A3D41')))
add('guitarElectric@cozy', placeholder(electric_guitar('#C08A52', '#5A3F2A')))


def keyboard(body, stand, seat):
    p = [box([0.9, 0.1, 0.3], [0, 0.78, 0.22], body, 'satin', radius=0.02),
         box([0.8, 0.02, 0.15], [0, 0.835, 0.17], '#F6F3EA', 'satin', radius=0.003),
         box([0.9, 0.03, 0.06], [0, 0.845, 0.33], body, 'satin', radius=0.01),
         box([0.4, 0.22, 0.012], [0, 0.98, 0.33], '#F4EFE2', 'matte', radius=0.004, rotate=[-12, 0, 0])]
    for i in range(20):
        x = -0.4 + i * 0.039
        if i % 7 in (2, 6): continue
        p.append(box([0.011, 0.018, 0.09], [x + 0.02, 0.852, 0.2], '#141414', 'gloss', radius=0.002))
    for s in (-1, 1):                                                                       # X stand
        p += [rod([s * 0.34, 0.02, 0.08], [s * 0.34, 0.72, 0.36], 0.03, stand, 'metal'),
              rod([s * 0.34, 0.02, 0.36], [s * 0.34, 0.72, 0.08], 0.03, stand, 'metal')]
    p += [box([0.62, 0.06, 0.32], [0, 0.42, -0.2], seat, 'fabric', radius=0.03),          # bench (0.45)
          rod([-0.26, 0.0, -0.32], [-0.26, 0.39, -0.2], 0.03, stand, 'metal'), rod([0.26, 0.0, -0.32], [0.26, 0.39, -0.2], 0.03, stand, 'metal'),
          rod([-0.26, 0.0, -0.08], [-0.26, 0.39, -0.2], 0.03, stand, 'metal'), rod([0.26, 0.0, -0.08], [0.26, 0.39, -0.2], 0.03, stand, 'metal')]
    return p


add('keyboardDigital', placeholder(keyboard('#2A2C30', BLACKMETAL, '#3A3D41')))
add('keyboardDigital@modern', placeholder(keyboard('#F2F2F0', BLACKMETAL, '#9AA4AB')))
add('keyboardDigital@cozy', placeholder(keyboard(WALNUT, '#3A3530', RUST)))


def sewing_table(top, legs, seat):
    p = [box([0.9, 0.035, 0.46], [0, 0.735, 0.2], top, 'wood', radius=0.008)]
    for x in (-0.4, 0.4):
        for z in (0.02, 0.4):
            p.append(box([0.04, 0.72, 0.04], [x, 0.36, z], legs, 'metal' if legs == BLACKMETAL else 'wood', radius=0.006))
    p += [box([0.36, 0.08, 0.16], [0.02, 0.795, 0.28], '#F2F1EE', 'gloss', radius=0.02),         # sewing machine base
          box([0.08, 0.2, 0.14], [0.16, 0.92, 0.28], '#F2F1EE', 'gloss', radius=0.03),
          box([0.32, 0.08, 0.14], [0.02, 1.0, 0.28], '#F2F1EE', 'gloss', radius=0.03),
          box([0.06, 0.1, 0.06], [-0.14, 0.92, 0.28], '#F2F1EE', 'gloss', radius=0.02),
          cyl([0.08, 0.02, 0.08], [0.21, 0.94, 0.28], '#9DC6CF', 'satin', rotate=[0, 0, 90]),
          box([0.4, 0.008, 0.3], [-0.2, 0.757, 0.14], BLUSH, 'fabric', radius=0.004, rotate=[0, 12, 0]),  # fabric
          cyl([0.05, 0.06, 0.05], [0.36, 0.78, 0.12], RUST, 'satin'), cyl([0.05, 0.06, 0.05], [0.36, 0.78, 0.22], TEAL, 'satin'),
          lathe([0.22, 0.12, 0.22], [-0.32, 0.81, 0.36], '#C9B79C', 'matte',
                [[0, -0.5], [0.44, -0.5], [0.5, 0.5], [0.46, 0.5], [0.4, -0.4], [0, -0.4]])]
    p += chair_facing_front(0, -0.22, top, seat, 'wood')
    return p


add('sewingTable', placeholder(sewing_table(OAK, OAKD, SAGE)))
add('sewingTable@cozy', placeholder(sewing_table(HONEY, WALNUT, RUST)))


def pool_table(felt, wood, fin='wood'):
    p = [box([2.5, 0.1, 1.4], [0, 0.72, 0], wood, fin, radius=0.04),                          # rails
         box([2.3, 0.02, 1.2], [0, 0.775, 0], felt, 'fabric', radius=0.01),                    # cloth
         box([2.4, 0.18, 1.3], [0, 0.6, 0], wood, fin, radius=0.02)]                           # apron
    for x in (-1.12, 1.12):
        for z in (-0.52, 0.52):
            p.append(box([0.16, 0.56, 0.16], [x, 0.28, z], wood, fin, radius=0.02))           # legs
    for x in (-1.16, 0.0, 1.16):
        for z in (-0.62, 0.62):
            p.append(cyl([0.1, 0.02, 0.1], [x, 0.772, z * 0.97], '#141414', 'matte'))           # pockets
    balls = [('#F2C14E', 0.5, 0.0), ('#3E8EDE', 0.56, 0.04), ('#D9483B', 0.56, -0.04), ('#6E3FA8', 0.62, 0.08),
             ('#141414', 0.62, 0.0), ('#E9853B', 0.62, -0.08), ('#2F8F4E', 0.68, 0.04), ('#8E2A2A', 0.68, -0.04),
             ('#FFFFFF', -0.6, 0.0)]
    for c, x, z in balls:
        p.append(sph([0.057, 0.057, 0.057], [x, 0.815, z], c, 'gloss', segments=10))
    p += [cyl([0.025, 1.45, 0.025], [-0.2, 0.8, 0.3], '#C9A27A', 'wood', rotate=[0, 70, 88]),   # cue on the table
          box([0.2, 0.06, 0.03], [0, 0.11, 0.66], wood, fin, radius=0.01)]
    return p


add('poolTable', placeholder(pool_table('#2F7A57', WALNUT)), (3, 2))
add('poolTable@modern', placeholder(pool_table('#3E5470', '#F1F0EC', 'gloss')), (3, 2))
add('poolTable@cozy', placeholder(pool_table('#8E2A2A', HONEY)), (3, 2))


def foosball(body, men_a, men_b):
    p = [box([1.4, 0.24, 0.72], [0, 0.8, 0], body, 'wood', radius=0.02),
         box([1.3, 0.02, 0.62], [0, 0.72, 0], '#2F8F4E', 'matte', radius=0.004)]
    for x in (-0.6, 0.6):
        for z in (-0.3, 0.3):
            p.append(box([0.08, 0.7, 0.08], [x, 0.35, z], body, 'wood', radius=0.01))
    for i, x in enumerate((-0.45, -0.15, 0.15, 0.45)):                                        # rods with players
        c = men_a if i % 2 == 0 else men_b
        p.append(cyl([0.02, 0.96, 0.02], [x, 0.84, 0], CHROME, 'chrome', rotate=[90, 0, 0]))
        p.append(cyl([0.05, 0.08, 0.05], [x, 0.84, 0.46], '#2A2C30', 'satin', rotate=[90, 0, 0]))
        for z in (-0.18, 0.0, 0.18):
            p.append(box([0.04, 0.12, 0.05], [x, 0.8, z], c, 'gloss', radius=0.01))
    p.append(sph([0.04, 0.04, 0.04], [0.05, 0.75, 0.05], '#FFFFFF', 'gloss', segments=8))
    return p


add('foosball', placeholder(foosball(OAK, '#D9483B', '#3E8EDE')), (2, 1))
add('dartboard', wall_gltf(PH + 'dartboard.glb', [0.45, 0.45, 0.04], 1.5, parts=[
    box([0.62, 0.62, 0.02], [0, 1.725, -0.43 + 0.012], '#2A2C30', 'matte', radius=0.02)]))


def chemistry(top, legs):
    p = [box([0.92, 0.04, 0.5], [0, 0.88, -0.15], top, 'satin', radius=0.008)]
    for x in (-0.42, 0.42):
        for z in (-0.36, 0.06):
            p.append(box([0.04, 0.86, 0.04], [x, 0.43, z], legs, 'metal', radius=0.006))
    p += [box([0.9, 0.03, 0.44], [0, 0.3, -0.15], legs, 'metal', radius=0.006),
          box([0.8, 0.5, 0.04], [0, 1.15, -0.38], '#F2F1EE', 'satin', radius=0.008),             # back board
          box([0.8, 0.02, 0.16], [0, 1.25, -0.3], top, 'satin', radius=0.004)]                   # shelf
    flasks = [(-0.3, 0.92, -0.1, '#7FD1AE'), (-0.15, 0.92, -0.05, '#E9853B'), (0.25, 0.92, -0.08, '#6E8BE6')]
    for x, y, z, c in flasks:
        p += [part('lathe', [0.12, 0.18, 0.12], [x, y + 0.09, z], c, 'glass',
                   profile=[[0, -0.5], [0.5, -0.5], [0.5, -0.2], [0.18, 0.3], [0.18, 0.5], [0, 0.5]], segments=12)]
    for i in range(5):
        p.append(cyl([0.03, 0.14, 0.03], [-0.3 + i * 0.12, 1.33, -0.3], ['#7FD1AE', '#F2C14E', '#E9853B', '#6E8BE6', '#D9483B'][i], 'glass'))
    p += [box([0.12, 0.2, 0.12], [0.05, 1.0, -0.2], '#2A2C30', 'satin', radius=0.01),           # microscope
          cyl([0.04, 0.16, 0.04], [0.05, 1.16, -0.16], '#2A2C30', 'satin', rotate=[-20, 0, 0]),
          box([0.16, 0.02, 0.14], [0.05, 0.91, -0.12], '#2A2C30', 'satin', radius=0.004)]
    return p


add('chemistrySet', placeholder(chemistry('#E4E3DF', BLACKMETAL)))

# =============================================================================================
# Fitness
# =============================================================================================
def exercise_bike(frame, accent):
    p = [box([0.16, 0.06, 0.9], [0, 0.03, 0.0], frame, 'satin', radius=0.02),
         box([0.5, 0.05, 0.08], [0, 0.03, -0.38], frame, 'satin', radius=0.02),
         box([0.5, 0.05, 0.08], [0, 0.03, 0.38], frame, 'satin', radius=0.02),
         cyl([0.42, 0.06, 0.42], [0, 0.3, 0.22], '#3A3D41', 'metal', rotate=[0, 0, 90], segments=24),   # flywheel
         rod([0, 0.06, -0.15], [0, 0.66, -0.1], 0.07, frame, 'satin', shape='box', t2=0.07, radius=0.02),  # seat post
         rod([0, 0.06, 0.25], [0, 0.95, 0.32], 0.07, frame, 'satin', shape='box', t2=0.07, radius=0.02),   # handle post
         box([0.26, 0.07, 0.3], [0, 0.72, -0.12], '#2A2C30', 'fabric', radius=0.03),                     # saddle (0.75)
         rod([-0.22, 0.98, 0.32], [0.22, 0.98, 0.32], 0.035, '#2A2C30', 'satin'),
         rod([-0.22, 0.98, 0.32], [-0.22, 1.0, 0.18], 0.035, '#2A2C30', 'satin'),
         rod([0.22, 0.98, 0.32], [0.22, 1.0, 0.18], 0.035, '#2A2C30', 'satin'),
         box([0.2, 0.12, 0.04], [0, 1.05, 0.36], '#22252A', 'satin', radius=0.01, rotate=[-30, 0, 0]),     # console
         box([0.16, 0.08, 0.004], [0, 1.05, 0.38], accent, 'gloss', radius=0.004, rotate=[-30, 0, 0]),
         box([0.03, 0.2, 0.05], [0.12, 0.3, 0.1], '#3A3D41', 'metal', radius=0.01),                      # cranks
         box([0.1, 0.03, 0.06], [0.16, 0.2, 0.12], '#2A2C30', 'satin', radius=0.01),
         box([0.1, 0.03, 0.06], [-0.16, 0.4, 0.08], '#2A2C30', 'satin', radius=0.01)]
    return p


add('exerciseBike', placeholder(exercise_bike('#D8D9D7', '#3C8DBF')))


def yoga_mat(color):
    p = [box([0.62, 0.012, 0.9], [0, 0.006, 0.0], color, 'fabric', radius=0.004),
         cyl([0.14, 0.62, 0.14], [0, 0.07, -0.38], color, 'fabric', rotate=[0, 0, 90]),       # rolled end
         box([0.24, 0.12, 0.14], [0.36, 0.06, -0.3], '#E8E2D6', 'fabric', radius=0.04),        # block
         cyl([0.07, 0.24, 0.07], [-0.36, 0.12, -0.3], '#9DC6CF', 'gloss')]                     # bottle
    return p


add('yogaMat', placeholder(yoga_mat('#7FA38A')))
add('yogaMat@modern', placeholder(yoga_mat('#8E979E')))
add('yogaMat@cozy', placeholder(yoga_mat('#C98F6B')))


def dumbbells(frame):
    p = []
    for s in (-1, 1):
        p += [rod([s * 0.36, 0.0, -0.1], [s * 0.36, 0.7, -0.2], 0.05, frame, 'metal', shape='box', t2=0.05, radius=0.01),
              box([0.06, 0.04, 0.4], [s * 0.36, 0.02, -0.15], frame, 'metal', radius=0.01)]
    for y, z in ((0.32, -0.08), (0.58, -0.18)):
        p.append(box([0.78, 0.03, 0.14], [0, y, z], frame, 'metal', radius=0.006, rotate=[-18, 0, 0]))
        for i in range(4):
            x = -0.27 + i * 0.18
            w = 0.1 + i * 0.012
            p += [cyl([0.025, 0.14, 0.025], [x, y + 0.06, z], CHROME, 'chrome', rotate=[0, 0, 90]),
                  cyl([w, 0.04, w], [x - 0.06, y + 0.06, z], '#2F3236', 'satin', rotate=[0, 0, 90], segments=6),
                  cyl([w, 0.04, w], [x + 0.06, y + 0.06, z], '#2F3236', 'satin', rotate=[0, 0, 90], segments=6)]
    p.append(box([0.6, 0.01, 0.4], [0, 0.005, 0.2], '#3A3D41', 'matte', radius=0.004))        # floor mat
    return p


add('dumbbells', placeholder(dumbbells('#5C6168')))

# =============================================================================================
# Decor: wall art, ornaments, rugs and curtains
# =============================================================================================
add('printFramed', wall_gltf(PH + 'hanging_picture_frame_01.glb', [0.5, 0.71, 0.016], 1.15, {'hanging_picture_frame_01_glass': {'hide': True}}))
add('photoPrint', wall_gltf(PH + 'hanging_picture_frame_02.glb', [0.75, 0.5, 0.033], 1.25, {'hanging_picture_frame_02_glass': {'hide': True}}))
add('paintingClassic', wall_gltf(PH + 'fancy_picture_frame_01.glb', [0.84, 0.65, 0.03], 1.15))


def canvas(colors, w=1.5, h=0.9):
    y = 1.05
    z = -0.43
    p = [box([w, h, 0.04], [0, y + h / 2, z + 0.02], '#F4F2EE', 'matte', radius=0.004)]       # stretched canvas
    a, b, c, d = colors
    p += [box([w * 0.5, h * 0.7, 0.004], [-w * 0.18, y + h * 0.45, z + 0.042], a, 'matte', radius=0.004),
          sph([h * 0.5, h * 0.5, 0.006], [w * 0.2, y + h * 0.58, z + 0.044], b, 'matte', segments=20),
          box([w * 0.3, h * 0.18, 0.004], [w * 0.22, y + h * 0.2, z + 0.046], c, 'matte', radius=0.004),
          box([0.02, h * 0.7, 0.004], [-w * 0.02, y + h * 0.5, z + 0.048], d, 'matte', radius=0.002)]
    return placeholder(p)


add('canvasAbstract', canvas((SAGE, MUSTARD, RUST, '#2A2C30')), (2, 1))
add('canvasAbstract@modern', canvas(('#9AA4AB', COGNAC, '#F2F2F0', '#2A2C30')), (2, 1))
add('canvasAbstract@cozy', canvas((CLAY, '#E9C46A', OLIVE, WALNUT)), (2, 1))
add('canvasAbstract@minimal', canvas(('#E6E2DA', '#D9C7A7', '#F2F2F0', '#B9BCBE')), (2, 1))
add('wallClock', wall_gltf(PH + 'wall_clock.glb', [0.36, 0.36, 0.05], 1.72))
add('grandfatherClock', gltf(PH + 'vintage_grandfather_clock_01.glb', [0.58, 2.02, 0.4], offset=[0, 0, 0.04]))


def plinth(h, color, fin='matte', w=0.36):
    return [box([w, h, w], [0, h / 2, 0], color, fin, radius=0.01), box([w + 0.04, 0.03, w + 0.04], [0, h - 0.015, 0], color, fin, radius=0.008),
            box([w + 0.04, 0.04, w + 0.04], [0, 0.02, 0], color, fin, radius=0.008)]


add('vaseTall', gltf(PH + 'ceramic_vase_03.glb', [0.18, 0.66, 0.18], align='centre', parts=[
    rod([0, 0.6, 0], [-0.12, 1.15, 0.04], 0.012, '#8E6E52', 'wood'), rod([0, 0.6, 0], [0.1, 1.2, -0.02], 0.012, '#8E6E52', 'wood'),
    rod([0, 0.6, 0], [0.02, 1.25, 0.08], 0.012, '#8E6E52', 'wood'),
    sph([0.12, 0.08, 0.1], [-0.11, 1.12, 0.04], '#D9C7A7', 'foliage', segments=6),
    sph([0.12, 0.08, 0.1], [0.1, 1.16, -0.02], '#D9C7A7', 'foliage', segments=6),
    sph([0.1, 0.08, 0.1], [0.02, 1.22, 0.08], '#D9C7A7', 'foliage', segments=6)]))
add('urnPorcelain', gltf(PH + 'antique_ceramic_vase_01.glb', [0.36, 0.62, 0.36], align='centre'))
add('vasePedestal', gltf(PH + 'ceramic_vase_02.glb', [0.24, 0.34, 0.24], align='centre', offset=[0, 0.86, 0], parts=plinth(0.86, '#E7E3DC')))
add('vasePedestal@modern', gltf(PH + 'ceramic_vase_02.glb', [0.24, 0.34, 0.24], align='centre', offset=[0, 0.86, 0], parts=plinth(0.86, '#3A3D41')))
add('bustMarble', gltf(PH + 'marble_bust_01.glb', [0.3, 0.57, 0.33], align='centre', offset=[0, 1.0, 0], parts=plinth(1.0, '#E7E3DC', w=0.4)))
add('statueCat', gltf(PH + 'concrete_cat_statue.glb', [0.3, 0.56, 0.5], align='centre'))
add('statueHorse', gltf(PH + 'horse_statue_01.glb', [0.34, 0.46, 0.22], align='centre', offset=[0, 0.92, 0], parts=plinth(0.92, OAK, 'wood', w=0.4)))

RUG_K = lambda a, b: {'carpet': mat('fabric', a), 'carpetDarker': mat('fabric', b)}  # noqa: E731
RUGS = {'': (SAGE, '#7E9271'), '@modern': ('#C9CBCC', '#8E979E'), '@cozy': (RUST, '#8F4F33'), '@minimal': ('#F2F0EA', '#E3DCCF')}
for sfx, (a, b) in RUGS.items():
    add('rugRound' + sfx, gltf(KEN + 'rugRound.glb', [1.9, 0.018, 1.9], RUG_K(a, b), align='centre', offset=[0, 0.012, 0]), (2, 2))
    add('rugLarge' + sfx, gltf(KEN + 'rugRectangle.glb', [2.85, 0.018, 1.85], RUG_K(a, b), align='centre', offset=[0, 0.012, 0]), (3, 2))
    add('rugRunner' + sfx, gltf(KEN + 'rugRectangle.glb', [0.8, 0.018, 2.8], RUG_K(a, b), align='centre', offset=[0, 0.012, 0], rotationY=90), (1, 3))


def rug_pattern(ground, border, motif, accent):
    y = 0.02
    p = [box([2.86, 0.016, 1.86], [0, y, 0], border, 'fabric', radius=0.004),
         box([2.6, 0.017, 1.6], [0, y + 0.001, 0], ground, 'fabric', radius=0.004),
         box([2.4, 0.0175, 0.04], [0, y + 0.0015, -0.7], accent, 'fabric', radius=0.002),
         box([2.4, 0.0175, 0.04], [0, y + 0.0015, 0.7], accent, 'fabric', radius=0.002),
         box([0.04, 0.0175, 1.4], [-1.2, y + 0.0015, 0], accent, 'fabric', radius=0.002),
         box([0.04, 0.0175, 1.4], [1.2, y + 0.0015, 0], accent, 'fabric', radius=0.002),
         box([0.7, 0.018, 0.7], [0, y + 0.002, 0], motif, 'fabric', radius=0.004, rotate=[0, 45, 0]),
         box([0.4, 0.0185, 0.4], [0, y + 0.0025, 0], accent, 'fabric', radius=0.004, rotate=[0, 45, 0])]
    for x in (-0.85, 0.85):
        p.append(box([0.36, 0.018, 0.36], [x, y + 0.002, 0], motif, 'fabric', radius=0.004, rotate=[0, 45, 0]))
    for x in (-1.35, -1.2, -1.05, 1.05, 1.2, 1.35):
        p.append(box([0.03, 0.006, 0.1], [x * 1.04, 0.013, 0.96], border, 'fabric', radius=0.002))   # fringe hint
    return [dict(q, at=[q['at'][0], q['at'][1] - 0.008, q['at'][2]]) for q in p]


add('rugPattern', placeholder(rug_pattern('#B5653F', '#3E5470', '#E9C46A', '#F2E6CC')), (3, 2))
add('rugPattern@modern', placeholder(rug_pattern('#9AA4AB', '#3A3D41', '#E8E6E1', '#C08A52')), (3, 2))
add('rugPattern@minimal', placeholder(rug_pattern('#ECE7DD', '#D9C7A7', '#F2F0EA', '#B9A48C')), (3, 2))


def curtains(color, rod_col, w=0.86, top=2.45, bottom=1.0):
    z = -0.43
    h = top - bottom
    p = [cyl([0.025, w + 0.04, 0.025], [0, top + 0.05, z + 0.08], rod_col, 'metal', rotate=[0, 0, 90]),
         sph([0.05, 0.05, 0.05], [-(w / 2 + 0.03), top + 0.05, z + 0.08], rod_col, 'metal', segments=8),
         sph([0.05, 0.05, 0.05], [w / 2 + 0.03, top + 0.05, z + 0.08], rod_col, 'metal', segments=8)]
    for s in (-1, 1):                                                                      # two gathered panels, pleated
        for i in range(4):
            x = s * (w / 2 - 0.04 - i * 0.055)
            p.append(cyl([0.07, h, 0.06], [x, bottom + h / 2, z + 0.08 + (i % 2) * 0.01], color, 'fabric', segments=10))
    p += [box([0.24, 0.04, 0.03], [s * (w / 2 - 0.12), bottom + h * 0.42, z + 0.12], color, 'fabric', radius=0.015) for s in (-1, 1)]
    return placeholder(p)


add('curtains', curtains(LINEN, BLACKMETAL))
add('curtains@modern', curtains('#B9BCBE', BLACKMETAL))
add('curtains@cozy', curtains('#C98F6B', BRASS))
add('curtains@minimal', curtains('#FAF8F3', '#E3CFA8'))
add('curtainsLong', curtains(LINEN, BLACKMETAL, w=1.8, top=2.55, bottom=0.04), (2, 1))
add('curtainsLong@modern', curtains('#8E979E', BLACKMETAL, w=1.8, top=2.55, bottom=0.04), (2, 1))
add('curtainsLong@cozy', curtains('#8F4F33', BRASS, w=1.8, top=2.55, bottom=0.04), (2, 1))
add('curtainsLong@minimal', curtains('#FAF8F3', '#E3CFA8', w=1.8, top=2.55, bottom=0.04), (2, 1))


def wall_shelf(wood, fin='wood'):
    z = -0.43
    p = [box([0.9, 0.04, 0.24], [0, 1.4, z + 0.12], wood, fin, radius=0.006),
         box([0.9, 0.04, 0.24], [0, 1.78, z + 0.12], wood, fin, radius=0.006)]
    p += books(-0.4, 0.05, 1.42, z + 0.11, 0.18, 2)
    p += [cyl([0.12, 0.12, 0.12], [0.25, 1.48, z + 0.12], '#E8E6E1', 'gloss', taper=0.8),
          sph([0.2, 0.16, 0.18], [0.25, 1.6, z + 0.12], FOLIAGE, 'foliage', segments=8),
          box([0.18, 0.24, 0.02], [-0.25, 1.92, z + 0.06], '#F2F0EA', 'satin', radius=0.006),
          box([0.14, 0.2, 0.004], [-0.25, 1.92, z + 0.072], CLAY, 'matte', radius=0.004),
          cyl([0.1, 0.16, 0.1], [0.05, 1.88, z + 0.12], CREAM, 'gloss', taper=0.7),
          sph([0.12, 0.12, 0.12], [0.3, 1.86, z + 0.12], '#C9B79C', 'matte', segments=10)]
    return placeholder(p)


add('wallShelf', wall_shelf(OAK))
add('wallShelf@modern', wall_shelf('#2F3236', 'satin'))
add('wallShelf@cozy', wall_shelf(WALNUT))
add('wallShelf@minimal', wall_shelf(BIRCH))
add('coatRack', gltf(KEN + 'coatRackStanding.glb', [0.5, 1.8, 0.5], {'wood': mat('wood', OAK)}, align='centre', parts=[
    box([0.3, 0.6, 0.12], [0.12, 1.3, 0.04], '#3E5470', 'fabric', radius=0.05, rotate=[0, 30, 0]),      # coat
    cyl([0.24, 0.12, 0.24], [-0.1, 1.72, -0.06], '#C9B79C', 'fabric', taper=0.8)]))                      # hat


def hanging_plant(pot, cord):
    return placeholder([
        cyl([0.012, 1.0, 0.012], [0, 2.3, 0], cord, 'matte'),
        rod([0, 1.8, 0], [-0.13, 1.42, 0], 0.01, cord, 'matte'), rod([0, 1.8, 0], [0.13, 1.42, 0], 0.01, cord, 'matte'),
        rod([0, 1.8, 0], [0, 1.42, 0.13], 0.01, cord, 'matte'),
        part('lathe', [0.32, 0.24, 0.32], [0, 1.32, 0], pot, 'satin', profile=[[0, -0.5], [0.36, -0.5], [0.5, 0.2], [0.5, 0.5], [0.44, 0.5], [0, 0.0]]),
        part('blob', [0.5, 0.36, 0.5], [0, 1.5, 0], FOLIAGE, 'foliage', noise=0.3),
        part('blob', [0.18, 0.5, 0.2], [0.18, 1.18, 0.08], '#6E9A55', 'foliage', noise=0.35),        # trailing vines
        part('blob', [0.16, 0.42, 0.18], [-0.16, 1.2, -0.06], '#6E9A55', 'foliage', noise=0.35),
    ])


add('hangingPlant', hanging_plant('#F2F0EA', '#C9B79C'))
add('hangingPlant@modern', hanging_plant('#3A3D41', BLACKMETAL))
add('hangingPlant@cozy', hanging_plant(CLAY, '#C9B79C'))

# =============================================================================================
# Lighting
# =============================================================================================
add('ceilingPendant', gltf(PH + 'modern_ceiling_lamp_01.glb', [0.43, 0.95, 0.43], align='centre', offset=[0, CEILING - 0.95, 0]))
add('ceilingLight', gltf(KEN + 'lampSquareCeiling.glb', [0.38, 0.6, 0.38], {
    'lamp': mat('satin', '#FBF4E4'), 'metal': mat('metal', BLACKMETAL)}, align='centre', offset=[0, CEILING - 0.6, 0]))
add('ceilingLight@minimal', gltf(KEN + 'lampSquareCeiling.glb', [0.38, 0.6, 0.38], {
    'lamp': mat('satin', '#FBF4E4'), 'metal': mat('wood', BIRCH)}, align='centre', offset=[0, CEILING - 0.6, 0]))


def ring_chandelier(metal):
    y = 2.05
    p = [cyl([0.16, 0.03, 0.16], [0, CEILING - 0.015, 0], metal, 'metal'),
         cyl([0.012, CEILING - y - 0.03, 0.012], [0, (CEILING + y) / 2, 0], metal, 'metal'),
         torus([0.9, 0.03, 0.9], [0, y, 0], metal, 'metal'),
         torus([0.56, 0.025, 0.56], [0, y + 0.16, 0], metal, 'metal')]
    for i in range(3):
        a = math.radians(i * 120 + 30)
        p.append(rod([0, y + 0.3, 0], [math.cos(a) * 0.44, y, math.sin(a) * 0.44], 0.008, metal, 'metal'))
    for i in range(10):
        a = math.radians(i * 36)
        p.append(sph([0.07, 0.07, 0.07], [math.cos(a) * 0.43, y + 0.05, math.sin(a) * 0.43], BULB, 'gloss', segments=8))
    for i in range(6):
        a = math.radians(i * 60 + 15)
        p.append(sph([0.06, 0.06, 0.06], [math.cos(a) * 0.27, y + 0.2, math.sin(a) * 0.27], BULB, 'gloss', segments=8))
    return placeholder(p)


add('chandelier', ring_chandelier(BRASS))
add('chandelier@modern', ring_chandelier(BLACKMETAL))
add('pendantIndustrial', gltf(PH + 'hanging_industrial_lamp.glb', [0.38, 0.95, 0.38], align='centre', offset=[0, CEILING - 0.95, 0]))
add('ceilingFan', gltf(KEN + 'ceilingFan.glb', [1.2, 0.36, 1.2], {
    'metalLight': mat('satin', '#F2F2F0'), 'lamp': mat('gloss', BULB), 'wood': mat('wood', OAK)}, align='centre',
    offset=[0, CEILING - 0.36, 0], parts=[cyl([0.03, 0.2, 0.03], [0, CEILING - 0.1, 0], '#F2F2F0', 'satin')]))
add('ceilingFan@modern', gltf(KEN + 'ceilingFan.glb', [1.2, 0.36, 1.2], {
    'metalLight': mat('metal', BLACKMETAL), 'lamp': mat('gloss', BULB), 'wood': mat('wood', OAKD)}, align='centre',
    offset=[0, CEILING - 0.36, 0], parts=[cyl([0.03, 0.2, 0.03], [0, CEILING - 0.1, 0], BLACKMETAL, 'metal')]))
def sconce(metal, shade):
    z = -0.43
    return placeholder([
        cyl([0.12, 0.02, 0.12], [0, 1.7, z + 0.01], metal, 'metal', rotate=[90, 0, 0]),          # wall plate
        rod([0, 1.7, z + 0.02], [0, 1.74, z + 0.16], 0.02, metal, 'metal'),
        cyl([0.2, 0.18, 0.2], [0, 1.8, z + 0.17], shade, 'fabric', taper=0.75, segments=20),       # shade
        sph([0.06, 0.06, 0.06], [0, 1.76, z + 0.17], BULB, 'gloss', segments=8)])


add('wallSconce', sconce(BRASS, '#F4EBD8'))
add('wallSconce@modern', sconce(BLACKMETAL, '#FAF8F3'))
add('wallLampArm', wall_gltf(PH + 'industrial_wall_sconce.glb', [0.2, 0.44, 0.33], 1.45))
add('wallLightOutdoor', wall_gltf(PH + 'industrial_wall_lamp.glb', [0.22, 0.34, 0.11], 1.85))
FLOORLAMP_K = lambda metal, mfin, shade: {'metal': mat(mfin, metal), 'lamp': mat('fabric', shade)}  # noqa: E731
add('floorLampSimple', gltf(KEN + 'lampSquareFloor.glb', [0.36, 1.6, 0.36], FLOORLAMP_K(BLACKMETAL, 'metal', '#F4EBD8'), align='centre'))
add('floorLampSimple@cozy', gltf(KEN + 'lampSquareFloor.glb', [0.36, 1.6, 0.36], FLOORLAMP_K(HONEY, 'wood', '#EFD9B4'), align='centre'))
add('floorLampSimple@minimal', gltf(KEN + 'lampSquareFloor.glb', [0.36, 1.6, 0.36], FLOORLAMP_K(BIRCH, 'wood', '#FAF8F3'), align='centre'))
TABLELAMP_K = lambda wood, fin, shade, metal=BRASS: {'wood': mat(fin, wood), '_defaultMat': mat(fin, wood), 'metal': mat('metal', metal),  # noqa: E731
                                                     'lamp': mat('fabric', shade)}
add('tableLamp', gltf(KEN + 'tableLamp.glb', [0.66, 0.92, 0.42], TABLELAMP_K(OAK, 'wood', '#F4EBD8'), align='centre'))
add('tableLamp@modern', gltf(KEN + 'tableLampSquare.glb', [0.66, 0.92, 0.42], TABLELAMP_K('#F1F0EC', 'gloss', '#FAF8F3', BLACKMETAL), align='centre'))
add('tableLamp@cozy', gltf(KEN + 'tableLamp.glb', [0.66, 0.92, 0.42], TABLELAMP_K(WALNUT, 'wood', '#EFD9B4'), align='centre'))
add('tableLamp@minimal', gltf(KEN + 'tableLampSquare.glb', [0.66, 0.92, 0.42], TABLELAMP_K(BIRCH, 'wood', '#FAF8F3', '#F2F2F0'), align='centre'))

# =============================================================================================
# Outdoor
# =============================================================================================
def grill(body):
    p = [part('lathe', [0.6, 0.36, 0.6], [0, 0.82, 0], body, 'gloss',
              profile=[[0, -0.5], [0.3, -0.45], [0.48, -0.1], [0.5, 0.5], [0, 0.5]], segments=24),       # bowl
         part('lathe', [0.6, 0.3, 0.6], [0, 1.1, -0.06], body, 'gloss',
              profile=[[0.5, -0.5], [0.46, 0.1], [0.3, 0.42], [0, 0.5], [0, -0.5]], segments=24, rotate=[-35, 0, 0]),  # lid, open
         cyl([0.56, 0.01, 0.56], [0, 0.995, 0], '#3A3D41', 'metal', segments=24),
         box([0.12, 0.03, 0.06], [0, 1.0, 0.25], '#2A2C30', 'satin', radius=0.01)]
    for a in (90, 210, 330):
        r = math.radians(a)
        p.append(rod([math.cos(r) * 0.12, 0.66, math.sin(r) * 0.12], [math.cos(r) * 0.32, 0.0, math.sin(r) * 0.32], 0.04, '#3A3D41', 'metal'))
    p += [cyl([0.16, 0.06, 0.16], [0.18, 0.08, 0.18], '#2A2C30', 'satin', rotate=[90, 0, 0]),              # wheels
          sph([0.1, 0.06, 0.07], [-0.1, 1.02, 0.05], '#8E3F2E', 'satin', segments=8),                       # sausages / burgers
          sph([0.1, 0.06, 0.07], [0.08, 1.02, -0.05], '#8E3F2E', 'satin', segments=8)]
    return p


add('grill', placeholder(grill('#2A2C30')))
add('grill@cozy', placeholder(grill('#8E2A2A')))


def grill_station(steel, wood):
    p = [box([1.6, 0.86, 0.6], [0, 0.45, -0.14], steel, 'metal', radius=0.015),
         box([1.66, 0.04, 0.66], [0, 0.9, -0.12], '#3A3D41', 'satin', radius=0.01),
         box([0.9, 0.3, 0.5], [0.0, 1.06, -0.14], steel, 'metal', radius=0.04),                    # grill hood (closed)
         box([0.7, 0.03, 0.03], [0, 1.0, 0.13], CHROME, 'chrome', radius=0.01),
         box([0.12, 0.08, 0.04], [0, 1.2, 0.12], '#9AA4AB', 'gloss', radius=0.02),                  # thermometer
         box([0.36, 0.02, 0.4], [-0.62, 0.93, -0.12], wood, 'wood', radius=0.006),                  # side boards
         box([0.36, 0.02, 0.4], [0.62, 0.93, -0.12], wood, 'wood', radius=0.006)]
    for x in (-0.4, 0.4):
        p.append(box([0.64, 0.6, 0.02], [x, 0.42, 0.165], steel, 'metal', radius=0.01))
    for x in (-0.3, -0.1, 0.1, 0.3):
        p.append(cyl([0.05, 0.03, 0.05], [x, 0.82, 0.18], '#2A2C30', 'satin', rotate=[90, 0, 0]))  # knobs
    p += [box([0.24, 0.12, 0.16], [-0.62, 1.0, -0.12], '#E9E6E0', 'gloss', radius=0.02),            # tray of food
          cyl([0.14, 0.24, 0.14], [0.62, 1.06, -0.15], '#6FA6D9', 'gloss')]
    return p


add('grillStation', placeholder(grill_station(STEEL, OAK)), (2, 1))
add('patioSet', gltf(PH + 'outdoor_table_chair_set_01.glb', [0.7, 0.82, 1.62], align='centre'), (1, 2))
add('picnicTable', gltf(PH + 'wooden_picnic_table.glb', [2.57, 0.63, 1.9], align='centre', rotationY=90), (3, 2))


def sun_lounger(frame, pad, ffin='wood'):
    p = [box([0.62, 0.06, 1.3], [0, 0.26, 0.28], frame, ffin, radius=0.01),
         box([0.56, 0.06, 1.24], [0, 0.32, 0.28], pad, 'fabric', radius=0.03)]                       # pad (top 0.35)
    p += [box([0.62, 0.06, 0.66], [0, 0.46, -0.6], frame, ffin, radius=0.01, rotate=[35, 0, 0]),
          box([0.56, 0.06, 0.62], [0, 0.51, -0.58], pad, 'fabric', radius=0.03, rotate=[35, 0, 0]),
          cushion([0.44, 0.1, 0.2], [0, 0.68, -0.8], '#FFFFFF', rotate=[35, 0, 0])]
    for x in (-0.28, 0.28):
        for z in (-0.3, 0.86):
            p.append(box([0.05, 0.24, 0.05], [x, 0.12, z], frame, ffin, radius=0.008))
    p += [box([0.4, 0.02, 0.3], [0, 0.36, 0.7], '#E9853B', 'fabric', radius=0.01)]                     # folded towel
    return p


add('sunLounger', placeholder(sun_lounger(OAK, '#E8E2D6')), (1, 2))
add('sunLounger@modern', placeholder(sun_lounger('#3A3D41', '#C9CBCC', 'metal')), (1, 2))
add('sunLounger@cozy', placeholder(sun_lounger(HONEY, '#C98F6B')), (1, 2))


def hammock_stand(frame, cloth, stripe):
    """A hammock on its own stand, lying along Z (head at -Z); the sling sags to ~0.62 m."""
    p = [box([0.1, 0.06, 1.86], [0, 0.03, 0], frame, 'wood', radius=0.01)]
    for s in (-1, 1):
        p += [rod([0, 0.03, s * 0.9], [0, 1.15, s * 0.86], 0.08, frame, 'wood', shape='box', t2=0.08, radius=0.015),
              box([0.7, 0.04, 0.08], [0, 0.02, s * 0.86], frame, 'wood', radius=0.01)]
    n = 6
    for i in range(n):
        z0, z1 = -0.7 + i * 1.4 / n, -0.7 + (i + 1) * 1.4 / n
        y0 = 0.62 + 0.25 * ((z0 / 0.7) ** 2)
        y1 = 0.62 + 0.25 * ((z1 / 0.7) ** 2)
        ang = -math.degrees(math.atan2(y1 - y0, z1 - z0))
        p.append(box([0.62, 0.03, math.hypot(z1 - z0, y1 - y0) + 0.01], [0, (y0 + y1) / 2, (z0 + z1) / 2], cloth if i % 2 else stripe,
                     'fabric', radius=0.01, rotate=[ang, 0, 0]))
    for s in (-1, 1):
        p.append(rod([0, 0.87, s * 0.7], [0, 1.1, s * 0.86], 0.015, '#E8E2D6', 'matte'))
    p.append(cushion([0.4, 0.08, 0.3], [0, 0.8, -0.56], '#FFFFFF'))
    return p


add('hammock', placeholder(hammock_stand('#B08E66', '#E8E2D6', '#4E7A7F')), (1, 2))
add('hammock@cozy', placeholder(hammock_stand('#8E6E52', '#EFE5D3', RUST)), (1, 2))


def hot_tub(wood, water='#6FC3CF'):
    p = [cyl([1.84, 0.82, 1.84], [0, 0.41, 0], wood, 'wood', segments=32),
         torus([1.86, 0.08, 1.86], [0, 0.82, 0], wood, 'wood', segments=32),
         cyl([1.62, 0.02, 1.62], [0, 0.74, 0], water, 'glass', segments=32),
         cyl([1.6, 0.02, 1.6], [0, 0.68, 0], '#9ED6DE', 'gloss', segments=32)]
    for y in (0.2, 0.6):
        p.append(torus([1.88, 0.03, 1.88], [0, y, 0], '#3A3D41', 'metal', segments=32))           # hoops
    p += [box([0.6, 0.2, 0.3], [0.0, 0.1, 0.8], wood, 'wood', radius=0.01),                       # step
          box([0.4, 0.08, 0.3], [0.62, 0.86, 0.5], '#FFFFFF', 'fabric', radius=0.03),             # towels
          cyl([0.08, 0.16, 0.08], [-0.6, 0.9, 0.5], '#E9C46A', 'glass')]
    return p


add('hotTubCedar', placeholder(hot_tub('#A9744E')), (2, 2))


def swing_set(frame, seat):
    p = []
    for s in (-1, 1):
        p += [rod([s * 0.92, 0.0, -0.42], [s * 0.92, 1.9, 0], 0.07, frame, 'wood'),
              rod([s * 0.92, 0.0, 0.42], [s * 0.92, 1.9, 0], 0.07, frame, 'wood')]
    p.append(cyl([0.09, 1.92, 0.09], [0, 1.92, 0], frame, 'wood', rotate=[0, 0, 90]))
    for x in (-0.48, 0.48):
        p += [cyl([0.012, 1.4, 0.012], [x - 0.17, 1.2, 0], '#C9CBCC', 'metal'),
              cyl([0.012, 1.4, 0.012], [x + 0.17, 1.2, 0], '#C9CBCC', 'metal'),
              box([0.42, 0.04, 0.2], [x, 0.48, 0], seat, 'satin', radius=0.02)]                      # seat (0.5)
    return p


add('swingSet', placeholder(swing_set('#B08E66', '#D9483B')), (2, 1))


def sandbox():
    p = []
    for z, w, d in ((-0.92, 1.88, 0.08), (0.92, 1.88, 0.08)):
        p.append(box([w, 0.26, d], [0, 0.13, z], '#C9A27A', 'wood', radius=0.01))
    for x in (-0.92, 0.92):
        p.append(box([0.08, 0.26, 1.88], [x, 0.13, 0], '#C9A27A', 'wood', radius=0.01))
    p += [box([1.78, 0.18, 1.78], [0, 0.09, 0], '#E9D5A8', 'matte', radius=0.02),
          part('blob', [0.5, 0.2, 0.4], [-0.3, 0.2, 0.2], '#E3CC9A', 'matte', noise=0.15),
          lathe([0.22, 0.18, 0.22], [0.3, 0.27, -0.2], '#D9483B', 'satin', [[0, -0.5], [0.36, -0.5], [0.5, 0.5], [0, 0.5]]),     # bucket
          box([0.1, 0.02, 0.3], [0.45, 0.2, 0.2], '#3E8EDE', 'satin', radius=0.01, rotate=[0, 30, 0]),
          lathe([0.2, 0.18, 0.2], [-0.32, 0.36, 0.2], '#E3CC9A', 'matte', [[0, -0.5], [0.5, -0.5], [0.42, 0.5], [0, 0.5]])]     # sandcastle
    return p


add('sandbox', placeholder(sandbox()), (2, 2))


def bike_rack(frame, bike):
    p = [box([1.8, 0.05, 0.12], [0, 0.025, -0.3], frame, 'metal', radius=0.01)]
    for x in (-0.6, -0.2, 0.2, 0.6):
        p.append(torus([0.4, 0.04, 0.02], [x, 0.24, -0.3], frame, 'metal', rotate=[90, 0, 0], segments=16))
    # A bicycle leaning in the rack, along x.
    for x in (-0.55, 0.45):
        p += [torus([0.62, 0.04, 0.62], [x, 0.33, 0.05], '#2A2C30', 'satin', rotate=[90, 0, 0], segments=24),
              cyl([0.04, 0.04, 0.04], [x, 0.33, 0.05], '#C9CBCC', 'metal', rotate=[90, 0, 0])]
    p += [rod([-0.55, 0.33, 0.05], [-0.1, 0.33, 0.05], 0.03, bike, 'gloss'),
          rod([-0.1, 0.33, 0.05], [0.25, 0.68, 0.05], 0.035, bike, 'gloss'),
          rod([-0.1, 0.33, 0.05], [-0.25, 0.7, 0.05], 0.03, bike, 'gloss'),
          rod([-0.25, 0.7, 0.05], [0.25, 0.68, 0.05], 0.035, bike, 'gloss'),
          rod([-0.55, 0.33, 0.05], [-0.25, 0.7, 0.05], 0.025, bike, 'gloss'),
          rod([0.45, 0.33, 0.05], [0.3, 0.78, 0.05], 0.03, bike, 'gloss'),
          box([0.22, 0.05, 0.1], [-0.27, 0.76, 0.05], '#2A2C30', 'fabric', radius=0.02),
          rod([0.3, 0.84, -0.12], [0.3, 0.84, 0.22], 0.025, '#2A2C30', 'satin')]
    return p


add('bikeRack', placeholder(bike_rack('#5C6168', '#3E8EDE')), (2, 1))


def fire_pit(stone):
    p = [cyl([0.86, 0.3, 0.86], [0, 0.15, 0], stone, 'matte', segments=20),
         cyl([0.66, 0.02, 0.66], [0, 0.305, 0], '#2A2624', 'matte', segments=20)]
    for i in range(10):
        a = math.radians(i * 36)
        p.append(box([0.2, 0.08, 0.14], [math.cos(a) * 0.38, 0.34, math.sin(a) * 0.38], stone, 'matte', radius=0.03,
                     rotate=[0, -i * 36, 0]))
    for r in (0, 60, 120):
        p.append(cyl([0.08, 0.5, 0.08], [0, 0.36, 0], '#6B4A33', 'bark', rotate=[0, r, 80]))
    p += [part('blob', [0.36, 0.3, 0.36], [0, 0.48, 0], '#FF9A3C', 'gloss', noise=0.3),
          part('blob', [0.2, 0.36, 0.2], [0.03, 0.56, 0.0], '#FFD27A', 'gloss', noise=0.3)]
    return p


add('firePit', placeholder(fire_pit('#8E8A84')))


def garden_chair(wood):
    p = []
    for x in (-0.24, -0.12, 0.0, 0.12, 0.24):                                                  # slatted back, reclined
        p.append(box([0.1, 0.8, 0.025], [x, 0.66, -0.28], wood, 'satin', radius=0.01, rotate=[-22, 0, 0]))
    for z in (-0.12, 0.0, 0.12, 0.24):
        p.append(box([0.56, 0.025, 0.1], [0, 0.4 - z * 0.15, z], wood, 'satin', radius=0.008))   # seat slats (~0.4)
    for s in (-1, 1):
        p += [box([0.12, 0.025, 0.66], [s * 0.36, 0.62, -0.02], wood, 'satin', radius=0.01),       # wide arms
              box([0.06, 0.62, 0.06], [s * 0.36, 0.31, 0.26], wood, 'satin', radius=0.01),
              box([0.06, 0.4, 0.06], [s * 0.32, 0.2, -0.24], wood, 'satin', radius=0.01)]
    p.append(cyl([0.12, 0.1, 0.12], [0.36, 0.68, 0.18], '#E8E2D6', 'gloss'))                   # cup on the arm
    return p


add('gardenChair', placeholder(garden_chair('#F2F0EA')))
add('gardenChair@modern', placeholder(garden_chair('#5C6168')))
add('gardenChair@cozy', placeholder(garden_chair('#4E7A7F')))


def lamp_post(metal):
    return placeholder([
        cyl([0.3, 0.12, 0.3], [0, 0.06, 0], metal, 'metal', taper=0.7),
        cyl([0.07, 2.0, 0.07], [0, 1.1, 0], metal, 'metal'),
        cyl([0.12, 0.06, 0.12], [0, 2.1, 0], metal, 'metal'),
        box([0.26, 0.34, 0.26], [0, 2.3, 0], BULB, 'glass', radius=0.01),
        sph([0.12, 0.12, 0.12], [0, 2.28, 0], BULB, 'gloss', segments=10),
        cone([0.38, 0.14, 0.38], [0, 2.53, 0], metal, 'metal', taper=0.2, segments=4, rotate=[0, 45, 0]),
    ])


add('lampPost', lamp_post('#2F3236'))


def string_lights(post):
    p = []
    for s in (-1, 1):
        p += [box([0.08, 2.4, 0.08], [s * 0.88, 1.2, 0], post, 'wood', radius=0.01),
              cyl([0.24, 0.3, 0.24], [s * 0.88, 0.15, 0], '#8E8A84', 'matte', taper=0.8)]           # weighted planters
    n = 8
    for i in range(n):
        x0, x1 = -0.84 + i * 1.68 / n, -0.84 + (i + 1) * 1.68 / n
        y0 = 2.25 - 0.3 * (1 - (x0 / 0.84) ** 2)
        y1 = 2.25 - 0.3 * (1 - (x1 / 0.84) ** 2)
        p.append(rod([x0, y0, 0], [x1, y1, 0], 0.008, '#2A2C30', 'matte'))
        xm = (x0 + x1) / 2
        p.append(sph([0.07, 0.09, 0.07], [xm, (y0 + y1) / 2 - 0.07, 0], BULB, 'gloss', segments=8))
    return p


add('stringLights', placeholder(string_lights('#8E6E52')), (2, 1))

# =============================================================================================
# Validation (footprint bounds, finishes) and output
# =============================================================================================
# Things on a wall or the ceiling may reach past their tiles (a ceiling fan's blades).
MOUNTED = {'ceilingFan', 'chandelier', 'ceilingPendant', 'ceilingLight', 'pendantIndustrial', 'hangingPlant'}
FINISHES = {'material.finish.' + f for f in 'matte satin gloss metal chrome fabric wood bark foliage skin glass'.split()}


def main(path):
    bad = 0
    for k, e in E.items():
        fp = FOOT[k]
        issues = []
        parts = e.get('parts', []) if 'url' in e else e['placeholder']
        hung = k.split('@')[0].split('.', 1)[1] in MOUNTED
        for p in parts:
            q = dict(p, shape='cylinder') if p['shape'] in ('lathe', 'torus') else p
            issues += [i for i in OX.validate(k, [q], fp) if 'finishes (max 4)' not in i and 'exceeds' not in i and 'below floor' not in i]
            lo, hi = OX.bounds(q)
            if lo[1] < -0.015: issues.append(f'part {p["shape"]} at {p["at"]} below the floor')
            if not hung and lo[0] < -fp[0] / 2 - 0.02 or hi[0] > fp[0] / 2 + 0.02 or lo[2] < -fp[1] / 2 - 0.02 or hi[2] > fp[1] / 2 + 0.02:
                issues.append(f'part {p["shape"]} at {p["at"]} leaves the {fp} footprint')
        if 'fit' in e:
            w, h, d = e['fit']
            if not hung and (w > fp[0] + 1e-6 or d > fp[1] + 1e-6): issues.append(f'fit {e["fit"]} exceeds footprint {fp}')
            for name, m in (e.get('materials') or {}).items():
                if 'finish' in m and m['finish'] not in FINISHES: issues.append(f'{name}: bad finish {m["finish"]}')
        for s in issues: print(f'  ! {k}: {s}')
        bad += len(issues)
    lines = []
    for k, e in E.items():
        e = dict(e)
        if 'url' in e: e['url'] = '../' + e['url']
        lines.append(f'    {json.dumps(k)}: {json.dumps(e, separators=(",", ":"))}')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write('{\n  "$comment": "Furniture, lighting, decor, kids\' and garden things of the 0.20 catalogue (content/furniture.json), '
                'written by tools/art/catalog.py. Listed in the base manifest\'s packs.",\n  "version": 1,\n  "entries": {\n')
        f.write(',\n'.join(lines) + '\n  }\n}\n')
    json.load(open(path))
    print(f'{len(E)} entries ({len({k.split("@")[0] for k in E})} models) -> {path}; {bad} issue(s)')
    return bad


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'public', 'assets', 'catalog', 'manifest.json')
    sys.exit(1 if main(os.path.normpath(sys.argv[1] if len(sys.argv) > 1 else out)) else 0)
