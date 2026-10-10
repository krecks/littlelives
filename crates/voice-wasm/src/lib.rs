//! Browser bindings for `voice`, used by `web/src/voice/tts.worker.ts`: text to the inputs of
//! Paradee-8M or KittenTTS nano, and the model's output to the voice's size (the worker runs the
//! model with ONNX Runtime Web in between). Keep this layer thin.

use voice::{Engine, G2p, Lexicon, ModelInputs, Tokenizer, VoiceParams};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Voice {
    engine: Engine,
}

/// The model's inputs for one line, and what to do with its output.
#[wasm_bindgen]
pub struct Inputs {
    inner: ModelInputs,
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

    /// KittenTTS: the row of each voice's style table to use (0 for Paradee).
    #[wasm_bindgen(getter)]
    pub fn row(&self) -> u32 {
        self.inner.row as u32
    }

    /// The voice's depth (1: the model's output is used as it is).
    #[wasm_bindgen(getter)]
    pub fn depth(&self) -> f32 {
        self.inner.depth
    }

    /// The model's output (24 kHz) trimmed (KittenTTS) and resampled to the voice's size.
    pub fn finish(&self, samples: &[f32]) -> Vec<f32> {
        self.inner.finish(samples)
    }
}

#[wasm_bindgen]
impl Voice {
    /// `lexicon`: `en-us.lex` (decompressed); `config`: the model's config.json.
    #[wasm_bindgen(constructor)]
    pub fn new(lexicon: &str, config: &str) -> Result<Voice, JsError> {
        let tokenizer = Tokenizer::from_config(config).map_err(|e| JsError::new(&e))?;
        Ok(Voice { engine: Engine::new(G2p::new(Lexicon::parse(lexicon)), tokenizer) })
    }

    pub fn phonemize(&self, text: &str) -> String {
        self.engine.phonemize(text)
    }

    /// Paradee's inputs for a line in a voice (speed, pitch and depth clamped to what sounds right).
    pub fn inputs(&self, text: &str, speed: f32, pitch: f32, depth: f32) -> Inputs {
        Inputs { inner: self.engine.inputs(text, VoiceParams { speed, pitch, depth }) }
    }

    /// KittenTTS's inputs for a line in a voice; `row` says which style vectors to mix.
    pub fn kitten_inputs(&self, text: &str, speed: f32, pitch: f32, depth: f32) -> Inputs {
        Inputs { inner: self.engine.kitten_inputs(text, VoiceParams { speed, pitch, depth }) }
    }
}
