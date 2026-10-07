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
    /// Take the first level of a career (replacing any current job).
    JoinCareer {
        sim: u32,
        career: usize,
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
}

impl Command {
    pub fn from_json(json: &str) -> Result<Self, crate::Error> {
        serde_json::from_str(json).map_err(|e| crate::Error::new(format!("invalid command: {e}")))
    }
}
