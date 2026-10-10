//! Resident voices (see `docs/design/voices.md`).
//!
//! Text goes through [`G2p`] (English to Misaki phonemes, a port of the rules of Misaki, the
//! phonemizer Kokoro and Paradee were trained with, without espeak-ng) and then through
//! [`Tokenizer`] (phonemes to Paradee-8M's input ids). The model runs in the browser with ONNX
//! Runtime Web. Nothing here touches the simulation.

mod g2p;
mod lexicon;
mod numbers;
mod rules;
mod tokens;

pub use g2p::G2p;
pub use lexicon::Lexicon;
pub use tokens::{SAMPLE_RATE, Tokenizer};

/// How one resident sounds. Every field is a factor around 1.0 (the model's own voice).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoiceParams {
    /// Speaking rate (durations are divided by it).
    pub speed: f32,
    /// Multiplies the predicted pitch curve.
    pub pitch: f32,
}

impl Default for VoiceParams {
    fn default() -> Self {
        VoiceParams { speed: 1.0, pitch: 1.0 }
    }
}

impl VoiceParams {
    /// Within the range the model handles: speed 0.5–2, pitch 0.4–2.
    pub fn clamped(self) -> Self {
        VoiceParams { speed: self.speed.clamp(0.5, 2.0), pitch: self.pitch.clamp(0.4, 2.0) }
    }
}

/// What the model is run with for one line: `input_ids`, `speed` and `pitch`.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelInputs {
    /// Phoneme ids with a pad at each end; empty when there is nothing to say.
    pub ids: Vec<i64>,
    pub voice: VoiceParams,
}

/// Phonemizer and tokenizer together: `inputs` turns a line of English into the model's inputs.
pub struct Engine {
    g2p: G2p,
    tokenizer: Tokenizer,
}

impl Engine {
    pub fn new(g2p: G2p, tokenizer: Tokenizer) -> Self {
        Engine { g2p, tokenizer }
    }

    pub fn phonemize(&self, text: &str) -> String {
        self.g2p.phonemize(text)
    }

    pub fn inputs(&self, text: &str, voice: VoiceParams) -> ModelInputs {
        self.inputs_for_phonemes(&self.g2p.phonemize(text), voice)
    }

    pub fn inputs_for_phonemes(&self, phonemes: &str, voice: VoiceParams) -> ModelInputs {
        ModelInputs { ids: self.tokenizer.ids(phonemes), voice: voice.clamped() }
    }
}
