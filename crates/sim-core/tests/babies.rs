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
