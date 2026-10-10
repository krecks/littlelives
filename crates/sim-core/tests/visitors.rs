//! Visitors at the door (`visits.door`): they knock, someone at home answers and lets them in or
//! turns them away, and with nobody to answer they go home again.

use sim_core::social::EventKind;
use sim_core::{Command, World, clock};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.01},{"id":"social","label":"Social","decayPerHour":0.01}],
    "objects":[{"id":"chair","name":"Chair","interactions":[{"id":"sit","label":"Sit","minutes":30,"effects":{"social":0.01},"tags":["lounge"]}]}],
    "feelings":[{"id":"turnedAway","label":"Turned away","mood":-0.15,"hours":6}],
    "animations":["knock","talk"],
    "socials":[{"id":"chat","label":"Chat","minutes":10,"tags":["social"],"acceptance":{"base":1.0},"needs":{"social":0.3}}],
    "bondPresets":{"friends":{"friendship":60},"enemies":{"friendship":-60}},
    "visits":{"needs":{"social":0.5},"hours":2,"minFriendship":10,"earliestHour":9,"latestHour":21,
      "door":{"waitMinutes":10,"welcomeFriendship":-20,"greet":"chat","turnedAwayFeeling":"turnedAway","knockAnim":"knock"}},
    "economy":{"startingFunds":500}}"#;

/// Two houses side by side; the host's front door is at the bottom of the west lot.
fn town(bond: &str) -> String {
    format!(
        r#"{{"width":40,"depth":14,
        "plots":[{{"name":"West","x":0,"z":0,"w":20,"d":10,"entry":[10.5,9.5]}},{{"name":"East","x":20,"z":0,"w":20,"d":10,"entry":[30.5,9.5]}}],
        "households":[{{"name":"Host","plot":0,"player":true}},{{"name":"Guest","plot":1}}],
        "objects":[{{"def":"chair","x":3,"z":2,"rot":0}},{{"def":"chair","x":24,"z":2,"rot":0}}],
        "sims":[{{"name":"Ada","household":0,"x":4.5,"z":4.5}},{{"name":"Bo","household":1,"x":25.5,"z":4.5}}],
        "relationships":[{{"a":0,"b":1,"preset":"{bond}"}}]}}"#
    )
}

fn world(bond: &str) -> World {
    let mut w = World::from_json(CONTENT, &town(bond), 7).unwrap();
    w.autonomy = false;
    // 11:00 on day 1: within visiting hours.
    while w.tick < clock::tick_at(1, 11.0 * 60.0).unwrap() {
        w.tick_once();
    }
    w
}

fn minutes(w: &mut World, m: f32) {
    let end = w.tick + (m / sim_core::MINUTES_PER_TICK) as u64;
    while w.tick < end {
        w.tick_once();
    }
}

fn knock_anim(w: &World) -> f32 {
    w.content.animations.iter().position(|a| a == "knock").unwrap() as f32
}

fn action_of(w: &World, i: usize) -> f32 {
    let mut out = vec![0.0; sim_core::snapshot::CAPACITY];
    sim_core::snapshot::write(w, &mut out);
    out[sim_core::snapshot::HEADER_LEN + i * sim_core::snapshot::SIM_STRIDE + sim_core::snapshot::sim::ACTION]
}

#[test]
fn a_friend_knocks_and_is_let_in() {
    let mut w = world("friends");
    w.apply(Command::Visit { sim: 1, plot: 0 }).unwrap();
    // Walk over and knock.
    let mut knocked = false;
    for _ in 0..(90.0 / sim_core::MINUTES_PER_TICK) as u32 {
        w.tick_once();
        knocked |= action_of(&w, 1) == knock_anim(&w);
        if w.events.iter().any(|e| e.kind == EventKind::Visited) {
            break;
        }
    }
    assert!(knocked, "the visitor never knocked");
    let visited = w.events.iter().find(|e| e.kind == EventKind::Visited).expect("never let in");
    assert_eq!((visited.a, visited.b), (1, 0), "Ada let Bo in");
    assert_eq!(w.sims[1].visiting.map(|v| v.plot), Some(0));
    assert_ne!(action_of(&w, 1), knock_anim(&w), "inside, not knocking any more");
    assert!(!w.events.iter().any(|e| matches!(e.kind, EventKind::TurnedAway | EventKind::NobodyHome)));
}

#[test]
fn an_enemy_is_turned_away() {
    let mut w = world("enemies");
    w.apply(Command::Visit { sim: 1, plot: 0 }).unwrap();
    minutes(&mut w, 90.0);
    let turned = w.events.iter().find(|e| e.kind == EventKind::TurnedAway).expect("never turned away");
    assert_eq!((turned.a, turned.b), (1, 0));
    assert!(!w.events.iter().any(|e| e.kind == EventKind::Visited));
    let feeling = w.content.feeling_index("turnedAway").unwrap();
    assert!(w.sims[1].feelings.iter().any(|f| f.def == feeling));
    // And home again.
    minutes(&mut w, 60.0);
    assert!(w.sims[1].visiting.is_none());
    assert_eq!(w.plot_at(w.sims[1].tile().0, w.sims[1].tile().1), Some(1));
}

#[test]
fn nobody_home_means_going_home() {
    let mut w = world("friends");
    // Ada is out all day.
    w.sims[0].away_until = Some(w.tick + 100_000);
    w.apply(Command::Visit { sim: 1, plot: 0 }).unwrap();
    minutes(&mut w, 90.0);
    let none = w.events.iter().find(|e| e.kind == EventKind::NobodyHome).expect("no note of an empty house");
    assert_eq!((none.a, none.b), (1, 0));
    assert!(!w.events.iter().any(|e| e.kind == EventKind::Visited));
    minutes(&mut w, 60.0);
    assert!(w.sims[1].visiting.is_none(), "went home");
}

#[test]
fn a_visitor_knocking_at_save_time_knocks_again_after_loading() {
    let mut w = world("friends");
    w.apply(Command::Visit { sim: 1, plot: 0 }).unwrap();
    while action_of(&w, 1) != knock_anim(&w) {
        w.tick_once();
        assert!(w.tick < clock::tick_at(1, 13.0 * 60.0).unwrap(), "never knocked");
    }
    let mut loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    loaded.autonomy = false;
    minutes(&mut loaded, 90.0);
    assert!(loaded.events.iter().any(|e| e.kind == EventKind::Visited), "let in after loading");
}
