# Research: genuinely different resident voices (2026-10-10)

Throwaway research, no production changes. Question: how can residents get really different
voices, men included, within the browser constraints (one WASM thread, no cross-origin
isolation, never costing frames, 30-60 MB, MIT-compatible, deterministic)?

All numbers: Apple M3 Pro, ONNX Runtime Web 1.30 (WASM SIMD, one thread) in Node 22 and in Chrome
for Testing 1243 (headless and headed), the three lines "Do I know you?", "Pretty good, thanks
for asking!", "I had the strangest dream last night." (14/31/37 characters).

## Results

| Model | File (gzip) | ms per line (Chrome) | x real time | Voices | Male/female apart? | UTMOS (men) | Licence |
|---|---|---|---|---|---|---|---|
| Paradee-8M, pitch only (today) | 9.0 MB (7.4) | 203-462 | 5.2-6.4 | 1 | no: same speaker, cos 0.92 within / 0.81 across | 2.5-3.2 | Apache-2.0 |
| Paradee-8M + depth | same | same + 1-2 ms resample | same | 1 | across yes (0.23), within no (0.76) | 2.9-3.5 | Apache-2.0 |
| Kokoro-82M q8 / q8f16, WASM | 92 / 86 MB (62 / 56) | 2800-4500 (Node) | 0.55-0.57 | 28 + blends | yes (0.32 / 0.15) | 4.1-4.3 | Apache-2.0 |
| Kokoro-82M fp32/fp16/q4f16, WebGPU | 326/163/155 MB | 1190-1750 (first line 1.3-7 s) | 1.1-1.5 | 28 + blends | yes | 4.1-4.3 | Apache-2.0 |
| Kokoro-7M-Distill + Kokoro packs | 30.7 MB (27.6) | 158-283 | 9.0 | 1 in practice | no: all packs give one woman (0.82 / 0.80) | 1.4-2.9 | Apache-2.0 |
| **KittenTTS nano 0.8, weight-only int8** | **15.4 MB (13.4)** + 3.3 MB voices | 918-1629 | 3.3-3.5 | 8 (4 m, 4 f) + blends | **yes (0.43 / 0.16; blends 0.6-0.9 to parents)** | **4.2-4.3** | Apache-2.0 |
| KittenTTS nano 0.8 official int8 | 24.4 MB (20.6) | 1276-2114 (Node) | 2.2-2.6 | 8 | yes | 3.9-4.2 | Apache-2.0 |
| KittenTTS micro / mini 0.8 | 41 / 78 MB | 1116-2304 / 2273-4786 (Node) | 2.2 / 0.85 | 8 | yes | 4.1-4.2 | Apache-2.0 |
| Piper LibriTTS-R medium, weight-only int8 | 22.0 MB (19.1) | 144-274 | 6.3-6.4 | 904 | yes (0.42 / 0.17), male F0 124 Hz | 4.2-4.3 | **CC BY 4.0 data, but fine-tuned from lessac (research-only licence)** |
| Piper LibriTTS high (from scratch), int8 | 41.8 MB (30.0) | 1094-2547 (Node) | 0.8 | 904 | yes | 3.8-4.0 | CC BY 4.0 |
| Piper VCTK medium, int8 | 20.4 MB (17.7) | 141-296 (Node) | 6.2-6.6 | 109 (British) | yes (0.28 / 0.16) | 3.7-4.1 | CC BY 4.0 + lessac |

Separation: WeSpeaker ResNet34 speaker-embedding cosine, mean within sex / across sexes (one real
speaker scores about 0.6-0.8, different people mostly under 0.3). UTMOS22 strong per voice, mean
over the three lines (short lines score lower than the papers' long ones: Paradee's female voice
here 3.95-4.06). Whisper base.en understood every line of every candidate except Piper high.
Every model is bit-deterministic with our noise edit (model_edit.mjs; Kokoro-82M's export has no
random nodes).

Frame cost (Chrome, WebGL2 load calibrated to hold 60 fps): no WASM candidate moved frame times.
Kokoro on WebGPU, headed on the 120 Hz display: fp32 halved the frame rate (median 8.9 to 16 ms),
fp16/q4f16 raised the median 10.4 to 11-12 ms, p95 about 20 ms, no frame over 50 ms.

## Findings

- **Paradee can't take Kokoro's voices.** Its style is two learned constants, `ts.style` (1x32,
  prosody) and `ds.style` (1x16, decoder) (`trace_style.py`), not Kokoro's 256-wide `ref_s`.
  Perturbing them (`paradee_style.py`) changes timbre a little (cos 0.84-0.87) when it doesn't
  break the voice (UTMOS 1.3 for several directions): not a speaker space.
- **Paradee's pitch factor is compressed and costs quality below x0.8** (`pitch_sweep.py`, Praat):
  x0.6 gives 138 Hz instead of 122, voicing drops by 30 %, and male UTMOS falls to 2.5-3.2. F2
  stays at a woman's 2.0 kHz. Depth lowers F2 to 1.76 kHz and helps (2.9-3.5) but every man is
  still the same man.
- **Our phonemizer can feed espeak-trained models** (Kitten, Piper): Misaki to espeak IPA is
  Misaki's own substitution table backwards plus length marks (`misaki_espeak.mjs`). Across all
  1,026 game lines: 2.6 % segment difference from espeak-ng, the worst cases being espeak's errors
  ("Mmm", "Brr"). UTMOS with our phonemes equals UTMOS with espeak's.
- **Dynamic int8 (ConvInteger/MatMulInteger) is slow in ORT Web WASM**: Kokoro q8 is slower than
  fp32, Kitten's official int8 nano slower than its fp32. Weight-only int8 (`weight_int8.py`:
  int8 + per-channel scale + DequantizeLinear, Paradee's format) keeps fp32 speed at a quarter of
  the size, and scored better than the official int8 (UTMOS 3.88 vs 3.64).
- **Kokoro on WebGPU is not the 10x others report** under our constraints: 1.2-1.75 s per line
  whatever the precision; COOP/COEP with 4 threads didn't change it (WASM q8 reached 1.0x with 4
  threads). The first line takes 1.3-7 s (shader compilation).
- **KittenTTS nano blends** (two style vectors mixed linearly) give new voices at full quality
  (UTMOS 4.1-4.3), so every resident can have their own. Its clips start with 0.5-0.8 s of
  silence (trim), and the nano speed priors make Bella slow. Our `pitch` splice doesn't reach
  Kitten's pitch path (`/F0_proj/Conv` only feeds a Shape there); use depth (resampling) or find
  the right node.
- Kitten 0.8 is called "legacy" by its maker (now KittenTTS 2, 1.7B, own licence): frozen but
  Apache-2.0.

## Scripts

Scratch folder: `$WORK` (default the session scratchpad `voices-multi/`) holds downloads (`dl/`),
derived models (`models/`), the Node project with onnxruntime-web 1.30 and playwright-core
(`node/`), the Python venv (`.venv`: onnx, onnxruntime, praat-parselmouth, kaldi-native-fbank,
torch, faster-whisper, piper-phonemize-cross) and the samples (`samples/`, see its INDEX.md).

| Script | Does |
|---|---|
| `lines.mjs` | test lines, our production phonemizer WASM, WAV writer |
| `harness.mjs` | ORT Web WASM one thread, timing, memory, resampler for depth |
| `model_edit.mjs` | copy of `tools/voice/model.mjs`, generalised (optional pitch, any random nodes) |
| `inspect_style.py`, `trace_style.py`, `paradee_style.py`, `pitch_sweep.py` | Paradee's style constants and pitch path |
| `paradee.mjs`, `kokoro.mjs`, `kitten.mjs`, `piper.mjs` | benchmark + samples per candidate |
| `weight_int8.py` | weight-only int8 for any ONNX model |
| `espeak_ref.py` (research only, GPL espeak), `misaki_espeak.mjs` | reference IPA, our mapping and its score |
| `kitten_voices.py` | Kitten voices.npz to raw float32 |
| `pick_speakers.py` | multi-speaker models: men/women by F0, best by UTMOS |
| `analyze.py`, `quality.py` | F0/formants/centroid/speaker embeddings; UTMOS and Whisper WER |
| `browser/` | Chrome page: WebGL2 load + voice worker (WASM or WebGPU), frame times; `run.mjs` serves on port 5391 |
