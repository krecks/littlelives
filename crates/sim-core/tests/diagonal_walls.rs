//! Diagonal walls in build mode: rooms with diagonal sides, costs, doors and windows in
//! diagonal walls, the keep-reach rule, furniture, and residents walking around and through.

use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind};
use sim_core::lot::{DiagDir, Edge, OUTDOORS};
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "objects":[
      {"id":"weights","name":"Weights","price":400,"interactions":[
        {"id":"lift","label":"Lift","minutes":60,"effects":{"hunger":-0.1}}]}],
    "economy":{"startingFunds":1000},
    "build":{"wall":10,"door":50,"remove":5}}"#;

/// One 12×10 plot; Ada and Bo stand at (5, 5) and (6, 5); weights at (8, 1).
const TOWN: &str = r#"{"width":12,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "objects":[{"def":"weights","x":8,"z":1,"rot":0}],
    "sims":[{"name":"Ada","x":5.5,"z":5.5},{"name":"Bo","x":6.5,"z":5.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false }).unwrap();
    w
}

fn edit(axis: EdgeAxis, x: i32, z: i32, kind: EdgeKind) -> EdgeEdit {
    EdgeEdit::new(axis, x, z, kind)
}

/// A diamond room with corners (1,7), (3,5), (5,7), (3,9): eight diagonal tiles.
fn diamond(kind: EdgeKind) -> Vec<EdgeEdit> {
    vec![
        edit(EdgeAxis::Dn, 1, 6, kind),
        edit(EdgeAxis::Dn, 2, 5, kind),
        edit(EdgeAxis::Dp, 3, 5, kind),
        edit(EdgeAxis::Dp, 4, 6, kind),
        edit(EdgeAxis::Dn, 4, 7, kind),
        edit(EdgeAxis::Dn, 3, 8, kind),
        edit(EdgeAxis::Dp, 2, 8, kind),
        edit(EdgeAxis::Dp, 1, 7, kind),
    ]
}

#[test]
fn diagonal_rooms_cost_more_per_wall_and_split_tiles() {
    let mut w = world();
    w.build(0, &diamond(EdgeKind::Wall)).unwrap();
    // 10 × 1.414 = 14.14 → 14 per diagonal wall.
    assert_eq!(w.households[0].funds, 1000 - 8 * 14);
    let inside = w.lot.room_at(2, 7);
    assert_ne!(inside, OUTDOORS);
    assert_eq!(w.lot.half_room(1, 6, 1), inside, "inner half");
    assert_eq!(w.lot.half_room(1, 6, 0), OUTDOORS, "outer half");
    assert_eq!(w.lot.half_room(3, 5, 1), inside);
    assert_eq!(w.lot.half_room(3, 5, 0), OUTDOORS);
    // The structure carries the diagonals with the rooms of both halves.
    let view: serde_json::Value =
        serde_json::from_str(&sim_core::view::structure_json(&w)).unwrap();
    let diags = view["diagonals"].as_array().unwrap();
    assert_eq!(diags.len(), 8);
    assert!(
        diags.contains(
            &serde_json::json!({"x":1,"z":6,"axis":"dn","kind":"wall","rooms":[0, inside]})
        )
    );
    // Drawing the same walls again is free; removing one opens the room again.
    w.build(0, &diamond(EdgeKind::Wall)).unwrap();
    assert_eq!(w.households[0].funds, 1000 - 8 * 14);
    // Removing with the wrong direction leaves the wall (and costs nothing).
    w.build(0, &[edit(EdgeAxis::Dp, 1, 6, EdgeKind::Open)])
        .unwrap();
    assert_eq!(w.lot.diag(1, 6).map(|d| d.dir), Some(DiagDir::Dn));
    assert_eq!(w.households[0].funds, 1000 - 8 * 14);
    w.build(0, &[edit(EdgeAxis::Dn, 1, 6, EdgeKind::Open)])
        .unwrap();
    assert_eq!(w.lot.diag(1, 6), None);
    assert_eq!(w.lot.room_at(2, 7), OUTDOORS);
    assert_eq!(w.households[0].funds, 1000 - 8 * 14 - 5);
}

#[test]
fn doors_and_windows_go_into_diagonal_walls() {
    let mut w = world();
    let err = w
        .build(0, &[edit(EdgeAxis::Dn, 4, 7, EdgeKind::Door)])
        .unwrap_err();
    assert!(err.to_string().contains("door"), "{err}");
    // In the same edit as the walls beside it, a door is fine.
    let mut room = diamond(EdgeKind::Wall);
    room[4] = edit(EdgeAxis::Dn, 4, 7, EdgeKind::Door);
    w.build(0, &room).unwrap();
    assert_eq!(w.households[0].funds, 1000 - 7 * 14 - 50);
    assert_eq!(w.lot.diag(4, 7).map(|d| d.edge), Some(Edge::Door));
    // A window into an existing diagonal wall (120 when the content doesn't price windows).
    w.build(0, &[edit(EdgeAxis::Dn, 1, 6, EdgeKind::Window)])
        .unwrap();
    assert_eq!(w.lot.diag(1, 6).map(|d| d.edge), Some(Edge::Window));
    assert!(w.lot.diag_blocks(1, 6), "windows block like walls");
    assert_eq!(w.households[0].funds, 1000 - 7 * 14 - 50 - 120);
    // Doors and windows still separate rooms: the diamond stays a room of its own.
    assert_ne!(w.lot.room_at(2, 7), OUTDOORS);
    // A tile holds one diagonal: the other way is refused.
    let err = w
        .build(0, &[edit(EdgeAxis::Dp, 1, 6, EdgeKind::Wall)])
        .unwrap_err();
    assert!(err.to_string().contains("other way"), "{err}");
}

#[test]
fn furniture_and_residents_keep_clear_of_diagonals() {
    let mut w = world();
    // Not across furniture, nor across a resident (Bo stands on (6, 5)).
    let err = w
        .build(0, &[edit(EdgeAxis::Dp, 8, 1, EdgeKind::Wall)])
        .unwrap_err();
    assert!(err.to_string().contains("furniture"), "{err}");
    let err = w
        .build(0, &[edit(EdgeAxis::Dp, 6, 5, EdgeKind::Wall)])
        .unwrap_err();
    assert!(err.to_string().contains("standing"), "{err}");
    // No furniture on a tile with a diagonal.
    w.build(0, &diamond(EdgeKind::Wall)).unwrap();
    let err = w.buy(0, "weights", Some([1, 6, 1]), None).unwrap_err();
    assert!(err.to_string().contains("diagonal"), "{err}");
    // Inside the closed room nothing can be reached yet; with a door, it can.
    w.build(0, &[edit(EdgeAxis::Dn, 4, 7, EdgeKind::Door)])
        .unwrap();
    let weights = w.buy(0, "weights", Some([2, 7, 1]), None).unwrap();
    assert_eq!(w.objects[weights as usize].x, 2);
    // Walling the door up again would shut the weights in.
    let err = w
        .build(0, &[edit(EdgeAxis::Dn, 4, 7, EdgeKind::Wall)])
        .unwrap_err();
    assert!(err.to_string().contains("shut"), "{err}");
    // A diagonal wall across an object's front tile is refused too: the old weights at (8, 1)
    // face +z, onto (8, 2).
    let err = w
        .build(0, &[edit(EdgeAxis::Dn, 8, 2, EdgeKind::Wall)])
        .unwrap_err();
    assert!(err.to_string().contains("shut"), "{err}");
}

#[test]
fn residents_walk_around_diagonal_walls_and_in_through_the_door() {
    let mut w = world();
    let mut room = diamond(EdgeKind::Wall);
    // The door faces away from Ada (on the far, upper-left side), so she has to walk around.
    room[7] = edit(EdgeAxis::Dp, 1, 7, EdgeKind::Door);
    w.build(0, &room).unwrap();
    w.apply(Command::MoveTo {
        sim: 0,
        x: 3.5,
        z: 6.5,
    })
    .unwrap();
    let mut via_door = false;
    for _ in 0..4000 {
        w.tick_once();
        let (x, z) = w.sims[0].tile();
        assert!(
            !w.lot.diag_blocks(x, z),
            "Ada walked onto a diagonal wall at {x},{z}"
        );
        via_door |= (x, z) == (1, 7);
        if (x, z) == (3, 6) && w.sims[0].current().is_none() {
            break;
        }
    }
    assert_eq!(w.sims[0].tile(), (3, 6), "Ada arrives inside the diamond");
    assert!(via_door, "through the door tile");
    assert_eq!(w.lot.room_at(3, 6), w.lot.half_room(1, 7, 0));
}
