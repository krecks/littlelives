# Merge entries from a JSON file into the manifest in place (re-reads the manifest right before
# writing so concurrent edits by others are kept). usage: python3 -I apply_entries.py <manifest> <entries.json>
import json, sys
path, spec = sys.argv[1], sys.argv[2]
new = json.load(open(spec))
d = json.load(open(path))
for k, v in new.items():
    d['entries'][k] = v
s = json.dumps(d, indent=2) + '\n'
json.loads(s)
open(path, 'w').write(s)
print('applied', len(new), 'entries; total', len(d['entries']))
