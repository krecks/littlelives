//! Shared test fixtures: the shipped content and a whole town built from the shipped house
//! layouts, laid out like the web's `game/town.ts` (two rows of plots on a street, the north
//! row turned to face it, a park in the middle) but deterministic.

#![allow(dead_code)]

use serde_json::{Value, json};
use sim_core::World;
use sim_core::social::FORMER;
use sim_core::world::TaskKind;

fn content_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/public/content")
}

fn read(name: &str) -> String {
    std::fs::read_to_string(content_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// base.json plus every file in its `"include"` list (careers, content packs), merged the
/// way the web loader does.
pub fn content() -> String {
    let base = read("base.json");
    let includes: Vec<String> =
        serde_json::from_value(serde_json::from_str::<Value>(&base).unwrap()["include"].clone())
            .expect("base.json lists its includes");
    let parts: Vec<String> = includes.iter().map(|n| read(n)).collect();
    let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
    sim_core::merge_content(&base, &parts).unwrap_or_else(|e| panic!("{e}"))
}

/// Looks at a lot like the game does: it and the player's home are simulated in full detail,
/// the rest of the town in less (`sim_core::lod`).
pub fn look_at(w: &mut World, plot: u32) {
    let p = &w.plots[plot as usize];
    w.set_view(Some([p.x, p.z, p.x + p.w, p.z + p.d]));
}

/// With `LOD=1` in the environment, looks at the player's home (to compare runs with lower
/// detail for the rest of the town against full detail).
pub fn lod_from_env(w: &mut World) {
    let home = w.households.iter().find(|h| h.player).and_then(|h| h.plot);
    if let Some(home) = home.filter(|_| std::env::var("LOD").is_ok_and(|v| v == "1")) {
        look_at(w, home);
    }
}

/// Everything that must hold at any moment.
pub fn check(w: &World) {
    let n = w.sims.len();
    let content_needs = w.content.needs.len();
    for (i, s) in w.sims.iter().enumerate() {
        assert_eq!(s.id as usize, i, "Sim ids are their index");
        assert!(
            s.pos.iter().all(|p| p.is_finite()),
            "{} is nowhere: {:?}",
            s.name,
            s.pos
        );
        let (x, z) = s.tile();
        assert!(w.lot.in_bounds(x, z), "{} left the town", s.name);
        for (k, v) in s.needs[..content_needs].iter().enumerate() {
            assert!((0.0..=1.0).contains(v), "{}'s need {k} is {v}", s.name);
        }
        assert!((s.household as usize) < w.households.len());
        if let Some(t) = s.engaged_with {
            assert!((t as usize) < n && t as usize != i);
        }
        if let Some(act) = s.current() {
            match act.task.kind {
                TaskKind::Use { object, .. } => {
                    let o = &w.objects[object as usize];
                    assert!(
                        o.users().any(|u| u as usize == i),
                        "{} uses object {object} without holding a slot",
                        s.name
                    );
                }
                TaskKind::Social { target, .. } => {
                    assert!((target as usize) < n && target as usize != i)
                }
                TaskKind::Visit { plot } => assert!((plot as usize) < w.plots.len()),
                _ => {}
            }
        }
        if let Some(v) = s.visiting {
            assert!((v.plot as usize) < w.plots.len());
        }
        if let Some(job) = &s.job {
            let career = &w.content.careers[job.career];
            assert!(job.level < career.levels.len());
            assert!((0.0..=100.0).contains(&job.performance));
            assert!((0.0..=1.0).contains(&job.satisfaction));
        }
    }
    // Every object slot holder is someone who is using or heading to that object.
    for o in &w.objects {
        for u in o.users() {
            let s = &w.sims[u as usize];
            let ok = s.current().is_some_and(
                |a| matches!(a.task.kind, TaskKind::Use { object, .. } if object == o.id),
            );
            assert!(
                ok,
                "object {} is held by {} who isn't using it",
                o.id, s.name
            );
        }
    }
    // Partners are mutual and one at a time.
    for a in 0..n {
        if let Some(b) = w.relationships.partner_of(a) {
            assert_eq!(
                w.relationships.partner_of(b),
                Some(a),
                "partners aren't mutual"
            );
        }
    }
    let mut last = 0;
    for e in w.events.iter() {
        assert!(e.id > last, "event ids increase");
        last = e.id;
        // A resident slot, or a former resident whose name is kept.
        let known = |r: u32| if r & FORMER != 0 { ((r & !FORMER) as usize) < w.former.len() } else { (r as usize) < n };
        assert!(known(e.a) && known(e.b) && e.c.is_none_or(known), "{e:?} names someone unknown");
    }
}

/// A small deterministic random number generator for building fixtures.
pub struct Lcg(u64);

impl Lcg {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(6364136223846793005).wrapping_add(1))
    }

    pub fn next(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next() * n as f64) as usize % n.max(1)
    }
}

const MARGIN: i64 = 8;
const STREET: i64 = 6;

/// How big a town `town_with` builds.
#[derive(Debug, Clone, Copy)]
pub struct Layout {
    /// Plots on each side of a street (one in the middle of each south row is a park).
    pub columns: i64,
    /// Streets, one behind the other (a lot is at most 256 tiles across).
    pub streets: i64,
    /// Fills back yards and the strips beside each house with garden things (a town with
    /// thousands of objects).
    pub yards: bool,
    /// Residents stop moving in at this many; later houses stand empty.
    pub max_residents: usize,
}

/// A large town: 9 houses and the park. The player's household (`player_size` newcomers
/// without jobs, or none) lives on the first plot; every other house has neighbours, most of
/// them with a job. Returns the town file.
pub fn town(content: &str, seed: u64, player_size: usize) -> String {
    town_with(content, seed, player_size, Layout { columns: 5, streets: 1, yards: false, max_residents: usize::MAX })
}

/// A town laid out like `town`, of any size.
pub fn town_with(content: &str, seed: u64, player_size: usize, layout: Layout) -> String {
    let columns = layout.columns;
    let content: Value = serde_json::from_str(content).unwrap();
    let houses: Value = serde_json::from_str(&read("houses.json")).unwrap();
    let (pw, pd) = (
        houses["plot"]["width"].as_i64().unwrap(),
        houses["plot"]["depth"].as_i64().unwrap(),
    );
    let templates = houses["houses"].as_array().unwrap();
    let park = &houses["parks"][0];
    let footprint = |def: &str| -> (i64, i64) {
        content["objects"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["id"] == def)
            .and_then(|o| o["footprint"].as_array())
            .map_or((1, 1), |f| (f[0].as_i64().unwrap(), f[1].as_i64().unwrap()))
    };
    let mut rng = Lcg::new(seed);
    let width = MARGIN * 2 + columns * pw;
    let depth = MARGIN * 2 + (pd * 2 + STREET) * layout.streets;
    let park_index = columns + columns / 2;

    let (mut walls, mut doors, mut windows, mut objects) = (vec![], vec![], vec![], vec![]);
    let (mut plots, mut households, mut sims, mut relationships) = (vec![], vec![], vec![], vec![]);
    let traits: Vec<(String, Vec<String>)> = content["traits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            let conflicts = t["conflicts"].as_array().map_or(vec![], |c| {
                c.iter().map(|c| c.as_str().unwrap().to_string()).collect()
            });
            (t["id"].as_str().unwrap().to_string(), conflicts)
        })
        .collect();
    let genders: Vec<String> = content["genders"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["id"].as_str().unwrap().to_string())
        .collect();
    let tracks: Vec<String> = content["careerCategories"]
        .as_array()
        .map(|cats| {
            cats.iter()
                .flat_map(|c| c["tracks"].as_array().unwrap())
                .map(|t| t["id"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default();
    // One-tile garden things people can do something with, for the yards.
    let yard_defs: Vec<String> = content["objects"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| {
            matches!(o["category"].as_str(), Some("garden" | "outdoor"))
                && o["interactions"].as_array().is_some_and(|i| !i.is_empty())
                && o["footprint"].as_array().is_none_or(|f| f[0] == 1 && f[1] == 1)
        })
        .map(|o| o["id"].as_str().unwrap().to_string())
        .collect();

    let mut house_number = 0;
    // Streets one behind the other, back yards touching.
    for (street, row) in (0..layout.streets).flat_map(|s| [(s, 0), (s, 1)]) {
        let block = MARGIN + street * (pd * 2 + STREET);
        let street_name = ["Elm", "Oak", "Ash", "Birch"][street as usize % 4];
        for col in 0..columns {
            let index = row * columns + col;
            let (x, z) = (
                MARGIN + col * pw,
                if row == 0 {
                    block
                } else {
                    block + pd + STREET
                },
            );
            let rotated = row == 0;
            // Plot coordinates to town coordinates (the north row is turned 180°).
            let point = |p: [f64; 2]| -> [f64; 2] {
                if rotated {
                    [(x + pw) as f64 - p[0], (z + pd) as f64 - p[1]]
                } else {
                    [x as f64 + p[0], z as f64 + p[1]]
                }
            };
            let mut place = |list: &Value| {
                for o in list.as_array().unwrap() {
                    let def = o["def"].as_str().unwrap();
                    let (ox, oz, rot) = (
                        o["x"].as_i64().unwrap(),
                        o["z"].as_i64().unwrap(),
                        o["rot"].as_i64().unwrap(),
                    );
                    let (fw, fd) = footprint(def);
                    let (w, d) = if rot % 2 == 0 { (fw, fd) } else { (fd, fw) };
                    objects.push(if rotated {
                        json!({"def": def, "x": x + pw - ox - w, "z": z + pd - oz - d, "rot": (rot + 2) % 4})
                    } else {
                        json!({"def": def, "x": x + ox, "z": z + oz, "rot": rot})
                    });
                }
            };
            if index == park_index {
                place(&park["objects"]);
                plots.push(
                    json!({"name": "Park", "x": x, "z": z, "w": pw, "d": pd, "public": true}),
                );
                continue;
            }
            let h = &templates[house_number % templates.len()];
            house_number += 1;
            for wall in h["walls"].as_array().unwrap() {
                let c: Vec<f64> = wall
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_f64().unwrap())
                    .collect();
                let (a, b) = (point([c[0], c[1]]), point([c[2], c[3]]));
                walls.push(json!([a[0] as i64, a[1] as i64, b[0] as i64, b[1] as i64]));
            }
            let edge = |d: &Value| {
                let (dx, dz, axis) = (
                    d["x"].as_i64().unwrap(),
                    d["z"].as_i64().unwrap(),
                    d["axis"].as_str().unwrap(),
                );
                if !rotated {
                    json!({"x": x + dx, "z": z + dz, "axis": axis})
                } else if axis == "x" {
                    json!({"x": x + pw - 1 - dx, "z": z + pd - dz, "axis": "x"})
                } else {
                    json!({"x": x + pw - dx, "z": z + pd - 1 - dz, "axis": "z"})
                }
            };
            doors.extend(h["doors"].as_array().unwrap().iter().map(edge));
            if let Some(w) = h["windows"].as_array() {
                windows.extend(w.iter().map(edge));
            }
            place(&h["objects"]);
            if layout.yards {
                place(&yard(h, house_number, &yard_defs, (pw, pd), footprint));
            }
            let spawns: Vec<[f64; 2]> = h["spawns"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| point([p[0].as_f64().unwrap(), p[1].as_f64().unwrap()]))
                .collect();
            let plot = plots.len();
            plots.push(
                json!({"name": format!("{} {street_name} Street", house_number * 2 - row as usize),
                "x": x, "z": z, "w": pw, "d": pd, "entry": spawns[0]}),
            );

            let player = households.is_empty();
            // Neighbours fit their house, as in the game (`town.ts`): its bedrooms, maybe one more.
            let bedrooms = h["bedrooms"].as_u64().unwrap_or(1) as usize;
            let size = if player {
                player_size
            } else {
                (bedrooms + rng.below(2) as usize).clamp(1, 4)
            };
            let size = size.min(layout.max_residents.saturating_sub(sims.len()));
            if size == 0 {
                let name = if player { "Player".to_string() } else { format!("House {}", households.len()) };
                households.push(json!({"name": name, "plot": plot, "player": player}));
                continue;
            }
            let household = households.len();
            households.push(
                json!({"name": format!("House {household}"), "plot": plot, "player": player}),
            );
            let first = sims.len();
            // A couple shares the house when there are two adults, sometimes with a grown child.
            let couple = size >= 2 && rng.next() < 0.6;
            let family = couple && size >= 3 && rng.next() < 0.6;
            let parents_age = 44.0 + rng.next() * 12.0;
            for m in 0..size {
                let mut chosen: Vec<String> = Vec::new();
                for _ in 0..2 {
                    let (t, conflicts) = &traits[rng.below(traits.len())];
                    if !chosen.contains(t) && !chosen.iter().any(|c| conflicts.contains(c)) {
                        chosen.push(t.clone());
                    }
                }
                let spawn = spawns[m % spawns.len()];
                let mut sim = json!({
                    "name": format!("R{}", sims.len()),
                    "household": household,
                    "gender": genders[rng.below(genders.len())],
                    "traits": chosen,
                    "x": spawn[0], "z": spawn[1],
                });
                if family && m < 3 {
                    // A child of any age from three to grown up.
                    sim["age"] = json!(if m < 2 { parents_age.floor() } else { (parents_age - 20.0 - rng.next() * 30.0).max(3.0).floor() });
                }
                if !player && !tracks.is_empty() && rng.next() < 0.75 {
                    let level = (rng.next().powi(2) * 6.0) as usize;
                    sim["job"] = json!({"career": tracks[rng.below(tracks.len())], "level": level});
                }
                sims.push(sim);
            }
            // Housemates are close; the couple are partners, and their grown child is family.
            for a in first..sims.len() {
                for b in a + 1..sims.len() {
                    if couple && a == first && b == first + 1 {
                        relationships.push(json!({"a": a, "b": b, "preset": "partners"}));
                    } else if family && b == first + 2 && a < b {
                        relationships.push(json!({"a": b, "b": a, "preset": "parent"}));
                    } else {
                        relationships.push(json!({"a": a, "b": b, "preset": "friends"}));
                    }
                }
            }
        }
    }
    // Neighbours know each other a little.
    let n = sims.len();
    for a in 0..n {
        for b in a + 1..n {
            if sims[a]["household"] == sims[b]["household"] {
                continue;
            }
            let roll = rng.next();
            let preset = if roll < 0.03 {
                "rivals"
            } else if roll < 0.09 {
                "friends"
            } else if roll < 0.3 {
                "acquaintances"
            } else {
                continue;
            };
            relationships.push(json!({"a": a, "b": b, "preset": preset}));
        }
    }
    // A way out of town at both ends of every street.
    let exits: Vec<Value> = (0..layout.streets)
        .flat_map(|s| {
            let street_z = (MARGIN + s * (pd * 2 + STREET) + pd) as f64 + STREET as f64 / 2.0;
            [json!([0.5, street_z]), json!([width as f64 - 0.5, street_z])]
        })
        .collect();
    json!({
        "width": width, "depth": depth,
        "walls": walls, "doors": doors, "windows": windows, "objects": objects,
        "plots": plots, "households": households, "sims": sims, "relationships": relationships,
        "exits": exits,
    })
    .to_string()
}

/// Garden things for a house's back yard and the strips beside it (plot coordinates, plot
/// `w × d`): rows with a free lane in front of each, clear of the house's own objects.
fn yard(house: &Value, number: usize, defs: &[String], (w, d): (i64, i64), footprint: impl Fn(&str) -> (i64, i64)) -> Value {
    // Tiles the house's own objects stand on, and one around them (where they're used from).
    let mut taken = std::collections::HashSet::new();
    for o in house["objects"].as_array().unwrap() {
        let (x, z, rot) = (o["x"].as_i64().unwrap(), o["z"].as_i64().unwrap(), o["rot"].as_i64().unwrap());
        let (fw, fd) = footprint(o["def"].as_str().unwrap());
        let (ow, od) = if rot % 2 == 0 { (fw, fd) } else { (fd, fw) };
        for dz in -1..=od {
            for dx in -1..=ow {
                taken.insert((x + dx, z + dz));
            }
        }
    }
    // Two rows across the back facing the house, one down each side facing out.
    let back = [d - 3, d - 1].into_iter().flat_map(|z| (1..w).step_by(2).map(move |x| (x, z, 2)));
    let sides = (5..d - 4).step_by(2).flat_map(|z| [(1, z, 3), (w - 2, z, 1)]);
    let list = back
        .chain(sides)
        .filter(|&(x, z, _)| !taken.contains(&(x, z)))
        .enumerate()
        .map(|(k, (x, z, rot))| json!({"def": defs[(number * 7 + k) % defs.len()], "x": x, "z": z, "rot": rot}))
        .collect();
    Value::Array(list)
}
