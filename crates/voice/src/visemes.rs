//! Mouth shapes for a line of speech. KittenTTS gives audio only (no durations), so the track is
//! made from the line's Misaki phonemes and the finished clip: each phoneme becomes one of the 15
//! Oculus/Meta visemes with a weight for how long it usually lasts, the weights are spread over
//! the clip's voiced span, and pauses (commas, sentence ends) are moved onto the quiet gaps the
//! model actually left. A 100 Hz loudness envelope goes along, for how wide the mouth opens.
//!
//! All of it runs on the final samples (trimmed and resampled, see [`crate::ModelInputs::finish`]),
//! so the times are the clip's own.

/// The visemes in index order (Oculus/Meta's set).
pub const VISEMES: [&str; 15] = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];

pub const SIL: u8 = 0;
const PP: u8 = 1;
const FF: u8 = 2;
const TH: u8 = 3;
const DD: u8 = 4;
const KK: u8 = 5;
const CH: u8 = 6;
const SS: u8 = 7;
const NN: u8 = 8;
const RR: u8 = 9;
const AA: u8 = 10;
const E: u8 = 11;
const I: u8 = 12;
const O: u8 = 13;
const U: u8 = 14;

/// Relative durations by kind of sound.
const VOWEL: f32 = 1.0;
const PRIMARY_STRESS: f32 = 1.3;
const SECONDARY_STRESS: f32 = 1.15;
const DIPHTHONG_HALF: f32 = 0.6;
/// Misaki's `ᵊ`: the short schwa of "button", "little".
const SMALL_SCHWA: f32 = 0.5;
const PLOSIVE: f32 = 0.55;
const FRICATIVE: f32 = 0.8;
const NASAL_LIQUID: f32 = 0.6;
const GLIDE: f32 = 0.5;
/// `ː` lengthens the sound before it.
const LONG: f32 = 1.4;
const WORD_GAP: f32 = 0.15;
const COMMA: f32 = 1.5;
const SENTENCE_END: f32 = 2.5;

/// Analysis frames: 10 ms. A frame is voiced when its RMS is over 5 % of the loudest frame's
/// (as `kitten::trim` decides what to keep).
const FRAMES_PER_SECOND: u32 = 100;
const VOICED: f32 = 0.05;
/// A pause can land on a gap: frames under 8 % of the line's 95th percentile, 40 ms or more.
const GAP_LEVEL: f32 = 0.08;
const MIN_GAP_FRAMES: usize = 4;
/// How far a pause's ends may move to meet a gap (seconds).
const MAX_SHIFT: f64 = 0.12;
/// Shortest segment after moving (seconds).
const MIN_SEGMENT: f64 = 0.01;

/// Mouth shapes over a clip: segment `i` shows `visemes[i]` from `times[i]` to `times[i + 1]`
/// (seconds from the clip's start; before the first and after the last time the mouth rests).
/// `energy`: loudness every 10 ms from the clip's start, 0..1.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct VisemeTrack {
    /// Segment starts and the last segment's end (`visemes.len() + 1` of them; empty when there
    /// are no segments).
    pub times: Vec<f32>,
    pub visemes: Vec<u8>,
    pub energy: Vec<f32>,
}

impl VisemeTrack {
    /// One array for JavaScript: `[segments, energy frames, times…, visemes…, energy…]`.
    pub fn flat(&self) -> Vec<f32> {
        let mut out = Vec::with_capacity(2 + self.times.len() + self.visemes.len() + self.energy.len());
        out.push(self.visemes.len() as f32);
        out.push(self.energy.len() as f32);
        out.extend(&self.times);
        out.extend(self.visemes.iter().map(|&v| v as f32));
        out.extend(&self.energy);
        out
    }

    /// Reads [`Self::flat`] back (None when it doesn't add up).
    pub fn from_flat(flat: &[f32]) -> Option<VisemeTrack> {
        let (&n, rest) = flat.split_first()?;
        let (&e, rest) = rest.split_first()?;
        let (n, e) = (n as usize, e as usize);
        let t = if n > 0 { n + 1 } else { 0 };
        if rest.len() != t + n + e {
            return None;
        }
        Some(VisemeTrack {
            times: rest[..t].to_vec(),
            visemes: rest[t..t + n].iter().map(|&v| v as u8).collect(),
            energy: rest[t + n..].to_vec(),
        })
    }
}

/// One viseme with its relative duration; `pause`: from punctuation (moved onto quiet gaps).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub viseme: u8,
    pub weight: f32,
    pub pause: bool,
}

/// What a phoneme symbol is.
enum Sound {
    /// A vowel, or the two halves of a diphthong.
    Vowel(u8),
    Diphthong(u8, u8),
    Consonant(u8, f32),
    /// `h`: shaped like the vowel after it.
    H,
    Stress(f32),
    Long,
    Space,
    Pause(f32),
    /// Quotes and brackets: nothing to say.
    Silent,
    Unknown,
}

fn sound(c: char) -> Sound {
    use Sound::*;
    match c {
        'ɑ' | 'a' | 'æ' | 'ʌ' | 'ɐ' | 'ɒ' => Vowel(AA),
        'e' | 'ɛ' | 'ə' | 'ɚ' | 'ɜ' | 'ɝ' | 'ᵊ' => Vowel(E),
        'i' | 'ɪ' | 'ᵻ' | 'ɨ' => Vowel(I),
        'o' | 'ɔ' => Vowel(O),
        'u' | 'ʊ' => Vowel(U),
        'A' => Diphthong(E, I),
        'I' => Diphthong(AA, I),
        'W' => Diphthong(AA, U),
        'Y' => Diphthong(O, I),
        'O' => Diphthong(O, U),
        // British "go" (əʊ).
        'Q' => Diphthong(E, U),
        'p' | 'b' => Consonant(PP, PLOSIVE),
        'm' => Consonant(PP, NASAL_LIQUID),
        'f' | 'v' => Consonant(FF, FRICATIVE),
        'θ' | 'ð' => Consonant(TH, FRICATIVE),
        // `T`: Misaki's flap (ɾ); `ʔ` is written t.
        't' | 'd' | 'T' | 'ɾ' | 'ʔ' => Consonant(DD, PLOSIVE),
        'k' | 'ɡ' | 'g' => Consonant(KK, PLOSIVE),
        'ŋ' => Consonant(KK, NASAL_LIQUID),
        'x' | 'ç' => Consonant(KK, FRICATIVE),
        'ʃ' | 'ʒ' | 'ʧ' | 'ʤ' => Consonant(CH, FRICATIVE),
        's' | 'z' => Consonant(SS, FRICATIVE),
        'n' | 'l' | 'ɫ' => Consonant(NN, NASAL_LIQUID),
        'ɹ' | 'r' => Consonant(RR, NASAL_LIQUID),
        'w' => Consonant(U, GLIDE),
        'j' => Consonant(I, GLIDE),
        'h' => H,
        'ˈ' => Stress(PRIMARY_STRESS),
        'ˌ' => Stress(SECONDARY_STRESS),
        'ː' => Long,
        c if c.is_whitespace() => Space,
        ',' | ';' | ':' | '—' | '-' => Pause(COMMA),
        '.' | '!' | '?' | '…' => Pause(SENTENCE_END),
        '"' | '“' | '”' | '(' | ')' | '\'' => Silent,
        _ => Unknown,
    }
}

/// The phoneme symbols with no viseme (they are shown as E).
pub fn unknown_symbols(phonemes: &str) -> String {
    phonemes.chars().filter(|&c| matches!(sound(c), Sound::Unknown)).collect()
}

/// The segments for a line of Misaki phonemes, without pauses at either end. Neighbours with the
/// same viseme are joined.
pub fn segments(phonemes: &str) -> Vec<Segment> {
    let chars: Vec<char> = phonemes.chars().collect();
    let mut out: Vec<Segment> = Vec::new();
    let mut stress = 1.0;
    fn push(out: &mut Vec<Segment>, viseme: u8, weight: f32, pause: bool) {
        match out.last_mut() {
            Some(last) if last.viseme == SIL && viseme == SIL => {
                last.weight = last.weight.max(weight);
                last.pause |= pause;
            }
            Some(last) if last.viseme == viseme => last.weight += weight,
            _ => out.push(Segment { viseme, weight, pause }),
        }
    }
    for (i, &c) in chars.iter().enumerate() {
        match sound(c) {
            Sound::Vowel(v) => {
                push(&mut out, v, if c == 'ᵊ' { SMALL_SCHWA } else { VOWEL * stress }, false);
                stress = 1.0;
            }
            Sound::Diphthong(a, b) => {
                push(&mut out, a, DIPHTHONG_HALF * stress, false);
                push(&mut out, b, DIPHTHONG_HALF * stress, false);
                stress = 1.0;
            }
            Sound::Consonant(v, w) => push(&mut out, v, w, false),
            Sound::H => {
                // The vowel after it in the word, else a slightly open mouth.
                let next = chars[i + 1..].iter().find_map(|&n| match sound(n) {
                    Sound::Stress(_) | Sound::Long => None,
                    Sound::Vowel(v) | Sound::Diphthong(v, _) => Some(Some(v)),
                    _ => Some(None),
                });
                push(&mut out, next.flatten().unwrap_or(E), GLIDE, false);
            }
            Sound::Stress(s) => stress = s,
            Sound::Long => {
                if let Some(last) = out.last_mut().filter(|l| l.viseme != SIL) {
                    last.weight *= LONG;
                }
            }
            Sound::Space => {
                push(&mut out, SIL, WORD_GAP, false);
                stress = 1.0;
            }
            Sound::Pause(w) => {
                push(&mut out, SIL, w, true);
                stress = 1.0;
            }
            Sound::Silent => {}
            Sound::Unknown => push(&mut out, E, VOWEL, false),
        }
    }
    while out.last().is_some_and(|s| s.viseme == SIL) {
        out.pop();
    }
    let lead = out.iter().take_while(|s| s.viseme == SIL).count();
    out.drain(..lead);
    out
}

/// The track for a clip (`samples` at `sample_rate`) saying `phonemes` (Misaki's, as from
/// [`crate::G2p::phonemize`]).
pub fn track(phonemes: &str, samples: &[f32], sample_rate: u32) -> VisemeTrack {
    let frame = (sample_rate / FRAMES_PER_SECOND).max(1) as usize;
    let rms: Vec<f32> = samples.chunks(frame).map(|f| (f.iter().map(|x| x * x).sum::<f32>() / f.len() as f32).sqrt()).collect();
    let loudest = rms.iter().copied().fold(0.0, f32::max);
    let voiced = |r: &f32| loudest > 0.0 && *r > loudest * VOICED;
    let (Some(first), Some(last)) = (rms.iter().position(voiced), rms.iter().rposition(voiced)) else {
        return VisemeTrack { energy: vec![0.0; rms.len()], ..VisemeTrack::default() };
    };

    // Loudness against the line's 95th percentile (its voiced part).
    let p95 = percentile(&rms[first..=last], 0.95, loudest).max(loudest * VOICED);
    let energy: Vec<f32> = rms.iter().map(|r| (r / p95).min(1.0)).collect();

    let segs = segments(phonemes);
    if segs.is_empty() {
        return VisemeTrack { energy, ..VisemeTrack::default() };
    }
    let rate = sample_rate as f64;
    let start = (first * frame) as f64 / rate;
    let end = (((last + 1) * frame).min(samples.len())) as f64 / rate;
    let total: f64 = segs.iter().map(|s| s.weight as f64).sum();
    let mut bounds = Vec::with_capacity(segs.len() + 1);
    let mut at = 0.0;
    bounds.push(start);
    for s in &segs {
        at += s.weight as f64;
        bounds.push(start + (end - start) * at / total);
    }
    let gaps = quiet_gaps(&rms[first..=last], p95 * GAP_LEVEL)
        .into_iter()
        .map(|(a, b)| (((first + a) * frame) as f64 / rate, (((first + b) * frame).min(samples.len())) as f64 / rate))
        .collect::<Vec<_>>();
    let bounds = snap_pauses(&segs, &bounds, &gaps);
    VisemeTrack { times: bounds.iter().map(|&t| t as f32).collect(), visemes: segs.iter().map(|s| s.viseme).collect(), energy }
}

/// The `q` quantile of `xs` (all within 0..=`max`), by bisection (small in WASM, unlike a sort).
fn percentile(xs: &[f32], q: f32, max: f32) -> f32 {
    // The smallest value with at least `q` of the frames at or below it.
    let need = ((xs.len() - 1) as f32 * q).round() as usize + 1;
    let (mut lo, mut hi) = (0.0f32, max);
    for _ in 0..32 {
        let mid = (lo + hi) / 2.0;
        if xs.iter().filter(|&&x| x <= mid).count() >= need {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    hi
}

/// Runs of quiet frames, `MIN_GAP_FRAMES` or longer: (first frame, frame after the last).
fn quiet_gaps(rms: &[f32], level: f32) -> Vec<(usize, usize)> {
    let mut gaps = Vec::new();
    let mut run = None;
    for (i, &r) in rms.iter().chain([f32::INFINITY].iter()).enumerate() {
        match (r < level, run) {
            (true, None) => run = Some(i),
            (false, Some(a)) => {
                if i - a >= MIN_GAP_FRAMES {
                    gaps.push((a, i));
                }
                run = None;
            }
            _ => {}
        }
    }
    gaps
}

/// Moves each pause onto the nearest quiet gap (each end by at most `MAX_SHIFT`), and spreads
/// the segments between pauses evenly over what is left.
fn snap_pauses(segs: &[Segment], bounds: &[f64], gaps: &[(f64, f64)]) -> Vec<f64> {
    let n = segs.len();
    // (boundary index, new time), in order; the ends stay.
    let mut anchors = vec![(0, bounds[0])];
    for (k, s) in segs.iter().enumerate() {
        if !s.pause {
            continue;
        }
        let (a, b) = (bounds[k], bounds[k + 1]);
        let centre = (a + b) / 2.0;
        let near = gaps
            .iter()
            .filter(|(ga, gb)| *gb > a - MAX_SHIFT && *ga < b + MAX_SHIFT)
            .min_by(|x, y| ((x.0 + x.1) / 2.0 - centre).abs().total_cmp(&((y.0 + y.1) / 2.0 - centre).abs()));
        let Some(&(ga, gb)) = near else { continue };
        let (prev_k, prev_t) = *anchors.last().unwrap();
        if k <= prev_k {
            continue;
        }
        let new_a = ga.max(a - MAX_SHIFT).min(a + MAX_SHIFT).max(prev_t + MIN_SEGMENT * (k - prev_k) as f64);
        let new_b = gb.max(b - MAX_SHIFT).min(b + MAX_SHIFT).min(bounds[n] - MIN_SEGMENT * (n - k - 1) as f64);
        if new_b - new_a < MIN_SEGMENT {
            continue;
        }
        anchors.push((k, new_a));
        anchors.push((k + 1, new_b));
    }
    anchors.push((n, bounds[n]));
    let mut out = bounds.to_vec();
    for pair in anchors.windows(2) {
        let ((k0, t0), (k1, t1)) = (pair[0], pair[1]);
        let (b0, b1) = (bounds[k0], bounds[k1]);
        for k in k0..=k1 {
            out[k] = if k1 == k0 { t0 } else { t0 + (bounds[k] - b0) / (b1 - b0) * (t1 - t0) };
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diphthongs_split_and_h_takes_the_next_vowel() {
        let v = |ps: &str| segments(ps).iter().map(|s| VISEMES[s.viseme as usize]).collect::<Vec<_>>().join(" ");
        assert_eq!(v("hˈI"), "aa I");
        assert_eq!(v("nˈO"), "nn O U");
        assert_eq!(v("ðə kˈæt, sˈæt."), "TH E sil kk aa DD sil SS aa DD");
        assert_eq!(v("“mˈi”"), "PP I");
        let s = segments("bˈæt bæt");
        assert_eq!(s[1].weight, PRIMARY_STRESS);
        assert_eq!(s[5].weight, VOWEL);
        assert!(segments(", . ").is_empty());
    }
}
