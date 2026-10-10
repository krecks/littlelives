"""Run one or more ONNX files with ONNX Runtime (1 thread) on the same ids, timing and comparing.

venv/bin/python -I ort_check.py ids.json a.onnx [b.onnx ...]
ids.json: {"line": [ids...], ...}  (written by tract-bench `ids`)
Noise (RandomNormalLike/RandomUniformLike) is random in ORT, so audio is compared by
length and spectral correlation, not bit-exactly.
"""
import json
import sys
import time

import numpy as np
import onnxruntime as ort
ort.set_default_logger_severity(3)

lines = json.load(open(sys.argv[1]))
models = sys.argv[2:]


def spec(x):
    n = 512
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::256] * np.hanning(n)
    return np.log(np.abs(np.fft.rfft(frames, axis=1)) + 1e-5)


results = {}
for path in models:
    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    t = time.perf_counter()
    s = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    load = time.perf_counter() - t
    print(f"{path}: load {load:.3f} s")
    for line, ids in lines.items():
        feed = {"input_ids": np.array([ids], np.int64), "speed": np.array([1.0], np.float32)}
        if any(i.name == "pitch" for i in s.get_inputs()):
            feed["pitch"] = np.array([1.0], np.float32)
        best = 1e9
        for _ in range(5):
            t = time.perf_counter()
            out = s.run(None, feed)[0].ravel()
            best = min(best, time.perf_counter() - t)
        audio = out.size / 24000
        print(f"  {len(line):3d} chars {len(ids):3d} tok audio {audio:.2f} s  best {best*1e3:6.1f} ms  {audio/best:5.1f}x RT")
        results.setdefault(line, []).append(out)

for line, outs in results.items():
    a = outs[0]
    for b in outs[1:]:
        if a.size != b.size:
            print("LENGTH DIFFERS", line, a.size, b.size)
            continue
        c = np.corrcoef(spec(a).ravel(), spec(b).ravel())[0, 1]
        print(f"  spectral corr {c:.4f}  rms {np.sqrt((a**2).mean()):.4f} vs {np.sqrt((b**2).mean()):.4f}  {line}")
