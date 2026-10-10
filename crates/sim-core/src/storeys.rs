//! Storeys: houses can grow upwards (content `build.storeys`).
//!
//! The lot holds every storey as rows of the same grid: storey `k` is rows
//! `k * depth .. (k + 1) * depth`, laid out like the ground (the same `x`, and `z` shifted by
//! `k * depth`), so walls, rooms, floors, furniture, pathfinding and saving work on upper storeys
//! as they do on the ground. Above the ground there is only floor inside rooms, and a room may
//! only stand above a room. Stairs (objects marked `stairs`) link a storey to the one above:
//! residents walk up their steps and step off the top onto the landing above (`path::StairMap`);
//! the tiles above the steps are the stairwell, open to below. Views get positions on the ground
//! rows plus a height (`World::sim_height`), and the renderer draws each storey at its height.

use crate::Error;
use crate::content::Content;
use crate::lot::OUTDOORS;
use crate::path::{Stair, StairMap};
use crate::world::{ObjectInstance, Sim, World};

impl World {
    /// Rows per storey (the town's own depth).
    pub fn storey_depth(&self) -> i32 {
        if self.stairs.depth > 0 { self.stairs.depth } else { self.lot.depth as i32 }
    }

    /// The storey a row is on (0: the ground).
    pub fn storey_of(&self, z: i32) -> i32 {
        self.stairs.storey(z)
    }

    /// The same place on the ground storey's rows.
    pub fn ground_z(&self, z: i32) -> i32 {
        self.stairs.ground_z(z)
    }

    /// How the lot's storeys and stairs are walked.
    pub fn stair_map(&self) -> &StairMap {
        &self.stairs
    }

    /// Gives the lot as many storeys as the content allows (new games, and older saves).
    pub(crate) fn make_storeys(&mut self) {
        let want = self.content.build.storeys.max(1);
        if want <= self.storeys {
            return;
        }
        let depth = self.storey_depth() as usize;
        self.lot.grow_depth(depth * want as usize);
        let tiles = self.lot.width * self.lot.depth;
        self.blocked.resize(tiles, false);
        self.dirt.resize(tiles, 0.0);
        self.storeys = want;
        self.stairs.depth = depth as i32;
        self.refresh_stairs();
        self.lot_version += 1;
        self.structure_version += 1;
    }

    /// Rebuilds the stairs list from the stair objects (after objects come or go).
    pub(crate) fn refresh_stairs(&mut self) {
        let stairs: Vec<Stair> = self.objects.iter().filter_map(|o| stair_of(&self.content, o, self.stairs.depth)).collect();
        self.stairs.stairs = stairs;
    }

    /// The tiles an object takes from walking: its footprint, or for stairs the stairwell above
    /// its steps (the steps themselves are walked on).
    pub(crate) fn blocking_tiles(&self, obj: &ObjectInstance) -> Vec<(i32, i32)> {
        // Pictures, ceiling lamps and rugs take no floor space.
        if self.content.objects[obj.def].layer.mounted() {
            return Vec::new();
        }
        if self.content.objects[obj.def].stairs {
            if self.stairs.depth == 0 {
                return Vec::new();
            }
            let d = self.stairs.depth;
            return obj.tiles(&self.content).map(|(x, z)| (x, z + d)).filter(|&(x, z)| self.lot.in_bounds(x, z)).collect();
        }
        obj.tiles(&self.content).collect()
    }

    /// Storey rules for an object about to be placed: nothing on stairs; above the ground only on
    /// floor (inside a room); stairs need a storey above with their stairwell free.
    pub(crate) fn check_storey_fit(&self, obj: &ObjectInstance) -> Result<(), Error> {
        let def = &self.content.objects[obj.def];
        let tiles: Vec<(i32, i32)> = obj.tiles(&self.content).collect();
        if tiles.iter().any(|&(x, z)| self.stairs.step(x, z).is_some()) {
            return Err(Error::new("nothing can stand on the stairs"));
        }
        let storey = self.storey_of(obj.z);
        if storey > 0 && tiles.iter().any(|&(x, z)| self.lot.room_at(x, z) == OUTDOORS) {
            return Err(Error::new("upstairs, things go inside rooms"));
        }
        if def.stairs {
            if self.stairs.depth == 0 || storey + 1 >= self.storeys as i32 {
                return Err(Error::new("there's no storey above for stairs to lead to"));
            }
            let d = self.stairs.depth;
            if tiles.iter().any(|&(x, z)| self.blocked[self.lot.tile_index(x, z + d)]) {
                return Err(Error::new("something stands where the stairs come up"));
            }
        }
        Ok(())
    }

    /// How high a resident stands, in storeys (fractions on the stairs, for drawing).
    pub fn sim_height(&self, sim: &Sim) -> f32 {
        let storey = self.storey_of(sim.pos[1].floor() as i32) as f32;
        let (x, z) = sim.tile();
        match self.stairs.step(x, z) {
            None => storey,
            Some((s, _)) => {
                // Along the flight, from the foot of the bottom step to the top of the last.
                let along = (sim.pos[0] - (s.bottom.0 as f32 + 0.5 - s.dir.0 as f32 * 0.5)) * s.dir.0 as f32
                    + (sim.pos[1] - (s.bottom.1 as f32 + 0.5 - s.dir.1 as f32 * 0.5)) * s.dir.1 as f32;
                storey + (along / s.len as f32).clamp(0.0, 1.0)
            }
        }
    }
}

/// The flight an object is, if it's stairs (with storeys): climbed from its front tile, along
/// its centre column, up to the tile past its far end on the storey above.
pub(crate) fn stair_of(content: &Content, o: &ObjectInstance, depth: i32) -> Option<Stair> {
    if !content.objects[o.def].stairs || depth == 0 {
        return None;
    }
    let (w, d) = o.size(content);
    let foot = o.front_tile(content);
    // Climbing away from the front.
    let (dir, len, bottom) = match o.rot % 4 {
        0 => ((0, -1), d, (o.x + (w - 1) / 2, o.z + d - 1)),
        1 => ((-1, 0), w, (o.x + w - 1, o.z + (d - 1) / 2)),
        2 => ((0, 1), d, (o.x + (w - 1) / 2, o.z)),
        _ => ((1, 0), w, (o.x, o.z + (d - 1) / 2)),
    };
    let top = (bottom.0 + dir.0 * (len - 1), bottom.1 + dir.1 * (len - 1));
    let landing = (top.0 + dir.0, top.1 + dir.1 + depth);
    Some(Stair { foot, bottom, dir, len, landing })
}
