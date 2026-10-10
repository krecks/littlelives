//! English text to Misaki phonemes: a port of the rules in Misaki's `en.py` (Apache-2.0,
//! <https://github.com/hexgrad/misaki>) without its part-of-speech tagger and without espeak-ng.
//! Words with tag-dependent pronunciations use the dictionary default; `[word](/phonemes/)` in
//! the text sets a pronunciation by hand; unknown words go to [`rules::guess`].

use crate::lexicon::Lexicon;
use crate::numbers;
use crate::rules::{self, VOWELS};

const PRIMARY: char = 'ˈ';
const SECONDARY: char = 'ˌ';
const CONSONANTS: &str = "bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθ";
const US_TAUS: &str = "AIOWYiuæɑəɛɪɹʊʌ";
/// Punctuation the model knows; it is kept in the phoneme string.
const PUNCTS: &str = ";:,.!?—…\"“”()";
const NON_QUOTE_PUNCTS: &str = ";:,.!?—…";
const SYMBOLS: [(&str, &str); 4] = [("%", "percent"), ("&", "and"), ("+", "plus"), ("@", "at")];
const ORDINALS: [&str; 4] = ["st", "nd", "rd", "th"];

pub struct G2p {
    lexicon: Lexicon,
}

#[derive(Debug)]
enum Token {
    Word { text: String, fixed: Option<String>, space: bool },
    Punct { ch: char, space: bool },
}

/// What follows the word being phonemized (Misaki works right to left).
#[derive(Clone, Copy, Default)]
struct Context {
    /// Some(true): the next word starts with a vowel sound; None: punctuation or the end follows.
    future_vowel: Option<bool>,
    /// The next word usually starts a clause ("that he…", "that I've…"), so "that" is a
    /// conjunction rather than a demonstrative (what Misaki's tagger would decide).
    clause_follows: bool,
}

/// Misaki's "that" when tagged as a determiner.
const THAT_DEMONSTRATIVE: &str = "ðˈæt";

/// Words that usually start a clause.
const CLAUSE_STARTERS: [&str; 24] = [
    "i", "i'm", "i've", "i'd", "i'll", "you", "you're", "he", "he's", "she", "she's", "it", "it's", "we",
    "we're", "they", "they're", "there", "the", "a", "an", "this", "my", "your",
];

impl G2p {
    pub fn new(lexicon: Lexicon) -> Self {
        G2p { lexicon }
    }

    pub fn lexicon(&self) -> &Lexicon {
        &self.lexicon
    }

    /// Phonemes for a line of text, with punctuation and spacing kept.
    pub fn phonemize(&self, text: &str) -> String {
        let tokens = tokenize(text);
        let mut phonemes = vec![String::new(); tokens.len()];
        let mut ctx = Context::default();
        for (i, token) in tokens.iter().enumerate().rev() {
            let ps = match token {
                Token::Punct { ch, .. } => ch.to_string(),
                Token::Word { fixed: Some(p), .. } => p.clone(),
                Token::Word { text, .. } => self.word(text, ctx).unwrap_or_default(),
            };
            ctx = next_context(ctx, &ps);
            ctx.clause_follows = matches!(token, Token::Word { text, .. } if CLAUSE_STARTERS.contains(&text.to_lowercase().as_str()));
            phonemes[i] = ps;
        }
        let mut out = String::new();
        for (token, ps) in tokens.iter().zip(&phonemes) {
            let space = match token {
                Token::Word { space, .. } | Token::Punct { space, .. } => *space,
            };
            if ps.is_empty() {
                continue;
            }
            if space && !out.is_empty() && !out.ends_with(' ') {
                out.push(' ');
            }
            out.push_str(ps);
        }
        // Kokoro 1.0's alphabet (and Paradee's): flap T, glottal stop as t.
        out.replace('ɾ', "T").replace('ʔ', "t")
    }

    /// Words this phonemizer had to guess (not in the dictionary, not a number or symbol):
    /// hand-written lines should give none.
    pub fn unknown_words(&self, text: &str) -> Vec<String> {
        tokenize(text)
            .into_iter()
            .filter_map(|t| match t {
                Token::Word { text, fixed: None, .. } if self.word_known(&text) => None,
                Token::Word { text, fixed: None, .. } => Some(text),
                _ => None,
            })
            .collect()
    }

    fn word_known(&self, word: &str) -> bool {
        if let Some(plain) = unaccented(word) {
            return self.word_known(&plain);
        }
        is_number(word) || self.get_word(word, None, Context::default()).is_some()
    }

    fn word(&self, word: &str, ctx: Context) -> Option<String> {
        let lower = word.to_lowercase();
        let stress = if word == lower {
            None
        } else if word == word.to_uppercase() {
            Some(2.0)
        } else {
            Some(0.5)
        };
        if let Some(ps) = self.get_word(word, stress, ctx) {
            return Some(ps);
        }
        if is_number(word) {
            return self.number(word);
        }
        // "café", "Zoë": read as without the accents rather than dropped.
        if let Some(plain) = unaccented(word) {
            return self.word(&plain, ctx);
        }
        if !word.bytes().all(|c| c.is_ascii_alphabetic() || c == b'\'') {
            return None;
        }
        // Unknown: spell short all-caps words ("CPU"), guess the rest.
        if word.len() <= 4 && word == word.to_uppercase() {
            if let Some(ps) = self.nnp(word) {
                return Some(ps);
            }
        }
        let guess = rules::guess(word);
        (!guess.is_empty()).then_some(guess)
    }

    fn get_word(&self, word: &str, stress: Option<f32>, ctx: Context) -> Option<String> {
        if let Some(ps) = self.special_case(word, stress, ctx) {
            return Some(ps);
        }
        let lower = word.to_lowercase();
        let mut word = word.to_owned();
        let letters_only = word.chars().filter(|&c| c != '\'').all(char::is_alphabetic);
        let rest_lower = word.chars().skip(1).collect::<String>() == lower.chars().skip(1).collect::<String>();
        if word.chars().count() > 1
            && letters_only
            && word != lower
            && !self.lexicon.contains(&word)
            && (word == word.to_uppercase() || rest_lower)
            && (self.lexicon.contains(&lower)
                || self.stem_s(&lower, stress).is_some()
                || self.stem_ed(&lower, stress).is_some()
                || self.stem_ing(&lower, stress).is_some())
        {
            word = lower;
        }
        if self.is_known(&word) {
            return self.lookup(&word, stress);
        }
        if let Some(stem) = word.strip_suffix("s'") {
            let possessive = format!("{stem}'s");
            if self.is_known(&possessive) {
                return self.lookup(&possessive, stress);
            }
        }
        if let Some(stem) = word.strip_suffix('\'') {
            if self.is_known(stem) {
                return self.lookup(stem, stress);
            }
        }
        self.stem_s(&word, stress)
            .or_else(|| self.stem_ed(&word, stress))
            .or_else(|| self.stem_ing(&word, Some(stress.unwrap_or(0.5))))
    }

    /// Function words whose sound depends on what follows, as in Misaki (assuming the usual
    /// part of speech, since there is no tagger).
    fn special_case(&self, word: &str, stress: Option<f32>, ctx: Context) -> Option<String> {
        if let Some((_, name)) = SYMBOLS.iter().find(|(s, _)| *s == word) {
            return self.lookup(name, None);
        }
        Some(match word {
            "a" | "A" => "ɐ".to_owned(),
            "am" | "Am" | "AM" => {
                if ctx.future_vowel.is_none() || word != "am" || stress.is_some_and(|s| s > 0.0) {
                    self.lexicon.get("am")?.to_owned()
                } else {
                    "ɐm".to_owned()
                }
            }
            "an" | "An" | "AN" => "ɐn".to_owned(),
            "I" => format!("{SECONDARY}I"),
            "to" | "To" | "TO" => match ctx.future_vowel {
                None => self.lexicon.get("to")?.to_owned(),
                Some(false) => "tə".to_owned(),
                Some(true) => "tʊ".to_owned(),
            },
            "in" | "In" | "IN" => {
                if ctx.future_vowel.is_none() {
                    format!("{PRIMARY}ɪn")
                } else {
                    "ɪn".to_owned()
                }
            }
            "that" | "That" | "THAT" => {
                if ctx.clause_follows {
                    self.lexicon.get("that")?.to_owned()
                } else {
                    THAT_DEMONSTRATIVE.to_owned()
                }
            }
            "the" | "The" | "THE" => {
                if ctx.future_vowel == Some(true) {
                    "ði".to_owned()
                } else {
                    "ðə".to_owned()
                }
            }
            _ => return None,
        })
    }

    fn is_known(&self, word: &str) -> bool {
        if self.lexicon.contains(word) || SYMBOLS.iter().any(|(s, _)| *s == word) {
            return true;
        }
        if !word.bytes().all(|c| c.is_ascii_alphabetic() || c == b'\'' || c == b'-') || !word.chars().all(char::is_alphabetic) {
            return false;
        }
        if word.chars().count() == 1 {
            return true;
        }
        if word == word.to_uppercase() && self.lexicon.contains(&word.to_lowercase()) {
            return true;
        }
        let rest: String = word.chars().skip(1).collect();
        rest == rest.to_uppercase()
    }

    fn lookup(&self, word: &str, stress: Option<f32>) -> Option<String> {
        let mut word = word.to_owned();
        if word == word.to_uppercase() && !self.lexicon.contains(&word) {
            word = word.to_lowercase();
        }
        // "that" as a demonstrative ("That's it"); the conjunction is decided in `special_case`.
        if word.eq_ignore_ascii_case("that") {
            return Some(apply_stress(THAT_DEMONSTRATIVE, stress));
        }
        match self.lexicon.get(&word) {
            Some(ps) => Some(apply_stress(ps, stress)),
            None => self.nnp(&word),
        }
    }

    /// Spelled out letter by letter, stress on the last letter ("CPU" → sˌipˌijˈu).
    fn nnp(&self, word: &str) -> Option<String> {
        let mut ps = String::new();
        for c in word.chars().filter(|c| c.is_alphabetic()) {
            ps.push_str(self.lexicon.get(&c.to_uppercase().to_string())?);
        }
        let ps = apply_stress(&ps, Some(0.0));
        Some(match ps.rfind(SECONDARY) {
            Some(i) => format!("{}{PRIMARY}{}", &ps[..i], &ps[i + SECONDARY.len_utf8()..]),
            None => ps,
        })
    }

    fn stem_s(&self, word: &str, stress: Option<f32>) -> Option<String> {
        if word.chars().count() < 3 || !word.ends_with('s') {
            return None;
        }
        let n = word.len();
        let stem = if !word.ends_with("ss") && self.is_known(&word[..n - 1]) {
            word[..n - 1].to_owned()
        } else if (word.ends_with("'s") || (n > 4 && word.ends_with("es") && !word.ends_with("ies"))) && self.is_known(&word[..n - 2]) {
            word[..n - 2].to_owned()
        } else if n > 4 && word.ends_with("ies") && self.is_known(&format!("{}y", &word[..n - 3])) {
            format!("{}y", &word[..n - 3])
        } else {
            return None;
        };
        Some(suffix_s(&self.lookup(&stem, stress)?))
    }

    fn stem_ed(&self, word: &str, stress: Option<f32>) -> Option<String> {
        if word.chars().count() < 4 || !word.ends_with('d') {
            return None;
        }
        let n = word.len();
        let stem = if !word.ends_with("dd") && self.is_known(&word[..n - 1]) {
            &word[..n - 1]
        } else if n > 4 && word.ends_with("ed") && !word.ends_with("eed") && self.is_known(&word[..n - 2]) {
            &word[..n - 2]
        } else {
            return None;
        };
        Some(suffix_ed(&self.lookup(stem, stress)?))
    }

    fn stem_ing(&self, word: &str, stress: Option<f32>) -> Option<String> {
        if word.chars().count() < 5 || !word.ends_with("ing") {
            return None;
        }
        let n = word.len();
        let base = &word[..n - 3];
        let doubled = {
            let b = base.as_bytes();
            b.len() >= 2 && b[b.len() - 1] == b[b.len() - 2] && b"bcdgklmnprstvxz".contains(&b[b.len() - 1])
        };
        let stem = if n > 5 && self.is_known(base) {
            base.to_owned()
        } else if self.is_known(&format!("{base}e")) {
            format!("{base}e")
        } else if n > 5 && (doubled || word.ends_with("cking")) && self.is_known(&word[..n - 4]) {
            word[..n - 4].to_owned()
        } else {
            return None;
        };
        Some(suffix_ing(&self.lookup(&stem, stress)?))
    }

    fn number(&self, word: &str) -> Option<String> {
        let digits_end = word.find(|c: char| !(c.is_ascii_digit() || c == ',' || c == '.')).unwrap_or(word.len());
        let (num, suffix) = word.split_at(digits_end);
        let suffix = suffix.to_lowercase();
        let plain: String = num.chars().filter(|&c| c != ',').collect();
        let words = if !plain.contains('.') {
            let n: u64 = plain.parse().ok()?;
            if ORDINALS.contains(&suffix.as_str()) {
                numbers::ordinal(n)
            } else if plain.len() == 4 && !num.contains(',') {
                numbers::year(n)
            } else {
                numbers::cardinal(n)
            }
        } else {
            let (whole, frac) = plain.split_once('.')?;
            let whole = if whole.is_empty() { String::new() } else { numbers::cardinal(whole.parse().ok()?) };
            let frac: Vec<&str> = frac.bytes().filter(u8::is_ascii_digit).map(|d| ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][(d - b'0') as usize]).collect();
            format!("{whole} point {}", frac.join(" "))
        };
        let mut parts = Vec::new();
        for w in words.split(|c: char| !c.is_ascii_alphabetic()).filter(|w| !w.is_empty() && *w != "and") {
            parts.push(self.lookup(w, if w == "point" { Some(-2.0) } else { None })?);
        }
        let ps = parts.join(" ");
        Some(match suffix.as_str() {
            "s" | "'s" => suffix_s(&ps),
            "ed" | "'d" => suffix_ed(&ps),
            "ing" => suffix_ing(&ps),
            _ => ps,
        })
    }
}

fn next_context(ctx: Context, ps: &str) -> Context {
    let first = ps.chars().find(|&c| VOWELS.contains(c) || CONSONANTS.contains(c) || NON_QUOTE_PUNCTS.contains(c));
    match first {
        Some(c) if NON_QUOTE_PUNCTS.contains(c) => Context { future_vowel: None, ..ctx },
        Some(c) => Context { future_vowel: Some(VOWELS.contains(c)), ..ctx },
        None => ctx,
    }
}

fn is_number(word: &str) -> bool {
    if !word.bytes().any(|c| c.is_ascii_digit()) {
        return false;
    }
    let lower = word.to_lowercase();
    let mut core = lower.as_str();
    for s in ["ing", "'d", "ed", "'s", "st", "nd", "rd", "th", "s"] {
        if let Some(c) = core.strip_suffix(s) {
            core = c;
            break;
        }
    }
    core.bytes().all(|c| c.is_ascii_digit() || c == b',' || c == b'.')
}

fn last_char(s: &str) -> Option<char> {
    s.chars().last()
}

/// Plural / third person "-s" (https://en.wiktionary.org/wiki/-s).
fn suffix_s(stem: &str) -> String {
    match last_char(stem) {
        Some(c) if "ptkfθ".contains(c) => format!("{stem}s"),
        Some(c) if "szʃʒʧʤ".contains(c) => format!("{stem}ᵻz"),
        _ => format!("{stem}z"),
    }
}

/// Past tense "-ed" (https://en.wiktionary.org/wiki/-ed).
fn suffix_ed(stem: &str) -> String {
    let chars: Vec<char> = stem.chars().collect();
    match chars.last() {
        Some(c) if "pkfθʃsʧ".contains(*c) => format!("{stem}t"),
        Some('d') => format!("{stem}ᵻd"),
        Some(c) if *c != 't' => format!("{stem}d"),
        _ if chars.len() < 2 => format!("{stem}ɪd"),
        _ if US_TAUS.contains(chars[chars.len() - 2]) => format!("{}ɾᵻd", chars[..chars.len() - 1].iter().collect::<String>()),
        _ => format!("{stem}ᵻd"),
    }
}

/// "-ing" (https://en.wiktionary.org/wiki/-ing).
fn suffix_ing(stem: &str) -> String {
    let chars: Vec<char> = stem.chars().collect();
    if chars.len() > 1 && chars[chars.len() - 1] == 't' && US_TAUS.contains(chars[chars.len() - 2]) {
        format!("{}ɾɪŋ", chars[..chars.len() - 1].iter().collect::<String>())
    } else {
        format!("{stem}ɪŋ")
    }
}

/// Misaki's `apply_stress`: raise or lower a word's stress (capitalised words get some, "point"
/// in numbers none).
fn apply_stress(ps: &str, stress: Option<f32>) -> String {
    let has_stress = ps.contains(PRIMARY) || ps.contains(SECONDARY);
    let has_vowel = ps.chars().any(|c| VOWELS.contains(c));
    let Some(stress) = stress else { return ps.to_owned() };
    if stress < -1.0 {
        ps.replace([PRIMARY, SECONDARY], "")
    } else if stress == -1.0 || ((stress == 0.0 || stress == -0.5) && ps.contains(PRIMARY)) {
        ps.replace(SECONDARY, "").replace(PRIMARY, &SECONDARY.to_string())
    } else if (stress == 0.0 || stress == 0.5 || stress == 1.0) && !has_stress {
        if has_vowel { restress(&format!("{SECONDARY}{ps}")) } else { ps.to_owned() }
    } else if stress >= 1.0 && !ps.contains(PRIMARY) && ps.contains(SECONDARY) {
        ps.replace(SECONDARY, &PRIMARY.to_string())
    } else if stress > 1.0 && !has_stress {
        if has_vowel { restress(&format!("{PRIMARY}{ps}")) } else { ps.to_owned() }
    } else {
        ps.to_owned()
    }
}

/// Moves each stress mark to just before the next vowel.
fn restress(ps: &str) -> String {
    let chars: Vec<char> = ps.chars().collect();
    let mut marks: Vec<(usize, char)> = Vec::new();
    let mut rest: Vec<(usize, char)> = Vec::new();
    for (i, &c) in chars.iter().enumerate() {
        if c == PRIMARY || c == SECONDARY {
            match chars[i..].iter().position(|&v| VOWELS.contains(v)) {
                Some(off) => marks.push((i + off, c)),
                None => rest.push((i, c)),
            }
        } else {
            rest.push((i, c));
        }
    }
    let mut out = String::with_capacity(ps.len());
    for (i, c) in rest {
        for &(_, m) in marks.iter().filter(|(at, _)| *at == i) {
            out.push(m);
        }
        out.push(c);
    }
    out
}

/// Splits a line into words and punctuation, keeping where spaces were. `[word](/phonemes/)`
/// fixes a word's pronunciation.
/// `word` with Latin accents taken off, if it has any (and nothing else outside ASCII).
fn unaccented(word: &str) -> Option<String> {
    const FROM: &str = "àáâãäåāçćčèéêëēěìíîïīñńňòóôõöøōùúûüūýÿžśšźżÀÁÂÃÄÅĀÇĆČÈÉÊËĒĚÌÍÎÏĪÑŃŇÒÓÔÕÖØŌÙÚÛÜŪÝŸŽŚŠŹŻ";
    const TO: &str = "aaaaaaaccceeeeeeiiiiinnnooooooouuuuuyyzsszzAAAAAAACCCEEEEEEIIIIINNNOOOOOOOUUUUUYYZSSZZ";
    if word.is_ascii() {
        return None;
    }
    let plain: String = word
        .chars()
        .map(|c| FROM.chars().position(|f| f == c).and_then(|i| TO.chars().nth(i)).unwrap_or(c))
        .collect();
    plain.is_ascii().then_some(plain)
}

fn tokenize(text: &str) -> Vec<Token> {
    let text = text.replace(['‘', '’'], "'").replace('–', "—");
    let chars: Vec<char> = text.chars().collect();
    let mut tokens = Vec::new();
    let mut space = false;
    let mut i = 0;
    let word_char = |c: char| c.is_alphanumeric();
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            space = true;
            i += 1;
            continue;
        }
        // [word](/phonemes/)
        if c == '[' {
            if let Some((word, phonemes, len)) = parse_link(&chars[i..]) {
                tokens.push(Token::Word { text: word, fixed: Some(phonemes), space });
                space = false;
                i += len;
                continue;
            }
        }
        if word_char(c) {
            let start = i;
            while i < chars.len() {
                let c = chars[i];
                let next_is = |f: fn(char) -> bool| chars.get(i + 1).is_some_and(|&n| f(n));
                let prev_digit = i > start && chars[i - 1].is_ascii_digit();
                if word_char(c)
                    || (c == '\'' && next_is(char::is_alphabetic))
                    || ((c == '.' || c == ',') && prev_digit && next_is(|n| n.is_ascii_digit()))
                {
                    i += 1;
                } else {
                    break;
                }
            }
            let word: String = chars[start..i].iter().collect();
            for (k, part) in split_word(&word).into_iter().enumerate() {
                tokens.push(Token::Word { text: part, fixed: None, space: space || k > 0 });
            }
            space = false;
            continue;
        }
        if let Some((sym, _)) = SYMBOLS.iter().find(|(s, _)| s.starts_with(c)) {
            tokens.push(Token::Word { text: (*sym).to_owned(), fixed: None, space: true });
            space = true;
        } else if c == '-' || c == '_' || c == '/' {
            // "made-up", "CPU/GPU": separate words.
            space = true;
        } else if PUNCTS.contains(c) {
            tokens.push(Token::Punct { ch: c, space });
            space = false;
        } else {
            space = true;
        }
        i += 1;
    }
    tokens
}

/// Splits "8M" into "8" and "M", but keeps "21st", "1990s" and "don't" whole.
fn split_word(word: &str) -> Vec<String> {
    if is_number(word) || !word.chars().any(|c| c.is_ascii_digit()) {
        return vec![word.to_owned()];
    }
    let mut parts: Vec<String> = Vec::new();
    for c in word.chars() {
        let digit = c.is_ascii_digit() || c == '.' || c == ',';
        match parts.last_mut() {
            Some(last) if last.chars().last().is_some_and(|l| (l.is_ascii_digit() || l == '.' || l == ',') == digit) => last.push(c),
            _ => parts.push(c.to_string()),
        }
    }
    parts
}

fn parse_link(chars: &[char]) -> Option<(String, String, usize)> {
    let close = chars.iter().position(|&c| c == ']')?;
    if chars.get(close + 1) != Some(&'(') || chars.get(close + 2) != Some(&'/') {
        return None;
    }
    let end = chars[close + 3..].iter().position(|&c| c == ')')? + close + 3;
    let word: String = chars[1..close].iter().collect();
    let phonemes: String = chars[close + 3..end].iter().collect::<String>().trim_end_matches('/').to_owned();
    Some((word, phonemes, end + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stress_rules() {
        assert_eq!(apply_stress("həlˈO", Some(0.5)), "həlˈO");
        assert_eq!(apply_stress("sˈi", Some(0.0)), "sˌi");
        assert_eq!(apply_stress("bɪn", Some(2.0)), "bˈɪn");
        assert_eq!(apply_stress("pˈYnt", Some(-2.0)), "pYnt");
        assert_eq!(restress("ˌtʊ"), "tˌʊ");
    }

    #[test]
    fn suffixes() {
        assert_eq!(suffix_s("kˈæt"), "kˈæts");
        assert_eq!(suffix_s("bˈʌs"), "bˈʌsᵻz");
        assert_eq!(suffix_ed("wˈɔk"), "wˈɔkt");
        assert_eq!(suffix_ed("wˈAt"), "wˈAɾᵻd");
        assert_eq!(suffix_ing("sˈɪt"), "sˈɪɾɪŋ");
    }

    #[test]
    fn tokens() {
        let t = tokenize("Hi, it's 9 MB [Kokoro](/kˈOkəɹˌO/)!");
        let words: Vec<String> = t
            .iter()
            .map(|t| match t {
                Token::Word { text, .. } => text.clone(),
                Token::Punct { ch, .. } => ch.to_string(),
            })
            .collect();
        assert_eq!(words, ["Hi", ",", "it's", "9", "MB", "Kokoro", "!"]);
        assert_eq!(split_word("8M"), ["8", "M"]);
        assert_eq!(split_word("21st"), ["21st"]);
    }
}
