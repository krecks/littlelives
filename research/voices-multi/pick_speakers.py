"""Picks multi-speaker voices for listening from a `piper.mjs scan` folder: sex by median F0
(Praat; under 150 Hz male, over 175 Hz female), then the best three of each by UTMOS.

Usage: TORCH_HOME=... python -I pick_speakers.py scan_dir  -> prints `m1=sid ... f3=sid`
"""
import glob
import os
import re
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import pitch_formants  # noqa: E402
from quality import utmos  # noqa: E402

rows = []
for p in glob.glob(os.path.join(sys.argv[1], 's*_line3.wav')):
    sid = int(re.match(r's(\d+)_', os.path.basename(p)).group(1))
    x, sr = sf.read(p, dtype='float32')
    f0, _, _ = pitch_formants(x, sr)
    rows.append((sid, float(np.median(f0)) if f0 else 0.0, utmos(x, sr)))
male = sorted([r for r in rows if 0 < r[1] < 150], key=lambda r: -r[2])
female = sorted([r for r in rows if r[1] > 175], key=lambda r: -r[2])
print(f'# {len(rows)} speakers: {len(male)} male-range, {len(female)} female-range; UTMOS mean {np.mean([r[2] for r in rows]):.2f}', file=sys.stderr)
for r in male[:3] + female[:3]:
    print(f'#   sid {r[0]:4d}  F0 {r[1]:4.0f}  UTMOS {r[2]:.2f}', file=sys.stderr)
print(' '.join([f'm{i + 1}={r[0]}' for i, r in enumerate(male[:3])] + [f'f{i + 1}={r[0]}' for i, r in enumerate(female[:3])]))
