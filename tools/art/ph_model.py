# Download a Poly Haven glTF (1k) with its files. usage: python3 -I ph_model.py <outdir> <id>...
import json, sys, urllib.request, os
UA = {'User-Agent': 'idyll-lives-asset-fetch/1.0'}
def get(u): return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120).read()
out, ids = sys.argv[1], sys.argv[2:]
for i in ids:
    files = json.loads(get(f'https://api.polyhaven.com/files/{i}'))
    g = files['gltf']['1k']['gltf']
    d = os.path.join(out, i); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'model.gltf'), 'wb').write(get(g['url']))
    print(i, g['url'])
    for rel, f in g['include'].items():
        p = os.path.normpath(os.path.join(d, rel))
        assert p.startswith(os.path.abspath(d)) or p.startswith(d), rel
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'wb').write(get(f['url']))
        print('  ', rel, f['size'])
