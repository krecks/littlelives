//! Browser bindings for `voice`, used by `web/src/voice/tts.worker.ts`: text to the inputs of
//! KittenTTS nano, and the model's output to the voice's size (the worker runs the model with
//! ONNX Runtime Web in between). Keep this layer thin.

use voice::{Engine, G2p, Lexicon, ModelInputs, VoiceParams};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Voice {
    engine: Engine,
}

/// The model's inputs for one line, and what to do with its output.
#[wasm_bindgen]
pub struct Inputs {
    inner: ModelInputs,
    visemes: Vec<f32>,
}

#[wasm_bindgen]
impl Inputs {
    /// `input_ids` (pads included); empty when there is nothing to say.
    #[wasm_bindgen(getter)]
    pub fn ids(&self) -> Vec<i64> {
        self.inner.ids.clone()
    }

    /// The model's `speed` input (the voice's speed divided by its depth).
    #[wasm_bindgen(getter)]
    pub fn speed(&self) -> f32 {
        self.inner.speed
    }

    /// The model's `pitch` input (the voice's pitch divided by its depth).
    #[wasm_bindgen(getter)]
    pub fn pitch(&self) -> f32 {
        self.inner.pitch
    }

    /// The row of each voice's style table to use.
    #[wasm_bindgen(getter)]
    pub fn row(&self) -> u32 {
        self.inner.row as u32
    }

    /// The voice's depth (1: the model's output is used as it is).
    #[wasm_bindgen(getter)]
    pub fn depth(&self) -> f32 {
        self.inner.depth
    }

    /// The model's output (24 kHz) trimmed and resampled to the voice's size; its mouth shapes
    /// are then in `visemes`.
    pub fn finish(&mut self, samples: &[f32]) -> Vec<f32> {
        let (samples, visemes) = self.inner.finish(samples);
        self.visemes = visemes;
        samples
    }

    /// The finished clip's mouth shapes, flat: `[segments, energy frames, times…, visemes…,
    /// energy…]` (see `voice::VisemeTrack::flat`); empty before `finish`.
    #[wasm_bindgen(getter)]
    pub fn visemes(&self) -> Vec<f32> {
        self.visemes.clone()
    }
}

#[wasm_bindgen]
impl Voice {
    /// `lexicon`: `en-us.lex` (decompressed).
    #[wasm_bindgen(constructor)]
    pub fn new(lexicon: &str) -> Voice {
        Voice { engine: Engine::new(G2p::new(Lexicon::parse(lexicon))) }
    }

    pub fn phonemize(&self, text: &str) -> String {
        self.engine.phonemize(text)
    }

    /// KittenTTS's inputs for a line in a voice (speed, pitch and depth clamped to what sounds
    /// right); `row` says which style vectors to mix.
    pub fn inputs(&self, text: &str, speed: f32, pitch: f32, depth: f32) -> Inputs {
        Inputs { inner: self.engine.inputs(text, VoiceParams { speed, pitch, depth }), visemes: Vec::new() }
    }
}
