//! Skills, jobs by grade, rent and bills, the day/night rhythm, and build/buy on a small town.

use sim_core::social::EventKind;
use sim_core::{Command, World, clock, life};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02},
             {"id":"energy","label":"Energy","decayPerHour":0.05},
             {"id":"hygiene","label":"Hygiene","decayPerHour":0.01}],
    "skills":[{"id":"strength","label":"Strength"},{"id":"writing","label":"Writing"},{"id":"handiness","label":"Handiness"}],
    "skillRules":{"maxLevel":10,"workGainPerHour":0.05,"slowdown":0.25},
    "objects":[
      {"id":"bed","name":"Bed","footprint":[2,2],"slots":2,"price":500,"interactions":[
        {"id":"sleep","label":"Sleep","minutes":480,"pose":"lie","effects":{"energy":1.0},"tags":["sleep"]}]},
      {"id":"weights","name":"Weights","price":400,"interactions":[
        {"id":"lift","label":"Lift","minutes":60,"effects":{"hygiene":-0.2},"tags":["training"],"skills":{"strength":0.5}}]},
      {"id":"shower","name":"Shower","price":600,"interactions":[
        {"id":"shower","label":"Shower","minutes":30,"effects":{"hygiene":0.4},"tags":["hygiene"]}]},
      {"id":"rock","name":"Rock","interactions":[]}],
    "feelings":[{"id":"inDebt","label":"Worried","mood":-0.1,"hours":24}],
    "grades":[{"id":"A","label":"Entry","payPerHour":10,"skillLevel":0},
              {"id":"B","label":"Junior","payPerHour":20,"skillLevel":2},
              {"id":"C","label":"Senior","payPerHour":40,"skillLevel":4}],
    "careerCategories":[{"id":"press","label":"Press","shift":{"start":9,"hours":4,"days":[0,1,2,3,4]},
      "tracks":[{"id":"press.print","label":"Print","skills":{"writing":1,"strength":0.5},"titles":["Runner","Reporter","Editor"]}]}],
    "careerRules":{"performancePerShift":60,"probationLevels":1,"performancePerFit":0,
      "workweek":[{"fit":-99,"days":1,"label":"Probation"},{"fit":0,"days":0,"label":"Standard"},{"fit":2,"days":-1,"label":"Flexible"}]},
    "dayRhythm":{"wakeHour":7,"bedHour":22,"sleepTags":["sleep"],"asleepDecay":{"hunger":0.5}},
    "economy":{"startingFunds":1000,"rent":{"weekday":6,"hour":12,"base":100,"perTile":1,"billsBase":20,"billsRate":0.1,"debtFeeling":"inDebt"}},
    "objectRules":{"maxQuality":2,"qualityBonus":0.5,"upgradeCost":0.5,"resale":0.5},
    "build":{"wall":10,"door":50,"remove":5},
    "styles":[{"id":"modern","label":"Modern"},{"id":"cozy","label":"Cozy"}]}"#;

/// One 12×10 house plot with an open front (entry at the bottom).
const TOWN: &str = r#"{"width":12,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "objects":[{"def":"bed","x":1,"z":1,"rot":0},{"def":"weights","x":8,"z":1,"rot":0},{"def":"shower","x":10,"z":1,"rot":0}],
    "sims":[{"name":"Ada","x":5.5,"z":5.5},{"name":"Bo","x":6.5,"z":5.5}]}"#;

fn world() -> World {
    World::from_json(CONTENT, TOWN, 1).unwrap()
}

fn until(w: &mut World, day: u32, hour: f32) {
    let target = clock::tick_at(day, hour * 60.0).unwrap();
    while w.tick < target {
        w.tick_once();
    }
}

#[test]
fn categories_expand_into_graded_levels() {
    let w = world();
    let c = &w.content.careers[0];
    assert_eq!(c.levels.len(), 3);
    assert_eq!(c.levels[1].pay, 80, "grade B: $20/h x 4 h");
    assert_eq!(
        c.levels[2].requires,
        vec![(1, 4.0), (0, 2.0)],
        "writing 4, strength 2"
    );
}

#[test]
fn skills_decide_hiring_and_the_workweek() {
    let mut w = world();
    // Grade C needs writing 4: too far off even for probation.
    assert!(
        w.apply(Command::JoinCareer {
            sim: 0,
            career: 0,
            level: 2
        })
        .is_err()
    );
    // Grade B needs writing 2 / strength 1: one level short is probation (a sixth day).
    w.sims[0].skills[1] = 1.0;
    w.sims[0].skills[0] = 1.0;
    w.apply(Command::JoinCareer {
        sim: 0,
        career: 0,
        level: 1,
    })
    .unwrap();
    let job = w.sims[0].job.clone().unwrap();
    assert_eq!(
        life::work_days(&w.content, &job, &w.sims[0].skills).count_ones(),
        6
    );
    // Same weekly salary spread over six shifts.
    assert_eq!(life::shift_pay(&w.content, &job, &w.sims[0].skills), 67);
    // Two levels above the requirements: a four-day week at a higher day rate.
    w.sims[0].skills[1] = 4.0;
    w.sims[0].skills[0] = 3.0;
    assert_eq!(
        life::work_days(&w.content, &job, &w.sims[0].skills),
        0b0_1111
    );
    assert_eq!(life::shift_pay(&w.content, &job, &w.sims[0].skills), 100);
}

#[test]
fn work_trains_skills_and_promotion_waits_for_them() {
    let mut w = world();
    w.autonomy = false; // no home workouts: only work trains here
    w.apply(Command::JoinCareer {
        sim: 0,
        career: 0,
        level: 0,
    })
    .unwrap();
    until(&mut w, 4, 14.0);
    let s = &w.sims[0];
    assert!(
        s.skills[1] > 0.3,
        "writing practised at work: {}",
        s.skills[1]
    );
    assert!(
        s.skills[0] > 0.15 && s.skills[0] < s.skills[1],
        "strength at half weight: {:?}",
        &s.skills[..3]
    );
    // Performance filled up long ago, but grade B needs writing 2.
    let job = s.job.as_ref().unwrap();
    assert_eq!(job.level, 0);
    assert_eq!(job.performance, 100.0);
    w.sims[0].skills = [
        1.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    ];
    until(&mut w, 5, 14.0);
    assert_eq!(
        w.sims[0].job.as_ref().unwrap().level,
        1,
        "promoted once skilled"
    );
}

#[test]
fn training_objects_raise_skills_and_cost_needs() {
    let mut w = world();
    w.autonomy = false;
    w.apply(Command::Use {
        sim: 0,
        object: 1,
        interaction: 0,
    })
    .unwrap();
    let hygiene = w.sims[0].needs[2];
    for _ in 0..20 * 70 {
        w.tick_once();
    }
    assert!(
        w.sims[0].skills[0] > 0.4,
        "strength {}",
        w.sims[0].skills[0]
    );
    assert!(w.sims[0].needs[2] < hygiene - 0.15, "a workout is sweaty");
    assert!(w.events.iter().all(|e| e.kind != EventKind::SkillUp));
}

#[test]
fn two_sims_share_a_double_bed_and_sleep_until_morning() {
    let mut w = world();
    w.autonomy = false;
    until(&mut w, 1, 22.0);
    for sim in 0..2 {
        w.sims[sim as usize].needs[1] = 0.7;
        w.apply(Command::Use {
            sim,
            object: 0,
            interaction: 0,
        })
        .unwrap();
    }
    until(&mut w, 2, 5.0);
    assert_eq!(w.objects[0].users().count(), 2);
    assert_ne!(w.sims[0].pos, w.sims[1].pos, "each on their own side");
    // Energy is full, but it's still night: they stay in bed.
    assert!(w.sims[0].needs[1] > 0.99);
    until(&mut w, 2, 7.1);
    assert!(!w.objects[0].in_use(), "up in the morning");
}

#[test]
fn rent_and_bills_are_charged_weekly_and_debt_hurts() {
    let mut w = world();
    w.autonomy = false;
    // Rent: 100 + 1 per tile of the 12×10 plot. Bills: 20 + 10% of the $1,500 of furniture.
    assert_eq!(life::weekly_costs(&w, 0), Some((220, 170)));
    until(&mut w, 7, 12.5);
    assert_eq!(w.households[0].funds, 1000 - 390);
    assert!(
        w.events
            .iter()
            .any(|e| e.kind == EventKind::PaidRent && e.n == Some(390))
    );
    w.households[0].funds = 50;
    until(&mut w, 14, 12.5);
    assert_eq!(w.households[0].funds, -340);
    assert!(w.events.iter().any(|e| e.kind == EventKind::RentDebt));
    assert!(!w.sims[0].feelings.is_empty(), "worried about money");
}

#[test]
fn buying_selling_and_moving_objects() {
    let mut w = world();
    let id = w.buy(0, "shower", Some([4, 1, 0]), None).unwrap();
    assert_eq!(w.households[0].funds, 400);
    assert_eq!(
        life::weekly_costs(&w, 0),
        Some((220, 230)),
        "more stuff, higher bills"
    );
    assert!(
        w.buy(0, "shower", None, None).is_err(),
        "can't afford a second"
    );
    assert!(w.buy(0, "rock", None, None).is_err(), "not for sale");
    w.apply(Command::MoveObject {
        sim: 0,
        object: id,
        x: 4,
        z: 3,
        rot: 2,
    })
    .unwrap();
    let moved = w.objects.iter().find(|o| o.x == 4 && o.z == 3).unwrap();
    assert_eq!(moved.rot, 2);
    let id = moved.id;
    w.apply(Command::Sell { sim: 0, object: id }).unwrap();
    assert_eq!(w.households[0].funds, 700, "half back");
    assert_eq!(w.objects.len(), 3);
    assert_eq!(
        life::weekly_costs(&w, 0),
        Some((220, 170)),
        "selling lowers them again"
    );
    // Auto-placement finds a free spot.
    let id = w.buy(0, "weights", None, Some(1)).unwrap();
    assert_eq!(w.objects[id as usize].style, 1);
    // Off the plot, or blocking the only way in, is refused.
    assert!(w.buy(0, "weights", Some([5, 11, 0]), None).is_err());
}

#[test]
fn upgrades_are_instant_purchases_that_make_objects_better() {
    let mut w = world();
    w.autonomy = false;
    let version = w.structure_version();
    w.apply(Command::Upgrade { sim: 0, object: 2 }).unwrap();
    assert_eq!(w.objects[2].quality, 1, "no Sim task: done at once");
    assert_eq!(w.households[0].funds, 700, "costs half the price");
    assert_eq!(w.objects[2].value, 900);
    assert_eq!(
        life::weekly_costs(&w, 0),
        Some((220, 200)),
        "upgrades count too"
    );
    assert!(w.structure_version() > version);
    assert!(
        w.events
            .iter()
            .any(|e| e.kind == EventKind::Upgraded && e.n == Some(1))
    );
    assert!(w.sims[0].current().is_none() && w.sims[0].queue().next().is_none());
    w.apply(Command::Upgrade { sim: 0, object: 2 }).unwrap();
    assert!(
        w.apply(Command::Upgrade { sim: 0, object: 2 }).is_err(),
        "max quality 2"
    );
    assert!(
        w.apply(Command::Upgrade { sim: 0, object: 3 }).is_err(),
        "unknown object"
    );
    // A better shower cleans faster.
    let before = w.sims[1].needs[2];
    w.sims[1].needs[2] = 0.1;
    w.apply(Command::Use {
        sim: 1,
        object: 2,
        interaction: 0,
    })
    .unwrap();
    for _ in 0..20 * 25 {
        w.tick_once();
    }
    assert!(
        w.sims[1].needs[2] > 0.1 + 0.4 * 1.25,
        "{before} -> {}",
        w.sims[1].needs[2]
    );
}

#[test]
fn building_walls_costs_money_and_never_shuts_things_in() {
    use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind};
    let mut w = world();
    let edge = |axis, x, z, kind| EdgeEdit { axis, x, z, kind };
    // A corner room around the shower (x 9..12, z 0..3), closed by the lot edge on two sides.
    let mut room = vec![
        edge(EdgeAxis::V, 9, 0, EdgeKind::Wall),
        edge(EdgeAxis::V, 9, 1, EdgeKind::Wall),
        edge(EdgeAxis::V, 9, 2, EdgeKind::Wall),
    ];
    room.extend((9..12).map(|x| edge(EdgeAxis::H, x, 3, EdgeKind::Wall)));
    assert!(w.build(0, &room).is_err(), "would shut the shower in");
    room[4] = edge(EdgeAxis::H, 10, 3, EdgeKind::Door);
    let version = w.structure_version();
    w.build(0, &room).unwrap();
    assert_eq!(w.households[0].funds, 1000 - 5 * 10 - 50);
    assert!(w.structure_version() > version);
    assert!(
        w.build(
            0,
            &[EdgeEdit {
                axis: EdgeAxis::H,
                x: 3,
                z: 11,
                kind: EdgeKind::Wall
            }]
        )
        .is_err(),
        "off the plot"
    );
}

#[test]
fn empty_rooms_can_be_closed_before_their_door_goes_in() {
    use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind};
    let mut w = world();
    let edge = |axis, x, z, kind| EdgeEdit { axis, x, z, kind };
    // An empty corner room (x 0..3, z 7..10), closed by the lot edge on two sides.
    let mut room: Vec<_> = (0..3)
        .map(|x| edge(EdgeAxis::H, x, 7, EdgeKind::Wall))
        .collect();
    room.extend((7..10).map(|z| edge(EdgeAxis::V, 3, z, EdgeKind::Wall)));
    w.build(0, &room).unwrap();
    w.build(0, &[edge(EdgeAxis::V, 3, 8, EdgeKind::Door)])
        .unwrap();
    // A Sim can't be shut in, though: Ada stands on tile (5, 5).
    let cage = [
        edge(EdgeAxis::H, 5, 5, EdgeKind::Wall),
        edge(EdgeAxis::H, 5, 6, EdgeKind::Wall),
        edge(EdgeAxis::V, 5, 5, EdgeKind::Wall),
        edge(EdgeAxis::V, 6, 5, EdgeKind::Wall),
    ];
    let err = w.build(0, &cage).unwrap_err();
    assert!(err.to_string().contains("shut a resident"), "{err}");
}

#[test]
fn windows_go_into_walls_cost_money_and_never_let_sims_through() {
    use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind};
    use sim_core::lot::Edge;
    let mut w = world();
    let edge = |axis, x, z, kind| EdgeEdit { axis, x, z, kind };
    // A window needs a wall to go into.
    let err = w
        .build(0, &[edge(EdgeAxis::H, 4, 4, EdgeKind::Window)])
        .unwrap_err();
    assert!(err.to_string().contains("window"), "{err}");
    let err = w
        .build(0, &[edge(EdgeAxis::H, 4, 4, EdgeKind::Door)])
        .unwrap_err();
    assert!(err.to_string().contains("door"), "{err}");
    // The shower corner room (x 9..12, z 0..3) with a door, then windows in its walls.
    let mut room = vec![
        edge(EdgeAxis::V, 9, 0, EdgeKind::Wall),
        edge(EdgeAxis::V, 9, 1, EdgeKind::Wall),
        edge(EdgeAxis::V, 9, 2, EdgeKind::Wall),
    ];
    room.extend((9..12).map(|x| edge(EdgeAxis::H, x, 3, EdgeKind::Wall)));
    room[4] = edge(EdgeAxis::H, 10, 3, EdgeKind::Door);
    w.build(0, &room).unwrap();
    let funds = w.households[0].funds;
    // Windows default to 120 when the content doesn't price them.
    w.build(0, &[edge(EdgeAxis::V, 9, 1, EdgeKind::Window)])
        .unwrap();
    assert_eq!(w.households[0].funds, funds - 120);
    assert_eq!(w.lot.v_edge(9, 1), Edge::Window);
    assert!(!w.lot.edge_walkable(8, 1, 9, 1), "windows block like walls");
    // Setting the same window again is free.
    w.build(0, &[edge(EdgeAxis::V, 9, 1, EdgeKind::Window)])
        .unwrap();
    assert_eq!(w.households[0].funds, funds - 120);
    // Swapping the only door for a window would shut the shower in.
    let err = w
        .build(0, &[edge(EdgeAxis::H, 10, 3, EdgeKind::Window)])
        .unwrap_err();
    assert!(
        err.to_string().contains("shut a resident or an object in"),
        "{err}"
    );
    assert_eq!(w.lot.h_edge(10, 3), Edge::Door);
    // The structure lists walls and openings for the renderer.
    let view: serde_json::Value =
        serde_json::from_str(&sim_core::view::structure_json(&w)).unwrap();
    let openings = view["openings"].as_array().unwrap();
    assert!(openings.contains(&serde_json::json!({"axis":"v","x":9,"z":1,"kind":"window"})));
    assert!(openings.contains(&serde_json::json!({"axis":"h","x":10,"z":3,"kind":"door"})));
    assert_eq!(view["walls"].as_array().unwrap().len(), 6);
    // Removing tears the window down to an open edge.
    w.build(0, &[edge(EdgeAxis::V, 9, 1, EdgeKind::Open)])
        .unwrap();
    assert_eq!(w.lot.v_edge(9, 1), Edge::Open);
    // Saves keep windows.
    w.build(0, &[edge(EdgeAxis::V, 9, 2, EdgeKind::Window)])
        .unwrap();
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.lot.v_edge(9, 2), Edge::Window);
}

#[test]
fn skills_quality_and_style_survive_saving() {
    let mut w = world();
    w.sims[0].skills[1] = 3.5;
    w.objects[2].quality = 2;
    w.apply(Command::Restyle {
        sim: 0,
        object: 2,
        style: 1,
    })
    .unwrap();
    w.apply(Command::SetStyle { sim: 0, style: 1 }).unwrap();
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.sims[0].skills[1], 3.5);
    assert_eq!(loaded.objects[2].quality, 2);
    assert_eq!(loaded.objects[2].style, 1);
    assert_eq!(loaded.households[0].style, 1);
    assert_eq!(loaded.save_json(), w.save_json());
}
