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
        .run(tvec!(ids.into(), tensor1(&[inputs.speed]).into(), tensor1(&[inputs.pitch]).into()))
        .unwrap();
    let raw: Vec<f32> = out[0].to_plain_array_view::<f32>().unwrap().iter().copied().collect();
    inputs.finish(&raw)
}

/// Mean spectral centroid (Hz) of the loud 512-sample frames.
fn centroid(x: &[f32]) -> f64 {
    let n = 512;
    let (mut sum, mut count) = (0.0, 0);
    for frame in x.chunks_exact(n).step_by(2) {
        let rms = (frame.iter().map(|v| v * v).sum::<f32>() / n as f32).sqrt();
        if rms < 0.02 {
            continue;
        }
        let (mut num, mut den) = (0.0, 0.0);
        for k in 1..n / 2 {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, &v) in frame.iter().enumerate() {
                let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos();
                let p = 2.0 * std::f64::consts::PI * (k * i) as f64 / n as f64;
                re += w * v as f64 * p.cos();
                im += w * v as f64 * p.sin();
            }
            let mag = (re * re + im * im).sqrt();
            num += mag * k as f64 * SAMPLE_RATE as f64 / n as f64;
            den += mag;
        }
        sum += num / den;
        count += 1;
    }
    sum / count as f64
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

    let low = run(&f.model, &f.engine.inputs(line, VoiceParams { pitch: 0.7, ..VoiceParams::default() }));
    assert_eq!(low.len(), a.len(), "pitch keeps the timing");
    assert_ne!(low, a);

    let fast = run(&f.model, &f.engine.inputs(line, VoiceParams { speed: 1.25, ..VoiceParams::default() }));
    assert!(fast.len() < a.len());
}

#[test]
fn depth_changes_the_size_not_the_timing() {
    let Some(f) = fixture() else { return };
    let line = "Hello! I'm hungry, I should cook something.";
    let a = run(&f.model, &f.engine.inputs(line, VoiceParams::default()));
    let large = f.engine.inputs(line, VoiceParams { depth: 0.85, ..VoiceParams::default() });
    assert!((large.pitch - 1.0 / 0.85).abs() < 1e-5 && (large.speed - 1.0 / 0.85).abs() < 1e-5);
    let b = run(&f.model, &large);
    assert_eq!(b, run(&f.model, &large), "deterministic");
    let ratio = b.len() as f64 / a.len() as f64;
    assert!((0.94..1.06).contains(&ratio), "length changed by {ratio}");
    let (ca, cb) = (centroid(&a), centroid(&b));
    eprintln!("spectral centroid: depth 1 {ca:.0} Hz, depth 0.85 {cb:.0} Hz");
    assert!(cb < ca * 0.95, "a larger voice should sound darker: {ca:.0} -> {cb:.0} Hz");
}

#[test]
fn inputs_are_padded_ids_and_clamped_voices() {
    let Some(f) = fixture() else { return };
    let m = f.engine.inputs("Hello there!", VoiceParams { speed: 9.0, pitch: 0.1, depth: 1.0 });
    assert_eq!((m.ids.first(), m.ids.last()), (Some(&0), Some(&0)));
    assert!(m.ids.len() > 5 && m.ids[1..m.ids.len() - 1].iter().all(|&id| id > 0));
    assert_eq!((m.speed, m.pitch, m.depth), (2.0, 0.4, 1.0));
    let m = f.engine.inputs("Hello there!", VoiceParams { speed: 1.0, pitch: 1.0, depth: 3.0 });
    assert_eq!(m.depth, 1.3);
    assert!(f.engine.inputs("", VoiceParams::default()).ids.is_empty());
    let long = "la ".repeat(400);
    assert_eq!(f.engine.inputs_for_phonemes(&long, VoiceParams::default()).ids.len(), 512);
}
