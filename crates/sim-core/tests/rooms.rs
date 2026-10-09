//! Rooms and their scores: kind from what stands in them, size, light, decor, cleanliness and
//! function, and each plot's garden (see `docs/design/house-matters.md`).

use sim_core::command::{EdgeAxis, EdgeEdit, EdgeKind, FloorPaint};
use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"hunger","label":"Hunger","decayPerHour":0.02}],
    "objects":[
      {"id":"toilet","name":"Toilet","price":100,"interactions":[{"id":"use","label":"Use","minutes":5,"tags":["bathroom"]}]},
      {"id":"sink","name":"Sink","price":100,"interactions":[{"id":"wash","label":"Wash","minutes":5,"tags":["hygiene"]}]},
      {"id":"sofa","name":"Sofa","price":100,"footprint":[2,1],"interactions":[{"id":"sit","label":"Sit","minutes":30,"tags":["lounge"]}]},
      {"id":"bed","name":"Bed","price":100,"footprint":[2,2],"interactions":[{"id":"sleep","label":"Sleep","minutes":480,"tags":["sleep"]}]},
      {"id":"lamp","name":"Lamp","price":30,"category":"decor","light":{"range":4}},
      {"id":"plant","name":"Plant","price":20,"category":"garden"}],
    "roomKinds":[
      {"id":"bathroom","tags":["bathroom"],"essentials":[["bathroom"],["hygiene"]],"size":[3,6],"exclusive":true},
      {"id":"bedroom","tags":["sleep"],"essentials":[["sleep"]],"size":[6,12],"exclusive":true},
      {"id":"living","tags":["lounge"],"size":[9,20]}],
    "roomRules":{"decorByCategory":{"decor":1,"garden":0.8}},
    "floorCoverings":[{"id":"oak","price":0}],
    "economy":{"startingFunds":10000}}"#;

/// A 16×12 plot: a 2×2 bathroom, a 5×4 living room with three windows and a lamp, and a 3×3
/// bedroom with a toilet in it.
const TOWN: &str = r#"{"width":16,"depth":12,
    "plots":[{"name":"Home","x":0,"z":0,"w":16,"d":12,"entry":[8.5,11.5]}],
    "households":[{"name":"Player","plot":0,"player":true}],
    "walls":[[1,1,3,1],[1,3,3,3],[1,1,1,3],[3,1,3,3],
             [5,1,10,1],[5,5,10,5],[5,1,5,5],[10,1,10,5],
             [11,1,14,1],[11,4,14,4],[11,1,11,4],[14,1,14,4]],
    "doors":[{"x":1,"z":3,"axis":"x"},{"x":6,"z":5,"axis":"x"},{"x":12,"z":4,"axis":"x"}],
    "windows":[{"x":1,"z":1,"axis":"z"},{"x":6,"z":1,"axis":"x"},{"x":8,"z":1,"axis":"x"},{"x":10,"z":2,"axis":"z"}],
    "objects":[{"def":"toilet","x":1,"z":1},{"def":"sink","x":2,"z":1},
               {"def":"sofa","x":6,"z":3},{"def":"lamp","x":5,"z":1},
               {"def":"bed","x":11,"z":1},{"def":"toilet","x":13,"z":2},
               {"def":"plant","x":2,"z":8},{"def":"plant","x":4,"z":8}]}"#;

fn room<'a>(w: &'a World, x: i32, z: i32) -> &'a sim_core::rooms::RoomInfo {
    w.room_at_tile(x, z).unwrap()
}

fn kind(w: &World, r: &sim_core::rooms::RoomInfo) -> String {
    r.kind.map_or("none".into(), |k| w.content.room_kinds[k].id.clone())
}

#[test]
fn rooms_get_a_kind_and_scores() {
    let w = World::from_json(CONTENT, TOWN, 1).unwrap();
    assert_eq!(w.rooms().iter().filter(|r| !r.garden).count(), 3);

    let bath = room(&w, 1, 1);
    assert_eq!(kind(&w, bath), "bathroom");
    assert_eq!((bath.tiles, bath.windows, bath.doors), (4.0, 1, 1));
    assert!((bath.scores.size - (0.5 + 0.5 / 3.0)).abs() < 1e-4, "4 tiles between cramped 3 and comfortable 6");
    assert!((bath.scores.light - 0.5).abs() < 1e-4, "full daylight from one window, no lamp at night");
    assert_eq!((bath.scores.function, bath.scores.clean), (1.0, 1.0));

    let living = room(&w, 7, 2);
    assert_eq!(kind(&w, living), "living");
    assert_eq!((living.tiles, living.windows, living.lamps), (20.0, 3, 1));
    assert!((living.scores.light - (0.9 + 0.5) / 2.0).abs() < 1e-4);
    assert!((living.scores.decor - (1.0 / (20.0 * 0.125)) * 0.8).abs() < 1e-4, "the lamp is decor too");

    let mixed = room(&w, 12, 2);
    assert_eq!(kind(&w, mixed), "bathroom", "the first kind that fits");
    assert!(mixed.mixed);
    assert_eq!(mixed.scores.function, 0.6);
    assert!(mixed.scores.overall < bath.scores.overall + 0.2);

    let garden = room(&w, 3, 9);
    assert!(garden.garden);
    assert!(garden.decor > 1.5, "two plants");
    assert!(garden.scores.decor > 0.0 && garden.scores.decor < 1.0);
}

#[test]
fn scores_follow_the_house_as_it_changes() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    let before = room(&w, 1, 1).scores;
    // A floor covering is decor.
    let tiles = (1..3).flat_map(|x| (1..3).map(move |z| FloorPaint { x, z, covering: 1 })).collect();
    w.apply(Command::PaintFloor { household: 0, tiles }).unwrap();
    assert!(room(&w, 1, 1).scores.decor > before.decor);

    // Without the sink, the bathroom misses somewhere to wash.
    w.apply(Command::Sell { household: 0, object: 1 }).unwrap();
    let bath = room(&w, 1, 1);
    assert_eq!(bath.missing, Some(1));
    assert_eq!(bath.scores.function, 0.7);

    // Splitting the living room: two smaller rooms, one with the window on the right.
    let edits = (1..5).map(|z| EdgeEdit::new(EdgeAxis::V, 9, z, EdgeKind::Wall)).collect();
    w.apply(Command::Build { household: 0, edits }).unwrap();
    assert_eq!(room(&w, 9, 3).tiles, 4.0);
    assert_eq!(room(&w, 9, 3).windows, 1);
    assert_eq!(room(&w, 7, 2).tiles, 16.0);
    // Undo puts it back.
    w.apply(Command::Undo { household: 0 }).unwrap();
    assert_eq!(room(&w, 7, 2).tiles, 20.0);

    // Dirt makes a room less clean.
    let i = w.lot.tile_index(1, 1);
    w.dirt[i] = 1.0;
    w.refresh_rooms();
    assert!((room(&w, 1, 1).scores.clean - 0.75).abs() < 1e-4);
}
