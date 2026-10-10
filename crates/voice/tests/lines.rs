//! Every spoken line in the content (`web/public/content/voice/en.json` and the `voice.en` of
//! every content file `base.json` includes) phonemizes from the dictionary into symbols the
//! model knows, and every key names something that exists. Needs `node tools/voice/fetch.mjs`
//! first for the phonemizer part.

use std::collections::{BTreeSet, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value;
use voice::{G2p, Lexicon};

const TONES: [&str; 5] = ["happy", "sad", "angry", "flirty", "question"];
/// Short lines: each one is made into speech on its own while the game runs.
const MAX_CHARS: usize = 90;

fn content_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/public/content")
}

fn read_json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// `base.json` and the files it includes, in order.
fn content_files() -> Vec<(String, Value)> {
    let base = read_json(&content_dir().join("base.json"));
    let includes: Vec<String> = base["include"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
        .unwrap_or_default();
    let mut files = vec![("base.json".to_owned(), base)];
    for name in includes {
        let v = read_json(&content_dir().join(&name));
        files.push((name, v));
    }
    files
}

/// The English line files: the language file first, then packs' `voice.en`.
fn line_files() -> Vec<(String, Value)> {
    let mut out = vec![("voice/en.json".to_owned(), read_json(&content_dir().join("voice/en.json")))];
    for (name, file) in content_files() {
        if let Some(v) = file.get("voice").and_then(|v| v.get("en")) {
            out.push((format!("{name} voice.en"), v.clone()));
        }
    }
    out
}

/// Every line (a string in a list) with where it is.
fn lines(v: &Value, at: &str, out: &mut Vec<(String, String)>) {
    match v {
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                match item {
                    Value::String(s) => out.push((format!("{at}[{i}]"), s.clone())),
                    other => lines(other, &format!("{at}[{i}]"), out),
                }
            }
        }
        Value::Object(map) => {
            for (k, item) in map {
                if !k.starts_with('_') {
                    lines(item, &format!("{at}.{k}"), out);
                }
            }
        }
        _ => {}
    }
}

fn g2p() -> Option<G2p> {
    let path = content_dir().join("../voice/en-us.lexz");
    let Ok(file) = std::fs::File::open(&path) else {
        eprintln!("skipped: {} missing (run `node tools/voice/fetch.mjs`)", path.display());
        return None;
    };
    let mut tsv = String::new();
    flate2::read::GzDecoder::new(file).read_to_string(&mut tsv).unwrap();
    Some(G2p::new(Lexicon::parse(&tsv)))
}

/// The symbols Paradee takes (`vocab` in its config), if it was fetched.
fn vocab() -> Option<BTreeSet<char>> {
    let path = content_dir().join("../voice/paradee-8m.json");
    let config: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    Some(config["vocab"].as_object()?.keys().filter_map(|k| k.chars().next()).collect())
}

#[test]
fn every_line_phonemizes_from_the_dictionary() {
    let Some(g2p) = g2p() else { return };
    let vocab = vocab();
    let mut all = Vec::new();
    for (name, file) in line_files() {
        lines(&file, &name, &mut all);
    }
    assert!(all.len() > 100, "found only {} lines", all.len());
    let mut wrong = Vec::new();
    for (at, text) in &all {
        // Placeholders hold first names; these two are in the dictionary.
        let text = text.replace("{me}", "Anna").replace("{name}", "Ben");
        let unknown = g2p.unknown_words(&text);
        if !unknown.is_empty() {
            wrong.push(format!("{at}: {text}\n  not in the dictionary: {}", unknown.join(", ")));
            continue;
        }
        let ps = g2p.phonemize(&text);
        if !ps.chars().any(|c| "AIOWYaeiouæɑɐɒɔəɚɛɜɪʊʌ".contains(c)) {
            wrong.push(format!("{at}: {text}\n  no vowel: {ps:?}"));
        } else if ps.chars().count() > 510 {
            wrong.push(format!("{at}: {text}\n  too long for the model"));
        } else if let Some(vocab) = &vocab {
            let odd: String = ps.chars().filter(|c| !vocab.contains(c)).collect();
            if !odd.is_empty() {
                wrong.push(format!("{at}: {text}\n  unknown symbols {odd:?} in {ps}"));
            }
        }
    }
    assert!(wrong.is_empty(), "{} of {} lines:\n{}", wrong.len(), all.len(), wrong.join("\n"));
}

#[test]
fn lines_are_short_with_known_placeholders() {
    let mut wrong = Vec::new();
    for (name, file) in line_files() {
        let mut all = Vec::new();
        lines(&file, &name, &mut all);
        for (at, text) in all {
            let rest = text.replace("{me}", "").replace("{name}", "");
            if rest.contains('{') || rest.contains('}') {
                wrong.push(format!("{at}: unknown placeholder in {text:?}"));
            }
            if text.chars().count() > MAX_CHARS {
                wrong.push(format!("{at}: over {MAX_CHARS} characters: {text:?}"));
            }
            if text.trim().is_empty() {
                wrong.push(format!("{at}: empty"));
            }
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// Ids the line files may refer to, from the merged content.
struct Ids {
    socials: BTreeSet<String>,
    emotions: BTreeSet<String>,
    animations: BTreeSet<String>,
    /// Object id → its interaction ids.
    objects: HashMap<String, BTreeSet<String>>,
}

fn ids() -> Ids {
    let mut ids = Ids { socials: BTreeSet::new(), emotions: BTreeSet::new(), animations: BTreeSet::new(), objects: HashMap::new() };
    let list = |v: &Value, key: &str| -> Vec<Value> { v.get(key).and_then(Value::as_array).cloned().unwrap_or_default() };
    let id = |v: &Value| v["id"].as_str().unwrap_or_default().to_owned();
    for (_, file) in content_files() {
        ids.socials.extend(list(&file, "socials").iter().map(id));
        ids.emotions.extend(list(&file, "emotions").iter().map(id));
        ids.animations.extend(list(&file, "animations").iter().filter_map(|a| a.as_str().map(str::to_owned)));
        for o in list(&file, "objects") {
            ids.objects.insert(id(&o), list(&o, "interactions").iter().map(id).collect());
        }
    }
    ids
}

#[test]
fn keys_name_content_that_exists() {
    let ids = ids();
    let thoughts = ["skipped", "noPlace", "kept", "goal", "roomLoved", "roomDisliked", "broken", "accident", "crying"];
    let interactions: BTreeSet<&String> = ids.objects.values().flatten().collect();
    let mut wrong = Vec::new();
    let keys = |v: &Value, section: &str| -> Vec<(String, Value)> {
        v.get(section).and_then(Value::as_object).map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default()
    };
    let mut tone = |at: &str, v: &Value| {
        if let Some(t) = v.get("tone") {
            if !t.as_str().is_some_and(|t| TONES.contains(&t)) {
                wrong.push(format!("{at}: unknown tone {t}"));
            }
        }
    };
    let mut unknown = Vec::new();
    for (name, file) in line_files() {
        for (k, v) in keys(&file, "social") {
            tone(&format!("{name} social.{k}"), &v);
            if !ids.socials.contains(&k) {
                unknown.push(format!("{name}: social '{k}'"));
            }
        }
        for (k, v) in keys(&file, "emotion") {
            tone(&format!("{name} emotion.{k}"), &v);
            if !ids.emotions.contains(&k) {
                unknown.push(format!("{name}: emotion '{k}'"));
            }
        }
        for (k, v) in keys(&file, "thought") {
            tone(&format!("{name} thought.{k}"), &v);
            if !thoughts.contains(&k.as_str()) {
                unknown.push(format!("{name}: thought '{k}'"));
            }
        }
        for (k, v) in keys(&file, "action") {
            tone(&format!("{name} action.{k}"), &v);
            if !ids.animations.contains(&k) {
                unknown.push(format!("{name}: action '{k}'"));
            }
        }
        for (k, v) in keys(&file, "interaction") {
            tone(&format!("{name} interaction.{k}"), &v);
            if !interactions.contains(&k) {
                unknown.push(format!("{name}: interaction '{k}'"));
            }
        }
        for (k, v) in keys(&file, "object") {
            tone(&format!("{name} object.{k}"), &v);
            let Some(own) = ids.objects.get(&k) else {
                unknown.push(format!("{name}: object '{k}'"));
                continue;
            };
            for (i, iv) in keys(&v, "interactions") {
                tone(&format!("{name} object.{k}.{i}"), &iv);
                if !own.contains(&i) {
                    unknown.push(format!("{name}: object '{k}' has no interaction '{i}'"));
                }
            }
        }
    }
    wrong.extend(unknown);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}
