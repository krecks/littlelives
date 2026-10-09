//! Wear and repairs: things wear out with use and break; broken things don't work (or count
//! for their room) until a resident repairs them or the player pays for a quick fix.

use sim_core::social::EventKind;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"comfort","label":"Comfort","decayPerHour":0.05}],
    "skills":[{"id":"handiness","label":"Handiness"}],
    "skillRules":{"maxLevel":10},
    "objects":[
      {"id":"chair","name":"Chair","price":100,"wearPerUse":0.5,"interactions":[
        {"id":"sit","label":"Sit","minutes":10,"effects":{"comfort":0.2},"tags":["lounge"]}]},
      {"id":"plant","name":"Plant","price":20,"category":"garden","interactions":[
        {"id":"water","label":"Water","minutes":5,"effects":{"comfort":0.05},"tags":["chores"]}]}],
    "roomKinds":[{"id":"living","tags":["lounge"],"size":[4,9]}],
    "objectRules":{"wear":{"perUse":0.004,"byCategory":{"garden":0}},
                   "repair":{"minutes":30,"skill":"handiness","skillGainPerHour":0.5,"chance":1.0,"interest":2.0,"cost":0.3}},
    "economy":{"startingFunds":1000}}"#;

const TOWN: &str = r#"{"width":12,"depth":10,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "walls":[[1,1,6,1],[1,5,6,5],[1,1,1,5],[6,1,6,5]],
    "doors":[{"x":3,"z":5,"axis":"x"}],
    "objects":[{"def":"chair","x":2,"z":2},{"def":"plant","x":8,"z":3}],
    "sims":[{"name":"Ada","x":4.5,"z":3.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w
}

fn sit(w: &mut World) {
    w.apply(Command::Use { sim: 0, object: 0, interaction: 0 }).unwrap();
    for _ in 0..30 * 20 {
        w.tick_once();
    }
}

#[test]
fn things_wear_out_break_and_get_repaired() {
    let mut w = world();
    assert_eq!(w.content.objects[1].wear_per_use, 0.0, "plants don't wear out");
    sit(&mut w);
    assert_eq!(w.objects[0].wear, 0.5);
    assert!(!w.objects[0].broken());
    let version = w.structure_version();
    sit(&mut w);
    assert!(w.objects[0].broken());
    assert!(w.structure_version() > version, "the renderer shows it broken");
    assert!(w.events.iter().any(|e| e.kind == EventKind::Broke && e.n == Some(0)));
    let err = w.apply(Command::Use { sim: 0, object: 0, interaction: 0 }).unwrap_err();
    assert!(err.to_string().contains("broken"), "{err}");
    // A broken chair is no seat: the room has nothing to tell what it's for.
    w.refresh_rooms();
    assert_eq!(w.room_at_tile(2, 2).unwrap().kind, None);

    // The paid quick fix: 30% of the price for a fully worn chair; undo takes it back.
    w.apply(Command::SetSpeed { speed: 0 }).unwrap();
    w.apply(Command::Repair { household: 0, object: 0 }).unwrap();
    assert_eq!((w.objects[0].wear, w.households[0].funds), (0.0, 970));
    w.apply(Command::Undo { household: 0 }).unwrap();
    assert!(w.objects[0].broken());
    assert_eq!(w.households[0].funds, 1000);

    // Saved and loaded broken.
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert!(loaded.objects[0].broken());

    // With free will, Ada repairs it herself (and gets handier).
    w.apply(Command::SetSpeed { speed: 1 }).unwrap();
    w.apply(Command::SetAutonomy { enabled: true, household: None }).unwrap();
    for _ in 0..2 * 60 * 20 {
        w.tick_once();
        if !w.objects[0].broken() {
            break;
        }
    }
    assert!(!w.objects[0].broken(), "repaired");
    assert!(w.events.iter().any(|e| e.kind == EventKind::Repaired && e.a == 0));
    assert!(w.sims[0].skills[0] > 0.2, "handiness {}", w.sims[0].skills[0]);
    assert_eq!(w.households[0].funds, 1000, "a resident's repair is free");
}
