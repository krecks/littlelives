//! The lot: a tile grid with walls and doors on tile edges.
//!
//! Coordinates: tile `(x, z)` covers `[x, x+1] × [z, z+1]` in metres (1 tile = 1 m).
//! Horizontal edges lie on the line `z = const` and run along x; vertical edges
//! lie on `x = const` and run along z.

use std::collections::VecDeque;

use serde::Deserialize;

use crate::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Open,
    Wall,
    Door,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    /// Edge runs along x (horizontal, on a `z` grid line).
    X,
    /// Edge runs along z (vertical, on an `x` grid line).
    Z,
}

/// Lot description as stored in lot JSON files.
#[derive(Debug, Deserialize)]
pub struct LotFile {
    pub width: u16,
    pub depth: u16,
    /// Wall segments `[x0, z0, x1, z1]` along grid lines.
    #[serde(default)]
    pub walls: Vec<[u16; 4]>,
    #[serde(default)]
    pub doors: Vec<DoorRaw>,
    #[serde(default)]
    pub objects: Vec<PlacementRaw>,
    #[serde(default)]
    pub sims: Vec<SimSpawn>,
    /// Regions of a town (residential lots, parks). Optional for single lots.
    #[serde(default)]
    pub plots: Vec<PlotRaw>,
    #[serde(default)]
    pub households: Vec<HouseholdRaw>,
    /// Starting relationships between Sims (indices into `sims`).
    #[serde(default)]
    pub relationships: Vec<BondRaw>,
    /// Where Sims leave town (for work) and come back. Optional.
    #[serde(default)]
    pub exits: Vec<[f32; 2]>,
    /// Opaque data for the presentation layer (streets, scenery seed...). Saved unchanged.
    #[serde(default)]
    pub meta: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct PlotRaw {
    pub name: String,
    pub x: i32,
    pub z: i32,
    pub w: i32,
    pub d: i32,
    #[serde(default)]
    pub public: bool,
    /// Where visitors arrive (in front of the door).
    #[serde(default)]
    pub entry: Option<[f32; 2]>,
}

#[derive(Debug, Deserialize)]
pub struct HouseholdRaw {
    pub name: String,
    #[serde(default)]
    pub plot: Option<u32>,
    #[serde(default)]
    pub player: bool,
    /// Defaults to the content's starting funds.
    #[serde(default)]
    pub funds: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JobRaw {
    pub career: String,
    #[serde(default)]
    pub level: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BondRaw {
    pub a: usize,
    pub b: usize,
    /// Key into the content's `bondPresets`.
    pub preset: String,
}

#[derive(Debug, Deserialize)]
pub struct DoorRaw {
    pub x: u16,
    pub z: u16,
    pub axis: Axis,
}

#[derive(Debug, Deserialize)]
pub struct PlacementRaw {
    pub def: String,
    pub x: i32,
    pub z: i32,
    /// Facing: 0 = +z, 1 = +x, 2 = -z, 3 = -x.
    #[serde(default)]
    pub rot: u8,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimSpawn {
    pub name: String,
    /// Gender id; defaults to the first gender in the content.
    #[serde(default)]
    pub gender: Option<String>,
    /// Gender ids this Sim is attracted to; `None` means all.
    #[serde(default)]
    pub attracted_to: Option<Vec<String>>,
    #[serde(default)]
    pub household: u32,
    #[serde(default)]
    pub job: Option<JobRaw>,
    /// Opaque appearance data passed through to the renderer/UI unchanged.
    #[serde(default)]
    pub appearance: serde_json::Value,
    #[serde(default)]
    pub traits: Vec<String>,
    #[serde(default)]
    pub perks: Vec<String>,
    pub x: f32,
    pub z: f32,
}

pub const OUTDOORS: u16 = 0;

#[derive(Debug, Clone)]
pub struct Lot {
    pub width: usize,
    pub depth: usize,
    /// `(width) × (depth + 1)` horizontal edges.
    h_edges: Vec<Edge>,
    /// `(width + 1) × (depth)` vertical edges.
    v_edges: Vec<Edge>,
    /// Room id per tile; `OUTDOORS` for outside.
    rooms: Vec<u16>,
}

impl Lot {
    pub fn new(width: usize, depth: usize) -> Self {
        Self {
            width,
            depth,
            h_edges: vec![Edge::Open; width * (depth + 1)],
            v_edges: vec![Edge::Open; (width + 1) * depth],
            rooms: vec![OUTDOORS; width * depth],
        }
    }

    pub fn from_file(file: &LotFile) -> Result<Self, Error> {
        let (w, d) = (file.width as usize, file.depth as usize);
        if w == 0 || d == 0 || w > 256 || d > 256 {
            return Err(Error::new("lot size must be within 1..=256"));
        }
        let mut lot = Self::new(w, d);
        for &[x0, z0, x1, z1] in &file.walls {
            let (x0, z0, x1, z1) = (x0 as usize, z0 as usize, x1 as usize, z1 as usize);
            if z0 == z1 && z0 <= d && x0.max(x1) <= w {
                for x in x0.min(x1)..x0.max(x1) {
                    lot.set_h(x, z0, Edge::Wall);
                }
            } else if x0 == x1 && x0 <= w && z0.max(z1) <= d {
                for z in z0.min(z1)..z0.max(z1) {
                    lot.set_v(x0, z, Edge::Wall);
                }
            } else {
                return Err(Error::new(format!(
                    "wall {x0},{z0}-{x1},{z1} is diagonal or out of bounds"
                )));
            }
        }
        for door in &file.doors {
            let (x, z) = (door.x as usize, door.z as usize);
            let current = match door.axis {
                Axis::X if x < w && z <= d => lot.h_edge(x, z),
                Axis::Z if x <= w && z < d => lot.v_edge(x, z),
                _ => return Err(Error::new(format!("door at {x},{z} is out of bounds"))),
            };
            if current != Edge::Wall {
                return Err(Error::new(format!("door at {x},{z} is not on a wall")));
            }
            match door.axis {
                Axis::X => lot.set_h(x, z, Edge::Door),
                Axis::Z => lot.set_v(x, z, Edge::Door),
            }
        }
        lot.compute_rooms();
        Ok(lot)
    }

    /// Rebuilds a lot from saved edge arrays (see `edges`).
    pub fn from_edges(
        width: usize,
        depth: usize,
        h: Vec<Edge>,
        v: Vec<Edge>,
    ) -> Result<Self, Error> {
        if width == 0 || depth == 0 || width > 256 || depth > 256 {
            return Err(Error::new("lot size must be within 1..=256"));
        }
        if h.len() != width * (depth + 1) || v.len() != (width + 1) * depth {
            return Err(Error::new("saved lot edges have the wrong size"));
        }
        let mut lot = Self {
            width,
            depth,
            h_edges: h,
            v_edges: v,
            rooms: vec![OUTDOORS; width * depth],
        };
        lot.compute_rooms();
        Ok(lot)
    }

    /// Horizontal and vertical edge arrays, for saving.
    pub fn edges(&self) -> (&[Edge], &[Edge]) {
        (&self.h_edges, &self.v_edges)
    }

    pub fn h_edge(&self, x: usize, z: usize) -> Edge {
        self.h_edges[z * self.width + x]
    }

    pub fn v_edge(&self, x: usize, z: usize) -> Edge {
        self.v_edges[z * (self.width + 1) + x]
    }

    pub fn set_h(&mut self, x: usize, z: usize, e: Edge) {
        self.h_edges[z * self.width + x] = e;
    }

    pub fn set_v(&mut self, x: usize, z: usize, e: Edge) {
        self.v_edges[z * (self.width + 1) + x] = e;
    }

    pub fn in_bounds(&self, x: i32, z: i32) -> bool {
        x >= 0 && z >= 0 && (x as usize) < self.width && (z as usize) < self.depth
    }

    pub fn tile_index(&self, x: i32, z: i32) -> usize {
        z as usize * self.width + x as usize
    }

    /// Edge between two orthogonally adjacent in-bounds tiles.
    fn edge_between(&self, ax: i32, az: i32, bx: i32, bz: i32) -> Edge {
        match (bx - ax, bz - az) {
            (1, 0) => self.v_edge(bx as usize, az as usize),
            (-1, 0) => self.v_edge(ax as usize, az as usize),
            (0, 1) => self.h_edge(ax as usize, bz as usize),
            (0, -1) => self.h_edge(ax as usize, az as usize),
            _ => unreachable!("tiles are not orthogonally adjacent"),
        }
    }

    /// Whether a Sim can walk across the edge between two orthogonally adjacent tiles.
    pub fn edge_walkable(&self, ax: i32, az: i32, bx: i32, bz: i32) -> bool {
        self.in_bounds(bx, bz) && self.edge_between(ax, az, bx, bz) != Edge::Wall
    }

    pub fn room_at(&self, x: i32, z: i32) -> u16 {
        if self.in_bounds(x, z) {
            self.rooms[self.tile_index(x, z)]
        } else {
            OUTDOORS
        }
    }

    pub fn rooms(&self) -> &[u16] {
        &self.rooms
    }

    /// Flood-fills rooms. Doors separate rooms; any area touching the lot border is outdoors.
    pub fn compute_rooms(&mut self) {
        const UNSET: u16 = u16::MAX;
        self.rooms.fill(UNSET);
        let mut next_room = 1;
        let mut queue = VecDeque::new();
        for start in 0..self.rooms.len() {
            if self.rooms[start] != UNSET {
                continue;
            }
            let mut tiles = Vec::new();
            let mut touches_border = false;
            self.rooms[start] = next_room;
            queue.push_back(start);
            while let Some(i) = queue.pop_front() {
                tiles.push(i);
                let (x, z) = ((i % self.width) as i32, (i / self.width) as i32);
                if x == 0 || z == 0 || x as usize == self.width - 1 || z as usize == self.depth - 1
                {
                    touches_border = true;
                }
                for (nx, nz) in [(x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)] {
                    if !self.in_bounds(nx, nz) || self.edge_between(x, z, nx, nz) != Edge::Open {
                        continue;
                    }
                    let n = self.tile_index(nx, nz);
                    if self.rooms[n] == UNSET {
                        self.rooms[n] = next_room;
                        queue.push_back(n);
                    }
                }
            }
            if touches_border {
                for i in tiles {
                    self.rooms[i] = OUTDOORS;
                }
            } else {
                next_room += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxed_lot() -> Lot {
        let file: LotFile = serde_json::from_str(
            r#"{"width":10,"depth":10,
                "walls":[[2,2,8,2],[2,8,8,8],[2,2,2,8],[8,2,8,8],[5,2,5,8]],
                "doors":[{"x":3,"z":2,"axis":"x"},{"x":5,"z":4,"axis":"z"}]}"#,
        )
        .unwrap();
        Lot::from_file(&file).unwrap()
    }

    #[test]
    fn detects_two_rooms() {
        let lot = boxed_lot();
        assert_eq!(lot.room_at(0, 0), OUTDOORS);
        let a = lot.room_at(3, 3);
        let b = lot.room_at(6, 3);
        assert_ne!(a, OUTDOORS);
        assert_ne!(b, OUTDOORS);
        assert_ne!(a, b);
    }

    #[test]
    fn walls_block_and_doors_pass() {
        let lot = boxed_lot();
        assert!(!lot.edge_walkable(4, 1, 4, 2));
        assert!(lot.edge_walkable(3, 1, 3, 2));
        assert!(lot.edge_walkable(4, 4, 5, 4));
    }
}
