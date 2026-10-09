//! The story names content (objects, accidents, life stages, skills, careers, goals) by id in
//! saves, so a save loaded with changed content still tells the same story.

use sim_core::World;
use sim_core::social::EventKind;

fn content(objects: &str) -> String {
    format!(
        r#"{{"needs":[{{"id":"fun","label":"Fun","decayPerHour":0.0}}],
        "objects":[{objects}],
        "economy":{{"startingFunds":1000}}}}"#
    )
}

const CHAIR: &str = r#"{"id":"chair","name":"Chair","price":100,"interactions":[]}"#;
const LAMP: &str = r#"{"id":"lamp","name":"Lamp","price":50,"interactions":[]}"#;
const CRIB: &str = r#"{"id":"crib","name":"Crib","price":350,"interactions":[]}"#;

const TOWN: &str = r#"{"width":10,"depth":10,
    "plots":[{"name":"Home","x":0,"z":0,"w":10,"d":10,"entry":[5.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "objects":[], "sims":[{"name":"Ada","x":4.5,"z":3.5}]}"#;

fn broke(w: &World) -> Vec<String> {
    w.events
        .iter()
        .filter(|e| e.kind == EventKind::Broke)
        .map(|e| w.content.objects[e.n.unwrap() as usize].id.clone())
        .collect()
}

#[test]
fn a_story_survives_content_changes() {
    let before = content(&format!("{CHAIR},{LAMP}"));
    let mut w = World::from_json(&before, TOWN, 1).unwrap();
    w.events.push_detail(w.tick, EventKind::Broke, 0, Some(1), None);
    assert_eq!(broke(&w), ["lamp"]);
    // New content puts something before the lamp: the story still says the lamp broke.
    let after = content(&format!("{CRIB},{CHAIR},{LAMP}"));
    let loaded = World::from_save_json(&after, &w.save_json()).unwrap();
    assert_eq!(broke(&loaded), ["lamp"]);
    // Content without the lamp at all: that event goes rather than naming something else.
    let without = content(CHAIR);
    let loaded = World::from_save_json(&without, &w.save_json()).unwrap();
    assert!(broke(&loaded).is_empty());
}

#[test]
fn older_saves_from_before_the_crib_are_migrated() {
    // Base objects, then a pack's lamp; the crib came at the end of the base objects in 0.13.
    let old = content(&format!("{CHAIR},{LAMP}"));
    let mut w = World::from_json(&old, TOWN, 1).unwrap();
    w.events.push_detail(w.tick, EventKind::Broke, 0, Some(1), None);
    let mut save: serde_json::Value = serde_json::from_str(&w.save_json()).unwrap();
    save["version"] = 13.into();
    for e in save["events"].as_array_mut().unwrap() {
        e.as_object_mut().unwrap().remove("refs");
    }
    let now = content(&format!("{CHAIR},{CRIB},{LAMP}"));
    let loaded = World::from_save_json(&now, &save.to_string()).unwrap();
    assert_eq!(broke(&loaded), ["lamp"]);
}
