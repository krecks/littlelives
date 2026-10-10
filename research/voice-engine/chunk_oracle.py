"""Oracle for streaming option (b): chunked decoding where every InstanceNormalization uses the
statistics of the WHOLE line (taken from a full decode). If this matches the full decode once the
margin covers the receptive field, then per-chunk statistics are the only obstacle, and the
margin where it converges is the receptive field measured on the real graph.

Also isolates the harmonic source: its phase is a running sum from the start of the decoded
span, so each chunk is rendered with the phase it would have had (phase-offset input).

venv/bin/python -I chunk_oracle.py out/split_q8_a.onnx out/split_q8_b.onnx out/ids.json
"""
import json
import sys

import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, numpy_helper, TensorProto

ort.set_default_logger_severity(3)
a_path, b_path, ids_path = sys.argv[1:4]
SPF = 600

b = onnx.load(b_path)
g = b.graph
zero = "zero_noise_const"
g.initializer.append(numpy_helper.from_array(np.array(0.0, np.float32), zero))
eps_name = "in_eps_const"
nodes, norms = [], []
for n in g.node:
    if n.op_type in ("RandomNormalLike", "RandomUniformLike"):
        nodes.append(helper.make_node("Mul", [n.input[0], zero], [n.output[0]], name=n.name + "_zero"))
    elif n.op_type == "InstanceNormalization":
        i = len(norms)
        eps = next((a.f for a in n.attribute if a.name == "epsilon"), 1e-5)
        x, gamma, beta = n.input
        mu, var = f"in{i}_mean", f"in{i}_var"
        norms.append((x, mu, var, eps))
        # (x - mu) / sqrt(var + eps) * gamma + beta, gamma/beta broadcast as [C, 1]
        p = f"/oracle/in{i}"
        nodes += [
            helper.make_node("Sub", [x, mu], [p + "_c"], name=p + "/Sub"),
            helper.make_node("Add", [var, p + "_eps"], [p + "_ve"], name=p + "/AddEps"),
            helper.make_node("Sqrt", [p + "_ve"], [p + "_sd"], name=p + "/Sqrt"),
            helper.make_node("Div", [p + "_c", p + "_sd"], [p + "_n"], name=p + "/Div"),
            helper.make_node("Unsqueeze", [gamma, p + "_ax"], [p + "_g"], name=p + "/UnsqG"),
            helper.make_node("Unsqueeze", [beta, p + "_ax"], [p + "_b"], name=p + "/UnsqB"),
            helper.make_node("Mul", [p + "_n", p + "_g"], [p + "_m"], name=p + "/Mul"),
            helper.make_node("Add", [p + "_m", p + "_b"], [n.output[0]], name=p + "/Add"),
        ]
        g.initializer.append(numpy_helper.from_array(np.array(eps, np.float32), p + "_eps"))
        g.initializer.append(numpy_helper.from_array(np.array([1], np.int64), p + "_ax"))
        g.input.append(helper.make_tensor_value_info(mu, TensorProto.FLOAT, None))
        g.input.append(helper.make_tensor_value_info(var, TensorProto.FLOAT, None))
    else:
        nodes.append(n)
del g.node[:]
g.node.extend(nodes)
# expose every norm input so a full decode yields the statistics
for x, _, _, _ in norms:
    g.output.append(helper.make_tensor_value_info(x, TensorProto.FLOAT, None))
# ... and the harmonic source's running phase (in cycles, at 300-sample steps)
CUM = next(n for n in g.node if n.op_type == "CumSum" and "sin_gen" in n.name)
g.output.append(helper.make_tensor_value_info(CUM.output[0], TensorProto.FLOAT, None))
# Second graph: the running phase comes from outside (carried across chunks, as an engine would)
import copy

b2 = copy.deepcopy(b)
for n in b2.graph.node:
    if n.op_type == "CumSum" and "sin_gen" in n.name:
        n.op_type = "Identity"
        del n.input[:]
        n.input.append("phase_cum")
b2.graph.input.append(helper.make_tensor_value_info("phase_cum", TensorProto.FLOAT, None))

so = ort.SessionOptions()
so.intra_op_num_threads = 1
sa = ort.InferenceSession(a_path, so, providers=["CPUExecutionProvider"])
sb = ort.InferenceSession(b.SerializeToString(), so, providers=["CPUExecutionProvider"])
sb2 = ort.InferenceSession(b2.SerializeToString(), so, providers=["CPUExecutionProvider"])
in_names = [i.name for i in sb.get_inputs()]
print(f"{len(norms)} InstanceNorms replaced")


def run(en, asr, stats, phase=None):
    feed = {in_names[0]: en, in_names[1]: asr}
    feed.update(stats)
    if phase is None:
        return sb.run(None, feed)
    feed["phase_cum"] = phase
    return sb2.run(None, feed)


def logspec(x, n=1024, hop=256):
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    return 20 * np.log10(np.abs(np.fft.rfft(fr, axis=1)) + 1e-4)


def lsd(a, b):
    n = min(a.size, b.size)
    A, B = logspec(a[:n]), logspec(b[:n])
    return np.sqrt(((A - B) ** 2).mean(axis=1))


for line, ids in json.load(open(ids_path)).items():
    if len(ids) < 30:
        continue
    d, t_en, dur = sa.run(None, {"input_ids": np.array([ids], np.int64), "speed": np.array([1.0], np.float32)})
    tok = np.repeat(np.arange(len(dur)), dur.astype(np.int64))
    en, asr = d[:, :, tok].astype(np.float32), t_en[:, :, tok].astype(np.float32)
    frames = en.shape[2]
    # pass 1: dummy stats to get the norm inputs; iterate until the stats are self-consistent
    # (each norm's input depends on earlier norms' outputs)
    stats = {}
    for _, mu, var, _ in norms:
        stats[mu] = np.zeros((1, 1, 1), np.float32)
        stats[var] = np.ones((1, 1, 1), np.float32)
    for it in range(len(norms) + 1):
        outs = run(en, asr, stats)
        new = {}
        for (x, mu, var, _), v in zip(norms, outs[1 : 1 + len(norms)]):
            new[mu] = v.mean(axis=2, keepdims=True).astype(np.float32)
            new[var] = v.var(axis=2, keepdims=True).astype(np.float32)
        delta = max(float(np.abs(new[k] - stats[k]).max()) for k in new)
        stats = new
        if delta < 1e-6:
            break
    full_outs = run(en, asr, stats)
    full, cum = full_outs[0].ravel(), full_outs[-1]
    steps = cum.shape[1] / frames
    full_p = run(en, asr, stats, cum)[0].ravel()
    loud = logspec(full).max(axis=1) > logspec(full).max() - 40
    print(f"\n{len(line)} chars, {frames} frames; stats converged after {it + 1} passes; phase steps/frame {steps}; "
          f"external phase reproduces full: {np.allclose(full, full_p, atol=1e-5)}")
    for with_phase in (False, True):
        for chunk in (20, 40):
            for margin in (0, 4, 8, 12, 16, 24):
                out = []
                for s in range(0, frames, chunk):
                    e = min(frames, s + chunk)
                    lo, hi = max(0, s - margin), min(frames, e + margin)
                    ph = cum[:, int(lo * steps):int(hi * steps), :] if with_phase else None
                    y = run(en[:, :, lo:hi], asr[:, :, lo:hi], stats, ph)[0].ravel()
                    out.append(y[(s - lo) * SPF:(e - lo) * SPF])
                y = np.concatenate(out)
                l = lsd(full, y)
                snr = 10 * np.log10((full**2).sum() / max(((full - y[: full.size]) ** 2).sum(), 1e-20))
                print(f"  global stats{' + carried phase' if with_phase else ''}, chunk {chunk} fr, margin {margin:2d} fr ({margin * 25} ms): "
                      f"LSD mean {l[loud].mean():5.2f} dB, max {l.max():5.2f} dB, waveform SNR {snr:5.1f} dB")
