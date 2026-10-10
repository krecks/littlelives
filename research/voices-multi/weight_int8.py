"""Weight-only int8, the way Paradee ships: every large float weight of a Conv, ConvTranspose,
MatMul, Gemm or LSTM becomes int8 + a per-channel float scale + DequantizeLinear, so the file is
about 4x smaller but the maths stays float (ONNX Runtime folds the dequantisation at load).
Unlike onnxruntime's quantize_dynamic (ConvInteger/MatMulInteger/DynamicQuantizeLinear), which
is slow in ONNX Runtime Web's WASM build.

Usage: python -I weight_int8.py in.onnx out.onnx
"""
import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper

src, dst = sys.argv[1:3]
m = onnx.load(src)
g = m.graph
inits = {t.name: t for t in g.initializer}
uses = {}
for n in g.node:
    for k, i in enumerate(n.input):
        if i in inits:
            uses.setdefault(i, []).append((n.op_type, k, n))
targets = {}
for name, us in uses.items():
    a = numpy_helper.to_array(inits[name])
    if a.dtype != np.float32 or a.size < 4096:
        continue
    kinds = {(op, k) for op, k, _ in us}
    if kinds <= {('Conv', 1), ('ConvTranspose', 1)}:
        targets[name] = 0
    elif kinds <= {('MatMul', 1)} and a.ndim == 2:
        targets[name] = 1
    elif all(op == 'Gemm' and k == 1 for op, k, _ in us):
        transb = any(at.name == 'transB' and at.i for _, _, n in us for at in n.attribute)
        targets[name] = 0 if transb else 1
    elif all(op == 'LSTM' and k in (1, 2) for op, k, _ in us):
        targets[name] = 1
total = sum(numpy_helper.to_array(t).size for t in g.initializer if numpy_helper.to_array(t).dtype == np.float32)
done = 0
new_nodes = []
for name, axis in targets.items():
    a = numpy_helper.to_array(inits[name])
    moved = np.moveaxis(a, axis, 0).reshape(a.shape[axis], -1)
    scale = np.abs(moved).max(1) / 127.0
    scale[scale == 0] = 1.0
    shape = [1] * a.ndim
    shape[axis] = -1
    q = np.clip(np.round(a / scale.reshape(shape)), -127, 127).astype(np.int8)
    g.initializer.remove(inits[name])
    g.initializer.extend([numpy_helper.from_array(q, name + '_q8'), numpy_helper.from_array(scale.astype(np.float32), name + '_s8')])
    new_nodes.append(helper.make_node('DequantizeLinear', [name + '_q8', name + '_s8'], [name], name=name + '_dq', axis=axis))
    done += a.size
# dequantise nodes first, so the graph stays topologically sorted
nodes = list(g.node)
del g.node[:]
g.node.extend(new_nodes + nodes)
if not any(o.domain in ('', 'ai.onnx') and o.version >= 13 for o in m.opset_import):
    raise SystemExit('needs opset >= 13 for per-axis DequantizeLinear')
onnx.save(m, dst)
print(f'{len(targets)} weights, {done / 1e6:.2f}M of {total / 1e6:.2f}M float parameters to int8')
