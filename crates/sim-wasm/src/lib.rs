//! Browser bindings for `sim-core`. Keep this layer thin: no game logic here.

use sim_core::{Command, World, mesh, snapshot, view};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Game {
    world: World,
    snapshot: Box<[f32]>,
    /// What the UI was last sent (it gets changes only).
    ui: view::UiSync,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(content_json: &str, lot_json: &str, seed: u32) -> Result<Game, JsError> {
        let world =
            World::from_json(content_json, lot_json, seed).map_err(|e| JsError::new(&e.0))?;
        Ok(Game::with_world(world))
    }

    /// Restores a game from `save()` output.
    #[wasm_bindgen(js_name = fromSave)]
    pub fn from_save(content_json: &str, save_json: &str) -> Result<Game, JsError> {
        let world =
            World::from_save_json(content_json, save_json).map_err(|e| JsError::new(&e.0))?;
        Ok(Game::with_world(world))
    }

    /// Serializes the whole game state (see `sim_core::save`).
    pub fn save(&self) -> String {
        self.world.save_json()
    }

    /// Runs one real-time step and refreshes the snapshot.
    pub fn advance(&mut self) {
        self.world.advance();
        snapshot::write(&self.world, &mut self.snapshot);
    }

    /// Pointer into WASM memory; read it as a `Float32Array` of `snapshot_len()` floats.
    /// The buffer never moves for the lifetime of the `Game`.
    pub fn snapshot_ptr(&self) -> *const f32 {
        self.snapshot.as_ptr()
    }

    pub fn snapshot_len(&self) -> usize {
        self.snapshot.len()
    }

    /// Applies a JSON-encoded `Command`.
    pub fn command(&mut self, json: &str) -> Result<(), JsError> {
        let cmd = Command::from_json(json).map_err(|e| JsError::new(&e.0))?;
        self.world.apply(cmd).map_err(|e| JsError::new(&e.0))?;
        snapshot::write(&self.world, &mut self.snapshot);
        Ok(())
    }

    /// The next UI update (JSON): what changed since the last one, or everything after
    /// `resync_ui` (see `view::UiSync`).
    pub fn ui_update(&mut self) -> String {
        self.ui.update_json(&self.world)
    }

    /// The next UI update sends everything.
    pub fn resync_ui(&mut self) {
        self.ui.resync();
    }

    /// The resident whose panel is open (their details and relationships are sent too).
    pub fn inspect(&mut self, sim: Option<u32>) {
        self.ui.inspect(sim);
    }

    /// Social interactions `actor` can start with `target`, with success chances (JSON).
    pub fn social_options(&self, actor: u32, target: u32) -> String {
        view::social_options_json(&self.world, actor as usize, target as usize)
    }

    /// The household's home as a blueprint (JSON; see `sim_core::blueprint`).
    pub fn blueprint(&self, household: u32) -> Result<String, JsError> {
        self.world.blueprint_json(household).map_err(|e| JsError::new(&e.to_string()))
    }

    /// The whole story log, oldest first (JSON).
    pub fn events(&self) -> String {
        view::events_json(&self.world)
    }

    /// Every career level plus object and build rules (JSON, static per game).
    pub fn catalog(&self) -> String {
        view::catalog_json(&self.world.content)
    }

    /// The world structure; with `lot` false, without the lot parts (see `lotVersion`).
    pub fn structure(&self, lot: bool) -> String {
        view::structure_json_with(&self.world, lot)
    }

    /// Changes whenever the lot (walls, floors, fences...) does; see `World::lot_version`.
    pub fn lot_version(&self) -> u32 {
        self.world.lot_version()
    }

    /// Snapshot layout (JSON): float offsets plus the content's animation tags (`actions`).
    pub fn snapshot_layout(&self) -> String {
        snapshot::layout_json(&self.world.content)
    }

    pub fn structure_version(&self) -> u32 {
        self.world.structure_version()
    }

    /// Builds lot geometry inside the tile rectangle `[x0, z0, x1, z1)`.
    /// `kind`: 0 = full walls, 1 = low walls, 2 = floors.
    pub fn build_mesh(&self, kind: u8, x0: i32, z0: i32, x1: i32, z1: i32) -> MeshBuffers {
        let lot = &self.world.lot;
        let region = [x0, z0, x1, z1];
        let m = match kind {
            0 => mesh::build_walls_in(lot, mesh::WALL_HEIGHT, region),
            1 => mesh::build_walls_in(lot, mesh::WALL_HEIGHT_LOW, region),
            _ => mesh::build_floors_in(lot, region),
        };
        MeshBuffers {
            positions: m.positions,
            normals: m.normals,
            uvs: m.uvs,
            indices: m.indices,
        }
    }
}

impl Game {
    fn with_world(world: World) -> Game {
        let mut game = Game {
            world,
            snapshot: vec![0.0; snapshot::CAPACITY].into_boxed_slice(),
            ui: view::UiSync::new(),
        };
        snapshot::write(&game.world, &mut game.snapshot);
        game
    }
}

/// Geometry handed to JS once per structure change. Getters copy into typed arrays.
#[wasm_bindgen]
pub struct MeshBuffers {
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    indices: Vec<u32>,
}

#[wasm_bindgen]
impl MeshBuffers {
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f32> {
        self.positions.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> Vec<f32> {
        self.normals.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn uvs(&self) -> Vec<f32> {
        self.uvs.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u32> {
        self.indices.clone()
    }
}
