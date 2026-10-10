//! Compares the phonemizer with Python Misaki 0.9.4 (`tests/data/misaki_golden.tsv`, made with
//! `G2P(trf=False, british=False, fallback=None)`). Needs `node tools/voice/fetch.mjs` first.

use std::io::Read;
use std::path::PathBuf;

use voice::{G2p, Lexicon};

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

#[test]
fn matches_misaki() {
    let Some(g2p) = g2p() else { return };
    let golden = include_str!("data/misaki_golden.tsv");
    let mut wrong = Vec::new();
    for line in golden.lines() {
        let (text, expected) = line.split_once('\t').unwrap();
        let got = g2p.phonemize(text);
        if got != expected {
            wrong.push(format!("{text}\n  misaki: {expected}\n  ours:   {got}"));
        }
    }
    assert!(wrong.is_empty(), "{} of {} lines differ:\n{}", wrong.len(), golden.lines().count(), wrong.join("\n"));
}

#[test]
fn unknown_words_are_guessed() {
    let Some(g2p) = g2p() else { return };
    assert_eq!(g2p.unknown_words("Hello Kokoro, nice to meet you."), ["Kokoro"]);
    assert_eq!(g2p.phonemize("[Kokoro](/kˈOkəɹˌO/) runs on the CPU."), "kˈOkəɹˌO ɹˈʌnz ˌɔn ðə sˌipˌijˈu.");
    assert!(!g2p.phonemize("Kokoro").is_empty());
}

#[test]
fn accents_are_read_as_plain_letters() {
    let Some(g2p) = g2p() else { return };
    assert!(g2p.unknown_words("A new café opened.").is_empty());
    assert_eq!(g2p.phonemize("café"), g2p.phonemize("cafe"));
    // A name the dictionary doesn't have is still guessed, not dropped.
    assert_eq!(g2p.phonemize("Zoë"), g2p.phonemize("Zoe"));
    assert!(!g2p.phonemize("Zoë").is_empty());
}
