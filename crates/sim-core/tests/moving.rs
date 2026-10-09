//! Moving: partners move in together where there's room, grown children move into a house of
//! their own (or leave town when there's none), and the player can keep their household out
//! of it.

use sim_core::social::EventKind;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"energy","label":"Energy","decayPerHour":0.0}],
    "objects":[{"id":"bed","name":"Bed","price":300,"slots":1,"interactions":[
        {"id":"sleep","label":"Sleep","minutes":480,"effects":{"energy":1.0},"tags":["sleep"]}]},
      {"id":"double","name":"Double bed","price":600,"footprint":[2,2],"slots":2,"interactions":[
        {"id":"sleep","label":"Sleep","minutes":480,"effects":{"energy":1.0},"tags":["sleep"]}]}],
    "dayRhythm":{"sleepTags":["sleep"]},
    "skills":[{"id":"writing","label":"Writing"}],
    "grades":[{"id":"A","label":"Entry","payPerHour":10,"skillLevel":0}],
    "careerCategories":[{"id":"press","label":"Press","shift":{"start":13,"hours":4,"days":[0,1,2,3,4]},
      "tracks":[{"id":"press.print","label":"Print","skills":{"writing":1},"titles":["Runner"]}]}],
    "life":{"daysPerYear":2,"moving":{"hour":11,"partners":1.0,"romance":60,"leaveHomeAge":23,"leaveHome":1.0,
            "leaveTownAge":30,"leaveTown":1.0}},
    "bondPresets":{"roommates":{"friendship":20},"partners":{"friendship":55,"romance":75,"partners":true},
                   "parent":{"friendship":50,"kin":"parent"},"siblings":{"friendship":40,"kin":"sibling"}},
    "rules":{"maxHousehold":4},
    "economy":{"startingFunds":1000}}"#;

/// The player's home (a double bed), a neighbour's (one bed, two siblings), and a house for
/// sale (a bed, nobody living there).
fn town(extra_sims: &str, relationships: &str) -> String {
    format!(
        r#"{{"width":30,"depth":10,
        "plots":[{{"name":"Home","x":0,"z":0,"w":10,"d":10,"entry":[5.5,9.5]}},
                 {{"name":"Next door","x":10,"z":0,"w":10,"d":10,"entry":[15.5,9.5]}},
                 {{"name":"For sale","x":20,"z":0,"w":10,"d":10,"entry":[25.5,9.5]}}],
        "households":[{{"name":"Player","plot":0,"player":true}},{{"name":"Neighbours","plot":1}}],
        "objects":[{{"def":"double","x":2,"z":2}},{{"def":"bed","x":12,"z":2}},{{"def":"bed","x":22,"z":2}}],
        "sims":[{{"name":"Ada","x":4.5,"z":5.5,"age":30}},
                {{"name":"Cy","x":14.5,"z":5.5,"age":30,"household":1}},
                {{"name":"Di","x":15.5,"z":5.5,"age":28,"household":1}}{extra_sims}],
        "relationships":[{{"a":1,"b":2,"preset":"siblings"}}{relationships}]}}"#
    )
}

fn days(w: &mut World, d: u32) {
    for _ in 0..d * 24 * 60 * 20 {
        w.tick_once();
    }
}

#[test]
fn partners_move_in_together_where_there_is_room() {
    let mut w = World::from_json(CONTENT, &town("", r#",{"a":0,"b":1,"preset":"partners"}"#), 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    days(&mut w, 1);
    // Next door is full (two in one bed); the player's double bed has room: Cy moves in.
    assert_eq!(w.sims[1].household, 0, "Cy moved in with Ada");
    let moved = w.events.iter().find(|e| e.kind == EventKind::MovedInWith).unwrap();
    assert_eq!((moved.a, moved.b), (1, 0));
    assert_eq!(w.households[0].funds, 1500, "with half of his household's money");
    assert_eq!(w.households[1].funds, 500);
    assert!(w.plots[0].contains(w.sims[1].pos[0] as i32, w.sims[1].pos[1] as i32), "at his new home");
    // Saved in their new home.
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.sims[1].household, 0);
}

#[test]
fn the_player_can_keep_their_household_as_it_is() {
    let mut w = World::from_json(CONTENT, &town("", r#",{"a":0,"b":1,"preset":"partners"}"#), 1).unwrap();
    w.apply(Command::SetPlayerMoves { enabled: false }).unwrap();
    days(&mut w, 3);
    assert_eq!(w.sims[1].household, 1, "nobody moves in or out of the player's home");
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert!(!loaded.player_moves);
}

#[test]
fn grown_children_move_into_a_house_of_their_own_or_leave_town() {
    // Eve (25, working) lives next door with her mother Di.
    let eve = r#",{"name":"Eve","x":16.5,"z":5.5,"age":25,"household":1,"job":{"career":"press.print","level":0}}"#;
    let mut w = World::from_json(CONTENT, &town(eve, r#",{"a":3,"b":2,"preset":"parent"}"#), 1).unwrap();
    days(&mut w, 1);
    let h = w.sims[3].household as usize;
    assert_eq!(w.households[h].plot, Some(2), "the house that was for sale");
    assert_eq!(w.households[h].name, "Neighbours", "the family name");
    assert!(w.events.iter().any(|e| e.kind == EventKind::MovedOut && e.a == 3));

    // With no house free, a grown child of 30 leaves town instead.
    let fin = r#",{"name":"Fin","x":16.5,"z":5.5,"age":31,"household":1,"job":{"career":"press.print","level":0}},
                {"name":"Gil","x":24.5,"z":5.5,"age":40,"household":2}"#;
    let src = town(fin, r#",{"a":3,"b":2,"preset":"parent"}"#).replace(
        r#"{"name":"Neighbours","plot":1}"#,
        r#"{"name":"Neighbours","plot":1},{"name":"Owners","plot":2}"#,
    );
    let mut w = World::from_json(CONTENT, &src, 1).unwrap();
    days(&mut w, 1);
    assert!(!w.sims[3].here(), "Fin left town");
    assert!(w.events.iter().any(|e| e.kind == EventKind::MovedAway && e.a == 3));
}
