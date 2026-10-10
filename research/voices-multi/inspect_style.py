"""Does a Kokoro-family ONNX take a style vector, or is the voice baked in?

Lists inputs/outputs, every initializer or constant whose shape looks like a style vector
(last dim 64/128/256, small), the nodes that consume it, and the op census.

Usage: python -I inspect_style.py model.onnx
"""
import collections
import sys

import onnx
from onnx import numpy_helper

m = onnx.load(sys.argv[1])
g = m.graph
print('inputs:', [(i.name, [d.dim_value or d.dim_param for d in i.type.tensor_type.shape.dim]) for i in g.input])
print('outputs:', [o.name for o in g.output])
inits = {t.name: numpy_helper.to_array(t) for t in g.initializer}
for n in g.node:
    if n.op_type == 'Constant':
        for a in n.attribute:
            if a.name == 'value':
                inits[n.output[0]] = numpy_helper.to_array(a.t)
consumers = collections.defaultdict(list)
for n in g.node:
    for i in n.input:
        consumers[i].append((n.op_type, n.name))
print(f'{len(inits)} constant tensors; style-like candidates:')
for k, v in inits.items():
    if v.ndim >= 1 and v.shape[-1] in (64, 128, 256) and v.size <= 512:
        print(' ', k, v.shape, v.dtype, consumers[k][:3])
print(collections.Counter(n.op_type for n in g.node).most_common(40))
params = sum(v.size for v in inits.values())
print(f'parameters (all constants): {params/1e6:.2f} M')
