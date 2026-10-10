//! Micro-benchmark of the kernels a hand-written Paradee engine spends its time in:
//! direct 1-D convolution (the generator's resblocks, ~80 % of the FLOPs) and the Snake
//! activation (x + sin²(αx)/α, one per conv in the generator).
//!
//! Layout: activations are channel-major `[C][T]` with the conv's padding stored in each row,
//! so the time axis is contiguous and vectorised (4 time steps per f32x4). Weights are packed
//! per block of CO output channels as `[cout/CO][cin][k][CO]`, so one `load32_splat` per
//! (input channel, tap, output channel) feeds TV vectors of 4 time steps.
//!
//! WASM: `bench(case, variant, reps) -> GFLOP/s`, timing through an imported `env.now()` (ms).
//! Native: `src/main.rs`.

#![allow(clippy::missing_safety_doc, clippy::too_many_arguments)]

pub mod skeleton;

pub struct Case {
    pub name: &'static str,
    pub cin: usize,
    pub cout: usize,
    pub k: usize,
    pub d: usize,
    pub t: usize,
}

/// Shapes from the ORT profile of a 71-character line (179 frames, 4.47 s); T rounded up to a
/// multiple of 32 time steps.
pub const CASES: &[Case] = &[
    Case { name: "gen resblock 32ch k11 d5 @24 kHz/5", cin: 32, cout: 32, k: 11, d: 5, t: 21504 },
    Case { name: "gen resblock 32ch k3 d1 @24 kHz/5", cin: 32, cout: 32, k: 3, d: 1, t: 21504 },
    Case { name: "gen resblock 64ch k7 d3 @24 kHz/30", cin: 64, cout: 64, k: 7, d: 3, t: 3584 },
    Case { name: "decoder AdaIN conv 514->256 k3 @40 Hz", cin: 514, cout: 256, k: 3, d: 1, t: 192 },
    Case { name: "ALBERT FFN 256->768 (k1) 75 tokens", cin: 256, cout: 768, k: 1, d: 1, t: 96 },
];

pub fn flops(c: &Case) -> f64 {
    2.0 * c.cin as f64 * c.cout as f64 * c.k as f64 * c.t as f64
}

pub struct Bufs {
    pub x: Vec<f32>,
    pub xs: usize,
    pub w: Vec<f32>,
    pub b: Vec<f32>,
    pub y: Vec<f32>,
}

fn lcg(seed: &mut u32) -> f32 {
    *seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
    ((*seed >> 8) as f32 / (1u32 << 24) as f32) - 0.5
}

pub fn make(c: &Case) -> Bufs {
    let pad = (c.k - 1) * c.d;
    let xs = c.t + pad + 32; // padded row (+32 so unaligned vector loads in the tail stay inside)
    let mut s = 1;
    let x = (0..c.cin * xs).map(|_| lcg(&mut s)).collect();
    let w = (0..c.cout * c.cin * c.k).map(|_| lcg(&mut s) * 0.1).collect();
    let b = (0..c.cout).map(|_| lcg(&mut s)).collect();
    Bufs { x, xs, w, b, y: vec![0.0; c.cout * c.t] }
}

/// Reference: y[co][t] = b[co] + Σ w[co][ci][k] · x[ci][t + k·d]  (w as [cout][cin][k]).
pub fn conv_naive(c: &Case, bf: &mut Bufs) {
    for co in 0..c.cout {
        for t in 0..c.t {
            let mut s = bf.b[co];
            for ci in 0..c.cin {
                for kk in 0..c.k {
                    s += bf.w[(co * c.cin + ci) * c.k + kk] * bf.x[ci * bf.xs + t + kk * c.d];
                }
            }
            bf.y[co * c.t + t] = s;
        }
    }
}

/// `[cout][cin][k]` -> `[cout/CO][cin][k][CO]`.
pub fn pack(c: &Case, w: &[f32], co_block: usize) -> Vec<f32> {
    let mut p = vec![0.0; w.len()];
    for cb in 0..c.cout / co_block {
        for ci in 0..c.cin {
            for kk in 0..c.k {
                for j in 0..co_block {
                    let co = cb * co_block + j;
                    p[((cb * c.cin + ci) * c.k + kk) * co_block + j] = w[(co * c.cin + ci) * c.k + kk];
                }
            }
        }
    }
    p
}

/// Portable blocked kernel ([f32; 4] lanes; LLVM vectorises it for NEON or simd128).
pub fn conv_portable<const CO: usize, const TV: usize>(c: &Case, x: &[f32], xs: usize, wp: &[f32], b: &[f32], y: &mut [f32]) {
    let step = 4 * TV;
    for cb in 0..c.cout / CO {
        let mut t0 = 0;
        while t0 < c.t {
            let mut acc = [[[0f32; 4]; TV]; CO];
            for (j, a) in acc.iter_mut().enumerate() {
                for v in a.iter_mut() {
                    *v = [b[cb * CO + j]; 4];
                }
            }
            for ci in 0..c.cin {
                let xrow = &x[ci * xs + t0..];
                let wrow = &wp[((cb * c.cin + ci) * c.k) * CO..];
                for kk in 0..c.k {
                    let xo = &xrow[kk * c.d..kk * c.d + step];
                    for j in 0..CO {
                        let wv = wrow[kk * CO + j];
                        for v in 0..TV {
                            for l in 0..4 {
                                acc[j][v][l] += wv * xo[v * 4 + l];
                            }
                        }
                    }
                }
            }
            for j in 0..CO {
                for v in 0..TV {
                    let o = (cb * CO + j) * c.t + t0 + v * 4;
                    let n = (c.t - (t0 + v * 4)).min(4);
                    y[o..o + n].copy_from_slice(&acc[j][v][..n]);
                }
            }
            t0 += step;
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub mod simd {
    use super::Case;
    use core::arch::wasm32::*;

    #[inline(always)]
    unsafe fn madd(a: v128, b: v128, c: v128) -> v128 {
        #[cfg(target_feature = "relaxed-simd")]
        {
            f32x4_relaxed_madd(a, b, c)
        }
        #[cfg(not(target_feature = "relaxed-simd"))]
        {
            f32x4_add(f32x4_mul(a, b), c)
        }
    }

    /// Explicit SIMD128 kernel: CO output channels × TV vectors of 4 time steps per block.
    pub unsafe fn conv<const CO: usize, const TV: usize>(c: &Case, x: &[f32], xs: usize, wp: &[f32], b: &[f32], y: &mut [f32]) {
        unsafe {
            let step = 4 * TV;
            let xp = x.as_ptr();
            let wpp = wp.as_ptr();
            let yp = y.as_mut_ptr();
            for cb in 0..c.cout / CO {
                let mut t0 = 0;
                while t0 + step <= c.t {
                    let mut acc = [[f32x4_splat(0.0); TV]; CO];
                    for j in 0..CO {
                        let bv = f32x4_splat(b[cb * CO + j]);
                        for v in 0..TV {
                            acc[j][v] = bv;
                        }
                    }
                    for ci in 0..c.cin {
                        let xrow = xp.add(ci * xs + t0);
                        let wrow = wpp.add((cb * c.cin + ci) * c.k * CO);
                        for kk in 0..c.k {
                            let xo = xrow.add(kk * c.d);
                            let mut xv = [f32x4_splat(0.0); TV];
                            for v in 0..TV {
                                xv[v] = v128_load(xo.add(v * 4) as *const v128);
                            }
                            for j in 0..CO {
                                let wv = v128_load32_splat(wrow.add(kk * CO + j) as *const u32);
                                for v in 0..TV {
                                    acc[j][v] = madd(wv, xv[v], acc[j][v]);
                                }
                            }
                        }
                    }
                    for j in 0..CO {
                        for v in 0..TV {
                            v128_store(yp.add((cb * CO + j) * c.t + t0 + v * 4) as *mut v128, acc[j][v]);
                        }
                    }
                    t0 += step;
                }
            }
        }
    }

    /// Snake with a polynomial sine: y = x + sin²(αx)/α, 4 lanes at a time.
    pub unsafe fn snake(x: &mut [f32], alpha: f32) {
        unsafe {
            let a = f32x4_splat(alpha);
            let inv = f32x4_splat(1.0 / alpha);
            let p = x.as_mut_ptr();
            let mut i = 0;
            while i + 4 <= x.len() {
                let v = v128_load(p.add(i) as *const v128);
                let s = sin4(f32x4_mul(a, v));
                v128_store(p.add(i) as *mut v128, f32x4_add(v, f32x4_mul(inv, f32x4_mul(s, s))));
                i += 4;
            }
        }
    }

    pub unsafe fn sin_slice(x: &mut [f32]) {
        unsafe {
            let p = x.as_mut_ptr();
            let mut i = 0;
            while i + 4 <= x.len() {
                v128_store(p.add(i) as *mut v128, sin4(v128_load(p.add(i) as *const v128)));
                i += 4;
            }
            for v in &mut x[i..] {
                *v = v.sin();
            }
        }
    }

    /// sin(x): range-reduce to [-π/2, π/2] by multiples of π, odd polynomial (|err| < 2e-6).
    #[inline(always)]
    unsafe fn sin4(x: v128) -> v128 {
        let inv_pi = f32x4_splat(core::f32::consts::FRAC_1_PI);
        let n = f32x4_nearest(f32x4_mul(x, inv_pi));
        let r = f32x4_sub(x, f32x4_mul(n, f32x4_splat(core::f32::consts::PI)));
        let r2 = f32x4_mul(r, r);
        let mut s = f32x4_splat(-2.3889859e-8);
        s = f32x4_add(f32x4_mul(s, r2), f32x4_splat(2.7525562e-6));
        s = f32x4_add(f32x4_mul(s, r2), f32x4_splat(-1.9840874e-4));
        s = f32x4_add(f32x4_mul(s, r2), f32x4_splat(8.333331e-3));
        s = f32x4_add(f32x4_mul(s, r2), f32x4_splat(-1.6666667e-1));
        s = f32x4_add(f32x4_mul(f32x4_mul(s, r2), r), r);
        // odd multiples of π flip the sign
        let odd = i32x4_shl(i32x4_trunc_sat_f32x4(n), 31);
        v128_xor(s, odd)
    }
}

pub fn snake_scalar(x: &mut [f32], alpha: f32) {
    let inv = 1.0 / alpha;
    for v in x.iter_mut() {
        let s = (alpha * *v).sin();
        *v += inv * s * s;
    }
}

/// Runs a conv variant once. Variants: 0 naive, 1 portable 4x4, 2 portable 8x2,
/// 10 simd 4x4, 11 simd 8x2, 12 simd 4x2, 13 simd 2x8, 14 simd 8x4, 15 simd 4x8, 16 simd 8x1.
pub fn run(c: &Case, bf: &mut Bufs, wp: &[(usize, Vec<f32>)], variant: u32) {
    let w = |co: usize| &wp.iter().find(|(b, _)| *b == co).unwrap().1;
    match variant {
        0 => conv_naive(c, bf),
        1 => conv_portable::<4, 4>(c, &bf.x, bf.xs, w(4), &bf.b, &mut bf.y),
        2 => conv_portable::<8, 2>(c, &bf.x, bf.xs, w(8), &bf.b, &mut bf.y),
        #[cfg(target_arch = "wasm32")]
        10 => unsafe { simd::conv::<4, 4>(c, &bf.x, bf.xs, w(4), &bf.b, &mut bf.y) },
        #[cfg(target_arch = "wasm32")]
        11 => unsafe { simd::conv::<8, 2>(c, &bf.x, bf.xs, w(8), &bf.b, &mut bf.y) },
        #[cfg(target_arch = "wasm32")]
        12 => unsafe { simd::conv::<4, 2>(c, &bf.x, bf.xs, w(4), &bf.b, &mut bf.y) },
        #[cfg(target_arch = "wasm32")]
        13 => unsafe { simd::conv::<2, 8>(c, &bf.x, bf.xs, w(2), &bf.b, &mut bf.y) },
        #[cfg(target_arch = "wasm32")]
        14 => unsafe { simd::conv::<8, 4>(c, &bf.x, bf.xs, w(8), &bf.b, &mut bf.y) },
        #[cfg(target_arch = "wasm32")]
        15 => unsafe { simd::conv::<4, 8>(c, &bf.x, bf.xs, w(4), &bf.b, &mut bf.y) },
        #[cfg(target_arch = "wasm32")]
        16 => unsafe { simd::conv::<8, 1>(c, &bf.x, bf.xs, w(8), &bf.b, &mut bf.y) },
        _ => panic!("variant"),
    }
}

pub fn packs(c: &Case, bf: &Bufs) -> Vec<(usize, Vec<f32>)> {
    [2, 4, 8].iter().map(|&co| (co, pack(c, &bf.w, co))).collect()
}

/// Max |difference| of a variant against the naive reference.
pub fn check(case: usize, variant: u32) -> f32 {
    let c = &CASES[case];
    let mut bf = make(c);
    let wp = packs(c, &bf);
    conv_naive(c, &mut bf);
    let reference = bf.y.clone();
    bf.y.iter_mut().for_each(|v| *v = 0.0);
    run(c, &mut bf, &wp, variant);
    reference.iter().zip(&bf.y).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max)
}

#[cfg(target_arch = "wasm32")]
mod wasm_api {
    use super::*;

    #[link(wasm_import_module = "env")]
    unsafe extern "C" {
        fn now() -> f64;
    }

    /// Best-of-`reps` GFLOP/s for a conv case and variant.
    #[unsafe(no_mangle)]
    pub extern "C" fn bench(case: u32, variant: u32, reps: u32) -> f64 {
        let c = &CASES[case as usize];
        let mut bf = make(c);
        let wp = packs(c, &bf);
        let mut best = f64::MAX;
        for _ in 0..reps {
            let t = unsafe { now() };
            run(c, &mut bf, &wp, variant);
            best = best.min(unsafe { now() } - t);
        }
        flops(c) / (best * 1e-3) / 1e9
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn check_variant(case: u32, variant: u32) -> f32 {
        check(case as usize, variant)
    }

    /// ns per element of Snake on 32 × 21504 values: variant 0 scalar libm, 1 SIMD polynomial.
    #[unsafe(no_mangle)]
    pub extern "C" fn bench_snake(variant: u32, reps: u32) -> f64 {
        let mut s = 7;
        let mut x: Vec<f32> = (0..32 * 21504).map(|_| lcg(&mut s) * 6.0).collect();
        let mut best = f64::MAX;
        for _ in 0..reps {
            let t = unsafe { now() };
            match variant {
                0 => snake_scalar(&mut x, 1.3),
                _ => unsafe { simd::snake(&mut x, 1.3) },
            }
            best = best.min(unsafe { now() } - t);
        }
        best * 1e6 / x.len() as f64
    }

    static SKELETON: std::sync::OnceLock<crate::skeleton::Skeleton> = std::sync::OnceLock::new();
    static mut STAGES: [f64; 4] = [0.0; 4];

    /// Decoder + generator skeleton for `frames` duration frames: best-of-`reps` total ms.
    /// Stage times of the best run: `skeleton_stage(0..4)` = decoder, source, generator, total.
    #[unsafe(no_mangle)]
    pub extern "C" fn bench_skeleton(frames: u32, reps: u32) -> f64 {
        let sk = SKELETON.get_or_init(crate::skeleton::Skeleton::new);
        let mut best = [f64::MAX; 4];
        for _ in 0..reps {
            let st = sk.run(frames as usize, &|| unsafe { now() });
            if st[3] < best[3] {
                best = st;
            }
        }
        unsafe { STAGES = best };
        best[3]
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn skeleton_stage(i: u32) -> f64 {
        unsafe { STAGES[i as usize] }
    }

    /// Max error of the SIMD Snake against libm.
    #[unsafe(no_mangle)]
    pub extern "C" fn check_snake() -> f32 {
        let mut s = 7;
        let x: Vec<f32> = (0..4096).map(|_| lcg(&mut s) * 40.0).collect();
        let mut a = x.clone();
        let mut b = x.clone();
        snake_scalar(&mut a, 1.3);
        unsafe { simd::snake(&mut b, 1.3) };
        a.iter().zip(&b).map(|(p, q)| (p - q).abs()).fold(0.0, f32::max)
    }
}
