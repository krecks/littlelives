# Furniture entries for the base objects and their style variants (`model.<key>[@modern|@cozy|@minimal]`).
#
# Sources: the optimised model library built by build_library.py (models/kenney/*.glb: Kenney Furniture
# Kit, models/ph/*.glb: Poly Haven; all CC0) restyled with the game's finishes through the manifest
# (`fit`, `materials`, `parts`; see render/babylon/models.ts), plus primitive-part models from
# objects_extra.py (kept, recoloured or rebuilt here).
#
# Style direction (price/behaviour never change with style):
#   modern  = clean lines, light greys and white, white oak, black-metal accents (never a black body)
#   cozy    = warm woods, cream and earthy fabrics, rounded, patterns
#   minimal = white, birch, pale linen, thin and simple
#
# Gameplay geometry (sim-core world.rs + render/babylon/characters.ts): seated and lying Sims are
# spread across the width per slot ((slot - (n-1)/2) * width / n) and face the object's front (+Z);
# lying Sims have their head towards -Z. characters.ts places hips per object (`SEATS`/`BEDS`: seat
# height and forward offset). Seats here are ~0.44 m, mattresses ~0.56-0.6 m, the weight bench pad
# 0.5 m. Desks, pianos, chess and dining tables put the user's chair at the back half (seat centre
# z ~ -0.2) facing a work surface whose near edge is at z ~ +0.08.
#
# Run: python3 -I furniture.py [out.json]   then   python3 -I apply_entries.py ../../web/public/assets/manifest.json out.json
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import objects_extra as OX                                     # noqa: E402  (placeholder designs + helpers)
from objects_extra import box, cyl, cone, sph, rod, part, on   # noqa: E402

F = 'material.finish.'
E = {}

# ---- palette ------------------------------------------------------------------------------
WHITE, OFFWHITE, LGREY, MGREY = '#F2F2F0', '#ECEAE5', '#D3D4D2', '#A9ADB0'
OAK, OAKD = '#CDB08A', '#B08E66'          # white oak (modern)
BIRCH = '#E3CFA8'                         # minimal
HONEY, WALNUT = '#A8754A', '#7A5234'      # cozy
BLACKMETAL, STEEL, CHROME, BRASS = '#2B2C2E', '#C3C7CB', '#D0D3D6', '#B8925A'
TEAL, COGNAC, MUSTARD, SAGE, RUST, CREAM = '#4E7A7F', '#C08A52', '#D6A64A', '#9DAF8C', '#B5653F', '#EFE5D3'
SCREEN = '#16202B'


def lathe(size, at, color, finish, profile, **kw):
    return part('lathe', size, at, color, finish, profile=[[round(r, 4), round(y, 4)] for r, y in profile], **kw)


def torus(size, at, color, finish, **kw):
    return part('torus', size, at, color, finish, **kw)


def cushion(size, at, color, finish='fabric', **kw):
    kw.setdefault('radius', round(min(size) * 0.42, 3))
    return box(size, at, color, finish, **kw)


def mat(finish, color, **kw):
    d = {'finish': F + finish, 'color': color}
    d.update(kw)
    return d


def gltf(url, fit, materials=None, parts=None, align='back', offset=None, rotationY=None, placeholder=None, footprint=(1, 1)):
    e = {'type': 'model', 'url': url, 'fit': [round(v, 4) for v in fit]}
    if align != 'centre': e['align'] = align
    if offset: e['offset'] = offset
    if rotationY: e['rotationY'] = rotationY
    if materials: e['materials'] = materials
    if parts: e['parts'] = parts
    e['placeholder'] = placeholder or [box([fit[0] * 0.95, fit[1], fit[2] * 0.95], [0, fit[1] / 2, -footprint[1] / 2 + 0.04 + fit[2] / 2 if align == 'back' else 0], LGREY, 'satin', radius=0.02)]
    return e


def placeholder(parts):
    return {'type': 'model', 'placeholder': parts}


def recolor(parts, mapping):
    """Copy of parts with colours (and optionally finishes) replaced: {old: new | (new, finish)}."""
    out = []
    for p in parts:
        q = json.loads(json.dumps(p))
        m = mapping.get(p['color'].upper()) or mapping.get(p['color'])
        if m:
            if isinstance(m, tuple):
                q['color'], q['material'] = m[0], F + m[1]
            else:
                q['color'] = m
        out.append(q)
    return out


def shift(parts, dx=0.0, dy=0.0, dz=0.0, when=lambda p: True):
    out = []
    for p in parts:
        q = json.loads(json.dumps(p))
        if when(p): q['at'] = [round(q['at'][0] + dx, 4), round(q['at'][1] + dy, 4), round(q['at'][2] + dz, 4)]
        out.append(q)
    return out


KEN, PH = 'models/kenney/', 'models/ph/'

# =============================================================================================
# Fridge (1x1)
# =============================================================================================
E['model.fridge'] = gltf(KEN + 'kitchenFridge.glb', [0.74, 1.8, 0.68], {
    'metalLight': mat('gloss', '#F3F3F1'), 'metalDark': mat('satin', '#B9BCBF'),
    'metal': mat('chrome', CHROME), 'glass': mat('gloss', '#DADDE0')}, offset=[0, 0, 0.04])
E['model.fridge@modern'] = gltf(KEN + 'kitchenFridgeLarge.glb', [0.88, 1.84, 0.7], {
    'metalLight': mat('metal', STEEL), 'metalMedium': mat('satin', '#3A3D41')}, offset=[0, 0, 0.04])
E['model.fridge@cozy'] = placeholder(OX.M['model.fridge@cozy'])
E['model.fridge@minimal'] = gltf(KEN + 'kitchenFridge.glb', [0.7, 1.86, 0.66], {
    'metalLight': mat('satin', '#F4F3EF'), 'metalDark': mat('satin', '#E4E1DA'),
    'metal': mat('wood', BIRCH), 'glass': mat('satin', '#ECEAE5')}, offset=[0, 0, 0.04])

# =============================================================================================
# Sink (1x1): a vanity / kitchen sink cabinet (used in both rooms), worktop at 0.9 m
# =============================================================================================
SINK = KEN + 'kitchenSink.glb'
# Kenney kitchenSink materials: wood = cabinet, woodDark = door frame, metal = worktop + basin + pull,
# metalLight = tap, metalDark / _defaultMat = drain details.
E['model.sink'] = gltf(SINK, [0.86, 0.92, 0.62], {
    'wood': mat('satin', '#EDEBE6'), 'woodDark': mat('satin', '#E0DDD6'), 'metal': mat('gloss', '#DCDDDA'),
    'metalDark': mat('metal', '#AEB3B8'), 'metalLight': mat('chrome', CHROME), '_defaultMat': mat('metal', '#8E9196')},
    offset=[0, 0, 0.04])
E['model.sink@modern'] = gltf(SINK, [0.88, 0.92, 0.62], {
    'wood': mat('satin', '#C9CBCC'), 'woodDark': mat('wood', OAK), 'metal': mat('gloss', '#F4F4F2'),
    'metalDark': mat('metal', '#AEB3B8'), 'metalLight': mat('metal', BLACKMETAL), '_defaultMat': mat('metal', '#6E7277')},
    offset=[0, 0, 0.04], parts=[
        box([0.18, 0.13, 0.13], [0.3, 0.985, -0.18], '#E8E6E1', 'gloss', radius=0.05),          # soap dispenser jar
        cyl([0.07, 0.16, 0.07], [-0.3, 1.0, -0.2], TEAL, 'gloss', taper=0.8),                  # bottle
    ])
E['model.sink@cozy'] = placeholder(OX.M['model.sink@cozy'])
E['model.sink@minimal'] = placeholder(OX.M['model.sink@minimal'])

# =============================================================================================
# Toilet (1x1): the Sim sits at the centre facing +Z (seat top ~0.44 m)
# =============================================================================================
# Kenney toilet: carpetWhite = body, _defaultMat = seat, metalLight = flush lever.
E['model.toilet'] = gltf(KEN + 'toilet.glb', [0.44, 0.8, 0.72], {
    '*': mat('gloss', '#F6F6F4'), 'metalLight': mat('chrome', CHROME), '_defaultMat': mat('gloss', '#EFEFEC')},
    offset=[0, 0, 0.06])
E['model.toilet@modern'] = placeholder(recolor(OX.M['model.toilet@modern'], {
    '#3A3C40': ('#D9D8D4', 'satin'), '#1E1F21': '#F6F6F4', '#2A2B2E': '#F0F0EE'}))
E['model.toilet@cozy'] = placeholder(OX.M['model.toilet@cozy'])
E['model.toilet@minimal'] = placeholder(OX.M['model.toilet@minimal'])

# =============================================================================================
# Shower (1x1)
# =============================================================================================
E['model.shower'] = gltf(KEN + 'shower.glb', [0.9, 2.15, 0.9], {
    'carpetWhite': mat('gloss', '#F4F4F2'), 'metalDark': mat('chrome', CHROME), 'glass': mat('glass', '#DCE6E8'),
    'metal': mat('chrome', CHROME)}, align='centre')
E['model.shower@modern'] = gltf(KEN + 'shower.glb', [0.9, 2.15, 0.9], {
    'carpetWhite': mat('satin', '#E4E3DF'), 'metalDark': mat('metal', BLACKMETAL), 'glass': mat('glass', '#DCE6E8'),
    'metal': mat('metal', BLACKMETAL)}, align='centre', parts=[
        box([0.2, 0.012, 0.6], [0, 0.012, 0.0], OAK, 'wood', radius=0.004),                   # teak duckboard
        box([0.2, 0.012, 0.6], [0.22, 0.012, 0.0], OAK, 'wood', radius=0.004),
        box([0.2, 0.012, 0.6], [-0.22, 0.012, 0.0], OAK, 'wood', radius=0.004),
    ])
E['model.shower@cozy'] = placeholder(OX.M['model.shower@cozy'])
E['model.shower@minimal'] = gltf(KEN + 'showerRound.glb', [0.9, 2.1, 0.9], {
    '*': mat('satin', '#F4F3EF'), 'glass': mat('glass', '#E2EAEA'), 'metalDark': mat('chrome', CHROME),
    'carpetWhite': mat('chrome', CHROME)}, align='centre')

# =============================================================================================
# Sofa (2x1, 2 seats at x = +-0.5): seat ~0.44 m
# =============================================================================================
E['model.sofa'] = gltf(PH + 'Sofa_01.glb', [1.86, 0.92, 0.86], align='back', offset=[0, 0, 0.04], footprint=(2, 1),
                       placeholder=OX.M['model.sofa@minimal'])
E['model.sofa@modern'] = placeholder(recolor(OX.M['model.sofa@modern'], {
    '#3A3C40': '#B9BCBE', '#46494E': '#C9CBCC', '#8A8F96': TEAL, '#B0B4BA': COGNAC,
    '#D0D3D6': (BLACKMETAL, 'metal')}))
E['model.sofa@cozy'] = placeholder(OX.M['model.sofa@cozy'])
E['model.sofa@minimal'] = placeholder(OX.M['model.sofa@minimal'])

# =============================================================================================
# TV (1x1): screen on a low media unit, facing +Z
# =============================================================================================
def tv_set(stand, top, screen_back='#2A2C30'):
    w = 0.9
    p = [
        box([w, 0.4, 0.42], [0, 0.24, -0.22], stand, 'wood', radius=0.012),                   # unit
        box([w + 0.01, 0.03, 0.43], [0, 0.455, -0.22], top, 'wood', radius=0.008),            # top board
        box([0.43, 0.3, 0.012], [-0.225, 0.24, -0.006], top, 'wood', radius=0.006),            # doors
        box([0.43, 0.3, 0.012], [0.225, 0.24, -0.006], top, 'wood', radius=0.006),
        box([0.012, 0.12, 0.016], [-0.02, 0.24, 0.004], BLACKMETAL, 'metal', radius=0.004),   # pulls
        box([0.012, 0.12, 0.016], [0.02, 0.24, 0.004], BLACKMETAL, 'metal', radius=0.004),
    ]
    for x in (-0.42, 0.42):
        for z in (-0.4, -0.04):
            p.append(box([0.03, 0.06, 0.03], [x, 0.03, z], BLACKMETAL, 'metal', radius=0.006))  # feet
    p += [
        box([0.86, 0.5, 0.035], [0, 0.82, -0.3], screen_back, 'satin', radius=0.012),         # TV body
        box([0.835, 0.475, 0.004], [0, 0.82, -0.2815], SCREEN, 'gloss', radius=0.004),         # screen
        box([0.24, 0.012, 0.16], [0, 0.476, -0.3], screen_back, 'satin', radius=0.004),        # stand foot
        box([0.05, 0.1, 0.03], [0, 0.53, -0.31], screen_back, 'satin', radius=0.006),
        box([0.5, 0.05, 0.07], [0, 0.5, -0.12], '#3A3D41', 'satin', radius=0.02),             # soundbar
        cyl([0.12, 0.012, 0.12], [0.33, 0.476, -0.08], '#F2F2F0', 'gloss'),                     # coaster/bowl
        sph([0.1, 0.08, 0.1], [0.33, 0.51, -0.08], '#E9E6E0', 'gloss', segments=10),
    ]
    return p


E['model.tv'] = placeholder(tv_set(OAKD, OAK))
E['model.tv@modern'] = placeholder(recolor(OX.M['model.tv@modern'], {
    '#151618': ('#F2F1EE', 'gloss'), '#0E0F10': (OAK, 'wood'), '#1C1D20': (OAK, 'wood'),
    '#1E1F22': '#3A3D41', '#26282B': '#3A3D41'}))
E['model.tv@cozy'] = gltf(PH + 'tv_crt_side_table.glb', [0.62, 0.94, 0.5], offset=[0, 0, 0.06],
                         placeholder=OX.M['model.tv@cozy'], parts=[
                             box([0.5, 0.012, 0.3], [0.0, 0.006, 0.18], RUST, 'fabric', radius=0.004)])
E['model.tv@minimal'] = placeholder(OX.M['model.tv@minimal'])

# =============================================================================================
# Bookshelf (1x1)
# =============================================================================================
E['model.bookshelf@modern'] = placeholder(recolor(OX.M['model.bookshelf@modern'], {
    '#3B302A': (OAK, 'wood'), '#1E1F22': '#E9E4DA', '#3A3C40': '#C77D4F', '#2F3A4E': TEAL, '#6B7079': MUSTARD}))
E['model.bookshelf@cozy'] = placeholder(OX.M['model.bookshelf@cozy'])

# =============================================================================================
# Armchair (1x1): one seat at the centre
# =============================================================================================
E['model.armchair'] = gltf(PH + 'ArmChair_01.glb', [0.8, 0.98, 0.82], align='back', offset=[0, 0, 0.05],
                           placeholder=OX.M['model.armchair@cozy'])
E['model.armchair@modern'] = placeholder(recolor(OX.M['model.armchair@modern'], {
    '#1E1F22': ('#BFC2C4', 'fabric'), '#2A2B2E': ('#D2D4D5', 'fabric'), '#6B7079': COGNAC}))
E['model.armchair@cozy'] = placeholder(OX.M['model.armchair@cozy'])
E['model.armchair@minimal'] = placeholder(OX.M['model.armchair@minimal'])

# =============================================================================================
# Plant (1x1)
# =============================================================================================
E['model.plant'] = gltf(PH + 'potted_plant_02.glb', [0.62, 0.82, 0.62], align='centre', placeholder=OX.M['model.plant@cozy'])
E['model.plant@modern'] = placeholder(recolor(OX.M['model.plant@modern'], {
    '#1C1D20': ('#E8E6E1', 'satin'), '#26282B': ('#D5D2CB', 'satin')}))
E['model.plant@cozy'] = gltf(PH + 'potted_plant_01.glb', [0.66, 0.78, 0.66], align='centre', placeholder=OX.M['model.plant@cozy'],
                            parts=[cyl([0.5, 0.06, 0.5], [0, 0.03, 0], HONEY, 'wood', segments=20)])
E['model.plant@minimal'] = placeholder(OX.M['model.plant@minimal'])

# =============================================================================================
# Double bed (2x2): two Sims side by side (x = +-0.5), head at -Z, mattress top ~0.6 m
# =============================================================================================
E['model.bed@modern'] = placeholder(recolor(OX.M['model.bed@modern'], {
    '#141517': (BLACKMETAL, 'metal'), '#2E3034': '#C4C0B8', '#3A3D42': '#B8B3AA', '#E3E4E6': '#F2F2F0',
    '#4A4E55': '#9AA7B0', '#D6D8DC': '#FFFFFF', '#8C9097': TEAL, '#C9CCD1': '#EEEDEA', '#6B7079': COGNAC}))
E['model.bed@cozy'] = placeholder(OX.M['model.bed@cozy'])
# Minimal: raise the mattress to ~0.6 m (everything above the legs moves up).
E['model.bed@minimal'] = placeholder(shift(OX.M['model.bed@minimal'], dy=0.07, when=lambda p: p['at'][1] > 0.15))


def bed_base():
    """The neutral double bed: upholstered headboard, white bedding, sage throw, two pillow pairs."""
    p = [
        box([1.82, 0.26, 1.88], [0, 0.25, 0.0], '#D9D4CA', 'fabric', radius=0.04),            # upholstered base
        box([1.9, 1.06, 0.09], [0, 0.6, -0.905], '#CFC9BD', 'fabric', radius=0.045),           # headboard
        box([1.72, 0.2, 1.8], [0, 0.48, 0.04], '#F7F7F5', 'fabric', radius=0.07),            # mattress (top 0.58)
        box([1.78, 0.08, 1.26], [0, 0.6, 0.31], '#F1F0EC', 'fabric', radius=0.04),             # duvet
        box([1.79, 0.05, 0.2], [0, 0.63, -0.26], '#FFFFFF', 'fabric', radius=0.025),          # turned-down sheet
        box([1.8, 0.035, 0.46], [0, 0.66, 0.66], SAGE, 'fabric', radius=0.015),               # throw
        box([0.04, 0.3, 0.46], [0.9, 0.52, 0.66], SAGE, 'fabric', radius=0.015),              # throw drape
        box([0.04, 0.3, 0.46], [-0.9, 0.52, 0.66], SAGE, 'fabric', radius=0.015),
    ]
    for x in (-0.84, 0.84):
        for z in (-0.86, 0.9):
            p.append(cyl([0.05, 0.12, 0.05], [x, 0.06, z], OAKD, 'wood', taper=0.8))           # legs
    for x in (-0.66, -0.22, 0.22, 0.66):
        p.append(box([0.42, 0.86, 0.04], [x, 0.66, -0.86], '#D6D0C4', 'fabric', radius=0.03))  # channels
    for s in (-1, 1):
        p += [cushion([0.66, 0.15, 0.4], [s * 0.42, 0.64, -0.66], '#FFFFFF'),
              cushion([0.5, 0.3, 0.12], [s * 0.36, 0.72, -0.46], '#E9E2D4', rotate=[-15, 0, 0])]
    return p


E['model.bed'] = placeholder(bed_base())

# =============================================================================================
# Computer desk (2x1): the Sim sits at the centre facing +Z, desk in front, monitor facing the Sim
# =============================================================================================
def office_chair(z, fabric, frame, seat_y=0.44):
    p = [
        cushion([0.5, 0.08, 0.46], [0, seat_y - 0.04, z], fabric, radius=0.035),                # seat
        cushion([0.46, 0.5, 0.07], [0, seat_y + 0.33, z - 0.21], fabric, rotate=[-8, 0, 0], radius=0.03),  # back
        box([0.12, 0.3, 0.03], [0, seat_y + 0.07, z - 0.2], frame, 'metal', radius=0.01),    # back stem
        cyl([0.05, seat_y - 0.18, 0.05], [0, (seat_y - 0.18) / 2 + 0.1, z], CHROME, 'chrome'),  # gas lift
        box([0.03, 0.03, 0.26], [-0.27, seat_y + 0.17, z + 0.02], frame, 'metal', radius=0.01),  # arms
        box([0.03, 0.03, 0.26], [0.27, seat_y + 0.17, z + 0.02], frame, 'metal', radius=0.01),
        box([0.02, 0.17, 0.02], [-0.27, seat_y + 0.08, z - 0.06], frame, 'metal', radius=0.006),
        box([0.02, 0.17, 0.02], [0.27, seat_y + 0.08, z - 0.06], frame, 'metal', radius=0.006),
        cyl([0.07, 0.05, 0.07], [0, 0.12, z], frame, 'metal'),
    ]
    for i in range(5):
        a = math.radians(i * 72 + 18)
        tip = [math.cos(a) * 0.25, 0.05, z + math.sin(a) * 0.25]
        p.append(rod([0, 0.1, z], tip, 0.03, frame, 'metal', shape='box', t2=0.035, radius=0.008))  # star legs
        p.append(sph([0.045, 0.045, 0.045], [tip[0], 0.025, tip[2]], '#1E1F22', 'satin', segments=8))  # castors
    return p


def computer_desk(top=OAK, legs=BLACKMETAL, ped=WHITE, chair='#5F6E7A', top_fin='wood', leg_fin='metal', lamp=BLACKMETAL):
    p = [box([1.54, 0.035, 0.38], [0, 0.735, 0.26], top, top_fin, radius=0.008)]               # desktop
    for s in (-1, 1):
        p += [box([0.04, 0.72, 0.04], [s * 0.72, 0.36, 0.12], legs, leg_fin, radius=0.006),    # frame legs
              box([0.04, 0.72, 0.04], [s * 0.72, 0.36, 0.43], legs, leg_fin, radius=0.006),
              box([0.04, 0.04, 0.35], [s * 0.72, 0.03, 0.275], legs, leg_fin, radius=0.006),
              box([0.04, 0.04, 0.35], [s * 0.72, 0.7, 0.275], legs, leg_fin, radius=0.006)]
    p += [
        box([1.4, 0.04, 0.02], [0, 0.7, 0.435], legs, leg_fin, radius=0.006),                   # rear rail
        box([0.36, 0.42, 0.34], [-0.52, 0.48, 0.27], ped, 'satin', radius=0.012),           # drawer pedestal
        box([0.34, 0.12, 0.012], [-0.52, 0.6, 0.095], ped, 'satin', radius=0.006),
        box([0.34, 0.2, 0.012], [-0.52, 0.42, 0.095], ped, 'satin', radius=0.006),
        box([0.1, 0.012, 0.012], [-0.52, 0.64, 0.087], legs, 'metal', radius=0.004),
        box([0.1, 0.012, 0.012], [-0.52, 0.5, 0.087], legs, 'metal', radius=0.004),
        # monitor facing the Sim (-Z), its back to the room
        box([0.62, 0.37, 0.03], [0.05, 1.03, 0.4], '#D9DADB', 'satin', radius=0.012),
        box([0.6, 0.345, 0.004], [0.05, 1.035, 0.3835], SCREEN, 'gloss', radius=0.004),
        box([0.5, 0.26, 0.002], [0.05, 1.04, 0.3812], '#2E5470', 'gloss', radius=0.003),       # wallpaper glow
        box([0.06, 0.2, 0.03], [0.05, 0.84, 0.42], '#D9DADB', 'satin', radius=0.01),
        box([0.22, 0.012, 0.14], [0.05, 0.758, 0.375], '#D9DADB', 'satin', radius=0.006),
        box([0.42, 0.018, 0.13], [0.05, 0.761, 0.2], '#E8E8E6', 'satin', radius=0.006),        # keyboard
        box([0.06, 0.02, 0.1], [0.35, 0.762, 0.2], '#E8E8E6', 'satin', radius=0.02),          # mouse
        box([0.24, 0.004, 0.2], [0.35, 0.754, 0.2], '#3A3D41', 'matte', radius=0.002),        # mouse pad
        cyl([0.08, 0.1, 0.08], [0.58, 0.803, 0.32], TEAL, 'gloss'),                             # mug
        # desk lamp
        cyl([0.13, 0.02, 0.13], [-0.6, 0.763, 0.38], lamp, 'metal'),
        rod([-0.6, 0.77, 0.38], [-0.56, 1.1, 0.33], 0.018, lamp, 'metal'),
        rod([-0.56, 1.1, 0.33], [-0.45, 1.06, 0.24], 0.016, lamp, 'metal'),
        cone([0.12, 0.1, 0.12], [-0.43, 1.03, 0.22], lamp, 'metal', taper=0.4, rotate=[35, 0, 0]),
        sph([0.05, 0.05, 0.05], [-0.43, 0.995, 0.2], '#FFF4D6', 'gloss', segments=8),
        # small plant + notebook
        cyl([0.1, 0.1, 0.1], [0.62, 0.803, 0.38], WHITE, 'satin', taper=0.85),
        sph([0.16, 0.14, 0.14], [0.62, 0.9, 0.38], '#5E8F4E', 'foliage', segments=10),
        box([0.2, 0.015, 0.26], [-0.3, 0.76, 0.24], MUSTARD, 'matte', radius=0.004, rotate=[0, 12, 0]),
    ]
    p += office_chair(-0.17, chair, legs if leg_fin == 'metal' else BLACKMETAL)
    return p


E['model.computerDesk'] = placeholder(computer_desk())
E['model.computerDesk@modern'] = placeholder(computer_desk(top='#F1F0EC', top_fin='gloss', ped=OAK, chair='#8E979E'))
E['model.computerDesk@cozy'] = placeholder(computer_desk(top=HONEY, legs=WALNUT, leg_fin='wood', ped=CREAM, chair=RUST, lamp='#2F6B4F'))
E['model.computerDesk@minimal'] = placeholder(computer_desk(top=BIRCH, legs='#F2F2F0', leg_fin='satin', ped='#F2F2F0', chair='#E6E2DA', lamp='#F2F2F0'))

# =============================================================================================
# Piano (2x1): console upright in the front half (keys facing -Z), bench at the centre line
# =============================================================================================
def piano(wood=WALNUT, trim=HONEY, cushion_col='#7A2E2E'):
    p = [
        box([1.5, 0.52, 0.15], [0, 1.0, 0.375], wood, 'wood', radius=0.015),                 # upper case
        box([1.54, 0.03, 0.17], [0, 1.275, 0.37], trim, 'wood', radius=0.01),               # lid
        box([1.46, 0.08, 0.32], [0, 0.69, 0.29], wood, 'wood', radius=0.012),                # keybed
        box([1.3, 0.025, 0.15], [0, 0.735, 0.205], '#F6F3EA', 'satin', radius=0.003),       # white keys
        box([1.36, 0.1, 0.03], [0, 0.79, 0.29], wood, 'wood', radius=0.01),                 # fallboard
        box([0.4, 0.22, 0.012], [0, 0.95, 0.296], '#F4EFE2', 'matte', radius=0.004, rotate=[-12, 0, 0]),  # sheet music
        box([0.6, 0.03, 0.06], [0, 0.85, 0.3], trim, 'wood', radius=0.008),                 # music rest
        box([0.5, 0.012, 0.012], [0, 0.03, 0.35], BRASS, 'metal', radius=0.004),
    ]
    for i in range(36):                                                                      # black keys
        o = i % 5
        oct_, k = divmod(i, 5)
        x = -0.6 + oct_ * 0.161 + [0.023, 0.046, 0.092, 0.115, 0.138][k]
        if x < 0.62:
            p.append(box([0.011, 0.018, 0.09], [x, 0.756, 0.23], '#141414', 'gloss', radius=0.002))
    for s in (-1, 1):
        p += [box([0.06, 0.78, 0.18], [s * 0.74, 0.39, 0.36], wood, 'wood', radius=0.012),    # cheeks
              cyl([0.05, 0.62, 0.05], [s * 0.7, 0.31, 0.16], wood, 'wood', taper=0.7, segments=12),  # turned legs
              box([0.06, 0.14, 0.2], [s * 0.74, 0.8, 0.22], wood, 'wood', radius=0.03),       # key cheeks
              cyl([0.06, 0.1, 0.06], [s * 0.6, 1.33, 0.38], BRASS, 'metal'),                  # candle holders
              cyl([0.035, 0.12, 0.035], [s * 0.6, 1.44, 0.38], '#F3EAD8', 'satin')]
    for x in (-0.07, 0.0, 0.07):
        p.append(box([0.035, 0.012, 0.09], [x, 0.04, 0.3], BRASS, 'metal', radius=0.004))   # pedals
    p.append(box([0.22, 0.18, 0.03], [0, 0.1, 0.36], wood, 'wood', radius=0.01))           # pedal lyre
    # finished back (it faces the room): two raised panels with trim
    for x in (-0.36, 0.36):
        p.append(box([0.62, 0.36, 0.006], [x, 1.0, 0.451], trim, 'wood', radius=0.01))
        p.append(box([0.54, 0.28, 0.006], [x, 1.0, 0.452], wood, 'wood', radius=0.01))
    # bench: seat top 0.46, centred on the Sim's pelvis
    p += [box([0.86, 0.06, 0.34], [0, 0.42, -0.2], wood, 'wood', radius=0.012),
          cushion([0.82, 0.05, 0.3], [0, 0.465, -0.2], cushion_col, radius=0.02)]
    for x in (-0.38, 0.38):
        for z in (-0.33, -0.07):
            p.append(box([0.045, 0.39, 0.045], [x, 0.195, z], wood, 'wood', radius=0.008))
    return p


E['model.piano'] = placeholder(piano())
E['model.piano@modern'] = placeholder(recolor(piano(wood='#F3F2EE', trim=OAK, cushion_col='#55595F'), {'#F3F2EE': ('#F3F2EE', 'gloss')}))
E['model.piano@cozy'] = placeholder(piano(wood=HONEY, trim=WALNUT, cushion_col=RUST))
E['model.piano@minimal'] = placeholder(piano(wood=BIRCH, trim='#F2F2F0', cushion_col='#E6E2DA'))

# =============================================================================================
# Dining table (2x1): two Sims side by side (x = +-0.5) at a long table in front of them
# =============================================================================================
def dining(top=OAK, frame=OAKD, seat='#9DAF8C'):
    p = [box([1.62, 0.04, 0.38], [0, 0.745, 0.26], top, 'wood', radius=0.012),
         box([1.5, 0.07, 0.3], [0, 0.69, 0.27], frame, 'wood', radius=0.006)]
    for x in (-0.76, 0.76):
        for z in (0.1, 0.42):
            p.append(cyl([0.05, 0.725, 0.05], [x, 0.3625, z], frame, 'wood', taper=0.7, segments=12))
    p += [
        box([0.22, 0.005, 0.38], [0, 0.7675, 0.26], '#E8DCC0', 'fabric', radius=0.002),         # runner
        cyl([0.1, 0.18, 0.1], [0, 0.855, 0.32], '#D8D2C4', 'gloss', taper=0.65),               # vase
        sph([0.06, 0.05, 0.06], [-0.02, 0.96, 0.32], '#D9483B', 'satin', segments=6),
        sph([0.06, 0.05, 0.06], [0.03, 0.97, 0.3], '#F2C14E', 'satin', segments=6),
        sph([0.06, 0.05, 0.06], [0.0, 0.95, 0.35], '#F0EDE6', 'satin', segments=6),
    ]
    for s in (-1, 1):
        x = s * 0.5
        p += [cyl([0.24, 0.015, 0.24], [x, 0.7725, 0.25], '#F5F3EE', 'gloss'),                 # plate
              cyl([0.16, 0.02, 0.16], [x, 0.785, 0.25], '#E7D9BF', 'gloss'),
              cyl([0.06, 0.11, 0.06], [x + s * 0.17, 0.82, 0.36], '#DCE6EA', 'gloss', taper=1.1),  # glass
              box([0.015, 0.004, 0.17], [x - 0.15, 0.767, 0.25], '#B9BDC1', 'satin', radius=0.002),
              box([0.015, 0.004, 0.17], [x + 0.15, 0.767, 0.25], '#B9BDC1', 'satin', radius=0.002)]
        # chair facing +Z, seat centred on the Sim
        p += [box([0.42, 0.04, 0.4], [x, 0.42, -0.2], top, 'wood', radius=0.012),
              cushion([0.38, 0.04, 0.36], [x, 0.455, -0.19], seat, radius=0.018),
              box([0.035, 0.41, 0.035], [x - 0.18, 0.205, -0.03], frame, 'wood', radius=0.008),
              box([0.035, 0.41, 0.035], [x + 0.18, 0.205, -0.03], frame, 'wood', radius=0.008),
              box([0.035, 0.9, 0.035], [x - 0.18, 0.45, -0.38], frame, 'wood', radius=0.008),
              box([0.035, 0.9, 0.035], [x + 0.18, 0.45, -0.38], frame, 'wood', radius=0.008),
              box([0.4, 0.08, 0.04], [x, 0.86, -0.38], top, 'wood', radius=0.015)]
        for dx in (-0.1, 0.0, 0.1):
            p.append(box([0.04, 0.34, 0.02], [x + dx, 0.66, -0.38], top, 'wood', radius=0.006))
    return p


E['model.diningTable'] = placeholder(dining())
E['model.diningTable@modern'] = placeholder(recolor(dining(top='#F1F0EC', frame='#3A3C40', seat='#9AA4AB'), {'#F1F0EC': ('#F1F0EC', 'satin'), '#3A3C40': ('#3A3C40', 'metal')}))
E['model.diningTable@cozy'] = placeholder(dining(top=HONEY, frame=WALNUT, seat=RUST))
E['model.diningTable@minimal'] = placeholder(dining(top=BIRCH, frame='#D9C49C', seat='#ECE7DD'))

# =============================================================================================
# Chess table (1x1): the Sim sits facing +Z, board on a small pedestal table in front
# =============================================================================================
def chess():
    src = OX.M['model.chessTable']
    # The original model centres a table on the origin; keep its board and pieces (above the top).
    top_y = max(p['at'][1] + p['size'][1] / 2 for p in src if p['size'][0] > 0.4)
    k, cz = 0.86, 0.25
    p = []
    for q in src:
        if q['at'][1] - q['size'][1] / 2 < top_y - 0.005: continue
        q = json.loads(json.dumps(q))
        q['at'] = [round(q['at'][0] * k, 4), q['at'][1], round(q['at'][2] * k + cz, 4)]
        q['size'] = [round(q['size'][0] * k, 4), q['size'][1], round(q['size'][2] * k, 4)]
        p.append(q)
    dy = 0.74 - top_y
    p = shift(p, dy=dy)
    p += [box([0.46, 0.03, 0.4], [0, 0.725, cz], WALNUT, 'wood', radius=0.012),             # table top
          cyl([0.07, 0.62, 0.07], [0, 0.4, cz], WALNUT, 'wood', taper=0.75, segments=14),
          cyl([0.32, 0.05, 0.32], [0, 0.04, cz], WALNUT, 'wood', taper=0.6, segments=16),
          cyl([0.14, 0.06, 0.14], [0, 0.69, cz], WALNUT, 'wood', taper=1.4, segments=14)]
    # chair
    x0 = 0
    p += [box([0.42, 0.04, 0.38], [x0, 0.42, -0.21], HONEY, 'wood', radius=0.012),
          cushion([0.38, 0.04, 0.34], [x0, 0.455, -0.2], RUST, radius=0.018)]
    for dx in (-0.18, 0.18):
        p += [cyl([0.035, 0.41, 0.035], [dx, 0.205, -0.05], HONEY, 'wood', taper=0.8, segments=10),
              cyl([0.035, 0.92, 0.035], [dx, 0.46, -0.38], HONEY, 'wood', taper=0.9, segments=10)]
    p += [box([0.4, 0.12, 0.035], [0, 0.85, -0.38], HONEY, 'wood', radius=0.02),
          box([0.4, 0.04, 0.03], [0, 0.66, -0.38], HONEY, 'wood', radius=0.01)]
    return p


E['model.chessTable'] = placeholder(chess())

# =============================================================================================
# Weight bench (1x2): the Sim lies on the pad (head -Z, back at ~0.66 m), bar racked above the chest
# =============================================================================================
def weight_bench(pad='#3E6E73', frame='#5C6168'):
    p = [cushion([0.3, 0.09, 1.22], [0, 0.455, -0.12], pad, radius=0.03),                     # pad (top 0.5)
         box([0.12, 0.06, 1.2], [0, 0.38, -0.12], frame, 'metal', radius=0.015),
         box([0.08, 0.36, 0.08], [0, 0.18, 0.4], frame, 'metal', radius=0.015),                # front post
         box([0.08, 0.36, 0.08], [0, 0.18, -0.62], frame, 'metal', radius=0.015),              # rear post
         box([0.5, 0.05, 0.08], [0, 0.025, 0.4], frame, 'metal', radius=0.015),               # feet
         box([0.56, 0.05, 0.08], [0, 0.025, -0.62], frame, 'metal', radius=0.015),
         cyl([0.08, 0.5, 0.08], [0, 0.32, 0.64], frame, 'metal', rotate=[0, 0, 90]),          # leg roller bar
         cyl([0.12, 0.16, 0.12], [-0.2, 0.32, 0.64], pad, 'fabric', rotate=[0, 0, 90]),       # foam rollers
         cyl([0.12, 0.16, 0.12], [0.2, 0.32, 0.64], pad, 'fabric', rotate=[0, 0, 90]),
         box([0.06, 0.32, 0.06], [0, 0.4, 0.62], frame, 'metal', radius=0.012)]
    for s in (-1, 1):                                                                          # rack uprights
        p += [box([0.06, 1.2, 0.06], [s * 0.36, 0.6, -0.8], frame, 'metal', radius=0.012),
              box([0.06, 0.05, 0.4], [s * 0.36, 0.025, -0.75], frame, 'metal', radius=0.012),
              box([0.06, 0.06, 0.1], [s * 0.36, 0.98, -0.75], frame, 'metal', radius=0.012),  # J-hooks
              cyl([0.32, 0.03, 0.32], [s * 0.42, 1.02, -0.72], '#2F3236', 'satin', rotate=[0, 0, 90]),  # plates
              cyl([0.26, 0.03, 0.26], [s * 0.39, 1.02, -0.72], '#B33A32', 'satin', rotate=[0, 0, 90])]
    p += [cyl([0.03, 0.9, 0.03], [0, 1.02, -0.72], CHROME, 'chrome', rotate=[0, 0, 90])]     # bar
    for x in (-0.3, 0.3):                                                                       # dumbbells
        p += [cyl([0.03, 0.2, 0.03], [x, 0.05, 0.85], CHROME, 'chrome', rotate=[0, 0, 90]),
              cyl([0.1, 0.04, 0.1], [x - 0.08, 0.05, 0.85], '#2F3236', 'satin', rotate=[0, 0, 90], segments=6),
              cyl([0.1, 0.04, 0.1], [x + 0.08, 0.05, 0.85], '#2F3236', 'satin', rotate=[0, 0, 90], segments=6)]
    return p


E['model.weightBench'] = placeholder(weight_bench())

# ---- lighter recolours of the gym/hobby placeholders (black bodies read as holes) -------------
E['model.treadmill'] = placeholder(recolor(OX.M['model.treadmill'], {
    '#2A2C30': '#D8D9D7', '#6A6E74': '#9EA3A8', '#18191B': '#3A3D41'}))
E['model.telescope'] = placeholder(recolor(OX.M['model.telescope'], {
    '#3A3D42': ('#F2F2F0', 'gloss'), '#1A1A1C': '#2F3236', '#22314F': '#2E4E7E'}))
E['model.mirror'] = placeholder(recolor(OX.M['model.mirror'], {'#7A563A': HONEY, '#5A3F2A': WALNUT}))
E['model.workbench'] = gltf(PH + 'workbench_metal_desk.glb', [1.62, 1.05, 0.7], offset=[0, 0, 0.04], footprint=(2, 1),
                            placeholder=OX.M['model.workbench'])

# =============================================================================================
# Floor lamp (1x1) variants (the base model is the brass lamp from objects_extra)
# =============================================================================================
def arc_lamp():
    p = [cyl([0.3, 0.05, 0.3], [-0.2, 0.025, -0.2], '#E9E7E2', 'gloss', segments=24)]         # marble-white base
    pts = [(-0.2, 0.05, -0.2), (-0.2, 1.0, -0.2), (-0.14, 1.55, -0.12), (0.02, 1.85, 0.0), (0.17, 1.88, 0.1), (0.25, 1.75, 0.16)]
    for a, b in zip(pts, pts[1:]):
        p.append(rod(list(a), list(b), 0.024, BLACKMETAL, 'metal'))
    p += [lathe([0.36, 0.2, 0.36], [0.25, 1.62, 0.16], '#F4F3EF', 'satin',
                [[0.04, 0.5], [0.12, 0.45], [0.35, 0.05], [0.5, -0.5], [0.47, -0.5], [0.32, 0.0], [0.03, 0.4]]),
          sph([0.08, 0.08, 0.08], [0.25, 1.56, 0.16], '#FFF4D6', 'gloss', segments=10)]
    return p


def tripod_lamp():
    p = []
    for ang in (90, 210, 330):
        a = math.radians(ang)
        p.append(rod([math.cos(a) * 0.24, 0.015, math.sin(a) * 0.24], [0, 1.25, 0], 0.03, BIRCH, 'wood'))
    p += [cyl([0.46, 0.34, 0.46], [0, 1.4, 0], '#F1EDE4', 'fabric', segments=24),                  # drum shade
          cyl([0.47, 0.012, 0.47], [0, 1.57, 0], '#E6DFD3', 'fabric', segments=24),
          cyl([0.47, 0.012, 0.47], [0, 1.23, 0], '#E6DFD3', 'fabric', segments=24),
          sph([0.08, 0.08, 0.08], [0, 1.32, 0], '#FFF4D6', 'gloss', segments=10)]
    return p


E['model.lamp@modern'] = placeholder(arc_lamp())
E['model.lamp@cozy'] = placeholder(recolor(OX.M['model.lamp'], {'#F2E6CC': '#EFD9B4', '#E3D2B0': '#D9BC92'}))
E['model.lamp@minimal'] = placeholder(tripod_lamp())

# =============================================================================================
# Example pack objects (content/packs/example.json) and spare model keys
# =============================================================================================
def whirlpool():
    """2x2 hot tub, two bathers side by side (seat ~0.45 m), water at 0.66 m."""
    shell, deck, water = '#F4F4F2', HONEY, '#6FC3CF'
    p = [box([1.86, 0.06, 1.86], [0, 0.03, 0], deck, 'wood', radius=0.01),                     # plinth
         box([1.82, 0.56, 1.82], [0, 0.34, 0], deck, 'wood', radius=0.03)]                      # wood surround
    # acrylic rim drawn as four rounded bars so the basin stays open
    for (sx, sz, x, z) in ((1.8, 0.2, 0, -0.8), (1.8, 0.2, 0, 0.8), (0.2, 1.4, -0.8, 0), (0.2, 1.4, 0.8, 0)):
        p.append(box([sx, 0.14, sz], [x, 0.69, z], shell, 'gloss', radius=0.03))
    p += [box([1.42, 0.02, 1.42], [0, 0.69, 0], water, 'glass', radius=0.01),                   # water surface
          box([1.42, 0.02, 1.42], [0, 0.63, 0], '#9ED6DE', 'gloss', radius=0.01)]                # basin seen through
    for x in (-0.5, 0.5):
        p += [cushion([0.36, 0.1, 0.16], [x, 0.8, -0.78], '#E9E6DE', radius=0.045),              # headrests
              sph([0.04, 0.02, 0.04], [x - 0.15, 0.7, -0.69], CHROME, 'chrome', segments=8),     # jets
              sph([0.04, 0.02, 0.04], [x + 0.15, 0.7, -0.69], CHROME, 'chrome', segments=8)]
    p += [box([0.5, 0.18, 0.24], [0.55, 0.09, 0.8], deck, 'wood', radius=0.012),                # step
          box([0.42, 0.08, 0.3], [-0.62, 0.8, 0.72], '#FFFFFF', 'fabric', radius=0.03),          # folded towels
          box([0.42, 0.06, 0.3], [-0.62, 0.87, 0.72], '#9DC6CF', 'fabric', radius=0.025),
          cyl([0.07, 0.09, 0.07], [0.78, 0.83, 0.62], '#F3EAD8', 'satin'),                      # candles
          cyl([0.06, 0.07, 0.06], [0.66, 0.82, 0.74], '#F3EAD8', 'satin'),
          sph([0.12, 0.1, 0.12], [-0.78, 0.84, -0.3], '#5E8F4E', 'foliage', segments=8)]         # little plant
    return p


def chef_stove():
    """2x1 range cooker: six burners, double oven, backsplash and a chimney hood."""
    steel, dark = STEEL, '#3A3D41'
    p = [box([1.6, 0.86, 0.62], [0, 0.45, -0.14], steel, 'metal', radius=0.015),               # body
         box([1.6, 0.06, 0.62], [0, 0.03, -0.14], dark, 'satin', radius=0.008),                  # kick plate
         box([1.62, 0.04, 0.62], [0, 0.9, -0.13], '#2F3236', 'satin', radius=0.01),              # hob top
         box([1.6, 0.5, 0.03], [0, 1.17, -0.44], '#E7E5E0', 'gloss', radius=0.006),              # backsplash tiles
         box([1.2, 0.5, 0.44], [0, 1.82, -0.23], steel, 'metal', radius=0.015),                 # hood
         box([0.36, 0.5, 0.28], [0, 2.3, -0.3], steel, 'metal', radius=0.01)]                    # chimney
    for i, x in enumerate((-0.5, 0.0, 0.5)):
        for z in (-0.28, 0.0):
            p += [cyl([0.2, 0.02, 0.2], [x, 0.93, z], '#1E1F22', 'satin', segments=16),         # grates
                  cyl([0.09, 0.025, 0.09], [x, 0.94, z], '#4A4D52', 'metal', segments=12)]
    for x in (-0.4, 0.4):                                                                       # oven doors
        p += [box([0.74, 0.5, 0.03], [x, 0.42, 0.18], steel, 'metal', radius=0.01),
              box([0.5, 0.26, 0.006], [x, 0.44, 0.197], '#1D2228', 'gloss', radius=0.008),
              box([0.6, 0.025, 0.04], [x, 0.7, 0.22], CHROME, 'chrome', radius=0.01)]
    for x in (-0.65, -0.45, -0.25, 0.25, 0.45, 0.65):                                           # knobs
        p.append(cyl([0.05, 0.03, 0.05], [x, 0.8, 0.19], dark, 'satin', rotate=[90, 0, 0], segments=12))
    p += [lathe([0.26, 0.18, 0.26], [-0.5, 1.03, 0.0], '#B9BDC1', 'metal',
                [[0, -0.5], [0.46, -0.5], [0.5, -0.4], [0.5, 0.5], [0.44, 0.5], [0.44, -0.38], [0, -0.38]]),  # stock pot
          cyl([0.34, 0.03, 0.34], [0.5, 0.96, -0.28], '#2F3236', 'satin'),                        # frying pan
          rod([0.62, 0.96, -0.2], [0.82, 0.97, -0.05], 0.03, '#2F3236', 'satin', shape='box'),
          sph([0.12, 0.06, 0.12], [0.5, 0.98, -0.28], '#E9C46A', 'satin', segments=10)]          # omelette
    return p


E['model.whirlpoolTub'] = placeholder(whirlpool())
E['model.chefStove'] = placeholder(chef_stove())

# Spare keys (not placed yet) and the minimal shelf: same placement, optimised library files.
for key, src, extra in (
    ('model.diningChair', 'painted_wooden_chair_01', {'offset': [-0.0015, 0.0007, 0.0307]}),
    ('model.sideTable', 'side_table_01', {'offset': [0.0, 0.0024, 0.0]}),
    ('model.stove', 'electric_stove', {'offset': [0.0, 0.0, -0.1498]}),
    ('model.plantSmall', 'potted_plant_04', {'offset': [0.0, 0.0, -0.0084]}),
    ('model.ceilingLamp', 'modern_ceiling_lamp_01', {'offset': [0.0, -0.2211, -0.0015]}),
):
    E[key] = {'type': 'model', 'url': PH + src + '.glb', 'scale': 1.0, **extra}
E['model.bookshelf@minimal'] = {'type': 'model', 'url': PH + 'wooden_display_shelves_01.glb', 'scale': 0.835, 'rotationY': 90,
                                'offset': [0.0, 0.0, -0.295], 'placeholder': OX.M['model.bookshelf@minimal']}

# =============================================================================================
# Validation (footprint bounds within ~4.5 cm, finishes, colours)
# =============================================================================================
FOOT = {
    'fridge': (1, 1), 'sink': (1, 1), 'toilet': (1, 1), 'shower': (1, 1), 'sofa': (2, 1), 'tv': (1, 1),
    'bookshelf': (1, 1), 'armchair': (1, 1), 'plant': (1, 1), 'bed': (2, 2), 'computerDesk': (2, 1),
    'piano': (2, 1), 'diningTable': (2, 1), 'chessTable': (1, 1), 'weightBench': (1, 2), 'treadmill': (1, 2),
    'telescope': (1, 1), 'mirror': (1, 1), 'workbench': (2, 1), 'whirlpoolTub': (2, 2), 'chefStove': (2, 1), 'lamp': (1, 1),
}
FINISHES = {F + f for f in 'matte satin gloss metal chrome fabric wood bark foliage skin glass'.split()}


def validate_parts(key, parts, fp):
    issues = []
    for p in parts:
        if p['shape'] in ('lathe', 'torus'):
            q = dict(p, shape='cylinder')
        else:
            q = p
        issues += OX.validate(key, [q], fp)
    return [i for i in issues if 'finishes (max 4)' not in i]


def main(path):
    bad = 0
    for k, e in E.items():
        base = k.split('@')[0].replace('model.', '')
        fp = FOOT.get(base, (1, 1))
        parts = e.get('parts', []) if 'url' in e else e['placeholder']
        if 'fit' not in e and 'url' in e: parts = []
        issues = validate_parts(k, parts, fp)
        if 'fit' in e:
            w, h, d = e['fit']
            if w > fp[0] - 0.08 + 1e-6 or d > fp[1] - 0.08 + 1e-6: issues.append(f'fit {e["fit"]} exceeds footprint {fp}')
            for name, m in (e.get('materials') or {}).items():
                if 'finish' in m and m['finish'] not in FINISHES: issues.append(f'{name}: bad finish {m["finish"]}')
        fins = sorted({p['material'].split('.')[-1] for p in parts})
        print(f'{k:26s} {"glTF " + e["url"].split("/")[-1] if "url" in e else "parts"} {len(parts)} parts {",".join(fins)}')
        for s in issues: print('   !', s)
        bad += len(issues)
    json.dump(E, open(path, 'w'), indent=2)
    print(f'{len(E)} entries -> {path}; {bad} issue(s)')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'furniture.json')
