//! Mouth shapes (`voice::visemes`): placed over the voiced part of a clip, pauses on its quiet
//! gaps, and every symbol the phonemizer writes has a viseme.

use std::io::Read;
use std::path::PathBuf;

use voice::visemes::{self, SIL, VISEMES, VisemeTrack};
use voice::{G2p, Lexicon, ModelInputs, SAMPLE_RATE};

const RATE: f32 = SAMPLE_RATE as f32;

/// `(seconds, sound?)` pieces: a 180 Hz tone with a slow wobble where there is sound, zeros elsewhere.
fn signal(parts: &[(f32, bool)]) -> Vec<f32> {
    let mut out = Vec::new();
    for &(seconds, sound) in parts {
        let n = (seconds * RATE).round() as usize;
        for _ in 0..n {
            let t = out.len() as f32 / RATE;
            out.push(if sound { 0.3 * (t * 180.0 * std::f32::consts::TAU).sin() * (0.8 + 0.2 * (t * 5.0 * std::f32::consts::TAU).sin()) } else { 0.0 });
        }
    }
    out
}

fn assert_monotonic(t: &VisemeTrack) {
    assert_eq!(t.times.len(), t.visemes.len() + 1);
    assert!(t.times.windows(2).all(|w| w[1] > w[0]), "times not increasing: {:?}", t.times);
}

const LINE: &str = "hˈɛlO, wˈɜɹld. ˈI æm hˈɪɹ!";

#[test]
fn same_input_same_track() {
    let x = signal(&[(0.05, false), (1.6, true), (0.1, false)]);
    let a = visemes::track(LINE, &x, SAMPLE_RATE);
    let b = visemes::track(LINE, &x, SAMPLE_RATE);
    assert_eq!(a, b);
    assert_eq!(a.flat(), b.flat());
}

#[test]
fn covers_the_voiced_span() {
    let x = signal(&[(0.05, false), (1.0, true), (0.1, false)]);
    let t = visemes::track("hˈɛlO wˈɜɹld.", &x, SAMPLE_RATE);
    assert_monotonic(&t);
    assert!((t.times[0] - 0.05).abs() <= 0.01, "starts at {}", t.times[0]);
    assert!((t.times[t.times.len() - 1] - 1.05).abs() <= 0.01, "ends at {}", t.times[t.times.len() - 1]);
    // No pause at either end; the punctuation's pause is outside the voice.
    assert_ne!(t.visemes[0], SIL);
    assert_ne!(*t.visemes.last().unwrap(), SIL);
    // 10 ms of loudness from the clip's start, 0..1, full while speaking.
    assert_eq!(t.energy.len(), x.len().div_ceil(240));
    assert!(t.energy.iter().all(|e| (0.0..=1.0).contains(e)));
    assert_eq!(t.energy[1], 0.0);
    assert!(t.energy[50] > 0.5);
}

#[test]
fn a_comma_lands_on_the_gap() {
    let ps = "hˈɛlO, wˈɜɹld";
    // Where the weights alone put the comma (a clip without a gap).
    let plain = visemes::track(ps, &signal(&[(0.05, false), (1.2, true), (0.1, false)]), SAMPLE_RATE);
    let k = plain.visemes.iter().position(|&v| v == SIL).unwrap();
    let (a, b) = (plain.times[k], plain.times[k + 1]);
    // A real gap, later and shorter than that.
    let gap_start = (a + b) / 2.0 + 0.04 - 0.07;
    let gap_end = gap_start + 0.14;
    assert!((gap_start - a).abs() < 0.11 && (gap_end - b).abs() < 0.11, "test gap too far: {a}..{b} vs {gap_start}..{gap_end}");
    let x = signal(&[(0.05, false), (gap_start - 0.05, true), (0.14, false), (1.25 - gap_end, true), (0.1, false)]);
    let t = visemes::track(ps, &x, SAMPLE_RATE);
    assert_monotonic(&t);
    assert_eq!(t.visemes, plain.visemes);
    assert!((t.times[k] - gap_start).abs() <= 0.01, "pause starts at {}, gap at {gap_start}", t.times[k]);
    assert!((t.times[k + 1] - gap_end).abs() <= 0.01, "pause ends at {}, gap at {gap_end}", t.times[k + 1]);
    // The ends stay where the voice is.
    assert_eq!(t.times[0], plain.times[0]);
    assert_eq!(t.times.last(), plain.times.last());
}

#[test]
fn pauses_move_at_most_120_ms() {
    let ps = "hˈɛlO, wˈɜɹld";
    let plain = visemes::track(ps, &signal(&[(0.05, false), (1.2, true), (0.1, false)]), SAMPLE_RATE);
    let k = plain.visemes.iter().position(|&v| v == SIL).unwrap();
    // A gap well before the comma: only reached by 120 ms.
    let gap_start = plain.times[k] - 0.3;
    let x = signal(&[(0.05, false), (gap_start - 0.05, true), (0.25, false), (1.0 - gap_start, true), (0.1, false)]);
    let t = visemes::track(ps, &x, SAMPLE_RATE);
    assert_monotonic(&t);
    assert!((t.times[k] - plain.times[k]).abs() <= 0.1201);
    assert!((t.times[k + 1] - plain.times[k + 1]).abs() <= 0.1201);
}

#[test]
fn times_increase_whatever_the_signal() {
    // Many pauses, gaps in odd places, noise.
    let mut seed = 12345u32;
    let mut rnd = || {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (seed >> 8) as f32 / (1 << 24) as f32
    };
    for _ in 0..50 {
        let mut parts = vec![(0.05, false)];
        for _ in 0..8 {
            parts.push((0.05 + rnd() * 0.4, true));
            parts.push((rnd() * 0.15, false));
        }
        parts.push((0.2, true));
        let x = signal(&parts);
        let t = visemes::track("ʌ, ʌ. ʌ, b, ʌ! d; ɛ… ɪ? O, A, kˈæt dˈɔɡ.", &x, SAMPLE_RATE);
        assert_monotonic(&t);
    }
    // Nothing to show: no segments, still the loudness.
    let x = signal(&[(0.3, true)]);
    assert!(visemes::track("", &x, SAMPLE_RATE).visemes.is_empty());
    assert!(visemes::track(".", &x, SAMPLE_RATE).times.is_empty());
    let silent = visemes::track(LINE, &[0.0; 4800], SAMPLE_RATE);
    assert!(silent.times.is_empty() && silent.energy.len() == 20);
    assert!(visemes::track(LINE, &[], SAMPLE_RATE).energy.is_empty());
}

#[test]
fn flat_layout() {
    let x = signal(&[(0.05, false), (0.6, true), (0.1, false)]);
    let t = visemes::track("hˈI", &x, SAMPLE_RATE);
    let flat = t.flat();
    let n = t.visemes.len();
    assert_eq!(flat[0], n as f32);
    assert_eq!(flat[1], t.energy.len() as f32);
    assert_eq!(&flat[2..3 + n], &t.times[..]);
    assert_eq!(flat[3 + n..3 + 2 * n].iter().map(|&v| v as u8).collect::<Vec<_>>(), t.visemes);
    assert_eq!(&flat[3 + 2 * n..], &t.energy[..]);
    assert_eq!(VisemeTrack::from_flat(&flat), Some(t));
    let empty = VisemeTrack { energy: vec![0.5], ..Default::default() };
    assert_eq!(empty.flat(), [0.0, 1.0, 0.5]);
    assert_eq!(VisemeTrack::from_flat(&empty.flat()), Some(empty));
}

#[test]
fn finish_returns_the_clip_and_its_track() {
    // As the model gives it: lead-in silence, speech, silence and the noisy 5000-sample tail.
    let mut model = signal(&[(0.4, false), (0.9, true), (0.3, false)]);
    model.extend(vec![0.2; 5000]);
    let inputs = ModelInputs { ids: vec![0, 50, 10, 0], speed: 1.0, pitch: 1.0, depth: 1.2, row: 3, phonemes: "hˈI ðˈɛɹ!".into() };
    let (samples, flat) = inputs.finish(&model);
    let t = VisemeTrack::from_flat(&flat).unwrap();
    assert_eq!(t.energy.len(), samples.len().div_ceil(240));
    assert_monotonic(&t);
    let seconds = samples.len() as f32 / RATE;
    // Trimmed to 50 ms before the voice, then 1/1.2 as long.
    assert!((t.times[0] - 0.05 / 1.2).abs() <= 0.015, "starts at {}", t.times[0]);
    assert!(*t.times.last().unwrap() <= seconds && *t.times.last().unwrap() > seconds - 0.15);
}

fn g2p() -> Option<G2p> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/public/voice/en-us.lexz");
    let Ok(file) = std::fs::File::open(&path) else {
        eprintln!("skipped: {} missing (run `node tools/voice/fetch.mjs`)", path.display());
        return None;
    };
    let mut tsv = String::new();
    flate2::read::GzDecoder::new(file).read_to_string(&mut tsv).unwrap();
    Some(G2p::new(Lexicon::parse(&tsv)))
}

/// Every symbol the phonemizer writes has a viseme (unknown ones would show as E).
#[test]
fn every_symbol_has_a_viseme() {
    let mut lines: Vec<String> = include_str!("data/misaki_golden.tsv").lines().filter_map(|l| l.split_once('\t')).map(|(_, ps)| ps.to_owned()).collect();
    if let Some(g2p) = g2p() {
        let sentences = [
            "Hello there! How are you doing today?",
            "I'm so hungry, I could eat a whole pizza by myself.",
            "What a lovely garden. I should water the roses before it gets dark.",
            "Judge George measured the beige garage; thanks, though.",
            "Oh boy, the toy is out of the house — wow!",
            "\"Quick,\" she said (quietly), \"the zoo's kittens yawned at 7:30.\"",
            "Jonas and Zoë bought 42 bottles of water, 3.5 litres each…",
            "Brr. Mmm, hmm? Uh-huh. Little button, singing, hurried.",
            "[Kokoro](/kˈOkəɹˌO/) runs on the CPU at 100% with Xavier & Siobhan.",
        ];
        lines.extend(sentences.iter().map(|s| g2p.phonemize(s)));
        // Every line of the game's content too.
        let content = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/public/content/voice/en.json");
        if let Ok(json) = std::fs::read_to_string(content) {
            let mut texts = Vec::new();
            collect(&serde_json::from_str(&json).unwrap(), &mut texts);
            assert!(texts.len() > 100);
            lines.extend(texts.iter().map(|t| g2p.phonemize(&t.replace("{me}", "Anna").replace("{name}", "Ben"))));
        }
    }
    let mut unknown = String::new();
    for ps in &lines {
        unknown.push_str(&visemes::unknown_symbols(ps));
        let segs = visemes::segments(ps);
        assert!(!segs.is_empty(), "no segments for {ps:?}");
        assert!(segs.iter().all(|s| (s.viseme as usize) < VISEMES.len() && s.weight > 0.0));
    }
    assert!(unknown.is_empty(), "symbols without a viseme: {unknown:?}");
    assert_eq!(visemes::unknown_symbols("ʘ€"), "ʘ€");
}

fn collect(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::String(s) => out.push(s.clone()),
        serde_json::Value::Array(a) => a.iter().for_each(|x| collect(x, out)),
        serde_json::Value::Object(m) => m.iter().filter(|(k, _)| !k.starts_with('_') && *k != "tone").for_each(|(_, x)| collect(x, out)),
        _ => {}
    }
}
