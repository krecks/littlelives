"""Weight-bearing layers of Paradee-8M, with weights traced through DequantizeLinear/Cast.

venv/bin/python -I weights.py ../../web/public/voice/paradee-8m.onnx [--all]
"""
import collections
import sys

import onnx
from onnx import numpy_helper

m = onnx.load(sys.argv[1])
g = m.graph
inits = {t.name: numpy_helper.to_array(t) for t in g.initializer}
for n in g.node:
    if n.op_type == "Constant":
        for a in n.attribute:
            if a.name == "value":
                inits[n.output[0]] = numpy_helper.to_array(a.t)

producer = {}
for n in g.node:
    for o in n.output:
        producer[o] = n

PASS = {"DequantizeLinear", "Cast", "Identity", "Transpose", "Reshape", "Unsqueeze", "Squeeze"}


def source(name, depth=0):
    """Initializer behind a value, through dequantise/cast chains. Returns (init name, chain)."""
    if name in inits:
        return name, []
    p = producer.get(name)
    if p is None or depth > 6 or p.op_type not in PASS:
        return None, []
    s, chain = source(p.input[0], depth + 1)
    return s, chain + [p.op_type]


HEAVY = {"Conv", "ConvTranspose", "Gemm", "MatMul", "LSTM", "Gather", "LayerNormalization", "InstanceNormalization"}
rows = []
seen_inits = set()  # ALBERT shares one layer's weights across its 6 layers: count each once
for n in g.node:
    if n.op_type not in HEAVY:
        continue
    ws = []
    params = 0
    quant = False
    for i in n.input[1:] if n.op_type != "Gather" else n.input[:1]:
        if not i:
            continue
        s, chain = source(i)
        if s is not None and inits[s].size > 1:
            ws.append(tuple(inits[s].shape))
            if s in seen_inits:
                continue
            seen_inits.add(s)
            params += inits[s].size
            quant |= "DequantizeLinear" in chain or str(inits[s].dtype) == "int8"
    if params == 0:
        continue
    attrs = {a.name: onnx.helper.get_attribute_value(a) for a in n.attribute}
    attrs = {k: v for k, v in attrs.items() if k in ("dilations", "group", "kernel_shape", "pads", "strides", "hidden_size", "direction", "output_padding", "transB")}
    rows.append((n.name, n.op_type, ws, params, quant, attrs))

total = sum(r[3] for r in rows)
grp = collections.Counter()
for r in rows:
    parts = r[0].strip("/").split("/")
    key = "/".join(parts[:2]) if parts[0] in ("decoder", "ds", "predictor") else parts[0]
    grp[key] += r[3]
for name, op, ws, params, quant, attrs in rows:
    if "--all" in sys.argv:
        print(f"{op:22s}{params:9d} {'q8' if quant else 'fp':3s} {name:70s} {ws} {attrs}")
print("weight-bearing nodes", len(rows), "params", total)
print("op type counts:", collections.Counter(r[1] for r in rows))
print("by group:")
for k, v in grp.most_common():
    print(f"  {k:40s}{v:9d}")
