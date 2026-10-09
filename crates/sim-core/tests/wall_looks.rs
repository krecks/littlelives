//! Wall looks in build mode: coverings on each face, half walls, door and window styles, their
//! prices, painting, and saving them by content id.

use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind, FacePaint};
use sim_core::lot::{EdgeLook, EdgeRef, FORM_HALF};
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "objects":[],
    "economy":{"startingFunds":1000},
    "build":{"wall":10,"door":50,"window":40,"remove":0},
    "wallCoverings":[{"id":"paint.white","price":0},{"id":"brick","price":3}],
    "doorStyles":[{"id":"panel","price":50},{"id":"french","price":90}],
    "windowStyles":[{"id":"classic","price":40},{"id":"tall","price":70}]}"#;

/// One 12×10 plot; Ada stands at (5, 5).
const TOWN: &str = r#"{"width":12,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "sims":[{"name":"Ada","x":5.5,"z":5.5}]}"#;

fn world() -> World {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w
}

fn wall(x: i32, z: i32) -> EdgeEdit {
    EdgeEdit::new(EdgeAxis::H, x, z, EdgeKind::Wall)
}

fn funds(w: &World) -> i64 {
    w.households[0].funds
}

#[test]
fn new_walls_take_the_chosen_covering_and_form() {
    let mut w = world();
    let edit = EdgeEdit {
        cover: Some(2),
        form: Some(FORM_HALF),
        ..wall(1, 2)
    };
    w.build(0, &[edit, wall(2, 2)]).unwrap();
    // Wall 10 + brick on both faces (2 × 3), and a plain wall.
    assert_eq!(funds(&w), 1000 - 16 - 10);
    assert_eq!(
        w.lot.look(EdgeRef::H(1, 2)),
        EdgeLook {
            sides: [2, 2],
            form: FORM_HALF,
            style: 0
        }
    );
    assert_eq!(w.lot.look(EdgeRef::H(2, 2)), EdgeLook::default());
    // The structure tells the renderer.
    let view: serde_json::Value =
        serde_json::from_str(&sim_core::view::structure_json(&w)).unwrap();
    let walls = view["walls"].as_array().unwrap();
    let half = walls.iter().find(|e| e["x"] == 1 && e["z"] == 2).unwrap();
    assert_eq!(half["faces"], serde_json::json!([2, 2]));
    assert_eq!(half["form"], 1);
    let plain = walls.iter().find(|e| e["x"] == 2 && e["z"] == 2).unwrap();
    assert!(plain.get("faces").is_none() && plain.get("form").is_none());
}

#[test]
fn rebuilding_a_wall_in_another_form_costs_a_wall_and_keeps_its_faces() {
    let mut w = world();
    w.build(
        0,
        &[EdgeEdit {
            cover: Some(2),
            ..wall(1, 2)
        }],
    )
    .unwrap();
    let before = funds(&w);
    // Drawing the same wall again changes nothing and costs nothing.
    w.build(0, &[wall(1, 2)]).unwrap();
    assert_eq!(funds(&w), before);
    w.build(
        0,
        &[EdgeEdit {
            form: Some(FORM_HALF),
            ..wall(1, 2)
        }],
    )
    .unwrap();
    assert_eq!(funds(&w), before - 10);
    assert_eq!(
        w.lot.look(EdgeRef::H(1, 2)),
        EdgeLook {
            sides: [2, 2],
            form: FORM_HALF,
            style: 0
        }
    );
}

#[test]
fn doors_and_windows_have_styles_with_their_own_prices() {
    let mut w = world();
    w.build(0, &[wall(1, 2), wall(2, 2), wall(3, 2)]).unwrap();
    let before = funds(&w);
    let door = EdgeEdit {
        style: Some(1),
        ..EdgeEdit::new(EdgeAxis::H, 1, 2, EdgeKind::Door)
    };
    let window = EdgeEdit::new(EdgeAxis::H, 2, 2, EdgeKind::Window);
    w.build(0, &[door, window]).unwrap();
    assert_eq!(funds(&w), before - 90 - 40, "french door, classic window");
    assert_eq!(w.lot.look(EdgeRef::H(1, 2)).style, 1);
    // Another style replaces the window (its price); the same style again is free.
    let tall = EdgeEdit {
        style: Some(1),
        ..window
    };
    w.build(0, &[tall]).unwrap();
    w.build(0, &[tall]).unwrap();
    assert_eq!(funds(&w), before - 90 - 40 - 70);
    assert_eq!(w.lot.look(EdgeRef::H(2, 2)).style, 1);
    // Unknown styles are refused.
    assert!(
        w.build(
            0,
            &[EdgeEdit {
                style: Some(2),
                ..window
            }]
        )
        .is_err()
    );
}

#[test]
fn doors_and_windows_need_a_full_height_wall() {
    let mut w = world();
    w.build(
        0,
        &[EdgeEdit {
            form: Some(FORM_HALF),
            ..wall(1, 2)
        }],
    )
    .unwrap();
    let err = w
        .build(0, &[EdgeEdit::new(EdgeAxis::H, 1, 2, EdgeKind::Door)])
        .unwrap_err();
    assert!(err.to_string().contains("full-height"), "{err}");
    let half_window = EdgeEdit {
        form: Some(FORM_HALF),
        ..EdgeEdit::new(EdgeAxis::H, 1, 2, EdgeKind::Window)
    };
    assert!(w.build(0, &[half_window]).is_err());
}

#[test]
fn removing_a_wall_is_free_and_forgets_its_look() {
    let mut w = world();
    w.build(
        0,
        &[EdgeEdit {
            cover: Some(2),
            form: Some(FORM_HALF),
            ..wall(1, 2)
        }],
    )
    .unwrap();
    let before = funds(&w);
    w.build(0, &[EdgeEdit::new(EdgeAxis::H, 1, 2, EdgeKind::Open)])
        .unwrap();
    assert_eq!(funds(&w), before);
    assert_eq!(w.lot.look(EdgeRef::H(1, 2)), EdgeLook::default());
    // A wall built there again starts plain.
    w.build(0, &[wall(1, 2)]).unwrap();
    assert_eq!(w.lot.look(EdgeRef::H(1, 2)), EdgeLook::default());
}

#[test]
fn painting_covers_one_face_and_charges_per_changed_face() {
    let mut w = world();
    w.build(
        0,
        &[
            wall(1, 2),
            EdgeEdit::new(EdgeAxis::Dp, 4, 4, EdgeKind::Wall),
        ],
    )
    .unwrap();
    let before = funds(&w);
    let face = |axis, x, z, side, covering| FacePaint {
        axis,
        x,
        z,
        side,
        covering,
    };
    w.apply(Command::Paint {
        sim: 0,
        faces: vec![
            face(EdgeAxis::H, 1, 2, 1, 2),
            // Listed twice: paid once.
            face(EdgeAxis::H, 1, 2, 1, 2),
            face(EdgeAxis::Dp, 4, 4, 0, 1),
        ],
    })
    .unwrap();
    assert_eq!(funds(&w), before - 3, "one brick face; white paint is free");
    assert_eq!(w.lot.look(EdgeRef::H(1, 2)).sides, [0, 2]);
    assert_eq!(w.lot.look(EdgeRef::Diag(4, 4)).sides, [1, 0]);
    // Painting it the same again costs nothing.
    w.paint(0, &[face(EdgeAxis::H, 1, 2, 1, 2)]).unwrap();
    assert_eq!(funds(&w), before - 3);
    // No wall, no paint; unknown coverings and faces are refused; nothing changes.
    assert!(w.paint(0, &[face(EdgeAxis::H, 5, 2, 0, 1)]).is_err());
    assert!(w.paint(0, &[face(EdgeAxis::H, 1, 2, 0, 3)]).is_err());
    assert!(w.paint(0, &[face(EdgeAxis::H, 1, 2, 2, 1)]).is_err());
    assert!(
        w.paint(0, &[face(EdgeAxis::H, 3, 11, 0, 1)]).is_err(),
        "off the plot"
    );
    assert_eq!(funds(&w), before - 3);
}

#[test]
fn looks_survive_saving_by_content_id() {
    let mut w = world();
    w.build(
        0,
        &[
            EdgeEdit {
                cover: Some(2),
                form: Some(FORM_HALF),
                ..wall(1, 2)
            },
            wall(2, 2),
            wall(3, 2),
        ],
    )
    .unwrap();
    w.build(
        0,
        &[EdgeEdit {
            style: Some(1),
            ..EdgeEdit::new(EdgeAxis::H, 2, 2, EdgeKind::Door)
        }],
    )
    .unwrap();
    w.paint(
        0,
        &[FacePaint {
            axis: EdgeAxis::H,
            x: 3,
            z: 2,
            side: 0,
            covering: 1,
        }],
    )
    .unwrap();
    let saved = w.save_json();
    let json: serde_json::Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(json["version"], sim_core::save::SAVE_VERSION);
    let looks = json["lot"]["looks"].as_array().unwrap();
    assert_eq!(looks.len(), 3);
    let half = looks.iter().find(|l| l["x"] == 1).unwrap();
    assert_eq!(half["faces"], serde_json::json!(["brick", "brick"]));
    assert_eq!(half["form"], 1);
    assert_eq!(
        looks.iter().find(|l| l["x"] == 2).unwrap()["style"],
        "french"
    );

    let loaded = World::from_save_json(CONTENT, &saved).unwrap();
    for at in [EdgeRef::H(1, 2), EdgeRef::H(2, 2), EdgeRef::H(3, 2)] {
        assert_eq!(loaded.lot.look(at), w.lot.look(at));
    }

    // Content without those looks (a pack removed): the walls stay, plain.
    let bare = CONTENT
        .replace(r#"{"id":"brick","price":3}"#, r#"{"id":"stone","price":3}"#)
        .replace("french", "glass");
    let loaded = World::from_save_json(&bare, &saved).unwrap();
    assert_eq!(
        loaded.lot.look(EdgeRef::H(1, 2)),
        EdgeLook {
            sides: [0, 0],
            form: FORM_HALF,
            style: 0
        }
    );
    assert_eq!(loaded.lot.look(EdgeRef::H(2, 2)).style, 0);
    assert_eq!(loaded.lot.look(EdgeRef::H(3, 2)).sides, [1, 0]);
}
