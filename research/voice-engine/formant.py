"""Formant shift by resampling: synthesise at pitch P/a and speed s/a, then resample by a.
All frequencies (pitch and formants) scale by a and the duration by 1/a, so the result has
pitch P, the original duration, and formants x a: a < 1 is a larger vocal tract (men),
a > 1 a smaller one (children). Writes WAVs to compare by ear, with median F0 and the
spectral centroid as rough checks.

venv/bin/python -I formant.py model_with_pitch.onnx ids.json out_dir
"""
import json
import os
import sys
import time
import wave

import numpy as np
import onnxruntime as ort
from scipy.signal import resample_poly

ort.set_default_logger_severity(3)
model, ids_path, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)
so = ort.SessionOptions()
so.intra_op_num_threads = 1
s = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])


def synth(ids, pitch, speed):
    return s.run(None, {"input_ids": np.array([ids], np.int64), "speed": np.array([speed], np.float32), "pitch": np.array([pitch], np.float32)})[0].ravel()


def formant(ids, pitch, a, speed=1.0):
    y = synth(ids, pitch / a, speed / a)
    up, down = int(round(1000)), int(round(1000 * a))  # treat y as sampled at 24k*a
    t = time.perf_counter()
    z = resample_poly(y, up, down)
    return z.astype(np.float32), time.perf_counter() - t


def f0_median(x, sr=24000):
    # autocorrelation pitch on voiced-ish frames
    n, hop = 1024, 256
    f0s = []
    for i in range(0, x.size - n, hop):
        fr = x[i:i + n] * np.hanning(n)
        if np.sqrt((fr**2).mean()) < 0.02:
            continue
        ac = np.correlate(fr, fr, "full")[n - 1:]
        lo, hi = sr // 400, sr // 60
        lag = lo + np.argmax(ac[lo:hi])
        if ac[lag] > 0.3 * ac[0]:
            f0s.append(sr / lag)
    return float(np.median(f0s)) if f0s else 0.0


def centroid(x, sr=24000):
    spec = np.abs(np.fft.rfft(x * np.hanning(x.size)))
    f = np.fft.rfftfreq(x.size, 1 / sr)
    return float((spec * f).sum() / spec.sum())


def write(path, x, sr=24000):
    x = np.clip(x / max(1e-6, np.abs(x).max()) * 0.9, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


lines = json.load(open(ids_path))
line, ids = list(lines.items())[3]
print(line)
variants = [
    ("female", 1.0, 1.0),
    ("male_pitch_only_0.62", 0.62, 1.0),
    ("male_0.62_formant_0.88", 0.62, 0.88),
    ("male_0.62_formant_0.82", 0.62, 0.82),
    ("child_1.3_formant_1.12", 1.3, 1.12),
]
for name, p, a in variants:
    if a == 1.0:
        y, rs = synth(ids, p, 1.0), 0.0
    else:
        y, rs = formant(ids, p, a)
    write(os.path.join(out_dir, f"{name}.wav"), y)
    print(f"  {name:26s} {y.size / 24000:.2f} s  F0 ~{f0_median(y):5.0f} Hz  spectral centroid {centroid(y):5.0f} Hz  resample {rs * 1e3:.1f} ms")
