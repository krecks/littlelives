"""Research-only reference phonemes from espeak-ng (GPL; via the `piper-phonemize-cross` wheel,
never shipped): what KittenTTS and Piper were trained on. Also exports KittenTTS's symbol table
exactly as its legacy code builds it.

Writes `<out>/espeak_ref.json`: {kitten_symbols: [...], lines: {text: ipa}} for every line in
the game's voice content (placeholders {me}/{name} filled with a fixed name).

Usage: python -I espeak_ref.py web/public/content/voice/en.json kitten_onnx_model.py out_dir
"""
import ast
import json
import os
import re
import sys

import piper_phonemize as pp

content, kitten_src, out = sys.argv[1:4]

# Kitten's symbol strings, read from its source without importing it
tree = ast.parse(open(kitten_src, encoding='utf-8').read())
vals = {}
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        if node.targets[0].id in ('_pad', '_punctuation', '_letters', '_letters_ipa') and isinstance(node.value, ast.Constant):
            vals[node.targets[0].id] = node.value.value
symbols = [vals['_pad']] + list(vals['_punctuation']) + list(vals['_letters']) + list(vals['_letters_ipa'])


def walk(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, list):
        for y in x:
            yield from walk(y)
    elif isinstance(x, dict):
        for k, v in x.items():
            if not k.startswith('_') and k != 'tone':
                yield from walk(v)


data = json.load(open(content, encoding='utf-8'))
texts = sorted({re.sub(r'\[([^\]]+)\]\(/[^)]*/\)', r'\1', t.replace('{me}', 'Maya').replace('{name}', 'Sam')) for t in walk(data)})
for extra in ('Do I know you?', 'Pretty good, thanks for asking!', 'I had the strangest dream last night.'):
    if extra not in texts:
        texts.append(extra)
lines = {t: ' '.join(''.join(s) for s in pp.phonemize_espeak(t, 'en-us')) for t in texts}
os.makedirs(out, exist_ok=True)
json.dump({'kitten_symbols': symbols, 'lines': lines}, open(os.path.join(out, 'espeak_ref.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(lines), 'lines;', len(symbols), 'kitten symbols')
