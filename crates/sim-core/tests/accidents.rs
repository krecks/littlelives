//! Essentials and accidents: when a need runs out with nothing being done about it, something
//! visible happens (a puddle, asleep on the floor, takeout), with its mess, feeling and cost.

use sim_core::social::EventKind;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"bladder","label":"Bladder","decayPerHour":0.5},{"id":"energy","label":"Energy","decayPerHour":0.0},
             {"id":"hunger","label":"Hunger","decayPerHour":0.0},{"id":"hygiene","label":"Hygiene","decayPerHour":0.0}],
    "emotions":[{"id":"embarrassed","label":"Embarrassed"}],
    "feelings":[{"id":"hadAccident","label":"Had an accident","emotion":"embarrassed","mood":-0.2,"hours":6}],
    "objects":[{"id":"toilet","name":"Toilet","price":100,"interactions":[
        {"id":"use","label":"Use","minutes":10,"effects":{"bladder":1.0},"tags":["bathroom"]}]}],
    "accidents":[
      {"id":"wetSelf","need":"bladder","story":"had an accident","effects":{"bladder":1.0,"hygiene":-0.6},"dirt":1.0,"feeling":"hadAccident","cooldownHours":2,"graceMinutes":5},
      {"id":"fellAsleep","need":"energy","story":"fell asleep on the floor","cooldownHours":4,"graceMinutes":0,
       "rest":{"label":"Asleep on the floor","minutes":120,"pose":"lie","gains":{"energy":0.45},"tags":["sleep"]}},
      {"id":"takeout","need":"hunger","story":"ordered takeout","cost":25,"cooldownHours":2,"graceMinutes":0,
       "rest":{"label":"Eat takeout","minutes":20,"gains":{"hunger":0.7},"tags":["food"]}}],
    "economy":{"startingFunds":1000}}"#;

const TOWN: &str = r#"{"width":12,"depth":10,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "sims":[{"name":"Ada","x":4.5,"z":3.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w.sims[0].needs = [0.05, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0];
    w
}

fn hours(w: &mut World, h: f32) {
    for _ in 0..(h * 60.0 * 20.0) as usize {
        w.tick_once();
    }
}

#[test]
fn with_no_toilet_it_ends_in_a_puddle() {
    let mut w = world();
    hours(&mut w, 0.2);
    let accidents: Vec<_> = w.events.iter().filter(|e| e.kind == EventKind::Accident).map(|e| e.n).collect();
    assert_eq!(accidents, [Some(0)]);
    assert!(w.sims[0].needs[0] > 0.8, "relieved");
    assert!((w.sims[0].needs[3] - 0.4).abs() < 0.01, "but grubby: hygiene {}", w.sims[0].needs[3]);
    assert_eq!(w.dirt[w.lot.tile_index(4, 3)], 1.0, "a puddle where it happened");
    assert!(w.sims[0].feelings.iter().any(|f| w.content.feelings[f.def].id == "hadAccident"));
    // Not again right away.
    w.sims[0].needs[0] = 0.0;
    hours(&mut w, 0.5);
    assert_eq!(w.events.iter().filter(|e| e.kind == EventKind::Accident).count(), 1);
}

#[test]
fn on_the_toilet_at_zero_is_no_accident() {
    let mut w = world();
    w.place_object("toilet", 4, 4, 0).unwrap();
    w.apply(Command::Use { sim: 0, object: 0, interaction: 0 }).unwrap();
    hours(&mut w, 0.5);
    assert!(!w.events.iter().any(|e| e.kind == EventKind::Accident));
}

#[test]
fn exhausted_they_sleep_on_the_floor_and_hungry_they_order_takeout() {
    let mut w = world();
    w.sims[0].needs = [1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0];
    w.tick_once();
    assert_eq!(w.sims[0].pose, sim_core::content::Pose::Lie, "asleep where they stood");
    hours(&mut w, 2.1);
    assert!((w.sims[0].needs[1] - 0.45).abs() < 0.02, "energy {}", w.sims[0].needs[1]);
    assert!(w.events.iter().any(|e| e.kind == EventKind::Accident && e.n == Some(1)));

    w.sims[0].needs[2] = 0.0;
    hours(&mut w, 0.5);
    assert!((w.sims[0].needs[2] - 0.7).abs() < 0.02, "hunger {}", w.sims[0].needs[2]);
    assert_eq!(w.households[0].funds, 975, "takeout costs");
}
