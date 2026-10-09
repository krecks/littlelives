//! Paradee through `tract` with our graph edits. Needs `node tools/voice/fetch.mjs` first; slow
//! in debug builds, so run with `cargo test -p voice --release`.

use std::io::Read;
use std::path::PathBuf;
use std::time::Instant;

use voice::{Engine, G2p, Lexicon, Model, SAMPLE_RATE, VoiceParams};

fn engine() -> Option<Engine> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/public/voice");
    let (Ok(onnx), Ok(config), Ok(lex)) = (
        std::fs::read(dir.join("paradee-8m.onnx")),
        std::fs::read_to_string(dir.join("paradee-8m.json")),
        std::fs::File::open(dir.join("en-us.lexz")),
    ) else {
        eprintln!("skipped: voice files missing (run `node tools/voice/fetch.mjs`)");
        return None;
    };
    let mut tsv = String::new();
    flate2::read::GzDecoder::new(lex).read_to_string(&mut tsv).unwrap();
    Some(Engine::new(G2p::new(Lexicon::parse(&tsv)), Model::load(&onnx, &config).unwrap()))
}

#[test]
fn speaks_deterministically_with_pitch() {
    let Some(engine) = engine() else { return };
    let line = "Hello! I'm hungry, I should cook something.";
    let t = Instant::now();
    let a = engine.speak(line, VoiceParams::default()).unwrap();
    let took = t.elapsed().as_secs_f64();
    let secs = a.len() as f64 / SAMPLE_RATE as f64;
    eprintln!("{secs:.2} s of audio in {took:.2} s ({:.1}x real time)", secs / took);
    assert!((2.0..4.5).contains(&secs), "unexpected length {secs}");
    let rms = (a.iter().map(|s| s * s).sum::<f32>() / a.len() as f32).sqrt();
    assert!(rms > 0.01, "silent output");

    let again = engine.speak(line, VoiceParams::default()).unwrap();
    assert_eq!(a, again, "same line, same audio");

    let low = engine.speak(line, VoiceParams { speed: 1.0, pitch: 0.7 }).unwrap();
    assert_eq!(low.len(), a.len(), "pitch keeps the timing");
    assert_ne!(low, a);

    let fast = engine.speak(line, VoiceParams { speed: 1.25, pitch: 1.0 }).unwrap();
    assert!(fast.len() < a.len());
}
