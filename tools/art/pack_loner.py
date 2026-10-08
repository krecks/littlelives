# Loner pack models (`model.loner.*`): hooded reading pod, shortwave radio desk, jigsaw puzzle
# table, bonsai potting bench, cedar sauna for one, no-knock delivery hatch. Primitive parts in a
# quiet palette (sage, oat, slate, cedar). Conventions as furniture.py: 1 unit = 1 m, origin at the
# footprint centre on the floor, front +Z, back against the wall at -Z; seats centred on z = 0 with
# tops at ~0.45 m (characters.ts DEFAULT_SEAT).
# Run: python3 -I pack_loner.py [out.json]  then  python3 -I apply_pack.py loner out.json
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, gltf, placeholder,  # noqa: E402
                       validate_parts, CHROME, BRASS, OAK, OAKD, WHITE, CREAM, HONEY)

TRAIT = 'loner'
FOOT = {o['model']: tuple(o['footprint']) for o in
        json.load(open(os.path.join(HERE, '..', '..', 'web', 'public', 'content', 'packs', TRAIT + '.json')))['objects']}
E = {}

SAGE, SAGED, OAT, SLATE, CEDAR, CEDARD, MUSTARD, TERRA = '#8FA58A', '#7C9277', '#E6DCC8', '#7E93A3', '#C98B58', '#A86E44', '#D6A64A', '#C0714C'


def side_chair(z=0.0, wood=OAK, seat=SAGE):
    """Simple spindle chair with its seat (top 0.45 m) centred on the seated Sim."""
    p = [box([0.42, 0.04, 0.4], [0, 0.405, z], wood, 'wood', radius=0.012),
         cushion([0.38, 0.04, 0.36], [0, 0.445, z + 0.01], seat, radius=0.018),
         box([0.4, 0.1, 0.035], [0, 0.88, z - 0.2], wood, 'wood', radius=0.015)]
    for x in (-0.18, 0.18):
        p += [cyl([0.035, 0.39, 0.035], [x, 0.195, z + 0.16], wood, 'wood', taper=0.8, segments=10),
              cyl([0.035, 0.92, 0.035], [x, 0.46, z - 0.18], wood, 'wood', taper=0.9, segments=10)]
    for x in (-0.09, 0.0, 0.09):
        p.append(cyl([0.018, 0.4, 0.018], [x, 0.63, z - 0.19], wood, 'wood', segments=8))
    return p


def desk(z0=0.16, z1=0.45, w=0.84, top=OAK, legs=OAKD, h=0.74):
    zc, d = (z0 + z1) / 2, z1 - z0
    p = [box([w, 0.03, d], [0, h - 0.015, zc], top, 'wood', radius=0.008),
         box([w - 0.08, 0.08, 0.02], [0, h - 0.07, z1 - 0.03], legs, 'wood', radius=0.006)]
    for x in (-w / 2 + 0.03, w / 2 - 0.03):
        for z in (z0 + 0.03, z1 - 0.03):
            p.append(cyl([0.035, h - 0.03, 0.035], [x, (h - 0.03) / 2, z], legs, 'wood', taper=0.75, segments=10))
    return p


# ---- Hooded reading pod (1x1) --------------------------------------------------------------
qp = [cyl([0.5, 0.04, 0.5], [0, 0.02, -0.04], OAK, 'wood', segments=24),
      cyl([0.1, 0.16, 0.1], [0, 0.12, -0.04], CHROME, 'chrome'),
      box([0.82, 0.24, 0.78], [0, 0.32, -0.05], SAGE, 'fabric', radius=0.11),            # bucket
      cushion([0.62, 0.1, 0.58], [0, 0.4, 0.03], OAT, radius=0.045),                    # seat (top 0.45)
      box([0.82, 1.06, 0.14], [0, 0.88, -0.38], SAGE, 'fabric', radius=0.065),           # back shell
      cushion([0.6, 0.6, 0.1], [0, 0.8, -0.28], OAT, rotate=[-6, 0, 0], radius=0.04),    # back cushion
      cushion([0.4, 0.18, 0.1], [0, 1.12, -0.29], '#D8CCB4', radius=0.04),               # head cushion
      box([0.82, 0.13, 0.54], [0, 1.43, -0.16], SAGE, 'fabric', radius=0.065, rotate=[8, 0, 0]),  # hood
      box([0.7, 0.03, 0.4], [0, 1.365, -0.13], OAT, 'fabric', radius=0.012, rotate=[6, 0, 0]),   # hood lining
      sph([0.07, 0.05, 0.07], [0, 1.34, -0.0], '#FFE9B8', 'gloss', segments=10)]               # reading light
for s in (-1, 1):
    qp += [box([0.12, 1.0, 0.66], [s * 0.36, 0.86, -0.12], SAGE, 'fabric', radius=0.055),      # wings
           box([0.03, 0.62, 0.5], [s * 0.295, 0.8, -0.1], OAT, 'fabric', radius=0.012)]       # wing lining
qp += [box([0.22, 0.03, 0.16], [0.2, 0.47, 0.18], MUSTARD, 'matte', radius=0.004, rotate=[0, 15, 0]),  # book
       box([0.4, 0.02, 0.3], [-0.1, 0.46, 0.14], '#B7A88C', 'fabric', radius=0.008, rotate=[0, -8, 0])]  # blanket
E['model.loner.quietPod'] = placeholder(qp)

# ---- Shortwave radio desk (1x1): seated at z = 0, rig on a shallow desk in front ---------------
RIG, RIGF = '#7D8A6A', '#C9C3B0'
sw = desk() + side_chair(-0.02, OAK, SLATE)
sw += [box([0.48, 0.24, 0.2], [0.02, 0.86, 0.35], RIG, 'satin', radius=0.02),            # receiver
       box([0.44, 0.2, 0.01], [0.02, 0.86, 0.247], RIGF, 'satin', radius=0.006),         # front panel (faces the Sim)
       box([0.22, 0.07, 0.004], [-0.06, 0.91, 0.24], '#F2B84B', 'gloss', radius=0.006),  # glowing dial
       box([0.004, 0.06, 0.004], [-0.02, 0.91, 0.237], '#C8402F', 'gloss'),
       cyl([0.08, 0.025, 0.08], [0.14, 0.88, 0.237], '#3A3D41', 'satin', rotate=[90, 0, 0]),  # tuning knob
       box([0.07, 0.05, 0.004], [0.14, 0.81, 0.24], '#F4EFE2', 'gloss', radius=0.004)]       # meter
for x in (-0.15, -0.09, -0.03, 0.03):
    sw.append(cyl([0.03, 0.02, 0.03], [x, 0.8, 0.238], '#3A3D41', 'satin', rotate=[90, 0, 0]))
sw += [rod([0.22, 0.98, 0.42], [0.3, 1.75, 0.42], 0.012, CHROME, 'chrome'),               # antenna
       sph([0.025, 0.025, 0.025], [0.3, 1.76, 0.42], CHROME, 'chrome', segments=6),
       cyl([0.1, 0.02, 0.1], [-0.3, 0.75, 0.28], '#3A3D41', 'satin'),                    # desk mic
       rod([-0.3, 0.76, 0.28], [-0.28, 0.9, 0.27], 0.015, CHROME, 'chrome'),
       part('capsule', [0.05, 0.1, 0.05], [-0.27, 0.95, 0.26], '#C9CCD0', 'metal'),
       torus([0.18, 0.02, 0.18], [0.3, 0.84, 0.25], '#3A3D41', 'satin', rotate=[0, 0, 90]),   # headphones
       cyl([0.07, 0.04, 0.07], [0.3, 0.77, 0.25], SLATE, 'satin', rotate=[0, 0, 90]),
       box([0.16, 0.012, 0.2], [-0.24, 0.756, 0.33], '#F4EFE2', 'matte', radius=0.004, rotate=[0, 10, 0]),  # logbook
       box([0.008, 0.008, 0.14], [-0.2, 0.765, 0.33], MUSTARD, 'satin', rotate=[0, 30, 0]),
       cyl([0.07, 0.09, 0.07], [0.33, 0.785, 0.37], TERRA, 'gloss')]                       # mug
E['model.loner.shortwaveRadio'] = placeholder(sw)

# ---- Jigsaw puzzle table (1x1) -----------------------------------------------------------------
pz = desk(0.1, 0.45, 0.86, OAK, OAKD, 0.72) + side_chair(-0.06, OAK, SAGE)
SKY, SEA, HILL, FIELD = ['#9CC8E6', '#7FB6DE'], ['#3E7FAE', '#4C8FB8'], ['#6E9E58', '#7FAF63'], ['#D9B45A', '#E3C46E']
for i in range(7):
    for j in range(4):
        if (i, j) in {(5, 0), (6, 1), (2, 3), (6, 3), (0, 2)}: continue           # missing pieces
        band = [SKY, SEA, HILL, FIELD][j]
        pz.append(box([0.083, 0.008, 0.063], [-0.29 + i * 0.087, 0.724, 0.38 - j * 0.067], band[(i + j) % 2], 'satin', radius=0.003))
for x, z, r, c in [(0.36, 0.2, 20, SKY[0]), (0.3, 0.16, -35, HILL[1]), (0.38, 0.13, 60, FIELD[0]), (-0.36, 0.17, 10, SEA[0])]:
    pz.append(box([0.06, 0.008, 0.05], [x, 0.724, z], c, 'satin', radius=0.003, rotate=[0, r, 0]))
pz += [box([0.3, 0.04, 0.22], [0.0, 0.025, 0.3], '#3E7FAE', 'satin', radius=0.006),        # box on the floor
       box([0.28, 0.002, 0.2], [0.0, 0.046, 0.3], '#E3C46E', 'gloss', radius=0.004),
       cyl([0.1, 0.015, 0.1], [-0.36, 0.73, 0.38], '#3A3D41', 'satin'),                    # magnifier lamp
       rod([-0.36, 0.74, 0.38], [-0.32, 1.02, 0.36], 0.014, CHROME, 'chrome'),
       rod([-0.32, 1.02, 0.36], [-0.2, 0.98, 0.3], 0.012, CHROME, 'chrome'),
       torus([0.15, 0.025, 0.15], [-0.16, 0.95, 0.28], '#E9E6E0', 'gloss', rotate=[-30, 0, 0]),
       cyl([0.12, 0.006, 0.12], [-0.16, 0.95, 0.28], '#DCE6EA', 'glass', rotate=[-30, 0, 0]),
       cyl([0.08, 0.1, 0.08], [0.36, 0.77, 0.4], '#F4EFE2', 'gloss')]                         # tea
E['model.loner.puzzleTable'] = placeholder(pz)

# ---- Bonsai potting bench (1x1) --------------------------------------------------------------
TEAK = '#B07A4E'
bb = [box([0.86, 0.04, 0.46], [0, 0.8, -0.2], TEAK, 'wood', radius=0.01),
      box([0.82, 0.03, 0.4], [0, 0.26, -0.2], TEAK, 'wood', radius=0.008),
      box([0.86, 0.26, 0.03], [0, 0.95, -0.44], TEAK, 'wood', radius=0.008)]
for x in (-0.4, 0.4):
    for z in (-0.41, 0.0):
        bb.append(box([0.045, 0.8, 0.045], [x, 0.4, z], TEAK, 'wood', radius=0.008))
# bonsai: glazed pot, twisting trunk, foliage pads
bb += [box([0.38, 0.08, 0.26], [0, 0.86, -0.18], '#3E6F9E', 'gloss', radius=0.02),
       box([0.34, 0.01, 0.22], [0, 0.9, -0.18], '#5C4433', 'matte', radius=0.004),
       sph([0.06, 0.03, 0.05], [0.1, 0.905, -0.15], '#7FA35B', 'matte', segments=6)]
trunk = [[-0.02, 0.9, -0.18], [0.05, 0.99, -0.19], [-0.03, 1.08, -0.17], [0.02, 1.17, -0.18], [0.09, 1.22, -0.2]]
for a, b, t in zip(trunk, trunk[1:], (0.06, 0.05, 0.045, 0.035)):
    bb.append(rod(a, b, t, '#6E5340', 'bark'))
bb += [rod([0.05, 0.99, -0.19], [-0.15, 1.05, -0.15], 0.025, '#6E5340', 'bark'),
       rod([-0.03, 1.08, -0.17], [0.16, 1.11, -0.2], 0.02, '#6E5340', 'bark')]
for at, size in [([-0.17, 1.08, -0.15], [0.2, 0.07, 0.16]), ([0.18, 1.14, -0.2], [0.18, 0.07, 0.15]),
                 ([0.08, 1.26, -0.2], [0.22, 0.08, 0.18]), ([-0.04, 1.19, -0.16], [0.14, 0.06, 0.12])]:
    bb.append(part('blob', size, at, '#4F7F3E', 'foliage', noise=0.12))
bb += [torus([0.1, 0.03, 0.1], [0.3, 0.835, -0.05], '#B87333', 'metal'),                 # copper wire
       lathe([0.08, 0.2, 0.08], [-0.32, 0.92, -0.06], '#F2F2F0', 'gloss',
             profile=[[0, -0.5], [0.5, -0.5], [0.5, 0.25], [0.2, 0.35], [0.2, 0.5], [0, 0.5]]),  # mister
       box([0.012, 0.01, 0.12], [0.26, 0.826, -0.3], '#3A3D41', 'metal', rotate=[0, 25, 0]),       # shears
       box([0.012, 0.01, 0.12], [0.29, 0.826, -0.3], '#3A3D41', 'metal', rotate=[0, -10, 0])]
for x, h in [(-0.25, 0.14), (0.0, 0.12), (0.24, 0.16)]:                                   # spare pots below
    bb.append(lathe([0.18, h, 0.18], [x, 0.275 + h / 2, -0.2], TERRA, 'satin',
                    profile=[[0, -0.5], [0.36, -0.5], [0.5, 0.5], [0.44, 0.5], [0.3, -0.35], [0, -0.35]]))
bb.append(box([0.24, 0.3, 0.14], [0.26, 0.15, 0.25], '#C9B48C', 'fabric', radius=0.03))   # soil sack
E['model.loner.bonsaiBench'] = placeholder(bb)

# ---- Cedar sauna for one (1x2): seated at z = 0 inside, glass front ----------------------------
sa = [box([0.9, 0.06, 1.36], [0, 0.03, -0.25], CEDARD, 'wood', radius=0.01),
      box([0.86, 1.96, 0.05], [0, 1.04, -0.905], CEDAR, 'wood', radius=0.01),           # back wall
      box([0.9, 0.07, 1.38], [0, 2.05, -0.25], CEDARD, 'wood', radius=0.015)]           # roof
for s in (-1, 1):
    x = s * 0.425
    sa += [box([0.04, 1.0, 1.36], [x, 0.56, -0.25], CEDAR, 'wood', radius=0.008),          # lower side walls
           box([0.04, 0.12, 1.36], [x, 1.95, -0.25], CEDAR, 'wood', radius=0.008),
           box([0.02, 0.84, 1.24], [x, 1.47, -0.25], '#DCE6E8', 'glass'),                  # side windows
           box([0.05, 0.05, 1.36], [x, 1.07, -0.25], CEDARD, 'wood', radius=0.008),
           box([0.05, 1.96, 0.06], [x, 1.04, 0.41], CEDARD, 'wood', radius=0.01),          # front posts
           box([0.05, 1.96, 0.06], [x, 1.04, -0.9], CEDARD, 'wood', radius=0.01)]
sa += [box([0.8, 1.86, 0.02], [0, 1.0, 0.42], '#DCE6E8', 'glass'),                         # glass door
       box([0.82, 0.06, 0.05], [0, 1.96, 0.41], CEDARD, 'wood', radius=0.01),
       box([0.04, 0.5, 0.05], [0.3, 1.05, 0.44], CEDARD, 'wood', radius=0.015)]           # door handle
for z in (-0.16, -0.06, 0.04, 0.14):                                                       # bench slats (top 0.45)
    sa.append(box([0.78, 0.035, 0.08], [0, 0.432, z], CEDAR, 'wood', radius=0.008))
sa += [box([0.78, 0.38, 0.03], [0, 0.22, 0.17], CEDARD, 'wood', radius=0.008),
       box([0.78, 0.035, 0.26], [0, 0.82, -0.45], CEDAR, 'wood', radius=0.008),           # upper tier
       box([0.78, 0.4, 0.03], [0, 0.62, -0.31], CEDARD, 'wood', radius=0.008)]
for y in (0.6, 0.72):                                                                       # backrest slats
    sa.append(box([0.74, 0.05, 0.02], [0, y, -0.29], CEDAR, 'wood', radius=0.008))
sa += [box([0.3, 0.42, 0.24], [0.22, 0.27, -0.73], '#7E8389', 'metal', radius=0.02),       # heater
       box([0.3, 0.04, 0.24], [0.22, 0.5, -0.73], '#5C6168', 'metal', radius=0.01)]
for i, (dx, dz) in enumerate([(-0.07, -0.06), (0.06, -0.05), (0.0, 0.05), (-0.08, 0.06), (0.08, 0.06), (0.0, -0.01)]):
    sa.append(part('blob', [0.09, 0.07, 0.09], [0.22 + dx, 0.55, -0.73 + dz], '#9C9A95' if i % 2 else '#7F7C77', 'matte', noise=0.15))
sa += [lathe([0.2, 0.18, 0.2], [-0.22, 0.15, -0.73], CEDAR, 'wood',
             profile=[[0, -0.5], [0.42, -0.5], [0.5, 0.5], [0.45, 0.5], [0.38, -0.4], [0, -0.4]]),   # bucket
       torus([0.2, 0.02, 0.2], [-0.22, 0.2, -0.73], '#B87333', 'metal'),
       rod([-0.22, 0.12, -0.73], [-0.15, 0.36, -0.68], 0.018, CEDARD, 'wood'),                 # ladle
       box([0.3, 0.1, 0.06], [0, 1.8, -0.86], '#FFE2B0', 'gloss', radius=0.02),               # lamp
       cyl([0.12, 0.02, 0.12], [-0.3, 1.5, -0.87], '#F4EFE2', 'satin', rotate=[90, 0, 0]),   # thermometer
       box([0.5, 0.02, 0.3], [0, 0.47, -0.05], '#F4EFE2', 'fabric', radius=0.006)]             # towel
E['model.loner.soloSauna'] = placeholder(sa)

# ---- No-knock delivery hatch (1x1): wall unit with a hatch, ledge and order screen ------------
dh = [box([0.82, 1.9, 0.26], [0, 0.95, -0.32], SLATE, 'satin', radius=0.02),
      box([0.84, 0.05, 0.27], [0, 1.925, -0.315], OAK, 'wood', radius=0.01),
      box([0.52, 0.42, 0.03], [0, 1.18, -0.18], '#C9CDD1', 'metal', radius=0.02),        # hatch door
      box([0.3, 0.16, 0.004], [0, 1.24, -0.163], '#3E5B78', 'gloss', radius=0.01),       # hatch window
      box([0.3, 0.025, 0.03], [0, 1.06, -0.15], CHROME, 'chrome', radius=0.01),          # handle
      box([0.66, 0.035, 0.26], [0, 0.94, -0.06], OAK, 'wood', radius=0.01),              # ledge
      box([0.04, 0.12, 0.2], [-0.28, 0.87, -0.08], OAKD, 'wood', radius=0.01),
      box([0.04, 0.12, 0.2], [0.28, 0.87, -0.08], OAKD, 'wood', radius=0.01),
      box([0.2, 0.26, 0.14], [-0.14, 1.09, -0.06], '#C9A27A', 'matte', radius=0.008),    # paper bag
      box([0.2, 0.04, 0.12], [-0.14, 1.235, -0.06], '#B48C62', 'matte', radius=0.008, rotate=[0, 0, 4]),
      box([0.08, 0.06, 0.004], [-0.14, 1.1, 0.012], TERRA, 'gloss', radius=0.01),         # sticker
      lathe([0.09, 0.16, 0.09], [0.14, 1.04, -0.04], '#F2F2F0', 'satin',
            profile=[[0, -0.5], [0.36, -0.5], [0.5, 0.4], [0.5, 0.5], [0, 0.5]]),          # drink cup
      rod([0.15, 1.1, -0.04], [0.17, 1.2, -0.05], 0.01, '#C8402F', 'gloss'),
      box([0.22, 0.15, 0.02], [0.24, 1.55, -0.18], '#1F3A40', 'gloss', radius=0.012),    # order screen
      box([0.18, 0.02, 0.004], [0.24, 1.58, -0.168], '#7FD1C4', 'gloss', radius=0.004),
      box([0.12, 0.02, 0.004], [0.24, 1.53, -0.168], '#F2B84B', 'gloss', radius=0.004),
      box([0.26, 0.09, 0.012], [-0.18, 1.55, -0.185], '#F4EFE2', 'satin', radius=0.01),   # "no knock" plaque
      box([0.2, 0.012, 0.004], [-0.18, 1.55, -0.178], '#C8402F', 'gloss'),
      box([0.62, 0.3, 0.02], [0, 0.4, -0.18], '#9AAAB7', 'satin', radius=0.01),          # parcel drawer
      box([0.2, 0.02, 0.03], [0, 0.48, -0.16], CHROME, 'chrome', radius=0.008),
      box([0.62, 0.012, 0.42], [0, 0.006, 0.2], '#8E7F6A', 'fabric', radius=0.004)]      # mat
E['model.loner.deliveryHatch'] = placeholder(dh)


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
