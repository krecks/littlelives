"""How far does Paradee's `pitch` factor actually move F0 and the formants? Renders line 3 at
several factors (native ONNX Runtime, one thread) and measures with Praat (analyze.py).

Usage: python -I pitch_sweep.py paradee-8m-edit1.onnx
"""
import os
import sys

import numpy as np
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import pitch_formants  # noqa: E402

ort.set_default_logger_severity(3)
IDS = [0, 157, 25, 16, 50, 72, 46, 16, 81, 83, 16, 61, 62, 123, 156, 24, 56, 82, 102, 61, 62, 16, 46, 123, 156, 51, 55, 16, 54, 156, 72, 61, 62, 16, 56, 156, 25, 62, 4, 0]
so = ort.SessionOptions()
so.intra_op_num_threads = 1
s = ort.InferenceSession(sys.argv[1], so, providers=['CPUExecutionProvider'])
for p in (0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4):
    y = s.run(None, {'input_ids': np.array([IDS], np.int64), 'speed': np.array([1], np.float32), 'pitch': np.array([p], np.float32)})[0].ravel()
    f0, f1, f2 = pitch_formants(y, 24000)
    print(f'pitch x{p:.1f}: F0 {np.median(f0):5.0f} Hz (expected {203 * p:4.0f}), voiced {len(f0):3d} frames, F1 {np.median(f1):4.0f}, F2 {np.median(f2):4.0f}')
