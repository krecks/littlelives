//! KittenTTS nano 0.8's input (Apache-2.0, <https://github.com/KittenML/KittenTTS>): espeak-ng
//! style IPA, split into words and punctuation and joined with spaces, mapped through its
//! StyleTTS2 symbol table, with the pad id 0 first and `…` (10) and the pad last, exactly as its
//! own code builds it (`kittenml/kittentts_legacy/onnx_model.py`). The model runs in the browser
//! with ONNX Runtime Web on a copy edited by `tools/voice/model.mjs`.
//!
//! KittenTTS was trained on espeak-ng's phonemes; espeak-ng is GPL, so we don't use it. Our
//! phonemes are Misaki's, and Misaki was itself made from espeak's by a fixed substitution table
//! (`misaki/espeak.py`): [`misaki_to_espeak`] applies that table backwards and puts back the vowel
//! length marks Misaki drops for American English. Across every line of the game's content the
//! result differs from espeak-ng's own output in 2.6 % of the sounds (mostly where espeak is
//! wrong, like "Mmm" or "Brr"), and listeners' scores are the same (measured 2026-10-10,
//! docs/design/voices.md).

use std::collections::HashMap;

/// The model takes at most this many ids, ends included.
const MAX_IDS: usize = 512;
/// Style rows shipped per voice (`tools/voice/fetch.mjs`): the row is the text's length in
/// characters, and lines are short; longer text uses the last row.
pub const STYLE_ROWS: usize = 128;
/// Its code drops the last 5000 samples of every clip (they end in noise).
const TAIL: usize = 5000;
/// Silence trimming: 10 ms frames; a frame is sound when its RMS is over 5 % of the loudest
/// frame's (−26 dB: above the soft breath KittenTTS starts many clips with, below the first
/// consonant); 50 ms are kept before the first sound and 100 ms after the last.
const FRAME: usize = 240;
const THRESHOLD: f32 = 0.05;
const LEAD: usize = 1200;
const TRAIL: usize = 2400;
/// Its code ends every input with `…` and the pad.
const END: i64 = 10;

const PAD: &str = "$";
const PUNCTUATION: &str = ";:,.!?¡¿—…\"«»\"\" ";
const LETTERS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LETTERS_IPA: &str = "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";

pub struct KittenTokenizer {
    symbols: HashMap<char, i64>,
}

impl Default for KittenTokenizer {
    fn default() -> Self {
        Self::new()
    }
}

impl KittenTokenizer {
    pub fn new() -> Self {
        let mut symbols = HashMap::new();
        // In table order; a symbol listed twice keeps its last id, as in the Python dict.
        for (i, c) in PAD.chars().chain(PUNCTUATION.chars()).chain(LETTERS.chars()).chain(LETTERS_IPA.chars()).enumerate() {
            symbols.insert(c, i as i64);
        }
        KittenTokenizer { symbols }
    }

    /// Ids for espeak-style IPA. Symbols the model doesn't know are skipped (see [`Self::unknown`]);
    /// long input is cut. Empty when there is nothing to say.
    pub fn ids(&self, ipa: &str) -> Vec<i64> {
        let mut ids = vec![0];
        ids.extend(spaced(ipa).chars().filter_map(|c| self.symbols.get(&c).copied()).take(MAX_IDS - 3));
        if !ids[1..].iter().any(|&id| id != self.symbols[&' ']) {
            return Vec::new();
        }
        ids.extend([END, 0]);
        ids
    }

    /// The symbols of `ipa` the model doesn't know (for tests).
    pub fn unknown(&self, ipa: &str) -> String {
        spaced(ipa).chars().filter(|c| !self.symbols.contains_key(c)).collect()
    }
}

/// The style row for a line: its length in characters (as KittenTTS's code), within the rows shipped.
pub fn style_row(text: &str) -> usize {
    text.chars().count().min(STYLE_ROWS - 1)
}

/// The model's output without its noisy tail and without the silence around the speech
/// (KittenTTS starts its clips with up to 0.8 s of silence).
pub fn trim(samples: &[f32]) -> &[f32] {
    let s = &samples[..samples.len().saturating_sub(TAIL)];
    let rms: Vec<f32> = s.chunks(FRAME).map(|f| (f.iter().map(|x| x * x).sum::<f32>() / f.len() as f32).sqrt()).collect();
    let loudest = rms.iter().copied().fold(0.0, f32::max);
    if loudest <= 0.0 {
        return s;
    }
    let sound = |r: &f32| *r > loudest * THRESHOLD;
    let first = rms.iter().position(sound).unwrap_or(0);
    let last = rms.iter().rposition(sound).unwrap_or(rms.len() - 1);
    let start = (first * FRAME).saturating_sub(LEAD);
    let end = ((last + 1) * FRAME + TRAIL).min(s.len());
    &s[start..end]
}

/// Words and punctuation marks, one space between each (Python's `\w+|[^\w\s]`, joined by spaces).
fn spaced(ipa: &str) -> String {
    let mut out = String::with_capacity(ipa.len() + 8);
    let mut in_word = false;
    for c in ipa.chars() {
        if c.is_whitespace() {
            in_word = false;
            continue;
        }
        let word = c.is_alphanumeric() || c == '_';
        if !out.is_empty() && !(word && in_word) {
            out.push(' ');
        }
        out.push(c);
        in_word = word;
    }
    out
}

/// Misaki (American English) phonemes to espeak-ng style IPA.
pub fn misaki_to_espeak(phonemes: &str) -> String {
    let mut out = String::with_capacity(phonemes.len() + 16);
    let mut word = String::new();
    for c in phonemes.chars() {
        if c.is_whitespace() || ".,!?;:—…\"()“”".contains(c) {
            if !word.is_empty() {
                out.push_str(&espeak_word(&word));
                word.clear();
            }
            out.push(c);
        } else {
            word.push(c);
        }
    }
    if !word.is_empty() {
        out.push_str(&espeak_word(&word));
    }
    out
}

const VOWELS: &str = "aeiouæɑɒɔəɚɛɜɪʊʌAIOWYᵊᵻ";

fn espeak_word(w: &str) -> String {
    // r-coloured vowels and the long vowels Misaki writes short
    let s = w.replace("ɜɹ", "ɜː").replace("əɹ", "ɚ").replace("ɔɹ", "ɔːɹ").replace("ɑɹ", "ɑːɹ");
    let chars: Vec<char> = s.chars().collect();
    let syllables = chars.iter().filter(|c| VOWELS.contains(**c)).count();
    let mut out = String::with_capacity(s.len() + 8);
    for (i, &c) in chars.iter().enumerate() {
        let next = chars.get(i + 1).copied();
        match c {
            'ɑ' if next != Some('ː') => out.push_str("ɑː"),
            'ɔ' if next != Some('ː') && next != Some('Y') => out.push_str("ɔː"),
            'u' => out.push_str("uː"),
            // `i` is long, except at the end of a word of two or more syllables (happy, pretty)
            'i' if next.is_some() || syllables < 2 => out.push_str("iː"),
            'A' => out.push_str("eɪ"),
            'I' => out.push_str("aɪ"),
            'O' => out.push_str("oʊ"),
            'W' => out.push_str("aʊ"),
            'Y' => out.push_str("ɔɪ"),
            'ʤ' => out.push_str("dʒ"),
            'ʧ' => out.push_str("tʃ"),
            'T' => out.push('ɾ'),
            'ᵊ' => out.push('ə'),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn misaki_maps_to_espeak() {
        // espeak-ng's own output for these, from the research.
        assert_eq!(misaki_to_espeak("dˈu ˌI nˈO ju?"), "dˈuː ˌaɪ nˈoʊ juː?");
        assert_eq!(misaki_to_espeak("pɹˈɪTi ɡˈʊd, θˈæŋks fɔɹ ˈæskɪŋ!"), "pɹˈɪɾi ɡˈʊd, θˈæŋks fɔːɹ ˈæskɪŋ!");
        assert_eq!(misaki_to_espeak("ˌI hæd ðə stɹˈAnʤɪst dɹˈim lˈæst nˈIt."), "ˌaɪ hæd ðə stɹˈeɪndʒɪst dɹˈiːm lˈæst nˈaɪt.");
        assert_eq!(misaki_to_espeak("bˈɜɹd ˈɛvəɹ mˈi"), "bˈɜːd ˈɛvɚ mˈiː");
    }

    #[test]
    fn trims_silence_and_the_tail() {
        let mut x = vec![0.0f32; 24_000];
        for (i, v) in x[9_600..14_400].iter_mut().enumerate() {
            *v = (i as f32 * 0.1).sin() * 0.5;
        }
        x.extend(vec![0.3; TAIL]); // the noisy tail goes whatever it holds
        let t = trim(&x);
        assert_eq!(t.len(), 4_800 + LEAD + TRAIL);
        assert_eq!(t[LEAD], x[9_600]);
        assert!(trim(&[0.0; 100]).is_empty() || trim(&[0.0; 100]).iter().all(|v| *v == 0.0));
        assert_eq!(style_row("Hi!"), 3);
        assert_eq!(style_row(&"a".repeat(300)), STYLE_ROWS - 1);
    }

    #[test]
    fn tokens_as_kittens_own_code_makes_them() {
        let t = KittenTokenizer::new();
        // "juː?" becomes "juː ?": words and punctuation spaced.
        assert_eq!(spaced("dˈuː ˌaɪ nˈoʊ juː?"), "dˈuː ˌaɪ nˈoʊ juː ?");
        assert_eq!(t.ids("dˈuː ˌaɪ nˈoʊ juː?"), [0, 46, 156, 63, 158, 16, 157, 43, 102, 16, 56, 156, 57, 135, 16, 52, 63, 158, 16, 6, 10, 0]);
        assert_eq!(
            t.ids("pɹˈɪɾi ɡˈʊd, θˈæŋks fɔːɹ ˈæskɪŋ!"),
            [0, 58, 123, 156, 102, 125, 51, 16, 92, 156, 135, 46, 16, 3, 16, 119, 156, 72, 112, 53, 61, 16, 48, 76, 158, 123, 16, 156, 72, 61, 53, 102, 112, 16, 5, 10, 0]
        );
        // From the research harness (the same as the Python code gives).
        let ids = t.ids("ˌaɪ hæd ðə stɹˈeɪndʒɪst dɹˈiːm lˈæst nˈaɪt.");
        assert_eq!(
            ids,
            [0, 157, 43, 102, 16, 50, 72, 46, 16, 81, 83, 16, 61, 62, 123, 156, 47, 102, 56, 46, 147, 102, 61, 62, 16, 46, 123, 156, 51, 158, 55, 16, 54, 156, 72, 61, 62, 16, 56, 156, 43, 102, 62, 16, 4, 10, 0]
        );
        assert_eq!(t.symbols[&'"'], 15);
        assert!(t.ids("").is_empty() && t.ids("  ").is_empty());
        assert_eq!(t.unknown("ʘx"), "");
        assert_eq!(t.unknown("ç€"), "€");
    }
}
