//! Family: parents, children and siblings, from bonds; relatives don't flirt.

use sim_core::lot::SimSpawn;
use sim_core::social::Kin;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"social","label":"Social","decayPerHour":0.0}],
    "objects":[],
    "tags":["romantic"],
    "socials":[{"id":"chat","label":"Chat","minutes":10,"acceptance":{"base":1.0}},
               {"id":"flirt","label":"Flirt","minutes":10,"tags":["romantic"],"acceptance":{"base":1.0}}],
    "socialRules":{"romanticTags":["romantic"],"defaultBond":"roommates"},
    "bondPresets":{"roommates":{"friendship":20},"parent":{"friendship":50,"kin":"parent"},
                   "siblings":{"friendship":40,"kin":"sibling"}},
    "economy":{"startingFunds":1000}}"#;

const TOWN: &str = r#"{"width":20,"depth":10,
    "plots":[{"name":"Home","x":0,"z":0,"w":10,"d":10,"entry":[5.5,9.5]},
             {"name":"Next door","x":10,"z":0,"w":10,"d":10,"entry":[15.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true},{"name":"Empty","plot":1}],
    "objects":[],
    "sims":[{"name":"Ada","x":4.5,"z":3.5,"age":50},{"name":"Bo","x":5.5,"z":3.5,"age":24}],
    "relationships":[{"a":1,"b":0,"preset":"parent"}]}"#;

fn spawn(name: &str, age: f32) -> SimSpawn {
    serde_json::from_value(serde_json::json!({"name": name, "x": 15.5, "z": 9.5, "age": age})).unwrap()
}

#[test]
fn parents_children_and_siblings() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    assert_eq!(w.relationships.kin(1, 0), Kin::Parent, "Ada is Bo's mother");
    assert_eq!(w.relationships.kin(0, 1), Kin::Child, "Bo is Ada's son");
    assert_eq!(w.relationships.get(0, 1).friendship, 50.0);
    // Family chat, but no flirting.
    assert!(w.apply(Command::Social { sim: 1, target: 0, social: 1 }).is_err());
    assert!(w.apply(Command::Social { sim: 1, target: 0, social: 0 }).is_ok());

    // Siblings moving in next door.
    let bonds = serde_json::from_value(serde_json::json!([{"a": 0, "b": 1, "preset": "siblings"}])).unwrap();
    w.apply(Command::MoveIn { household: 1, name: None, sims: vec![spawn("Cy", 30.0), spawn("Di", 28.0)], bonds }).unwrap();
    assert_eq!((w.relationships.kin(2, 3), w.relationships.kin(3, 2)), (Kin::Sibling, Kin::Sibling));

    // Kept in saves.
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.relationships.kin(1, 0), Kin::Parent);
    assert_eq!(loaded.relationships.kin(3, 2), Kin::Sibling);
}
