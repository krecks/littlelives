//! Roof style and colour: the player picks how the roof over their home looks (free, undoable,
//! saved by id).

use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "objects":[],
    "economy":{"startingFunds":1000},
    "roofStyles":[{"id":"gable"},{"id":"hip"},{"id":"flat"}],
    "roofColors":[{"id":"slate"},{"id":"red"}]}"#;

const TOWN: &str = r#"{"width":24,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10},{"name":"Next door","x":12,"z":0,"w":12,"d":10}],
    "households":[{"name":"Player","plot":0,"player":true},{"name":"Brook","plot":1}]}"#;

#[test]
fn the_roof_takes_a_style_and_colour() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    assert_eq!(w.plots[0].roof, None, "the town's own look until the player picks one");
    w.apply(Command::SetRoof { household: 0, style: 2, color: 1 }).unwrap();
    let roof = w.plots[0].roof.unwrap();
    assert_eq!((roof.style, roof.color), (2, 1));
    assert_eq!(w.households[0].funds, 1000, "free");
    assert_eq!(w.plots[1].roof, None, "only the home's");
    assert!(w.apply(Command::SetRoof { household: 0, style: 3, color: 0 }).is_err());
    assert!(w.apply(Command::SetRoof { household: 0, style: 0, color: 2 }).is_err());

    let view: serde_json::Value = serde_json::from_str(&sim_core::view::structure_json(&w)).unwrap();
    assert_eq!(view["plots"][0]["roof"], serde_json::json!([2, 1]));

    // Saved by id.
    let save: serde_json::Value = serde_json::from_str(&w.save_json()).unwrap();
    assert_eq!(save["plots"][0]["roof"], serde_json::json!(["flat", "red"]));
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.plots[0].roof, w.plots[0].roof);

    // Undo and redo.
    w.apply(Command::SetRoof { household: 0, style: 1, color: 0 }).unwrap();
    w.apply(Command::Undo { household: 0 }).unwrap();
    assert_eq!(w.plots[0].roof.map(|r| r.style), Some(2));
    w.apply(Command::Redo { household: 0 }).unwrap();
    assert_eq!(w.plots[0].roof.map(|r| r.style), Some(1));
}
