use serde::Deserialize;

/// Player commands. Serialized as `{"type": "...", ...}` from the UI.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    SetSpeed {
        speed: u8,
    },
    /// Turn "free will" on or off for the whole household.
    SetAutonomy {
        enabled: bool,
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
}

/// One wall edge to set. `h` edges run along x at the line `z`; `v` edges run along z at the line `x`.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct EdgeEdit {
    pub axis: EdgeAxis,
    pub x: i32,
    pub z: i32,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeAxis {
    H,
    V,
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
    pub fn from_json(json: &str) -> Result<Self, crate::Error> {
        serde_json::from_str(json).map_err(|e| crate::Error::new(format!("invalid command: {e}")))
    }
}
