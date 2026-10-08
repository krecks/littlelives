# Hot-headed pack models (`model.hotHeaded.*`): heavy punching bag, plate-smash crate, rock drum
# kit, cool-down meditation cushion, grudge journal desk, cold-plunge tub. Primitive parts plus the
# Poly Haven wooden crate (CC0). Fiery reds and oranges against light steel and cool calming blues.
# Conventions as furniture.py: 1 unit = 1 m, origin at the footprint centre on the floor, front +Z,
# back against the wall at -Z; seats centred on z = 0 with tops at ~0.45 m (DEFAULT_SEAT).
# Run: python3 -I pack_hotHeaded.py [out.json]  then  python3 -I apply_pack.py hotHeaded out.json
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from furniture import (box, cyl, cone, sph, rod, part, lathe, torus, cushion, gltf, placeholder,  # noqa: E402
                       validate_parts, CHROME, BRASS, OAK, OAKD, WHITE, CREAM, HONEY)

TRAIT = 'hotHeaded'
FOOT = {o['model']: tuple(o['footprint']) for o in
        json.load(open(os.path.join(HERE, '..', '..', 'web', 'public', 'content', 'packs', TRAIT + '.json')))['objects']}
LIB = '../../models/'
E = {}

FIRE, EMBER, FLAME, STEEL, STEELD, CALM, CALML, OAT = '#C8402F', '#E07A2E', '#F2B84B', '#AEB4BA', '#7E858C', '#5F7FA0', '#A9C2D6', '#E6DCC8'


def chair(z=0.0, wood=OAK, seat=FIRE):
    p = [box([0.42, 0.04, 0.4], [0, 0.405, z], wood, 'wood', radius=0.012),
         cushion([0.38, 0.04, 0.36], [0, 0.445, z + 0.01], seat, radius=0.018),
         cushion([0.4, 0.3, 0.06], [0, 0.74, z - 0.19], seat, rotate=[-6, 0, 0], radius=0.025)]
    for x in (-0.18, 0.18):
        p += [box([0.035, 0.39, 0.035], [x, 0.195, z + 0.16], wood, 'wood', radius=0.008),
              box([0.035, 0.9, 0.035], [x, 0.45, z - 0.18], wood, 'wood', radius=0.008)]
    return p


# ---- Heavy bag on a free-standing frame (1x1) --------------------------------------------------
hb = [box([0.86, 0.012, 0.86], [0, 0.006, 0], '#3E4A55', 'fabric', radius=0.004),          # mat
      box([0.08, 0.06, 0.8], [0, 0.04, -0.05], STEELD, 'metal', radius=0.012),             # base
      box([0.7, 0.06, 0.08], [0, 0.04, -0.36], STEELD, 'metal', radius=0.012),
      box([0.08, 2.0, 0.08], [0, 1.0, -0.38], STEEL, 'metal', radius=0.015),               # upright
      rod([0, 0.4, -0.38], [0, 0.07, 0.1], 0.05, STEEL, 'metal', shape='box', t2=0.05, radius=0.01),  # brace
      box([0.08, 0.08, 0.5], [0, 1.96, -0.15], STEEL, 'metal', radius=0.015)]              # boom
for s in (-1, 1):
    hb += [cyl([0.26, 0.05, 0.26], [s * 0.2, 0.17, -0.32], FIRE if s < 0 else '#2F3236', 'satin', rotate=[0, 0, 90]),  # plates
           rod([0, 1.94, 0.08], [s * 0.1, 1.72, 0.08], 0.01, CHROME, 'chrome')]          # chains
hb += [rod([0, 1.94, 0.08], [0, 1.72, 0.18], 0.01, CHROME, 'chrome'),
       cyl([0.06, 0.04, 0.06], [0, 1.7, 0.1], CHROME, 'chrome'),
       part('capsule', [0.38, 1.0, 0.38], [0, 1.18, 0.1], FIRE, 'satin'),                   # bag
       cyl([0.39, 0.06, 0.39], [0, 1.5, 0.1], '#2F3236', 'satin'),                          # straps
       cyl([0.39, 0.06, 0.39], [0, 0.86, 0.1], '#2F3236', 'satin'),
       box([0.1, 0.22, 0.01], [0, 1.18, 0.295], FLAME, 'gloss', radius=0.01)]              # logo
for x in (-0.3, -0.18):                                                                       # gloves on a hook
    hb += [sph([0.13, 0.15, 0.11], [x + 0.06, 1.18, -0.3], FIRE, 'satin', segments=10),
           cyl([0.1, 0.08, 0.09], [x + 0.06, 1.07, -0.3], '#F2F2F0', 'satin')]
hb.append(box([0.18, 0.02, 0.04], [-0.12, 1.32, -0.33], STEEL, 'metal', radius=0.008))
E['model.hotHeaded.heavyBag'] = placeholder(hb)

# ---- Plate-smash crate (1x1): padded crate (Poly Haven), stack of plates, goggles ------------
sm = [box([0.84, 0.012, 0.84], [0, 0.006, 0], '#3E4A55', 'fabric', radius=0.004),
      box([0.6, 0.05, 0.03], [-0.08, 0.26, 0.13], FLAME, 'gloss', radius=0.006),          # hazard tape
      box([0.6, 0.05, 0.031], [-0.08, 0.36, 0.13], '#2F3236', 'gloss', radius=0.006)]
for i in range(5):
    sm.append(box([0.1, 0.05, 0.032], [-0.32 + i * 0.12, 0.36, 0.131], FLAME, 'gloss', radius=0.006))
# stool with a stack of thrift-store plates
sm += [cyl([0.3, 0.03, 0.3], [0.28, 0.46, 0.22], OAK, 'wood')]
for a in (0, 120, 240):
    r = math.radians(a)
    sm.append(rod([0.28 + 0.1 * math.cos(r), 0.45, 0.22 + 0.1 * math.sin(r)], [0.28 + 0.12 * math.cos(r), 0.015, 0.22 + 0.12 * math.sin(r)], 0.03, OAK, 'wood'))
for i, c in enumerate(['#F4F1EA', '#9CC3DB', '#F4F1EA', '#F2D7A0', '#F4F1EA', '#C8E0C0', '#F4F1EA']):
    sm.append(cyl([0.24, 0.018, 0.24], [0.28 + (i % 2) * 0.008, 0.484 + i * 0.02, 0.22], c, 'gloss', taper=0.85))
for x, z, r in [(-0.3, 0.32, 20), (-0.15, 0.36, -40), (0.05, 0.38, 70), (-0.38, 0.22, 10)]:
    sm.append(box([0.08, 0.012, 0.05], [x, 0.018, z], '#F4F1EA', 'gloss', radius=0.003, rotate=[0, r, 8]))  # shards
sm += [torus([0.18, 0.025, 0.08], [-0.15, 0.62, -0.15], '#2F3236', 'satin'),               # goggles
       box([0.16, 0.05, 0.05], [-0.15, 0.62, -0.13], '#F2B84B', 'glass', radius=0.02)]
E['model.hotHeaded.smashBin'] = gltf(LIB + 'ph/wooden_crate_01.glb', [0.66, 0.6, 0.52], align='back', offset=[-0.08, 0, 0.05],
                                     parts=sm, placeholder=[box([0.66, 0.6, 0.52], [-0.08, 0.3, -0.19], '#9C6B43', 'wood', radius=0.02)] + sm)

# ---- Thunder drum kit (2x1): drummer on a throne at z = 0, kit in front --------------------------
SHELL, HOOP, HEAD, CYM = FIRE, CHROME, '#F4F1EA', '#C9A24A'


def drum(at, dia, depth, axis='y', tilt=0.0):
    """A drum shell with chrome hoops and a white head; axis y = snare/tom, z = bass drum."""
    x, y, z = at
    rot = [90, 0, 0] if axis == 'z' else [tilt, 0, 0]
    p = [cyl([dia, depth, dia], at, SHELL, 'gloss', rotate=rot, segments=24),
         cyl([dia * 0.96, depth + 0.006, dia * 0.96], at, HEAD, 'satin', rotate=rot, segments=24)]
    off = depth / 2
    for sgn in (-1, 1):
        if axis == 'z':
            p.append(torus([dia + 0.02, 0.02, dia + 0.02], [x, y, z + sgn * off], HOOP, 'chrome', rotate=[90, 0, 0], segments=24))
        else:
            c = math.cos(math.radians(tilt)); s = math.sin(math.radians(tilt))
            p.append(torus([dia + 0.02, 0.02, dia + 0.02], [x, y + sgn * off * c, z + sgn * off * s], HOOP, 'chrome', rotate=[tilt, 0, 0], segments=24))
    return p


def cymbal(x, z, h, d, tilt=8):
    return [cyl([0.02, h, 0.02], [x, h / 2, z], CHROME, 'chrome'),
            cone([0.3, 0.06, 0.3], [x, 0.03, z], CHROME, 'chrome', taper=0.1),
            cone([d, 0.03, d], [x, h + 0.015, z], CYM, 'metal', taper=0.15, rotate=[tilt, 0, 0], segments=24)]


dk = [box([1.88, 0.012, 0.9], [0, 0.006, 0], '#6E3A2E', 'fabric', radius=0.004)]         # rug
dk += drum([0.0, 0.27, 0.27], 0.52, 0.34, axis='z')                                         # bass drum
dk += [cyl([0.2, 0.012, 0.2], [0.0, 0.27, 0.443], FLAME, 'gloss', rotate=[90, 0, 0])]       # logo on the front head
dk += drum([-0.15, 0.68, 0.24], 0.26, 0.18, tilt=-18) + drum([0.15, 0.68, 0.24], 0.28, 0.2, tilt=-18)  # rack toms
dk += drum([0.42, 0.42, 0.12], 0.38, 0.34) + drum([-0.32, 0.6, 0.14], 0.34, 0.14, tilt=-6)  # floor tom, snare
for x in (0.32, 0.52):
    dk.append(cyl([0.025, 0.25, 0.025], [x, 0.125, 0.12], CHROME, 'chrome'))
dk += [cyl([0.02, 0.5, 0.02], [-0.32, 0.27, 0.14], CHROME, 'chrome'),
       rod([0.0, 0.44, 0.27], [0.0, 0.6, 0.25], 0.03, CHROME, 'chrome')]
dk += cymbal(-0.62, 0.12, 0.86, 0.32, tilt=0) + [cone([0.32, 0.03, 0.32], [-0.62, 0.83, 0.12], CYM, 'metal', taper=0.15, segments=24, rotate=[180, 0, 0])]  # hi-hat
dk += cymbal(-0.45, 0.2, 1.22, 0.38, tilt=14) + cymbal(0.68, 0.18, 1.12, 0.42, tilt=12)    # crash, ride
dk += [cyl([0.36, 0.06, 0.36], [0, 0.44, 0.0], '#2F3236', 'satin', segments=20),             # throne (top 0.47)
       torus([0.36, 0.04, 0.36], [0, 0.44, 0.0], '#3E4A55', 'satin'),
       cyl([0.04, 0.38, 0.04], [0, 0.2, 0.0], CHROME, 'chrome')]
for a in (90, 210, 330):
    r = math.radians(a)
    dk.append(rod([0, 0.12, 0], [0.22 * math.cos(r), 0.012, 0.22 * math.sin(r)], 0.02, CHROME, 'chrome'))
dk += [box([0.012, 0.012, 0.36], [0.22, 0.47, 0.06], '#D9B98A', 'wood', rotate=[0, 20, 0]),   # sticks
       box([0.012, 0.012, 0.36], [0.24, 0.47, 0.03], '#D9B98A', 'wood', rotate=[0, 30, 0]),
       box([0.34, 0.6, 0.3], [0.78, 0.3, -0.28], '#E4E1DA', 'satin', radius=0.03),          # amp/monitor
       cyl([0.22, 0.02, 0.22], [0.78, 0.33, -0.125], '#3A3D41', 'satin', rotate=[90, 0, 0]),
       cyl([0.1, 0.022, 0.1], [0.78, 0.33, -0.122], FIRE, 'gloss', rotate=[90, 0, 0])]
E['model.hotHeaded.thunderDrums'] = placeholder(dk)

# ---- Cool-down cushion (1x1): mat, zabuton and tall zafu (top 0.45), singing bowl, candle ------
cc = [cyl([0.9, 0.012, 0.9], [0, 0.006, 0], CALML, 'fabric', segments=40),
      torus([0.88, 0.015, 0.88], [0, 0.012, 0], CALM, 'fabric', segments=40),
      cushion([0.62, 0.07, 0.58], [0, 0.047, -0.02], OAT, radius=0.03),
      cyl([0.5, 0.34, 0.5], [0, 0.25, 0.0], CALM, 'fabric', segments=28),                    # zafu
      cyl([0.52, 0.06, 0.52], [0, 0.42, 0.0], CALM, 'fabric', taper=0.9, segments=28),
      torus([0.5, 0.03, 0.5], [0, 0.25, 0.0], '#4E6E8E', 'fabric', segments=28)]
for a in range(0, 360, 45):
    r = math.radians(a)
    cc.append(box([0.015, 0.3, 0.02], [0.25 * math.cos(r), 0.25, 0.25 * math.sin(r)], '#4E6E8E', 'fabric', radius=0.005, rotate=[0, -a, 0]))  # pleats
cc += [cyl([0.22, 0.03, 0.22], [0.32, 0.03, 0.3], OAK, 'wood'),                              # bowl stand
       lathe([0.2, 0.1, 0.2], [0.32, 0.095, 0.3], BRASS, 'metal',
             profile=[[0, -0.5], [0.3, -0.5], [0.48, -0.1], [0.5, 0.5], [0.46, 0.5], [0.44, -0.05], [0.28, -0.4], [0, -0.4]]),
       rod([0.2, 0.02, 0.3], [0.08, 0.05, 0.38], 0.018, '#8A5E3C', 'wood'),                   # mallet
       lathe([0.1, 0.12, 0.1], [-0.32, 0.06, 0.3], '#E8F2F2', 'glass',
             profile=[[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0.45, 0.5], [0.45, -0.4], [0, -0.4]]),  # candle glass
       cyl([0.08, 0.07, 0.08], [-0.32, 0.045, 0.3], '#FBF6EC', 'satin'),
       sph([0.02, 0.035, 0.02], [-0.32, 0.1, 0.3], '#FFD27A', 'gloss', segments=8),
       cyl([0.12, 0.1, 0.12], [-0.3, 0.05, -0.32], '#F4F1EA', 'satin', taper=0.8),             # plant
       part('blob', [0.22, 0.2, 0.2], [-0.3, 0.2, -0.32], '#5E8F4E', 'foliage', noise=0.18),
       rod([0.3, 0.0, -0.3], [0.33, 0.2, -0.33], 0.006, '#8A5E3C', 'wood')]                    # incense stick
E['model.hotHeaded.coolDownCushion'] = placeholder(cc)

# ---- Grudge-to-gratitude desk (1x1): seated at z = 0, small desk in front --------------------
gj = [box([0.84, 0.03, 0.3], [0, 0.745, 0.3], OAK, 'wood', radius=0.008),
      box([0.36, 0.16, 0.28], [0.22, 0.65, 0.3], '#E6E3DC', 'satin', radius=0.01),          # drawer box
      box([0.3, 0.012, 0.012], [0.22, 0.66, 0.155], STEELD, 'metal', radius=0.004)]
for x in (-0.39, 0.39):
    for z in (0.18, 0.42):
        gj.append(box([0.035, 0.73, 0.035], [x, 0.365, z], STEELD, 'metal', radius=0.008))
gj += [box([0.34, 0.012, 0.22], [-0.02, 0.766, 0.28], '#F4EFE2', 'matte', radius=0.004),      # open journal
       box([0.36, 0.008, 0.24], [-0.02, 0.761, 0.28], '#7A3A2A', 'satin', radius=0.004),
       box([0.003, 0.014, 0.21], [-0.02, 0.77, 0.28], '#C8C0B0', 'matte'),
       box([0.012, 0.012, 0.15], [0.17, 0.772, 0.24], '#2F3236', 'satin', rotate=[0, 35, 0]),  # pen
       sph([0.07, 0.07, 0.07], [-0.3, 0.8, 0.22], '#F4EFE2', 'matte', segments=6),          # crumpled pages
       sph([0.06, 0.06, 0.06], [-0.25, 0.79, 0.36], '#F4EFE2', 'matte', segments=6),
       sph([0.07, 0.07, 0.07], [0.3, 0.035, 0.3], '#F4EFE2', 'matte', segments=6),
       lathe([0.2, 0.26, 0.2], [-0.32, 0.13, 0.32], STEEL, 'metal',
             profile=[[0, -0.5], [0.42, -0.5], [0.5, 0.5], [0.47, 0.5], [0.4, -0.42], [0, -0.42]]),  # bin
       cyl([0.1, 0.09, 0.1], [0.3, 0.805, 0.38], '#E07A2E', 'satin', taper=0.85),            # cactus
       part('capsule', [0.06, 0.14, 0.06], [0.3, 0.9, 0.38], '#6E9E58', 'satin'),
       cyl([0.11, 0.015, 0.11], [0.32, 0.768, 0.2], '#2F3236', 'satin'),                    # lamp
       rod([0.32, 0.77, 0.2], [0.28, 1.05, 0.26], 0.014, '#2F3236', 'satin'),
       cone([0.12, 0.1, 0.12], [0.24, 1.02, 0.24], FIRE, 'satin', taper=0.4, rotate=[-35, 0, 20])]
gj += chair(0.0, OAK, CALM)
E['model.hotHeaded.grudgeJournal'] = placeholder(gj)

# ---- Cold-plunge tub (1x2): the Sim sits in it at z = 0; chiller at the back ------------------
CED = '#C98B58'
cp = [box([0.84, 0.62, 1.0], [0, 0.31, -0.05], WHITE, 'satin', radius=0.08),
      box([0.86, 0.06, 1.02], [0, 0.03, -0.05], '#7E858C', 'satin', radius=0.02)]
for i in range(8):                                                                            # cedar slat cladding
    cp.append(box([0.86, 0.04, 1.02], [0, 0.1 + i * 0.065, -0.05], CED, 'wood', radius=0.012))
cp += [box([0.74, 0.012, 0.9], [0, 0.59, -0.05], '#BFE6F0', 'gloss', radius=0.06),          # icy water
       box([0.8, 0.03, 0.96], [0, 0.62, -0.05], '#E6E3DC', 'satin', radius=0.03)]
cp[-1] = box([0.06, 0.03, 0.96], [-0.39, 0.625, -0.05], '#E6E3DC', 'satin', radius=0.015)    # rims
cp += [box([0.06, 0.03, 0.96], [0.39, 0.625, -0.05], '#E6E3DC', 'satin', radius=0.015),
       box([0.84, 0.03, 0.06], [0, 0.625, -0.52], '#E6E3DC', 'satin', radius=0.015),
       box([0.84, 0.03, 0.06], [0, 0.625, 0.42], '#E6E3DC', 'satin', radius=0.015)]
for x, z, r in [(-0.2, 0.15, 10), (0.15, -0.3, 40), (0.22, 0.25, -20), (-0.1, -0.2, 70), (0.05, 0.05, 15), (-0.25, -0.38, 30)]:
    cp.append(box([0.06, 0.05, 0.06], [x, 0.605, z], '#F4FAFC', 'gloss', radius=0.012, rotate=[8, r, 5]))  # ice
cp += [box([0.7, 0.62, 0.3], [0, 0.31, -0.78], '#E6E3DC', 'satin', radius=0.03),             # chiller
       box([0.66, 0.4, 0.012], [0, 0.3, -0.627], '#B9BEC3', 'metal', radius=0.01),
       box([0.16, 0.08, 0.012], [0.2, 0.52, -0.625], '#1F3A40', 'gloss', radius=0.008),
       box([0.1, 0.03, 0.004], [0.2, 0.52, -0.618], '#7FD1F0', 'gloss', radius=0.004),
       rod([-0.2, 0.55, -0.64], [-0.2, 0.68, -0.52], 0.04, '#5F6368', 'satin'),               # hoses
       rod([0.0, 0.55, -0.64], [0.0, 0.68, -0.52], 0.04, '#5F6368', 'satin'),
       box([0.4, 0.04, 0.2], [0.18, 0.66, -0.78], '#F4EFE2', 'fabric', radius=0.015),         # towel
       lathe([0.1, 0.25, 0.1], [-0.25, 0.745, -0.78], CALM, 'gloss',
             profile=[[0, -0.5], [0.5, -0.5], [0.5, 0.3], [0.25, 0.4], [0.25, 0.5], [0, 0.5]])]  # bottle
E['model.hotHeaded.coldPlunge'] = placeholder(cp)


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
