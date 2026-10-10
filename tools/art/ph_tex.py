# Download Poly Haven texture maps. usage: python3 -I ph_tex.py <outdir> <res> <maps,comma> <id> [<id>...]
import json, sys, urllib.request, os
UA = {'User-Agent': 'idyll-lives-asset-fetch/1.0'}
def get(u): return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
out, res, maps, ids = sys.argv[1], sys.argv[2], sys.argv[3].split(','), sys.argv[4:]
for i in ids:
    files = json.loads(get(f'https://api.polyhaven.com/files/{i}'))
    os.makedirs(os.path.join(out, i), exist_ok=True)
    for m in maps:
        if m not in files: print('missing', i, m); continue
        u = files[m][res]['jpg']['url']
        dst = os.path.join(out, i, f'{m}.jpg')
        open(dst, 'wb').write(get(u))
        print(i, m, os.path.getsize(dst), u)
