use serde::Deserialize;

/// Player commands. Serialized as `{"type": "...", ...}` from the UI.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    SetSpeed {
        speed: u8,
    },
    /// "Skip quiet hours": speed up while the player's household sleeps or is at work.
    SetAutoFast {
        enabled: bool,
    },
    /// Turn "free will" on or off for a household (default: the player's).
    SetAutonomy {
        enabled: bool,
        #[serde(default)]
        household: Option<u32>,
    },
    /// Queue an interaction on an object for a Sim.
    Use {
        sim: u32,
        object: u32,
        interaction: usize,
    },
    MoveTo {
        sim: u32,
        x: f32,
        z: f32,
    },
    /// Start a social interaction with another Sim.
    Social {
        sim: u32,
        target: u32,
        social: usize,
    },
    /// Take a job: a career and level (grade), replacing any current job.
    JoinCareer {
        sim: u32,
        career: usize,
        #[serde(default)]
        level: usize,
    },
    QuitCareer {
        sim: u32,
    },
    /// Walk over to another household's plot.
    Visit {
        sim: u32,
        plot: u32,
    },
    GoHome {
        sim: u32,
    },
    /// Cancel an action: index 0 is the current action, 1.. are queued ones.
    Cancel {
        sim: u32,
        index: usize,
    },
    /// Buy an object for the Sim's home: at `at` (`[x, z, rot]`) or wherever it fits.
    Buy {
        sim: u32,
        object: String,
        #[serde(default)]
        at: Option<[i32; 3]>,
        /// Style index; defaults to the household's favourite.
        #[serde(default)]
        style: Option<u8>,
    },
    /// Sell an object at home for part of what was paid.
    Sell {
        sim: u32,
        object: u32,
    },
    /// Move or rotate an object at home.
    MoveObject {
        sim: u32,
        object: u32,
        x: i32,
        z: i32,
        rot: u8,
    },
    /// Change how an object looks (free; effects stay the same).
    Restyle {
        sim: u32,
        object: u32,
        style: u8,
    },
    /// Set the household's favourite style (used for new purchases).
    SetStyle {
        sim: u32,
        style: u8,
    },
    /// Buy mode: buy the next quality level for an object at the Sim's home (instant).
    Upgrade {
        sim: u32,
        object: u32,
    },
    /// Build mode: change wall edges on the Sim's home plot.
    Build {
        sim: u32,
        edits: Vec<EdgeEdit>,
    },
    /// Build mode: cover wall faces on the Sim's home plot (paint, wallpaper, brick...).
    Paint {
        sim: u32,
        faces: Vec<FacePaint>,
    },
    /// Build mode: cover floor tiles indoors on the Sim's home plot (wood, tile, carpet...).
    PaintFloor {
        sim: u32,
        tiles: Vec<FloorPaint>,
    },
    /// Build and buy mode: take back the household's last edit (see `World::undo`).
    Undo {
        sim: u32,
    },
}

/// One wall edge to set. `h` edges run along x at the line `z`; `v` edges run along z at the
/// line `x`; `dp` (`/`) and `dn` (`\`) are diagonal walls across tile `(x, z)`.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct EdgeEdit {
    pub axis: EdgeAxis,
    pub x: i32,
    pub z: i32,
    pub kind: EdgeKind,
    /// New walls: the covering of both faces (0 = the automatic look).
    #[serde(default)]
    pub cover: Option<u8>,
    /// Walls: 0 full height, 1 half wall. Changing it on a standing wall rebuilds it.
    #[serde(default)]
    pub form: Option<u8>,
    /// Doors and windows: their style. Changing it on a standing door or window replaces it.
    #[serde(default)]
    pub style: Option<u8>,
}

impl EdgeEdit {
    /// An edit with the default look (full-height, automatic covering, first style).
    pub fn new(axis: EdgeAxis, x: i32, z: i32, kind: EdgeKind) -> Self {
        Self {
            axis,
            x,
            z,
            kind,
            cover: None,
            form: None,
            style: None,
        }
    }
}

/// One wall face to cover: face 0 looks towards `-z` (`h`), `-x` (`v`) or the tile's half 0
/// (diagonals), face 1 the other way. `covering`: 0 the automatic look, else a wall covering + 1.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct FacePaint {
    pub axis: EdgeAxis,
    pub x: i32,
    pub z: i32,
    pub side: u8,
    pub covering: u8,
}

/// One floor tile to cover. `covering`: 0 the automatic look, else a floor covering + 1.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct FloorPaint {
    pub x: i32,
    pub z: i32,
    pub covering: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeAxis {
    H,
    V,
    /// Diagonal `/` across tile `(x, z)`: from corner `(x, z)` to `(x + 1, z + 1)`.
    Dp,
    /// Diagonal `\` across tile `(x, z)`: from corner `(x, z + 1)` to `(x + 1, z)`.
    Dn,
}

impl EdgeAxis {
    /// The diagonal direction, for `dp` / `dn`.
    pub fn diagonal(self) -> Option<crate::lot::DiagDir> {
        match self {
            EdgeAxis::Dp => Some(crate::lot::DiagDir::Dp),
            EdgeAxis::Dn => Some(crate::lot::DiagDir::Dn),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKind {
    Wall,
    /// A door in a wall (Sims walk through).
    Door,
    /// A window in a wall (Sims can't pass).
    Window,
    /// No wall: tears down a wall, door or window.
    Open,
}

impl Command {
    /// The Sim whose home a build or buy edit changes (edits can be undone), if this is one.
    pub fn home_edit(&self) -> Option<u32> {
        match *self {
            Command::Buy { sim, .. }
            | Command::Sell { sim, .. }
            | Command::MoveObject { sim, .. }
            | Command::Restyle { sim, .. }
            | Command::SetStyle { sim, .. }
            | Command::Upgrade { sim, .. }
            | Command::Build { sim, .. }
            | Command::Paint { sim, .. }
            | Command::PaintFloor { sim, .. } => Some(sim),
            _ => None,
        }
    }

    pub fn from_json(json: &str) -> Result<Self, crate::Error> {
        serde_json::from_str(json).map_err(|e| crate::Error::new(format!("invalid command: {e}")))
    }
}
