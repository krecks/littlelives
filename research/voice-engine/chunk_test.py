"""Streaming option (b): decode the decoder+generator half (B) in chunks of frames with context
margins, and compare with decoding the whole line at once.

The harmonic source's phase is a running sum from the start of whatever is decoded, so a
chunk's waveform is phase-shifted against the full decode: waveform SNR is meaningless and the
comparison uses the log-spectral distance (LSD, dB). Reference points: the same model run twice
with its own random noise (the variation players already hear), and noise zeroed vs not.

venv/bin/python -I chunk_test.py out/split_q8_a.onnx out/split_q8_b.onnx out/ids.json
"""
import json
import sys

import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, numpy_helper

ort.set_default_logger_severity(3)
a_path, b_path, ids_path = sys.argv[1:4]
SPF = 600  # samples per duration frame


def session(model):
    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    return ort.InferenceSession(model if isinstance(model, str) else model.SerializeToString(), so, providers=["CPUExecutionProvider"])


def zero_noise(path):
    b = onnx.load(path)
    nodes = []
    zero = "zero_noise_const"
    b.graph.initializer.append(numpy_helper.from_array(np.array(0.0, np.float32), zero))
    for n in b.graph.node:
        if n.op_type in ("RandomNormalLike", "RandomUniformLike"):
            nodes.append(helper.make_node("Mul", [n.input[0], zero], [n.output[0]], name=n.name + "_zero"))
        else:
            nodes.append(n)
    del b.graph.node[:]
    b.graph.node.extend(nodes)
    return b


sa = session(a_path)
sb = session(zero_noise(b_path))
sb_noisy = session(b_path)
names_b = [i.name for i in sb.get_inputs()]


def decode(en, asr, s=None):
    return (s or sb).run(None, {names_b[0]: en, names_b[1]: asr})[0].ravel()


def logspec(x, n=1024, hop=256):
    if x.size < n:
        x = np.pad(x, (0, n - x.size))
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    return 20 * np.log10(np.abs(np.fft.rfft(fr, axis=1)) + 1e-4)


def lsd(a, b, frames=None):
    """Log-spectral distance in dB per STFT frame (RMS over bins)."""
    n = min(a.size, b.size)
    A, B = logspec(a[:n]), logspec(b[:n])
    return np.sqrt(((A - B) ** 2).mean(axis=1))


def rms_db(x):
    return 20 * np.log10(np.sqrt((x**2).mean()) + 1e-9)


for line, ids in json.load(open(ids_path)).items():
    if len(ids) < 20:
        continue
    d, t_en, dur = sa.run(None, {"input_ids": np.array([ids], np.int64), "speed": np.array([1.0], np.float32)})
    tok = np.repeat(np.arange(len(dur)), dur.astype(np.int64))
    en, asr = d[:, :, tok].astype(np.float32), t_en[:, :, tok].astype(np.float32)
    frames = en.shape[2]
    full = decode(en, asr)
    # loud frames only (silences make LSD explode on -80 dB noise floors)
    loud = logspec(full).max(axis=1) > logspec(full).max() - 40
    n1, n2 = decode(en, asr, sb_noisy), decode(en, asr, sb_noisy)
    print(f"\n{len(line)} chars, {frames} frames ({frames * SPF / 24000:.2f} s): {line}")
    print(f"  deterministic without noise: {np.array_equal(full, decode(en, asr))}")
    print(f"  reference: original model, two runs (random noise)  LSD {lsd(n1, n2)[loud].mean():.2f} dB")
    print(f"  reference: noise on vs off                          LSD {lsd(full, n1)[loud].mean():.2f} dB")
    for chunk in (20, 40):
        for margin in (0, 8, 16, 24):
            out = []
            for s in range(0, frames, chunk):
                e = min(frames, s + chunk)
                lo, hi = max(0, s - margin), min(frames, e + margin)
                out.append(decode(en[:, :, lo:hi], asr[:, :, lo:hi])[(s - lo) * SPF:(e - lo) * SPF])
            y = np.concatenate(out)
            l = lsd(full, y)
            # worst STFT frames around chunk boundaries
            bounds = [int(s * SPF / 256) for s in range(chunk, frames, chunk)]
            near = [l[max(0, b - 2):b + 3].max() for b in bounds if b < len(l)]
            print(f"  chunk {chunk:2d} fr ({chunk * SPF / 24000:.2f} s) margin {margin:2d} fr ({margin * SPF / 24000:.2f} s): "
                  f"LSD mean {l[loud].mean():.2f} dB, worst near boundaries {max(near) if near else 0:.2f} dB, level {rms_db(y) - rms_db(full):+.2f} dB")
