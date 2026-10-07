//! Guards the content files the game ships with.

use sim_core::{Content, World};

const CONTENT: &str = include_str!("../../../web/public/content/base.json");
const STARTER_LOT: &str = include_str!("../../../web/public/content/lots/starter.json");

/// The starter lot ships empty; the game moves the created household in at its spawn points.
fn starter_with_household() -> String {
    let mut lot: serde_json::Value = serde_json::from_str(STARTER_LOT).unwrap();
    let spawns = lot["spawns"]
        .as_array()
        .expect("starter lot has spawns")
        .clone();
    lot["sims"] = serde_json::json!([
        { "name": "Ada", "traits": ["foodie", "lazy"], "perks": ["ironBladder"], "x": spawns[0][0], "z": spawns[0][1] },
        { "name": "Bo", "traits": ["neat", "cheerful", "bookworm"], "perks": ["speedWalker", "sunnyDisposition"], "x": spawns[1][0], "z": spawns[1][1] },
    ]);
    lot.to_string()
}

#[test]
fn content_traits_and_perks_are_valid() {
    let content = Content::from_json(CONTENT).expect("shipped content is valid");
    assert!(content.traits.len() >= 6);
    assert!(content.perks.len() >= 4);
    assert!(content.rules.max_traits >= content.rules.min_traits);
}

#[test]
fn starter_lot_loads_with_a_household() {
    let world =
        World::from_json(CONTENT, &starter_with_household(), 1).expect("starter lot is valid");
    assert_eq!(world.sims.len(), 2);
    assert!(
        world
            .lot
            .rooms()
            .iter()
            .any(|&r| r != sim_core::lot::OUTDOORS)
    );
}

#[test]
fn starter_lot_runs_a_game_day_quickly() {
    let mut world = World::from_json(CONTENT, &starter_with_household(), 1).unwrap();
    let ticks = 24 * 60 * sim_core::TICKS_PER_SECOND;
    let start = std::time::Instant::now();
    for _ in 0..ticks {
        world.tick_once();
    }
    let per_tick = start.elapsed() / ticks;
    eprintln!("avg tick: {per_tick:?}");
    // Sims should have looked after themselves over a full day.
    for s in &world.sims {
        let n = world.content.needs.len();
        let avg = s.needs[..n].iter().sum::<f32>() / n as f32;
        assert!(
            avg > 0.2,
            "{} let their needs collapse: {:?}",
            s.name,
            &s.needs[..n]
        );
    }
    // And the day survives a save/load round trip.
    let reloaded = World::from_save_json(CONTENT, &world.save_json()).unwrap();
    assert_eq!(reloaded.tick, world.tick);
}
