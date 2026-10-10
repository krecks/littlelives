//! Where does Paradee-8M's time go in `tract` 0.23.8, and what do tract-side fixes buy?
//!
//! cargo run --release -- <mode>
//!   phon       phoneme counts of the test lines
//!   now        what `crates/voice` does today: clone + into_runnable per call, InferenceModel
//!   cached     InferenceModel plan built once (symbolic length), reused
//!   typed      into_typed + declutter (symbolic), reused
//!   optimized  into_typed + into_optimized (symbolic), reused (expected to fail on Range)
//!   concrete   per call: concrete token count -> typed -> optimized -> run
//!   profile-<plan>   per-node timing for `cached` or `typed`, grouped by block and op

use std::collections::BTreeMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tract_onnx::pb::{
    AttributeProto, ModelProto, NodeProto, TensorShapeProto, TypeProto, ValueInfoProto, attribute_proto::AttributeType,
    tensor_proto::DataType, tensor_shape_proto::Dimension, tensor_shape_proto::dimension, type_proto,
};
use tract_onnx::prelude::*;
use tract_onnx::tract_core::plan::{SimplePlan, SimpleState};

pub const LINES: &[&str] = &[
    "Hello there!",
    "Oh, you won't believe it!",
    "Hello there! I don't think we've met.",
    "I'm so hungry, I could eat a whole pizza by myself.",
    "What a lovely garden! I should water the roses before it gets too dark.",
];

fn voice_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../web/public/voice")
}

fn g2p() -> voice::G2p {
    let mut tsv = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(voice_dir().join("en-us.lexz")).unwrap())
        .read_to_string(&mut tsv)
        .unwrap();
    voice::G2p::new(voice::Lexicon::parse(&tsv))
}

fn vocab() -> std::collections::HashMap<char, i64> {
    let config: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(voice_dir().join("paradee-8m.json")).unwrap()).unwrap();
    config["vocab"].as_object().unwrap().iter().map(|(k, v)| (k.chars().next().unwrap(), v.as_i64().unwrap())).collect()
}

fn ids_for(g2p: &voice::G2p, vocab: &std::collections::HashMap<char, i64>, line: &str) -> Vec<i64> {
    let ph = g2p.phonemize(line);
    let mut ids = vec![0];
    ids.extend(ph.chars().filter_map(|c| vocab.get(&c).copied()));
    ids.push(0);
    ids
}

fn load_proto() -> ModelProto {
    let path = std::env::var("MODEL").map(PathBuf::from).unwrap_or(voice_dir().join("paradee-8m.onnx"));
    let onnx = std::fs::read(path).unwrap();
    let mut proto = tract_onnx::onnx().proto_model_for_read(&mut &onnx[..]).unwrap();
    patch(&mut proto);
    proto
}

fn inputs(ids: &[i64]) -> TVec<TValue> {
    let n = ids.len();
    let ids = tract_ndarray::Array2::from_shape_vec((1, n), ids.to_vec()).unwrap().into_tensor();
    tvec!(ids.into(), tensor1(&[1.0f32]).into(), tensor1(&[1.0f32]).into())
}

fn secs(t: Instant) -> f64 {
    t.elapsed().as_secs_f64()
}

fn main() {
    let mode = std::env::args().nth(1).unwrap_or("now".into());
    let reps: usize = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(3);
    let g2p = g2p();
    let vocab = vocab();
    let lines: Vec<(&str, Vec<i64>)> = LINES.iter().map(|l| (*l, ids_for(&g2p, &vocab, l))).collect();
    if mode == "ids" {
        let body: Vec<String> = lines.iter().map(|(l, ids)| format!("{:?}: {:?}", l, ids)).collect();
        println!("{{{}}}", body.join(", "));
        return;
    }
    if mode == "phon" {
        for (l, ids) in &lines {
            println!("{:3} chars {:3} tokens  {}  |{}|", l.len(), ids.len(), l, g2p.phonemize(l));
        }
        return;
    }
    let onnx = tract_onnx::onnx();
    let t = Instant::now();
    let proto = load_proto();
    let model = onnx.model_for_proto_model(&proto).unwrap();
    let model = model.with_input_fact(1, f32::fact([1]).into()).unwrap().with_input_fact(2, f32::fact([1]).into()).unwrap();
    eprintln!("parse: {:.3} s", secs(t));

    match mode.as_str() {
        "now" => {
            for (l, ids) in &lines {
                for _ in 0..reps {
                    let n = ids.len();
                    let t = Instant::now();
                    let plan = model.clone().with_input_fact(0, i64::fact([1, n]).into()).unwrap().into_runnable().unwrap();
                    let plan_s = secs(t);
                    let t2 = Instant::now();
                    let out = plan.run(inputs(ids)).unwrap();
                    let run_s = secs(t2);
                    report(l, n, &out, plan_s, run_s);
                }
            }
        }
        "cached" | "profile-cached" => {
            let t = Instant::now();
            let plan = model
                .clone()
                .with_input_fact(0, InferenceFact::dt(i64::datum_type()))
                .unwrap()
                .into_runnable()
                .unwrap();
            eprintln!("plan once: {:.3} s", secs(t));
            run_plan(&plan, &lines, reps, mode.starts_with("profile"));
        }
        "typed" | "profile-typed" | "optimized" | "profile-optimized" => {
            let t = Instant::now();
            let typed = model.clone().into_typed().unwrap();
            eprintln!("into_typed: {:.3} s", secs(t));
            let t = Instant::now();
            let typed = if mode.ends_with("optimized") {
                match typed.clone().into_optimized() {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("into_optimized FAILED after {:.3} s: {e:?}", secs(t));
                        return;
                    }
                }
            } else {
                typed.into_decluttered().unwrap()
            };
            eprintln!("declutter/optimize: {:.3} s, {} nodes", secs(t), typed.nodes().len());
            let t = Instant::now();
            let plan = typed.into_runnable().unwrap();
            eprintln!("into_runnable: {:.3} s", secs(t));
            run_plan(&plan, &lines, reps, mode.starts_with("profile"));
        }
        "concrete" => {
            for (l, ids) in &lines {
                let n = ids.len();
                let t = Instant::now();
                let m = model.clone().with_input_fact(0, i64::fact([1, n]).into()).unwrap();
                let typed = match m.into_typed().and_then(|m| m.into_optimized()) {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("concrete optimize FAILED after {:.3} s: {e:?}", secs(t));
                        return;
                    }
                };
                let plan = typed.into_runnable().unwrap();
                let plan_s = secs(t);
                let t2 = Instant::now();
                let out = plan.run(inputs(ids)).unwrap();
                report(l, n, &out, plan_s, secs(t2));
            }
        }
        "split" | "split-profile" => split(&lines, reps, mode == "split-profile"),
        _ => panic!("unknown mode {mode}"),
    }
}

fn read_proto(path: &str, patch_it: bool) -> ModelProto {
    let onnx = std::fs::read(path).unwrap();
    let mut proto = tract_onnx::onnx().proto_model_for_read(&mut &onnx[..]).unwrap();
    if patch_it {
        patch(&mut proto);
    }
    proto
}

/// Two halves (see `split.py`), each typed and optimised once with a symbolic length; the
/// alignment (repeat each token's features for its duration) is done here.
fn split(lines: &[(&str, Vec<i64>)], reps: usize, profile: bool) {
    let onnx = tract_onnx::onnx();
    let t = Instant::now();
    let a_base = onnx.model_for_proto_model(&read_proto(&std::env::var("MODEL_A").unwrap(), false)).unwrap();
    let make_a = |n: usize| {
        let t = Instant::now();
        let a = a_base
            .clone()
            .with_input_fact(0, i64::fact([1, n]).into())
            .unwrap()
            .with_input_fact(1, f32::fact([1]).into())
            .unwrap();
        (best_typed("A", a).into_runnable().unwrap(), secs(t))
    };
    let a_secs = secs(t);
    let b_base = onnx.model_for_proto_model(&read_proto(&std::env::var("MODEL_B").unwrap(), true)).unwrap();
    let concrete_b = std::env::var("CONCRETE_B").is_ok();
    // B for a frame count: a concrete number (re-optimised per line) or a symbol (once).
    let make_b = |frames: Option<usize>| {
        let t = Instant::now();
        let mut b = b_base.clone();
        let f: TDim = match frames {
            Some(n) => n.to_dim(),
            None => b.symbols.sym("F").to_dim(),
        };
        b = b
            .with_input_fact(0, f32::fact(&[1.to_dim(), 224.to_dim(), f.clone()]).into())
            .unwrap()
            .with_input_fact(1, f32::fact(&[1.to_dim(), 512.to_dim(), f]).into())
            .unwrap()
            .with_input_fact(2, f32::fact([1]).into())
            .unwrap();
        let b = best_typed("B", b).into_runnable().unwrap();
        (b, secs(t))
    };
    eprintln!("A typed once: {a_secs:.3} s");
    let symbolic_b = if concrete_b { None } else { Some(make_b(None).0) };
    for (l, ids) in lines {
        for rep in 0..reps {
            let n = ids.len();
            let (a, plan_a) = make_a(n);
            eprintln!("  A planned for {n} tokens in {plan_a:.3} s");
            let t = Instant::now();
            let ids_t = tract_ndarray::Array2::from_shape_vec((1, n), ids.to_vec()).unwrap().into_tensor();
            let out_a = a.run(tvec!(ids_t.into(), tensor1(&[1.0f32]).into())).unwrap();
            let ta = secs(t);
            let d = out_a[0].to_plain_array_view::<f32>().unwrap(); // [1, 224, T]
            let t_en = out_a[1].to_plain_array_view::<f32>().unwrap(); // [1, 512, T]
            let dur = out_a[2].cast_to::<i64>().unwrap().into_owned();
            let dur = dur.to_plain_array_view::<i64>().unwrap();
            let frames: usize = dur.iter().map(|&x| x as usize).sum();
            let mut token_of = Vec::with_capacity(frames);
            for (i, &k) in dur.iter().enumerate() {
                token_of.extend(std::iter::repeat_n(i, k as usize));
            }
            let expand = |x: &tract_ndarray::ArrayViewD<f32>, c: usize| {
                let mut out = tract_ndarray::Array3::<f32>::zeros((1, c, frames));
                for ch in 0..c {
                    for (fi, &ti) in token_of.iter().enumerate() {
                        out[[0, ch, fi]] = x[[0, ch, ti]];
                    }
                }
                out.into_tensor()
            };
            let en = expand(&d, 224);
            let asr = expand(&t_en, 512);
            let (b, plan_b) = match &symbolic_b {
                Some(b) => (b.clone(), 0.0),
                None => make_b(Some(frames)),
            };
            if plan_b > 0.0 {
                eprintln!("  B planned for {frames} frames in {plan_b:.3} s");
            }
            let t2 = Instant::now();
            let inputs_b = tvec!(en.into(), asr.into(), tensor1(&[1.0f32]).into());
            let out = if profile && rep == reps - 1 {
                let mut by_block: BTreeMap<&'static str, f64> = BTreeMap::new();
                let mut by_op: BTreeMap<String, f64> = BTreeMap::new();
                let mut state = SimpleState::new(&b).unwrap();
                let out = state
                    .run_plan_with_eval(inputs_b, |ctx, st, node, input| {
                        let t = Instant::now();
                        let r = tract_onnx::tract_core::plan::eval(ctx, st, node, input);
                        *by_block.entry(block(&node.name)).or_default() += secs(t);
                        *by_op.entry(node.op().name().to_string()).or_default() += secs(t);
                        r
                    })
                    .unwrap();
                println!("  B by block: {:?}", by_block.iter().map(|(k, v)| format!("{k}: {:.1} ms", v * 1e3)).collect::<Vec<_>>());
                let mut ops: Vec<_> = by_op.into_iter().collect();
                ops.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                println!("  B by op: {:?}", ops.iter().take(10).map(|(k, v)| format!("{k}: {:.1} ms", v * 1e3)).collect::<Vec<_>>());
                out
            } else {
                b.run(inputs_b).unwrap()
            };
            let tb = secs(t2);
            let audio = out[0].len() as f64 / 24000.0;
            println!(
                "{:3} chars {:3} tok {frames:4} frames audio {audio:.2} s  A {:.3} s  align {:.3} s  B {:.3} s  total {:.3} s  {:.1}x RT",
                l.len(),
                n,
                ta,
                secs(t) - ta - tb,
                tb,
                secs(t),
                audio / secs(t)
            );
        }
    }
}

fn report(line: &str, n: usize, out: &TVec<TValue>, plan_s: f64, run_s: f64) {
    let samples = out[0].len();
    let audio = samples as f64 / 24000.0;
    println!(
        "{:3} chars {:3} tok  audio {:.2} s  plan {:.3} s  run {:.3} s  total {:.3} s  {:.1}x RT   {line}",
        line.len(),
        n,
        audio,
        plan_s,
        run_s,
        plan_s + run_s,
        audio / (plan_s + run_s)
    );
}

fn block(name: &str) -> &'static str {
    let n = name.trim_start_matches('/');
    let first = n.split('/').next().unwrap_or("");
    let head = first.split('.').next().unwrap_or("");
    if n.starts_with("ds/generator") {
        "5 generator (vocoder+iSTFT)"
    } else if n.starts_with("ds/") {
        "4 decoder (encode/decode AdaIN)"
    } else if head == "bert" || head == "bert_encoder" {
        "1 plbert (ALBERT)"
    } else if matches!(head, "lstms" | "lstm" | "duration_proj" | "shared" | "F0" | "N" | "F0_proj" | "N_proj") {
        "2 prosody (dur, F0, N)"
    } else if matches!(head, "embedding" | "cnn" | "lstm_1" | "asr_proj") {
        "3 text encoder"
    } else if head == "lock" {
        "6 lock"
    } else if first.contains("DequantizeLinear") || first.starts_with("Cast") || first.contains("DequantizeLinear") {
        "0 weights dequant/cast"
    } else {
        "7 glue (align, shapes)"
    }
}

fn run_plan<F, O>(plan: &Arc<SimplePlan<F, O>>, lines: &[(&str, Vec<i64>)], reps: usize, profile: bool)
where
    F: Fact + Clone + 'static,
    O: std::fmt::Debug + std::fmt::Display + AsRef<dyn Op> + AsMut<dyn Op> + Clone + 'static,
{
    for (l, ids) in lines {
        let mut by_block: BTreeMap<&'static str, f64> = BTreeMap::new();
        let mut by_op: BTreeMap<String, (f64, usize)> = BTreeMap::new();
        let mut by_node: Vec<(String, String, f64)> = Vec::new();
        for rep in 0..reps {
            let t = Instant::now();
            let mut state = SimpleState::new(plan).unwrap();
            let out = if profile && rep == reps - 1 {
                state
                    .run_plan_with_eval(inputs(ids), |ctx, st, node, input| {
                        let t = Instant::now();
                        let r = tract_onnx::tract_core::plan::eval(ctx, st, node, input);
                        let dt = secs(t);
                        let op = node.op().name().to_string();
                        *by_block.entry(block(&node.name)).or_default() += dt;
                        let e = by_op.entry(op.clone()).or_default();
                        e.0 += dt;
                        e.1 += 1;
                        by_node.push((node.name.clone(), op, dt));
                        r.map_err(|e| e)
                    })
                    .unwrap()
            } else {
                state.run(inputs(ids)).unwrap()
            };
            report(l, ids.len(), &out, 0.0, secs(t));
        }
        if profile {
            let total: f64 = by_block.values().sum();
            println!("  by block (profiled run, sum {total:.3} s):");
            for (b, s) in &by_block {
                println!("    {b:34} {:7.1} ms {:5.1}%", s * 1e3, 100.0 * s / total);
            }
            let mut ops: Vec<_> = by_op.into_iter().collect();
            ops.sort_by(|a, b| b.1.0.partial_cmp(&a.1.0).unwrap());
            println!("  by op:");
            for (op, (s, c)) in ops.iter().take(14) {
                println!("    {op:34} {:7.1} ms {:5.1}%  x{c}", s * 1e3, 100.0 * s / total);
            }
            by_node.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
            println!("  top nodes:");
            for (n, op, s) in by_node.iter().take(12) {
                println!("    {:6.1} ms  {op:22} {n}", s * 1e3);
            }
        }
    }
}

/// The most optimised form tract manages: optimized, else decluttered, else plain typed.
fn best_typed(name: &str, m: InferenceModel) -> TypedModel {
    let short = |e: &TractError| format!("{e:?}").lines().take(9).collect::<Vec<_>>().join(" | ");
    let typed = m.into_typed().unwrap_or_else(|e| panic!("{name}: into_typed failed: {}", short(&e)));
    if std::env::var("NO_OPT").is_err() {
        match typed.clone().into_optimized() {
            Ok(m) => {
                eprintln!("{name}: optimized");
                return m;
            }
            Err(e) => eprintln!("{name}: into_optimized failed: {}", short(&e)),
        }
    }
    match typed.clone().into_decluttered() {
        Ok(m) => {
            eprintln!("{name}: decluttered");
            m
        }
        Err(e) => {
            eprintln!("{name}: declutter failed: {}; using plain typed", short(&e));
            typed
        }
    }
}

/// Same edits as `crates/voice/src/model.rs`.
fn patch(proto: &mut ModelProto) {
    let graph = proto.graph.as_mut().unwrap();
    for node in graph.node.iter_mut().filter(|n| n.op_type.starts_with("Random")) {
        node.attribute.retain(|a| a.name != "seed");
        node.attribute.push(AttributeProto {
            name: "seed".into(),
            r#type: AttributeType::Float as i32,
            f: 1234.0,
            ..Default::default()
        });
    }
    let at = graph.node.iter().position(|n| n.name == "/F0_proj/Conv").unwrap();
    let f0 = graph.node[at].output[0].clone();
    let scaled = format!("{f0}_pitch");
    for node in &mut graph.node {
        for input in &mut node.input {
            if *input == f0 {
                *input = scaled.clone();
            }
        }
    }
    graph.node.insert(
        at + 1,
        NodeProto {
            name: "/pitch_scale".into(),
            op_type: "Mul".into(),
            input: vec![f0, "pitch".into()],
            output: vec![scaled],
            ..Default::default()
        },
    );
    graph.input.push(ValueInfoProto {
        name: "pitch".into(),
        r#type: Some(TypeProto {
            value: Some(type_proto::Value::TensorType(type_proto::Tensor {
                elem_type: DataType::Float as i32,
                shape: Some(TensorShapeProto {
                    dim: vec![Dimension { value: Some(dimension::Value::DimValue(1)), ..Default::default() }],
                }),
            })),
            ..Default::default()
        }),
        ..Default::default()
    });
}
