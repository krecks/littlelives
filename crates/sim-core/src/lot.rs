//! The lot: a tile grid with walls, doors and windows on tile edges.
//!
//! Coordinates: tile `(x, z)` covers `[x, x+1] × [z, z+1]` in metres (1 tile = 1 m).
//! Horizontal edges lie on the line `z = const` and run along x; vertical edges
//! lie on `x = const` and run along z.
//!
//! **Diagonal walls** run corner to corner across one tile (at most one per tile): `/`
//! ([`DiagDir::Dp`]) from `(x, z)` to `(x + 1, z + 1)`, `\` ([`DiagDir::Dn`]) from
//! `(x, z + 1)` to `(x + 1, z)`. They split the tile into two triangular halves: half 0
//! touches the tile's `-z` side, half 1 its `+z` side (see [`Lot::half_at_side`]). Rooms are
//! found per half, so the two halves can belong to different rooms (inside and outside).
//!
//! Movement stays on whole tiles: nobody stands on a tile crossed by a diagonal wall or
//! window (it blocks the whole tile; see `NavGrid`), while a diagonal *door* tile is walked
//! across like a doorway. Objects never stand on a tile with a diagonal.

use std::collections::{BTreeMap, VecDeque};

use serde::Deserialize;

use crate::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Open,
    Wall,
    /// A wall with a doorway: Sims walk through, but it still separates rooms.
    Door,
    /// A wall with a window: blocks walking and separates rooms like a wall.
    Window,
    /// A garden fence: blocks walking but makes no rooms (a fenced garden stays outdoors).
    Fence,
    /// A gate in a fence: walked through; makes no rooms.
    Gate,
}

impl Edge {
    /// Whether Sims can't cross this edge.
    pub fn blocks(self) -> bool {
        matches!(self, Edge::Wall | Edge::Window | Edge::Fence)
    }

    /// Whether a wall stands on this edge (plain, or with a door or window in it). Walls make
    /// rooms; fences and gates don't.
    pub fn is_wall(self) -> bool {
        matches!(self, Edge::Wall | Edge::Door | Edge::Window)
    }

    /// Whether a fence or a gate stands on this edge.
    pub fn is_fence(self) -> bool {
        matches!(self, Edge::Fence | Edge::Gate)
    }
}

/// Which way a diagonal wall runs across its tile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagDir {
    /// `/`: from corner `(x, z)` to `(x + 1, z + 1)`.
    Dp,
    /// `\`: from corner `(x, z + 1)` to `(x + 1, z)`.
    Dn,
}

/// A diagonal wall across a tile: its direction and what stands there (never `Open`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Diagonal {
    pub dir: DiagDir,
    pub edge: Edge,
}

impl Diagonal {
    /// Whether this diagonal ends at grid corner `(cx, cz)` of tile `(x, z)`.
    pub fn touches(self, x: i32, z: i32, cx: i32, cz: i32) -> bool {
        match self.dir {
            DiagDir::Dp => (cx, cz) == (x, z) || (cx, cz) == (x + 1, z + 1),
            DiagDir::Dn => (cx, cz) == (x, z + 1) || (cx, cz) == (x + 1, z),
        }
    }
}

/// A wall's place on the lot: an `h` or `v` grid edge (as in [`Lot::h_edge`] / [`Lot::v_edge`]),
/// or the diagonal across tile `(x, z)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum EdgeRef {
    H(u16, u16),
    V(u16, u16),
    Diag(u16, u16),
}

/// Half-height wall (see [`EdgeLook::form`]).
pub const FORM_HALF: u8 = 1;

/// How a wall looks. Presentation only: walking, rooms and light never depend on it (a half
/// wall blocks and separates like a full one), but it is saved and costs money to change.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EdgeLook {
    /// Covering of each face: 0 the automatic look, else an index into the wall coverings + 1.
    /// Face 0 looks towards `-z` (`h` edges), `-x` (`v` edges) or the tile's half 0
    /// (diagonals); face 1 the other way.
    pub sides: [u8; 2],
    /// 0 = full height, [`FORM_HALF`] = half wall (no doors or windows in it).
    pub form: u8,
    /// Door or window style: an index into the content's door / window styles.
    pub style: u8,
}

/// A side of a tile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    NegX,
    PosX,
    NegZ,
    PosZ,
}

impl Side {
    pub const ALL: [Side; 4] = [Side::PosX, Side::NegX, Side::PosZ, Side::NegZ];

    pub fn offset(self) -> (i32, i32) {
        match self {
            Side::NegX => (-1, 0),
            Side::PosX => (1, 0),
            Side::NegZ => (0, -1),
            Side::PosZ => (0, 1),
        }
    }

    pub fn opposite(self) -> Side {
        match self {
            Side::NegX => Side::PosX,
            Side::PosX => Side::NegX,
            Side::NegZ => Side::PosZ,
            Side::PosZ => Side::NegZ,
        }
    }
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
    /// Living (default) or Creative.
    #[serde(default)]
    pub mode: crate::world::GameMode,
    /// How fast residents age (default: normal).
    #[serde(default)]
    pub lifespan: crate::lifecycle::Lifespan,
    pub width: u16,
    pub depth: u16,
    /// Wall segments `[x0, z0, x1, z1]` along grid lines.
    #[serde(default)]
    pub walls: Vec<[u16; 4]>,
    #[serde(default)]
    pub doors: Vec<DoorRaw>,
    /// Windows, like doors: each must sit on a wall.
    #[serde(default)]
    pub windows: Vec<DoorRaw>,
    /// Diagonal walls (optional), one per tile.
    #[serde(default)]
    pub diagonals: Vec<DiagRaw>,
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

/// A door or window on the wall edge at `(x, z)` (see `Axis`).
#[derive(Debug, Deserialize)]
pub struct DoorRaw {
    pub x: u16,
    pub z: u16,
    pub axis: Axis,
}

/// A diagonal wall across tile `(x, z)`, optionally with a door or window in it.
#[derive(Debug, Deserialize)]
pub struct DiagRaw {
    pub x: u16,
    pub z: u16,
    pub dir: DiagDir,
    /// `wall` (default), `door` or `window`.
    #[serde(default)]
    pub kind: Option<String>,
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
    /// Age in years (default: content `life.startAge`, by name).
    #[serde(default)]
    pub age: Option<f32>,
    /// Starting skill levels by id (on top of what traits give).
    #[serde(default)]
    pub skills: std::collections::HashMap<String, f32>,
    pub x: f32,
    pub z: f32,
}

pub const OUTDOORS: u16 = 0;

#[derive(Debug, Clone, PartialEq)]
pub struct Lot {
    pub width: usize,
    pub depth: usize,
    /// `(width) × (depth + 1)` horizontal edges.
    h_edges: Vec<Edge>,
    /// `(width + 1) × (depth)` vertical edges.
    v_edges: Vec<Edge>,
    /// Diagonal wall per tile, if any.
    diags: Vec<Option<Diagonal>>,
    /// Room id per tile; `OUTDOORS` for outside. A tile split by a diagonal reports the
    /// room of an indoor half if it has one (see `halves` for both).
    rooms: Vec<u16>,
    /// Room id of each half of each tile (equal for tiles without a diagonal).
    halves: Vec<[u16; 2]>,
    /// Looks of the walls that aren't plain (absent: the default look).
    looks: BTreeMap<EdgeRef, EdgeLook>,
    /// Floor covering per tile `(x, z)` (a floor covering + 1; absent: the automatic look). Kept
    /// when the room around it is torn down, so rebuilding it brings the floor back.
    floors: BTreeMap<(u16, u16), u8>,
}

impl Lot {
    pub fn new(width: usize, depth: usize) -> Self {
        Self {
            width,
            depth,
            h_edges: vec![Edge::Open; width * (depth + 1)],
            v_edges: vec![Edge::Open; (width + 1) * depth],
            diags: vec![None; width * depth],
            rooms: vec![OUTDOORS; width * depth],
            halves: vec![[OUTDOORS; 2]; width * depth],
            looks: BTreeMap::new(),
            floors: BTreeMap::new(),
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
        let openings = file.doors.iter().map(|d| (d, Edge::Door, "door"));
        let openings = openings.chain(file.windows.iter().map(|w| (w, Edge::Window, "window")));
        for (door, kind, name) in openings {
            let (x, z) = (door.x as usize, door.z as usize);
            let current = match door.axis {
                Axis::X if x < w && z <= d => lot.h_edge(x, z),
                Axis::Z if x <= w && z < d => lot.v_edge(x, z),
                _ => return Err(Error::new(format!("{name} at {x},{z} is out of bounds"))),
            };
            if current != Edge::Wall {
                return Err(Error::new(format!("{name} at {x},{z} is not on a wall")));
            }
            match door.axis {
                Axis::X => lot.set_h(x, z, kind),
                Axis::Z => lot.set_v(x, z, kind),
            }
        }
        for d in &file.diagonals {
            let (x, z) = (d.x as usize, d.z as usize);
            if x >= w || z >= lot.depth {
                return Err(Error::new(format!("diagonal at {x},{z} is out of bounds")));
            }
            let edge = match d.kind.as_deref().unwrap_or("wall") {
                "wall" => Edge::Wall,
                "door" => Edge::Door,
                "window" => Edge::Window,
                other => return Err(Error::new(format!("unknown diagonal kind '{other}'"))),
            };
            lot.set_diag(x, z, Some(Diagonal { dir: d.dir, edge }));
        }
        lot.compute_rooms();
        Ok(lot)
    }

    /// Rebuilds a lot from saved edge arrays (see `edges`) and diagonals (see `diagonals`;
    /// empty for saves made before diagonal walls existed).
    pub fn from_edges(
        width: usize,
        depth: usize,
        h: Vec<Edge>,
        v: Vec<Edge>,
        diags: Vec<Option<Diagonal>>,
    ) -> Result<Self, Error> {
        if width == 0 || depth == 0 || width > 256 || depth > 256 {
            return Err(Error::new("lot size must be within 1..=256"));
        }
        if h.len() != width * (depth + 1) || v.len() != (width + 1) * depth {
            return Err(Error::new("saved lot edges have the wrong size"));
        }
        let diags = match diags.len() {
            0 => vec![None; width * depth],
            n if n == width * depth => diags,
            _ => return Err(Error::new("saved diagonal walls have the wrong size")),
        };
        if diags.iter().flatten().any(|d| d.edge == Edge::Open) {
            return Err(Error::new("corrupt diagonal walls in save"));
        }
        let mut lot = Self {
            width,
            depth,
            h_edges: h,
            v_edges: v,
            diags,
            rooms: vec![OUTDOORS; width * depth],
            halves: vec![[OUTDOORS; 2]; width * depth],
            looks: BTreeMap::new(),
            floors: BTreeMap::new(),
        };
        lot.compute_rooms();
        Ok(lot)
    }

    /// Horizontal and vertical edge arrays, for saving.
    pub fn edges(&self) -> (&[Edge], &[Edge]) {
        (&self.h_edges, &self.v_edges)
    }

    /// Diagonal wall per tile (row-major), for saving.
    pub fn diagonals(&self) -> &[Option<Diagonal>] {
        &self.diags
    }

    /// The diagonal wall across tile `(x, z)`, if any (none off the lot).
    pub fn diag(&self, x: i32, z: i32) -> Option<Diagonal> {
        if self.in_bounds(x, z) {
            self.diags[self.tile_index(x, z)]
        } else {
            None
        }
    }

    /// Sets or clears (`None`) the diagonal across a tile. Call `compute_rooms` afterwards.
    pub fn set_diag(&mut self, x: usize, z: usize, d: Option<Diagonal>) {
        self.diags[z * self.width + x] = d.filter(|d| d.edge != Edge::Open);
    }

    /// Whether a diagonal wall or window stands across the tile: nobody can stand on it.
    pub fn diag_blocks(&self, x: i32, z: i32) -> bool {
        self.diag(x, z).is_some_and(|d| d.edge.blocks())
    }

    /// Whether tile `(x, z)` has a diagonal ending at grid corner `(cx, cz)`.
    pub fn diag_touches(&self, x: i32, z: i32, cx: i32, cz: i32) -> bool {
        self.diag(x, z).is_some_and(|d| d.touches(x, z, cx, cz))
    }

    /// Which half (0 or 1) of tile `(x, z)` touches `side`; always 0 without a diagonal.
    pub fn half_at_side(&self, x: i32, z: i32, side: Side) -> usize {
        let Some(d) = self.diag(x, z) else {
            return 0;
        };
        match (side, d.dir) {
            (Side::NegZ, _) | (Side::PosX, DiagDir::Dp) | (Side::NegX, DiagDir::Dn) => 0,
            _ => 1,
        }
    }

    /// Room of half `half` (0 or 1) of a tile; `OUTDOORS` off the lot.
    pub fn half_room(&self, x: i32, z: i32, half: usize) -> u16 {
        if self.in_bounds(x, z) {
            self.halves[self.tile_index(x, z)][half & 1]
        } else {
            OUTDOORS
        }
    }

    /// Rooms of both halves of every tile (row-major; equal for tiles without a diagonal).
    pub fn half_rooms(&self) -> &[[u16; 2]] {
        &self.halves
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

    /// How the wall at `e` looks (the default look where there's no wall).
    pub fn look(&self, e: EdgeRef) -> EdgeLook {
        self.looks.get(&e).copied().unwrap_or_default()
    }

    /// Sets the look of the wall at `e` (the default look is not stored).
    pub fn set_look(&mut self, e: EdgeRef, look: EdgeLook) {
        if look == EdgeLook::default() {
            self.looks.remove(&e);
        } else {
            self.looks.insert(e, look);
        }
    }

    /// Every wall that doesn't have the default look, in a stable order (for saving and views).
    pub fn looks(&self) -> impl Iterator<Item = (EdgeRef, EdgeLook)> + '_ {
        self.looks.iter().map(|(e, l)| (*e, *l))
    }

    /// Floor covering of tile `(x, z)` (0: the automatic look).
    pub fn floor(&self, x: u16, z: u16) -> u8 {
        self.floors.get(&(x, z)).copied().unwrap_or(0)
    }

    /// Sets the floor covering of tile `(x, z)` (0, the automatic look, is not stored).
    pub fn set_floor(&mut self, x: u16, z: u16, covering: u8) {
        if covering == 0 {
            self.floors.remove(&(x, z));
        } else {
            self.floors.insert((x, z), covering);
        }
    }

    /// Every tile with a floor covering, as `(x, z, covering)` in a stable order.
    pub fn floors(&self) -> impl Iterator<Item = (u16, u16, u8)> + '_ {
        self.floors.iter().map(|(&(x, z), &c)| (x, z, c))
    }

    pub fn in_bounds(&self, x: i32, z: i32) -> bool {
        x >= 0 && z >= 0 && (x as usize) < self.width && (z as usize) < self.depth
    }

    pub fn tile_index(&self, x: i32, z: i32) -> usize {
        z as usize * self.width + x as usize
    }

    /// Edge between two orthogonally adjacent in-bounds tiles.
    pub(crate) fn edge_between(&self, ax: i32, az: i32, bx: i32, bz: i32) -> Edge {
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
        self.in_bounds(bx, bz) && !self.edge_between(ax, az, bx, bz).blocks()
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

    /// Flood-fills rooms over tile halves. Walls, doors and windows (straight or diagonal)
    /// separate rooms; any area touching the lot border is outdoors.
    pub fn compute_rooms(&mut self) {
        const UNSET: u16 = u16::MAX;
        for h in &mut self.halves {
            *h = [UNSET; 2];
        }
        // A tile without a diagonal is one node (half 0); its half 1 copies it at the end.
        let split = |lot: &Lot, i: usize| lot.diags[i].is_some();
        let mut next_room = 1;
        let mut queue = VecDeque::new();
        let mut nodes = Vec::new();
        for start in 0..self.halves.len() * 2 {
            let (si, sh) = (start / 2, start % 2);
            if (sh == 1 && !split(self, si)) || self.halves[si][sh] != UNSET {
                continue;
            }
            nodes.clear();
            let mut touches_border = false;
            self.halves[si][sh] = next_room;
            queue.push_back((si, sh));
            while let Some((i, h)) = queue.pop_front() {
                nodes.push((i, h));
                let (x, z) = ((i % self.width) as i32, (i / self.width) as i32);
                for side in Side::ALL {
                    if split(self, i) && self.half_at_side(x, z, side) != h {
                        continue;
                    }
                    let (dx, dz) = side.offset();
                    let (nx, nz) = (x + dx, z + dz);
                    if !self.in_bounds(nx, nz) {
                        touches_border = true;
                        continue;
                    }
                    if self.edge_between(x, z, nx, nz).is_wall() {
                        continue;
                    }
                    let n = self.tile_index(nx, nz);
                    let nh = self.half_at_side(nx, nz, side.opposite());
                    if self.halves[n][nh] == UNSET {
                        self.halves[n][nh] = next_room;
                        queue.push_back((n, nh));
                    }
                }
            }
            if touches_border {
                for &(i, h) in &nodes {
                    self.halves[i][h] = OUTDOORS;
                }
            } else {
                next_room += 1;
            }
        }
        for (i, h) in self.halves.iter_mut().enumerate() {
            if self.diags[i].is_none() {
                h[1] = h[0];
            }
            self.rooms[i] = if h[0] != OUTDOORS { h[0] } else { h[1] };
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
                "doors":[{"x":3,"z":2,"axis":"x"},{"x":5,"z":4,"axis":"z"}],
                "windows":[{"x":6,"z":2,"axis":"x"},{"x":5,"z":6,"axis":"z"}]}"#,
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

    #[test]
    fn windows_block_walking_and_separate_rooms() {
        let lot = boxed_lot();
        assert_eq!(lot.h_edge(6, 2), Edge::Window);
        assert_eq!(lot.v_edge(5, 6), Edge::Window);
        // Outside to inside through the window, and between the rooms through the inner one.
        assert!(!lot.edge_walkable(6, 1, 6, 2));
        assert!(!lot.edge_walkable(4, 6, 5, 6));
        // The rooms stay closed: a window doesn't join them or let the outdoors in.
        assert_ne!(lot.room_at(4, 6), lot.room_at(5, 6));
        assert_ne!(lot.room_at(6, 2), OUTDOORS);
    }

    #[test]
    fn diagonals_split_tiles_into_rooms_by_half() {
        // A diamond with corners (1,3), (3,1), (5,3), (3,5): eight diagonal tiles around four
        // whole tiles. One diagonal has a door, which separates rooms like a wall.
        let file: LotFile = serde_json::from_str(
            r#"{"width":8,"depth":8,"diagonals":[
                {"x":1,"z":2,"dir":"dn"},{"x":2,"z":1,"dir":"dn"},
                {"x":3,"z":1,"dir":"dp"},{"x":4,"z":2,"dir":"dp"},
                {"x":4,"z":3,"dir":"dn","kind":"door"},{"x":3,"z":4,"dir":"dn"},
                {"x":2,"z":4,"dir":"dp"},{"x":1,"z":3,"dir":"dp"}]}"#,
        )
        .unwrap();
        let lot = Lot::from_file(&file).unwrap();
        let inside = lot.room_at(2, 2);
        assert_ne!(inside, OUTDOORS);
        for (x, z) in [(2, 2), (3, 2), (2, 3), (3, 3)] {
            assert_eq!(lot.room_at(x, z), inside, "whole tile {x},{z}");
            assert_eq!(lot.half_room(x, z, 0), lot.half_room(x, z, 1));
        }
        // Each diagonal tile: the half towards the centre is inside, the other outside.
        let centre_half = |x: i32, z: i32| {
            let d = lot.diag(x, z).unwrap();
            // Signed side of the tile centre's offset towards the diamond centre (3, 3).
            let (cx, cz) = (3.0 - (x as f32 + 0.5), 3.0 - (z as f32 + 0.5));
            match d.dir {
                DiagDir::Dp => usize::from(cz > cx),
                DiagDir::Dn => usize::from(cx + cz > 0.0),
            }
        };
        for d in &file.diagonals {
            let (x, z) = (d.x as i32, d.z as i32);
            let h = centre_half(x, z);
            assert_eq!(lot.half_room(x, z, h), inside, "inner half of {x},{z}");
            assert_eq!(
                lot.half_room(x, z, 1 - h),
                OUTDOORS,
                "outer half of {x},{z}"
            );
            assert_eq!(
                lot.room_at(x, z),
                inside,
                "split tiles report the indoor half"
            );
        }
        // Side lookups match the halves.
        assert_eq!(lot.half_at_side(1, 2, Side::NegX), 0);
        assert_eq!(lot.half_at_side(1, 2, Side::PosX), 1);
        assert_eq!(lot.half_at_side(3, 1, Side::PosX), 0);
        assert_eq!(lot.half_at_side(3, 1, Side::NegX), 1);
        assert!(lot.diag_blocks(1, 2));
        assert!(
            !lot.diag_blocks(4, 3),
            "a diagonal door can be walked through"
        );
        assert!(lot.diag_touches(3, 1, 3, 1) && lot.diag_touches(3, 1, 4, 2));
        assert!(!lot.diag_touches(3, 1, 4, 1));
    }

    #[test]
    fn half_open_diagonal_rooms_stay_outdoors() {
        // Three sides of the diamond only: the area leaks out and stays outdoors.
        let file: LotFile = serde_json::from_str(
            r#"{"width":8,"depth":8,"diagonals":[
                {"x":1,"z":2,"dir":"dn"},{"x":2,"z":1,"dir":"dn"},
                {"x":3,"z":1,"dir":"dp"},{"x":4,"z":2,"dir":"dp"},
                {"x":4,"z":3,"dir":"dn"},{"x":3,"z":4,"dir":"dn"}]}"#,
        )
        .unwrap();
        let lot = Lot::from_file(&file).unwrap();
        assert!(lot.half_rooms().iter().all(|h| *h == [OUTDOORS; 2]));
        assert!(lot.rooms().iter().all(|&r| r == OUTDOORS));
    }

    #[test]
    fn windows_need_a_wall() {
        let file: LotFile = serde_json::from_str(
            r#"{"width":6,"depth":6,"walls":[[1,1,4,1]],"windows":[{"x":4,"z":1,"axis":"x"}]}"#,
        )
        .unwrap();
        let err = Lot::from_file(&file).unwrap_err();
        assert!(err.to_string().contains("window"), "{err}");
    }
}
