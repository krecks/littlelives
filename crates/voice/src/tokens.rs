//! Paradee-8M's input (Kokoro-82M distilled to 8M parameters, Apache-2.0,
//! <https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0>): phoneme ids from the model's
//! `config.json`, with the pad id 0 at both ends. The model itself runs in the browser with ONNX
//! Runtime Web (`web/src/voice/tts.worker.ts`), on a copy edited by `tools/voice/model.mjs`.

use std::collections::HashMap;

pub const SAMPLE_RATE: u32 = 24_000;
/// The model takes at most this many phoneme ids, plus a pad at each end.
const MAX_PHONEMES: usize = 510;

pub struct Tokenizer {
    vocab: HashMap<char, i64>,
}

impl Tokenizer {
    /// `config_json`: the model's `config.json` (its phoneme ids).
    pub fn from_config(config_json: &str) -> Result<Tokenizer, String> {
        let config: serde_json::Value = serde_json::from_str(config_json).map_err(|e| format!("config: {e}"))?;
        let vocab = config["vocab"]
            .as_object()
            .ok_or("config: no vocab")?
            .iter()
            .filter_map(|(k, v)| Some((k.chars().next()?, v.as_i64()?)))
            .collect();
        Ok(Tokenizer { vocab })
    }

    /// Ids for a Misaki phoneme string, padded. Characters the model doesn't know are skipped;
    /// long input is cut at 510 phonemes. Empty when there is nothing to say.
    pub fn ids(&self, phonemes: &str) -> Vec<i64> {
        let mut ids: Vec<i64> = Vec::with_capacity(phonemes.len() + 2);
        ids.push(0);
        ids.extend(phonemes.chars().filter_map(|c| self.vocab.get(&c).copied()).take(MAX_PHONEMES));
        if ids.len() == 1 {
            return Vec::new();
        }
        ids.push(0);
        ids
    }
}
