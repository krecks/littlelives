//! Content packs: merging `base.json` with the files it lists in `"include"`.
//!
//! Rules (mirrored exactly by `mergeContent` in `web/src/content/content.ts`; see
//! `docs/content-packs.md`), applied file by file in order:
//! - top-level arrays are appended; an `id` that appears twice in one merged array is an
//!   error naming both files;
//! - top-level objects are merged shallowly (keys added or replaced);
//! - other values are replaced; a key whose type changes between files is an error;
//! - `traitPatches` (`{ traitId: { effects, startingSkills } }`) are applied to the merged
//!   traits last: map entries are set per key, `mood` is added, `walkSpeed` multiplied;
//! - `include` and `$comment` are dropped;
//! - keys from before the moodlet → feeling rename (`moodlets`, `moodlet`, `targetMoodlet`, ...)
//!   are renamed first, so old packs still load (`LEGACY_KEYS`).

use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::Error;

/// Effect maps in `traitPatches` whose entries are set per key.
const PATCH_MAPS: [&str; 6] = [
    "needDecay",
    "needGain",
    "tagPreference",
    "tagAcceptance",
    "tagSuccess",
    "skillGain",
];

/// Content keys renamed when moodlets became feelings: (old, new). Kept so content packs
/// written before the rename still merge and load; `mergeContent` in TypeScript uses the
/// same list.
const LEGACY_KEYS: [(&str, &str); 11] = [
    ("moodlets", "feelings"),
    ("moodlet", "feeling"),
    ("moodletMinSkill", "feelingMinSkill"),
    ("targetMoodlet", "targetFeeling"),
    ("winnerMoodlet", "winnerFeeling"),
    ("loserMoodlet", "loserFeeling"),
    ("jealousyMoodlet", "jealousyFeeling"),
    ("heartbreakMoodlet", "heartbreakFeeling"),
    ("promotionMoodlet", "promotionFeeling"),
    ("missedMoodlet", "missedFeeling"),
    ("debtMoodlet", "debtFeeling"),
];

/// Renames `LEGACY_KEYS` anywhere in `value` (unless the new key is already there, in which
/// case loading reports the duplicate).
fn upgrade_legacy_keys(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (old, new) in LEGACY_KEYS {
                if !map.contains_key(new)
                    && let Some(v) = map.remove(old)
                {
                    map.insert(new.to_owned(), v);
                }
            }
            map.values_mut().for_each(upgrade_legacy_keys);
        }
        Value::Array(items) => items.iter_mut().for_each(upgrade_legacy_keys),
        _ => {}
    }
}

/// Merges `base` with `parts`, the contents of the files in its `"include"` list (same
/// order). File names in errors come from that list.
pub fn merge_content(base: &str, parts: &[&str]) -> Result<String, Error> {
    let includes: Vec<String> = serde_json::from_str::<Value>(base)
        .ok()
        .and_then(|v| v.get("include").cloned())
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let names: Vec<String> = (0..parts.len())
        .map(|i| {
            includes
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("part {}", i + 1))
        })
        .collect();
    let files: Vec<(&str, &str)> = std::iter::once(("base.json", base))
        .chain(names.iter().map(String::as_str).zip(parts.iter().copied()))
        .collect();
    merge_named(&files)
}

/// Merges named content files `(name, json)` in order, base first.
pub fn merge_named(files: &[(&str, &str)]) -> Result<String, Error> {
    let mut out = Map::new();
    // (array key, id) -> file that defined it.
    let mut origin: HashMap<(String, String), &str> = HashMap::new();
    let mut patches: Vec<(&str, Value)> = Vec::new();
    for &(name, text) in files {
        let mut file: Value = serde_json::from_str(text)
            .map_err(|e| Error::new(format!("{name}: invalid JSON: {e}")))?;
        upgrade_legacy_keys(&mut file);
        let Value::Object(file) = file else {
            return Err(Error::new(format!(
                "{name}: a content file must be a JSON object"
            )));
        };
        for (key, value) in file {
            match key.as_str() {
                "include" | "$comment" => continue,
                "traitPatches" => {
                    patches.push((name, value));
                    continue;
                }
                _ => {}
            }
            if out.get(&key).is_some_and(|prev| kind(prev) != kind(&value)) {
                return Err(Error::new(format!(
                    "{name}: '{key}' has a different type than in the files before it"
                )));
            }
            match value {
                Value::Array(items) => {
                    for id in items.iter().filter_map(|i| i.get("id")?.as_str()) {
                        if let Some(first) = origin.insert((key.clone(), id.to_owned()), name) {
                            return Err(Error::new(format!(
                                "duplicate {key} id '{id}' in {first} and {name}"
                            )));
                        }
                    }
                    match out.get_mut(&key) {
                        Some(Value::Array(prev)) => prev.extend(items),
                        _ => {
                            out.insert(key, Value::Array(items));
                        }
                    }
                }
                Value::Object(map) => match out.get_mut(&key) {
                    Some(Value::Object(prev)) => prev.extend(map),
                    _ => {
                        out.insert(key, Value::Object(map));
                    }
                },
                value => {
                    out.insert(key, value);
                }
            }
        }
    }
    for (name, value) in patches {
        let Value::Object(value) = value else {
            return Err(Error::new(format!(
                "{name}: traitPatches must be an object"
            )));
        };
        for (id, patch) in value {
            let target = out
                .get_mut("traits")
                .and_then(Value::as_array_mut)
                .and_then(|traits| {
                    traits
                        .iter_mut()
                        .find(|t| t.get("id").and_then(Value::as_str) == Some(id.as_str()))
                })
                .and_then(Value::as_object_mut)
                .ok_or_else(|| Error::new(format!("{name}: traitPatches: unknown trait '{id}'")))?;
            patch_trait(target, patch, &format!("{name}: traitPatches.{id}"))?;
        }
    }
    Ok(Value::Object(out).to_string())
}

fn kind(v: &Value) -> u8 {
    match v {
        Value::Array(_) => 0,
        Value::Object(_) => 1,
        _ => 2,
    }
}

fn patch_trait(target: &mut Map<String, Value>, patch: Value, ctx: &str) -> Result<(), Error> {
    let Value::Object(patch) = patch else {
        return Err(Error::new(format!("{ctx} must be an object")));
    };
    for (k, v) in patch {
        match k.as_str() {
            "startingSkills" => set_entries(target, &k, v, ctx)?,
            "effects" => {
                let Value::Object(v) = v else {
                    return Err(Error::new(format!("{ctx}.effects must be an object")));
                };
                let effects = object_entry(target, "effects");
                let ctx = format!("{ctx}.effects");
                for (ek, ev) in v {
                    if PATCH_MAPS.contains(&ek.as_str()) {
                        set_entries(effects, &ek, ev, &ctx)?;
                    } else if ek == "mood" || ek == "walkSpeed" {
                        let x = ev
                            .as_f64()
                            .ok_or_else(|| Error::new(format!("{ctx}.{ek} must be a number")))?;
                        let mood = ek == "mood";
                        let old = effects.get(&ek).and_then(Value::as_f64).unwrap_or(if mood {
                            0.0
                        } else {
                            1.0
                        });
                        let new = if mood { old + x } else { old * x };
                        let new = serde_json::Number::from_f64(new)
                            .ok_or_else(|| Error::new(format!("{ctx}.{ek} is not finite")))?;
                        effects.insert(ek, Value::Number(new));
                    } else {
                        return Err(Error::new(format!("{ctx}: unknown key '{ek}'")));
                    }
                }
            }
            _ => {
                return Err(Error::new(format!(
                    "{ctx}: unknown key '{k}' (use effects or startingSkills)"
                )));
            }
        }
    }
    Ok(())
}

/// `map[key]` as an object, replacing anything else there with `{}`.
fn object_entry<'a>(map: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let v = map.entry(key).or_insert_with(|| Value::Object(Map::new()));
    if !v.is_object() {
        *v = Value::Object(Map::new());
    }
    v.as_object_mut().expect("just made an object")
}

fn set_entries(
    target: &mut Map<String, Value>,
    key: &str,
    value: Value,
    ctx: &str,
) -> Result<(), Error> {
    let Value::Object(value) = value else {
        return Err(Error::new(format!("{ctx}.{key} must be an object")));
    };
    object_entry(target, key).extend(value);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn merged(files: &[(&str, &str)]) -> Value {
        serde_json::from_str(&merge_named(files).unwrap()).unwrap()
    }

    const BASE: &str = r#"{"$comment":"x","include":["a.json"],"version":1,
        "objects":[{"id":"bed"}],"schedule":[{"from":1}],"economy":{"startingFunds":10,"currency":"$"},
        "traits":[{"id":"lazy","effects":{"walkSpeed":0.8,"needDecay":{"energy":1.2}}},{"id":"neat"}]}"#;

    #[test]
    fn appends_arrays_merges_objects_and_replaces_values() {
        let v = merged(&[
            ("base.json", BASE),
            (
                "a.json",
                r#"{"$comment":"y","version":2,"objects":[{"id":"tub"}],"schedule":[{"from":1}],
                    "economy":{"startingFunds":20},"tags":["spa"]}"#,
            ),
        ]);
        assert_eq!(v["objects"].as_array().unwrap().len(), 2);
        assert_eq!(v["objects"][1]["id"], "tub");
        assert_eq!(
            v["schedule"].as_array().unwrap().len(),
            2,
            "items without ids append"
        );
        assert_eq!(v["economy"]["startingFunds"], 20);
        assert_eq!(v["economy"]["currency"], "$");
        assert_eq!(v["version"], 2);
        assert_eq!(v["tags"][0], "spa");
        assert!(v.get("include").is_none() && v.get("$comment").is_none());
    }

    #[test]
    fn duplicate_ids_name_both_files() {
        let err = merge_named(&[
            ("base.json", BASE),
            ("packs/x.json", r#"{"objects":[{"id":"bed"}]}"#),
        ])
        .unwrap_err();
        assert!(err.0.contains("'bed'") && err.0.contains("base.json"));
        assert!(err.0.contains("packs/x.json"), "{}", err.0);
        let err = merge_named(&[("base.json", BASE), ("b.json", r#"{"objects":{}}"#)]);
        assert!(err.unwrap_err().0.contains("different type"));
        let err = merge_named(&[("base.json", BASE), ("c.json", "{oops")]);
        assert!(err.unwrap_err().0.starts_with("c.json: invalid JSON"));
    }

    #[test]
    fn trait_patches_merge_into_traits() {
        let pack = r#"{"traitPatches":{"lazy":{"effects":{"walkSpeed":0.5,"mood":0.1,
            "needDecay":{"hunger":1.1},"tagPreference":{"spa":2}},"startingSkills":{"cooking":1}},
            "neat":{"effects":{"mood":-0.05}}}}"#;
        let v = merged(&[("base.json", BASE), ("p.json", pack), ("q.json", pack)]);
        let lazy = &v["traits"][0]["effects"];
        assert!((lazy["walkSpeed"].as_f64().unwrap() - 0.8 * 0.5 * 0.5).abs() < 1e-9);
        assert!((lazy["mood"].as_f64().unwrap() - 0.2).abs() < 1e-9);
        assert_eq!(lazy["needDecay"]["energy"], 1.2, "other entries kept");
        assert_eq!(lazy["needDecay"]["hunger"], 1.1);
        assert_eq!(lazy["tagPreference"]["spa"], 2);
        assert_eq!(v["traits"][0]["startingSkills"]["cooking"], 1);
        assert!((v["traits"][1]["effects"]["mood"].as_f64().unwrap() + 0.1).abs() < 1e-9);
        assert!(v.get("traitPatches").is_none());

        let unknown = r#"{"traitPatches":{"grumpy":{"effects":{"mood":0.1}}}}"#;
        let err = merge_named(&[("base.json", BASE), ("p.json", unknown)]).unwrap_err();
        assert!(err.0.contains("unknown trait 'grumpy'"), "{}", err.0);
        let bad_key = r#"{"traitPatches":{"lazy":{"effects":{"speed":2}}}}"#;
        assert!(merge_named(&[("base.json", BASE), ("p.json", bad_key)]).is_err());
    }

    #[test]
    fn merge_content_names_parts_after_the_include_list() {
        let err = merge_content(BASE, &[r#"{"objects":[{"id":"bed"}]}"#]).unwrap_err();
        assert!(err.0.contains("a.json"), "{}", err.0);
    }

    #[test]
    fn packs_with_moodlet_keys_still_merge() {
        // Written before the moodlet → feeling rename.
        let base = r#"{"feelings":[{"id":"a","label":"A","hours":1}]}"#;
        let old = r#"{"moodlets":[{"id":"b","label":"B","hours":1}],
            "objects":[{"id":"tub","interactions":[{"id":"soak","moodlet":"b","moodletMinSkill":2}]}]}"#;
        let v = merged(&[("base.json", base), ("old.json", old)]);
        assert!(v.get("moodlets").is_none());
        assert_eq!(v["feelings"][1]["id"], "b");
        let soak = &v["objects"][0]["interactions"][0];
        assert_eq!(soak["feeling"], "b");
        assert_eq!(soak["feelingMinSkill"], 2);
        let err = merge_named(&[("base.json", base), ("dup.json", old), ("dup2.json", old)]);
        assert!(err.unwrap_err().0.contains("duplicate feelings id 'b'"));
    }
}
