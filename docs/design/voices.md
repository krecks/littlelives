# Resident voices

*Plan for residents speaking their thoughts and conversations out loud. Status: planned, not
started (2026-10-09). Research behind the choices is summarised at the end.*

Residents speak with a text-to-speech model that runs **entirely in the browser**: no server, no
API key, nothing leaves the player's computer. English uses **Kokoro-82M**; a made-up language,
**Babble**, needs no download and works on every machine.

> **Naming:** "Simlish" is Electronic Arts' word. Following the naming rules in `PLAN.md`, the
> made-up language is called **Babble** everywhere a player or pack author reads it.

## Goals and rules

- **Performance first.** Speech must never cost frames. It runs in its own worker, on the CPU or
  the GPU depending on what this computer handles better, and a benchmark in Settings decides.
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
- **Download on request.** The model (about 92 MB) is only fetched when the player turns English
  voices on.

## Settings

A new **Audio** tab in Settings (`ui/screens/SettingsPanel.svelte`). "Sound effects" moves there
from Interface. Everything applies live, so nothing is added to `RESTART_KEYS`.

| Row | Control | Notes |
|---|---|---|
| Resident voices | Toggle | Default off. |
| Language | English · Babble | English needs the voice model; Babble needs nothing. |
| Voice model | Kokoro-82M | One entry for now (others can be added later). Shows its state: "Not downloaded · 92 MB", "Downloading 45 %", "Ready". Disabled for Babble. A **Delete download** button frees the space. |
| Runs on | Auto · CPU · GPU | Auto uses the benchmark's choice. GPU is disabled when WebGPU is unavailable. |
| Benchmark | **Test this computer** button | Shows the last result, e.g. "CPU: 1.1 s per line · GPU: 0.2 s per line, smooth · Auto chose GPU". |
| Voice volume | Slider | Separate from sound effects. |

New keys in `settings.svelte.ts`:

```ts
voices: boolean;                       // false
voiceLanguage: 'en' | 'babble';        // 'en'
voiceModel: 'kokoro-82m';              // 'kokoro-82m'
voiceDevice: 'auto' | 'cpu' | 'gpu';   // 'auto'
voiceVolume: number;                   // 0.8
```

The benchmark result is stored under its own localStorage key (`littlelives.voiceBench`), not in
`Settings`, so "Reset to defaults" does not throw away a measurement.

Turning voices on with English the first time: download the model (progress in the row), then run
the benchmark automatically, then speak. Until the model is ready, residents speak Babble.

## Performance

### Where the work runs

| Work | Thread | Cost |
|---|---|---|
| Deciding who speaks, picking lines, playback | Main thread | Microseconds, event-driven (no per-frame work) |
| Kokoro inference | **Own module worker** (`voice/tts.worker.ts`), separate from the sim worker | 0.1–2 s per line, never blocks a frame |
| Babble synthesis | Web Audio on the audio thread | Negligible |

- **CPU mode:** ONNX Runtime WASM with the **q8** model (92 MB), multithreaded. Threads =
  `clamp(navigator.hardwareConcurrency - 3, 1, 4)`, leaving cores for the main thread, the sim
  worker and the browser. Threads work because the app is already cross-origin isolated
  (`web/vite.config.ts`). Keeps speech completely off the GPU that Babylon draws with.
- **GPU mode:** ONNX Runtime WebGPU with the **fp32** model (326 MB; quantized models are not
  supported on WebGPU). About ten times faster, but it shares the GPU with rendering, so it is
  only chosen when the benchmark shows frames stay smooth.
- The ONNX Runtime `.wasm` files are **self-hosted** (bundled by Vite), not fetched from a CDN,
  following the "self-host all assets" rule. Model weights load from Hugging Face by default (its
  CORS headers satisfy our COEP header) and can be pointed at a self-hosted copy through the
  asset manifest. The browser cache keeps them after the first download.

### Benchmark ("Test this computer")

Runs from Settings, in the main menu (the live 3D town is drawing behind it, so GPU contention is
realistic) or in a game (speech is paused while it runs). About 15–30 s after the download.

1. Download the model files for each mode being tested, if missing (progress shown).
2. For each available mode (CPU always; GPU if `navigator.gpu` gives an adapter):
   1. Load the model and say one warm-up line (measures cold start).
   2. Say five fixed test lines of typical lengths (3, 8, 12, 20 and 30 words).
   3. Record per line: time to finished clip and **real-time factor** (RTF = generation time ÷
      audio length).
   4. Meanwhile measure frame times with `requestAnimationFrame`: 2 s before as a baseline,
      then during inference. Record the rise in 95th-percentile frame time and frames over 50 ms.
3. Choose:
   - **GPU** if its median RTF ≤ 0.33 (a 3-second line is ready within 1 s) **and** frame time
     p95 rises ≤ 2 ms with no frames over 50 ms;
   - otherwise **CPU** if its median RTF ≤ 0.5;
   - otherwise English is **too slow on this computer**: Auto falls back to Babble and the row
     says so. The player can still force CPU or GPU.
4. Store `{ model, modelVersion, device, rtf, firstLineMs, frameP95RiseMs, cores, gpuAdapter, date }`.
   The benchmark re-runs automatically when the model version, core count or GPU adapter changes.

### Guards while playing

- At most **two voices at once**, and at most one line per resident every ~8 s.
- A line that is not ready within **2 s** is dropped (the moment has passed).
- No generation while in Build or Buy mode, while the tab is hidden, or at speed 3× and above
  (except the conversation the player started).
- **Live watchdog:** the speech scheduler tracks each line's RTF and the renderer's frame times
  (`game.stats`). If three lines in a row are late, or frame time rises past the budget while
  inference runs, voices switch to Babble for the session and a toast says why once.
- **Memory:** the worker and model are unloaded after 5 minutes without speech, and when voices
  are turned off. Finished clips are kept in an in-memory LRU cache as 16-bit audio, capped at
  about 8 MB (a few hundred lines), keyed by `hash(modelVersion, voice, text)`.
- The performance overlay (F3) shows a voice line: mode, last RTF, queue length, cache hits.

## What residents say

Today's bubbles are icons only (`game/bubbles.ts`), so speech needs text. First version:
**hand-written lines as content data**, so content packs can add and translate them.

- **Conversations:** for each social interaction (`base.json` `social` entries), lines for the
  one who starts it and reaction lines by outcome (good, bad, angry, love). Read from the
  snapshot fields `social`, `role`, `outcome` and `partner` that the bubbles already use.
- **Thoughts of the selected resident:** a line when they start an action (`action`), when their
  emotion changes (`emotion`), and when a need becomes urgent.
- **Later sources plug into the same pipeline:** the thoughts and wishes of release 0.8 (Planner),
  and the optional in-browser language model for thoughts (see "Later").

Each line has an optional tone (`happy`, `sad`, `angry`, `flirty`, `question`) that Babble uses for
intonation and Kokoro uses for speed.

## Voices

Each resident gets a voice derived from their **stable resident id** (release 0.7) and gender,
computed on the main thread and never saved:

```ts
interface VoiceSpec { a: string; b: string; mix: number; speed: number; pitch: number }
```

- **Kokoro:** two base voices from a gendered pool of the model's best-rated English voices
  (`af_heart`, `af_bella`, `af_nicole`, `bf_emma`; `am_fenrir`, `am_michael`, `am_puck`,
  `bm_george`; both pools for other genders), blended by `mix` (a Kokoro voice is a style vector,
  so blending is a linear mix), and `speed` 0.9–1.1. Kokoro has no pitch control.
- **Babble:** base pitch, formant shift and speaking rate from the same hash, so a resident's
  Babble voice matches the character of their English one.
- Children and elders (life cycle releases): Babble with higher or slower voices; Kokoro has no
  child voices.

## Babble

A small Web Audio synthesiser (`voice/babble.ts`), no samples and no model:

- The line's length decides how many syllables are said, so Babble "says" the same line.
- Syllables come from a fixed consonant/vowel set chosen by a hash of the word, so the same word
  always sounds the same.
- Vowels are a buzzy source through two or three band-pass formant filters; consonants are short
  noise bursts. A pitch contour per line follows the tone (questions rise, angry is louder and
  faster, sad is lower and slower).
- Plays through the same voice bus as English, so volume, two-voice limit and positioning apply.

## Playback

- One shared `AudioContext` with sound effects (`ui/sfx.ts` is refactored to expose it), with
  separate gain nodes for effects and voices.
- Each speaking resident gets a `PannerNode` at their head position (`renderer.simHead`),
  updated about 10 times a second, so voices come from where the resident stands.
- The speech bubble appears straight away; the voice follows when its clip is ready.
- Talking animations already exist; lip sync is a later improvement.

## Modules

All new code lives in `web/src/voice/`, behind one small interface used by the game session:

| File | Job |
|---|---|
| `voice/index.ts` | `VoiceDirector`: watches the frame state and UI state, applies the "who may speak" rules and guards, queues lines. The only thing `game/session.ts` talks to. |
| `voice/lines.ts` | Picks a line for an event from content (hash-based). |
| `voice/voices.ts` | `VoiceSpec` from resident id and gender. |
| `voice/tts.ts` + `voice/tts.worker.ts` | Worker client and worker: load model (mode, dtype, threads), `speak(text, voice) → Float32Array` (transferred, 24 kHz), unload. |
| `voice/benchmark.ts` | The benchmark and the device choice. |
| `voice/babble.ts` | Babble synthesiser. |
| `voice/player.ts` | Voice bus, panners, clip cache. |

New dependency: `kokoro-js` (Apache-2.0), pinned, or Transformers.js v4 directly. The spike picks
one: `kokoro-js` is simplest but has had no release since May 2025, and voice blending may need a
small patch either way.

## Open question: phonemizer licence

Kokoro needs text turned into phonemes first. `kokoro-js` does this with **espeak-ng compiled to
WASM, which is GPL-3**; Littlelives is MIT. Options, to be decided in the spike:

1. A permissively licensed English phonemizer (a pronunciation dictionary such as CMUdict, which
   is BSD-licensed, plus a fallback for unknown words), mapped to Kokoro's phoneme set. English
   only, which is all we need.
2. Keep espeak-ng, but as a separately downloaded optional module, after checking with the
   project owner that this is acceptable.

Option 1 is preferred.

## Phases

| Phase | Scope | Done when |
|---|---|---|
| 1. Spike (1–2 days) | Kokoro in a worker next to the running game: q8 on CPU and fp32 on WebGPU; voice blending; phonemizer decision. | Measured RTF and frame-time impact on our machines; kokoro-js vs Transformers.js and the phonemizer chosen. |
| 2. Babble and rules | Settings tab, `VoiceDirector` with the "who may speak" rules and guards, lines content, Babble, voice bus with panning. | Selecting a resident or starting a conversation makes them babble; nobody else does; no frame cost. |
| 3. English | TTS worker, download with progress, voice blending, clip cache, model unloading, fall back to Babble while loading. | Selected residents speak English in their own voice; every resident sounds different. |
| 4. Benchmark | "Test this computer", Auto mode, re-run on hardware change, live watchdog, F3 line. | Auto picks the faster mode without frame drops; a slow machine falls back to Babble with a clear message. |
| Later | Thoughts from the Planner (0.8) and from an in-browser language model; lip sync from phoneme timings; persistent clip cache (IndexedDB, Opus via WebCodecs); more languages and voice models. | |

Every phase keeps `pnpm check` clean and the frame-time budget checked, with voices on and off.

## Research summary (2026-10-09)

| Option | Verdict |
|---|---|
| **Kokoro-82M** | Chosen. Apache-2.0; q8 92 MB, fp32 326 MB; about real time on CPU with 4 threads, about 10× faster than real time on WebGPU (M1 Max). 28 English voices that can be blended. |
| Piper / VITS | Big multi-speaker model, but that voice is trained on a dataset that forbids commercial use; lower quality. |
| Kitten TTS | Small (25–78 MB) but only 8 voices, and the maker calls the browser builds legacy. |
| Supertonic | Archived in September 2026; restrictive licence. |
| MMS-TTS | Non-commercial licence. |
| Chatterbox, OuteTTS, CSM, Dia, Orpheus | Too big or too slow next to a 3D game. |
| Browser `speechSynthesis` | Free, but voices differ per player, it can't be positioned in 3D and only one voice plays at a time. |

Sources: [Kokoro-82M ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX),
[kokoro-js](https://www.npmjs.com/package/kokoro-js),
[browser TTS benchmarks](https://briantung.me/blog/tts-engines-in-the-browser/),
[Kokoro for game characters in three.js](https://discourse.threejs.org/t/local-browser-tts-with-kokoro-for-npc-dialogue-and-narration/91424),
[Transformers.js](https://github.com/huggingface/transformers.js),
[lessac dataset licence](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html).
