//! The UI gets changes only (`view::UiSync`): applied in order, they must add up to what a
//! fresh UI would be sent, and a quiet game sends next to nothing.
//!
//! `cargo test --release -p sim-core --test ui_updates -- --ignored --nocapture` prints what
//! the stream costs.

mod common;

use std::collections::BTreeMap;
use std::time::Instant;

use serde_json::{Map, Value};
use sim_core::view::UiSync;
use sim_core::{World, clock};

/// The shared test town; `crowded`, the neighbours' houses filled up to the resident cap.
fn world(crowded: bool) -> World {
    let content = common::content();
    let mut town: Value = serde_json::from_str(&common::town(&content, 7, 3)).unwrap();
    if crowded {
        let sims = town["sims"].as_array().unwrap();
        let player = |s: &Value| town["households"][s["household"].as_u64().unwrap() as usize]["player"] == true;
        let neighbours: Vec<&Value> = sims.iter().filter(|s| !player(s)).collect();
        let more: Vec<Value> = (0..sim_core::world::MAX_SIMS - sims.len())
            .map(|i| {
                let mut s = neighbours[i % neighbours.len()].clone();
                s["name"] = Value::from(format!("Lodger {i}"));
                s
            })
            .collect();
        town["sims"].as_array_mut().unwrap().extend(more);
    }
    let mut w = World::from_json(&content, &town.to_string(), 7).expect("town loads");
    // Into the afternoon: everyone is up and about.
    let start = clock::tick_at(1, 14.0 * 60.0).unwrap();
    while w.tick < start {
        w.tick_once();
    }
    w
}

/// Fields the UI drops when a resident's details stop (`SimView.detail`).
const DETAILS: [&str; 8] = ["grade", "needs", "mood", "emotion", "feelings", "actions", "skills", "plan"];

/// The UI's copy of the view, kept the way `game/uiUpdates.ts` keeps it.
#[derive(Default, Debug, PartialEq)]
struct Mirror {
    sims: BTreeMap<u64, Map<String, Value>>,
    households: BTreeMap<u64, Value>,
    relationships: BTreeMap<(u64, u64), Value>,
    rooms: BTreeMap<u64, Value>,
}

impl Mirror {
    fn apply(&mut self, json: &str) -> Value {
        let u: Value = serde_json::from_str(json).expect("an update is JSON");
        if u["full"] == true {
            *self = Mirror::default();
        }
        let list = |key: &str| u[key].as_array().cloned().unwrap_or_default();
        for id in list("simsGone") {
            self.sims.remove(&id.as_u64().unwrap());
        }
        for patch in list("sims") {
            let sim = self.sims.entry(patch["id"].as_u64().unwrap()).or_default();
            for (key, value) in patch.as_object().unwrap() {
                match (key.as_str(), value) {
                    ("plan", Value::Object(parts)) => {
                        let plan = sim.entry("plan").or_insert_with(|| Value::Object(Map::new()));
                        plan.as_object_mut().unwrap().extend(parts.clone());
                    }
                    ("plan" | "pension" | "grade", Value::Null) => {
                        sim.remove(key);
                    }
                    _ => {
                        sim.insert(key.clone(), value.clone());
                    }
                }
            }
            if patch["detail"] == false {
                for key in DETAILS {
                    sim.remove(key);
                }
            }
        }
        for h in list("households") {
            self.households.insert(h["id"].as_u64().unwrap(), h);
        }
        for pair in list("relationshipsGone") {
            self.relationships.remove(&(pair[0].as_u64().unwrap(), pair[1].as_u64().unwrap()));
        }
        for r in list("relationships") {
            self.relationships.insert((r["a"].as_u64().unwrap(), r["b"].as_u64().unwrap()), r);
        }
        for id in list("roomsGone") {
            self.rooms.remove(&id.as_u64().unwrap());
        }
        for r in list("rooms") {
            self.rooms.insert(r["id"].as_u64().unwrap(), r);
        }
        u
    }
}

/// What a fresh UI would get now, inspecting `inspected`.
fn fresh(w: &World, inspected: Option<u32>) -> Mirror {
    let mut sync = UiSync::new();
    sync.inspect(inspected);
    let mut m = Mirror::default();
    m.apply(&sync.update_json(w));
    m
}

#[test]
fn changes_add_up_to_the_whole_view() {
    let mut w = world(false);
    w.speed = 3;
    let mut sync = UiSync::new();
    let mut ui = Mirror::default();
    let neighbour = w.sims.iter().find(|s| !w.households[s.household as usize].player).unwrap().id;
    let mut inspected = None;
    let mut events = Vec::new();
    for step in 0..6000 {
        w.advance();
        // The player looks at a neighbour for a while, then at one of theirs; the UI loses
        // track once.
        match step {
            1000 => inspected = Some(neighbour),
            2500 => inspected = Some(0),
            4000 => inspected = None,
            _ => {}
        }
        sync.inspect(inspected);
        if step == 3000 {
            sync.resync();
        }
        if step % 2 == 0 {
            let u = ui.apply(&sync.update_json(&w));
            let ids = u["events"].as_array().cloned().unwrap_or_default();
            events.extend(ids.iter().map(|e| e["id"].as_u64().unwrap()));
        }
        if step % 500 == 0 {
            assert_eq!(ui, fresh(&w, inspected), "step {step}");
        }
    }
    ui.apply(&sync.update_json(&w));
    assert_eq!(ui, fresh(&w, inspected));
    // Story events arrive in order; only the resync repeats the recent ones.
    assert!(events.len() > 30, "the story moved on: {} events", events.len());
    assert!(events.windows(2).filter(|p| p[0] >= p[1]).count() <= 1, "in order: {events:?}");
}

#[test]
fn details_only_for_the_household_and_the_inspected() {
    let w = world(false);
    let neighbour = w.sims.iter().find(|s| !w.households[s.household as usize].player).unwrap().id;
    let ui = fresh(&w, Some(neighbour));
    for (&id, sim) in &ui.sims {
        let player = w.households[w.sims[id as usize].household as usize].player;
        let detailed = player || id == u64::from(neighbour);
        assert_eq!(sim["detail"], detailed, "resident {id}");
        assert_eq!(sim.contains_key("needs"), detailed, "resident {id}");
        assert_eq!(sim.contains_key("plan"), player, "resident {id}");
        assert!(sim.contains_key("job") && sim.contains_key("plot"), "everyone's summary");
    }
    let detailed = |s: u64| ui.sims[&s]["detail"] == true;
    assert!(ui.relationships.keys().all(|&(a, b)| detailed(a) || detailed(b)));
    assert!(ui.relationships.keys().any(|&(a, _)| a == u64::from(neighbour)), "the inspected's people");
}

#[test]
fn a_paused_game_sends_next_to_nothing() {
    let mut w = world(false);
    let mut sync = UiSync::new();
    let first = sync.update_json(&w);
    w.speed = 0;
    for _ in 0..10 {
        w.advance();
    }
    let quiet = sync.update_json(&w);
    let u: Value = serde_json::from_str(&quiet).unwrap();
    assert_eq!(u["full"], false);
    for key in ["sims", "simsGone", "households", "relationships", "relationshipsGone", "events", "rooms", "roomsGone"] {
        assert!(u.get(key).is_none(), "{key} unchanged: {quiet}");
    }
    assert!(quiet.len() < 200 && first.len() > 10_000, "{} then {} bytes", first.len(), quiet.len());
}

/// Runs a game minute at `speed` (UI updates at 10 Hz: every other step) and reports what the
/// UI is sent: changes only, and the whole view every time (as before changes only).
fn measure(label: &str, w: &mut World, speed: u8) {
    w.speed = speed;
    let mut sync = UiSync::new();
    sync.update_json(w);
    let (mut bytes, mut time, mut whole_bytes, mut whole_time, mut n) = (0, 0.0, 0, 0.0, 0);
    for step in 0..400 {
        w.advance();
        if step % 2 == 0 {
            let t = Instant::now();
            bytes += sync.update_json(w).len();
            time += t.elapsed().as_secs_f64();
            let t = Instant::now();
            whole_bytes += sim_core::view::ui_state_json(w).len();
            whole_time += t.elapsed().as_secs_f64();
            n += 1;
        }
    }
    eprintln!(
        "{label} ({} residents, speed {speed}): changes {} B/msg, {:.3} ms/msg; everything {} B/msg, {:.3} ms/msg",
        w.sims.iter().filter(|s| s.here()).count(),
        bytes / n,
        time * 1000.0 / n as f64,
        whole_bytes / n,
        whole_time * 1000.0 / n as f64
    );
}

#[test]
#[ignore]
fn ui_stream_cost() {
    for (label, crowded) in [("normal town", false), ("crowded town", true)] {
        let mut w = world(crowded);
        measure(label, &mut w, 1);
        measure(label, &mut w, 3);
    }
}
