//! Children and teens: no romance, no jobs, no moving on their own, and never a household of
//! their own; babies don't choose anything.

use sim_core::lot::SimSpawn;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"fun","label":"Fun","decayPerHour":0.5}],
    "objects":[{"id":"toy","name":"Toy","price":20,"interactions":[
        {"id":"play","label":"Play","minutes":30,"effects":{"fun":0.6},"tags":["play"]}]}],
    "tags":["romantic"],
    "socials":[{"id":"chat","label":"Chat","minutes":10,"acceptance":{"base":1.0}},
               {"id":"flirt","label":"Flirt","minutes":10,"tags":["romantic"],"acceptance":{"base":1.0}}],
    "socialRules":{"romanticTags":["romantic"],"defaultBond":"roommates"},
    "bondPresets":{"roommates":{"friendship":20}},
    "skills":[{"id":"writing","label":"Writing"}],
    "grades":[{"id":"A","label":"Entry","payPerHour":10,"skillLevel":0}],
    "careerCategories":[{"id":"press","label":"Press","shift":{"start":13,"hours":4,"days":[0,1,2,3,4]},
      "tracks":[{"id":"press.print","label":"Print","skills":{"writing":1},"titles":["Runner"]}]}],
    "life":{"daysPerYear":2,"stages":[
        {"id":"baby","label":"Baby","from":0,"baby":true},
        {"id":"child","label":"Child","from":2,"school":true},
        {"id":"teen","label":"Teen","from":13,"school":true},
        {"id":"adult","label":"Adult","from":18}]},
    "economy":{"startingFunds":1000}}"#;

const TOWN: &str = r#"{"width":20,"depth":10,
    "plots":[{"name":"Home","x":0,"z":0,"w":10,"d":10,"entry":[5.5,9.5]},
             {"name":"Next door","x":10,"z":0,"w":10,"d":10,"entry":[15.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true},{"name":"Empty","plot":1}],
    "objects":[{"def":"toy","x":2,"z":2}],
    "sims":[{"name":"Ada","x":4.5,"z":3.5,"age":35},{"name":"Bo","x":5.5,"z":3.5,"age":16,
             "job":{"career":"press.print","level":0}},
            {"name":"Cy","x":6.5,"z":3.5,"age":17},{"name":"Dee","x":3.5,"z":3.5,"age":0.5}]}"#;

fn spawn(name: &str, age: f32) -> SimSpawn {
    serde_json::from_value(serde_json::json!({"name": name, "x": 15.5, "z": 9.5, "age": age})).unwrap()
}

#[test]
fn children_and_teens_are_not_grown_ups() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    assert!(w.sims[0].adult(&w.content) && !w.sims[1].adult(&w.content));
    assert!(w.sims[1].job.is_none(), "a teen placed in a job doesn't get it");
    let err = w.apply(Command::JoinCareer { sim: 1, career: 0, level: 0 }).unwrap_err();
    assert!(err.to_string().contains("too young"), "{err}");
    // Teens chat, but don't flirt (not even with each other).
    assert!(w.apply(Command::Social { sim: 1, target: 2, social: 1 }).is_err());
    assert!(w.apply(Command::Social { sim: 1, target: 2, social: 0 }).is_ok());

    // Children can't move in on their own; with a grown-up they can.
    let err = w.apply(Command::MoveIn { household: 1, name: None, sims: vec![spawn("Eli", 9.0)], bonds: vec![] }).unwrap_err();
    assert!(err.to_string().contains("grown-up"), "{err}");
    w.apply(Command::MoveIn { household: 1, name: None, sims: vec![spawn("Fay", 40.0), spawn("Eli", 9.0)], bonds: vec![] }).unwrap();
}

#[test]
fn babies_do_nothing_on_their_own() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.sims[3].needs[0] = 0.0;
    for _ in 0..2 * 60 * 20 {
        w.tick_once();
    }
    assert!(w.sims[3].current().is_none(), "the baby didn't go and play");
    assert!(w.sims[2].current().is_some() || w.sims[0].current().is_some(), "the others did something");
}

const SCHOOL: &str = r#"{
    "needs":[{"id":"fun","label":"Fun","decayPerHour":0.1}],
    "objects":[],
    "skills":[{"id":"intelligence","label":"Intelligence"}],
    "skillRules":{"maxLevel":10,"workGainPerHour":0.05},
    "life":{"daysPerYear":2,"stages":[
        {"id":"child","label":"Child","from":2,"school":true},
        {"id":"adult","label":"Adult","from":18}],
        "school":{"start":8,"hours":7,"days":[0,1,2,3,4],"skills":{"intelligence":1}}},
    "economy":{"startingFunds":1000}}"#;

#[test]
fn children_go_to_school_on_school_days() {
    let town = r#"{"width":10,"depth":10,
        "plots":[{"name":"Home","x":0,"z":0,"w":10,"d":10,"entry":[5.5,9.5]}],
        "households":[{"name":"Player","plot":0,"player":true}],
        "objects":[], "exits":[[5.5,9.9]],
        "sims":[{"name":"Ada","x":4.5,"z":3.5,"age":35},{"name":"Kit","x":5.5,"z":3.5,"age":9}]}"#;
    let mut w = World::from_json(SCHOOL, town, 1).unwrap();
    // Day 1 (Monday) from 08:00: off to school until 15:00, a little cleverer.
    let at = |w: &mut World, hour: f32| {
        let day = sim_core::clock::day(w.tick);
        let target = sim_core::clock::tick_at(day + u32::from(sim_core::clock::hour(w.tick) >= hour), hour * 60.0).unwrap();
        while w.tick < target {
            w.tick_once();
        }
    };
    at(&mut w, 10.0);
    assert!(w.sims[1].away_until.is_some(), "at school at 10:00");
    assert!(w.sims[0].away_until.is_none(), "the grown-up has no school");
    let ui: serde_json::Value = serde_json::from_str(&sim_core::view::ui_state_json(&w)).unwrap();
    let kit = ui["sims"].as_array().unwrap().iter().find(|s| s["name"] == "Kit").unwrap();
    assert_eq!(kit["actions"][0]["label"], "At school");
    at(&mut w, 17.0);
    assert!(w.sims[1].away_until.is_none(), "home after school");
    assert!(w.sims[1].skills[0] > 0.2, "learned something: {}", w.sims[1].skills[0]);
    // The weekend (day 6, Saturday): no school.
    for _ in 0..5 {
        at(&mut w, 10.0);
    }
    assert_eq!(sim_core::clock::weekday(sim_core::clock::day(w.tick)), 5);
    assert!(w.sims[1].away_until.is_none(), "no school on Saturday");
}

#[test]
fn teens_grow_up_into_young_adults() {
    use sim_core::social::EventKind;
    let content = SCHOOL
        .replace(r#"{"id":"adult","label":"Adult","from":18}"#, r#"{"id":"teen","label":"Teen","from":13,"school":true},{"id":"adult","label":"Adult","from":18}"#)
        .replace(r#""economy""#, r#""grades":[{"id":"A","label":"Entry","payPerHour":10,"skillLevel":0}],
            "careerCategories":[{"id":"press","label":"Press","shift":{"start":13,"hours":4,"days":[0,1,2,3,4]},
              "tracks":[{"id":"press.print","label":"Print","skills":{"intelligence":1},"titles":["Runner"]}]}],
            "economy""#);
    let town = r#"{"width":10,"depth":10,
        "plots":[{"name":"Home","x":0,"z":0,"w":10,"d":10,"entry":[5.5,9.5]}],
        "households":[{"name":"Player","plot":0,"player":true}],
        "objects":[], "exits":[[5.5,9.9]],
        "sims":[{"name":"Ada","x":4.5,"z":3.5,"age":45},{"name":"Kit","x":5.5,"z":3.5,"age":17.6}]}"#;
    let mut w = World::from_json(&content, town, 1).unwrap();
    assert!(w.apply(Command::JoinCareer { sim: 1, career: 0, level: 0 }).is_err(), "17: too young to work");
    for _ in 0..24 * 60 * 20 {
        w.tick_once();
    }
    assert!(w.sims[1].adult(&w.content), "18 now");
    assert!(w.events.iter().any(|e| e.kind == EventKind::GrewOlder && e.a == 1));
    w.apply(Command::JoinCareer { sim: 1, career: 0, level: 0 }).unwrap();
    // School is over: a weekday morning finds them at home (their shift starts at 13:00).
    let day = sim_core::clock::day(w.tick);
    let ten = sim_core::clock::tick_at(day + 2, 10.0 * 60.0).unwrap();
    while w.tick < ten {
        w.tick_once();
    }
    assert!(w.sims[1].away_until.is_none(), "no more school");
}

#[test]
fn school_grades_homework_and_finishing_school() {
    use sim_core::social::EventKind;
    let content = SCHOOL
        .replace(r#""objects":[],"#, r#""objects":[{"id":"desk","name":"Desk","price":100,"interactions":[
            {"id":"homework","label":"Do homework","minutes":45,"homework":10,"tags":["study"]}]}],
            "feelings":[{"id":"proud","label":"Proud","mood":0.1,"hours":24}],"#)
        .replace(r#""school":{"start":8,"hours":7,"days":[0,1,2,3,4],"skills":{"intelligence":1}}"#,
            r#""school":{"start":8,"hours":7,"days":[0,1,2,3,4],"skills":{"intelligence":1},
                "grades":{"attend":2,"mood":0,"missed":6,"start":60,"good":60,"goodFeeling":"proud"}}"#);
    let town = r#"{"width":10,"depth":10,
        "plots":[{"name":"Home","x":0,"z":0,"w":10,"d":10,"entry":[5.5,9.5]}],
        "households":[{"name":"Player","plot":0,"player":true}],
        "objects":[{"def":"desk","x":2,"z":2}], "exits":[[5.5,9.9]],
        "sims":[{"name":"Ada","x":4.5,"z":3.5,"age":35},{"name":"Kit","x":5.5,"z":3.5,"age":12}]}"#;
    let mut w = World::from_json(&content, town, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    assert_eq!(w.sims[1].grade, 60.0);
    // A day at school.
    for _ in 0..24 * 60 * 20 {
        w.tick_once();
    }
    assert!((w.sims[1].grade - 62.0).abs() < 0.01, "a school day: {}", w.sims[1].grade);
    // After the second school day, homework helps.
    for _ in 0..9 * 60 * 20 {
        w.tick_once();
    }
    assert!((w.sims[1].grade - 64.0).abs() < 0.01, "two school days: {}", w.sims[1].grade);
    w.apply(Command::Use { sim: 1, object: 0, interaction: 0 }).unwrap();
    for _ in 0..60 * 20 {
        w.tick_once();
    }
    assert!(w.sims[1].grade > 73.0, "homework: {}", w.sims[1].grade);
    // Finishing school with a good grade.
    w.sims[1].age = 17.6;
    w.apply(Command::SetSpeed { speed: 1 }).unwrap();
    for _ in 0..24 * 60 * 20 {
        w.tick_once();
    }
    let done = w.events.iter().find(|e| e.kind == EventKind::Graduated).expect("finished school");
    assert_eq!(done.a, 1);
    assert!(done.n.unwrap() >= 70);
    assert!(w.sims[1].feelings.iter().any(|f| w.content.feelings[f.def].id == "proud"));
}
