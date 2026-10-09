//! Resident voices (see `docs/design/voices.md`).
//!
//! Text goes through [`G2p`] (English to Misaki phonemes, a port of the rules of Misaki, the
//! phonemizer Kokoro and Paradee were trained with, without espeak-ng) and then through
//! [`Model`] (Paradee-8M, run with `tract`). Nothing here touches the simulation.

mod g2p;
mod lexicon;
mod model;
mod numbers;
mod rules;

pub use g2p::G2p;
pub use lexicon::Lexicon;
pub use model::{Model, SAMPLE_RATE};

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

/// Phonemizer and model together: `speak` turns a line of English into 24 kHz audio.
pub struct Engine {
    g2p: G2p,
    model: Model,
}

impl Engine {
    pub fn new(g2p: G2p, model: Model) -> Self {
        Engine { g2p, model }
    }

    pub fn phonemize(&self, text: &str) -> String {
        self.g2p.phonemize(text)
    }

    pub fn speak(&self, text: &str, voice: VoiceParams) -> Result<Vec<f32>, String> {
        self.model.speak(&self.g2p.phonemize(text), voice)
    }

    pub fn speak_phonemes(&self, phonemes: &str, voice: VoiceParams) -> Result<Vec<f32>, String> {
        self.model.speak(phonemes, voice)
    }
}
