# Merge glTF/GLB models into one glTF (model.gltf + the parts' .bin files and textures), e.g. a TV on
# a side table. Also converts a single .glb into the model.gltf + .bin layout.
#
# usage: python3 -I gltf_compose.py <outdir> <part> [<part>...]
#   part = path/to/model.gltf|.glb[@tx,ty,tz[,rotY[,scale]]]   (glTF space: metres, rotY in degrees
#          counter-clockwise seen from above, i.e. +X turns towards -Z; scale is uniform)
# Each part's scene is wrapped in a node with that transform. Buffers/images keep their file names
# (Poly Haven names are unique per asset); a GLB's binary chunk is written as <glb name>.bin.
# Skins and animations are dropped (the game bakes static meshes).
import json, math, os, shutil, struct, sys


def load(path):
    raw = open(path, 'rb').read()
    if raw[:4] != b'glTF': return json.loads(raw), None
    off, doc, bin_ = 12, None, None
    while off < len(raw):
        ln, typ = struct.unpack_from('<II', raw, off)
        chunk = raw[off + 8: off + 8 + ln]
        if typ == 0x4E4F534A: doc = json.loads(chunk)
        elif typ == 0x004E4942: bin_ = chunk
        off += 8 + ln
    return doc, bin_


def remap_textures(obj, toff):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, dict) and k.endswith('Texture') and 'index' in v: v['index'] += toff
            remap_textures(v, toff)
    elif isinstance(obj, list):
        for v in obj: remap_textures(v, toff)


def main(out, parts):
    os.makedirs(out, exist_ok=True)
    M = {'asset': {'version': '2.0', 'generator': 'littlelives gltf_compose.py'}, 'scene': 0,
         'scenes': [{'name': 'Scene', 'nodes': []}]}
    keys = ['buffers', 'bufferViews', 'accessors', 'images', 'samplers', 'textures', 'materials', 'meshes', 'nodes']
    for k in keys: M[k] = []
    used = set()
    copied = {}
    for spec in parts:
        path, _, tr = spec.partition('@')
        vals = [float(v) for v in tr.split(',')] if tr else []
        t = vals[:3] if len(vals) >= 3 else [0, 0, 0]
        ry = vals[3] if len(vals) > 3 else 0
        s = vals[4] if len(vals) > 4 else 1
        doc, glb_bin = load(path)
        base = os.path.dirname(os.path.abspath(path))
        off = {k: len(M[k]) for k in keys}
        for i, b in enumerate(doc.get('buffers', [])):
            b = dict(b)
            if 'uri' not in b:  # GLB binary chunk
                name = os.path.splitext(os.path.basename(path))[0] + '.bin'
                open(os.path.join(out, name), 'wb').write(glb_bin)
                b['uri'] = name
            elif not b['uri'].startswith('data:'):
                copy_file(base, b['uri'], out, copied)
            M['buffers'].append(b)
        for bv in doc.get('bufferViews', []):
            bv = dict(bv); bv['buffer'] += off['buffers']; M['bufferViews'].append(bv)
        for a in doc.get('accessors', []):
            a = dict(a)
            if 'bufferView' in a: a['bufferView'] += off['bufferViews']
            assert 'sparse' not in a, 'sparse accessors not supported'
            M['accessors'].append(a)
        for im in doc.get('images', []):
            im = dict(im)
            if 'bufferView' in im: im['bufferView'] += off['bufferViews']
            elif not im['uri'].startswith('data:'): copy_file(base, im['uri'], out, copied)
            M['images'].append(im)
        M['samplers'] += [dict(x) for x in doc.get('samplers', [])]
        for tx in doc.get('textures', []):
            tx = json.loads(json.dumps(tx))
            if 'source' in tx: tx['source'] += off['images']
            if 'sampler' in tx: tx['sampler'] += off['samplers']
            for ext in tx.get('extensions', {}).values():
                if 'source' in ext: ext['source'] += off['images']
            M['textures'].append(tx)
        for m in doc.get('materials', []):
            m = json.loads(json.dumps(m)); remap_textures(m, off['textures']); M['materials'].append(m)
        for me in doc.get('meshes', []):
            me = json.loads(json.dumps(me))
            for p in me['primitives']:
                p['attributes'] = {k: v + off['accessors'] for k, v in p['attributes'].items()}
                if 'indices' in p: p['indices'] += off['accessors']
                if 'material' in p: p['material'] += off['materials']
                for tg in p.get('targets', []):
                    for k in tg: tg[k] += off['accessors']
            M['meshes'].append(me)
        for n in doc.get('nodes', []):
            n = {k: v for k, v in n.items() if k not in ('skin', 'camera', 'weights')}
            if 'mesh' in n: n['mesh'] += off['meshes']
            if 'children' in n: n['children'] = [c + off['nodes'] for c in n['children']]
            M['nodes'].append(n)
        roots = doc['scenes'][doc.get('scene', 0)]['nodes'] if doc.get('scenes') else list(range(len(doc['nodes'])))
        h = math.radians(ry) / 2
        wrap = {'name': os.path.basename(base) if not glb_bin else os.path.basename(path),
                'children': [r + off['nodes'] for r in roots]}
        if any(t): wrap['translation'] = t
        if ry: wrap['rotation'] = [0, math.sin(h), 0, math.cos(h)]
        if s != 1: wrap['scale'] = [s, s, s]
        M['nodes'].append(wrap)
        M['scenes'][0]['nodes'].append(len(M['nodes']) - 1)
        used |= set(doc.get('extensionsUsed', []))
        if doc.get('extensionsRequired'): M.setdefault('extensionsRequired', []).extend(doc['extensionsRequired'])
    if used: M['extensionsUsed'] = sorted(used)
    for k in keys:
        if not M[k]: del M[k]
    open(os.path.join(out, 'model.gltf'), 'w').write(json.dumps(M, indent=1) + '\n')
    print('wrote', os.path.join(out, 'model.gltf'))


def copy_file(base, rel, out, copied):
    src = os.path.normpath(os.path.join(base, rel))
    dst = os.path.normpath(os.path.join(out, rel))
    assert dst.startswith(os.path.normpath(out) + os.sep), rel
    if dst in copied:
        assert copied[dst] == src or open(src, 'rb').read() == open(dst, 'rb').read(), 'file name clash: ' + rel
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)
    copied[dst] = src


if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit('usage: gltf_compose.py <outdir> <model.gltf|.glb>[@tx,ty,tz[,rotY[,scale]]] ...')
    main(sys.argv[1], sys.argv[2:])
