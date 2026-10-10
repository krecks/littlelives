"""Objective voice separation for folders of `<voice>_line<N>.wav` samples.

Per voice (over its lines):
- median F0 (Praat's autocorrelation pitch, 60-500 Hz, via parselmouth; research only);
- median F1 and F2 (Praat Burg formants on voiced frames, ceiling 5.5 kHz): vocal-tract size,
  what separates men, women and children besides pitch;
- median spectral centroid (0-8 kHz, so 22.05 and 24 kHz models compare);
- a speaker embedding from WeSpeaker ResNet34 (VoxCeleb, Apache-2.0; 80-dim Kaldi fbank at
  16 kHz, mean-normalised, 256-d output), averaged over lines.
Then cosine similarity between voices: within the same sex, across sexes, and the closest pair.
For reference, this model scores two recordings of one real speaker around 0.6-0.8 and different
real speakers mostly below 0.3 (its verification threshold is around 0.3-0.4).

Sex comes from the voice name: `child...`, Kokoro's `af_/am_/bf_/bm_`, or a leading `f`/`m`.

Usage: python -I analyze.py wespeaker.onnx samples_dir [samples_dir ...]
(prints Markdown, writes analysis.json into each folder)
"""
import collections
import glob
import json
import os
import re
import sys

import numpy as np
import parselmouth
import soundfile as sf
from scipy.signal import resample_poly


def sex(name):
    if name.startswith('child'):
        return 'child'
    m = re.match(r'^[ab]?([fm])(_|\d|$)', name)
    return m.group(1) if m else '?'


def pitch_formants(x, sr):
    snd = parselmouth.Sound(x.astype(np.float64), sampling_frequency=sr)
    pitch = snd.to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=500)
    f0 = pitch.selected_array['frequency']
    times = pitch.xs()
    voiced = [t for t, f in zip(times, f0) if f > 0]
    fm = snd.to_formant_burg(time_step=0.01, max_number_of_formants=5, maximum_formant=5500)
    f1 = [fm.get_value_at_time(1, t) for t in voiced]
    f2 = [fm.get_value_at_time(2, t) for t in voiced]
    clean = lambda v: [a for a in v if a == a]  # drop NaN
    return list(f0[f0 > 0]), clean(f1), clean(f2)


def centroid(x, sr):
    n, hop = 1024, 256
    f = np.fft.rfftfreq(n, 1 / sr)
    band = f <= 8000
    rms_all = np.sqrt((x ** 2).mean())
    cs = []
    for i in range(0, x.size - n, hop):
        fr = x[i:i + n]
        if np.sqrt((fr ** 2).mean()) < 0.3 * rms_all:
            continue
        s = np.abs(np.fft.rfft(fr * np.hanning(n)))[band]
        cs.append((s * f[band]).sum() / (s.sum() + 1e-12))
    return float(np.median(cs))


class Embedder:
    def __init__(self, path):
        import onnxruntime as ort

        ort.set_default_logger_severity(3)
        self.s = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
        self.name = self.s.get_inputs()[0].name

    def __call__(self, x, sr):
        import kaldi_native_fbank as knf

        y = resample_poly(x, 16000, sr) if sr != 16000 else x
        opts = knf.FbankOptions()
        opts.frame_opts.dither = 0
        opts.frame_opts.samp_freq = 16000
        opts.mel_opts.num_bins = 80
        fb = knf.OnlineFbank(opts)
        fb.accept_waveform(16000, (y * 32768).tolist())
        fb.input_finished()
        feats = np.stack([fb.get_frame(i) for i in range(fb.num_frames_ready)]).astype(np.float32)
        feats -= feats.mean(0, keepdims=True)
        e = self.s.run(None, {self.name: feats[None]})[0][0]
        return e / np.linalg.norm(e)


def analyse(folder, embed):
    voices = collections.defaultdict(list)
    for p in sorted(glob.glob(os.path.join(folder, '*_line*.wav'))):
        voices[re.sub(r'_line\d+\.wav$', '', os.path.basename(p))].append(p)
    rows = {}
    for v, paths in voices.items():
        f0s, f1s, f2s, cents, embs = [], [], [], [], []
        for p in paths:
            x, sr = sf.read(p, dtype='float32')
            a, b, c = pitch_formants(x, sr)
            f0s += a
            f1s += b
            f2s += c
            cents.append(centroid(x, sr))
            embs.append(embed(x, sr))
        e = np.mean(embs, 0)
        med = lambda v: float(np.median(v)) if v else 0.0
        rows[v] = dict(sex=sex(v), f0=med(f0s), f1=med(f1s), f2=med(f2s), centroid=med(cents), emb=e / np.linalg.norm(e))
    names = list(rows)
    E = np.stack([rows[n]['emb'] for n in names])
    S = E @ E.T
    within, across, allp = [], [], []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = rows[names[i]]['sex'], rows[names[j]]['sex']
            allp.append((S[i, j], names[i], names[j]))
            if a in 'fm' and b in 'fm':
                (within if a == b else across).append(S[i, j])
    allp.sort(reverse=True)
    print(f'\n### {folder}\n')
    print('| voice | sex | F0 Hz | F1 Hz | F2 Hz | centroid Hz | nearest (cos) |')
    print('|---|---|---|---|---|---|---|')
    for i, n in enumerate(names):
        j = max((k for k in range(len(names)) if k != i), key=lambda k: S[i, k]) if len(names) > 1 else i
        r = rows[n]
        print(f"| {n} | {r['sex']} | {r['f0']:.0f} | {r['f1']:.0f} | {r['f2']:.0f} | {r['centroid']:.0f} | {names[j]} ({S[i, j]:.2f}) |")
    mean = lambda v: round(float(np.mean(v)), 3) if v else None
    by = lambda s, k: mean([r[k] for r in rows.values() if r['sex'] == s])
    summary = dict(
        voices=len(names),
        within_sex_cos=mean(within),
        across_sex_cos=mean(across),
        all_pairs_cos=mean([p[0] for p in allp]),
        closest=[(round(float(s), 3), a, b) for s, a, b in allp[:3]],
        f0_m=by('m', 'f0'), f0_f=by('f', 'f0'), f1_m=by('m', 'f1'), f1_f=by('f', 'f1'), f2_m=by('m', 'f2'), f2_f=by('f', 'f2'),
    )
    print('\n' + json.dumps(summary))
    out = dict(summary=summary, voices={n: {k: v for k, v in r.items() if k != 'emb'} for n, r in rows.items()}, names=names, similarity=S.round(3).tolist())
    json.dump(out, open(os.path.join(folder, 'analysis.json'), 'w'), indent=1)
    return out


if __name__ == '__main__':
    embed = Embedder(sys.argv[1])
    for folder in sys.argv[2:]:
        analyse(folder, embed)
