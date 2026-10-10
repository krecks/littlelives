"""Paradee-8M ONNX graph census: ops, blocks, parameters.

venv/bin/python -I inspect_graph.py ../../web/public/voice/paradee-8m.onnx
"""
import collections
import sys

import numpy as np
import onnx
from onnx import numpy_helper

m = onnx.load(sys.argv[1])
g = m.graph
print("opset", [(o.domain, o.version) for o in m.opset_import], "producer", m.producer_name, m.producer_version)
print("inputs", [(i.name, [d.dim_value or d.dim_param for d in i.type.tensor_type.shape.dim], i.type.tensor_type.elem_type) for i in g.input])
print("outputs", [(i.name, [d.dim_value or d.dim_param for d in i.type.tensor_type.shape.dim]) for i in g.output])
print("nodes", len(g.node), "initializers", len(g.initializer))
ops = collections.Counter(n.op_type for n in g.node)
for k, v in ops.most_common():
    print(f"  {k:28s}{v}")

inits = {t.name: numpy_helper.to_array(t) for t in g.initializer}
# Constant nodes too
for n in g.node:
    if n.op_type == "Constant":
        for a in n.attribute:
            if a.name == "value":
                inits[n.output[0]] = numpy_helper.to_array(a.t)

dt = collections.Counter()
el = collections.Counter()
for a in inits.values():
    dt[str(a.dtype)] += a.nbytes
    el[str(a.dtype)] += a.size
print("init bytes by dtype", dict(dt))
print("init elements by dtype", dict(el))


def block(name):
    parts = name.strip("/").split("/")
    return parts[0] if parts else name


# Which block consumes each initializer (first consumer)
consumer_block = {}
for n in g.node:
    for i in n.input:
        if i in inits and i not in consumer_block:
            consumer_block[i] = block(n.name)

bops = collections.defaultdict(collections.Counter)
for n in g.node:
    bops[block(n.name)][n.op_type] += 1
bparams = collections.Counter()
bbytes = collections.Counter()
for name, a in inits.items():
    if a.size > 16:
        b = consumer_block.get(name, "?")
        bparams[b] += a.size
        bbytes[b] += a.nbytes
print()
print(f"{'block':28s}{'nodes':>6s}{'params':>10s}{'bytes':>10s}  top ops")
for b, c in sorted(bops.items(), key=lambda x: -bparams.get(x[0], 0)):
    print(f"{b:28s}{sum(c.values()):6d}{bparams.get(b, 0):10d}{bbytes.get(b, 0):10d}  {dict(c.most_common(10))}")
print("total params (>16 el)", sum(bparams.values()))

if len(sys.argv) > 2:
    # dump nodes with op type filter
    for n in g.node:
        if n.op_type in sys.argv[2].split(","):
            attrs = {a.name: onnx.helper.get_attribute_value(a) for a in n.attribute}
            attrs = {k: (v if not isinstance(v, bytes) else v[:20]) for k, v in attrs.items() if k != "value"}
            shapes = [inits[i].shape if i in inits else i for i in n.input]
            print(n.op_type, n.name, shapes, attrs)
