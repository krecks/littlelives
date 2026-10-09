//! Floor coverings in build mode: laying them indoors on the home plot, their prices, what the
//! renderer is told, and saving them by content id.

use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind, FloorPaint};
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "objects":[],
    "economy":{"startingFunds":1000},
    "build":{"wall":10,"door":50,"window":40,"remove":0},
    "floorCoverings":[{"id":"wood.oak","price":4},{"id":"tile.white","price":6}]}"#;

/// One 12×10 plot and a public one beside it; Ada stands at (5, 5).
const TOWN: &str = r#"{"width":16,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]},
             {"name":"Park","x":12,"z":0,"w":4,"d":10,"entry":[13.5,9.5],"public":true}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "sims":[{"name":"Ada","x":5.5,"z":5.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w
}

/// Walls around tiles x 1..4, z 1..3 (a 3×2 room, no door: nothing needs to get in).
fn room(w: &mut World) {
    let mut edits = Vec::new();
    for x in 1..4 {
        edits.push(EdgeEdit::new(EdgeAxis::H, x, 1, EdgeKind::Wall));
        edits.push(EdgeEdit::new(EdgeAxis::H, x, 3, EdgeKind::Wall));
    }
    for z in 1..3 {
        edits.push(EdgeEdit::new(EdgeAxis::V, 1, z, EdgeKind::Wall));
        edits.push(EdgeEdit::new(EdgeAxis::V, 4, z, EdgeKind::Wall));
    }
    w.build(0, &edits).unwrap();
}

fn tile(x: i32, z: i32, covering: u8) -> FloorPaint {
    FloorPaint { x, z, covering }
}

fn funds(w: &World) -> i64 {
    w.households[0].funds
}

#[test]
fn floors_go_down_indoors_and_cost_per_changed_tile() {
    let mut w = world();
    room(&mut w);
    let before = funds(&w);
    // A tile listed twice counts once.
    w.paint_floor(0, &[tile(1, 1, 1), tile(2, 1, 1), tile(2, 1, 1), tile(3, 2, 2)])
        .unwrap();
    assert_eq!(funds(&w), before - 4 - 4 - 6);
    assert_eq!(w.lot.floor(1, 1), 1);
    assert_eq!(w.lot.floor(3, 2), 2);
    assert_eq!(w.lot.floor(1, 2), 0, "untouched: the automatic floor");
    // The same covering again is free; back to automatic is free too.
    let before = funds(&w);
    w.paint_floor(0, &[tile(1, 1, 1), tile(2, 1, 0)]).unwrap();
    assert_eq!(funds(&w), before);
    assert_eq!(w.lot.floor(2, 1), 0);
}

#[test]
fn floors_need_a_room_on_the_home_plot_and_the_money() {
    let mut w = world();
    room(&mut w);
    let err = w.paint_floor(0, &[tile(6, 6, 1)]).unwrap_err();
    assert!(err.to_string().contains("inside rooms"), "{err}");
    let err = w.paint_floor(0, &[tile(13, 2, 1)]).unwrap_err();
    assert!(err.to_string().contains("your own lot"), "{err}");
    let err = w.paint_floor(0, &[tile(1, 1, 3)]).unwrap_err();
    assert!(err.to_string().contains("unknown floor covering"), "{err}");
    w.households[0].funds = 5;
    let err = w.paint_floor(0, &[tile(1, 1, 1), tile(2, 1, 1)]).unwrap_err();
    assert!(err.to_string().contains("money"), "{err}");
    // A refused command changes nothing.
    assert_eq!(w.lot.floor(1, 1), 0);
    assert_eq!(funds(&w), 5);
}

#[test]
fn the_structure_lists_floor_coverings() {
    let mut w = world();
    room(&mut w);
    let version = w.structure_version();
    w.apply(Command::PaintFloor {
        sim: 0,
        tiles: vec![tile(2, 2, 2)],
    })
    .unwrap();
    assert!(w.structure_version() > version, "the renderer rebuilds");
    let view: serde_json::Value =
        serde_json::from_str(&sim_core::view::structure_json(&w)).unwrap();
    assert_eq!(view["floors"], serde_json::json!([[2, 2, 2]]));
}

#[test]
fn floor_coverings_survive_a_save_by_id() {
    let mut w = world();
    room(&mut w);
    w.paint_floor(0, &[tile(1, 1, 1), tile(3, 2, 2)]).unwrap();
    let json = w.save_json();
    assert!(json.contains("wood.oak") && json.contains("tile.white"));
    let loaded = World::from_save_json(CONTENT, &json).unwrap();
    assert_eq!(loaded.lot.floor(1, 1), 1);
    assert_eq!(loaded.lot.floor(3, 2), 2);
    // Content without that covering any more: the tile loads with the automatic floor.
    let fewer = CONTENT.replace(r#"{"id":"wood.oak","price":4},"#, "");
    let loaded = World::from_save_json(&fewer, &json).unwrap();
    assert_eq!(loaded.lot.floor(1, 1), 0);
    assert_eq!(loaded.lot.floor(3, 2), 1, "tile.white is now the first covering");
}
