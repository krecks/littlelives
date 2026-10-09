//! What the renderer is told a Sim is doing: the `object` and `action` snapshot fields,
//! interaction `anim` tags and their fallbacks.

use sim_core::snapshot::{self, HEADER_LEN, SIM_STRIDE, sim};
use sim_core::{Command, Content, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.01},
             {"id":"energy","label":"Energy","decayPerHour":0.01},
             {"id":"social","label":"Social","decayPerHour":0.01}],
    "animations":["eat","cook","sleep","talk"],
    "objects":[
      {"id":"fridge","name":"Fridge","price":100,"interactions":[
        {"id":"snack","label":"Snack","anim":"eat","minutes":30,"effects":{"hunger":0.5},"tags":["food"]},
        {"id":"meal","label":"Meal","minutes":30,"effects":{"hunger":0.5},"tags":["food","cooking"]},
        {"id":"stare","label":"Stare","minutes":30,"tags":["food"]}]},
      {"id":"bed","name":"Bed","footprint":[2,2],"price":100,"interactions":[
        {"id":"sleep","label":"Sleep","minutes":480,"pose":"lie","effects":{"energy":1.0},"tags":["sleep"]}]}],
    "socials":[
      {"id":"chat","label":"Chat","minutes":10,"tags":["social"],"acceptance":{"base":1.0},
       "needs":{"social":0.4},"targetNeeds":{"social":0.4}}],
    "bondPresets":{"roommates":{"friendship":20}},"socialRules":{"defaultBond":"roommates"},
    "economy":{"startingFunds":100}}"#;

const TOWN: &str = r#"{"width":14,"depth":14,
    "plots":[{"name":"Home","x":0,"z":0,"w":14,"d":14,"entry":[6.5,12.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "objects":[{"def":"fridge","x":1,"z":1,"rot":0},{"def":"fridge","x":5,"z":1,"rot":0},
               {"def":"bed","x":9,"z":1,"rot":0}],
    "sims":[{"name":"Ada","x":6.5,"z":8.5},{"name":"Bo","x":10.5,"z":10.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.autonomy = false;
    for s in &mut w.sims {
        s.needs = [0.5; 8];
    }
    w
}

/// `(object, action)` from the snapshot row of Sim `i`.
fn row(w: &World, i: usize) -> (f32, f32) {
    let mut out = vec![0.0; snapshot::CAPACITY];
    snapshot::write(w, &mut out);
    let o = HEADER_LEN + i * SIM_STRIDE;
    (out[o + sim::OBJECT], out[o + sim::ACTION])
}

fn action(w: &World, tag: &str) -> f32 {
    w.content.animations.iter().position(|a| a == tag).unwrap() as f32
}

fn use_object(w: &mut World, object: u32, interaction: usize) {
    w.apply(Command::Use {
        sim: 0,
        object,
        interaction,
    })
    .unwrap();
}

/// Ticks until Sim 0 is using its object (at most a minute of walking).
fn walk_up(w: &mut World) {
    for _ in 0..60 * sim_core::TICKS_PER_SECOND {
        w.tick_once();
        if !w.sims[0].is_moving() {
            return;
        }
    }
    panic!("never arrived");
}

#[test]
fn snapshot_carries_object_and_action_while_using() {
    let mut w = world();
    assert_eq!(row(&w, 0), (-1.0, -1.0), "idle");

    use_object(&mut w, 1, 0);
    w.tick_once();
    assert!(w.sims[0].is_moving());
    assert_eq!(
        row(&w, 0),
        (1.0, -1.0),
        "walking to the fridge: object set, no action yet"
    );
    walk_up(&mut w);
    assert_eq!(row(&w, 0), (1.0, action(&w, "eat")));
    assert_eq!(row(&w, 1), (-1.0, -1.0), "the other Sim is idle");

    // 40 game minutes (one per real second).
    for _ in 0..40 * sim_core::TICKS_PER_SECOND {
        w.tick_once();
    }
    assert!(w.sims[0].current().is_none(), "finished");
    assert_eq!(row(&w, 0), (-1.0, -1.0));
}

#[test]
fn interactions_without_anim_fall_back_to_their_tags() {
    let mut w = world();
    let fridge = &w.content.objects[0].interactions;
    assert_eq!(fridge[1].anim, Some(1), "cooking tag: cook, not eat");
    assert_eq!(fridge[2].anim, None, "'drink' isn't declared: none");
    assert_eq!(w.content.objects[1].interactions[0].anim, Some(2), "sleep");

    use_object(&mut w, 2, 0);
    walk_up(&mut w);
    assert_eq!(row(&w, 0), (2.0, action(&w, "sleep")));
}

#[test]
fn conversations_show_talk() {
    let mut w = world();
    w.apply(Command::Social {
        sim: 0,
        target: 1,
        social: 0,
    })
    .unwrap();
    let talk = action(&w, "talk");
    let mut talked = false;
    for _ in 0..60 * sim_core::TICKS_PER_SECOND {
        w.tick_once();
        if w.sims[0].conversation(&w.content).is_some() {
            talked = true;
            assert_eq!(row(&w, 0), (-1.0, talk));
            assert_eq!(row(&w, 1), (-1.0, talk), "the target talks too");
        }
    }
    assert!(talked);
}

#[test]
fn object_ids_stay_valid_after_a_sell() {
    let mut w = world();
    use_object(&mut w, 1, 0);
    walk_up(&mut w);
    let (x, z) = (w.objects[1].x, w.objects[1].z);

    // Selling an object listed before it shifts its id down by one.
    w.apply(Command::Sell { household: 0, object: 0 }).unwrap();
    let (object, act) = row(&w, 0);
    assert_eq!(object, 0.0);
    assert_eq!(act, action(&w, "eat"), "still eating");
    let used = &w.objects[object as usize];
    assert_eq!((used.x, used.z), (x, z), "the same fridge");
    assert!(used.users().any(|u| u == 0));

    // Selling the object in use stops the Sim.
    w.apply(Command::Sell { household: 0, object: 0 }).unwrap();
    assert_eq!(row(&w, 0), (-1.0, -1.0));
}

#[test]
fn unknown_anim_tags_are_rejected() {
    let bad = CONTENT.replace(r#""anim":"eat""#, r#""anim":"juggle""#);
    let err = Content::from_json(&bad).unwrap_err();
    assert!(
        err.0.contains("fridge.snack") && err.0.contains("unknown anim 'juggle'"),
        "{}",
        err.0
    );
    // Without an `animations` list, any `anim` is unknown.
    let undeclared = CONTENT.replace(r#""animations":["eat","cook","sleep","talk"],"#, "");
    assert!(Content::from_json(&undeclared).is_err());
}

#[test]
fn layout_lists_the_content_animations() {
    let w = world();
    let layout: serde_json::Value =
        serde_json::from_str(&snapshot::layout_json(&w.content)).unwrap();
    assert_eq!(
        layout["actions"],
        serde_json::json!(["eat", "cook", "sleep", "talk"])
    );
    assert_eq!(layout["sim"]["object"], sim::OBJECT);
    assert_eq!(layout["sim"]["action"], sim::ACTION);
}
