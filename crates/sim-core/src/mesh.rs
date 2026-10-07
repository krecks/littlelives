//! Generates wall and floor geometry from the lot.
//!
//! Output is plain arrays so any renderer can upload them directly.
//! Materials, colours and textures are the renderer's job.

use crate::lot::{Edge, Lot};

pub const WALL_THICKNESS: f32 = 0.14;
pub const WALL_HEIGHT: f32 = 2.8;
pub const WALL_HEIGHT_LOW: f32 = 0.35;
pub const DOOR_HEIGHT: f32 = 2.1;
const FLOOR_Y: f32 = 0.01;

#[derive(Debug, Default, Clone)]
pub struct MeshData {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
}

impl MeshData {
    fn quad(&mut self, corners: [[f32; 3]; 4], normal: [f32; 3], uv: [[f32; 2]; 4]) {
        let base = (self.positions.len() / 3) as u32;
        for (c, t) in corners.iter().zip(uv) {
            self.positions.extend_from_slice(c);
            self.normals.extend_from_slice(&normal);
            self.uvs.extend_from_slice(&t);
        }
        self.indices
            .extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }

    /// Axis-aligned box without a bottom face. UVs are in metres for world-scale texturing.
    pub fn add_box(&mut self, min: [f32; 3], max: [f32; 3]) {
        let [x0, y0, z0] = min;
        let [x1, y1, z1] = max;
        let uv = |u0: f32, v0: f32, u1: f32, v1: f32| [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        // Faces are wound consistently; renderers should not rely on winding (normals are explicit).
        self.quad(
            [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
            [0.0, 1.0, 0.0],
            uv(x0, z0, x1, z1),
        );
        self.quad(
            [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
            [0.0, 0.0, -1.0],
            uv(x0, y0, x1, y1),
        );
        self.quad(
            [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]],
            [0.0, 0.0, 1.0],
            uv(x1, y0, x0, y1),
        );
        self.quad(
            [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]],
            [-1.0, 0.0, 0.0],
            uv(z1, y0, z0, y1),
        );
        self.quad(
            [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
            [1.0, 0.0, 0.0],
            uv(z0, y0, z1, y1),
        );
    }
}

/// Tile-space rectangle `[x0, z0, x1, z1)` used to build geometry for part of the lot.
pub type Region = [i32; 4];

/// Walls as merged boxes. Consecutive wall edges on a grid line become one box.
pub fn build_walls(lot: &Lot, height: f32) -> MeshData {
    build_walls_in(lot, height, [0, 0, lot.width as i32, lot.depth as i32])
}

/// Walls whose edges lie inside `region` (inclusive of its boundary lines).
pub fn build_walls_in(lot: &Lot, height: f32, region: Region) -> MeshData {
    let [rx0, rz0, rx1, rz1] = clamp_region(lot, region);
    let mut mesh = MeshData::default();
    let t = WALL_THICKNESS / 2.0;

    // Horizontal grid lines.
    for z in rz0..=rz1 {
        let zf = z as f32;
        let mut x = rx0;
        while x < rx1 {
            match lot.h_edge(x, z) {
                Edge::Wall => {
                    let start = x;
                    while x < rx1 && lot.h_edge(x, z) == Edge::Wall {
                        x += 1;
                    }
                    mesh.add_box(
                        [start as f32 - t, 0.0, zf - t],
                        [x as f32 + t, height, zf + t],
                    );
                    continue;
                }
                Edge::Door if height > DOOR_HEIGHT => {
                    let xf = x as f32;
                    mesh.add_box([xf, DOOR_HEIGHT, zf - t], [xf + 1.0, height, zf + t]);
                }
                _ => {}
            }
            x += 1;
        }
    }

    // Vertical grid lines.
    for x in rx0..=rx1 {
        let xf = x as f32;
        let mut z = rz0;
        while z < rz1 {
            match lot.v_edge(x, z) {
                Edge::Wall => {
                    let start = z;
                    while z < rz1 && lot.v_edge(x, z) == Edge::Wall {
                        z += 1;
                    }
                    mesh.add_box(
                        [xf - t, 0.0, start as f32 - t],
                        [xf + t, height, z as f32 + t],
                    );
                    continue;
                }
                Edge::Door if height > DOOR_HEIGHT => {
                    let zf = z as f32;
                    mesh.add_box([xf - t, DOOR_HEIGHT, zf], [xf + t, height, zf + 1.0]);
                }
                _ => {}
            }
            z += 1;
        }
    }
    mesh
}

/// One floor quad per indoor tile.
pub fn build_floors(lot: &Lot) -> MeshData {
    build_floors_in(lot, [0, 0, lot.width as i32, lot.depth as i32])
}

/// Floors for indoor tiles inside `region`.
pub fn build_floors_in(lot: &Lot, region: Region) -> MeshData {
    let [rx0, rz0, rx1, rz1] = clamp_region(lot, region);
    let mut mesh = MeshData::default();
    for z in rz0 as i32..rz1 as i32 {
        for x in rx0 as i32..rx1 as i32 {
            if lot.room_at(x, z) == crate::lot::OUTDOORS {
                continue;
            }
            let (x0, z0, x1, z1) = (x as f32, z as f32, x as f32 + 1.0, z as f32 + 1.0);
            mesh.quad(
                [
                    [x0, FLOOR_Y, z0],
                    [x1, FLOOR_Y, z0],
                    [x1, FLOOR_Y, z1],
                    [x0, FLOOR_Y, z1],
                ],
                [0.0, 1.0, 0.0],
                [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
            );
        }
    }
    mesh
}

/// Clamps a region to the lot, as `usize` bounds `[x0, z0, x1, z1]`.
fn clamp_region(lot: &Lot, [x0, z0, x1, z1]: Region) -> [usize; 4] {
    let cx = |v: i32| v.clamp(0, lot.width as i32) as usize;
    let cz = |v: i32| v.clamp(0, lot.depth as i32) as usize;
    [cx(x0), cz(z0), cx(x1), cz(z1)]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lot::LotFile;

    #[test]
    fn merges_wall_runs_and_leaves_door_gap() {
        let file: LotFile = serde_json::from_str(
            r#"{"width":6,"depth":6,"walls":[[1,1,5,1]],"doors":[{"x":3,"z":1,"axis":"x"}]}"#,
        )
        .unwrap();
        let lot = Lot::from_file(&file).unwrap();
        let full = build_walls(&lot, WALL_HEIGHT);
        // Two wall runs + one lintel = 3 boxes × 5 faces × 4 vertices.
        assert_eq!(full.positions.len() / 3, 3 * 5 * 4);
        let low = build_walls(&lot, WALL_HEIGHT_LOW);
        assert_eq!(low.positions.len() / 3, 2 * 5 * 4);
    }

    #[test]
    fn regions_only_include_their_walls() {
        let file: LotFile =
            serde_json::from_str(r#"{"width":20,"depth":6,"walls":[[1,1,4,1],[12,1,16,1]]}"#)
                .unwrap();
        let lot = Lot::from_file(&file).unwrap();
        let left = build_walls_in(&lot, WALL_HEIGHT, [0, 0, 10, 6]);
        assert_eq!(left.positions.len() / 3, 5 * 4, "only the left wall");
        assert_eq!(
            build_walls_in(&lot, WALL_HEIGHT, [0, 0, 20, 6])
                .positions
                .len(),
            build_walls(&lot, WALL_HEIGHT).positions.len()
        );
    }
}
