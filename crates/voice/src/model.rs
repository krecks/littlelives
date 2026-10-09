//! Paradee-8M (Kokoro-82M distilled to 8M parameters, Apache-2.0,
//! <https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0>), run with `tract`.
//!
//! Before parsing, the ONNX graph gets two small edits:
//! - a `pitch` input that multiplies the predicted pitch curve (`/F0_proj/Conv`), so one voice
//!   can be made higher or lower per resident;
//! - a fixed seed on the noise generators, so the same line always gives the same audio.

use std::collections::HashMap;

use tract_onnx::pb::{
    AttributeProto, ModelProto, NodeProto, TensorShapeProto, TypeProto, ValueInfoProto, attribute_proto::AttributeType,
    tensor_proto::DataType, tensor_shape_proto::Dimension, tensor_shape_proto::dimension, type_proto,
};
use tract_onnx::prelude::*;

pub const SAMPLE_RATE: u32 = 24_000;
/// The model takes at most this many phoneme ids, plus a pad at each end.
const MAX_PHONEMES: usize = 510;
const PITCH_NODE: &str = "/F0_proj/Conv";
const NOISE_SEED: f32 = 1234.0;

pub struct Model {
    model: InferenceModel,
    vocab: HashMap<char, i64>,
}

impl Model {
    /// `onnx`: `paradee_int8.onnx`; `config_json`: the model's `config.json` (its phoneme ids).
    pub fn load(onnx: &[u8], config_json: &str) -> Result<Model, String> {
        let config: serde_json::Value = serde_json::from_str(config_json).map_err(|e| format!("config: {e}"))?;
        let vocab = config["vocab"]
            .as_object()
            .ok_or("config: no vocab")?
            .iter()
            .filter_map(|(k, v)| Some((k.chars().next()?, v.as_i64()?)))
            .collect();
        let onnx_fw = tract_onnx::onnx();
        let mut proto = onnx_fw.proto_model_for_read(&mut &onnx[..]).map_err(|e| format!("model: {e}"))?;
        patch(&mut proto)?;
        let model = onnx_fw.model_for_proto_model(&proto).map_err(|e| format!("model: {e:?}"))?;
        Ok(Model { model, vocab })
    }

    /// 24 kHz mono audio for a Misaki phoneme string. Characters the model doesn't know are
    /// skipped; long input is cut at 510 phonemes.
    pub fn speak(&self, phonemes: &str, voice: crate::VoiceParams) -> Result<Vec<f32>, String> {
        let mut ids: Vec<i64> = Vec::with_capacity(phonemes.len() + 2);
        ids.push(0);
        ids.extend(phonemes.chars().filter_map(|c| self.vocab.get(&c).copied()).take(MAX_PHONEMES));
        ids.push(0);
        if ids.len() <= 2 {
            return Ok(Vec::new());
        }
        let n = ids.len();
        let run = || -> TractResult<Vec<f32>> {
            let plan = self
                .model
                .clone()
                .with_input_fact(0, i64::fact([1, n]).into())?
                .with_input_fact(1, f32::fact([1]).into())?
                .with_input_fact(2, f32::fact([1]).into())?
                .into_runnable()?;
            let ids = tract_ndarray::Array2::from_shape_vec((1, n), ids)?.into_tensor();
            let speed = tensor1(&[voice.speed.clamp(0.5, 2.0)]);
            let pitch = tensor1(&[voice.pitch.clamp(0.4, 2.0)]);
            let out = plan.run(tvec!(ids.into(), speed.into(), pitch.into()))?;
            let wave = out[0].clone().into_tensor();
            Ok(wave.to_plain_array_view::<f32>()?.iter().copied().collect())
        };
        run().map_err(|e| format!("speak: {e:?}"))
    }
}

fn patch(proto: &mut ModelProto) -> Result<(), String> {
    let graph = proto.graph.as_mut().ok_or("model: no graph")?;
    for node in graph.node.iter_mut().filter(|n| n.op_type.starts_with("Random")) {
        node.attribute.retain(|a| a.name != "seed");
        node.attribute.push(AttributeProto {
            name: "seed".into(),
            r#type: AttributeType::Float as i32,
            f: NOISE_SEED,
            ..Default::default()
        });
    }
    let at = graph.node.iter().position(|n| n.name == PITCH_NODE).ok_or("model: no pitch curve node")?;
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
    Ok(())
}
