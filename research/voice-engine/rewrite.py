"""Graph rewrites that might make tract faster (each switchable), verified against ONNX Runtime.

venv/bin/python -I rewrite.py in.onnx out.onnx [--dequant] [--pow] [--range] [--seed]

--dequant  fold DequantizeLinear/Cast of constant weights into float32 initialisers
           (in production this would happen at load time in Rust, keeping the 9 MB download)
--pow      Pow(x, 2) -> Mul(x, x)
--range    Range(0, n, 1) -> CumSum(ConstantOfShape([n], 1)) - 1 (tract's typed Range bug)
"""
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
flags = set(sys.argv[3:])
m = onnx.load(src)
g = m.graph

inits = {t.name: numpy_helper.to_array(t) for t in g.initializer}
const_nodes = {}
for n in g.node:
    if n.op_type == "Constant":
        for a in n.attribute:
            if a.name == "value":
                const_nodes[n.output[0]] = numpy_helper.to_array(a.t)


def value(name):
    if name in inits:
        return inits[name]
    return const_nodes.get(name)


ONNX2NP = {1: np.float32, 7: np.int64, 6: np.int32, 10: np.float16, 9: np.bool_, 11: np.float64, 3: np.int8}

if "--dequant" in flags:
    folded = 0
    changed = True
    while changed:
        changed = False
        keep = []
        for n in g.node:
            ins = [value(i) if i else None for i in n.input]
            ok = all(v is not None for v, i in zip(ins, n.input) if i)
            out = None
            if ok and n.op_type == "DequantizeLinear":
                x, scale = ins[0], ins[1]
                zp = ins[2] if len(ins) > 2 and ins[2] is not None else np.zeros_like(scale, dtype=x.dtype)
                axis = next((a.i for a in n.attribute if a.name == "axis"), 1)
                if scale.ndim == 1 and scale.size > 1:
                    shape = [1] * x.ndim
                    shape[axis] = -1
                    scale = scale.reshape(shape)
                    zp = zp.reshape(shape)
                out = ((x.astype(np.int32) - zp.astype(np.int32)).astype(np.float32) * scale.astype(np.float32)).astype(np.float32)
            elif ok and n.op_type == "Cast" and ins[0].size > 16:
                to = next(a.i for a in n.attribute if a.name == "to")
                out = ins[0].astype(ONNX2NP[to])
            if out is not None:
                inits[n.output[0]] = out
                g.initializer.append(numpy_helper.from_array(out, n.output[0]))
                folded += 1
                changed = True
            else:
                keep.append(n)
        del g.node[:]
        g.node.extend(keep)
    # drop unused initialisers
    used = {i for n in g.node for i in n.input} | {o.name for o in g.output}
    alive = [t for t in g.initializer if t.name in used]
    del g.initializer[:]
    g.initializer.extend(alive)
    print("folded", folded, "nodes")

if "--pow" in flags:
    k = 0
    for n in g.node:
        if n.op_type == "Pow":
            e = value(n.input[1])
            if e is not None and e.size == 1 and float(e) == 2.0:
                n.op_type = "Mul"
                n.input[1] = n.input[0]
                k += 1
    print("pow->mul", k)

if "--range" in flags:
    new_nodes = []
    k = 0
    for n in g.node:
        if n.op_type == "Range" and n.name == "/Range":
            s, l, d = (value(i) for i in n.input)
            assert s is not None and int(s) == 0 and d is not None and int(d) == 1
            p = n.name + "_rw"
            new_nodes += [
                helper.make_node("Unsqueeze", [n.input[1], p + "_ax"], [p + "_shape"], name=p + "/Unsqueeze"),
                helper.make_node("ConstantOfShape", [p + "_shape"], [p + "_ones"], name=p + "/Ones",
                                 value=helper.make_tensor("v", TensorProto.INT64, [1], [1])),
                helper.make_node("CumSum", [p + "_ones", p + "_zero"], [p + "_cs"], name=p + "/CumSum"),
                helper.make_node("Sub", [p + "_cs", p + "_one"], [n.output[0]], name=p + "/Sub"),
            ]
            g.initializer.extend([
                numpy_helper.from_array(np.array([0], np.int64), p + "_ax"),
                numpy_helper.from_array(np.array(0, np.int64), p + "_zero"),
                numpy_helper.from_array(np.array(1, np.int64), p + "_one"),
            ])
            k += 1
        else:
            new_nodes.append(n)
    del g.node[:]
    g.node.extend(new_nodes)
    print("range rewritten", k)

if "--pitch" in flags:
    # Same edit as crates/voice/src/model.rs: a `pitch` input multiplying the F0 curve.
    at = next(i for i, n in enumerate(g.node) if n.name == "/F0_proj/Conv")
    f0 = g.node[at].output[0]
    for n in g.node:
        for j, i in enumerate(n.input):
            if i == f0:
                n.input[j] = f0 + "_pitch"
    g.node.insert(at + 1, helper.make_node("Mul", [f0, "pitch"], [f0 + "_pitch"], name="/pitch_scale"))
    g.input.append(helper.make_tensor_value_info("pitch", TensorProto.FLOAT, [1]))
    print("pitch input added")

if "--stride" in flags:
    # Conv(k3, s2, p1) on 2F samples -> Conv(s1) + Slice(step 2): same values, but tract can
    # prove the output length is F (it can't simplify (1+2F)/2).
    new_nodes = []
    k = 0
    for n in g.node:
        if n.op_type == "Conv" and n.name in ("/ds/F0_conv/Conv", "/ds/N_conv/Conv"):
            for a in n.attribute:
                if a.name == "strides":
                    a.ints[:] = [1]
            full = n.output[0] + "_s1"
            out = n.output[0]
            n.output[0] = full
            p = n.name + "_rw"
            new_nodes.append(n)
            new_nodes.append(helper.make_node("Slice", [full, p + "_st", p + "_en", p + "_ax", p + "_sp"], [out], name=p + "/Slice"))
            g.initializer.extend([
                numpy_helper.from_array(np.array([0], np.int64), p + "_st"),
                numpy_helper.from_array(np.array([np.iinfo(np.int64).max], np.int64), p + "_en"),
                numpy_helper.from_array(np.array([2], np.int64), p + "_ax"),
                numpy_helper.from_array(np.array([2], np.int64), p + "_sp"),
            ])
            k += 1
        else:
            new_nodes.append(n)
    del g.node[:]
    g.node.extend(new_nodes)
    print("stride rewritten", k)

onnx.save(m, dst)
print("saved", dst)
