"""Turns Paradee's two learned style constants (`ts.style` 1x32, prosody side; `ds.style` 1x16,
decoder side) into graph inputs, so other styles can be fed. Writes the edited model and the
original values as JSON.

Usage: python -I paradee_style.py paradee-8m-edit1.onnx out.onnx out.json
"""
import json
import sys

import onnx
from onnx import helper, numpy_helper, TensorProto

src, dst, values = sys.argv[1:4]
m = onnx.load(src)
g = m.graph
orig = {}
for name in ('ts.style', 'ds.style'):
    t = next(t for t in g.initializer if t.name == name)
    a = numpy_helper.to_array(t)
    orig[name] = a.reshape(-1).tolist()
    g.initializer.remove(t)
    g.input.append(helper.make_tensor_value_info(name, TensorProto.FLOAT, list(a.shape)))
    print(name, a.shape, 'norm', float((a ** 2).sum() ** 0.5), 'min', float(a.min()), 'max', float(a.max()))
onnx.save(m, dst)
json.dump(orig, open(values, 'w'))
