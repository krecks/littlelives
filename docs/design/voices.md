# Resident voices

*Plan for residents speaking their thoughts and conversations out loud. Status (2026-10-10):
phases 1–4 are in, with the guards of phase 6 that don't need Auto mode (see "Built so far");
the hand-written engine (phase 5), Auto mode and Kokoro are next. Babble, a made-up language
(0.14–0.19), was removed in 0.20.0: residents speak English or not at all. Measurements
and research behind the choices are at the end.*

## Built so far

- **Engine (`crates/voice`, `crates/voice-wasm`):** Misaki's English rules ported to Rust
  (`g2p.rs`; matches Python Misaki 0.9.4 on all 25 test sentences in `tests/data`), the merged
  Misaki dictionary, letter-to-sound guesses for unknown names (`rules.rs`), and Paradee-8M run
  with `tract`, patched with a `pitch` input and seeded noise (`model.rs`). `npm run voice`
  fetches the pinned files into `web/public/voice/` and builds the WASM; `npm run test:voice`
  runs the tests.
- **Browser (`web/src/voice/`):** voice worker with a Cache API download (`tts.worker.ts`),
  app-wide service and speed test (`service.svelte.ts`), the director with the "who may speak"
  rules (`index.ts`), lines per language (`content/voice/en.json`, keyed by content ids, per item and interaction; packs add theirs), per-resident
  pitch and speed (`voices.ts`), stereo playback (`player.ts`). Settings → Audio.
- **Measured in Chrome (M-series Mac):** about 1 s per typical line, 3.8× faster than real
  time on one thread, no frame over 17 ms while speaking. Download: 18.3 MB engine WASM (3.9 MB
  gzipped), 9 MB model, 1.3 MB dictionary, cached after the first time.
- **Voices by life stage (`voices.ts`):** children higher, boys' voices drop as teens, elders
  lower and slower. Babies don't speak.
- **Voices chosen in the household creator:** pitch and speed per resident, kept in the save
  (see "A resident's own voice").
- **Guards (`voice/index.ts`):** nothing is said while the engine loads; it unloads after 5
  minutes without a line and reloads on the next (quiet meanwhile); a watchdog pauses voices for
  the session (with a toast) after three lines in a row later than 4 s, or when over 10 % of the
  frames drawn while speech is made exceed 50 ms and that is at least twice the share without.
  The F3 voice section shows whether voices are on, off or paused.
- **Not yet:** formant shift for English (lower voices still sound like a pitched-down woman),
  Kokoro-82M as a second model, Auto mode, the clip cache.

Residents speak with a text-to-speech model that runs **entirely in the browser**: no server, no
API key, nothing leaves the player's computer. English uses **Paradee-8M** (9 MB), run by **our
own Rust engine** compiled to WebAssembly. Kokoro-82M, the model Paradee was distilled from, stays an optional
download for more voices.

## Goals and rules

- **Performance first.** Speech must never cost frames. It runs in its own worker, on the CPU or
  the GPU depending on the model and on what this computer handles better, and a benchmark in
  Settings decides.
- **Quiet by default.** Residents only speak when:
  1. **a resident is selected** (their Inspect panel is open, `game.inspected`): they speak their
     thoughts, and they and whoever they are talking to speak their conversation; or
  2. **the player started a conversation** (from the social menu): both residents speak that
     conversation until it ends, even if neither is selected.

  Nobody else speaks, including while the camera is watching on its own.
- **Presentation only.** Voices never feed back into the simulation. The line a resident says is
  picked with a hash of the resident id and event, not the sim's random number generator, so
  saves and replays are unaffected and `sim-core` needs no changes.
- **Every resident sounds different**, and always the same, across sessions and saves.
- **Small download, on request.** Paradee (9 MB) is fetched when the player turns English voices
  on; Kokoro-82M (92–326 MB) only if they choose it.

## The model: Paradee-8M

[Paradee-8M v1.0](https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0) is Kokoro-82M shrunk
to a tenth: the same architecture (Kokoro's own code) at smaller widths, 8.07M parameters,
distilled from Kokoro's `af_heart` voice.

| | |
|---|---|
| Licence | Apache-2.0 (weights and code), like Kokoro |
| Files | `paradee_int8.onnx` 9.0 MB (recommended), `paradee.onnx` 37 MB, PyTorch `text_side.pt` + `decoder.pt` |
| Input | Phoneme ids in **Misaki's** alphabet (178 symbols, max 512) and `speed` |
| Output | 24 kHz mono audio |
| Quality (paper) | UTMOS 4.41 vs Kokoro 4.52; word error rate 5.7 %, same as Kokoro |
| Speed (paper) | about 18× faster than real time, int8 ONNX, one CPU thread |
| Limits | American English only, **one voice** (female), a faint buzz on some voiced sounds |

It needs no GPU, so the GPU stays with Babylon.

What we measured ourselves (M-series Mac, one thread, "Hello! I'm hungry, I should cook
something.", 2.95 s of audio):

| Runtime | Time | Real-time factor |
|---|---|---|
| ONNX Runtime (Python, native) | 0.21–0.25 s | 12–14× faster than real time |
| `tract` 0.23 (pure Rust, native, unoptimised plan) | 0.75 s | 4× |
| `tract` 0.23 compiled to **WebAssembly** with SIMD, in Node | 1.5–1.6 s | 1.9× |

- `tract` output matches ONNX Runtime: same length and loudness, spectra correlate 0.988 (the
  model adds random noise, so the two are never bit-identical).
- `tract`'s optimiser rejects the graph (a `Range` op with a symbolic length); only the slower
  unoptimised plan runs. The test `.wasm` was 20 MB before stripping.
- **Pitch control works:** the graph has Kokoro's explicit pitch path (`/F0_proj/Conv` predicts
  the pitch curve, the decoder synthesises from it). Multiplying that curve by an extra `pitch`
  input gave a median pitch of 157 Hz at ×0.7, 209 Hz at ×1.0 and 261 Hz at ×1.3, with the same
  length and intact audio.

## Our engine (`crates/voice`)

ONNX Runtime Web would run Paradee, but it is a JavaScript dependency with its own multi-megabyte
WASM runtime (larger than the model), and it treats the model as a black box. `tract` runs it in
pure Rust today, but slowly. So we build a small engine for exactly this architecture.

**Crate layout** (no dependency on `sim-core`; its own `voice-wasm` build, loaded lazily in the
voice worker so the sim's WASM stays small):

| Part | Job |
|---|---|
| `g2p` | Text to Misaki phonemes (see "Phonemizer") |
| `model` | Weights and the network |
| `dsp` | Pitch, formant and noise controls; inverse STFT |
| `lib.rs` | `speak(text, voice) -> Vec<f32>` (24 kHz), exposed with `wasm-bindgen` |

**Two stages:**

1. **Baseline with `tract`** (days). Runs the unmodified `paradee_int8.onnx` plus build-time
   graph edits (a `pitch` input, as tested). Already measured at 1.9× real time in WASM on one
   thread: a 3-second line in about 1.5 s. Good enough to build everything around it, and the
   reference the hand-written engine is tested against.
2. **Hand-written inference** (about 1–2 weeks). A build script (`tools/voice/export.py`) reads
   the ONNX initialisers into one flat file (int8 weights with per-channel scales, float norms;
   about 9 MB). Rust implements the layer types the graph uses: embedding, the ALBERT-style text
   encoder (attention, layer norm, GELU), 1-D convolutions and transposed convolutions,
   bidirectional LSTMs (6), instance norm with style (AdaIN), leaky ReLU, upsampling, the
   harmonic sine source driven by the pitch curve, and the inverse STFT (magnitude and phase
   to audio). Shapes are known from the token count, so all buffers are allocated once and
   reused; matrix kernels use WASM SIMD128.

**Why our own engine pays off:**

- **Speed:** native ONNX Runtime already reaches 12–14×; a fixed-architecture engine with SIMD
  should reach **8× or more in the browser on one thread** (an estimate to confirm), i.e. a
  3-second line in under 0.4 s.
- **Size:** the WASM should be well under 1.5 MB (estimate), against about 20 MB for the `tract`
  test build.
- **Voice controls built in:** pitch (scale the pitch curve; tested), speed (scale durations),
  and **formant shift** (warp the magnitude spectrum along the frequency axis before the inverse
  STFT; untested). Together these turn one voice into many.
- **Deterministic audio:** the noise source takes a seed, so the same line and voice always give
  the same clip. That makes clips cacheable and lets tests compare against golden output.
- **Same architecture as Kokoro-82M,** so the engine can later run Kokoro's CPU path too, with a
  style vector input instead of a baked-in voice.

**Tests:** golden tests run the same phoneme ids through the engine and through `tract` (noise
disabled): durations and pitch curves must match exactly, audio within a set signal-to-noise
ratio. A benchmark test fails if real-time factor regresses.

If the hand-written engine stalls, the `tract` baseline ships.

## Voices from one model

Paradee speaks one female voice. Each resident gets a voice derived from their **stable resident
id** (release 0.7), gender and life stage, computed on the main thread; a voice chosen in the
creator is saved on top (see "A resident's own voice"):

```ts
interface VoiceSpec { pitch: number; formant: number; speed: number; seed: number }
```

- **Pitch:** female voices ×0.9–1.2, male voices ×0.55–0.7 (about 115–145 Hz), others across the
  whole range; children higher, elders slightly lower (life-cycle releases).
- **Formant:** shifts the vocal tract size, so male voices don't sound like a pitched-down woman
  and children sound small. This is the biggest risk: it needs stage 2 and is untested.
- **Speed:** 0.9–1.1, and per line by tone (excited faster, sad slower).
- **If male voices still sound wrong:** Paradee's training code is public and ran on one MacBook,
  so we can distil a second, male voice (e.g. Kokoro's `am_michael`) into another 9 MB model.
- **Kokoro-82M** (optional model): two of its 28 English voices blended per resident (a voice is a
  style vector, so blending is a linear mix), plus speed. More variety, much larger download.

### A resident's own voice

The household creator's *Identity* tab has a *Voice* section: **Pitch** (lower to higher),
**Speed** (slower to faster), a dice, a button back to the default, and **Hear** (the resident
says "Hi, I'm Ada! This is how I sound." in that voice; a baby is heard as the child they will be).
Hearing works with resident voices off in Settings and doesn't turn them on; the engine is
unloaded again when the creator closes. The note under the button shows the engine loading or
downloading, an error, or that voices are off.

The choice is stored in the resident's appearance, which the simulation keeps as opaque JSON, so
the save format doesn't change:

```ts
appearance.voice = { pitch: 1.08, speed: 0.95, seed: 1439030069 }
```

- **Factors on the generated voice** (`voiceFor`), 1 being as generated, each 0.88–1.12 (about
  two semitones of pitch). The life stage still applies underneath, so a child made "a bit
  higher" is a bit higher than their generated teen voice once grown. The result is kept within pitch
  0.52–1.5 and speed 0.8–1.2 (the generated voices span 0.56–1.45 and 0.86–1.12), and line tones
  (`withTone`) go on top.
- **`seed`** replaces the resident id in the generated voice: someone made in the creator has no
  id until they move in, and the voice heard there must be the one they keep. It is set the first
  time the Voice section is used.
- **Without `voice`** (older saves, neighbours, newcomers, babies, random residents from the
  creator's dice) a resident has the generated voice, exactly as before.
- A later voice size (`depth`, with formant shift) becomes one more optional factor.
- Main-thread rewrites of the appearance keep `voice`: life-stage looks and grey hair copy it
  along; the look expanded from a newcomer's or baby's seed keeps a voice stored next to it.
  Portraits ignore it (their cache key leaves it out).

There is no place to change a resident's look in a game yet; the Voice controls would go there too.

## Phonemizer: our own, in Rust, without espeak-ng

Paradee, like Kokoro, needs **Misaki** phonemes. `kokoro-js` gets phonemes from **espeak-ng
compiled to WASM, which is GPL-3**, and needs a conversion step (`web/misaki.js` in the Paradee
repo; without it Whisper mishears about 31 % of words). Littlelives is MIT. We don't use
espeak-ng.

Existing Rust options (checked 2026-10-09):

- **`misaki-rs`** (MIT, latest 0.6.0, September 2026): a port of Misaki with the dictionaries and
  a part-of-speech tagger built in. espeak is an optional feature that is on by default; without
  it, unknown words are spelled out letter by letter. Unclear whether it builds for `wasm32`
  (docs.rs has failed to build it since 0.3.0); about 40 MB of source; small project (10 stars).
- **Kokoros** (Apache-2.0), a Rust Kokoro runtime, builds espeak-ng in (`espeak-rs-sys`): same
  GPL problem.
- Not Rust: `@piper-plus/g2p` (MIT, rule-based, runs in the browser) outputs Piper's phonemes.

**Plan: `g2p` inside `crates/voice`** (MIT):

1. **Dictionary:** Misaki's English dictionaries (`us_gold`, `us_silver`; Apache-2.0, credited in
   `CREDITS.md`). They are already in the alphabet Paradee takes, so no mapping is needed. Ship
   them compressed; trim rare words if size matters.
2. **Text clean-up:** punctuation, contractions, possessive and plural "s", "-ed" and "-ing"
   endings (Misaki's suffix rules), numbers to words.
3. **Unknown words** (mostly residents' names): public-domain letter-to-sound rules (the 1976
   NRL rules), written in Misaki's alphabet. A tiny trained model can replace them later.
4. **Words with two pronunciations** ("read", "live"): content lines can mark the pronunciation
   (Misaki's `[word](/phonemes/)` markup); dynamic text accepts the occasional slip.
5. **Build-time check:** every line in the content is phonemized in a test, and a word that falls
   back to the rules fails it, so hand-written lines always sound right.

Phase 1 also tries `misaki-rs` with `default-features = false`. If it builds for `wasm32` at an
acceptable size, we use it (or a fork) and add only steps 3 and 5.

## Settings

A new **Audio** tab in Settings (`ui/screens/SettingsPanel.svelte`). "Sound effects" moves there
from Interface. Everything applies live, so nothing is added to `RESTART_KEYS`.

| Row | Control | Notes |
|---|---|---|
| Resident voices | Toggle | Default off. |
| Language | (hidden while English is the only one) | Comes back as a row when a second language ships. |
| Voice model | Paradee-8M · Kokoro-82M | Paradee: 9 MB, fast, one voice shaped per resident (default). Kokoro: 92–326 MB, 28 voices. Shows the state: "Not downloaded · 9 MB", "Downloading 45 %", "Ready", and a **Delete download** button. |
| Runs on | Auto · CPU · GPU | Paradee runs on the CPU only (an 8M model gains nothing from the GPU), so GPU is disabled with that explanation. For Kokoro, Auto uses the benchmark's choice; GPU is disabled without WebGPU. |
| Benchmark | **Test this computer** button | Shows the last result, e.g. "Paradee: 0.3 s per line · Kokoro CPU: 2.9 s · Kokoro GPU: 0.3 s, smooth". |
| Voice volume | Slider | Separate from sound effects. |

New keys in `settings.svelte.ts`:

```ts
voices: boolean;                          // false
voiceLanguage: 'en';                      // 'en'
voiceModel: 'paradee-8m' | 'kokoro-82m';  // 'paradee-8m'
voiceDevice: 'auto' | 'cpu' | 'gpu';      // 'auto'
voiceVolume: number;                      // 0.8
```

The benchmark result is stored under its own localStorage key (`littlelives.voiceBench`), not in
`Settings`, so "Reset to defaults" does not throw away a measurement.

Turning voices on with English the first time: download the model (progress in the row), run the
benchmark automatically, then speak. Until the model is ready, residents stay quiet.

## Performance

### Where the work runs

| Work | Thread | Cost |
|---|---|---|
| Deciding who speaks, picking lines, playback | Main thread | Microseconds, event-driven (no per-frame work) |
| Phonemes and Paradee inference | **Own module worker** (`voice/tts.worker.ts`) running `voice-wasm`, separate from the sim worker | Target under 0.4 s per line, never blocks a frame |
| Kokoro-82M (optional) | Same worker; CPU via our engine or ONNX Runtime WASM, GPU via ONNX Runtime WebGPU | 0.3–3 s per line |

- **Paradee:** one thread is enough. Two voices at once can use two engine instances if the
  benchmark shows spare cores (`navigator.hardwareConcurrency` ≥ 6), leaving cores for the main
  thread, the sim worker and the browser.
- **Kokoro on the GPU** shares the GPU with rendering, so it is only chosen when the benchmark
  shows frames stay smooth. Any WASM runtime files are self-hosted (bundled by Vite), following
  the "self-host all assets" rule.
- Model files load from Hugging Face by default (its CORS headers satisfy our COEP header) and
  can be pointed at a self-hosted copy through the asset manifest. The browser cache keeps them.

### Benchmark ("Test this computer")

Runs from Settings, in the main menu (the live 3D town draws behind it, so contention is
realistic) or in a game (speech pauses while it runs). Paradee alone takes a few seconds.

1. Download the model files being tested, if missing (progress shown). Kokoro is only tested if
   it is downloaded or the player asks.
2. For each available mode (Paradee on CPU; Kokoro on CPU, and on GPU if `navigator.gpu` gives
   an adapter):
   1. Load and say one warm-up line (measures cold start).
   2. Say five fixed test lines of typical lengths (3, 8, 12, 20 and 30 words).
   3. Record per line: time to finished clip and **real-time factor** (RTF = generation time ÷
      audio length).
   4. Meanwhile measure frame times with `requestAnimationFrame`: 2 s before as a baseline,
      then during inference. Record the rise in 95th-percentile frame time and frames over 50 ms.
3. Choose, per model:
   - **GPU** (Kokoro only) if its median RTF ≤ 0.33 (a 3-second line ready within 1 s) **and**
     frame time p95 rises ≤ 2 ms with no frames over 50 ms;
   - otherwise **CPU** if its median RTF ≤ 0.5;
   - otherwise the model is **too slow on this computer**: Auto falls back (Kokoro to Paradee,
     Paradee to voices off) and the row says so. The player can still force a mode.
4. Store `{ model, modelVersion, engineVersion, device, rtf, firstLineMs, frameP95RiseMs, cores,
   gpuAdapter, date }`. The benchmark re-runs automatically when the model, the engine, the core
   count or the GPU adapter changes.

### Guards while playing

- At most **two voices at once**, and at most one line per resident every ~8 s.
- A line that is not ready within **2 s** is dropped (the moment has passed).
- No generation while in Build or Buy mode, while the tab is hidden, or at speed 3× and above
  (except the conversation the player started).
- **Live watchdog:** the scheduler tracks each line's RTF and the renderer's frame times
  (`game.stats`). If three lines in a row are late, or frame time rises past the budget while
  inference runs, voices step down (as in the benchmark) for the session and a toast says why
  once.
- **Memory:** the worker is unloaded after 5 minutes without speech, and when voices are turned
  off. Finished clips are kept in an in-memory LRU cache as 16-bit audio, capped at about 8 MB
  (a few hundred lines), keyed by `hash(model, engineVersion, voice, text)`. Because the engine is
  deterministic, a cached clip is exactly what would be generated again.
- The performance overlay (F3) shows a voice line: model, mode, last RTF, queue length, cache
  hits.

## What residents say

Today's bubbles are icons only (`game/bubbles.ts`), so speech needs text: **hand-written lines as
content data** (`content/voice/<lang>.json`), so content packs can add and translate them. The
English file has about 1,000 lines, and the trait packs about 500 more for their own items.

- **Conversations** (`social`, per social interaction id): `start` for the one who starts it,
  `good` and `bad` for the answer once the outcome shows. Read from the snapshot fields `social`,
  `role`, `outcome` and `partner` that the bubbles already use.
- **Using something:** a line when the selected resident starts using an object. The snapshot
  says which (`objectDef` and `interaction`, content indices, next to the animation tag in
  `action`), so lines can be per item. The most specific lines win:
  1. `object.<object id>.interactions.<interaction id>` (the gourmet meal at the fridge);
  2. `object.<object id>.lines` (anything at the treadmill);
  3. `interaction.<interaction id>` on any object (`water`, `smell`, `homework`);
  4. `action.<animation tag>` (`cook`, `run`), which also covers repairs, accidents, knocking
     and tidying up, where no object interaction is in use.
- **Thoughts of the selected resident:** when their emotion changes (`emotion`, per emotion id)
  and when the planner shows a thought (`thought`, per thought kind: `skipped`, `noPlace`,
  `kept`, `goal`, `roomLoved`, `roomDisliked`, `broken`, `accident`, `crying`).
- **Later sources plug into the same pipeline:** the optional in-browser language model for
  thoughts (see `PLAN.md`, "Smarter thoughts").

A group of lines is a list, or `{"lines": [...], "tone": ...}`; an object's `tone` applies to its
`lines`. Tones (`happy`, `sad`, `angry`, `flirty`, `question`) adjust speed and pitch. `{name}` is
the other resident's first name, `{me}` the speaker's; `[word](/phonemes/)` fixes a
pronunciation (`[read](/ɹˈɛd/)` in the past tense).

**Variation:** the line is picked with a hash of the resident and a counter, never the sim's
random numbers. A resident doesn't say any of their last three lines for the same key again
while there are others (`voice/lines.ts`), so 4–6 lines per key go a long way.

**Writing lines:** short (most under 40 characters; speech is made per line), and right for
children, teens and grown-ups alike (babies don't speak). `cargo test -p voice --release --test
lines` phonemizes every English line, in the language file and in the packs, and fails on a word
missing from the dictionary (fix it with a pronunciation or another word), on symbols the model
doesn't know, on unknown placeholders or tones, and on keys that name no social, object,
interaction, animation tag, emotion or thought kind. Words with accents (`café`, `Zoë`) are read
as without them.

**Packs** carry lines under a top-level `"voice": {"en": {...}}`, laid out like the language
file; the web side merges them over it key by key (sim-core ignores `voice`). See
`docs/content-packs.md`.

## Playback

- One shared `AudioContext` with sound effects (`ui/sfx.ts` is refactored to expose it), with
  separate gain nodes for effects and voices.
- Each speaking resident gets a `PannerNode` at their head position (`renderer.simHead`),
  updated about 10 times a second, so voices come from where the resident stands.
- The speech bubble appears straight away; the voice follows when its clip is ready.
- Talking animations already exist; lip sync from phoneme durations (which the engine knows) is a
  later improvement.

## Modules

Rust: `crates/voice` (engine, phonemizer, DSP) and `crates/voice-wasm` (the `wasm-bindgen`
wrapper), built by a `pnpm voice` script next to the existing `wasm` script.

Web code lives in `web/src/voice/`, behind one small interface used by the game session:

| File | Job |
|---|---|
| `voice/index.ts` | `VoiceDirector`: watches the frame state and UI state, applies the "who may speak" rules and guards, queues lines. The only thing `game/session.ts` talks to. |
| `voice/lines.ts` | Picks a line for an event from content (hash-based). |
| `voice/voices.ts` | Pitch and speed from resident id, gender, life stage and the voice chosen in the creator. |
| `voice/tts.ts` + `voice/tts.worker.ts` | Worker client and worker: load model, `speak(text, voice) → Float32Array` (transferred, 24 kHz), unload. |
| `voice/benchmark.ts` | The benchmark and the device choice. |
| `voice/player.ts` | Voice bus, panners, clip cache. |

## Phases

| Phase | Scope | Done when |
|---|---|---|
| 1. Baseline (2–3 days) | `crates/voice` with `tract` running Paradee plus the `pitch` graph edit, in a worker next to the running game; try `misaki-rs` without espeak on `wasm32`. | Paradee speaks hand-written phonemes in the browser; RTF and frame impact measured in Chrome, Firefox and Safari; `misaki-rs` or our own `g2p` chosen. |
| 2. Phonemizer (2–4 days) | `g2p` (or `misaki-rs` plus our fallback). | Every content line phonemizes from the dictionary; names get a plausible reading; no GPL code shipped. |
| 3. Rules | Settings tab, `VoiceDirector` with the "who may speak" rules and guards, lines content, voice bus with panning. (Babble, a made-up language, was part of this phase from 0.14 to 0.19; removed in 0.20.) | Selecting a resident or starting a conversation makes them speak; nobody else does; no frame cost. |
| 4. English | Download with progress, `VoiceSpec` (pitch, speed), clip cache, unloading, quiet while loading. | Selected residents speak English; residents sound different from each other. |
| 5. Own engine (1–2 weeks) | Hand-written inference, golden tests against `tract`, formant shift, seeded noise. | At least 8× real time in the browser on one thread; WASM under 1.5 MB; male voices that sound male (or decide to distil a male voice). |
| 6. Benchmark | "Test this computer", Auto mode, re-run on change, live watchdog, F3 line; Kokoro-82M as the optional model (CPU and GPU). | Auto picks the right mode without frame drops; a slow machine steps down with a clear message. |
| Later | Thoughts from the Planner (0.8) and from an in-browser language model; lip sync; persistent clip cache (IndexedDB, Opus via WebCodecs); a distilled male voice; more languages. | |

Every phase keeps `pnpm check` clean and the frame-time budget checked, with voices on and off.

## Research summary (2026-10-09)

| Option | Verdict |
|---|---|
| **Paradee-8M** | Chosen. Apache-2.0, 9 MB int8, 12–14× real time on one CPU thread (our native test), quality close to Kokoro. One voice; Misaki phonemes. |
| Kokoro-82M | Optional larger model. Apache-2.0; q8 92 MB, fp32 326 MB; about real time on CPU with 4 threads, about 10× on WebGPU (M1 Max). 28 English voices that can be blended. |
| Kokoro-7M-Distill | 30 MB, faster (35×) but lower quality (UTMOS 4.18) than Paradee (Paradee paper). |
| Piper / VITS | The multi-speaker English voice is trained on a dataset that forbids commercial use; lower quality. |
| Kitten TTS | 25–78 MB, only 8 voices; the maker calls the browser builds legacy. |
| Supertonic | Archived in September 2026; restrictive licence. |
| MMS-TTS | Non-commercial licence. |
| Chatterbox, OuteTTS, CSM, Dia, Orpheus | Too big or too slow next to a 3D game. |
| Browser `speechSynthesis` | Free, but voices differ per player, it can't be positioned in 3D and only one voice plays at a time. |

Sources: [Paradee-8M](https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0),
[Paradee code](https://github.com/sahilmahendrakar/paradee),
[Kokoro-82M ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX),
[Misaki](https://github.com/hexgrad/misaki),
[misaki-rs](https://github.com/MicheleYin/misaki-rs),
[tract](https://github.com/sonos/tract),
[browser TTS benchmarks](https://briantung.me/blog/tts-engines-in-the-browser/),
[lessac dataset licence](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html).
