//! A timing skeleton of Paradee's decoder + generator (iSTFTNet) with the real layer shapes
//! and random weights: every conv, transposed conv (as polyphase convs), AdaIN (instance-norm
//! statistics + affine), Snake, LeakyReLU, residual add and the source/iSTFT work of the
//! real graph, in the order the graph runs them. It is not numerically Paradee; it is what a
//! hand-written engine would execute, so its time is a grounded estimate of the engine's.
//!
//! Shapes (F = duration frames, 600 samples each; see the ORT profile):
//! decoder at F: encode 514->256, decode.0-2 322->256, decode.3 322->128 at 2F
//! generator: ups.0 128->64 (k20 s10) to 20F; 3 resblocks 64ch k3/7/11 d1,3,5; noise_res.0 64ch k7
//!            ups.1 64->32 (k12 s6) to 120F; 3 resblocks 32ch k3/7/11; noise_res.1 32ch k11
//!            conv_post 32->22 k7; iSTFT n_fft 20 hop 5 -> 600F samples

use crate::Case;

/// Activations `[c][halo + t + halo + slack]`, zero halo so convs read padding for free.
pub struct Act {
    pub c: usize,
    pub t: usize,
    pub stride: usize,
    pub data: Vec<f32>,
}

pub const HALO: usize = 32;

impl Act {
    pub fn new(c: usize, t: usize) -> Act {
        let t = t.div_ceil(16) * 16;
        let stride = HALO + t + HALO + 32;
        Act { c, t, stride, data: vec![0.0; c * stride] }
    }
    fn row(&self, ch: usize) -> &[f32] {
        &self.data[ch * self.stride + HALO..ch * self.stride + HALO + self.t]
    }
    fn row_mut(&mut self, ch: usize) -> &mut [f32] {
        &mut self.data[ch * self.stride + HALO..ch * self.stride + HALO + self.t]
    }
}

pub struct Rng(u32);
impl Rng {
    fn w(&mut self, n: usize, scale: f32) -> Vec<f32> {
        (0..n)
            .map(|_| {
                self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
                (((self.0 >> 8) as f32 / (1u32 << 24) as f32) - 0.5) * scale
            })
            .collect()
    }
}

/// A conv layer with weights packed for the 4x4 kernel.
pub struct Conv {
    case: Case,
    wp: Vec<f32>,
    b: Vec<f32>,
}

impl Conv {
    fn new(rng: &mut Rng, cin: usize, cout: usize, k: usize, d: usize) -> Conv {
        let cout4 = cout.div_ceil(4) * 4;
        let case = Case { name: "", cin, cout: cout4, k, d, t: 0 };
        let w = rng.w(cout4 * cin * k, 1.0 / ((cin * k) as f32).sqrt());
        Conv { wp: crate::pack(&case, &w, 4), b: rng.w(cout4, 0.1), case }
    }

    /// y = conv(x) ("same" padding), x and y share the time length.
    fn run(&self, x: &Act, y: &mut Act) {
        let pad = (self.case.k - 1) * self.case.d / 2;
        assert!(pad <= HALO && y.t == x.t && x.c == self.case.cin && y.c >= self.case.cout.min(y.c));
        let c = Case { t: x.t, ..self.case };
        let x_off = &x.data[HALO - pad..];
        let mut tmp = vec![0f32; c.cout * c.t];
        conv_any(&c, x_off, x.stride, &self.wp, &self.b, &mut tmp);
        for ch in 0..y.c.min(c.cout) {
            y.row_mut(ch).copy_from_slice(&tmp[ch * c.t..(ch + 1) * c.t]);
        }
    }
}

fn conv_any(c: &Case, x: &[f32], xs: usize, wp: &[f32], b: &[f32], y: &mut [f32]) {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        crate::simd::conv::<4, 4>(c, x, xs, wp, b, y)
    }
    #[cfg(not(target_arch = "wasm32"))]
    crate::conv_portable::<4, 4>(c, x, xs, wp, b, y)
}

/// Instance-norm statistics per channel, then (1+γ)·x̂+β and an activation, into `y`.
fn adain_act(x: &Act, y: &mut Act, gamma: &[f32], beta: &[f32], alpha: Option<&[f32]>) {
    let n = x.t as f32;
    for ch in 0..x.c {
        let r = x.row(ch);
        let mean = r.iter().sum::<f32>() / n;
        let var = r.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / n;
        let g = (1.0 + gamma[ch]) / (var + 1e-5).sqrt();
        let bb = beta[ch] - mean * g;
        let out = y.row_mut(ch);
        out.copy_from_slice(r);
        for v in out.iter_mut() {
            *v = *v * g + bb;
        }
        match alpha {
            #[cfg(target_arch = "wasm32")]
            Some(a) => unsafe { crate::simd::snake(out, a[ch]) },
            #[cfg(not(target_arch = "wasm32"))]
            Some(a) => crate::snake_scalar(out, a[ch]),
            None => out.iter_mut().for_each(|v| *v = if *v > 0.0 { *v } else { 0.2 * *v }),
        }
    }
}

fn sin_slice(x: &mut [f32]) {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        crate::simd::sin_slice(x)
    }
    #[cfg(not(target_arch = "wasm32"))]
    x.iter_mut().for_each(|v| *v = v.sin());
}

fn add_into(acc: &mut Act, x: &Act, scale: f32) {
    for ch in 0..acc.c {
        let src = x.row(ch).to_vec();
        for (a, b) in acc.row_mut(ch).iter_mut().zip(src) {
            *a = (*a + b) * scale;
        }
    }
}

/// Kokoro's AdaINResBlock1: three (adain, snake, dilated conv, adain, snake, conv) pairs.
struct ResBlock1 {
    convs: Vec<(Conv, Conv)>,
    g: Vec<f32>,
    a: Vec<f32>,
}

impl ResBlock1 {
    fn new(rng: &mut Rng, ch: usize, k: usize) -> Self {
        let convs = [1, 3, 5].iter().map(|&d| (Conv::new(rng, ch, ch, k, d), Conv::new(rng, ch, ch, k, 1))).collect();
        ResBlock1 { convs, g: rng.w(ch, 0.2), a: rng.w(ch, 0.5).iter().map(|v| v + 1.0).collect() }
    }
    fn run(&self, x: &Act) -> Act {
        let mut x = Act { c: x.c, t: x.t, stride: x.stride, data: x.data.clone() };
        let mut t1 = Act::new(x.c, x.t);
        let mut t2 = Act::new(x.c, x.t);
        for (c1, c2) in &self.convs {
            adain_act(&x, &mut t1, &self.g, &self.g, Some(&self.a));
            c1.run(&t1, &mut t2);
            adain_act(&t2, &mut t1, &self.g, &self.g, Some(&self.a));
            c2.run(&t1, &mut t2);
            add_into(&mut x, &t2, 1.0);
        }
        x
    }
}

/// Transposed conv (kernel k, stride s) as s polyphase convs of k/s taps.
struct Up {
    phases: Vec<Conv>,
    s: usize,
}

impl Up {
    fn new(rng: &mut Rng, cin: usize, cout: usize, k: usize, s: usize) -> Self {
        Up { phases: (0..s).map(|_| Conv::new(rng, cin, cout, k / s, 1)).collect(), s }
    }
    fn run(&self, x: &Act, cout: usize) -> Act {
        let mut y = Act::new(cout, x.t * self.s);
        let mut tmp = Act::new(cout, x.t);
        for (p, conv) in self.phases.iter().enumerate() {
            conv.run(x, &mut tmp);
            for ch in 0..cout {
                let src = tmp.row(ch).to_vec();
                let dst = y.row_mut(ch);
                for (i, v) in src.iter().enumerate() {
                    if i * self.s + p < dst.len() {
                        dst[i * self.s + p] = *v;
                    }
                }
            }
        }
        y
    }
}

/// Kokoro's AdainResBlk1d (decoder): adain, leaky, conv k3, adain, leaky, conv k3, + 1x1 shortcut.
struct ResBlk1d {
    c1: Conv,
    c2: Conv,
    sc: Conv,
    g: Vec<f32>,
}

impl ResBlk1d {
    fn new(rng: &mut Rng, cin: usize, cout: usize) -> Self {
        ResBlk1d { c1: Conv::new(rng, cin, cout, 3, 1), c2: Conv::new(rng, cout, cout, 3, 1), sc: Conv::new(rng, cin, cout, 1, 1), g: rng.w(cin.max(cout), 0.2) }
    }
    fn run(&self, x: &Act, cout: usize) -> Act {
        let mut t1 = Act::new(x.c, x.t);
        adain_act(x, &mut t1, &self.g, &self.g, None);
        let mut t2 = Act::new(cout, x.t);
        self.c1.run(&t1, &mut t2);
        let mut t3 = Act::new(cout, x.t);
        adain_act(&t2, &mut t3, &self.g, &self.g, None);
        self.c2.run(&t3, &mut t2);
        let mut sc = Act::new(cout, x.t);
        self.sc.run(x, &mut sc);
        add_into(&mut t2, &sc, std::f32::consts::FRAC_1_SQRT_2);
        t2
    }
}

pub struct Skeleton {
    encode: ResBlk1d,
    decode: Vec<ResBlk1d>,
    decode3: ResBlk1d,
    ups0: Up,
    ups1: Up,
    noise_conv0: Conv,
    noise_conv1: Conv,
    noise_res0: ResBlock1,
    noise_res1: ResBlock1,
    res: Vec<ResBlock1>,
    post: Conv,
}

impl Default for Skeleton {
    fn default() -> Self {
        Self::new()
    }
}

impl Skeleton {
    pub fn new() -> Self {
        let r = &mut Rng(42);
        Skeleton {
            encode: ResBlk1d::new(r, 514, 256),
            decode: (0..3).map(|_| ResBlk1d::new(r, 322, 256)).collect(),
            decode3: ResBlk1d::new(r, 322, 128),
            ups0: Up::new(r, 128, 64, 20, 10),
            ups1: Up::new(r, 64, 32, 12, 6),
            // stride-6 k12 conv over 22 source channels == k2 conv over 6x22 polyphase channels
            noise_conv0: Conv::new(r, 132, 64, 2, 1),
            noise_conv1: Conv::new(r, 22, 32, 1, 1),
            noise_res0: ResBlock1::new(r, 64, 7),
            noise_res1: ResBlock1::new(r, 32, 11),
            res: vec![
                ResBlock1::new(r, 64, 3),
                ResBlock1::new(r, 64, 7),
                ResBlock1::new(r, 64, 11),
                ResBlock1::new(r, 32, 3),
                ResBlock1::new(r, 32, 7),
                ResBlock1::new(r, 32, 11),
            ],
            post: Conv::new(r, 32, 22, 7, 1),
        }
    }

    /// Runs decoder + generator for `frames` duration frames; returns ms per stage via `now`.
    pub fn run(&self, frames: usize, now: &dyn Fn() -> f64) -> [f64; 4] {
        let t0 = now();
        // ---- decoder at F (and 2F for the last block)
        let x = Act::new(514, frames);
        let mut x = self.encode.run(&x, 256);
        for d in &self.decode {
            let mut inp = Act::new(322, frames);
            for ch in 0..256 {
                inp.row_mut(ch).copy_from_slice(x.row(ch));
            }
            x = d.run(&inp, 256);
        }
        let inp = Act::new(322, frames * 2);
        let x = self.decode3.run(&inp, 128);
        let t1 = now();
        // ---- source: 9 harmonics at 24 kHz, its STFT (n_fft 20, hop 5) -> 22 ch at 120F
        let n24 = frames * 600;
        let mut ph = vec![0f32; 9 * n24];
        let mut phase = 0f32;
        for i in 0..n24 {
            phase += 0.01 + (i % 300) as f32 * 1e-6;
            for h in 0..9 {
                ph[h * n24 + i] = phase * (h + 1) as f32;
            }
        }
        sin_slice(&mut ph);
        let mut src = vec![0f32; n24 + 20];
        for h in 0..9 {
            for (s, v) in src.iter_mut().zip(&ph[h * n24..(h + 1) * n24]) {
                *s += v * 0.1;
            }
        }
        let basis: Vec<f32> = (0..22 * 20).map(|i| ((i / 20 * (i % 20)) as f32 * 0.1).cos()).collect();
        let mut har = Act::new(22, frames * 120);
        for f in 0..frames * 120 {
            let frame = &src[f * 5..f * 5 + 20];
            for b in 0..22 {
                let acc: f32 = basis[b * 20..b * 20 + 20].iter().zip(frame).map(|(p, q)| p * q).sum();
                har.row_mut(b)[f] = acc;
            }
        }
        let t2 = now();
        // ---- generator stage 0 (20F, 64 ch)
        let mut xs = Act::new(64, frames * 20);
        let poly = Act::new(132, frames * 20);
        self.noise_conv0.run(&poly, &mut xs);
        let xs = self.noise_res0.run(&xs);
        let mut x = self.ups0.run(&x, 64);
        add_into(&mut x, &xs, 1.0);
        let mut sum = Act::new(64, x.t);
        for r in &self.res[..3] {
            add_into(&mut sum, &r.run(&x), 1.0);
        }
        // ---- stage 1 (120F, 32 ch)
        let mut xs = Act::new(32, frames * 120);
        self.noise_conv1.run(&har, &mut xs);
        let xs = self.noise_res1.run(&xs);
        let mut x = self.ups1.run(&sum, 32);
        add_into(&mut x, &xs, 1.0);
        let mut sum = Act::new(32, x.t);
        for r in &self.res[3..] {
            add_into(&mut sum, &r.run(&x), 1.0 / 3.0);
        }
        let mut post = Act::new(22, sum.t);
        self.post.run(&sum, &mut post);
        // ---- iSTFT: exp(mag) and sin(phase), 11 bins, n_fft 20, hop 5, overlap-add
        let nf = frames * 120;
        let mut spec = vec![0f32; 22 * nf];
        for b in 0..11 {
            for f in 0..nf {
                spec[b * nf + f] = post.row(b)[f].exp();
            }
            spec[(11 + b) * nf..(12 + b) * nf].copy_from_slice(&post.row(11 + b)[..nf]);
        }
        sin_slice(&mut spec[11 * nf..]);
        let ibasis: Vec<f32> = (0..22 * 20).map(|i| ((i / 20 * (i % 20)) as f32 * 0.3).cos()).collect();
        let mut out = vec![0f32; n24 + 20];
        for f in 0..nf {
            for b in 0..11 {
                let re = spec[b * nf + f] * spec[(11 + b) * nf + f];
                for k in 0..20 {
                    out[f * 5 + k] += re * ibasis[b * 20 + k];
                }
            }
        }
        let t3 = now();
        std::hint::black_box(&out);
        [t1 - t0, t2 - t1, t3 - t2, t3 - t0]
    }
}
