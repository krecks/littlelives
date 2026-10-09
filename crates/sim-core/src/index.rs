//! Objects by plot, so a resident deciding what to do looks at what's near them rather than at
//! every object in town.
//!
//! Residents only use what's at home, in public places and off the plots, or, as guests, what's
//! on the plot they're visiting (see `world::access`). The index lists exactly those objects per
//! plot, in id order, so choices come out as they did from a scan of the whole town. It is
//! derived from `World::object_plot` and rebuilt when the structure changes (objects bought,
//! sold, broken or mended, a game loaded); see `World::refresh_index`.

use crate::world::Plot;

#[derive(Debug, Clone, Default)]
pub(crate) struct ObjectIndex {
    /// Objects standing on each plot.
    on: Vec<Vec<u32>>,
    /// Per plot, what the people living there may use: their own objects, public places' and
    /// anything off the plots.
    usable: Vec<Vec<u32>>,
    /// What people with no home may use: public places' and off-plot objects.
    shared: Vec<u32>,
    /// The `World::structure_version` it was built for.
    pub version: u32,
}

impl ObjectIndex {
    pub fn new(object_plot: &[Option<u32>], plots: &[Plot], version: u32) -> Self {
        let mut index = Self {
            on: vec![Vec::new(); plots.len()],
            usable: vec![Vec::new(); plots.len()],
            shared: Vec::new(),
            version,
        };
        for (id, plot) in object_plot.iter().enumerate() {
            let id = id as u32;
            match plot.map(|p| p as usize) {
                Some(p) if !plots[p].public => {
                    index.on[p].push(id);
                    index.usable[p].push(id);
                }
                // Public or off the plots: everyone's.
                p => {
                    if let Some(p) = p {
                        index.on[p].push(id);
                    }
                    index.shared.push(id);
                    for usable in &mut index.usable {
                        usable.push(id);
                    }
                }
            }
        }
        index
    }

    /// Objects on `plot`.
    pub fn on(&self, plot: u32) -> &[u32] {
        self.on.get(plot as usize).map_or(&[], Vec::as_slice)
    }

    /// Objects people living on `home` (or nowhere) may use.
    pub fn usable_from(&self, home: Option<u32>) -> &[u32] {
        match home.and_then(|p| self.usable.get(p as usize)) {
            Some(list) => list,
            None => &self.shared,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plot(id: u32, public: bool) -> Plot {
        Plot { id, name: String::new(), x: 0, z: 0, w: 1, d: 1, public, entry: None, roof: None }
    }

    #[test]
    fn lists_what_each_household_may_use_in_id_order() {
        let plots = [plot(0, false), plot(1, true), plot(2, false)];
        let object_plot = [Some(2), Some(0), None, Some(1), Some(0)];
        let ix = ObjectIndex::new(&object_plot, &plots, 1);
        assert_eq!(ix.on(0), [1, 4]);
        assert_eq!(ix.on(1), [3]);
        assert_eq!(ix.usable_from(Some(0)), [1, 2, 3, 4]);
        assert_eq!(ix.usable_from(Some(2)), [0, 2, 3]);
        assert_eq!(ix.usable_from(None), [2, 3]);
        assert!(ix.on(7).is_empty());
    }
}
