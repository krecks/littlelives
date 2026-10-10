"""ONNX Runtime (1 thread) per-block time, FLOPs and tensor shapes for Paradee-8M.

venv/bin/python -I ort_profile.py model.onnx ids.json
"""
import collections
import json
import os
import sys
import tempfile

import numpy as np
import onnx
import onnxruntime as ort

ort.set_default_logger_severity(3)
path, ids_path = sys.argv[1], sys.argv[2]
lines = json.load(open(ids_path))
model = onnx.load(path)
attrs = {}
for n in model.graph.node:
    attrs[n.name] = {a.name: onnx.helper.get_attribute_value(a) for a in n.attribute}


def block(name):
    n = name.lstrip("/")
    head = n.split("/")[0].split(".")[0]
    if n.startswith("ds/generator"):
        sub = n.split("/")[2] if n.count("/") >= 2 else ""
        if sub.startswith("m_source") or sub in ("Conv", "noise_convs.0", "noise_convs.1") or sub.startswith("noise"):
            return "5a generator: source+noise branch"
        if sub.startswith("ups") or sub.startswith("resblocks"):
            return "5b generator: ups+resblocks"
        return "5c generator: post+iSTFT"
    if n.startswith("ds/"):
        return "4 decoder (AdaIN res blocks)"
    if head in ("bert", "bert_encoder"):
        return "1 PL-BERT (ALBERT)"
    if head in ("lstms", "lstm", "duration_proj"):
        return "2a duration predictor"
    if head in ("shared", "F0", "N", "F0_proj", "N_proj"):
        return "2b F0/energy predictor"
    if head in ("embedding", "cnn", "lstm_1", "asr_proj"):
        return "3 text encoder"
    if head == "lock":
        return "6 phase lock"
    return "7 glue"


def numel(shape):
    return int(np.prod(shape)) if shape else 1


def flops(op, name, ins, outs):
    a = attrs.get(name, {})
    try:
        if op in ("Conv", "FusedConv"):
            w = ins[1]
            return 2 * numel(outs[0]) * w[1] * w[2]
        if op == "ConvTranspose":
            w = ins[1]  # [Cin, Cout/g, K]
            return 2 * numel(ins[0]) * w[1] * w[2]
        if op in ("MatMul", "Gemm", "FusedMatMul"):
            k = ins[0][-1] if not a.get("transA") else ins[0][-2]
            return 2 * numel(outs[0]) * k
        if op == "LSTM":
            x, w, r = ins[0], ins[1], ins[2]
            t = x[0]
            return 2 * w[0] * t * w[1] * (w[2] + r[2])
    except Exception:
        return 0
    return 0


for line, ids in lines.items():
    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    so.enable_profiling = True
    so.profile_file_prefix = os.path.join(tempfile.mkdtemp(), "p")
    s = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    feed = {"input_ids": np.array([ids], np.int64), "speed": np.array([1.0], np.float32)}
    for _ in range(3):
        out = s.run(None, feed)[0]
    prof = s.end_profiling()
    events = [e for e in json.load(open(prof)) if e.get("cat") == "Node" and e["name"].endswith("_kernel_time")]
    # last run only
    runs = 3
    per_run = len(events) // runs
    events = events[-per_run:]
    t_block = collections.Counter()
    f_block = collections.Counter()
    t_op = collections.Counter()
    shapes = {}
    for e in events:
        node = e["name"][: -len("_kernel_time")]
        op = e["args"].get("op_name", "?")
        ins = [list(d.values())[0] for d in e["args"].get("input_type_shape", [])]
        outs = [list(d.values())[0] for d in e["args"].get("output_type_shape", [])]
        b = block(node)
        t_block[b] += e["dur"]
        t_op[op] += e["dur"]
        f_block[b] += flops(op, node, ins, outs)
        shapes[node] = (op, ins, outs)
    audio = out.size / 24000
    total = sum(t_block.values())
    print(f"\n== {len(line)} chars, {len(ids)} tokens, {audio:.2f} s audio, ORT kernel sum {total/1e3:.1f} ms")
    print(f"{'block':38s}{'ms':>8s}{'%':>6s}{'MFLOP':>9s}{'GFLOP/s':>9s}")
    for b in sorted(t_block):
        print(f"{b:38s}{t_block[b]/1e3:8.1f}{100*t_block[b]/total:6.1f}{f_block[b]/1e6:9.1f}{(f_block[b]/max(t_block[b],1))/1e3:9.1f}")
    tf = sum(f_block.values())
    print(f"{'total':38s}{total/1e3:8.1f}{100:6.0f}{tf/1e6:9.1f}{(tf/total)/1e3:9.1f}   ({tf/1e9/audio:.2f} GFLOP per s of audio)")
    print("top ops:", ", ".join(f"{k} {v/1e3:.1f}" for k, v in t_op.most_common(10)))
    keys = ["/bert/encoder/embedding_hidden_mapping_in/MatMul", "/lstm_1/LSTM", "/asr_proj/asr_proj.2/MatMul", "/shared/LSTM",
            "/F0_proj/Conv", "/ds/encode/conv1/Conv", "/ds/decode.3/conv2/Conv", "/ds/generator/m_source/l_linear/MatMul",
            "/ds/generator/ups.0/ConvTranspose", "/ds/generator/resblocks.0/convs1.0/Conv", "/ds/generator/ups.1/ConvTranspose",
            "/ds/generator/resblocks.3/convs1.0/Conv", "/ds/generator/conv_post/Conv", "/ds/generator/ConvTranspose", "/lock/Conv",
            "/lock/ConvTranspose"]
    for k in keys:
        if k in shapes:
            op, ins, outs = shapes[k]
            print(f"   {k:48s} {op:14s} in {ins[0]} -> out {outs[0]}")
