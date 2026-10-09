//! Free rotation for decor: 1×1 objects of the `objectRules.freeRotation` categories (or with
//! `freeRotation: true`) stand at any angle past their facing; the angle is only for looks.

use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "objectRules":{"freeRotation":["decor"]},
    "objects":[
      {"id":"lamp","name":"Lamp","price":30,"category":"decor"},
      {"id":"rug","name":"Rug","price":30,"category":"decor","footprint":[2,1]},
      {"id":"vase","name":"Vase","price":30,"category":"kitchen","freeRotation":true},
      {"id":"chair","name":"Chair","price":50,"category":"living"}],
    "economy":{"startingFunds":1000}}"#;

const TOWN: &str = r#"{"width":12,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}]}"#;

fn buy(w: &mut World, def: &str, x: i32, turn: u8) -> Result<u32, sim_core::Error> {
    w.apply(Command::Buy { household: 0, object: def.into(), at: Some([x, 1, 1]), style: None, turn: Some(turn) })?;
    Ok(w.objects.len() as u32 - 1)
}

#[test]
fn decor_turns_freely_and_keeps_its_angle() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    let turns: Vec<bool> = w.content.objects.iter().map(|o| o.turns).collect();
    assert_eq!(turns, [true, false, true, false], "1×1 decor, and anything that says so");

    let lamp = buy(&mut w, "lamp", 1, 30).unwrap();
    assert_eq!((w.objects[lamp as usize].rot, w.objects[lamp as usize].turn), (1, 30));
    assert!(buy(&mut w, "chair", 3, 30).unwrap_err().to_string().contains("four ways"));
    assert!(buy(&mut w, "rug", 3, 15).is_err(), "bigger things stay on the grid");
    assert!(buy(&mut w, "vase", 5, 90).is_err(), "90° is the next facing");
    assert_eq!(w.objects.len(), 1, "refused purchases buy nothing");

    // Moving keeps the angle unless a new one is given.
    let mv = |turn| Command::MoveObject { household: 0, object: lamp, x: 4, z: 4, rot: 2, turn };
    w.apply(mv(None)).unwrap();
    assert_eq!((w.objects[lamp as usize].rot, w.objects[lamp as usize].turn), (2, 30));
    w.apply(mv(Some(75))).unwrap();
    assert_eq!(w.objects[lamp as usize].turn, 75);
    // Undo puts the old angle back.
    w.apply(Command::Undo { household: 0 }).unwrap();
    assert_eq!(w.objects[lamp as usize].turn, 30);

    // Saved and loaded.
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.objects[lamp as usize].turn, 30);
}
