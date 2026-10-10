//! Paradee-8M as the browser gets it: the copy edited by `tools/voice/model.mjs` (a `pitch` input
//! and deterministic noise), fed with this crate's phoneme ids. The browser runs it with ONNX
//! Runtime Web (checked by `tools/voice/check.mjs`); here a second runtime, `tract` (a dev
//! dependency only), checks the edit is a valid graph that keeps the voice controls and gives
//! the same samples every time. Needs `node tools/voice/fetch.mjs` first; slow in debug builds,
//! so run with `cargo test -p voice --release`.

use std::io::Read;
use std::path::PathBuf;
use std::time::Instant;

use tract_onnx::prelude::*;
use voice::{Engine, G2p, Lexicon, ModelInputs, SAMPLE_RATE, Tokenizer, VoiceParams};

const MODEL: &str = "paradee-8m-edit1.onnx";

struct Fixture {
    engine: Engine,
    model: InferenceModel,
}

fn fixture() -> Option<Fixture> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/public/voice");
    let (Ok(onnx), Ok(config), Ok(lex)) = (
        std::fs::read(dir.join(MODEL)),
        std::fs::read_to_string(dir.join("paradee-8m.json")),
        std::fs::File::open(dir.join("en-us.lexz")),
    ) else {
        eprintln!("skipped: voice files missing (run `node tools/voice/fetch.mjs`)");
        return None;
    };
    let mut tsv = String::new();
    flate2::read::GzDecoder::new(lex).read_to_string(&mut tsv).unwrap();
    let engine = Engine::new(G2p::new(Lexicon::parse(&tsv)), Tokenizer::from_config(&config).unwrap());
    let model = tract_onnx::onnx()
        .model_for_read(&mut &onnx[..])
        .unwrap()
        .with_input_fact(1, f32::fact([1]).into())
        .unwrap()
        .with_input_fact(2, f32::fact([1]).into())
        .unwrap();
    Some(Fixture { engine, model })
}

fn run(model: &InferenceModel, inputs: &ModelInputs) -> Vec<f32> {
    let n = inputs.ids.len();
    let plan = model.clone().with_input_fact(0, i64::fact([1, n]).into()).unwrap().into_runnable().unwrap();
    let ids = tract_ndarray::Array2::from_shape_vec((1, n), inputs.ids.clone()).unwrap().into_tensor();
    let out = plan
        .run(tvec!(ids.into(), tensor1(&[inputs.voice.speed]).into(), tensor1(&[inputs.voice.pitch]).into()))
        .unwrap();
    out[0].to_plain_array_view::<f32>().unwrap().iter().copied().collect()
}

#[test]
fn edited_model_speaks_deterministically_with_pitch() {
    let Some(f) = fixture() else { return };
    let line = "Hello! I'm hungry, I should cook something.";
    let inputs = f.engine.inputs(line, VoiceParams::default());
    let t = Instant::now();
    let a = run(&f.model, &inputs);
    let took = t.elapsed().as_secs_f64();
    let secs = a.len() as f64 / SAMPLE_RATE as f64;
    eprintln!("tract: {secs:.2} s of audio in {took:.2} s");
    assert!((2.0..4.5).contains(&secs), "unexpected length {secs}");
    let rms = (a.iter().map(|s| s * s).sum::<f32>() / a.len() as f32).sqrt();
    assert!(rms > 0.01, "silent output");

    assert_eq!(a, run(&f.model, &inputs), "same line, same audio");

    let low = run(&f.model, &f.engine.inputs(line, VoiceParams { speed: 1.0, pitch: 0.7 }));
    assert_eq!(low.len(), a.len(), "pitch keeps the timing");
    assert_ne!(low, a);

    let fast = run(&f.model, &f.engine.inputs(line, VoiceParams { speed: 1.25, pitch: 1.0 }));
    assert!(fast.len() < a.len());
}

#[test]
fn inputs_are_padded_ids_and_clamped_voices() {
    let Some(f) = fixture() else { return };
    let m = f.engine.inputs("Hello there!", VoiceParams { speed: 9.0, pitch: 0.1 });
    assert_eq!((m.ids.first(), m.ids.last()), (Some(&0), Some(&0)));
    assert!(m.ids.len() > 5 && m.ids[1..m.ids.len() - 1].iter().all(|&id| id > 0));
    assert_eq!(m.voice, VoiceParams { speed: 2.0, pitch: 0.4 });
    assert!(f.engine.inputs("", VoiceParams::default()).ids.is_empty());
    let long = "la ".repeat(400);
    assert_eq!(f.engine.inputs_for_phonemes(&long, VoiceParams::default()).ids.len(), 512);
}
