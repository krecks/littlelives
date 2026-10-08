# Bounding box, triangle count and footprint fit for a glTF/GLB model.
#
# usage: python3 -I gltf_bbox.py <model.gltf|.glb> [--fit W D] [--front +z|-z|+x|-x]
#                                 [--margin 0.05] [--scale S] [--height H] [--up] [--views out.png]
#
# Prints triangles, materials, draw primitives, disk size and the bounding box in glTF space
# (node TRS hierarchy applied to the vertex positions; falls back to accessor min/max corners).
# With --fit it also prints a manifest `scale` / `rotationY` / `offset` that puts the model's
# footprint centre at the origin, its bottom at y=0 and its front (given in glTF axes) at +Z,
# matching render/babylon/models.ts: Babylon's glTF root maps glTF (x,y,z) to (-x,y,z), then the
# entry applies scale, rotation about +Y (degrees, left-handed) and the offset, in that order.
# Scale defaults to the largest uniform scale <= 1 that fits W x D minus the margin on each side
# (--up allows > 1, --height H targets a height, --scale S forces a value).
# --views writes depth-shaded front (from +Z) and side (from +X) views of the fitted model as the
# game shows it (needs Pillow).
import json, math, os, struct, sys

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load(path):
    raw = open(path, 'rb').read()
    bins = {}
    if raw[:4] == b'glTF':
        off, doc = 12, None
        while off < len(raw):
            ln, typ = struct.unpack_from('<II', raw, off)
            chunk = raw[off + 8: off + 8 + ln]
            if typ == 0x4E4F534A: doc = json.loads(chunk)
            elif typ == 0x004E4942: bins[0] = chunk
            off += 8 + ln
    else:
        doc = json.loads(raw)
    base = os.path.dirname(os.path.abspath(path))
    for i, b in enumerate(doc.get('buffers', [])):
        if 'uri' in b and not b['uri'].startswith('data:'):
            p = os.path.normpath(os.path.join(base, b['uri']))
            if os.path.exists(p): bins[i] = open(p, 'rb').read()
    return doc, bins, base


def read_accessor(doc, bins, idx):
    a = doc['accessors'][idx]
    if 'bufferView' not in a: return None
    bv = doc['bufferViews'][a['bufferView']]
    data = bins.get(bv.get('buffer', 0))
    if data is None: return None
    fmt, size = COMP[a['componentType']]
    n = NCOMP[a['type']]
    stride = bv.get('byteStride') or size * n
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = []
    for i in range(a['count']):
        out.append(struct.unpack_from('<' + fmt * n, data, start + i * stride))
    return out


def mat_mul(a, b):  # 4x4 column-major lists (glTF convention)
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def node_matrix(n):
    if 'matrix' in n: return list(n['matrix'])
    tx, ty, tz = n.get('translation', [0, 0, 0])
    qx, qy, qz, qw = n.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = n.get('scale', [1, 1, 1])
    r = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
         2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
         2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy)]
    return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[3] * sy, r[4] * sy, r[5] * sy, 0,
            r[6] * sz, r[7] * sz, r[8] * sz, 0, tx, ty, tz, 1]


def xf(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


def analyse(path):
    doc, bins, base = load(path)
    scene = doc['scenes'][doc.get('scene', 0)] if doc.get('scenes') else {'nodes': list(range(len(doc.get('nodes', []))))}
    pts, faces, tris, prims, mats, exact = [], [], 0, 0, set(), True
    stack = [(i, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) for i in scene['nodes']]
    while stack:
        i, parent = stack.pop()
        n = doc['nodes'][i]
        m = mat_mul(parent, node_matrix(n))
        for c in n.get('children', []): stack.append((c, m))
        if 'mesh' not in n: continue
        for p in doc['meshes'][n['mesh']]['primitives']:
            prims += 1
            mats.add(p.get('material', -1))
            pa = p['attributes']['POSITION']
            acc = doc['accessors'][pa]
            if p.get('mode', 4) == 4:
                tris += (doc['accessors'][p['indices']]['count'] if 'indices' in p else acc['count']) // 3
            v = read_accessor(doc, bins, pa)
            if v is None:
                exact = False
                lo, hi = acc['min'], acc['max']
                v = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
            base_i = len(pts)
            pts.extend(xf(m, q) for q in v)
            if p.get('mode', 4) == 4 and r_ok(v, acc):
                idx = [t[0] for t in read_accessor(doc, bins, p['indices'])] if 'indices' in p else list(range(len(v)))
                faces.extend((base_i + idx[k], base_i + idx[k + 1], base_i + idx[k + 2]) for k in range(0, len(idx) - 2, 3))
    size = 0
    files = {path}
    for b in doc.get('buffers', []):
        if 'uri' in b and not b['uri'].startswith('data:'): files.add(os.path.join(base, b['uri']))
    for im in doc.get('images', []):
        if 'uri' in im and not im['uri'].startswith('data:'): files.add(os.path.join(base, im['uri']))
    for f in files:
        if os.path.exists(f): size += os.path.getsize(f)
    return dict(points=pts, faces=faces, tris=tris, prims=prims, materials=len(mats), exact=exact, bytes=size,
                textures=len(doc.get('images', [])))


def r_ok(v, acc):
    return len(v) == acc['count']


def bbox(pts):
    return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]


FRONT_ROT = {'+z': 0, '-z': 180, '+x': 90, '-x': -90}  # glTF-space front -> manifest rotationY


def to_game(pts, s, deg, off=(0, 0, 0)):
    c, sn = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    out = []
    for x, y, z in pts:
        bx, by, bz = -x * s, y * s, z * s  # Babylon root flip, then entry scale
        out.append((bx * c + bz * sn + off[0], by + off[1], -bx * sn + bz * c + off[2]))
    return out


def views(pts, faces, png, W, D):
    """Flat-shaded front (from +Z) and side (from +X) renders of the fitted model."""
    from PIL import Image, ImageDraw
    px = 160  # pixels per metre
    lo, hi = bbox(pts)
    Hm = max(hi[1], 1.0) + 0.1
    def panel(axis, depth_axis, span, flip):
        w, h = int((span + 0.4) * px), int(Hm * px) + 20
        im = Image.new("RGB", (w, h), (170, 200, 235)); d = ImageDraw.Draw(im)
        cx = w // 2
        def uv(p): return ((-p[axis] if flip else p[axis]) * px + cx, h - 20 - p[1] * px)
        order = sorted(faces, key=lambda f: sum(pts[i][depth_axis] for i in f))
        for f in order:
            a, b, c = (pts[i] for i in f)
            t = (sum(q[depth_axis] for q in (a, b, c)) / 3 - lo[depth_axis]) / ((hi[depth_axis] - lo[depth_axis]) or 1)
            g = int(50 + 190 * t)  # depth shading: near the viewer light, far dark
            d.polygon([uv(a), uv(b), uv(c)], fill=(g, g, g))
        d.rectangle([cx - span / 2 * px, 0, cx + span / 2 * px, h - 20], outline=(90, 90, 230))
        return im
    # Babylon is left-handed: seen from +Z, +X is on the left; seen from +X, +Z is on the right.
    a = panel(0, 2, W, True)
    b = panel(2, 0, D, False)
    out = Image.new('RGB', (a.width + b.width + 10, max(a.height, b.height)), 'white')
    out.paste(a, (0, 0)); out.paste(b, (a.width + 10, 0))
    d = ImageDraw.Draw(out)
    d.text((4, out.height - 16), 'front view (from +Z)', fill='black')
    d.text((a.width + 14, out.height - 16), 'side view from +X: front(+Z) is RIGHT', fill='black')
    out.save(png)


def main(argv):
    path, args = argv[0], argv[1:]
    def opt(name, n=1, default=None):
        if name not in args: return default
        i = args.index(name)
        return args[i + 1: i + 1 + n] if n > 1 else (args[i + 1] if n == 1 else True)
    r = analyse(path)
    lo, hi = bbox(r['points'])
    dims = [hi[i] - lo[i] for i in range(3)]
    print(f"{path}\n  tris {r['tris']}  primitives {r['prims']}  materials {r['materials']}  textures {r['textures']}"
          f"  size {r['bytes'] / 1e6:.2f} MB  bbox {'exact' if r['exact'] else 'from accessor min/max'}")
    print('  glTF bbox min [%.3f %.3f %.3f] max [%.3f %.3f %.3f]' % (*lo, *hi))
    print('  glTF dims x %.3f  y %.3f  z %.3f' % tuple(dims))
    fit = opt('--fit', 2)
    if not fit: return
    W, D = float(fit[0]), float(fit[1])
    margin = float(opt('--margin', 1, 0.05))
    deg = FRONT_ROT[opt('--front', 1, '+z')]
    g = to_game(r['points'], 1, deg)
    glo, ghi = bbox(g)
    w, h, d = ghi[0] - glo[0], ghi[1] - glo[1], ghi[2] - glo[2]
    if opt('--scale'): s = float(opt('--scale'))
    else:
        s = min((W - 2 * margin) / w, (D - 2 * margin) / d)
        if opt('--height'): s = min(s, float(opt('--height')) / h)
        elif not opt('--up', 0): s = min(s, 1.0)
        s = math.floor(s * 1e4) / 1e4
    g = to_game(r['points'], s, deg)
    glo, ghi = bbox(g)
    off = [round(-(glo[0] + ghi[0]) / 2, 4), round(-glo[1], 4), round(-(glo[2] + ghi[2]) / 2, 4)]
    off = [0.0 if abs(v) < 5e-4 else v for v in off]
    g = to_game(r['points'], s, deg, off)
    glo, ghi = bbox(g)
    fw, fh, fd = ghi[0] - glo[0], ghi[1] - glo[1], ghi[2] - glo[2]
    ok = fw <= W - 2 * margin + 1e-4 and fd <= D - 2 * margin + 1e-4
    print(json.dumps({'scale': s, 'rotationY': deg, 'offset': off}))
    print('  fitted w %.3f  h %.3f  d %.3f  in %gx%g footprint: %s' % (fw, fh, fd, W, D, 'fits' if ok else 'DOES NOT FIT'))
    png = opt('--views')
    if png: views(g, r['faces'], png, W, D); print('  views ->', png)


if __name__ == '__main__':
    if len(sys.argv) < 2: sys.exit(__doc__ or 'usage: gltf_bbox.py <model.gltf> [--fit W D] ...')
    main(sys.argv[1:])
