//! Native reference for the same kernels (portable code, auto-vectorised to NEON).

use std::time::Instant;

use voice_kernels::*;

fn main() {
    for (i, c) in CASES.iter().enumerate() {
        let mut bf = make(c);
        let wp = packs(c, &bf);
        let mut line = format!("{:40} {:6.0} MFLOP", c.name, flops(c) / 1e6);
        for (variant, label) in [(1u32, "4x4"), (2, "8x2")] {
            let mut best = f64::MAX;
            for _ in 0..5 {
                let t = Instant::now();
                run(c, &mut bf, &wp, variant);
                best = best.min(t.elapsed().as_secs_f64());
            }
            line += &format!("  {label} {:5.1} GFLOP/s (err {:.1e})", flops(c) / best / 1e9, check(i, variant));
        }
        println!("{line}");
    }
}
