# Points the nature model entries of the manifest at the generated glbs (nature_models.py) and adds
# the species / far-LOD keys right after `model.flowers` (idempotent). Existing placeholders stay as fallbacks;
# new keys borrow their parent's. Re-reads the manifest right before writing (others edit it too).
# usage: python3 -I nature_entries.py web/public/assets/manifest.json
import json
import sys

path = sys.argv[1]
d = json.load(open(path))
e = d['entries']
url = lambda n: f'nature/{n}.glb'
for k, n in [('model.tree', 'oak'), ('model.pine', 'pine'), ('model.bush', 'bush'), ('model.grassTuft', 'grass_tuft'), ('model.flowers', 'wildflowers')]:
    e[k]['url'] = url(n)
new = {
    'model.tree.far': ('oak_far', 'model.tree'),
    'model.tree.birch': ('birch', 'model.tree'),
    'model.tree.birch.far': ('birch_far', 'model.tree'),
    'model.tree.blossom': ('blossom', 'model.tree'),
    'model.tree.blossom.far': ('blossom_far', 'model.tree'),
    'model.tree.fruit': ('apple', 'model.tree'),
    'model.tree.fruit.far': ('apple_far', 'model.tree'),
    'model.tree.maple': ('maple', 'model.tree'),
    'model.tree.maple.far': ('maple_far', 'model.tree'),
    'model.tree.japaneseMaple': ('japanese_maple', 'model.tree'),
    'model.tree.japaneseMaple.far': ('japanese_maple_far', 'model.tree'),
    'model.tree.magnolia': ('magnolia', 'model.tree'),
    'model.tree.magnolia.far': ('magnolia_far', 'model.tree'),
    'model.tree.willow': ('willow', 'model.tree'),
    'model.tree.willow.far': ('willow_far', 'model.tree'),
    'model.pine.far': ('pine_far', 'model.pine'),
    'model.spruce': ('spruce', 'model.pine'),
    'model.spruce.far': ('spruce_far', 'model.pine'),
    'model.cypress': ('cypress', 'model.pine'),
    'model.cypress.far': ('cypress_far', 'model.pine'),
    'model.bush.flowering': ('bush_flowering', 'model.bush'),
    'model.bush.small': ('bush_small', 'model.bush'),
    'model.hedge': ('hedge', 'model.bush'),
}
out = {}
for k, v in e.items():
    if k in new:
        continue
    out[k] = v
    if k == 'model.flowers':
        for nk, (file, parent) in new.items():
            entry = {'type': 'model', 'url': url(file)}
            if 'placeholder' in e.get(parent, {}):
                entry['placeholder'] = e[parent]['placeholder']
            out[nk] = entry
# Placed trees each get their own turn and size (see `vary` in web/src/assets/types.ts).
for k in ('model.tree', 'model.tree.birch', 'model.tree.blossom', 'model.tree.fruit', 'model.tree.maple', 'model.tree.japaneseMaple',
          'model.tree.magnolia', 'model.tree.willow', 'model.pine', 'model.spruce', 'model.cypress', 'model.bush'):
    out[k]['vary'] = 0.12
d['entries'] = out
s = json.dumps(d, indent=2) + '\n'
json.loads(s)
open(path, 'w').write(s)
print('ok', len(out))
