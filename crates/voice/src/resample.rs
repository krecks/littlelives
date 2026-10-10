//! Voice size (depth) by resampling. The model is run at pitch P/α and speed s/α; reading its
//! output at a step of α then scales every frequency by α (pitch back to P, the formants of the
//! vocal tract by α) and every duration by 1/α (back to the intended length). α < 1 is a larger
//! voice (lower formants), α > 1 a smaller one.
//!
//! Band-limited interpolation with a Kaiser-windowed sinc (16 zero crossings, β = 8: stop band
//! about −80 dB). For α > 1 the cut-off moves down to the new Nyquist frequency, so nothing above
//! it folds back (no aliasing). All arithmetic is f64 with Rust's own maths, so the output is the
//! same on every machine and in every browser.

/// Zero crossings of the sinc on each side, at the cut-off frequency.
const ZERO_CROSSINGS: f64 = 16.0;
const KAISER_BETA: f64 = 8.0;
/// Kernel table resolution: entries per input sample.
const PHASES: usize = 256;
/// Cut-off as a share of the lower Nyquist frequency (the transition band ends below it).
const CUTOFF: f64 = 0.94;

/// `input` read at a step of `depth` (output length `input.len() / depth`, rounded). `depth` 1 returns a copy.
pub fn resample(input: &[f32], depth: f32) -> Vec<f32> {
    let step = depth as f64;
    if input.is_empty() || !(step > 0.0) || (step - 1.0).abs() < 1e-6 {
        return input.to_vec();
    }
    // Cut-off relative to the input's Nyquist frequency.
    let fc = CUTOFF * (1.0 / step).min(1.0);
    // Half-width of the kernel in input samples.
    let half = ZERO_CROSSINGS / fc;
    let taps = half.ceil() as usize;
    let table = kernel(fc, half, taps);
    let out_len = (input.len() as f64 / step).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    let n = input.len() as isize;
    for i in 0..out_len {
        let t = i as f64 * step;
        let centre = t.floor() as isize;
        let lo = (centre - taps as isize + 1).max(0);
        let hi = (centre + taps as isize).min(n - 1);
        let mut acc = 0.0f64;
        for k in lo..=hi {
            let d = (t - k as f64).abs() * PHASES as f64;
            let j = d as usize;
            if j + 1 >= table.len() {
                continue;
            }
            let f = d - j as f64;
            let w = table[j] + (table[j + 1] - table[j]) * f;
            acc += w * input[k as usize] as f64;
        }
        out.push(acc as f32);
    }
    out
}

/// fc·sinc(fc·u)·kaiser(u / half) for u = 0, 1/PHASES, … (one side; the kernel is symmetric).
fn kernel(fc: f64, half: f64, taps: usize) -> Vec<f64> {
    let len = (taps + 1) * PHASES + 2;
    let norm = bessel_i0(KAISER_BETA);
    (0..len)
        .map(|j| {
            let u = j as f64 / PHASES as f64;
            if u >= half {
                return 0.0;
            }
            let x = std::f64::consts::PI * fc * u;
            let sinc = if x == 0.0 { 1.0 } else { x.sin() / x };
            let r = u / half;
            fc * sinc * bessel_i0(KAISER_BETA * (1.0 - r * r).sqrt()) / norm
        })
        .collect()
}

/// The modified Bessel function of the first kind, order 0 (power series).
fn bessel_i0(x: f64) -> f64 {
    let (mut sum, mut term, q) = (1.0, 1.0, x * x / 4.0);
    for k in 1..64 {
        term *= q / (k * k) as f64;
        sum += term;
        if term < sum * 1e-17 {
            break;
        }
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 24_000.0;

    fn sine(freq: f64, n: usize) -> Vec<f32> {
        (0..n).map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / SR).sin() as f32 * 0.5).collect()
    }

    /// Amplitude of `freq` in `x` (a single-bin DFT over the middle, away from the edges).
    fn level(x: &[f32], freq: f64) -> f64 {
        let (a, b) = (x.len() / 4, 3 * x.len() / 4);
        let (mut re, mut im) = (0.0, 0.0);
        for (i, &v) in x[a..b].iter().enumerate() {
            let p = 2.0 * std::f64::consts::PI * freq * (i + a) as f64 / SR;
            re += v as f64 * p.cos();
            im += v as f64 * p.sin();
        }
        2.0 * (re * re + im * im).sqrt() / (b - a) as f64
    }

    #[test]
    fn length_and_identity() {
        let x = sine(440.0, 24_000);
        assert_eq!(resample(&x, 1.0), x);
        assert_eq!(resample(&x, 0.8).len(), 30_000);
        assert_eq!(resample(&x, 1.25).len(), 19_200);
        assert!(resample(&[], 0.85).is_empty());
    }

    #[test]
    fn frequencies_scale_by_depth() {
        let x = sine(1000.0, 24_000);
        for depth in [0.82f32, 0.9, 1.1, 1.15] {
            let y = resample(&x, depth);
            let moved = 1000.0 * depth as f64;
            assert!((level(&y, moved) - 0.5).abs() < 0.01, "depth {depth}: {}", level(&y, moved));
            assert!(level(&y, 1000.0) < 0.01, "depth {depth}: old frequency left");
        }
    }

    #[test]
    fn no_aliasing_when_made_smaller() {
        // 11.5 kHz read at a step of 1.15 would land at 13.2 kHz, above Nyquist (12 kHz); it must
        // be filtered out, not fold back to 10.8 kHz.
        let x = sine(11_500.0, 24_000);
        let y = resample(&x, 1.15);
        let folded = SR - 11_500.0 * 1.15;
        assert!(level(&y, folded) < 0.5 * 1e-3, "aliased: {}", level(&y, folded));
        // And speech-band content passes unchanged.
        let y = resample(&sine(3000.0, 24_000), 1.15);
        assert!((level(&y, 3450.0) - 0.5).abs() < 0.01);
    }

    #[test]
    fn deterministic() {
        let x: Vec<f32> = (0..5000).map(|i| ((i * 7919 % 1000) as f32 / 500.0) - 1.0).collect();
        assert_eq!(resample(&x, 0.85), resample(&x, 0.85));
    }
}
