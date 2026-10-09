//! Undo in build and buy mode: every edit can be taken back (furniture, walls, floors, money)
//! while time stands still; once it moves on, or the household gets other orders, it can't.

use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind, FloorPaint};
use sim_core::lot::Edge;
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "objects":[
      {"id":"chair","name":"Chair","price":50,"interactions":[
        {"id":"sit","label":"Sit","minutes":10,"pose":"sit","tags":["rest"]}]},
      {"id":"lamp","name":"Lamp","price":30,"interactions":[]}],
    "economy":{"startingFunds":1000},
    "build":{"wall":10,"door":50,"window":40,"remove":0},
    "floorCoverings":[{"id":"wood.oak","price":4}]}"#;

/// One 12×10 plot; Ada stands at (5, 5), Bo at (8, 8).
const TOWN: &str = r#"{"width":12,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "sims":[{"name":"Ada","x":5.5,"z":5.5},{"name":"Bo","x":8.5,"z":8.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w.apply(Command::SetSpeed { speed: 0 }).unwrap();
    w
}

fn buy(w: &mut World, def: &str, x: i32, z: i32) {
    w.apply(Command::Buy {
        household: 0,
        object: def.into(),
        at: Some([x, z, 0]),
        style: None,
        turn: None,
    })
    .unwrap();
}

fn undo(w: &mut World) {
    w.apply(Command::Undo { household: 0 }).unwrap();
}

fn funds(w: &World) -> i64 {
    w.households[0].funds
}

/// Objects as `(def, x, z)`, in order (ids are list positions).
fn objects(w: &World) -> Vec<(usize, i32, i32)> {
    w.objects.iter().map(|o| (o.def, o.x, o.z)).collect()
}

#[test]
fn undo_takes_back_a_purchase_and_refunds_it_in_full() {
    let mut w = world();
    buy(&mut w, "chair", 1, 1);
    assert_eq!(funds(&w), 950);
    assert_eq!(w.undo_steps(0), 1);
    undo(&mut w);
    assert!(w.objects.is_empty());
    assert_eq!(funds(&w), 1000);
    assert_eq!(w.undo_steps(0), 0);
    let err = w.apply(Command::Undo { household: 0 }).unwrap_err();
    assert!(err.to_string().contains("nothing to undo"), "{err}");
}

#[test]
fn undoing_a_sale_puts_the_object_back_in_its_place_and_takes_the_money_back() {
    let mut w = world();
    buy(&mut w, "chair", 1, 1);
    buy(&mut w, "lamp", 3, 1);
    buy(&mut w, "chair", 5, 1);
    let before = (objects(&w), funds(&w));
    w.apply(Command::Sell { household: 0, object: 1 }).unwrap();
    assert_eq!(w.objects.len(), 2);
    undo(&mut w);
    assert_eq!((objects(&w), funds(&w)), before, "same objects, same ids, same money");
    let version = w.structure_version();
    // Undo again: the second chair goes, then the lamp, then the first chair.
    undo(&mut w);
    assert!(w.structure_version() > version, "the renderer rebuilds");
    undo(&mut w);
    undo(&mut w);
    assert!(w.objects.is_empty());
    assert_eq!(funds(&w), 1000);
}

#[test]
fn undo_reverses_moves_walls_and_floors_one_step_at_a_time() {
    let mut w = world();
    buy(&mut w, "chair", 1, 1);
    w.apply(Command::MoveObject {
        household: 0,
        object: 0,
        x: 2,
        z: 6,
        rot: 1,
        turn: None,
    })
    .unwrap();
    let mut edits = Vec::new();
    for x in 1..4 {
        edits.push(EdgeEdit::new(EdgeAxis::H, x, 1, EdgeKind::Wall));
        edits.push(EdgeEdit::new(EdgeAxis::H, x, 3, EdgeKind::Wall));
    }
    for z in 1..3 {
        edits.push(EdgeEdit::new(EdgeAxis::V, 1, z, EdgeKind::Wall));
        edits.push(EdgeEdit::new(EdgeAxis::V, 4, z, EdgeKind::Wall));
    }
    w.apply(Command::Build { household: 0, edits }).unwrap();
    w.apply(Command::PaintFloor {
        household: 0,
        tiles: vec![FloorPaint {
            x: 2,
            z: 2,
            covering: 1,
        }],
    })
    .unwrap();
    assert_eq!(w.undo_steps(0), 4);

    undo(&mut w);
    assert_eq!(w.lot.floor(2, 2), 0, "the floor first");
    assert_ne!(w.lot.room_at(2, 2), 0, "the room still stands");
    undo(&mut w);
    assert_eq!(w.lot.h_edge(2, 1), Edge::Open, "then the walls");
    assert_eq!(w.lot.room_at(2, 2), 0);
    undo(&mut w);
    assert_eq!(objects(&w), vec![(0, 1, 1)], "then the move");
    assert_eq!(w.objects[0].rot, 0);
    assert_eq!(funds(&w), 950);
}

#[test]
fn edits_that_change_nothing_or_fail_leave_no_step() {
    let mut w = world();
    buy(&mut w, "chair", 1, 1);
    // Painting a floor outdoors fails; selling something unknown fails.
    assert!(w
        .apply(Command::PaintFloor {
            household: 0,
            tiles: vec![FloorPaint {
                x: 6,
                z: 6,
                covering: 1
            }]
        })
        .is_err());
    assert!(w.apply(Command::Sell { household: 0, object: 9 }).is_err());
    // Building nothing changes nothing.
    w.apply(Command::Build {
        household: 0,
        edits: Vec::new(),
    })
    .unwrap();
    assert_eq!(w.undo_steps(0), 1);
    // Pausing and unpausing keeps the history; a new household style is an edit too.
    w.apply(Command::SetSpeed { speed: 0 }).unwrap();
    assert_eq!(w.undo_steps(0), 1);
}

#[test]
fn history_ends_when_time_moves_on_or_residents_get_orders() {
    let mut w = world();
    buy(&mut w, "chair", 1, 1);
    w.apply(Command::SetSpeed { speed: 1 }).unwrap();
    w.advance();
    assert_eq!(w.undo_steps(0), 0, "time moved on");

    let mut w = world();
    buy(&mut w, "chair", 1, 1);
    w.apply(Command::Use {
        sim: 0,
        object: 0,
        interaction: 0,
    })
    .unwrap();
    assert_eq!(w.undo_steps(0), 0, "an order for a resident");
    assert!(w.apply(Command::Undo { household: 0 }).is_err());
}

#[test]
fn undo_keeps_a_limited_number_of_steps() {
    let mut w = world();
    w.households[0].funds = 100_000;
    // Rows of lamps with a free column at x = 11 so every front stays reachable.
    for i in 0..35 {
        buy(&mut w, "lamp", i % 11, (i / 11) * 2);
    }
    assert_eq!(w.undo_steps(0), 30);
    for _ in 0..30 {
        undo(&mut w);
    }
    assert_eq!(w.objects.len(), 5, "the oldest five purchases stay");
    assert!(w.apply(Command::Undo { household: 0 }).is_err());
}

#[test]
fn the_ui_state_reports_undo_steps() {
    let mut w = world();
    buy(&mut w, "chair", 1, 1);
    let ui: serde_json::Value = serde_json::from_str(&sim_core::view::ui_state_json(&w)).unwrap();
    assert_eq!(ui["households"][0]["undo"], 1);
}

fn redo(w: &mut World) {
    w.apply(Command::Redo { household: 0 }).unwrap();
}

#[test]
fn redo_makes_undone_edits_again_until_the_next_edit() {
    let mut w = world();
    buy(&mut w, "chair", 1, 1);
    buy(&mut w, "lamp", 3, 1);
    let after = (objects(&w), funds(&w));
    undo(&mut w);
    undo(&mut w);
    assert!(w.objects.is_empty());
    assert_eq!(w.redo_steps(0), 2);
    redo(&mut w);
    assert_eq!(objects(&w), after.0[..1], "the chair is back first");
    redo(&mut w);
    assert_eq!((objects(&w), funds(&w)), after, "then the lamp, paid again");
    assert_eq!((w.undo_steps(0), w.redo_steps(0)), (2, 0));
    let err = w.apply(Command::Redo { household: 0 }).unwrap_err();
    assert!(err.to_string().contains("nothing to redo"), "{err}");

    // Undo, redo, undo: still the same history.
    undo(&mut w);
    redo(&mut w);
    undo(&mut w);
    assert_eq!(w.objects.len(), 1);
    // A new edit drops what was undone.
    buy(&mut w, "chair", 5, 1);
    assert_eq!(w.redo_steps(0), 0);
    assert!(w.apply(Command::Redo { household: 0 }).is_err());

    // Time moving on drops it too.
    undo(&mut w);
    assert_eq!(w.redo_steps(0), 1);
    w.apply(Command::SetSpeed { speed: 1 }).unwrap();
    w.tick_once();
    assert_eq!((w.undo_steps(0), w.redo_steps(0)), (0, 0));
}
