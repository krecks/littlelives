//! Browser bindings for `voice`, used by `web/src/voice/tts.worker.ts`: text to the inputs of
//! Paradee-8M (the worker runs the model with ONNX Runtime Web). Keep this layer thin.

use voice::{Engine, G2p, Lexicon, Tokenizer, VoiceParams};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Voice {
    engine: Engine,
}

/// The model's inputs for one line.
#[wasm_bindgen]
pub struct Inputs {
    ids: Vec<i64>,
    pub speed: f32,
    pub pitch: f32,
}

#[wasm_bindgen]
impl Inputs {
    /// `input_ids` (pads included); empty when there is nothing to say.
    #[wasm_bindgen(getter)]
    pub fn ids(&self) -> Vec<i64> {
        self.ids.clone()
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

    /// Phoneme ids for the line, and speed and pitch clamped to what the model handles.
    pub fn inputs(&self, text: &str, speed: f32, pitch: f32) -> Inputs {
        let m = self.engine.inputs(text, VoiceParams { speed, pitch });
        Inputs { ids: m.ids, speed: m.voice.speed, pitch: m.voice.pitch }
    }
}
