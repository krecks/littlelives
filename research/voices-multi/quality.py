"""Quality proxies for folders of `<voice>_line<N>.wav` samples (research only):
- UTMOS22 "strong" (tarepan/SpeechMOS via torch.hub; the metric of the Paradee paper), per clip;
- word error rate of Whisper base.en (faster-whisper, CTranslate2) against the line's text.

Usage: TORCH_HOME=... python -I quality.py samples_dir [samples_dir ...]
(prints a summary per folder and per voice, writes quality.json into each folder)
"""
import collections
import glob
import json
import os
import re
import sys

import jiwer
import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly

LINES = ['Do I know you?', 'Pretty good, thanks for asking!', 'I had the strangest dream last night.']
_utmos = None
_asr = None


def utmos(x, sr):
    global _utmos
    if _utmos is None:
        _utmos = torch.hub.load('tarepan/SpeechMOS:v1.2.0', 'utmos22_strong', trust_repo=True, verbose=False)
    with torch.no_grad():
        return float(_utmos(torch.from_numpy(x)[None], sr))


def transcribe(x, sr):
    global _asr
    if _asr is None:
        from faster_whisper import WhisperModel

        _asr = WhisperModel('base.en', device='cpu', compute_type='int8')
    y = resample_poly(x, 16000, sr).astype(np.float32) if sr != 16000 else x
    segs, _ = _asr.transcribe(y, language='en', beam_size=5)
    return ' '.join(s.text for s in segs).strip()


norm = jiwer.Compose([jiwer.ToLowerCase(), jiwer.RemovePunctuation(), jiwer.RemoveMultipleSpaces(), jiwer.Strip(), jiwer.ReduceToListOfListOfWords()])


def wer(ref, hyp):
    return jiwer.wer(ref, hyp, reference_transform=norm, hypothesis_transform=norm)


def score(folder):
    per = collections.defaultdict(list)
    for p in sorted(glob.glob(os.path.join(folder, '*_line*.wav'))):
        m = re.match(r'(.*)_line(\d+)\.wav$', os.path.basename(p))
        voice, li = m.group(1), int(m.group(2))
        x, sr = sf.read(p, dtype='float32')
        hyp = transcribe(x, sr)
        per[voice].append(dict(line=li, utmos=utmos(x, sr), wer=wer(LINES[li - 1], hyp), heard=hyp))
    voices = {v: dict(utmos=float(np.mean([r['utmos'] for r in rs])), wer=float(np.mean([r['wer'] for r in rs])), clips=rs) for v, rs in per.items()}
    allc = [c for v in voices.values() for c in v['clips']]
    summary = dict(clips=len(allc), utmos=round(float(np.mean([c['utmos'] for c in allc])), 3), utmos_min_voice=round(min(v['utmos'] for v in voices.values()), 3), wer=round(float(np.mean([c['wer'] for c in allc])), 3))
    print(f'\n### {folder}: {json.dumps(summary)}')
    for v, r in voices.items():
        bad = [c['heard'] for c in r['clips'] if c['wer'] > 0]
        print(f"  {v:32s} UTMOS {r['utmos']:.2f}  WER {100 * r['wer']:4.0f} %  {('misheard: ' + ' | '.join(bad)) if bad else ''}")
    json.dump(dict(summary=summary, voices=voices), open(os.path.join(folder, 'quality.json'), 'w'), indent=1)
    return summary


if __name__ == '__main__':
    for f in sys.argv[1:]:
        score(f)
