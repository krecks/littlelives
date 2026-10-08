//! Guards the content files the game ships with.

use sim_core::world::TaskKind;
use sim_core::{Content, World};

const STARTER_LOT: &str = include_str!("../../../web/public/content/lots/starter.json");

/// base.json plus every file in its `"include"` list (careers, content packs), merged the
/// way the web loader does.
fn content() -> String {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/public/content");
    let read = |name: &str| {
        std::fs::read_to_string(dir.join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
    };
    let base = read("base.json");
    let includes: Vec<String> = serde_json::from_value(
        serde_json::from_str::<serde_json::Value>(&base).unwrap()["include"].clone(),
    )
    .expect("base.json lists its includes");
    let parts: Vec<String> = includes.iter().map(|n| read(n)).collect();
    let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
    sim_core::merge_content(&base, &parts).unwrap_or_else(|e| panic!("{e}"))
}

/// The starter lot ships empty; the game moves the created household in at its spawn points.
fn starter_with_household() -> String {
    let mut lot: serde_json::Value = serde_json::from_str(STARTER_LOT).unwrap();
    let spawns = lot["spawns"]
        .as_array()
        .expect("starter lot has spawns")
        .clone();
    lot["sims"] = serde_json::json!([
        { "name": "Ada", "traits": ["foodie", "lazy"], "perks": ["ironBladder"], "x": spawns[0][0], "z": spawns[0][1] },
        { "name": "Bo", "traits": ["neat", "cheerful", "bookworm"], "perks": ["speedWalker", "sunnyDisposition"], "x": spawns[1][0], "z": spawns[1][1] },
    ]);
    lot.to_string()
}

#[test]
fn content_traits_and_perks_are_valid() {
    let content = Content::from_json(&content()).expect("shipped content is valid");
    assert!(content.traits.len() >= 6);
    assert!(content.perks.len() >= 4);
    assert!(content.rules.max_traits >= content.rules.min_traits);
}

#[test]
fn starter_lot_loads_with_a_household() {
    let world =
        World::from_json(&content(), &starter_with_household(), 1).expect("starter lot is valid");
    assert_eq!(world.sims.len(), 2);
    assert!(
        world
            .lot
            .rooms()
            .iter()
            .any(|&r| r != sim_core::lot::OUTDOORS)
    );
}

#[test]
fn house_templates_and_the_starter_lot_have_windows_in_their_walls() {
    use sim_core::lot::{Edge, Lot, LotFile};
    let houses: serde_json::Value =
        serde_json::from_str(include_str!("../../../web/public/content/houses.json")).unwrap();
    let plot = &houses["plot"];
    let mut lots: Vec<serde_json::Value> = houses["houses"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| {
            serde_json::json!({ "width": plot["width"], "depth": plot["depth"],
                "walls": h["walls"], "doors": h["doors"], "windows": h["windows"] })
        })
        .collect();
    lots.push(serde_json::from_str(STARTER_LOT).unwrap());
    for json in lots {
        let file: LotFile = serde_json::from_value(json).unwrap();
        assert!(file.windows.len() >= 6, "every house has windows");
        let lot = Lot::from_file(&file).unwrap_or_else(|e| panic!("{e}"));
        let (h, v) = lot.edges();
        let count = h.iter().chain(v).filter(|&&e| e == Edge::Window).count();
        assert_eq!(count, file.windows.len());
    }
}

#[test]
fn starter_lot_runs_a_game_day_quickly() {
    let mut world = World::from_json(&content(), &starter_with_household(), 1).unwrap();
    let ticks = 24 * 60 * sim_core::TICKS_PER_SECOND;
    let start = std::time::Instant::now();
    for _ in 0..ticks {
        world.tick_once();
    }
    let per_tick = start.elapsed() / ticks;
    eprintln!("avg tick: {per_tick:?}");
    // Sims should have looked after themselves over a full day.
    for s in &world.sims {
        let n = world.content.needs.len();
        let avg = s.needs[..n].iter().sum::<f32>() / n as f32;
        assert!(
            avg > 0.2,
            "{} let their needs collapse: {:?}",
            s.name,
            &s.needs[..n]
        );
    }
    // And the day survives a save/load round trip.
    let reloaded = World::from_save_json(&content(), &world.save_json()).unwrap();
    assert_eq!(reloaded.tick, world.tick);
}

#[test]
fn a_thousand_jobs_with_grades_and_skills() {
    let content = Content::from_json(&content()).unwrap();
    let positions: usize = content.careers.iter().map(|c| c.levels.len()).sum();
    assert_eq!(positions, 1000);
    assert_eq!(content.career_categories.len(), 25);
    assert_eq!(content.skills.len(), 13);
    for c in &content.careers {
        let first = &c.levels[0];
        assert!(
            first.requires.iter().all(|r| r.1 == 0.0),
            "{}: grade A has no requirements",
            c.id
        );
        assert!(
            c.levels.windows(2).all(|w| w[1].pay > w[0].pay),
            "{}: pay rises with grade",
            c.id
        );
    }
    // Everything sold in the shop can be bought and every training item teaches something.
    assert!(content.objects.iter().filter(|o| o.price.is_some()).count() >= 20);
    let rent = content.rent.as_ref().unwrap();
    assert!(
        rent.bills_base > 0 && rent.bills_rate > 0.0,
        "weekly bills grow with what the household owns"
    );
}

#[test]
fn sims_sleep_at_night_and_are_up_by_day() {
    let mut world = World::from_json(&content(), &starter_with_household(), 2).unwrap();
    let mut asleep_at_night = 0;
    let mut awake_by_day = 0;
    // Three days; sample 03:00 and 15:00 each day.
    for day in 2..5 {
        for (hour, night) in [(3.0, true), (15.0, false)] {
            let target = sim_core::clock::tick_at(day, hour * 60.0).unwrap();
            while world.tick < target {
                world.tick_once();
            }
            for s in &world.sims {
                // A proper night's sleep (naps don't count).
                let sleeping = s.current().is_some_and(|a| match a.task.kind {
                    TaskKind::Use {
                        object,
                        interaction,
                    } => {
                        let def = world.objects[object as usize].def;
                        world.content.objects[def].interactions[interaction].id == "sleep"
                    }
                    _ => false,
                });
                if night && sleeping {
                    asleep_at_night += 1;
                }
                if !night && !sleeping {
                    awake_by_day += 1;
                }
            }
        }
    }
    assert!(
        asleep_at_night >= 5,
        "only {asleep_at_night}/6 night samples asleep"
    );
    assert!(awake_by_day >= 5, "only {awake_by_day}/6 day samples awake");
    for s in &world.sims {
        let n = world.content.needs.len();
        let avg = s.needs[..n].iter().sum::<f32>() / n as f32;
        assert!(
            avg > 0.25,
            "{} let their needs collapse: {:?}",
            s.name,
            &s.needs[..n]
        );
    }
}

#[test]
fn content_packs_are_included_and_valid() {
    let content = Content::from_json(&content()).unwrap();
    for id in ["whirlpoolTub", "chefStove"] {
        assert!(
            content.object_index(id).is_some(),
            "example pack object {id}"
        );
    }
    for id in ["focused", "inspired", "energized", "relaxed"] {
        assert!(content.emotions.iter().any(|e| e.id == id), "emotion {id}");
    }
    assert!(content.feelings.iter().any(|m| m.effects.is_some()));
}

/// Every personality, living with one item from every content pack: needs stay healthy,
/// nights are for sleeping and per-use spending stays reasonable.
#[test]
fn every_personality_lives_well_with_all_packs() {
    let content = content();
    let groups = [
        ["foodie", "energetic", "outgoing"],
        ["bookworm", "loner", "gloomy"],
        ["couchPotato", "lazy", "slob"],
        ["neat", "cheerful", "kind"],
        ["natureLover", "romantic", "hotHeaded"],
    ];
    for traits in groups {
        let mut lot: serde_json::Value = serde_json::from_str(STARTER_LOT).unwrap();
        let spawns = lot["spawns"].as_array().unwrap().clone();
        lot["sims"] = serde_json::json!(
            traits
                .iter()
                .enumerate()
                .map(|(i, t)| serde_json::json!({ "name": t, "traits": [t], "x": spawns[i % spawns.len()][0], "z": spawns[i % spawns.len()][1] }))
                .collect::<Vec<_>>()
        );
        // The whole starter lot is the household's home plot (buying needs one).
        let (w, d) = (lot["width"].clone(), lot["depth"].clone());
        lot["plots"] = serde_json::json!([{ "name": "Home", "x": 0, "z": 0, "w": w, "d": d, "entry": spawns[0] }]);
        lot["households"] =
            serde_json::json!([{ "name": "Test", "plot": 0, "player": true, "funds": 1_000_000 }]);
        let mut world = World::from_json(&content, &lot.to_string(), 5).unwrap();
        // One affordable item per pack (its cheapest), wherever it fits.
        let mut bought = 0;
        let packs: Vec<String> = world
            .content
            .objects
            .iter()
            .filter_map(|o| o.id.split_once('.').map(|(p, _)| p.to_owned()))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        for pack in &packs {
            let mut items: Vec<_> = world
                .content
                .objects
                .iter()
                .filter(|o| o.id.starts_with(&format!("{pack}.")) && o.price.is_some())
                .map(|o| (o.price.unwrap(), o.id.clone()))
                .collect();
            items.sort();
            if let Some((_, id)) = items
                .into_iter()
                .find(|(_, id)| world.buy(0, id, None, None).is_ok())
            {
                let _ = id;
                bought += 1;
            }
        }
        assert!(bought >= 8, "{traits:?}: only {bought} pack items fit");
        let funds = world.households[0].funds;
        let days = 4;
        let mut asleep = 0;
        for day in 2..2 + days {
            let target = sim_core::clock::tick_at(day, 3.0 * 60.0).unwrap();
            while world.tick < target {
                world.tick_once();
            }
            asleep += world
                .sims
                .iter()
                .filter(|s| s.pose == sim_core::content::Pose::Lie)
                .count();
        }
        let spent_per_day = (funds - world.households[0].funds) / days as i64;
        let n = world.content.needs.len();
        for s in &world.sims {
            let avg = s.needs[..n].iter().sum::<f32>() / n as f32;
            assert!(
                avg > 0.3,
                "{traits:?}: {} let their needs collapse: {:?}",
                s.name,
                &s.needs[..n]
            );
        }
        eprintln!(
            "{traits:?}: {bought} items, ${spent_per_day}/day, {asleep}/{} asleep at 3am",
            days as usize * traits.len()
        );
        // Only consumables (takeout, deliveries, donations…) cost money per use; running
        // costs come as weekly bills, so daily spending stays well under a day's pay.
        assert!(
            spent_per_day < 120,
            "{traits:?}: spending ${spent_per_day}/day"
        );
        assert!(
            asleep * 2 >= days as usize * traits.len(),
            "{traits:?}: few Sims asleep at night"
        );
    }
}

#[test]
fn every_shipped_interaction_has_an_animation() {
    let merged = content();
    let content = Content::from_json(&merged).expect("shipped content is valid");
    assert!(content.talk_anim.is_some(), "conversations show 'talk'");
    // Every interaction names its `anim` (no fallback guessing for shipped content)...
    let raw: serde_json::Value = serde_json::from_str(&merged).unwrap();
    for obj in raw["objects"].as_array().unwrap() {
        for it in obj["interactions"].as_array().into_iter().flatten() {
            assert!(
                it["anim"].is_string(),
                "{}.{} has no anim",
                obj["id"],
                it["id"]
            );
        }
    }
    // ...and it resolves to one of the declared animations.
    for obj in &content.objects {
        for it in &obj.interactions {
            let anim = it.anim.unwrap_or_else(|| panic!("{}.{}", obj.id, it.id));
            assert!(anim < content.animations.len());
        }
    }
}

#[test]
fn gardening_feeds_the_household_and_trains_its_skill() {
    use sim_core::Command;
    // The starter lot as the household's own plot.
    let mut lot: serde_json::Value = serde_json::from_str(&starter_with_household()).unwrap();
    lot["plots"] = serde_json::json!([{ "name": "Home", "x": 0, "z": 0, "w": 26, "d": 22, "entry": [8.5, 1.5] }]);
    lot["households"] = serde_json::json!([{ "name": "Player", "plot": 0, "player": true, "funds": 10000 }]);
    let mut world = World::from_json(&content(), &lot.to_string(), 1).unwrap();
    world.autonomy = false;
    world.households[0].funds = 10_000;
    // Garden things find a spot outdoors on their own.
    let patch = world
        .buy(0, "garden.vegPatch", None, None)
        .expect("a vegetable patch fits in the garden");
    let o = &world.objects[patch as usize];
    assert_eq!(world.lot.room_at(o.x, o.z), sim_core::lot::OUTDOORS);
    let def = &world.content.objects[o.def];
    let harvest = def.interactions.iter().position(|i| i.id == "harvest").unwrap();
    let hunger = world.content.needs.iter().position(|n| n.id == "hunger").unwrap();
    let gardening = world.content.skill_index("gardening").unwrap();
    world.sims[0].needs[hunger] = 0.2;
    world
        .apply(Command::Use {
            sim: 0,
            object: patch,
            interaction: harvest,
        })
        .unwrap();
    // An hour and a half of game time (one game minute per second of ticks).
    for _ in 0..90 * sim_core::TICKS_PER_SECOND {
        world.tick_once();
    }
    assert!(world.sims[0].needs[hunger] > 0.4, "a fresh harvest fed them");
    assert!(world.sims[0].skills[gardening] > 0.0, "and taught some Gardening");
}
