//! Life cycle: residents age once a day at the lifespan's pace and move through life stages,
//! which bring a story event, a feeling and what the stage does to them.

use sim_core::lifecycle::Lifespan;
use sim_core::social::EventKind;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"energy","label":"Energy","decayPerHour":0.01}],
    "feelings":[{"id":"goldenYears","label":"Golden years","mood":0.05,"hours":24}],
    "life":{"daysPerYear":2,"startAge":[25,50],"stages":[
        {"id":"youngAdult","label":"Young adult","from":18},
        {"id":"adult","label":"Adult","from":30},
        {"id":"elder","label":"Elder","from":60,"feeling":"goldenYears",
         "effects":{"needDecay":{"energy":1.2},"walkSpeed":0.85}}]},
    "objects":[],
    "economy":{"startingFunds":1000}}"#;

const TOWN: &str = r#"{"width":12,"depth":10,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "sims":[{"name":"Ada","x":4.5,"z":3.5,"age":59.2},{"name":"Bo","x":5.5,"z":3.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w
}

fn days(w: &mut World, d: u32) {
    for _ in 0..d * 24 * 60 * 20 {
        w.tick_once();
    }
}

#[test]
fn residents_age_and_become_elders() {
    let mut w = world();
    assert_eq!(w.lifespan, Lifespan::Normal, "new games age at the normal pace");
    let bo = w.sims[1].age;
    assert!((25.0..=50.0).contains(&bo) && bo.fract() == 0.0, "a starting age from content: {bo}");
    assert_eq!(w.sims[0].mods.walk_speed, 1.0);

    // Two days a year: a year older after two midnights.
    days(&mut w, 2);
    assert!((w.sims[0].age - 60.2).abs() < 1e-3, "{}", w.sims[0].age);
    assert!((w.sims[1].age - (bo + 1.0)).abs() < 1e-3);
    let elder: Vec<_> = w.events.iter().filter(|e| e.kind == EventKind::GrewOlder).map(|e| (e.a, e.n)).collect();
    assert_eq!(elder, [(0, Some(2))], "Ada is an elder now");
    assert!(w.sims[0].feelings.iter().any(|f| w.content.feelings[f.def].id == "goldenYears"));
    assert!((w.sims[0].mods.walk_speed - 0.85).abs() < 1e-6, "elders walk slower");
    assert!((w.sims[0].mods.need_decay[0] - 1.2).abs() < 1e-6, "and tire sooner");

    // Saved and loaded with their ages and the elder's slower step.
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert!((loaded.sims[0].age - 60.2).abs() < 1e-3);
    assert!((loaded.sims[0].mods.walk_speed - 0.85).abs() < 1e-6);
    assert_eq!(loaded.lifespan, Lifespan::Normal);
}

#[test]
fn the_lifespan_sets_the_pace_and_off_stops_it() {
    let mut w = world();
    w.apply(Command::SetLifespan { lifespan: Lifespan::Long }).unwrap();
    days(&mut w, 4);
    assert!((w.sims[0].age - 60.2).abs() < 1e-3, "long: four days a year");
    w.apply(Command::SetLifespan { lifespan: Lifespan::Off }).unwrap();
    days(&mut w, 4);
    assert!((w.sims[0].age - 60.2).abs() < 1e-3, "off: nobody ages");
}

#[test]
fn older_saves_load_with_aging_off() {
    let w = world();
    let mut save: serde_json::Value = serde_json::from_str(&w.save_json()).unwrap();
    save["version"] = 12.into();
    save.as_object_mut().unwrap().remove("lifespan");
    for s in save["sims"].as_array_mut().unwrap() {
        s.as_object_mut().unwrap().remove("age");
    }
    let loaded = World::from_save_json(CONTENT, &save.to_string()).unwrap();
    assert_eq!(loaded.lifespan, Lifespan::Off, "an older game doesn't start aging by surprise");
    assert!((25.0..=50.0).contains(&loaded.sims[0].age));
}

const LATER_LIFE: &str = r#"{
    "needs":[{"id":"energy","label":"Energy","decayPerHour":0.0}],
    "objects":[],
    "feelings":[{"id":"retired","label":"Retired","mood":0.06,"hours":48},
                {"id":"grieving","label":"Grieving","mood":-0.3,"hours":96},
                {"id":"missesSomeone","label":"Misses someone","mood":-0.1,"hours":48}],
    "skills":[{"id":"writing","label":"Writing"}],
    "grades":[{"id":"A","label":"Entry","payPerHour":10,"skillLevel":0}],
    "careerCategories":[{"id":"press","label":"Press","shift":{"start":9,"hours":4,"days":[0,1,2,3,4]},
      "tracks":[{"id":"press.print","label":"Print","skills":{"writing":1},"titles":["Runner"]}]}],
    "careerRules":{"market":{"hour":10,"minShiftsBeforeQuit":99,"quitBelow":0}},
    "life":{"daysPerYear":1,"stages":[{"id":"adult","label":"Adult","from":18},{"id":"elder","label":"Elder","from":60}],
            "retireAt":65,"pension":0.4,"retireFeeling":"retired",
            "death":{"from":75,"perYear":1.0,"growth":0.0},
            "grief":{"feeling":"grieving","lightFeeling":"missesSomeone"}},
    "bondPresets":{"roommates":{"friendship":20},"friends":{"friendship":45},"child":{"friendship":50,"kin":"child"}},
    "economy":{"startingFunds":1000,"rent":{"weekday":6,"hour":12,"base":100,"perTile":1,"billsBase":20,"billsRate":0.1}}}"#;

const ELDERS: &str = r#"{"width":20,"depth":10,
    "plots":[{"name":"Home","x":0,"z":0,"w":10,"d":10,"entry":[5.5,9.5]},
             {"name":"Next door","x":10,"z":0,"w":10,"d":10,"entry":[15.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true},{"name":"Neighbours","plot":1}],
    "objects":[],
    "sims":[{"name":"Ada","x":4.5,"z":3.5,"age":64.5,"job":{"career":"press.print","level":0}},
            {"name":"Bo","x":5.5,"z":3.5,"age":30},
            {"name":"Cy","x":14.5,"z":3.5,"age":30,"household":1},
            {"name":"Di","x":15.5,"z":3.5,"age":30,"household":1}],
    "relationships":[{"a":0,"b":1,"preset":"child"},{"a":0,"b":2,"preset":"friends"}]}"#;

#[test]
fn working_residents_retire_with_a_pension() {
    let mut w = World::from_json(LATER_LIFE, ELDERS, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    days(&mut w, 1);
    assert!(w.sims[0].retired && w.sims[0].job.is_none(), "65: retired");
    assert_eq!(w.sims[0].pension, 80, "40% of 5 shifts of 4 hours at $10");
    assert!(w.events.iter().any(|e| e.kind == EventKind::Retired && e.a == 0));
    assert!(w.sims[0].feelings.iter().any(|f| w.content.feelings[f.def].id == "retired"));
    // Saved retired.
    let loaded = World::from_save_json(LATER_LIFE, &w.save_json()).unwrap();
    assert_eq!((loaded.sims[0].retired, loaded.sims[0].pension), (true, 80));
    // The pension comes in on rent day.
    let costs = sim_core::life::weekly_costs(&w, 0).map_or(0, |(r, b)| r + b);
    let funds = w.households[0].funds;
    days(&mut w, 7);
    assert_eq!(w.households[0].funds, funds + 80 - costs);
}

#[test]
fn the_old_pass_away_and_are_mourned() {
    let mut w = World::from_json(LATER_LIFE, ELDERS, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w.sims[0].age = 80.0;
    w.apply(Command::SetLifespan { lifespan: Lifespan::Off }).unwrap();
    days(&mut w, 3);
    assert!(w.sims[0].here(), "nobody dies when nobody ages");
    w.apply(Command::SetLifespan { lifespan: Lifespan::Normal }).unwrap();
    for _ in 0..30 {
        days(&mut w, 1);
        if !w.sims[0].here() {
            break;
        }
    }
    assert!(!w.sims[0].here(), "a certain death in this content");
    assert_eq!(w.sims[0].gone.unwrap().why, sim_core::world::GoneWhy::Died);
    assert!(w.events.iter().any(|e| e.kind == EventKind::Died && e.a == 0));
    let feels = |i: usize, id: &str| w.sims[i].feelings.iter().any(|f| w.content.feelings[f.def].id == id);
    assert!(feels(1, "grieving"), "her son grieves");
    assert!(feels(2, "missesSomeone"), "a friend misses her");
    assert!(!feels(3, "grieving") && !feels(3, "missesSomeone"), "a stranger doesn't");
}
