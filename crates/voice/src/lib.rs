//! Resident voices (see `docs/design/voices.md`).
//!
//! Text goes through [`G2p`] (English to Misaki phonemes, a port of the rules of Misaki, the
//! phonemizer Kokoro was trained with, without espeak-ng) and then through KittenTTS nano's
//! tokenizer, [`KittenTokenizer`] (the phonemes turned into espeak-style IPA by
//! [`misaki_to_espeak`]). The model runs in the browser with ONNX Runtime Web; its output is
//! trimmed and resampled for the voice's size ([`resample`]). Nothing here touches the
//! simulation.

mod g2p;
mod kitten;
mod lexicon;
mod numbers;
mod resample;
mod rules;

pub use g2p::G2p;
pub use kitten::{KittenTokenizer, STYLE_ROWS, misaki_to_espeak, style_row};
pub use lexicon::Lexicon;
pub use resample::resample;

/// The model's output rate (Hz).
pub const SAMPLE_RATE: u32 = 24_000;

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
/// the depth, see [`resample`]), the style row, and what to do with its output.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelInputs {
    /// Phoneme ids with the model's ends; empty when there is nothing to say.
    pub ids: Vec<i64>,
    /// The model's `speed` and `pitch` inputs.
    pub speed: f32,
    pub pitch: f32,
    /// Resample the model's output with this (1: leave it as it is).
    pub depth: f32,
    /// Which row of a voice's style table to use.
    pub row: usize,
}

impl ModelInputs {
    /// The model's output with its noisy tail and the silence around the speech dropped, turned
    /// into the voice's size.
    pub fn finish(&self, samples: &[f32]) -> Vec<f32> {
        resample(kitten::trim(samples), self.depth)
    }
}

/// Phonemizer and tokenizer together: `inputs` turns a line of English into KittenTTS's inputs.
pub struct Engine {
    g2p: G2p,
    kitten: KittenTokenizer,
}

impl Engine {
    pub fn new(g2p: G2p) -> Self {
        Engine { g2p, kitten: KittenTokenizer::new() }
    }

    /// KittenTTS's inputs for a line: ids from the phonemes as espeak-style IPA, the style row
    /// from the text's length, and the voice (speed, pitch and depth clamped to what sounds right).
    pub fn inputs(&self, text: &str, voice: VoiceParams) -> ModelInputs {
        let ipa = misaki_to_espeak(&self.g2p.phonemize(text));
        let v = voice.clamped();
        ModelInputs {
            ids: self.kitten.ids(&ipa),
            speed: (v.speed / v.depth).clamp(0.5, 2.0),
            pitch: (v.pitch / v.depth).clamp(0.4, 2.0),
            depth: v.depth,
            row: style_row(text),
        }
    }

    pub fn phonemize(&self, text: &str) -> String {
        self.g2p.phonemize(text)
    }
}
