//! Fences and gates: they block walking like walls (gates let residents through) but make no
//! rooms, so a fenced garden stays outdoors. They run along the grid, never through walls.

use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind};
use sim_core::lot::{Edge, OUTDOORS};
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "objects":[{"id":"chair","name":"Chair","price":50,"interactions":[
        {"id":"sit","label":"Sit","minutes":10,"pose":"sit","tags":["rest"]}]}],
    "economy":{"startingFunds":5000},
    "build":{"wall":10,"door":50,"window":40,"remove":0,"fence":5,"gate":20},
    "fenceStyles":[{"id":"picket","price":6},{"id":"iron","price":12}]}"#;

/// One 12×10 plot; Ada stands at (8, 8).
const TOWN: &str = r#"{"width":12,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "sims":[{"name":"Ada","x":8.5,"z":8.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w.apply(Command::SetSpeed { speed: 0 }).unwrap();
    w
}

fn edit(axis: EdgeAxis, x: i32, z: i32, kind: EdgeKind, style: Option<u8>) -> EdgeEdit {
    EdgeEdit { style, ..EdgeEdit::new(axis, x, z, kind) }
}

/// A 3×3 pen at (1..4, 1..4); `gate` puts a gate in its south side.
fn pen(kind: EdgeKind, gate: bool) -> Vec<EdgeEdit> {
    let mut e = Vec::new();
    for i in 1..4 {
        e.push(edit(EdgeAxis::H, i, 1, kind, Some(1)));
        let south = if gate && i == 2 { EdgeKind::Gate } else { kind };
        e.push(edit(EdgeAxis::H, i, 4, south, Some(1)));
        e.push(edit(EdgeAxis::V, 1, i, kind, Some(1)));
        e.push(edit(EdgeAxis::V, 4, i, kind, Some(1)));
    }
    e
}

fn build(w: &mut World, edits: Vec<EdgeEdit>) -> Result<(), sim_core::Error> {
    w.apply(Command::Build { household: 0, edits })
}

#[test]
fn fences_block_gates_let_through_and_neither_makes_a_room() {
    let mut w = world();
    build(&mut w, pen(EdgeKind::Fence, true)).unwrap();
    assert_eq!(w.households[0].funds, 5000 - 11 * 12 - (12 + 20), "11 m of iron fence and an iron gate");
    assert_eq!(w.lot.room_at(2, 2), OUTDOORS, "a fenced garden stays outdoors");
    assert!(!w.lot.edge_walkable(2, 0, 2, 1), "the fence blocks");
    assert!(w.lot.edge_walkable(2, 3, 2, 4), "the gate lets residents through");
    assert_eq!(w.lot.h_edge(2, 4), Edge::Gate);

    // Walls make a room of the same pen; a wall may replace a fence.
    let mut walled = world();
    build(&mut walled, pen(EdgeKind::Wall, false)).unwrap();
    assert_ne!(walled.lot.room_at(2, 2), OUTDOORS);
    build(&mut w, vec![edit(EdgeAxis::H, 1, 1, EdgeKind::Wall, None)]).unwrap();
    assert_eq!(w.lot.h_edge(1, 1), Edge::Wall);
    // ...but a fence doesn't go into a wall, nor across a tile.
    let err = build(&mut w, vec![edit(EdgeAxis::H, 1, 1, EdgeKind::Fence, None)]).unwrap_err();
    assert!(err.to_string().contains("take it down"), "{err}");
    assert!(build(&mut w, vec![edit(EdgeAxis::Dp, 6, 6, EdgeKind::Fence, None)]).is_err());
    assert!(build(&mut w, vec![edit(EdgeAxis::H, 6, 6, EdgeKind::Fence, Some(5))]).is_err(), "unknown style");
    // A gate on a standing fence keeps its style.
    build(&mut w, vec![edit(EdgeAxis::V, 1, 2, EdgeKind::Gate, None)]).unwrap();
    let structure: serde_json::Value = serde_json::from_str(&sim_core::view::structure_json(&w)).unwrap();
    let gate = structure["fences"].as_array().unwrap().iter().find(|f| f["axis"] == "v" && f["x"] == 1 && f["z"] == 2).unwrap();
    assert_eq!((gate["kind"].as_str(), gate["style"].as_u64()), (Some("gate"), Some(1)));
    assert!(structure["walls"].as_array().unwrap().iter().all(|e| e["axis"] != "v" || e["x"] != 1), "fences aren't walls");
}

#[test]
fn fences_cant_shut_anyone_in_or_run_through_furniture() {
    let mut w = world();
    // Around Ada without a gate: refused; with one: fine.
    let around = |gate: bool| {
        let mut e = Vec::new();
        for i in 7..10 {
            e.push(edit(EdgeAxis::H, i, 7, EdgeKind::Fence, None));
            e.push(edit(EdgeAxis::H, i, 10, if gate && i == 8 { EdgeKind::Gate } else { EdgeKind::Fence }, None));
            e.push(edit(EdgeAxis::V, 7, i, EdgeKind::Fence, None));
            e.push(edit(EdgeAxis::V, 10, i, EdgeKind::Fence, None));
        }
        e
    };
    let err = build(&mut w, around(false)).unwrap_err();
    assert!(err.to_string().contains("gate"), "{err}");
    build(&mut w, around(true)).unwrap();

    w.apply(Command::Buy { household: 0, object: "chair".into(), at: Some([3, 6, 0]), style: None, turn: None }).unwrap();
    assert!(build(&mut w, vec![edit(EdgeAxis::H, 3, 7, EdgeKind::Fence, None)]).is_err(), "not in front of the chair");
    assert!(
        w.apply(Command::Buy { household: 0, object: "chair".into(), at: Some([8, 9, 0]), style: None, turn: None }).is_err(),
        "nor a chair facing a fence"
    );
}

#[test]
fn fences_are_saved_with_their_style() {
    let mut w = world();
    build(&mut w, pen(EdgeKind::Fence, true)).unwrap();
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.lot.h_edge(2, 4), Edge::Gate);
    assert_eq!(loaded.lot.h_edge(1, 1), Edge::Fence);
    assert_eq!(loaded.lot.look(sim_core::lot::EdgeRef::H(1, 1)).style, 1);
    assert_eq!(loaded.lot.room_at(2, 2), OUTDOORS);
}
