//! Size probe: the phonemizer of `crates/voice` (unchanged sources) and kernel code, no tract.

#[path = "../../../../crates/voice/src/g2p.rs"]
#[allow(dead_code)]
mod g2p;
#[path = "../../../../crates/voice/src/lexicon.rs"]
#[allow(dead_code)]
mod lexicon;
#[path = "../../../../crates/voice/src/numbers.rs"]
#[allow(dead_code)]
mod numbers;
#[path = "../../../../crates/voice/src/rules.rs"]
#[allow(dead_code)]
mod rules;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Probe {
    g2p: g2p::G2p,
    vocab: std::collections::HashMap<char, i64>,
}

#[wasm_bindgen]
impl Probe {
    #[wasm_bindgen(constructor)]
    pub fn new(lexicon: &str, config: &str) -> Result<Probe, JsError> {
        let config: serde_json::Value = serde_json::from_str(config).map_err(|e| JsError::new(&e.to_string()))?;
        let vocab = config["vocab"]
            .as_object()
            .ok_or_else(|| JsError::new("no vocab"))?
            .iter()
            .filter_map(|(k, v)| Some((k.chars().next()?, v.as_i64()?)))
            .collect();
        Ok(Probe { g2p: g2p::G2p::new(lexicon::Lexicon::parse(lexicon)), vocab })
    }

    pub fn phonemize(&self, text: &str) -> String {
        self.g2p.phonemize(text)
    }

    /// Stand-in for the network: runs every conv kernel variant so they are all linked in.
    pub fn speak(&self, text: &str) -> Vec<f32> {
        let ids: Vec<i64> = self.g2p.phonemize(text).chars().filter_map(|c| self.vocab.get(&c).copied()).collect();
        let mut out = Vec::new();
        for (i, c) in voice_kernels::CASES.iter().enumerate() {
            let mut bf = voice_kernels::make(c);
            let wp = voice_kernels::packs(c, &bf);
            voice_kernels::run(c, &mut bf, &wp, 10 + (i as u32 + ids.len() as u32) % 7);
            out.push(bf.y[0]);
        }
        out
    }
}
