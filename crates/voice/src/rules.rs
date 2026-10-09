//! Letter-to-sound guesses for words the dictionary doesn't know (mostly residents' names),
//! written straight in Misaki's phoneme alphabet. Simple on purpose: names are usually in the
//! dictionary, and hand-written lines are checked to never reach this.

/// Misaki's vowel symbols (A I O W Y are the diphthongs eɪ aɪ oʊ aʊ ɔɪ).
pub const VOWELS: &str = "AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ";

fn is_vowel_letter(c: u8) -> bool {
    matches!(c, b'a' | b'e' | b'i' | b'o' | b'u' | b'y')
}

/// A pronunciation for an unknown word of ASCII letters, stressed on the first syllable.
/// Empty if the word has no letters.
pub fn guess(word: &str) -> String {
    let w: Vec<u8> = word.bytes().filter(u8::is_ascii_alphabetic).map(|c| c.to_ascii_lowercase()).collect();
    if w.is_empty() {
        return String::new();
    }
    let n = w.len();
    let at = |i: usize| w.get(i).copied();
    let rest = |i: usize, s: &str| w[i..].starts_with(s.as_bytes());
    // "Magic e": vowel, one consonant, final "e" (Jane, Pete, Mike, Rose, June).
    let magic = |i: usize| i + 3 == n && at(i + 2) == Some(b'e') && at(i + 1).is_some_and(|c| !is_vowel_letter(c));
    // Open syllable: vowel, one consonant, vowel (Lara, Kokoro, Mina, Ruben).
    let open = |i: usize| at(i + 1).is_some_and(|c| !is_vowel_letter(c)) && at(i + 2).is_some_and(is_vowel_letter);
    let mut out = String::new();
    let mut i = 0;
    while i < n {
        let c = w[i];
        let start = i == 0;
        let end = |len: usize| i + len == n;
        // Doubled consonants sound once.
        if i > 0 && c == w[i - 1] && !is_vowel_letter(c) {
            i += 1;
            continue;
        }
        let (sound, len): (&str, usize) = if rest(i, "tch") {
            ("ʧ", 3)
        } else if rest(i, "sch") {
            ("sk", 3)
        } else if rest(i, "igh") {
            ("I", 3)
        } else if rest(i, "ch") {
            ("ʧ", 2)
        } else if rest(i, "sh") {
            ("ʃ", 2)
        } else if rest(i, "th") {
            ("θ", 2)
        } else if rest(i, "ph") {
            ("f", 2)
        } else if rest(i, "gh") {
            (if start { "ɡ" } else { "" }, 2)
        } else if rest(i, "ck") {
            ("k", 2)
        } else if rest(i, "ng") && !w.get(i + 2).is_some_and(|&c| is_vowel_letter(c)) {
            ("ŋ", 2)
        } else if rest(i, "nk") {
            ("ŋk", 2)
        } else if rest(i, "qu") {
            ("kw", 2)
        } else if rest(i, "wh") {
            ("w", 2)
        } else if start && rest(i, "kn") {
            ("n", 2)
        } else if start && rest(i, "wr") {
            ("ɹ", 2)
        } else if rest(i, "dg") {
            ("ʤ", 2)
        } else if rest(i, "ee") || rest(i, "ea") {
            ("i", 2)
        } else if rest(i, "ie") {
            ("i", 2)
        } else if rest(i, "ey") && end(2) {
            ("i", 2)
        } else if rest(i, "ei") || rest(i, "ey") || rest(i, "ai") || rest(i, "ay") {
            ("A", 2)
        } else if rest(i, "oa") {
            ("O", 2)
        } else if rest(i, "oo") {
            ("u", 2)
        } else if rest(i, "ou") {
            ("W", 2)
        } else if rest(i, "ow") {
            (if end(2) { "O" } else { "W" }, 2)
        } else if rest(i, "oi") || rest(i, "oy") {
            ("Y", 2)
        } else if rest(i, "au") || rest(i, "aw") {
            ("ɔ", 2)
        } else if rest(i, "ue") || rest(i, "ui") || rest(i, "eu") {
            ("u", 2)
        } else if rest(i, "ar") && !w.get(i + 2).is_some_and(|&c| is_vowel_letter(c)) {
            ("ɑɹ", 2)
        } else if rest(i, "or") && !w.get(i + 2).is_some_and(|&c| is_vowel_letter(c)) {
            ("ɔɹ", 2)
        } else if (rest(i, "er") || rest(i, "ir") || rest(i, "ur") || rest(i, "yr"))
            && !w.get(i + 2).is_some_and(|&c| is_vowel_letter(c))
        {
            ("ɜɹ", 2)
        } else {
            let next = at(i + 1);
            let soft = next.is_some_and(|c| matches!(c, b'e' | b'i' | b'y'));
            let sound = match c {
                b'a' if magic(i) => "A",
                b'e' if magic(i) => "i",
                b'i' if magic(i) => "I",
                b'o' if magic(i) => "O",
                b'u' if magic(i) => "u",
                // Silent final e after a consonant (but not in "Kate" handled above, nor "be").
                b'e' if end(1) && n > 2 => "",
                b'a' if end(1) => "ə",
                b'i' if end(1) => "i",
                b'o' if end(1) => "O",
                b'u' if end(1) => "u",
                b'y' if start => "j",
                b'y' if end(1) => "i",
                b'a' if open(i) => "ɑ",
                b'o' if open(i) => "O",
                b'i' if open(i) => "i",
                b'u' if open(i) => "u",
                b'a' => "æ",
                b'e' => "ɛ",
                b'i' | b'y' => "ɪ",
                b'o' => "ɑ",
                b'u' => "ʌ",
                b'c' => {
                    if soft {
                        "s"
                    } else {
                        "k"
                    }
                }
                b'g' => {
                    if next == Some(b'e') && i + 2 == n {
                        "ʤ"
                    } else {
                        "ɡ"
                    }
                }
                b'h' => {
                    if i > 0 && end(1) {
                        ""
                    } else {
                        "h"
                    }
                }
                b'j' => "ʤ",
                b'q' => "k",
                b'r' => "ɹ",
                b's' => {
                    let between = i > 0 && is_vowel_letter(w[i - 1]) && next.is_some_and(is_vowel_letter);
                    if between { "z" } else { "s" }
                }
                b'x' => {
                    if start {
                        "z"
                    } else {
                        "ks"
                    }
                }
                b'b' => "b",
                b'd' => "d",
                b'f' => "f",
                b'k' => "k",
                b'l' => "l",
                b'm' => "m",
                b'n' => "n",
                b'p' => "p",
                b't' => "t",
                b'v' => "v",
                b'w' => "w",
                b'z' => "z",
                _ => "",
            };
            (sound, 1)
        };
        out.push_str(sound);
        i += len;
    }
    stress_first_syllable(&out)
}

/// Primary stress before the first vowel; later short vowels reduce to schwa ("Jonas" → ʤˈɑnəs).
fn stress_first_syllable(ps: &str) -> String {
    let mut out = String::with_capacity(ps.len() + 2);
    let mut stressed = false;
    for c in ps.chars() {
        if VOWELS.contains(c) {
            if !stressed {
                out.push('ˈ');
                stressed = true;
                out.push(c);
                continue;
            }
            out.push(if matches!(c, 'æ' | 'ʌ' | 'ɑ' | 'ɛ') { 'ə' } else { c });
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::guess;

    #[test]
    fn plausible_names() {
        assert_eq!(guess("Jonas"), "ʤˈOnəs");
        assert_eq!(guess("Kate"), "kˈAt");
        assert_eq!(guess("Paradee"), "pˈɑɹədi");
        assert_eq!(guess("Kokoro"), "kˈOkOɹO");
        assert_eq!(guess("Thorne"), "θˈɔɹn");
        assert_eq!(guess(""), "");
    }
}
