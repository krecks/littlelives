# Adds the garden catalog's models (garden_models.py) to the manifest as `model.garden.<name>`
# (camelCase) and points `model.flowerbed` at the new flower bed. A soft foliage blob stands in
# while a file loads or if it fails. Idempotent; re-reads the manifest right before writing.
# usage: python3 -I garden_entries.py web/public/assets/manifest.json
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from garden_models import MODELS  # noqa: E402

path = sys.argv[1]
d = json.load(open(path))
e = d['entries']


def camel(name):
    head, *rest = name.split('_')
    return head + ''.join(w.title() for w in rest)


# Loose plants get their own turn and size where they stand; pots, planters and beds stay square.
VARY = {'tulips', 'daffodils', 'daisies', 'sunflowers', 'poppies', 'marigolds', 'pansies', 'lilies', 'lupins', 'forget_me_nots',
        'cosmos', 'meadow', 'boxwood', 'hydrangea', 'rosebush', 'azalea', 'lavender', 'fern', 'grass', 'hosta', 'tomatoes', 'pumpkins', 'boulder'}
BLOB = [{'shape': 'blob', 'size': [0.7, 0.45, 0.7], 'at': [0, 0.22, 0], 'color': '#6A9444', 'material': 'material.finish.foliage', 'noise': 0.2}]
out = {k: v for k, v in e.items() if not k.startswith('model.garden.')}
for name in MODELS:
    url = f'nature/garden_{name}.glb'
    if name == 'flowerbed':
        out['model.flowerbed'] = {**out['model.flowerbed'], 'url': url}
        continue
    entry = {'type': 'model', 'url': url, 'placeholder': BLOB}
    if name in VARY:
        entry['vary'] = 0.1
    out[f'model.garden.{camel(name)}'] = entry
d['entries'] = out
s = json.dumps(d, indent=2) + '\n'
json.loads(s)
open(path, 'w').write(s)
print('ok', len(out))
