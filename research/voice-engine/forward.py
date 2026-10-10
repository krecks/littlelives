"""Nodes downstream of a node (in graph order), skipping Constant/shape plumbing.

venv/bin/python -I forward.py model.onnx <node name> [max]
"""
import sys

import onnx
from onnx import numpy_helper

m = onnx.load(sys.argv[1])
g = m.graph
start = sys.argv[2]
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 200
consts = {t.name: numpy_helper.to_array(t) for t in g.initializer}
for n in g.node:
    if n.op_type == "Constant":
        for a in n.attribute:
            if a.name == "value":
                consts[n.output[0]] = numpy_helper.to_array(a.t)
producer = {o: n for n in g.node for o in n.output}
live = set()
started = False
shown = 0
for n in g.node:
    if n.name == start:
        started = True
        live.update(n.output)
        print("START", n.op_type, n.name)
        continue
    if started and any(i in live for i in n.input):
        live.update(n.output)
        if n.op_type in ("Shape", "Gather", "Unsqueeze", "Squeeze", "Cast", "Concat", "Reshape", "Constant", "Slice") and shown > 0:
            pass
        ins = []
        for i in n.input:
            if i in consts:
                a = consts[i]
                ins.append(f"c{list(a.shape)}" + (f"={a.ravel()[:3].tolist()}" if a.size <= 3 else ""))
            elif i in live:
                p = producer.get(i)
                ins.append(f"<{p.op_type}>" if p else i)
            else:
                p = producer.get(i)
                ins.append(f"ext<{p.op_type} {p.name}>" if p else i)
        attrs = {a.name: onnx.helper.get_attribute_value(a) for a in n.attribute if a.name != "value"}
        print(f"{n.op_type:18s} {n.name:40s} {ins} {attrs}"[:260])
        shown += 1
        if shown >= limit:
            break
