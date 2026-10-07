# Adds glTF urls to existing model entries (re-reading the manifest) and gives their
# placeholder fallbacks PBR finishes. usage: python3 -I gltf_entries.py <manifest>
import json, sys
path = sys.argv[1]
d = json.load(open(path))
E = d['entries']
GLTF = {
  'model.sofa': ('models/sofa_02/model.gltf', 1.0, [0, 0, 0.03], 'fabric'),
  'model.armchair': ('models/mid_century_lounge_chair/model.gltf', 0.84, [0, 0, 0.05], 'fabric'),
  'model.plant': ('models/potted_plant_02/model.gltf', 1.15, [0, 0, 0], 'foliage'),
}
for key, (url, scale, offset, finish) in GLTF.items():
    e = E[key]
    e['url'] = url; e['scale'] = scale; e['rotationY'] = 0; e['offset'] = offset
    for p in e.get('placeholder', []):
        p.setdefault('material', 'material.finish.' + finish)
    # keep key order readable: type, url, scale, rotationY, offset, placeholder
    E[key] = {k: e[k] for k in ['type', 'url', 'scale', 'rotationY', 'offset'] if k in e} | {k: v for k, v in e.items() if k not in ('type', 'url', 'scale', 'rotationY', 'offset')}
s = json.dumps(d, indent=2) + '\n'
json.loads(s)
open(path, 'w').write(s)
print('ok')
