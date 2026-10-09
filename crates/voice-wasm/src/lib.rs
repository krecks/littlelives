//! Browser bindings for `voice`, used by `web/src/voice/tts.worker.ts`. Keep this layer thin.

use voice::{Engine, G2p, Lexicon, Model, VoiceParams};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Voice {
    engine: Engine,
}

#[wasm_bindgen]
impl Voice {
    /// `lexicon`: `en-us.lex` (decompressed); `model`: the ONNX bytes; `config`: its config.json.
    #[wasm_bindgen(constructor)]
    pub fn new(lexicon: &str, model: &[u8], config: &str) -> Result<Voice, JsError> {
        let model = Model::load(model, config).map_err(|e| JsError::new(&e))?;
        Ok(Voice { engine: Engine::new(G2p::new(Lexicon::parse(lexicon)), model) })
    }

    pub fn phonemize(&self, text: &str) -> String {
        self.engine.phonemize(text)
    }

    /// 24 kHz mono samples.
    pub fn speak(&self, text: &str, speed: f32, pitch: f32) -> Result<Vec<f32>, JsError> {
        self.engine.speak(text, VoiceParams { speed, pitch }).map_err(|e| JsError::new(&e))
    }
}
