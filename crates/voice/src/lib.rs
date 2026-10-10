//! Resident voices (see `docs/design/voices.md`).
//!
//! Text goes through [`G2p`] (English to Misaki phonemes, a port of the rules of Misaki, the
//! phonemizer Kokoro and Paradee were trained with, without espeak-ng) and then through a
//! model's tokenizer: [`Tokenizer`] for Paradee-8M (Misaki phonemes as they are), or
//! [`KittenTokenizer`] for KittenTTS nano (the phonemes turned into espeak-style IPA by
//! [`misaki_to_espeak`]). The models run in the browser with ONNX Runtime Web; their output is
//! trimmed (KittenTTS) and resampled for the voice's size ([`resample`]). Nothing here touches
//! the simulation.

mod g2p;
mod kitten;
mod lexicon;
mod numbers;
mod resample;
mod rules;
mod tokens;

pub use g2p::G2p;
pub use kitten::{KittenTokenizer, STYLE_ROWS, misaki_to_espeak, style_row};
pub use lexicon::Lexicon;
pub use resample::resample;
pub use tokens::{SAMPLE_RATE, Tokenizer};

/// How one resident sounds. Every field is a factor around 1.0 (the model's own voice).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoiceParams {
    /// Speaking rate (durations are divided by it).
    pub speed: f32,
    /// Multiplies the pitch curve.
    pub pitch: f32,
    /// Size of the voice: scales the formants. Below 1 a larger voice (men), above 1 a smaller
    /// one (children). Made by resampling, keeping pitch and speed.
    pub depth: f32,
}

impl Default for VoiceParams {
    fn default() -> Self {
        VoiceParams { speed: 1.0, pitch: 1.0, depth: 1.0 }
    }
}

impl VoiceParams {
    /// Within what sounds right: speed 0.5–2, pitch 0.4–2, depth 0.75–1.3.
    pub fn clamped(self) -> Self {
        VoiceParams { speed: self.speed.clamp(0.5, 2.0), pitch: self.pitch.clamp(0.4, 2.0), depth: self.depth.clamp(0.75, 1.3) }
    }
}

/// What the model is run with for one line: `input_ids`, `speed` and `pitch` (already divided by
/// the depth, see [`resample`]), the style row (KittenTTS), and what to do with its output.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelInputs {
    /// Phoneme ids with the model's ends; empty when there is nothing to say.
    pub ids: Vec<i64>,
    /// The model's `speed` and `pitch` inputs.
    pub speed: f32,
    pub pitch: f32,
    /// Resample the model's output with this (1: leave it as it is).
    pub depth: f32,
    /// KittenTTS: which row of a voice's style table to use (0 for Paradee).
    pub row: usize,
    /// KittenTTS: drop the output's noisy tail and the silence around the speech.
    pub trim: bool,
}

impl ModelInputs {
    fn new(ids: Vec<i64>, voice: VoiceParams) -> Self {
        let v = voice.clamped();
        ModelInputs {
            ids,
            speed: (v.speed / v.depth).clamp(0.5, 2.0),
            pitch: (v.pitch / v.depth).clamp(0.4, 2.0),
            depth: v.depth,
            row: 0,
            trim: false,
        }
    }

    /// The model's output, trimmed if asked, turned into the voice's size.
    pub fn finish(&self, samples: &[f32]) -> Vec<f32> {
        resample(if self.trim { kitten::trim(samples) } else { samples }, self.depth)
    }
}

/// Phonemizer and tokenizers together: `inputs` turns a line of English into Paradee's inputs,
/// `kitten_inputs` into KittenTTS's.
pub struct Engine {
    g2p: G2p,
    tokenizer: Tokenizer,
    kitten: KittenTokenizer,
}

impl Engine {
    pub fn new(g2p: G2p, tokenizer: Tokenizer) -> Self {
        Engine { g2p, tokenizer, kitten: KittenTokenizer::new() }
    }

    /// KittenTTS's inputs for a line: ids from the phonemes as espeak-style IPA, the style row
    /// from the text's length, and its output trimmed.
    pub fn kitten_inputs(&self, text: &str, voice: VoiceParams) -> ModelInputs {
        let ipa = misaki_to_espeak(&self.g2p.phonemize(text));
        ModelInputs { row: style_row(text), trim: true, ..ModelInputs::new(self.kitten.ids(&ipa), voice) }
    }

    pub fn phonemize(&self, text: &str) -> String {
        self.g2p.phonemize(text)
    }

    pub fn inputs(&self, text: &str, voice: VoiceParams) -> ModelInputs {
        self.inputs_for_phonemes(&self.g2p.phonemize(text), voice)
    }

    pub fn inputs_for_phonemes(&self, phonemes: &str, voice: VoiceParams) -> ModelInputs {
        ModelInputs::new(self.tokenizer.ids(phonemes), voice)
    }
}
