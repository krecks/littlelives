//! Storeys: rooms upstairs stand on rooms below, stairs lead up, residents climb them to use
//! what's upstairs, and saves keep it all (older saves grow the storeys).

use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind};
use sim_core::lot::OUTDOORS;
use sim_core::{Command, World, snapshot};

fn content(storeys: u8) -> String {
    format!(
        r#"{{
    "needs":[{{"id":"comfort","label":"Comfort","decayPerHour":0.01}}],
    "objects":[
      {{"id":"stairs","name":"Stairs","price":400,"footprint":[1,4],"stairs":true,"interactions":[]}},
      {{"id":"chair","name":"Chair","price":50,"interactions":[{{"id":"sit","label":"Sit","minutes":60,"pose":"sit","effects":{{"comfort":0.5}}}}]}}],
    "economy":{{"startingFunds":20000}},
    "build":{{"wall":10,"door":50,"window":40,"remove":0,"storeys":{storeys}}}}}"#
    )
}

/// One 16×12 plot; the town is 16 deep, so storey 1 is rows 16..32. Ada stands in the garden.
const TOWN: &str = r#"{"width":20,"depth":16,
    "plots":[{"name":"Home","x":2,"z":1,"w":16,"d":12,"entry":[9.5,12.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "sims":[{"name":"Ada","x":9.5,"z":11.5}]}"#;

const UP: i32 = 16;

fn world(storeys: u8) -> World {
    let mut w = World::from_json(&content(storeys), TOWN, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    w
}

/// The walls of a `w`×`d` room with its corner at `(x, z)`, and a door at the bottom unless `up`.
fn room(x: i32, z: i32, w: i32, d: i32, door: bool) -> Vec<EdgeEdit> {
    let mut edits = Vec::new();
    for i in 0..w {
        edits.push(EdgeEdit::new(EdgeAxis::H, x + i, z, EdgeKind::Wall));
        let kind = if door && i == 1 { EdgeKind::Door } else { EdgeKind::Wall };
        edits.push(EdgeEdit::new(EdgeAxis::H, x + i, z + d, kind));
    }
    for i in 0..d {
        edits.push(EdgeEdit::new(EdgeAxis::V, x, z + i, EdgeKind::Wall));
        edits.push(EdgeEdit::new(EdgeAxis::V, x + w, z + i, EdgeKind::Wall));
    }
    edits
}

fn build(w: &mut World, edits: Vec<EdgeEdit>) -> Result<(), sim_core::Error> {
    w.apply(Command::Build { household: 0, edits })
}

fn buy(w: &mut World, def: &str, x: i32, z: i32, rot: i32) -> Result<u32, sim_core::Error> {
    w.apply(Command::Buy { household: 0, object: def.into(), at: Some([x, z, rot]), style: None, turn: None })?;
    Ok(w.objects.len() as u32 - 1)
}

fn height(w: &World, i: usize) -> f32 {
    let mut out = vec![0.0; snapshot::CAPACITY];
    snapshot::write(w, &mut out);
    out[snapshot::HEADER_LEN + i * snapshot::SIM_STRIDE + snapshot::sim::HEIGHT]
}

/// A house with a 6×6 room downstairs (door at the bottom), the same room upstairs, and stairs
/// along the right wall climbing towards the back.
fn house() -> World {
    let mut w = world(2);
    assert_eq!(w.lot.depth, 32, "two storeys of 16 rows");
    build(&mut w, room(4, 2, 6, 6, true)).unwrap();
    build(&mut w, room(4, 2 + UP, 6, 6, false)).unwrap();
    buy(&mut w, "stairs", 9, 3, 0).unwrap();
    w
}

#[test]
fn a_room_upstairs_needs_one_below() {
    let mut w = world(2);
    let err = build(&mut w, room(4, 2 + UP, 6, 6, false)).unwrap_err();
    assert!(err.to_string().contains("under it"), "{err}");
    build(&mut w, room(4, 2, 6, 6, true)).unwrap();
    build(&mut w, room(4, 2 + UP, 6, 6, false)).unwrap();
    assert_ne!(w.lot.room_at(6, 4 + UP), OUTDOORS);
    // Taking the room below down would leave it hanging.
    let down: Vec<EdgeEdit> = room(4, 2, 6, 6, true).into_iter().map(|e| EdgeEdit { kind: EdgeKind::Open, ..e }).collect();
    assert!(build(&mut w, down).is_err());
    // Nothing stands upstairs outside a room.
    assert!(buy(&mut w, "chair", 12, 4 + UP, 0).is_err());
    assert!(buy(&mut w, "chair", 5, 3 + UP, 0).is_ok());
    // One storey only: no stairs.
    let mut flat = world(1);
    build(&mut flat, room(4, 2, 6, 6, true)).unwrap();
    assert!(buy(&mut flat, "stairs", 9, 3, 0).is_err());
}

#[test]
fn residents_climb_the_stairs_to_use_things_upstairs() {
    let mut w = house();
    let chair = buy(&mut w, "chair", 5, 3 + UP, 0).unwrap();
    assert!(buy(&mut w, "chair", 9, 4 + UP, 0).is_err(), "the stairwell is open");
    w.apply(Command::Use { sim: 0, object: chair, interaction: 0 }).unwrap();
    let mut climbing = false;
    for _ in 0..20 * 60 * 5 {
        w.tick_once();
        let h = height(&w, 0);
        climbing |= h > 0.2 && h < 0.8;
        if w.sims[0].pose == sim_core::content::Pose::Sit {
            break;
        }
    }
    assert!(climbing, "went up step by step");
    assert_eq!(w.sims[0].pose, sim_core::content::Pose::Sit, "sat down upstairs");
    assert_eq!(w.storey_of(w.sims[0].tile().1), 1);
    assert_eq!(height(&w, 0), 1.0);
    assert_eq!(w.plot_at(w.sims[0].tile().0, w.sims[0].tile().1), Some(0), "still at home");
}

#[test]
fn saves_keep_the_storeys_and_older_saves_grow_them() {
    let mut w = house();
    buy(&mut w, "chair", 5, 3 + UP, 0).unwrap();
    let loaded = World::from_save_json(&content(2), &w.save_json()).unwrap();
    assert_eq!(loaded.storeys, 2);
    assert_ne!(loaded.lot.room_at(6, 4 + UP), OUTDOORS);
    assert_eq!(loaded.objects.len(), w.objects.len());
    assert_eq!(loaded.stair_map().stairs.len(), 1);
    // A one-storey game loaded where houses may have two.
    let old = world(1);
    let grown = World::from_save_json(&content(2), &old.save_json()).unwrap();
    assert_eq!((grown.storeys, grown.lot.depth), (2, 32));
}

#[test]
fn a_two_storey_house_goes_through_a_blueprint() {
    let two_lots = r#"{"width":40,"depth":16,
        "plots":[{"name":"Home","x":2,"z":1,"w":16,"d":12,"entry":[9.5,12.5]},{"name":"Next door","x":22,"z":1,"w":16,"d":12,"entry":[29.5,12.5]}],
        "households":[{"name":"Player","plot":0,"player":true},{"name":"Other","plot":1}],
        "sims":[{"name":"Ada","household":0,"x":9.5,"z":11.5}]}"#;
    let mut w = World::from_json(&content(2), two_lots, 1).unwrap();
    w.apply(Command::SetAutonomy { enabled: false, household: None }).unwrap();
    build(&mut w, room(4, 2, 6, 6, true)).unwrap();
    build(&mut w, room(4, 2 + UP, 6, 6, false)).unwrap();
    buy(&mut w, "stairs", 9, 3, 0).unwrap();
    buy(&mut w, "chair", 5, 3 + UP, 0).unwrap();
    let bp = w.blueprint(0).unwrap();
    assert!(bp.edges.iter().any(|e| e.storey == 1));
    assert!(bp.objects.iter().any(|o| o.storey == 1));
    w.apply(Command::BuildBlueprint { household: 1, blueprint: bp }).unwrap();
    assert_ne!(w.lot.room_at(26, 4 + UP), OUTDOORS, "the room upstairs next door");
    assert!(w.objects.iter().any(|o| o.def == 1 && o.x >= 22 && w.storey_of(o.z) == 1), "with its chair");
    assert_eq!(w.stair_map().stairs.len(), 2);
}

#[test]
fn a_town_file_can_bring_two_storey_houses() {
    // The same 6×6 room on both storeys (the upper one on rows 16..), stairs inside, a door below.
    let town = r#"{"width":20,"depth":16,"storeys":2,
        "walls":[[4,2,10,2],[4,8,10,8],[4,2,4,8],[10,2,10,8],[4,18,10,18],[4,24,10,24],[4,18,4,24],[10,18,10,24]],
        "doors":[{"x":5,"z":8,"axis":"x"}],
        "plots":[{"name":"Home","x":2,"z":1,"w":16,"d":12,"entry":[9.5,12.5]}],
        "households":[{"name":"Player","plot":0,"player":true}],
        "objects":[{"def":"stairs","x":9,"z":3,"rot":0},{"def":"chair","x":5,"z":19,"rot":0}],
        "sims":[{"name":"Ada","x":9.5,"z":11.5}]}"#;
    let w = World::from_json(&content(2), town, 1).unwrap();
    assert_eq!((w.storeys, w.lot.depth), (2, 32));
    assert_ne!(w.lot.room_at(6, 4 + UP), OUTDOORS);
    assert_eq!(w.stair_map().stairs.len(), 1);
    assert_eq!(w.storey_of(w.objects[1].z), 1, "the chair is upstairs");
}
