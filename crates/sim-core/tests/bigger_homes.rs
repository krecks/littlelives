//! Bigger homes: blueprints (a house saved and built again on another lot, turned round for the
//! other side of the street) and moving a room with what stands in it.

use sim_core::blueprint::Blueprint;
use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind, FacePaint, FloorPaint};
use sim_core::lot::{Edge, EdgeRef, OUTDOORS};
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "objects":[{"id":"chair","name":"Chair","price":100,"interactions":[{"id":"sit","label":"Sit","minutes":30,"effects":{"hunger":0.01}}]}],
    "economy":{"startingFunds":5000},
    "build":{"wall":10,"door":50,"window":40,"remove":0},
    "wallCoverings":[{"id":"paint.white","price":0},{"id":"brick","price":3}],
    "floorCoverings":[{"id":"oak","price":2}],
    "doorStyles":[{"id":"panel","price":50},{"id":"french","price":90}],
    "windowStyles":[{"id":"classic","price":40},{"id":"tall","price":70}],
    "roofStyles":[{"id":"gable"},{"id":"hip"}],
    "roofColors":[{"id":"slate"},{"id":"red"}],
    "styles":[{"id":"modern","label":"Modern"},{"id":"cozy","label":"Cozy"}]}"#;

/// Two empty lots side by side, facing opposite ways: the west lot's street is at its far side
/// (entry at the bottom), the east lot's at its near side. Nobody lives on the east lot.
const TOWN: &str = r#"{"width":24,"depth":12,
    "plots":[{"name":"West","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]},
             {"name":"East","x":12,"z":0,"w":12,"d":10,"entry":[18.5,0.5]}],
    "households":[{"name":"Player","plot":0,"player":true},{"name":"Other","plot":1}],
    "sims":[{"name":"Ada","household":0,"x":1.5,"z":8.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w
}

fn edit(axis: EdgeAxis, x: i32, z: i32, kind: EdgeKind) -> EdgeEdit {
    EdgeEdit::new(axis, x, z, kind)
}

/// A 4×3 room with its corner at `(x, z)`: a french door in its bottom wall, a window on the
/// right, brick inside the top wall, oak floor, a cozy chair (upgraded once) and a hip roof.
fn build_room(w: &mut World, household: u32, x: i32, z: i32) {
    let mut edits = Vec::new();
    for i in 0..4 {
        edits.push(edit(EdgeAxis::H, x + i, z, EdgeKind::Wall));
        edits.push(edit(EdgeAxis::H, x + i, z + 3, if i == 1 { EdgeKind::Door } else { EdgeKind::Wall }));
    }
    for i in 0..3 {
        edits.push(edit(EdgeAxis::V, x, z + i, EdgeKind::Wall));
        edits.push(edit(EdgeAxis::V, x + 4, z + i, if i == 1 { EdgeKind::Window } else { EdgeKind::Wall }));
    }
    for e in edits.iter_mut() {
        if e.kind == EdgeKind::Door {
            e.style = Some(1);
        }
    }
    w.apply(Command::Build { household, edits }).unwrap();
    w.apply(Command::Paint { household, faces: vec![FacePaint { axis: EdgeAxis::H, x: x + 1, z, side: 1, covering: 2 }] }).unwrap();
    let tiles = (0..4).flat_map(|i| (0..3).map(move |j| FloorPaint { x: x + i, z: z + j, covering: 1 })).collect();
    w.apply(Command::PaintFloor { household, tiles }).unwrap();
    w.apply(Command::SetRoof { household, style: 1, color: 1 }).unwrap();
    w.apply(Command::Buy { household, object: "chair".into(), at: Some([x + 1, z, 0]), style: Some(1), turn: None }).unwrap();
    let chair = w.objects.len() as u32 - 1;
    w.apply(Command::Upgrade { household, object: chair }).unwrap();
}

/// The same blueprint, in a canonical order (lots taken in different frames list things differently).
fn sorted(mut bp: Blueprint) -> String {
    bp.edges.sort_by_key(|e| (format!("{:?}", e.axis), e.x, e.z));
    bp.floors.sort_by_key(|f| (f.x, f.z));
    bp.objects.sort_by_key(|o| (o.x, o.z));
    serde_json::to_string(&bp).unwrap()
}

#[test]
fn a_house_saved_as_a_blueprint_is_built_again_turned_round_on_the_other_side() {
    let mut w = world();
    build_room(&mut w, 0, 2, 2);
    let bp = w.blueprint(0).unwrap();
    assert_eq!(bp.edges.len(), 14);
    assert_eq!(bp.objects.len(), 1);
    assert_eq!(bp.floors.len(), 12);
    let before = w.households[1].funds;
    w.apply(Command::BuildBlueprint { household: 1, blueprint: bp.clone() }).unwrap();
    // The same house, seen from its own street.
    assert_eq!(sorted(w.blueprint(1).unwrap()), sorted(bp));
    // Turned round: the door that faced the far street on the west lot faces the near one here.
    let door = (12..24).find(|&x| w.lot.h_edge(x, 5) == Edge::Door || w.lot.h_edge(x, 8) == Edge::Door);
    assert!(door.is_some());
    assert_eq!(w.lot.h_edge(door.unwrap(), 5), Edge::Door, "the door is on the street side (z small)");
    // Paid for walls, door, window, brick, floor, chair and its upgrade like building it by hand.
    let spent = before - w.households[1].funds;
    assert!(spent > 300 && spent < 1500, "spent {spent}");
    // One undo step takes it all back.
    w.apply(Command::Undo { household: 1 }).unwrap();
    assert!(w.blueprint(1).unwrap().edges.is_empty());
    assert_eq!(w.households[1].funds, before);
}

#[test]
fn a_blueprint_needs_an_empty_lot_and_the_money() {
    let mut w = world();
    build_room(&mut w, 0, 2, 2);
    let bp = w.blueprint(0).unwrap();
    assert!(w.apply(Command::BuildBlueprint { household: 0, blueprint: bp.clone() }).is_err(), "the lot has a house");
    w.households[1].funds = 100;
    let err = w.apply(Command::BuildBlueprint { household: 1, blueprint: bp }).unwrap_err();
    assert!(err.to_string().contains("costs"), "{err}");
    assert!(w.blueprint(1).unwrap().edges.is_empty(), "nothing was built");
    assert_eq!(w.households[1].funds, 100);
}

#[test]
fn a_room_moves_with_its_walls_floor_and_furniture() {
    let mut w = world();
    build_room(&mut w, 0, 2, 2);
    let room = w.lot.room_at(3, 3);
    assert_ne!(room, OUTDOORS);
    let chair = w.objects.iter().find(|o| o.def == 0).map(|o| (o.x, o.z, o.quality, o.style)).unwrap();
    w.apply(Command::MoveRoom { household: 0, x: 3, z: 3, dx: 3, dz: 1 }).unwrap();
    assert_eq!(w.lot.room_at(3, 3), OUTDOORS, "the old place is open ground");
    assert_ne!(w.lot.room_at(6, 4), OUTDOORS, "the room stands at its new place");
    assert_eq!(w.lot.h_edge(2, 2), Edge::Open);
    assert_eq!(w.lot.h_edge(6, 6), Edge::Door, "the door came along");
    assert_eq!(w.lot.v_edge(9, 4), Edge::Window, "and the window");
    assert_eq!(w.lot.look(EdgeRef::H(6, 6)).style, 1);
    assert_eq!(w.lot.look(EdgeRef::H(6, 3)).sides[1], 2, "brick inside the top wall");
    assert_eq!(w.lot.floor(5, 3), 1);
    assert_eq!(w.lot.floor(2, 2), 0);
    let moved = w.objects.iter().find(|o| o.def == 0).map(|o| (o.x, o.z, o.quality, o.style)).unwrap();
    assert_eq!(moved, (chair.0 + 3, chair.1 + 1, chair.2, chair.3));
    // Off the lot, or nowhere: refused, nothing changes.
    assert!(w.apply(Command::MoveRoom { household: 0, x: 6, z: 4, dx: 6, dz: 0 }).is_err());
    assert_ne!(w.lot.room_at(6, 4), OUTDOORS);
    // Undo puts it back.
    w.apply(Command::Undo { household: 0 }).unwrap();
    assert_ne!(w.lot.room_at(3, 3), OUTDOORS);
    assert_eq!(w.lot.h_edge(2, 2), Edge::Wall);
}

#[test]
fn a_room_leaves_the_wall_it_shares_and_wont_land_on_another() {
    let mut w = world();
    build_room(&mut w, 0, 1, 1);
    // A second room sharing the first one's right wall (x = 5), with its own door.
    let mut edits = Vec::new();
    for i in 0..3 {
        edits.push(edit(EdgeAxis::H, 5 + i, 1, EdgeKind::Wall));
        edits.push(edit(EdgeAxis::H, 5 + i, 4, if i == 1 { EdgeKind::Door } else { EdgeKind::Wall }));
        edits.push(edit(EdgeAxis::V, 8, 1 + i, EdgeKind::Wall));
    }
    w.apply(Command::Build { household: 0, edits }).unwrap();
    let other = w.lot.room_at(6, 2);
    assert_ne!(other, OUTDOORS);
    assert!(w.apply(Command::MoveRoom { household: 0, x: 2, z: 2, dx: 3, dz: 0 }).is_err(), "lands on the other room");
    w.apply(Command::MoveRoom { household: 0, x: 2, z: 2, dx: 0, dz: 5 }).unwrap_or_else(|e| panic!("{e}"));
    assert_ne!(w.lot.room_at(6, 2), OUTDOORS, "the other room keeps its walls");
    assert_eq!(w.lot.v_edge(5, 1), Edge::Wall);
    assert_ne!(w.lot.room_at(2, 7), OUTDOORS);
}
