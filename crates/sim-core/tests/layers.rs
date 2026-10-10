//! Things on a wall, the ceiling or the floor's surface (content `layer`) take no floor space:
//! a picture over a sofa, a lamp over a table, a rug under a bed. Only things on the same layer
//! can't overlap; a picture needs a wall behind it, a ceiling lamp a room. Bunk beds put their
//! two sleepers in the middle of the bed.

use sim_core::{Command, World};

const CONTENT: &str = r#"{
    "needs":[{"id":"energy","label":"Energy","decayPerHour":0.02}],
    "objects":[
      {"id":"sofa","name":"Sofa","price":100,"footprint":[2,1],"interactions":[]},
      {"id":"picture","name":"Picture","price":50,"layer":"wall","interactions":[]},
      {"id":"mirror","name":"Mirror","price":50,"layer":"wall","interactions":[
        {"id":"look","label":"Look","minutes":5,"effects":{"energy":0.01}}]},
      {"id":"pendant","name":"Pendant","price":50,"layer":"ceiling","light":{"range":4},"interactions":[]},
      {"id":"rug","name":"Rug","price":50,"layer":"rug","footprint":[2,2],"interactions":[]},
      {"id":"bunk","name":"Bunk","price":50,"footprint":[1,2],"slots":2,"bunk":true,"interactions":[
        {"id":"sleep","label":"Sleep","minutes":480,"pose":"lie","effects":{"energy":1}}]}],
    "economy":{"startingFunds":5000}}"#;

/// One room (x 1..9, z 1..7) with a door at the bottom, on a 12×10 plot.
const TOWN: &str = r#"{"width":12,"depth":12,
    "walls":[[1,1,9,1],[1,7,9,7],[1,1,1,7],[9,1,9,7]],
    "doors":[{"x":4,"z":7,"axis":"x"}],
    "plots":[{"name":"Home","x":0,"z":0,"w":12,"d":10,"entry":[6.5,9.5]}],
    "households":[{"name":"Player","plot":0,"player":true}]}"#;

fn buy(w: &mut World, def: &str, x: i32, z: i32, rot: i32) -> Result<u32, sim_core::Error> {
    w.apply(Command::Buy { household: 0, object: def.into(), at: Some([x, z, rot]), style: None, turn: None })?;
    Ok(w.objects.len() as u32 - 1)
}

#[test]
fn things_on_a_wall_or_ceiling_share_tiles_with_furniture() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    // A sofa against the top wall, a picture over it and a rug in front.
    buy(&mut w, "sofa", 2, 1, 0).unwrap();
    buy(&mut w, "picture", 2, 1, 0).expect("a picture hangs over the sofa");
    assert!(buy(&mut w, "picture", 2, 1, 0).is_err(), "but not two pictures in one place");
    buy(&mut w, "picture", 3, 1, 0).expect("the next spot on the wall is free");
    // Away from a wall a picture has nothing to hang on; facing the wrong way neither.
    let err = buy(&mut w, "picture", 5, 4, 0).unwrap_err().to_string();
    assert!(err.contains("wall"), "{err}");
    assert!(buy(&mut w, "picture", 6, 1, 2).is_err(), "its back must be on the wall");
    // A ceiling lamp over the sofa, but not outdoors.
    buy(&mut w, "pendant", 2, 1, 0).expect("a lamp hangs above the sofa");
    let err = buy(&mut w, "pendant", 10, 9, 0).unwrap_err().to_string();
    assert!(err.contains("ceiling"), "{err}");
    // A rug under furniture, and furniture onto a rug.
    buy(&mut w, "rug", 5, 3, 0).unwrap();
    buy(&mut w, "sofa", 5, 3, 0).expect("a sofa stands on the rug");
    assert!(buy(&mut w, "rug", 6, 4, 0).is_err(), "rugs don't overlap");

    // None of it blocks walking: the tiles under the picture, the lamp and the rug are free.
    let free = |w: &World, x: i32, z: i32| !w.blocked()[w.lot.tile_index(x, z)];
    assert!(free(&w, 5, 4) && free(&w, 6, 4), "the rug in front of the sofa is walked on");
    assert!(!free(&w, 2, 1) && !free(&w, 3, 1), "the sofa under the pictures still takes its tiles");

    // A picture in front of which a sofa now stands is fine (nobody needs to reach it), but a
    // mirror someone uses keeps its front free.
    buy(&mut w, "mirror", 7, 1, 0).unwrap();
    assert!(buy(&mut w, "sofa", 7, 2, 0).is_err(), "the mirror's front stays reachable");

    // A wall something hangs on can't be taken down or get a door.
    let edit = |kind| sim_core::command::EdgeEdit {
        axis: sim_core::command::EdgeAxis::H, x: 3, z: 1, kind, cover: None, form: None, style: None,
    };
    let err = w.apply(Command::Build { household: 0, edits: vec![edit(sim_core::command::EdgeKind::Open)] }).unwrap_err().to_string();
    assert!(err.contains("hangs"), "{err}");
    assert!(w.apply(Command::Build { household: 0, edits: vec![edit(sim_core::command::EdgeKind::Door)] }).is_err());

    // Saved and loaded with everything in place.
    let loaded = World::from_save_json(CONTENT, &w.save_json()).unwrap();
    assert_eq!(loaded.objects.len(), w.objects.len());
    assert!(!loaded.content.objects[1].turns, "things on a wall don't turn freely");
}

#[test]
fn bunk_beds_put_both_sleepers_in_the_middle() {
    let mut w = World::from_json(CONTENT, TOWN, 1).unwrap();
    let bed = buy(&mut w, "bunk", 6, 2, 0).unwrap() as usize;
    let a = w.objects[bed].slot_position(&w.content, 0);
    let b = w.objects[bed].slot_position(&w.content, 1);
    let c = w.objects[bed].centre(&w.content);
    assert!((a[0] - c[0]).abs() < 0.05 && (b[0] - c[0]).abs() < 0.05, "{a:?} {b:?} {c:?}");
    assert!(b[0] > a[0], "a hair apart: the second sleeper is on the upper bunk");
}
