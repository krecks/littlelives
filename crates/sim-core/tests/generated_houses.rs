//! Generated houses (web/src/game/housegen.ts) checked by the simulation: each loads, has a
//! bed, a fridge and a toilet in rooms of their own, and everything in it can be reached from the
//! front door, upstairs too.
//!
//! Make the houses first: `node --experimental-strip-types tools/housegen/sample.ts houses.json`,
//! then `HOUSES=houses.json cargo test -p sim-core --test generated_houses -- --ignored --nocapture`.

use sim_core::lot::OUTDOORS;
use sim_core::path::NavGrid;
use sim_core::World;

fn content() -> String {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/public/content");
    let base = std::fs::read_to_string(dir.join("base.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&base).unwrap();
    let parts: Vec<String> = value["include"]
        .as_array()
        .map(|list| list.iter().map(|p| std::fs::read_to_string(dir.join(p.as_str().unwrap())).unwrap()).collect())
        .unwrap_or_default();
    let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
    sim_core::merge_content(&base, &parts).unwrap()
}

#[test]
#[ignore]
fn generated_houses_are_livable() {
    let Ok(path) = std::env::var("HOUSES") else {
        eprintln!("set HOUSES to a file made by tools/housegen/sample.ts");
        return;
    };
    let houses: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let content = content();
    let mut failures = Vec::new();
    for h in &houses {
        let label = format!("{} {} ({})", h["size"], h["seed"], h["description"]);
        let w = match World::from_json(&content, &h["town"].to_string(), 1) {
            Ok(w) => w,
            Err(e) => {
                failures.push(format!("{label}: {e}"));
                continue;
            }
        };
        let room_of = |def: &str| {
            w.objects
                .iter()
                .find(|o| w.content.objects[o.def].id == def)
                .map(|o| w.lot.room_at(o.x, o.z))
        };
        let (bed, fridge, toilet) = (room_of("bed"), room_of("fridge"), room_of("toilet"));
        for (what, room) in [("bed", bed), ("fridge", fridge), ("toilet", toilet)] {
            if room.is_none_or(|r| r == OUTDOORS) {
                failures.push(format!("{label}: no {what} indoors"));
            }
        }
        if bed.is_some() && (bed == toilet || bed == fridge) || fridge == toilet {
            failures.push(format!("{label}: bedroom, kitchen and bathroom share a room"));
        }
        // Everything reachable from the street.
        let entry = w.plots[0].arrival_point();
        let nav = NavGrid { lot: &w.lot, blocked: w.blocked(), stairs: w.stair_map() };
        let start = (entry[0].floor() as i32, entry[1].floor() as i32);
        for o in &w.objects {
            // Pictures, ceiling lamps and rugs nobody uses needn't be reached.
            let def = &w.content.objects[o.def];
            if def.layer.mounted() && def.interactions.is_empty() {
                continue;
            }
            let front = o.front_tile(&w.content);
            if nav.find_path(start, front).is_none() {
                failures.push(format!("{label}: can't reach the {} at {},{}", w.content.objects[o.def].id, o.x, o.z));
            }
        }
    }
    eprintln!("{} houses checked, {} problems", houses.len(), failures.len());
    for f in failures.iter().take(30) {
        eprintln!("  {f}");
    }
    assert!(failures.is_empty());
}
