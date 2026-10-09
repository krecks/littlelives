//! The pronunciation dictionary: Misaki's US English gold and silver dictionaries merged into
//! `word<TAB>phonemes` lines by `tools/voice/fetch.mjs`.

use std::collections::HashMap;

pub struct Lexicon {
    words: HashMap<String, String>,
}

impl Lexicon {
    /// Parses `word<TAB>phonemes` lines; other lines are skipped.
    pub fn parse(tsv: &str) -> Self {
        let mut words = HashMap::with_capacity(200_000);
        for line in tsv.lines() {
            if let Some((word, phonemes)) = line.split_once('\t') {
                words.insert(word.to_owned(), phonemes.to_owned());
            }
        }
        Lexicon { words }
    }

    pub fn len(&self) -> usize {
        self.words.len()
    }

    pub fn is_empty(&self) -> bool {
        self.words.is_empty()
    }

    /// Exact entry, or the same word in the other common casing ("hello" / "Hello"), as
    /// Misaki's `grow_dictionary` does for words of two letters or more.
    pub fn get(&self, word: &str) -> Option<&str> {
        if let Some(p) = self.words.get(word) {
            return Some(p);
        }
        if word.chars().count() < 2 {
            return None;
        }
        let lower = word.to_lowercase();
        let capitalized = capitalize(&lower);
        if word == lower && word != capitalized {
            self.words.get(&capitalized).map(String::as_str)
        } else if word == capitalized {
            self.words.get(&lower).map(String::as_str)
        } else {
            None
        }
    }

    pub fn contains(&self, word: &str) -> bool {
        self.get(word).is_some()
    }
}

pub(crate) fn capitalize(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars.flat_map(char::to_lowercase)).collect(),
        None => String::new(),
    }
}
