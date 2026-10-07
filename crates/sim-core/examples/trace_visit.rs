//! Debug helper: replays a player visit in a captured town file and prints the visitor's state.
//! `cargo run -p sim-core --example trace_visit -- <town.json> <plot>`

use sim_core::{Command, World};

const CONTENT: &str = include_str!("../../../web/public/content/base.json");

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let town = std::fs::read_to_string(&args[1]).unwrap();
    let plot: u32 = args[2].parse().unwrap();
    let mut w = World::from_json(CONTENT, &town, 7).unwrap();
    w.apply(Command::Visit { sim: 0, plot }).unwrap();
    for step in 0..60 {
        for _ in 0..20 {
            w.tick_once();
        }
        let s = &w.sims[0];
        let (x, z) = s.tile();
        println!(
            "{step:>3} pos=({:.1},{:.1}) plot={:?} visiting={:?} current={:?} queue={:?} pose={:?}",
            s.pos[0],
            s.pos[1],
            w.plot_at(x, z),
            s.visiting.map(|v| v.plot),
            s.current().map(|a| a.task.kind),
            s.queue().map(|t| t.kind).collect::<Vec<_>>(),
            s.pose,
        );
    }
}
