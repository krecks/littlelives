# Shared building blocks for the personality-pack model generators (pack_<trait>.py) and the
# run() step that validates footprints and writes a pack manifest via apply_pack.py.
# Same conventions as furniture.py: 1 unit = 1 m, origin at the footprint centre on the floor,
# front = +Z, back against the wall at -Z.
import json, math, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from furniture import box, cyl, cone, sph, rod, part, lathe, torus, cushion, validate_parts  # noqa: E402

CONTENT = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'public', 'content', 'packs'))
LIB = '../../models/'        # library files relative to a pack manifest

# Lathe profiles (unit space: radius 0..0.5, y -0.5..0.5; outer surface walked upwards).
BOWL = [[0.0, -0.5], [0.3, -0.5], [0.44, -0.2], [0.5, 0.5], [0.46, 0.5], [0.4, -0.15], [0.27, -0.4], [0.0, -0.4]]
TUB = [[0.0, -0.5], [0.44, -0.5], [0.49, -0.3], [0.5, 0.45], [0.48, 0.5], [0.43, 0.5], [0.42, 0.42], [0.38, -0.32], [0.0, -0.36]]
JAR = [[0.0, -0.5], [0.42, -0.5], [0.5, -0.42], [0.5, 0.3], [0.38, 0.42], [0.3, 0.5], [0.0, 0.5]]
POT = [[0.0, -0.5], [0.36, -0.5], [0.5, 0.36], [0.5, 0.5], [0.45, 0.5], [0.33, -0.38], [0.0, -0.38]]
DOME = [[0.0, -0.5], [0.5, -0.5], [0.5, 0.1], [0.42, 0.33], [0.25, 0.46], [0.0, 0.5]]
VASE = [[0.0, -0.5], [0.3, -0.5], [0.5, -0.1], [0.42, 0.25], [0.2, 0.42], [0.24, 0.5], [0.18, 0.5], [0.0, 0.3]]
NET = [[0.5, 0.5], [0.42, 0.1], [0.33, -0.5], [0.3, -0.5], [0.4, 0.1], [0.47, 0.5]]


def candle(x, y, z, h=0.12, d=0.05, color='#F3EAD8'):
    """A lit pillar candle standing on y."""
    return [cyl([d, h, d], [x, y + h / 2, z], color, 'satin', segments=12),
            sph([0.018, 0.04, 0.018], [x, y + h + 0.025, z], '#FFC45C', 'gloss', segments=8)]


def glass_with_drink(x, y, z, drink, h=0.12, d=0.07):
    return [lathe([d, h, d], [x, y + h / 2, z], '#E6F0F2', 'glass', JAR, segments=14),
            cyl([d * 0.84, h * 0.7, d * 0.84], [x, y + h * 0.36, z], drink, 'gloss', segments=12)]


def leafy(x, y, z, s, color='#5E8F4E', n=3, seed=0):
    """A small cluster of foliage blobs centred at (x, y, z) with overall size s."""
    out = []
    for i in range(n):
        a = (i * 2.4 + seed) % (2 * math.pi)
        r = s * 0.22 if n > 1 else 0
        out.append(part('blob', [s * 0.6, s * 0.5, s * 0.6], [x + math.cos(a) * r, y + (i % 2) * s * 0.12, z + math.sin(a) * r],
                        color, 'foliage', noise=0.22))
    return out


def sling(x0, x1, y_end, y_low, zc, width, colors, segs=10, t=0.025):
    """A sagging fabric sling (hammock bed) spanning x0..x1, striped across its width (z)."""
    out = []
    stripes = len(colors)
    for i in range(segs):
        u0, u1 = i / segs, (i + 1) / segs
        xa, xb = x0 + (x1 - x0) * u0, x0 + (x1 - x0) * u1
        ya = y_low + (y_end - y_low) * (2 * u0 - 1) ** 2
        yb = y_low + (y_end - y_low) * (2 * u1 - 1) ** 2
        length = math.hypot(xb - xa, yb - ya) + 0.004
        ang = math.degrees(math.atan2(yb - ya, xb - xa))
        for j, c in enumerate(colors):
            zw = width / stripes
            z = zc - width / 2 + zw * (j + 0.5)
            out.append(box([length, t, zw + 0.002], [(xa + xb) / 2, (ya + yb) / 2, z], c, 'fabric', radius=0.004, rotate=[0, 0, ang]))
    return out


def arc_beam(cx, cy, r, a0, a1, z, t, color, finish='wood', segs=8, t2=None):
    """A curved beam in the x-y plane: circle arc (degrees, 0 = +x, 90 = up) built from straight pieces."""
    out = []
    for i in range(segs):
        p0 = math.radians(a0 + (a1 - a0) * i / segs)
        p1 = math.radians(a0 + (a1 - a0) * (i + 1) / segs)
        a = [cx + r * math.cos(p0), cy + r * math.sin(p0), z]
        b = [cx + r * math.cos(p1), cy + r * math.sin(p1), z]
        out.append(rod(a, b, t, color, finish, shape='box', t2=t2 or t, radius=min(t, t2 or t) * 0.3))
    return out


def _lathe_as_box(p):
    """Exact-ish bounds of a lathe part (sampled profile, scaled and rotated) as an unrotated box."""
    from objects_extra import rot, add
    sx, sy, sz = p['size']
    pts = []
    for r, y in p['profile']:
        for k in range(24):
            a = k / 24 * 2 * math.pi
            v = [r * math.cos(a) * sx, y * sy, r * math.sin(a) * sz]
            pts.append(add(p['at'], rot(v, p.get('rotate', [0, 0, 0]))))
    lo = [min(q[i] for q in pts) for i in range(3)]
    hi = [max(q[i] for q in pts) for i in range(3)]
    q = dict(p, shape='box', size=[max(1e-4, hi[i] - lo[i]) for i in range(3)], at=[(lo[i] + hi[i]) / 2 for i in range(3)])
    q.pop('rotate', None)
    q.pop('profile', None)
    return q


def footprints(trait):
    doc = json.load(open(os.path.join(CONTENT, f'{trait}.json')))
    return {o['model']: tuple(o['footprint']) for o in doc.get('objects', [])}


def run(trait, E, out=None):
    """Validate every entry against its object's footprint, write JSON and apply it to the pack."""
    fp = footprints(trait)
    bad = 0
    for k, e in E.items():
        assert k in fp, f'{k} is not an object model of {trait}'
        parts = e.get('parts', []) if 'url' in e else e['placeholder']
        issues = validate_parts(k, [_lathe_as_box(q) if q['shape'] == 'lathe' else q for q in parts], fp[k])
        if 'url' in e:
            w, h, d = e['fit']
            if w > fp[k][0] - 0.08 + 1e-6 or d > fp[k][1] - 0.08 + 1e-6: issues.append(f'fit {e["fit"]} exceeds {fp[k]}')
        fins = sorted({p['material'].split('.')[-1] for p in parts})
        print(f'{k:36s} {fp[k]} {"glTF " + e["url"].split("/")[-1] + " + " if "url" in e else ""}{len(parts)} parts {",".join(fins)}')
        for s in issues: print('   !', s)
        bad += len(issues)
    missing = sorted(set(fp) - set(E))
    if missing: print('   ! not generated:', missing)
    out = out or os.path.join(os.environ.get('TMPDIR', '/tmp'), f'pack_{trait}.json')
    json.dump(E, open(out, 'w'), indent=2)
    print(f'{len(E)} entries -> {out}; {bad} issue(s)')
    if bad == 0 and '--apply' in sys.argv:
        subprocess.run([sys.executable, '-I', os.path.join(HERE, 'apply_pack.py'), trait, out], check=True)
    return bad
