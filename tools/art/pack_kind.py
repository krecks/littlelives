# Kind pack models (`model.kind.*`): neighbourly baking counter, community giving jar, knitting
# rocker, welcome tea table, songbird feeder and bird bath, quilted hearth settee. Primitive parts
# plus Kenney's kitchen stove (restyled), Poly Haven's rocking chair and tea set (all CC0). Warm
# honey woods, buttercream, sage and soft pastels. Conventions as furniture.py: 1 unit = 1 m,
# origin at the footprint centre on the floor, front +Z, back against the wall at -Z; seats centred
# on z = 0 with tops at ~0.45 m (DEFAULT_SEAT); multi-slot seats at x = +-0.5.
# Run: python3 -I pack_kind.py [out.json]  then  python3 -I apply_pack.py kind out.json
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, gltf, placeholder, mat,  # noqa: E402
                       validate_parts, CHROME, BRASS, OAK, WHITE, CREAM, HONEY, WALNUT)

TRAIT = 'kind'
FOOT = {o['model']: tuple(o['footprint']) for o in
        json.load(open(os.path.join(HERE, '..', '..', 'web', 'public', 'content', 'packs', TRAIT + '.json')))['objects']}
LIB = '../../models/'
E = {}

BUTTER, SAGE, SAGED, ROSE, SKY, MUSTARD, TERRA, LEAF = '#F1E6C8', '#A8BFA0', '#7E9A76', '#E3A0A0', '#9CC3DB', '#D6A64A', '#C0714C', '#5E8F4E'


def jar(x, y, z, h=0.16, r=0.11, fill='#F2E6CC'):
    return [lathe([r, h, r], [x, y + h / 2, z], '#EEF4F4', 'glass',
                  profile=[[0, -0.5], [0.5, -0.5], [0.5, 0.35], [0.4, 0.45], [0.4, 0.5], [0, 0.5]]),
            cyl([r * 0.9, h * 0.55, r * 0.9], [x, y + h * 0.3, z], fill, 'matte'),
            cyl([r * 0.85, 0.03, r * 0.85], [x, y + h + 0.015, z], HONEY, 'wood')]


# ---- Neighbourly baking counter (2x1): Kenney range (restyled) + counter with bakes ------------
CX0, CX1 = -0.915, 0.27
cw, cx = CX1 - CX0, (CX0 + CX1) / 2
ov = [box([cw, 0.82, 0.58], [cx, 0.45, -0.165], BUTTER, 'satin', radius=0.012),
      box([cw, 0.08, 0.54], [cx, 0.04, -0.185], '#C9B48C', 'satin', radius=0.006),         # plinth
      box([cw + 0.01, 0.045, 0.6], [cx, 0.885, -0.15], HONEY, 'wood', radius=0.01)]       # butcher block
for i, x in enumerate((cx - 0.4, cx, cx + 0.4)):
    ov += [box([0.36, 0.66, 0.015], [x, 0.44, 0.13], SAGE, 'satin', radius=0.012),
           box([0.3, 0.6, 0.012], [x, 0.44, 0.14], '#B9CDB2', 'satin', radius=0.01),
           sph([0.035, 0.035, 0.025], [x + (0.13 if i % 2 else -0.13), 0.68, 0.15], BRASS, 'metal', segments=8)]
ov += [box([cw, 0.03, 0.2], [cx, 1.5, -0.35], HONEY, 'wood', radius=0.008)]                # wall shelf
for x in (CX0 + 0.06, CX1 - 0.06):
    ov.append(box([0.03, 0.12, 0.16], [x, 1.44, -0.37], BRASS, 'metal', radius=0.006))
ov += jar(cx - 0.4, 1.515, -0.35, fill='#F4EFE2') + jar(cx - 0.15, 1.515, -0.35, 0.2, fill='#C77D4F') + jar(cx + 0.1, 1.515, -0.35, 0.14, fill='#E8C46E')
ov += [lathe([0.32, 0.06, 0.32], [cx - 0.28, 0.935, -0.05], TERRA, 'gloss',
             profile=[[0, -0.5], [0.4, -0.5], [0.5, 0.5], [0.44, 0.5], [0, 0.3]]),             # pie dish
       lathe([0.28, 0.06, 0.28], [cx - 0.28, 0.96, -0.05], '#E0B060', 'matte',
             profile=[[0, 0.5], [0.3, 0.42], [0.5, 0.0], [0.5, -0.5], [0, -0.5]])]           # golden crust
for i in range(-2, 3):
    ov.append(box([0.022, 0.012, 0.24], [cx - 0.28 + i * 0.05, 0.99, -0.05], '#C98B3A', 'matte', radius=0.004))
ov += [box([0.3, 0.012, 0.22], [cx + 0.15, 0.92, -0.08], CHROME, 'chrome', radius=0.004)]   # cooling rack
for x, z in [(0.07, -0.13), (0.15, -0.04), (0.23, -0.12), (0.1, -0.02), (0.22, -0.03)]:
    ov.append(cyl([0.06, 0.012, 0.06], [cx + x, 0.932, z], '#C98B3A', 'matte'))
ov += [cyl([0.045, 0.32, 0.045], [cx + 0.42, 0.93, 0.0], '#D9B98A', 'wood', rotate=[0, 0, 90]),  # rolling pin
       lathe([0.22, 0.12, 0.22], [cx - 0.45, 1.02, -0.28], '#F4F1EA', 'gloss',
             profile=[[0, -0.5], [0.15, -0.5], [0.15, 0.3], [0.5, 0.35], [0.5, 0.5], [0, 0.5]]),  # cake stand
       part('blob', [0.18, 0.1, 0.18], [cx - 0.45, 1.13, -0.28], '#F4C6D0', 'matte', noise=0.1),
       box([0.16, 0.22, 0.012], [0.6, 0.62, 0.165], '#E3A0A0', 'fabric', radius=0.006),        # gingham towel on the oven
       box([0.14, 0.2, 0.004], [0.6, 0.62, 0.172], '#FBF6EC', 'fabric', radius=0.004),
       lathe([0.22, 0.14, 0.22], [0.52, 0.99, -0.25], '#A8BFA0', 'gloss',
             profile=[[0, -0.5], [0.5, -0.5], [0.5, 0.45], [0.46, 0.5], [0, 0.5]]),           # pot on the hob
       cyl([0.24, 0.02, 0.24], [0.52, 1.07, -0.25], '#7E9A76', 'gloss')]
E['model.kind.neighbourlyOven'] = gltf(LIB + 'kenney/kitchenStove.glb', [0.62, 0.92, 0.62], align='back', offset=[0.6, 0, 0.04],
    materials={'wood': mat('gloss', BUTTER), 'metal': mat('chrome', CHROME), 'metalDark': mat('satin', '#4A4E54'),
               'carpetWhite': mat('satin', '#ECE6D8'), 'glass': mat('gloss', '#4A3A30')},
    parts=ov, placeholder=[box([0.62, 0.92, 0.62], [0.6, 0.46, -0.15], BUTTER, 'gloss', radius=0.02)] + ov, footprint=(2, 1))

# ---- Community giving jar (1x1) ------------------------------------------------------------------
gj = [lathe([0.44, 0.86, 0.44], [0, 0.43, -0.05], HONEY, 'wood',
            profile=[[0, -0.5], [0.5, -0.5], [0.5, -0.45], [0.3, -0.4], [0.16, -0.3], [0.12, 0.1], [0.16, 0.38],
                     [0.4, 0.44], [0.42, 0.5], [0, 0.5]]),
      lathe([0.3, 0.38, 0.3], [0, 1.05, -0.05], '#EEF4F4', 'glass',
            profile=[[0, -0.5], [0.46, -0.5], [0.5, -0.3], [0.5, 0.25], [0.36, 0.38], [0.34, 0.5], [0, 0.5]]),
      cyl([0.22, 0.05, 0.22], [0, 1.255, -0.05], '#B5835A', 'wood'),                          # cork lid
      box([0.03, 0.006, 0.08], [0, 1.282, -0.05], '#3A3D41', 'satin')]                        # coin slot
for i in range(14):                                                                            # coins inside
    a = i * 2.4
    rr = 0.04 + 0.08 * ((i * 7) % 5) / 5
    gj.append(cyl([0.05, 0.012, 0.05], [round(rr * math.cos(a), 3), 0.875 + 0.013 * (i // 4), round(-0.05 + rr * math.sin(a), 3)],
                  '#D9B45A', 'metal', rotate=[(i * 23) % 30, 0, (i * 17) % 25], segments=12))
gj += [cyl([0.12, 0.02, 0.12], [0, 0.96, -0.05], '#7FA35B', 'matte', rotate=[0, 0, 10]),     # banknotes
       # heart tag on a ribbon
       sph([0.07, 0.07, 0.03], [-0.025, 1.08, 0.105], '#D9483B', 'gloss', segments=10),
       sph([0.07, 0.07, 0.03], [0.025, 1.08, 0.105], '#D9483B', 'gloss', segments=10),
       box([0.07, 0.07, 0.028], [0, 1.055, 0.105], '#D9483B', 'gloss', radius=0.01, rotate=[0, 0, 45]),
       torus([0.31, 0.015, 0.31], [0, 1.2, -0.05], '#E3A0A0', 'fabric'),
       # chalk sign on the pedestal
       box([0.22, 0.16, 0.015], [0, 0.62, 0.025], '#3E5A48', 'matte', radius=0.008),
       box([0.24, 0.18, 0.012], [0, 0.62, 0.02], HONEY, 'wood', radius=0.01),
       box([0.14, 0.015, 0.004], [0, 0.65, 0.034], '#F4F1EA', 'matte'),
       box([0.1, 0.015, 0.004], [0, 0.6, 0.034], '#F4F1EA', 'matte')]
gj += [lathe([0.16, 0.16, 0.16], [0.3, 0.08, 0.28], TERRA, 'satin',
             profile=[[0, -0.5], [0.38, -0.5], [0.5, 0.5], [0, 0.5]]),
       part('blob', [0.24, 0.22, 0.22], [0.3, 0.25, 0.28], LEAF, 'foliage', noise=0.2),
       sph([0.05, 0.05, 0.05], [0.26, 0.33, 0.32], MUSTARD, 'satin', segments=8),
       sph([0.05, 0.05, 0.05], [0.35, 0.3, 0.25], ROSE, 'satin', segments=8)]
E['model.kind.givingJar'] = placeholder(gj)

# ---- Knitting rocker (1x1): Poly Haven rocking chair, quilted cushion, yarn basket ------------
kr = [cushion([0.4, 0.05, 0.38], [0, 0.465, -0.02], SAGE, radius=0.02),
      box([0.36, 0.42, 0.03], [0.02, 0.8, -0.22], '#F1E6C8', 'fabric', radius=0.01, rotate=[-14, 4, 0]),  # throw over the back
      lathe([0.2, 0.18, 0.2], [0.33, 0.09, 0.33], '#C9A16A', 'wood',
            profile=[[0, -0.5], [0.4, -0.5], [0.5, 0.5], [0.45, 0.5], [0.36, -0.4], [0, -0.4]]),   # yarn basket
      sph([0.09, 0.09, 0.09], [0.3, 0.18, 0.31], ROSE, 'fabric', segments=10),
      sph([0.08, 0.08, 0.08], [0.37, 0.17, 0.35], SKY, 'fabric', segments=10),
      sph([0.08, 0.08, 0.08], [0.33, 0.19, 0.38], MUSTARD, 'fabric', segments=10),
      rod([0.27, 0.15, 0.36], [0.4, 0.32, 0.28], 0.008, '#C9CCD0', 'metal'),                  # needles
      rod([0.29, 0.15, 0.38], [0.36, 0.33, 0.3], 0.008, '#C9CCD0', 'metal')]
E['model.kind.knittingRocker'] = gltf(LIB + 'ph/Rockingchair_01.glb', [0.66, 1.05, 0.88], align='centre', offset=[0, 0, -0.02],
                                       parts=kr, placeholder=kr)

# ---- Welcome tea table (2x1): two poufs (tops 0.45 at x = +-0.5), low table and tea set between --
tt = [cyl([1.86, 0.012, 0.86], [0, 0.006, 0], '#E8D6C0', 'fabric', segments=40),             # oval rug
      torus([1.82, 0.02, 0.82], [0, 0.014, 0], TERRA, 'fabric', segments=40)]
for s, c in ((-1, SAGE), (1, ROSE)):
    x = s * 0.5
    tt += [cyl([0.44, 0.36, 0.44], [x, 0.19, 0.0], c, 'fabric', segments=24),
           cushion([0.46, 0.08, 0.46], [x, 0.41, 0.0], c, radius=0.035),
           torus([0.44, 0.03, 0.44], [x, 0.37, 0.0], '#F4EFE2', 'fabric')]
tt += [box([0.48, 0.04, 0.56], [0, 0.4, -0.02], HONEY, 'wood', radius=0.012)]                 # low table (top 0.42)
for x in (-0.2, 0.2):
    for z in (-0.25, 0.21):
        tt.append(box([0.045, 0.38, 0.045], [x, 0.19, z], HONEY, 'wood', radius=0.008))
tt += [box([0.4, 0.02, 0.48], [0, 0.12, -0.02], HONEY, 'wood', radius=0.006),
       box([0.16, 0.035, 0.12], [-0.08, 0.15, -0.1], MUSTARD, 'matte', radius=0.006),        # books on the shelf
       box([0.16, 0.03, 0.12], [-0.08, 0.18, -0.1], SKY, 'matte', radius=0.006),
       lathe([0.07, 0.04, 0.07], [0.15, 0.44, -0.2], '#FBF6EC', 'satin', profile=[[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]]),  # tea light
       sph([0.02, 0.03, 0.02], [0.15, 0.47, -0.2], '#FFD27A', 'gloss', segments=8)]
for x in (-0.83, 0.83):                                                                         # potted ferns
    tt += [lathe([0.18, 0.2, 0.18], [x, 0.1, -0.32], '#F4F1EA', 'satin', profile=[[0, -0.5], [0.4, -0.5], [0.5, 0.5], [0, 0.5]]),
           part('blob', [0.22, 0.24, 0.2], [x * 0.97, 0.3, -0.3], LEAF, 'foliage', noise=0.25)]
E['model.kind.welcomeTeaTable'] = gltf(LIB + 'ph/tea_set_01.glb', [0.42, 0.15, 0.32], align='centre', offset=[0, 0.42, 0.0],
                                       parts=tt, placeholder=tt, footprint=(2, 1))


# ---- Songbird feeding station (1x1): feeder house on a post, bird bath, songbirds -------------
def bird(x, y, z, body, breast, yaw=0):
    r = math.radians(yaw)
    fx, fz = math.sin(r), math.cos(r)
    return [sph([0.07, 0.065, 0.1], [x, y + 0.035, z], body, 'satin', segments=8, rotate=[0, yaw, 0]),
            sph([0.05, 0.04, 0.05], [x + fx * 0.02, y + 0.03, z + fz * 0.02], breast, 'satin', segments=8),
            sph([0.05, 0.05, 0.05], [x + fx * 0.045, y + 0.085, z + fz * 0.045], body, 'satin', segments=8),
            cone([0.018, 0.03, 0.018], [x + fx * 0.075, y + 0.085, z + fz * 0.075], MUSTARD, 'satin', rotate=[90, yaw, 0])]


PAINT = '#F2EFE8'
sb = [box([0.07, 1.36, 0.07], [-0.2, 0.68, -0.22], PAINT, 'satin', radius=0.012),             # post
      box([0.3, 0.04, 0.3], [-0.2, 0.02, -0.22], '#C9C3B0', 'matte', radius=0.01),
      box([0.38, 0.025, 0.32], [-0.2, 1.37, -0.22], HONEY, 'wood', radius=0.008),             # seed tray
      box([0.38, 0.03, 0.012], [-0.2, 1.39, -0.065], HONEY, 'wood', radius=0.004),
      box([0.38, 0.03, 0.012], [-0.2, 1.39, -0.375], HONEY, 'wood', radius=0.004),
      box([0.22, 0.2, 0.18], [-0.2, 1.48, -0.22], SKY, 'satin', radius=0.012),                # feeder house
      box([0.16, 0.012, 0.004], [-0.2, 1.4, -0.128], '#EEF4F4', 'glass'),
      box([0.2, 0.02, 0.25], [-0.285, 1.63, -0.22], TERRA, 'satin', radius=0.006, rotate=[0, 0, 38]),   # roof
      box([0.2, 0.02, 0.25], [-0.115, 1.63, -0.22], TERRA, 'satin', radius=0.006, rotate=[0, 0, -38]),
      cyl([0.05, 0.005, 0.05], [-0.2, 1.5, -0.128], '#3A3D41', 'satin', rotate=[90, 0, 0]),
      rod([-0.2, 1.42, -0.12], [-0.2, 1.42, -0.04], 0.012, HONEY, 'wood')]                     # perch
for x, z in [(-0.3, -0.12), (-0.12, -0.3), (-0.26, -0.3), (-0.14, -0.14)]:
    sb.append(sph([0.05, 0.02, 0.05], [x, 1.387, z], '#C9A16A', 'matte', segments=6))         # seeds
sb += bird(-0.2, 1.43, -0.06, '#8A6A4E', '#E07A2E', 0) + bird(-0.33, 1.385, -0.18, '#4F7FB8', '#F4EFE2', -60)
# bird bath
sb += [lathe([0.24, 0.62, 0.24], [0.2, 0.31, 0.16], '#D8D3C8', 'matte',
             profile=[[0, -0.5], [0.5, -0.5], [0.5, -0.42], [0.25, -0.35], [0.18, 0.0], [0.22, 0.4], [0.4, 0.5], [0, 0.5]]),
       lathe([0.5, 0.1, 0.5], [0.2, 0.66, 0.16], '#D8D3C8', 'matte',
             profile=[[0, -0.5], [0.3, -0.5], [0.5, 0.3], [0.5, 0.5], [0.44, 0.5], [0.42, 0.25], [0, 0.0]]),
       cyl([0.4, 0.008, 0.4], [0.2, 0.69, 0.16], '#BFE3EE', 'gloss')]
sb += bird(0.36, 0.71, 0.2, '#C8A040', '#F2D27A', 70) + bird(0.02, 0.71, 0.1, '#9AA0A6', '#E8B4B8', -80)
for x, z, c in [(-0.33, -0.02, ROSE), (-0.05, -0.34, MUSTARD), (0.33, -0.3, '#B48CD6'), (-0.33, 0.3, ROSE)]:
    sb += [part('blob', [0.2, 0.18, 0.18], [x, 0.11, z], LEAF, 'foliage', noise=0.2),
           sph([0.05, 0.05, 0.05], [x + 0.03, 0.19, z + 0.02], c, 'satin', segments=8),
           sph([0.05, 0.05, 0.05], [x - 0.04, 0.17, z - 0.02], c, 'satin', segments=8)]
sb += [box([0.16, 0.22, 0.1], [0.05, 0.11, -0.4], '#C9B48C', 'fabric', radius=0.02),          # seed sack
       lathe([0.12, 0.1, 0.12], [-0.02, 0.05, 0.38], '#B9BEC3', 'metal', profile=[[0, -0.5], [0.42, -0.5], [0.5, 0.5], [0, 0.5]])]  # scoop tin
E['model.kind.songbirdFeeder'] = placeholder(sb)

# ---- Hearthside quilted settee (2x1): two seats at x = +-0.5 (tops 0.45) ----------------------
VEL, VEL2, QUILT = '#6F8F6A', '#7E9E78', '#F6EEDC'
hs = [box([1.66, 0.28, 0.78], [0, 0.22, -0.03], VEL, 'fabric', radius=0.05),
      cushion([0.8, 0.12, 0.62], [-0.41, 0.39, 0.06], VEL2, radius=0.05),
      cushion([0.8, 0.12, 0.62], [0.41, 0.39, 0.06], VEL2, radius=0.05),
      box([1.66, 0.5, 0.2], [0, 0.62, -0.33], VEL, 'fabric', radius=0.07),
      cushion([0.72, 0.36, 0.14], [-0.4, 0.7, -0.2], VEL2, rotate=[-10, 0, 0]),
      cushion([0.72, 0.36, 0.14], [0.4, 0.7, -0.2], VEL2, rotate=[-10, 0, 0])]
for s in (-1, 1):
    hs += [box([0.16, 0.36, 0.78], [s * 0.86, 0.34, -0.03], VEL, 'fabric', radius=0.05),
           cyl([0.22, 0.8, 0.22], [s * 0.84, 0.56, -0.03], VEL, 'fabric', rotate=[90, 0, 0], segments=20),  # rolled arms
           cyl([0.18, 0.012, 0.18], [s * 0.84, 0.56, 0.372], VEL2, 'fabric', rotate=[90, 0, 0])]
    for z in (-0.36, 0.3):
        hs.append(lathe([0.07, 0.1, 0.07], [s * 0.82, 0.05, z], HONEY, 'wood',
                        profile=[[0, -0.5], [0.3, -0.5], [0.5, 0.0], [0.4, 0.5], [0, 0.5]]))
# patchwork quilt over the right seat and draped down the front
PATCH = ['#E3A0A0', '#F1E6C8', '#D6A64A', '#9CC3DB', '#A8BFA0', '#F6EEDC']
hs += [box([0.76, 0.02, 0.58], [0.42, 0.46, 0.08], QUILT, 'fabric', radius=0.008),
       box([0.76, 0.26, 0.02], [0.42, 0.34, 0.385], QUILT, 'fabric', radius=0.008)]
for i in range(4):
    for j in range(3):
        hs.append(box([0.17, 0.006, 0.17], [0.42 - 0.27 + i * 0.18, 0.472, 0.08 - 0.18 + j * 0.18], PATCH[(i + 2 * j) % 6], 'fabric', radius=0.003))
for i in range(4):
    hs.append(box([0.17, 0.11, 0.006], [0.42 - 0.27 + i * 0.18, 0.4, 0.397], PATCH[(i + 3) % 6], 'fabric', radius=0.003))
hs += [cushion([0.36, 0.32, 0.12], [-0.62, 0.66, -0.12], '#E3A0A0', rotate=[-12, 18, 0]),
       cushion([0.32, 0.3, 0.12], [0.66, 0.66, -0.12], '#F1E6C8', rotate=[-12, -18, 0]),
       # brass lantern with a warm glow on the left arm
       box([0.12, 0.16, 0.12], [-0.86, 0.77, 0.12], '#FFD9A0', 'gloss', radius=0.02),
       box([0.14, 0.02, 0.14], [-0.86, 0.69, 0.12], BRASS, 'metal', radius=0.006),
       cone([0.15, 0.06, 0.15], [-0.86, 0.88, 0.12], BRASS, 'metal', taper=0.3),
       torus([0.06, 0.01, 0.06], [-0.86, 0.93, 0.12], BRASS, 'metal', rotate=[90, 0, 0])]
E['model.kind.hearthSettee'] = placeholder(hs)


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
