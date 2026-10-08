# Merge generated model entries into one personality pack manifest in place
# (web/public/assets/packs/<trait>/manifest.json), keeping its other keys and entries.
# Re-reads the manifest right before writing. Model URLs in a pack resolve relative to the pack
# manifest, so library files are referenced as "../../models/ph/<id>.glb".
#
# usage: python3 -I apply_pack.py <trait> <entries.json>
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PACKS = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'public', 'assets', 'packs'))

trait, spec = sys.argv[1], sys.argv[2]
new = json.load(open(spec))
path = os.path.join(PACKS, trait, 'manifest.json')
doc = json.load(open(path))
for k, v in new.items():
    assert k.startswith(f'model.{trait}.') or k.startswith('model.'), k
    doc['entries'][k] = v
s = json.dumps(doc, indent=2) + '\n'
json.loads(s)
open(path, 'w').write(s)
print(f'{trait}: applied {len(new)} entries; total {len(doc["entries"])}')
