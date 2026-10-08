//! Prints what each Sim on the starter lot does every hour for a few days.
use sim_core::{World, clock};

fn main() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/public/content");
    let read = |name: &str| std::fs::read_to_string(dir.join(name)).unwrap();
    let base = read("base.json");
    let includes: Vec<String> = serde_json::from_value(
        serde_json::from_str::<serde_json::Value>(&base).unwrap()["include"].clone(),
    )
    .unwrap();
    let parts: Vec<String> = includes.iter().map(|n| read(n)).collect();
    let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
    let content = sim_core::merge_content(&base, &parts).unwrap();
    let mut lot: serde_json::Value = serde_json::from_str(include_str!(
        "../../../web/public/content/lots/starter.json"
    ))
    .unwrap();
    let sp = lot["spawns"].clone();
    lot["sims"] = serde_json::json!([
        { "name": "Ada", "traits": ["foodie", "lazy"], "perks": ["ironBladder"], "x": sp[0][0], "z": sp[0][1] },
        { "name": "Bo", "traits": ["neat", "cheerful", "bookworm"], "perks": ["speedWalker", "sunnyDisposition"], "x": sp[1][0], "z": sp[1][1] },
    ]);
    let mut w = World::from_json(&content, &lot.to_string(), 2).unwrap();
    for h in 0..(24 * 3) {
        let t = clock::tick_at(1 + (8 + h) / 24, ((8 + h) % 24) as f32 * 60.0).unwrap();
        while w.tick < t {
            w.tick_once();
        }
        let line: Vec<String> = w
            .sims
            .iter()
            .map(|s| {
                let ui = s
                    .current()
                    .map(|a| format!("{:?}", a.task.kind))
                    .unwrap_or("idle".into());
                format!(
                    "{} {:?} E{:.2} H{:.2} B{:.2} {}",
                    s.name,
                    s.pose,
                    s.needs[1],
                    s.needs[0],
                    s.needs[2],
                    &ui[..ui.len().min(40)]
                )
            })
            .collect();
        println!(
            "d{} {:02}:00 | {}",
            clock::day(w.tick),
            (8 + h) % 24,
            line.join(" | ")
        );
    }
}
