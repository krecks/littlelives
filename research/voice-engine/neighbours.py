"""Print nodes matching a name/op filter with their producers (for graph surgery planning).

venv/bin/python -I neighbours.py model.onnx <substring-or-op> [depth]
"""
import sys

import onnx
from onnx import numpy_helper

m = onnx.load(sys.argv[1])
g = m.graph
key = sys.argv[2]
depth = int(sys.argv[3]) if len(sys.argv) > 3 else 1
inits = {t.name: numpy_helper.to_array(t) for t in g.initializer}
consts = {}
for n in g.node:
    if n.op_type == "Constant":
        for a in n.attribute:
            if a.name == "value":
                consts[n.output[0]] = numpy_helper.to_array(a.t)
producer = {o: n for n in g.node for o in n.output}


def desc(v):
    if v in inits:
        a = inits[v]
        return f"init{a.shape}{a.dtype}" + (f"={a.ravel()[:4]}" if a.size <= 4 else "")
    if v in consts:
        a = consts[v]
        return f"const{a.shape}{a.dtype}" + (f"={a.ravel()[:4]}" if a.size <= 4 else "")
    p = producer.get(v)
    return f"<{p.op_type} {p.name}>" if p else v


def show(n, d, indent=""):
    attrs = {a.name: onnx.helper.get_attribute_value(a) for a in n.attribute if a.name != "value"}
    print(f"{indent}{n.op_type} {n.name} in={[desc(i) for i in n.input]} {attrs}")
    if d > 1:
        for i in n.input:
            p = producer.get(i)
            if p is not None and p.op_type != "Constant":
                show(p, d - 1, indent + "    ")


seen = 0
for n in g.node:
    if key == n.op_type or key in n.name:
        show(n, depth)
        seen += 1
        if seen > 40:
            break
