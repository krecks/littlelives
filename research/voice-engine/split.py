"""Split Paradee at the alignment, so each half has shapes tract can type (and optimise):

A: input_ids, speed -> prosody features d [1, T, 224], text features t_en [1, 512, T], durations [T]
   (the host builds the alignment from durations: frame f belongs to token i)
B: en = d^T @ aln [1, 224, F], asr = t_en @ aln [1, 512, F] -> waveform

venv/bin/python -I split.py in.onnx out_prefix
"""
import sys

import onnx
from onnx.utils import Extractor

src, prefix = sys.argv[1], sys.argv[2]
m = onnx.shape_inference.infer_shapes(onnx.load(src))
e = Extractor(m)
a = e.extract_model(["input_ids", "speed"], ["/Concat_4_output_0", "/Transpose_10_output_0", "/Cast_output_0"])
b = e.extract_model(["/MatMul_output_0", "/MatMul_1_output_0"], ["waveform"])
def set_shape(vi, dims):
    shape = vi.type.tensor_type.shape
    del shape.dim[:]
    for d in dims:
        dim = shape.dim.add()
        if isinstance(d, int):
            dim.dim_value = d
        else:
            dim.dim_param = d


# Shape inference leaves unknown symbols (unk__217) on the cut; name them for tract.
set_shape(a.graph.output[0], [1, 224, "tokens"])
set_shape(a.graph.output[1], [1, 512, "tokens"])
set_shape(a.graph.output[2], ["tokens"])
set_shape(b.graph.input[0], [1, 224, "F"])
set_shape(b.graph.input[1], [1, 512, "F"])
b.graph.output[0].type.tensor_type.ClearField("shape")
# Let tract infer inner shapes itself (ONNX's inferred value_info confuses its symbolic algebra).
for part in (a, b):
    del part.graph.value_info[:]
for name, part in (("a", a), ("b", b)):
    print(name, "inputs", [i.name for i in part.graph.input], "nodes", len(part.graph.node))
    onnx.save(part, f"{prefix}_{name}.onnx")
