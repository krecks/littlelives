//! Opinions and home wishes: residents love or dislike the rooms they're in, wish a disliked
//! room better (in its weakest factor), broken things fixed and a second bathroom when the one
//! they have is always taken (for needs with an accident); the wishes go once they come true.

use sim_core::planner::{HomeWish, ThoughtKind};
use sim_core::rooms::FACTORS;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"bladder","label":"Bladder","decayPerHour":0.0}],
    "feelings":[{"id":"lovesRoom","label":"Loves this room","mood":0.06,"hours":4},
                {"id":"dislikesRoom","label":"Dislikes this room","mood":-0.05,"hours":3}],
    "objects":[
      {"id":"toilet","name":"Toilet","price":100,"interactions":[
        {"id":"use","label":"Use","minutes":180,"effects":{"bladder":0.1},"tags":["bathroom"]}]},
      {"id":"sofa","name":"Sofa","price":100,"footprint":[2,1],"interactions":[
        {"id":"sit","label":"Sit","minutes":30,"tags":["lounge"]}]},
      {"id":"vase","name":"Vase","price":30,"category":"decor","decor":2}],
    "roomKinds":[
      {"id":"bathroom","tags":["bathroom"],"essentials":[["bathroom"]],"size":[3,6],"exclusive":true,"another":true},
      {"id":"living","tags":["lounge"],"size":[12,20]}],
    "accidents":[{"id":"wetSelf","need":"bladder","cooldownHours":2,"graceMinutes":600}],
    "roomRules":{"decorByCategory":{"decor":1},"love":0.8,"dislike":0.66,
                 "loveFeeling":"lovesRoom","dislikeFeeling":"dislikesRoom"},
    "economy":{"startingFunds":10000}}"#;

/// A 2×2 bathroom with a window and a 4×3 living room with two windows, both bare.
const TOWN: &str = r#"{"width":12,"depth":10,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "walls":[[1,1,3,1],[1,3,3,3],[1,1,1,3],[3,1,3,3],
             [5,1,9,1],[5,4,9,4],[5,1,5,4],[9,1,9,4]],
    "doors":[{"x":1,"z":3,"axis":"x"},{"x":6,"z":4,"axis":"x"}],
    "windows":[{"x":1,"z":1,"axis":"z"},{"x":6,"z":1,"axis":"x"},{"x":9,"z":2,"axis":"z"}],
    "objects":[{"def":"toilet","x":1,"z":1},{"def":"sofa","x":6,"z":2}],
    "sims":[{"name":"Ada","x":6.5,"z":1.5},{"name":"Bo","x":9.5,"z":7.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 3).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w.sims[0].needs[0] = 1.0;
    w.sims[1].needs[0] = 1.0;
    w
}

fn hours(w: &mut World, h: f32) {
    for _ in 0..(h * 60.0 * 20.0) as usize {
        w.tick_once();
    }
}

fn living(w: &World) -> sim_core::rooms::RoomInfo {
    w.room_at_tile(6, 2).unwrap().clone()
}

#[test]
fn a_bare_room_is_disliked_until_it_gets_better() {
    let mut w = world();
    let room = living(&w);
    let kind = w.content.room_kinds.iter().position(|k| k.id == "living");
    assert_eq!(room.kind, kind);
    assert!(room.scores.overall <= 0.66, "bare: {:?}", room.scores);
    assert_eq!(FACTORS[room.scores.weakest()], "decor");

    let mut disliked = false;
    for _ in 0..8 {
        hours(&mut w, 1.0);
        disliked |= w.sims[0].planner.thought.is_some_and(|t| t.kind == ThoughtKind::RoomDisliked);
    }
    assert!(disliked, "a thought about it");
    let wish = HomeWish::Room { kind, garden: false, factor: 2 };
    assert_eq!(w.sims[0].planner.home_wishes, [wish]);
    assert!(w.sims[0].feelings.iter().any(|f| w.content.feelings[f.def].id == "dislikesRoom"));
    assert!(w.sims[1].planner.home_wishes.is_empty(), "Bo was out in the garden");

    // Kept in saves.
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.sims[0].planner.home_wishes, [wish]);

    // A vase: the wish came true.
    let spots = [(8, 1), (8, 3), (5, 1), (5, 3)];
    let bought = spots.iter().any(|&(x, z)| {
        w.apply(Command::Buy { household: 0, object: "vase".into(), at: Some([x, z, 0]), style: None, turn: None }).is_ok()
    });
    assert!(bought, "somewhere for a vase");
    assert!(living(&w).scores.decor >= 0.6, "{:?}", living(&w).scores);
    hours(&mut w, 1.0);
    assert!(w.sims[0].planner.home_wishes.is_empty());
}

#[test]
fn broken_things_are_wished_fixed() {
    let mut w = world();
    w.sims[1].needs[0] = 1.0;
    w.objects[1].wear = 1.0;
    w.refresh_rooms();
    hours(&mut w, 1.0);
    let sofa = w.content.object_index("sofa").unwrap();
    assert!(w.sims[0].planner.home_wishes.contains(&HomeWish::Fix { def: sofa }));
    let thought = w.sims[0].planner.thought.unwrap();
    assert_eq!((thought.kind, thought.subject), (ThoughtKind::Broken, sofa));

    w.objects[1].wear = 0.0;
    hours(&mut w, 1.0);
    assert!(!w.sims[0].planner.home_wishes.contains(&HomeWish::Fix { def: sofa }));
}

#[test]
fn a_bathroom_always_taken_brings_a_wish_for_another() {
    let mut w = world();
    w.sims[1].needs[0] = 0.3;
    w.apply(Command::Use { sim: 1, object: 0, interaction: 0 }).unwrap();
    hours(&mut w, 0.5);
    w.sims[0].needs[0] = 0.1;
    hours(&mut w, 1.0);
    let bathroom = w.content.room_kinds.iter().position(|k| k.id == "bathroom").unwrap();
    assert!(!w.sims[0].planner.home_wishes.contains(&HomeWish::Another { kind: bathroom }), "once is bad luck");
    // The next day, again.
    let start = w.tick;
    while w.tick < start + 24 * 60 * 20 {
        w.tick_once();
        if !w.objects[0].in_use() {
            w.apply(Command::Use { sim: 1, object: 0, interaction: 0 }).unwrap();
        }
        w.sims[0].needs[0] = 0.1;
        w.sims[1].needs[0] = 0.3;
    }
    assert!(
        w.sims[0].planner.home_wishes.contains(&HomeWish::Another { kind: bathroom }),
        "{:?}",
        w.sims[0].planner.home_wishes
    );
    assert!(!w.sims[1].planner.home_wishes.contains(&HomeWish::Another { kind: bathroom }), "Bo has it");
}
