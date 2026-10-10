"""KittenTTS `voices.npz` -> one raw float32 file per voice (`<dir>/voices/<name>.bin`, [rows][256]),
so Node can read them. Also prints the ONNX inputs/outputs and custom ops.

Usage: python -I kitten_voices.py dl/kitten-nano dl/kitten-micro dl/kitten-mini
"""
import collections
import glob
import os
import sys

import numpy as np
import onnx

for d in sys.argv[1:]:
    v = np.load(os.path.join(d, 'voices.npz'))
    os.makedirs(os.path.join(d, 'voices'), exist_ok=True)
    for k in v.files:
        a = v[k].astype(np.float32)
        a.tofile(os.path.join(d, 'voices', f'{k}.bin'))
    print(d, {k: v[k].shape for k in v.files})
    m = onnx.load(glob.glob(os.path.join(d, '*.onnx'))[0])
    g = m.graph
    print('  inputs', [(i.name, [x.dim_value or x.dim_param for x in i.type.tensor_type.shape.dim]) for i in g.input])
    print('  outputs', [o.name for o in g.output])
    ops = collections.Counter((n.domain or 'ai.onnx', n.op_type) for n in g.node)
    print('  non-standard ops', {k: c for k, c in ops.items() if k[0] != 'ai.onnx'})
    print('  random ops', [n.op_type for n in g.node if n.op_type.startswith('Random')])
