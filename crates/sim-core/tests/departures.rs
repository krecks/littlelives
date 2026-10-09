//! Residents who leave for good: their slot stays (ids don't change), they stop doing and
//! being part of anything, and a newcomer can take the slot later while the story still names
//! the one who left.

use sim_core::lot::SimSpawn;
use sim_core::social::{EventKind, FORMER};
use sim_core::world::GoneWhy;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"comfort","label":"Comfort","decayPerHour":0.05}],
    "objects":[{"id":"chair","name":"Chair","price":100,"interactions":[
        {"id":"sit","label":"Sit","minutes":60,"effects":{"comfort":0.5},"tags":["lounge"]}]}],
    "socials":[{"id":"chat","label":"Chat","minutes":10,"tags":["social"],"acceptance":{"base":1.0}}],
    "bondPresets":{"roommates":{"friendship":20}},"socialRules":{"defaultBond":"roommates"},
    "economy":{"startingFunds":1000}}"#;

const TOWN: &str = r#"{"width":20,"depth":10,
    "plots":[{"name":"Home","x":0,"z":0,"w":10,"d":10,"entry":[5.5,9.5]},
             {"name":"Next door","x":10,"z":0,"w":10,"d":10,"entry":[15.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true},{"name":"Neighbours","plot":1}],
    "objects":[{"def":"chair","x":2,"z":2}],
    "sims":[{"name":"Ada","x":4.5,"z":3.5},{"name":"Bo","x":5.5,"z":3.5},
            {"name":"Cy","x":14.5,"z":3.5,"household":1}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w
}

fn spawn(name: &str) -> SimSpawn {
    serde_json::from_value(serde_json::json!({"name": name, "x": 15.5, "z": 9.5})).unwrap()
}

fn minutes(w: &mut World, m: u32) {
    for _ in 0..m * 20 {
        w.tick_once();
    }
}

#[test]
fn a_resident_who_leaves_stops_everything() {
    let mut w = world();
    w.events.push(w.tick, EventKind::BecameFriends, 0, 2, None);
    w.apply(Command::Social { sim: 1, target: 0, social: 0 }).unwrap();
    w.apply(Command::Use { sim: 0, object: 0, interaction: 0 }).unwrap();
    minutes(&mut w, 2);
    assert!(w.objects[0].in_use());
    assert!(w.relationships.get(1, 0).met, "housemates");
    let version = w.structure_version();

    w.depart(0, GoneWhy::MovedAway);
    assert!(!w.sims[0].here() && w.sims.len() == 3, "the slot stays");
    assert!(!w.objects[0].in_use(), "the chair is free");
    assert!(w.sims[1].current().is_none() && w.sims[1].queue().count() == 0, "nobody waits to talk to them");
    assert!(!w.relationships.get(1, 0).met && !w.relationships.get(0, 1).met, "forgotten");
    assert!(w.structure_version() > version, "views drop them");
    assert!(w.apply(Command::Use { sim: 0, object: 0, interaction: 0 }).is_err(), "no orders for someone gone");

    // Not listed, not drawn, not counted; the story still names them.
    let ui: serde_json::Value = serde_json::from_str(&sim_core::view::ui_state_json(&w)).unwrap();
    assert!(ui["sims"].as_array().unwrap().iter().all(|s| s["id"] != 0));
    let structure: serde_json::Value = serde_json::from_str(&sim_core::view::structure_json(&w)).unwrap();
    assert_eq!(structure["sims"][0]["gone"]["why"], "movedAway");
    let mut snap = vec![0.0; 4096];
    sim_core::snapshot::write(&w, &mut snap);
    use sim_core::snapshot::{HEADER_LEN, SIM_STRIDE, sim};
    assert_eq!(snap[HEADER_LEN + sim::AWAY], 1.0, "their row is hidden");
    assert_eq!(snap[HEADER_LEN + SIM_STRIDE + sim::AWAY], 0.0);
    minutes(&mut w, 60);
    assert!(w.sims[0].current().is_none(), "nothing happens to them");
    assert!(w.events.iter().any(|e| e.kind == EventKind::BecameFriends && e.a == 0));
}

#[test]
fn a_newcomer_takes_the_slot_and_the_story_keeps_the_old_name() {
    let mut w = world();
    w.events.push(w.tick, EventKind::BecameFriends, 0, 2, None);
    w.depart(0, GoneWhy::Died);
    w.apply(Command::MoveIn { household: 1, name: None, sims: vec![spawn("Dee")], bonds: vec![] }).unwrap();
    assert_eq!(w.sims.len(), 3, "Dee took Ada's slot");
    assert_eq!((w.sims[0].name.as_str(), w.sims[0].household, w.sims[0].here()), ("Dee", 1, true));
    let friends = w.events.iter().find(|e| e.kind == EventKind::BecameFriends).unwrap();
    assert_eq!(friends.a, FORMER, "the old event now names a former resident");
    assert_eq!((w.former[0].name.as_str(), w.former[0].household.as_str()), ("Ada", "Player"));
    let moved = w.events.iter().find(|e| e.kind == EventKind::MovedIn).unwrap();
    assert_eq!(moved.a, 0, "new events name the newcomer");
    let structure: serde_json::Value = serde_json::from_str(&sim_core::view::structure_json(&w)).unwrap();
    assert_eq!(structure["sims"][0]["generation"], 1, "views know it's someone new");
    assert_eq!(structure["former"][0]["name"], "Ada");

    // Saved and loaded: the gone, the former and the story.
    w.depart(1, GoneWhy::MovedAway);
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert!(!loaded.sims[1].here() && loaded.sims[0].here());
    assert_eq!(loaded.former, w.former);
    assert!(loaded.events.iter().any(|e| e.kind == EventKind::BecameFriends && e.a == FORMER));

    // Someone new in Bo's old slot too; Ada is still remembered, and nobody forgotten twice.
    let mut w = loaded;
    w.apply(Command::MoveIn { household: 1, name: None, sims: vec![spawn("Eli")], bonds: vec![] }).unwrap();
    assert_eq!(w.sims[1].name, "Eli");
    assert_eq!(w.former.len(), 1, "Bo had no story to keep");
}

#[test]
fn newcomers_fill_gone_slots_before_new_ones_and_a_failed_move_changes_nothing() {
    let mut w = world();
    w.depart(1, GoneWhy::MovedAway);
    let before = w.save_json();
    // A bad bond: nothing moves in, and Bo's slot is still Bo's.
    let bad: Vec<sim_core::lot::BondRaw> = serde_json::from_value(serde_json::json!([{"a": 0, "b": 1, "preset": "nope"}])).unwrap();
    assert!(w.apply(Command::MoveIn { household: 1, name: None, sims: vec![spawn("Fay"), spawn("Gus")], bonds: bad }).is_err());
    assert_eq!(w.save_json(), before);
    w.apply(Command::MoveIn { household: 1, name: None, sims: vec![spawn("Fay"), spawn("Gus")], bonds: vec![] }).unwrap();
    assert_eq!((w.sims[1].name.as_str(), w.sims[3].name.as_str()), ("Fay", "Gus"));
}
