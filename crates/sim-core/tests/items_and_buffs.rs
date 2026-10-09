//! Interaction costs, skill-scaled interactions, feelings earned by finishing, feeling
//! buffs, and 64-bit tag masks from content packs.

use sim_core::{Command, Content, World, merge_content, social};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.01},
             {"id":"energy","label":"Energy","decayPerHour":0.01},
             {"id":"comfort","label":"Comfort","decayPerHour":0.01}],
    "skills":[{"id":"cooking","label":"Cooking"}],
    "emotions":[{"id":"relaxed","label":"Relaxed"}],
    "feelings":[
      {"id":"relaxed","label":"Relaxed","emotion":"relaxed","mood":0.05,"hours":1,"effects":{"needGain":{"energy":2.0}}},
      {"id":"tasty","label":"Delicious meal","mood":0.1,"hours":2}],
    "objects":[
      {"id":"stove","name":"Stove","price":100,"interactions":[
        {"id":"cook","label":"Cook","minutes":60,"effects":{"hunger":0.5},"tags":["food"],
         "skills":{"cooking":0.2},"cost":20,"skill":"cooking","feeling":"tasty","feelingMinSkill":4}]},
      {"id":"tub","name":"Tub","price":100,"interactions":[
        {"id":"soak","label":"Soak","minutes":30,"effects":{"comfort":0.5},"tags":["spa"],"cost":50,"feeling":"relaxed"}]},
      {"id":"bed","name":"Bed","footprint":[2,2],"price":100,"interactions":[
        {"id":"rest","label":"Rest","minutes":480,"pose":"lie","effects":{"energy":1.0},"tags":["rest"]}]}],
    "economy":{"startingFunds":100}}"#;

const TOWN: &str = r#"{"width":12,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":12,"entry":[5.5,10.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "objects":[{"def":"stove","x":1,"z":1,"rot":0},{"def":"tub","x":4,"z":1,"rot":0},{"def":"bed","x":8,"z":1,"rot":0}],
    "sims":[{"name":"Ada","x":5.5,"z":6.5}]}"#;

const STOVE: u32 = 0;
const TUB: u32 = 1;
const BED: u32 = 2;
const HUNGER: usize = 0;
const ENERGY: usize = 1;
const COMFORT: usize = 2;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.autonomy = false;
    w.sims[0].needs = [1.0; 8];
    w
}

fn minutes(w: &mut World, m: u32) {
    for _ in 0..m * sim_core::TICKS_PER_SECOND {
        w.tick_once();
    }
}

fn use_object(w: &mut World, object: u32) -> Result<(), sim_core::Error> {
    w.apply(Command::Use {
        sim: 0,
        object,
        interaction: 0,
    })
}

fn has_feeling(w: &World, id: &str) -> bool {
    w.sims[0]
        .feelings
        .iter()
        .any(|m| w.content.feelings[m.def].id == id)
}

#[test]
fn cost_is_charged_once_when_the_sim_starts() {
    let mut w = world();
    w.sims[0].needs[COMFORT] = 0.0;
    use_object(&mut w, TUB).unwrap();
    w.tick_once();
    assert_eq!(
        w.households[0].funds, 100,
        "nothing paid while walking over"
    );
    minutes(&mut w, 60);
    assert!(w.sims[0].current().is_none(), "finished soaking");
    assert_eq!(w.households[0].funds, 50, "paid exactly once");
    assert!(w.sims[0].needs[COMFORT] > 0.4);
}

#[test]
fn directed_use_is_refused_without_money() {
    let mut w = world();
    w.households[0].funds = 10;
    let err = use_object(&mut w, TUB).unwrap_err();
    assert!(err.0.contains("not enough money"), "{}", err.0);
    // Free things work even in debt.
    w.households[0].funds = -5;
    use_object(&mut w, BED).unwrap();
}

#[test]
fn autonomy_skips_what_the_household_cannot_afford() {
    let mut w = world();
    w.autonomy = true;
    w.households[0].funds = 10;
    w.sims[0].needs[COMFORT] = 0.0;
    for _ in 0..30 * sim_core::TICKS_PER_SECOND {
        w.tick_once();
        assert!(
            !w.objects[TUB as usize].in_use(),
            "used the tub without money"
        );
    }
    assert_eq!(w.households[0].funds, 10);
    w.households[0].funds = 1000;
    minutes(&mut w, 30);
    assert_eq!(w.households[0].funds, 950, "with money, the tub wins");
}

#[test]
fn skilled_sims_get_more_out_of_skill_interactions() {
    let gain = |level: f32| {
        let mut w = world();
        w.sims[0].needs[HUNGER] = 0.0;
        w.sims[0].skills[0] = level;
        use_object(&mut w, STOVE).unwrap();
        minutes(&mut w, 30);
        (w.sims[0].needs[HUNGER], w.sims[0].skills[0] - level)
    };
    let (novice, novice_skill) = gain(0.0);
    let (expert, expert_skill) = gain(8.0);
    // effectPerLevel defaults to 0.05: level 8 gives x1.4.
    let ratio = expert / novice;
    assert!((1.35..1.45).contains(&ratio), "{novice} vs {expert}");
    assert!(expert_skill > 0.0 && novice_skill > 0.0);
    assert_eq!(w_rules().effect_factor(8.7), 1.4, "whole levels count");
}

fn w_rules() -> sim_core::content::SkillRules {
    Content::from_json(CONTENT).unwrap().skill_rules
}

#[test]
fn finishing_grants_the_feeling_above_the_minimum_skill() {
    let finished_at = |level: f32| {
        let mut w = world();
        w.sims[0].needs[HUNGER] = 0.0;
        w.sims[0].skills[0] = level;
        use_object(&mut w, STOVE).unwrap();
        minutes(&mut w, 70);
        assert!(w.sims[0].current().is_none());
        has_feeling(&w, "tasty")
    };
    assert!(!finished_at(3.0), "Cooking 3 is below feelingMinSkill 4");
    assert!(finished_at(4.0));

    // Stopping before half the duration earns nothing.
    let mut w = world();
    w.sims[0].needs[HUNGER] = 0.0;
    w.sims[0].skills[0] = 8.0;
    use_object(&mut w, STOVE).unwrap();
    minutes(&mut w, 20);
    w.apply(Command::Cancel { sim: 0, index: 0 }).unwrap();
    minutes(&mut w, 1);
    assert!(!has_feeling(&w, "tasty"));
}

#[test]
fn feeling_buffs_change_gains_then_expire() {
    let mut w = world();
    w.sims[0].needs[COMFORT] = 0.0;
    use_object(&mut w, TUB).unwrap();
    minutes(&mut w, 40);
    assert!(has_feeling(&w, "relaxed"));
    assert_eq!(w.sims[0].mods.need_gain[ENERGY], 2.0);
    assert_eq!(w.sims[0].base_mods.need_gain[ENERGY], 1.0);
    assert_eq!(
        w.content.emotions[w.sims[0].emotion(&w.content).unwrap()].id,
        "relaxed"
    );
    minutes(&mut w, 60);
    assert!(!has_feeling(&w, "relaxed"), "lasts an hour");
    assert_eq!(w.sims[0].mods, w.sims[0].base_mods, "buff gone with it");

    // A relaxed Sim rests twice as well.
    let rest = |relaxed: bool| {
        let mut w = world();
        if relaxed {
            let m = w.content.feeling_index("relaxed").unwrap();
            social::add_feeling(&mut w.sims[0].feelings, m, &w.content.feelings, w.tick);
        }
        w.sims[0].needs[ENERGY] = 0.0;
        use_object(&mut w, BED).unwrap();
        minutes(&mut w, 40);
        w.sims[0].needs[ENERGY]
    };
    let ratio = rest(true) / rest(false);
    assert!((1.8..2.2).contains(&ratio), "ratio {ratio}");
}

#[test]
fn buffs_survive_a_save() {
    let mut w = world();
    let m = w.content.feeling_index("relaxed").unwrap();
    social::add_feeling(&mut w.sims[0].feelings, m, &w.content.feelings, w.tick);
    w.tick_once();
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.sims[0].mods.need_gain[ENERGY], 2.0);
}

#[test]
fn a_pack_can_bring_more_than_32_tags() {
    let objects: Vec<String> = (0..40)
        .map(|i| {
            format!(
                r#"{{"id":"thing{i}","name":"Thing","interactions":[{{"id":"use","label":"Use","minutes":10,"effects":{{"fun":0.1}},"tags":["t{i}"]}}]}}"#
            )
        })
        .collect();
    let base = r#"{"needs":[{"id":"fun","label":"Fun","decayPerHour":0.1}],"objects":[],
        "traits":[{"id":"odd","label":"Odd"}],"include":["packs/many.json"]}"#;
    let pack = format!(
        r#"{{"objects":[{}],"traitPatches":{{"odd":{{"effects":{{"tagPreference":{{"t39":3}}}}}}}}}}"#,
        objects.join(",")
    );
    let content = Content::from_json(&merge_content(base, &[&pack]).unwrap()).unwrap();
    assert_eq!(content.tags.len(), 43, "40 + visit + chores and cleaning (tidying up)");
    let last = &content.objects[39].interactions[0];
    assert_eq!(last.tags, 1 << 39);
    let mods = content.character_modifiers(&["odd".into()], &[]).unwrap();
    assert_eq!(mods.preference(last.tags), 3.0);
    assert_eq!(
        mods.preference(content.objects[0].interactions[0].tags),
        1.0
    );
}
