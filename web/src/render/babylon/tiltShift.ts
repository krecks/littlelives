/**
 * Tilt-shift "miniature" blur: the top and bottom of the screen are softly blurred while a
 * horizontal band in the middle stays sharp, like a dollhouse photographed with a tilted lens.
 * One full-screen pass with a 8-tap golden-angle disc; unlike depth of field it needs no depth
 * pre-pass (which would draw the whole scene a second time).
 */

import { Constants, PostProcess, ShaderLanguage, ShaderStore, Texture, type AbstractEngine, type Camera } from '@babylonjs/core';

const GLSL = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 texel;
uniform float amount;
uniform float focus;
void main(void) {
  float r = amount * smoothstep(0.1, 0.5, abs(vUV.y - focus));
  vec4 sum = texture2D(textureSampler, vUV);
  float w = 1.0;
  if (r >= 0.25) {
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float a = fi * 2.39996;
      vec2 o = vec2(cos(a), sin(a)) * sqrt((fi + 0.5) / 8.0) * r * texel;
      sum += texture2D(textureSampler, vUV + o);
      w += 1.0;
    }
  }
  gl_FragColor = sum / w;
}
`;

// textureSampleLevel: WGSL only allows textureSample in uniform control flow.
const WGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform texel: vec2f;
uniform amount: f32;
uniform focus: f32;
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let r = uniforms.amount * smoothstep(0.1, 0.5, abs(input.vUV.y - uniforms.focus));
  var sum = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0);
  var w = 1.0;
  if (r >= 0.25) {
    for (var i = 0; i < 8; i++) {
      let fi = f32(i);
      let a = fi * 2.39996;
      let o = vec2f(cos(a), sin(a)) * sqrt((fi + 0.5) / 8.0) * r * uniforms.texel;
      sum += textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV + o, 0.0);
      w += 1.0;
    }
  }
  fragmentOutputs.color = sum / w;
}
`;

ShaderStore.ShadersStore['tiltShiftPixelShader'] ??= GLSL;
ShaderStore.ShadersStoreWGSL['tiltShiftPixelShader'] ??= WGSL;

export class TiltShift {
  private readonly pass: PostProcess;
  /** Maximum blur radius in pixels at 1080p (0 = off). */
  strength = 0;

  private attached = true;

  constructor(
    private readonly camera: Camera,
    engine: AbstractEngine,
    webgpu: boolean,
  ) {
    this.pass = new PostProcess(
      'tiltShift',
      'tiltShift',
      ['texel', 'amount', 'focus'],
      null,
      1,
      camera,
      Texture.BILINEAR_SAMPLINGMODE,
      engine,
      false,
      null,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
      undefined,
      undefined,
      false,
      undefined,
      webgpu ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
    );
    this.pass.onApply = (effect) => {
      const w = this.pass.width;
      const h = this.pass.height;
      effect.setFloat2('texel', 1 / w, 1 / h);
      effect.setFloat('amount', (this.strength * h) / 1080);
      effect.setFloat('focus', 0.52);
    };
  }

  set enabled(on: boolean) {
    // A disabled pass is detached from the camera entirely (no extra full-screen draw).
    if (on === this.attached) return;
    this.attached = on;
    if (on) this.camera.attachPostProcess(this.pass);
    else this.camera.detachPostProcess(this.pass);
  }
}
