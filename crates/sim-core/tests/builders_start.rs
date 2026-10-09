//! The builder's start (0.9): Creative or Living per game, a home with nobody living in it yet
//! (build first), and a family moving in later. Build and buy are addressed to the household.

use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind};
use sim_core::lot::{BondRaw, SimSpawn};
use sim_core::social::EventKind;
use sim_core::world::GameMode;
use sim_core::{Command, World, clock, life};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "traits":[{"id":"neat","label":"Neat"}],
    "objects":[{"id":"chair","name":"Chair","price":50,"interactions":[
        {"id":"sit","label":"Sit","minutes":10,"pose":"sit","tags":["rest"]}]}],
    "bondPresets":{"roommates":{"friendship":20},"partners":{"friendship":60,"romance":60,"partners":true}},
    "socialRules":{"defaultBond":"roommates"},
    "rules":{"maxHousehold":3},
    "economy":{"startingFunds":1000,"rent":{"weekday":6,"hour":12,"base":100,"perTile":1,"billsBase":20,"billsRate":0.1}},
    "build":{"wall":10,"door":50,"window":40,"remove":0}}"#;

/// Two 12×10 homes: the player's (household 0, plot 0) is empty; the Brooks live next door.
fn town(mode: &str) -> String {
    format!(
        r#"{{"mode":"{mode}","width":24,"depth":12,
        "plots":[{{"name":"1 Elm Street","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}},
                 {{"name":"3 Elm Street","x":12,"z":0,"w":12,"d":10,"entry":[18.5,9.5]}}],
        "households":[{{"name":"1 Elm Street","plot":0,"player":true,"funds":5000}},{{"name":"Brook","plot":1}}],
        "sims":[{{"name":"Bea","household":1,"x":17.5,"z":5.5}}]}}"#
    )
}

fn world(mode: &str) -> World {
    let mut w = World::from_json(CONTENT, &town(mode), 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w
}

fn until(w: &mut World, day: u32, hour: f32) {
    let target = clock::tick_at(day, hour * 60.0).unwrap();
    while w.tick < target {
        w.tick_once();
    }
}

/// A 3×3 room in the corner of the player's lot, with a door.
fn room() -> Vec<EdgeEdit> {
    let mut edits = Vec::new();
    for i in 1..4 {
        edits.push(EdgeEdit::new(EdgeAxis::H, i, 1, EdgeKind::Wall));
        edits.push(EdgeEdit::new(EdgeAxis::H, i, 4, if i == 2 { EdgeKind::Door } else { EdgeKind::Wall }));
        edits.push(EdgeEdit::new(EdgeAxis::V, 1, i, EdgeKind::Wall));
        edits.push(EdgeEdit::new(EdgeAxis::V, 4, i, EdgeKind::Wall));
    }
    edits
}

fn spawn(name: &str, x: f32) -> SimSpawn {
    serde_json::from_value(serde_json::json!({"name": name, "x": x, "z": 9.5, "traits": ["neat"]})).unwrap()
}

#[test]
fn an_empty_home_can_be_built_and_furnished() {
    let mut w = world("living");
    assert_eq!(w.mode, GameMode::Living);
    assert!(w.sims.iter().all(|s| s.household != 0), "nobody lives there yet");
    w.apply(Command::Build { household: 0, edits: room() }).unwrap();
    w.apply(Command::Buy { household: 0, object: "chair".into(), at: Some([2, 2, 0]), style: None }).unwrap();
    assert_eq!(w.households[0].funds, 5000 - 11 * 10 - 50 - 50, "11 walls, a door and a chair");
    assert_eq!(w.undo_steps(0), 2);
    w.apply(Command::Undo { household: 0 }).unwrap();
    assert_eq!(w.households[0].funds, 5000 - 11 * 10 - 50);

    // Building on someone else's lot is refused, and an unknown household too.
    let edit = [EdgeEdit::new(EdgeAxis::H, 14, 2, EdgeKind::Wall)];
    assert!(w.apply(Command::Build { household: 0, edits: edit.to_vec() }).is_err());
    assert!(w.apply(Command::Build { household: 7, edits: room() }).is_err());

    // An empty home pays nothing and gets no visitors; the town lives on around it.
    assert_eq!(life::weekly_costs(&w, 0), None, "nothing to pay while nobody lives there");
    let funds = w.households[0].funds;
    w.apply(Command::SetAutonomy { enabled: true, household: None }).unwrap();
    until(&mut w, 8, 13.0);
    assert_eq!(w.households[0].funds, funds);
    assert!(w.sims.iter().all(|s| s.visiting.is_none_or(|v| v.plot != 0)));
}

#[test]
fn creative_building_is_free_and_the_home_pays_no_bills() {
    let mut w = world("creative");
    w.apply(Command::Build { household: 0, edits: room() }).unwrap();
    w.apply(Command::Buy { household: 0, object: "chair".into(), at: Some([2, 2, 0]), style: None }).unwrap();
    let chair = w.objects.len() as u32 - 1;
    w.apply(Command::Upgrade { household: 0, object: chair }).unwrap();
    assert_eq!(w.households[0].funds, 5000, "building, buying and upgrading cost nothing");
    w.apply(Command::Sell { household: 0, object: chair }).unwrap();
    assert_eq!(w.households[0].funds, 5000, "selling what was free brings nothing");
    // Undo still takes edits back.
    w.apply(Command::Undo { household: 0 }).unwrap();
    assert_eq!(w.objects.len() as u32, chair + 1);

    // A family moves in: the player's home has no rent or bills, the neighbours still pay.
    w.apply(Command::MoveIn { household: 0, name: Some("Ito".into()), sims: vec![spawn("Kai", 6.5)], bonds: vec![] }).unwrap();
    assert_eq!(life::weekly_costs(&w, 0), None);
    assert!(life::weekly_costs(&w, 1).is_some());
    let neighbours = w.households[1].funds;
    until(&mut w, 7, 12.5);
    assert!(w.households[1].funds < neighbours, "the Brooks paid");
    assert!(w.households[0].funds >= 5000, "the player's home didn't");
}

#[test]
fn a_family_moves_in_later() {
    let mut w = world("living");
    w.apply(Command::Build { household: 0, edits: room() }).unwrap();
    let funds = w.households[0].funds;
    w.apply(Command::MoveIn {
        household: 0,
        name: Some(" Ito ".into()),
        sims: vec![spawn("Kai", 6.5), spawn("Mia", 7.5)],
        bonds: vec![BondRaw { a: 0, b: 1, preset: "partners".into() }],
    })
    .unwrap();
    assert_eq!(w.households[0].name, "Ito");
    assert_eq!(w.households[0].funds, funds, "the home's money is the family's");
    let (kai, mia) = (1, 2);
    assert_eq!(w.sims[kai].name, "Kai");
    assert_eq!([w.sims[kai].household, w.sims[mia].household], [0, 0]);
    assert_eq!(w.relationships.partner_of(kai), Some(mia));
    assert_eq!(w.relationships.get(kai, mia).friendship, 60.0, "their bond, not the roommates default");
    assert!(!w.relationships.get(kai, 0).met, "the new neighbours haven't met yet");
    let moved: Vec<_> = w.events.iter().filter(|e| e.kind == EventKind::MovedIn).map(|e| e.a).collect();
    assert_eq!(moved, [kai as u32]);

    // Once someone lives there, the home pays rent and bills.
    assert!(life::weekly_costs(&w, 0).is_some());
    until(&mut w, 7, 12.5);
    assert!(w.households[0].funds < funds);

    // Save and load: the mode, the household and its new residents stay.
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.mode, GameMode::Living);
    assert_eq!(loaded.households[0].name, "Ito");
    assert_eq!(loaded.sims.iter().filter(|s| s.household == 0).count(), 2);
    assert_eq!(loaded.relationships.partner_of(kai), Some(mia));
}

#[test]
fn moving_in_is_all_or_nothing() {
    let mut w = world("living");
    let mut odd = spawn("Mia", 7.5);
    odd.traits = vec!["unknown".into()];
    assert!(w.apply(Command::MoveIn { household: 0, name: Some("Ito".into()), sims: vec![spawn("Kai", 6.5), odd], bonds: vec![] }).is_err());
    assert_eq!(w.sims.len(), 1, "Kai didn't move in alone");
    assert_eq!(w.relationships.len(), 1);
    assert_eq!(w.households[0].name, "1 Elm Street");

    // Bonds only between the new residents; households have room for `maxHousehold`.
    let bad = BondRaw { a: 0, b: 1, preset: "partners".into() };
    assert!(w.apply(Command::MoveIn { household: 0, name: None, sims: vec![spawn("Kai", 6.5)], bonds: vec![bad] }).is_err());
    let four = ["A", "B", "C", "D"].map(|n| spawn(n, 6.5)).to_vec();
    assert!(w.apply(Command::MoveIn { household: 0, name: None, sims: four, bonds: vec![] }).is_err());
    assert!(w.apply(Command::MoveIn { household: 0, name: None, sims: vec![], bonds: vec![] }).is_err());
    assert_eq!(w.sims.len(), 1);

    // A household without a home has nowhere to move into.
    w.households[1].plot = None;
    assert!(w.apply(Command::MoveIn { household: 1, name: None, sims: vec![spawn("Kai", 6.5)], bonds: vec![] }).is_err());
}

#[test]
fn saves_from_before_the_mode_load_as_living() {
    let w = world("creative");
    let mut save: serde_json::Value = serde_json::from_str(&w.save_json()).unwrap();
    assert_eq!(save["mode"], "creative");
    let creative = World::from_save_json(CONTENT, &save.to_string()).unwrap();
    assert_eq!(creative.mode, GameMode::Creative);
    save.as_object_mut().unwrap().remove("mode");
    save["version"] = 9.into();
    let old = World::from_save_json(CONTENT, &save.to_string()).unwrap();
    assert_eq!(old.mode, GameMode::Living);
    assert_eq!(old.households[0].name, "1 Elm Street", "an empty household loads too");
}
