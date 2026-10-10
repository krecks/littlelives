//! Checks a content pack for authors:
//!
//! `cargo run -q -p sim-core --example check_pack -- web/public/content/packs/<name>.json`
//!
//! Merges base.json + its non-pack includes (careers) + the pack, then tries every
//! interaction of every pack object on a test lot (at Cooking/... 0 and 8 for interactions
//! with a `skill`; it prints the animation each resolves to), and finally lives three days
//! on the starter lot with the pack's objects bought into the home. Exits non-zero on any
//! problem.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::ExitCode;

use serde_json::{Value, json};
use sim_core::content::Layer;
use sim_core::pack::merge_named;
use sim_core::world::{Phase, TaskKind};
use sim_core::{Command, Content, MINUTES_PER_TICK, World, clock};

/// Needs an interaction raises start low so its gains show; the others start comfortably.
const LOW_NEED: f32 = 0.1;
const OTHER_NEED: f32 = 0.7;
const TEST_FUNDS: i64 = 100_000;

fn main() -> ExitCode {
    match run() {
        Ok(true) => {
            println!("OK");
            ExitCode::SUCCESS
        }
        Ok(false) => {
            println!("FAILED");
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<bool, String> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: check_pack <web/public/content/packs/name.json>")?;
    let pack_text = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/public/content");
    let read =
        |name: &str| std::fs::read_to_string(dir.join(name)).map_err(|e| format!("{name}: {e}"));
    let base = read("base.json")?;
    let includes: Vec<String> = serde_json::from_str::<Value>(&base)
        .ok()
        .and_then(|v| serde_json::from_value(v["include"].clone()).ok())
        .unwrap_or_default();
    let mut files = vec![("base.json".to_owned(), base)];
    // (Not the file being checked if base.json already includes it, like furniture.json.)
    for name in includes.iter().filter(|n| !n.starts_with("packs/") && !path.ends_with(n.as_str())) {
        files.push((name.clone(), read(name)?));
    }
    files.push((path.clone(), pack_text.clone()));
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(n, t)| (n.as_str(), t.as_str()))
        .collect();
    let merged = merge_named(&refs).map_err(|e| e.0)?;
    let content = Content::from_json(&merged).map_err(|e| format!("content: {e}"))?;
    let pack: Value = serde_json::from_str(&pack_text).map_err(|e| e.to_string())?;
    let ids: Vec<String> = pack["objects"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|o| o["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let count = |key: &str| pack[key].as_array().map_or(0, Vec::len);
    println!(
        "{path}: merged OK ({} objects, {} feelings, {} tags in all)",
        ids.len(),
        count("feelings"),
        content.tags.len()
    );

    let mut ok = true;
    for id in &ids {
        ok &= check_object(&merged, &content, id);
    }
    ok &= live_three_days(&merged, &content, &ids, &read("lots/starter.json")?)?;
    Ok(ok)
}

/// Runs every interaction of object `id` on a small test lot.
fn check_object(merged: &str, content: &Content, id: &str) -> bool {
    let def = &content.objects[content.object_index(id).expect("merged")];
    println!(
        "{id} \"{}\" ${} {}x{}",
        def.name,
        def.price.map_or("-".into(), |p| p.to_string()),
        def.footprint[0],
        def.footprint[1]
    );
    let mut lot = json!({
        "width": 14, "depth": 14,
        "plots": [{"name": "Test", "x": 0, "z": 0, "w": 14, "d": 14, "entry": [2.5, 12.5]}],
        "households": [{"name": "Test", "plot": 0, "player": true, "funds": TEST_FUNDS}],
        "objects": [{"def": id, "x": 5, "z": 4, "rot": 0}],
        "sims": [{"name": "Tester", "traits": [neutral_trait(content)], "x": 2.5, "z": 12.5}],
    });
    // Things on a wall or the ceiling hang in a room (its back wall runs behind them).
    if matches!(def.layer, Layer::Wall | Layer::Ceiling) {
        lot["walls"] = json!([[3, 4, 11, 4], [3, 11, 11, 11], [3, 4, 3, 11], [11, 4, 11, 11]]);
        lot["doors"] = json!([{"x": 6, "z": 11, "axis": "x"}]);
    }
    let lot = lot.to_string();
    if let Err(e) = World::from_json(merged, &lot, 1) {
        println!("  FAIL: can't place it on a 14x14 test lot: {e}");
        return false;
    }
    let mut ok = true;
    for (i, inter) in def.interactions.iter().enumerate() {
        let levels: &[Option<f32>] = match inter.skill {
            Some(_) => &[Some(0.0), Some(8.0)],
            None => &[None],
        };
        for &level in levels {
            let mut w = World::from_json(merged, &lot, 1).expect("checked above");
            w.autonomy = false;
            w.tick = clock::tick_at(1, 10.0 * 60.0).expect("valid time");
            let n = content.needs.len();
            for k in 0..n {
                w.sims[0].needs[k] = if inter.total_gain[k] > 0.0 {
                    LOW_NEED
                } else {
                    OTHER_NEED
                };
            }
            let needs_before = w.sims[0].needs;
            if let (Some(s), Some(l)) = (inter.skill, level) {
                w.sims[0].skills[s] = l;
            }
            let skills_before = w.sims[0].skills;
            let label = match (inter.skill, level) {
                (Some(s), Some(l)) => format!("{}.{} [{} {l}]", id, inter.id, content.skills[s].id),
                _ => format!("{}.{}", id, inter.id),
            };
            if let Err(e) = w.apply(Command::Use {
                sim: 0,
                object: 0,
                interaction: i,
            }) {
                println!("  FAIL {label}: {e}");
                ok = false;
                continue;
            }
            let limit = ((inter.minutes + 120.0) / MINUTES_PER_TICK) as u32;
            let (mut used, mut done) = (0u32, false);
            for _ in 0..limit {
                w.tick_once();
                let s = &w.sims[0];
                if s.current()
                    .is_some_and(|a| matches!(a.phase, Phase::Using { .. }))
                {
                    used += 1;
                }
                if s.current().is_none() && s.queue().next().is_none() {
                    done = true;
                    break;
                }
            }
            let s = &w.sims[0];
            // Only the needs it affects (the rest just decay as usual).
            let needs: Vec<String> = (0..n)
                .filter(|&k| inter.total_gain[k] != 0.0)
                .map(|k| (content.needs[k].id.as_str(), s.needs[k] - needs_before[k]))
                .map(|(k, d)| format!("{k} {d:+.2}"))
                .collect();
            let skills: Vec<String> = (0..content.skills.len())
                .map(|k| {
                    (
                        content.skills[k].id.as_str(),
                        s.skills[k] - skills_before[k],
                    )
                })
                .filter(|(_, d)| *d >= 0.005)
                .map(|(k, d)| format!("{k} {d:+.2}"))
                .collect();
            let feelings: Vec<&str> = s
                .feelings
                .iter()
                .map(|m| content.feelings[m.def].id.as_str())
                .collect();
            let minutes = used as f32 * MINUTES_PER_TICK;
            let problem = if used == 0 {
                " FAIL: never started (unreachable?)"
            } else if !done {
                " FAIL: didn't finish in time"
            } else {
                ""
            };
            ok &= problem.is_empty();
            let anim = inter.anim.map_or("-", |a| content.animations[a].as_str());
            println!(
                "  {label:<34} {minutes:>4.0} min  anim {anim:<8} spent ${:<4} needs [{}]  skills [{}]  feelings [{}]{problem}",
                TEST_FUNDS - w.households[0].funds,
                needs.join(", "),
                skills.join(", "),
                feelings.join(", ")
            );
        }
    }
    ok
}

/// Three days on the starter lot with the pack's objects bought in; needs must hold up.
fn live_three_days(
    merged: &str,
    content: &Content,
    ids: &[String],
    starter: &str,
) -> Result<bool, String> {
    let mut lot: Value = serde_json::from_str(starter).map_err(|e| e.to_string())?;
    let sp = lot["spawns"].clone();
    let (w, d) = (lot["width"].clone(), lot["depth"].clone());
    let price = |id: &String| {
        content
            .object_index(id)
            .and_then(|o| content.objects[o].price)
            .unwrap_or(0)
    };
    let funds = content.starting_funds + ids.iter().map(price).sum::<i64>();
    lot["plots"] = json!([{"name": "Home", "x": 0, "z": 0, "w": w, "d": d, "entry": sp[0]}]);
    lot["households"] = json!([{"name": "Testers", "plot": 0, "player": true, "funds": funds}]);
    lot["sims"] = json!([
        { "name": "Ada", "traits": ["foodie", "lazy"], "perks": ["ironBladder"], "x": sp[0][0], "z": sp[0][1] },
        { "name": "Bo", "traits": ["neat", "cheerful", "bookworm"], "perks": ["speedWalker", "sunnyDisposition"], "x": sp[1][0], "z": sp[1][1] },
    ]);
    let mut w = World::from_json(merged, &lot.to_string(), 1).map_err(|e| e.to_string())?;
    let mut bought = Vec::new();
    for id in ids.iter().filter(|id| price(id) > 0) {
        match w.buy(0, id, None, None) {
            Ok(_) => bought.push(id.as_str()),
            Err(e) => println!("starter lot: skipped {id} ({e})"),
        }
    }
    let after_buying = w.households[0].funds;
    let mut minutes: BTreeMap<&str, f32> = bought.iter().map(|id| (*id, 0.0)).collect();
    let days = 3;
    for _ in 0..days * clock_ticks_per_day() {
        w.tick_once();
        for s in &w.sims {
            if let Some(a) = s.current()
                && let (TaskKind::Use { object, .. }, Phase::Using { .. }) = (a.task.kind, &a.phase)
                && let Some(m) =
                    minutes.get_mut(content.objects[w.objects[object as usize].def].id.as_str())
            {
                *m += MINUTES_PER_TICK;
            }
        }
    }
    let n = content.needs.len();
    let avgs: Vec<(String, f32)> = w
        .sims
        .iter()
        .map(|s| (s.name.clone(), s.needs[..n].iter().sum::<f32>() / n as f32))
        .collect();
    let household = avgs.iter().map(|a| a.1).sum::<f32>() / avgs.len() as f32;
    let ok = household > 0.25;
    println!(
        "starter lot, {days} days: bought [{}]; used [{}]; spent ${} on interactions; average needs {} -> household {household:.2} {}",
        bought.join(", "),
        minutes
            .iter()
            .map(|(k, m)| format!("{k} {m:.0} min"))
            .collect::<Vec<_>>()
            .join(", "),
        after_buying - w.households[0].funds,
        avgs.iter()
            .map(|(name, a)| format!("{name} {a:.2}"))
            .collect::<Vec<_>>()
            .join(", "),
        if ok {
            "(> 0.25 OK)"
        } else {
            "FAIL: needs collapse (<= 0.25)"
        }
    );
    Ok(ok)
}

/// A trait that doesn't change need or skill gains (character rules want at least one).
fn neutral_trait(content: &Content) -> &str {
    let plain = |m: &sim_core::content::Modifiers| {
        m.need_gain
            .iter()
            .chain(&m.need_decay)
            .chain(&m.skill_gain)
            .all(|&x| x == 1.0)
    };
    content
        .traits
        .iter()
        .find(|t| plain(&t.mods))
        .or(content.traits.first())
        .map_or("", |t| t.id.as_str())
}

fn clock_ticks_per_day() -> u64 {
    sim_core::world::TICKS_PER_DAY
}
