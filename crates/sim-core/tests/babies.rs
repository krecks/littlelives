//! Babies: they lie in a crib at home and grown-ups care for them there (feeding, changing,
//! playing fill the baby's needs); a baby who needs something cries; a crib comes with a baby
//! who moves into a home without one; and a baby who grows into a child gets out.

use sim_core::lot::SimSpawn;
use sim_core::planner::ThoughtKind;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.1},{"id":"energy","label":"Energy","decayPerHour":0.02},
             {"id":"fun","label":"Fun","decayPerHour":0.0}],
    "objects":[{"id":"crib","name":"Crib","price":350,"footprint":[2,1],"slots":2,"interactions":[
        {"id":"lie","label":"Lie in the crib","minutes":720,"pose":"lie","baby":true,"autonomous":false,"effects":{"energy":1.0},"tags":["rest"]},
        {"id":"feed","label":"Feed the baby","minutes":15,"care":{"hunger":0.8},"tags":["care"]}]},
      {"id":"armchair","name":"Armchair","price":100,"interactions":[
        {"id":"sit","label":"Sit","minutes":30,"pose":"sit","effects":{"fun":0.3},"tags":["lounge"]}]}],
    "life":{"daysPerYear":2,"stages":[
        {"id":"baby","label":"Baby","from":0,"baby":true},
        {"id":"child","label":"Child","from":2,"school":true},
        {"id":"adult","label":"Adult","from":18}]},
    "bondPresets":{"roommates":{"friendship":20},"parent":{"friendship":50,"kin":"parent"}},
    "economy":{"startingFunds":1000}}"#;

const TOWN: &str = r#"{"width":20,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":10,"d":12,"entry":[5.5,11.5]},
             {"name":"Next door","x":10,"z":0,"w":10,"d":12,"entry":[15.5,11.5]}],
    "households":[{"name":"Player","plot":0,"player":true},{"name":"Empty","plot":1}],
    "objects":[{"def":"crib","x":2,"z":2},{"def":"armchair","x":6,"z":6}],
    "sims":[{"name":"Ada","x":4.5,"z":8.5,"age":30},{"name":"Bea","x":5.5,"z":8.5,"age":0.5}],
    "relationships":[{"a":1,"b":0,"preset":"parent"}]}"#;

fn minutes(w: &mut World, m: u32) {
    for _ in 0..m * 20 {
        w.tick_once();
    }
}

#[test]
fn babies_lie_in_the_crib_and_are_fed() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    minutes(&mut w, 1);
    assert_eq!(w.sims[1].pose, sim_core::content::Pose::Lie, "Bea is in the crib");
    assert!(w.objects[0].users().any(|u| u == 1));

    // Hungry: she cries, and Ada feeds her.
    w.sims[1].needs[0] = 0.1;
    minutes(&mut w, 1);
    assert!(w.sims[1].planner.thought.is_some_and(|t| t.kind == ThoughtKind::Crying));
    let mut fed = false;
    for _ in 0..90 {
        minutes(&mut w, 1);
        fed |= w.sims[0].current().is_some_and(|a| matches!(a.task.kind, sim_core::world::TaskKind::Use { object: 0, interaction: 1 }));
    }
    assert!(fed, "Ada fed the baby");
    assert!(w.sims[1].needs[0] > 0.6, "and Bea isn't hungry now: {}", w.sims[1].needs[0]);
    assert_eq!(w.sims[1].pose, sim_core::content::Pose::Lie, "still in the crib");

    // Two years on (four days at two a year) she's a child and gets out.
    for _ in 0..4 {
        minutes(&mut w, 24 * 60);
    }
    assert!(!w.content.life.baby(w.sims[1].age));
    assert!(!w.objects[0].users().any(|u| u == 1), "out of the crib");
}

#[test]
fn a_baby_moving_in_comes_with_a_crib() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    let spawn = |name: &str, age: f32| -> SimSpawn {
        serde_json::from_value(serde_json::json!({"name": name, "x": 15.5, "z": 11.5, "age": age})).unwrap()
    };
    let cribs = |w: &World| w.objects.iter().filter(|o| w.content.objects[o.def].id == "crib").count();
    assert_eq!(cribs(&w), 1);
    w.apply(Command::MoveIn { household: 1, name: None, sims: vec![spawn("Cal", 28.0), spawn("Dot", 0.2)], bonds: vec![] }).unwrap();
    assert_eq!(cribs(&w), 2, "a crib for Dot next door");
    minutes(&mut w, 1);
    assert_eq!(w.sims[3].pose, sim_core::content::Pose::Lie, "Dot is in it");
}

const FAMILY: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.0}],
    "objects":[{"id":"crib","name":"Crib","price":350,"footprint":[2,1],"slots":2,"interactions":[
        {"id":"lie","label":"Lie in the crib","minutes":720,"pose":"lie","baby":true,"autonomous":false,"effects":{"hunger":0.0},"tags":["rest"]}]}],
    "genders":[{"id":"female","label":"Female"},{"id":"male","label":"Male"}],
    "names":{"first":["Ivy","Jun"],"last":["Moss"]},
    "tags":["romantic"],
    "socials":[{"id":"tryForBaby","label":"Try for a baby","minutes":30,"tags":["romantic"],"requires":{"partners":true},
                "acceptance":{"base":1.0},"success":{"effect":"conceive"}}],
    "socialRules":{"romanticTags":["romantic"]},
    "life":{"daysPerYear":2,"stages":[
        {"id":"baby","label":"Baby","from":0,"baby":true},
        {"id":"child","label":"Child","from":2,"school":true},
        {"id":"adult","label":"Adult","from":18}],
        "pregnancy":{"chance":1.0,"days":2,"maxAge":50},"adoption":{"cost":500}},
    "bondPresets":{"partners":{"friendship":55,"romance":75,"partners":true},"parent":{"friendship":50,"kin":"parent"},
                   "siblings":{"friendship":40,"kin":"sibling"}},
    "rules":{"maxHousehold":4},
    "economy":{"startingFunds":1000}}"#;

const COUPLE: &str = r#"{"width":12,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":12,"entry":[5.5,11.5]}],
    "households":[{"name":"Moss","plot":0,"player":true}],
    "objects":[],
    "sims":[{"name":"Ada","x":4.5,"z":8.5,"age":30,"gender":"female"},{"name":"Ben","x":5.5,"z":8.5,"age":32,"gender":"male"}],
    "relationships":[{"a":0,"b":1,"preset":"partners"}]}"#;

#[test]
fn partners_have_a_baby() {
    use sim_core::social::{EventKind, Kin};
    let mut w = World::from_json(FAMILY, COUPLE, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w.apply(Command::Social { sim: 0, target: 1, social: 0 }).unwrap();
    minutes(&mut w, 60);
    let e = w.households[0].expecting.expect("expecting");
    assert_eq!(e.parents, [0, 1]);
    assert!(w.events.iter().any(|e| e.kind == EventKind::Expecting));
    // Saved expecting.
    let loaded = World::from_save_json(FAMILY, &w.save_json()).unwrap();
    assert_eq!(loaded.households[0].expecting, Some(e));
    // Born two days later, into a crib that came for them.
    minutes(&mut w, 3 * 24 * 60);
    assert_eq!(w.sims.len(), 3, "a baby");
    let baby = &w.sims[2];
    assert!(w.content.life.baby(baby.age) && ["Ivy", "Jun"].contains(&baby.name.as_str()));
    assert_eq!(baby.appearance["parents"], serde_json::json!([0, 1]), "looks from the parents");
    assert_eq!((w.relationships.kin(2, 0), w.relationships.kin(0, 2)), (Kin::Parent, Kin::Child));
    assert!(w.events.iter().any(|e| e.kind == EventKind::Born && e.a == 2 && e.b == 0 && e.c == Some(1)));
    assert!(w.households[0].expecting.is_none());
    assert_eq!(w.objects.iter().filter(|o| w.content.objects[o.def].id == "crib").count(), 1);
    assert_eq!(w.sims[2].pose, sim_core::content::Pose::Lie, "in the crib");
}

#[test]
fn adopting_a_child() {
    use sim_core::social::Kin;
    let mut w = World::from_json(FAMILY, COUPLE, 1).unwrap();
    w.apply(Command::Adopt { household: 0, child: true }).unwrap();
    let kid = &w.sims[2];
    assert!((3.0..11.0).contains(&kid.age), "a child: {}", kid.age);
    assert_eq!((w.relationships.kin(2, 0), w.relationships.kin(2, 1)), (Kin::Parent, Kin::Parent), "both are parents");
    assert_eq!(w.households[0].funds, 500, "adoption costs");
    w.apply(Command::Adopt { household: 0, child: false }).unwrap();
    assert_eq!(w.relationships.kin(3, 2), Kin::Sibling, "a little brother or sister");
    let err = w.apply(Command::Adopt { household: 0, child: false }).unwrap_err();
    assert!(err.to_string().contains("money") || err.to_string().contains("room"), "{err}");
}

#[test]
fn neighbours_adopt_now_and_then() {
    let content = FAMILY.replace(r#""adoption":{"cost":500}"#, r#""adoption":{"cost":500,"neighbours":1.0},"newcomers":{"hour":12,"days":1000}"#);
    let town = COUPLE.replace(r#""player":true"#, r#""player":false"#)
        .replace(r#""households":[{"name":"Moss","plot":0,"player":false}]"#, r#""households":[{"name":"Moss","plot":0,"player":false},{"name":"Player","player":true}]"#)
        .replace(r#""economy""#, r#""economy""#);
    let mut w = World::from_json(&content, &town, 1).unwrap();
    w.households[0].funds = 5000;
    minutes(&mut w, 24 * 60);
    assert!(w.events.iter().any(|e| e.kind == sim_core::social::EventKind::Adopted), "the neighbours adopted");
    assert_eq!(w.households[0].funds, 4500);
}
