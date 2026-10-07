//! Rough per-tick timing for the shipped content: `cargo run --release --example tickbench`.

use std::time::Instant;

use sim_core::World;

const CONTENT: &str = include_str!("../../../web/public/content/base.json");
const LOT: &str = include_str!("../../../web/public/content/lots/starter.json");

fn main() {
    let mut lot: serde_json::Value = serde_json::from_str(LOT).unwrap();
    let names = ["Ada", "Bo", "Cy", "Di"];
    lot["sims"] = names
        .iter()
        .enumerate()
        .map(|(i, n)| serde_json::json!({ "name": n, "traits": ["cheerful"], "x": 8.5 + i as f32, "z": 3.0 }))
        .collect();
    let content: serde_json::Value = serde_json::from_str(CONTENT).unwrap();
    for (label, socials) in [("with socials", true), ("without socials", false)] {
        let mut c = content.clone();
        if !socials {
            for s in c["socials"].as_array_mut().unwrap() {
                s["autonomous"] = false.into();
            }
        }
        let mut world = World::from_json(&c.to_string(), &lot.to_string(), 1).unwrap();
        let ticks = 24 * 60 * sim_core::TICKS_PER_SECOND;
        let start = Instant::now();
        for _ in 0..ticks {
            world.tick_once();
        }
        let events = world.events.iter().count();
        println!(
            "{label}: {:?}/tick, {events} social events",
            start.elapsed() / ticks
        );
    }
}
