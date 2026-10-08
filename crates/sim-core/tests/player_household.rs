//! New game, "play an existing household": the town file marks a neighbour household (not the
//! first one, not the last) as the player's. Everything the player's household gets must follow
//! the flag, never the household's position in the list.

use sim_core::social::EventKind;
use sim_core::{World, clock, life};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "skills":[{"id":"writing","label":"Writing"}],
    "skillRules":{"maxLevel":10,"workGainPerHour":0.05,"slowdown":0.25},
    "objects":[{"id":"shower","name":"Shower","price":600,"interactions":[
        {"id":"shower","label":"Shower","minutes":30,"effects":{"hunger":0.0},"tags":["hygiene"]}]}],
    "grades":[{"id":"A","label":"Entry","payPerHour":10,"skillLevel":0}],
    "careerCategories":[{"id":"press","label":"Press","shift":{"start":9,"hours":4,"days":[0,1,2,3,4]},
      "tracks":[{"id":"press.print","label":"Print","skills":{"writing":1},"titles":["Runner"]}]}],
    "careerRules":{"performancePerShift":60},
    "economy":{"startingFunds":1000,"rent":{"weekday":6,"hour":12,"base":100,"perTile":1,"billsBase":20,"billsRate":0.1}}}"#;

/// Three 12×10 homes in a row; the middle household (who already has a job) is the player's.
const TOWN: &str = r#"{"width":36,"depth":12,
    "plots":[{"name":"1 Elm Street","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]},
             {"name":"3 Elm Street","x":12,"z":0,"w":12,"d":10,"entry":[18.5,9.5]},
             {"name":"5 Elm Street","x":24,"z":0,"w":12,"d":10,"entry":[30.5,9.5]}],
    "households":[{"name":"Abara","plot":0},{"name":"Brook","plot":1,"player":true},{"name":"Calloway","plot":2}],
    "sims":[{"name":"Ada","household":0,"x":5.5,"z":5.5},
            {"name":"Bea","household":1,"x":17.5,"z":5.5,"job":{"career":"press.print"}},
            {"name":"Ben","household":1,"x":18.5,"z":5.5},
            {"name":"Cy","household":2,"x":29.5,"z":5.5}]}"#;

fn until(w: &mut World, day: u32, hour: f32) {
    let target = clock::tick_at(day, hour * 60.0).unwrap();
    while w.tick < target {
        w.tick_once();
    }
}

#[test]
fn a_neighbour_household_can_be_the_players() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.autonomy = false;
    let player: Vec<bool> = w.households.iter().map(|h| h.player).collect();
    assert_eq!(player, [false, true, false]);
    assert_eq!(w.households[1].plot, Some(1));
    assert!(
        w.households.iter().all(|h| h.funds == 1000),
        "same starting funds"
    );
    assert!(w.sims[1].job.is_some(), "keeps the job it had");

    // Buying furnishes their own lot and is paid from their funds.
    let shower = w.buy(2, "shower", None, None).unwrap();
    let o = &w.objects[shower as usize];
    assert_eq!(w.plot_at(o.x, o.z), Some(1));
    assert_eq!(w.households[1].funds, 400);

    // Rent and bills for their home; the story feed reports only the player's payment.
    let (rent, bills) = life::weekly_costs(&w, 1).unwrap();
    until(&mut w, 7, 12.5);
    let paid: Vec<i64> = w
        .events
        .iter()
        .filter(|e| e.kind == EventKind::PaidRent)
        .filter_map(|e| e.n)
        .collect();
    assert_eq!(paid, [rent + bills]);
    assert!(
        w.events
            .iter()
            .filter(|e| e.kind == EventKind::PaidRent)
            .all(|e| w.sims[e.a as usize].household == 1)
    );
    let funds = w.households[1].funds;

    // Saving and loading keeps who the player is.
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    let player: Vec<bool> = loaded.households.iter().map(|h| h.player).collect();
    assert_eq!(player, [false, true, false]);
    assert_eq!(loaded.households[1].funds, funds);
    assert_eq!(loaded.households[1].name, "Brook");
}
