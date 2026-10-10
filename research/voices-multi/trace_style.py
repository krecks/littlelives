"""Traces the style input of Paradee's AdaIN layers (the Gemm 'fc' nodes) back to its source.

Usage: python -I trace_style.py model.onnx
"""
import collections
import sys

import onnx
from onnx import numpy_helper

m = onnx.load(sys.argv[1])
g = m.graph
producer = {o: n for n in g.node for o in n.output}
inits = {t.name: t for t in g.initializer}
consts = {}
for n in g.node:
    if n.op_type == 'Constant':
        for a in n.attribute:
            if a.name == 'value':
                consts[n.output[0]] = numpy_helper.to_array(a.t)


def chain(name, depth=0, seen=None):
    """Upstream path of a tensor until a graph input / initializer / constant."""
    seen = seen if seen is not None else set()
    if name in seen or depth > 12:
        return []
    seen.add(name)
    if name in inits:
        a = numpy_helper.to_array(inits[name])
        return [f'{"  "*depth}init {name} {a.shape} {a.dtype}']
    if name in consts:
        return [f'{"  "*depth}const {name} {consts[name].shape} {consts[name].dtype}']
    n = producer.get(name)
    if n is None:
        return [f'{"  "*depth}INPUT {name}']
    out = [f'{"  "*depth}{n.op_type} {n.name}']
    for i in n.input:
        if i:
            out += chain(i, depth + 1, seen)
    return out


gemms = [n for n in g.node if n.op_type == 'Gemm']
sources = collections.Counter(n.input[0] for n in gemms)
print('Gemm A inputs (count):')
for s, c in sources.most_common(10):
    print(c, s)
first = sources.most_common(5)
for s, _ in first:
    print('\n--- upstream of', s)
    print('\n'.join(chain(s)[:25]))
