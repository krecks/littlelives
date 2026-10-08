/**
 * Moonlight grade: at night, moonlit tones lose their colour and turn blue-grey while warm,
 * lamp-lit pixels (windows, interiors, streetlight pools: red above blue) and very bright ones keep
 * their colour, so they pop.
 *
 * Why a pass: lawns and leaves reflect almost no blue, so a blue moon and sky fill alone render a
 * night as dark olive green, and Babylon's colour curves can only tint multiplicatively (a weak
 * filter that cannot create blue). One cheap full-screen pass after tone mapping (a single
 * texture read), attached only while it is getting dark.
 */

import { Constants, PostProcess, ShaderLanguage, ShaderStore, Texture, type AbstractEngine, type Camera } from '@babylonjs/core';

const GLSL = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float amount;
uniform vec3 tint;
void main(void) {
  vec4 c = texture2D(textureSampler, vUV);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float hi = max(c.r, max(c.g, c.b));
  float keep = max(smoothstep(0.02, 0.14, c.r - c.b) * smoothstep(0.08, 0.3, hi), smoothstep(0.62, 0.9, hi));
  vec3 moon = mix(vec3(l), c.rgb, 0.18) * tint;
  gl_FragColor = vec4(mix(c.rgb, mix(moon, c.rgb, keep), amount), c.a);
}
`;

const WGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform amount: f32;
uniform tint: vec3f;
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let c = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0);
  let l = dot(c.rgb, vec3f(0.299, 0.587, 0.114));
  let hi = max(c.r, max(c.g, c.b));
  let keep = max(smoothstep(0.02, 0.14, c.r - c.b) * smoothstep(0.08, 0.3, hi), smoothstep(0.62, 0.9, hi));
  let moon = mix(vec3f(l), c.rgb, 0.18) * uniforms.tint;
  fragmentOutputs.color = vec4f(mix(c.rgb, mix(moon, c.rgb, keep), uniforms.amount), c.a);
}
`;

ShaderStore.ShadersStore['nightGradePixelShader'] ??= GLSL;
ShaderStore.ShadersStoreWGSL['nightGradePixelShader'] ??= WGSL;

export class NightGrade {
  private readonly pass: PostProcess;
  private attached = true;
  /** 0 (off, detached) .. 1 (full moonlight grade). */
  amount = 0;
  /** Multiplier for the desaturated dark tones (linear-ish display RGB). */
  readonly tint: [number, number, number] = [0.8, 0.94, 1.45];

  constructor(
    private readonly camera: Camera,
    engine: AbstractEngine,
    webgpu: boolean,
  ) {
    this.pass = new PostProcess(
      'nightGrade',
      'nightGrade',
      ['amount', 'tint'],
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
      effect.setFloat('amount', this.amount);
      effect.setFloat3('tint', this.tint[0], this.tint[1], this.tint[2]);
    };
    this.update();
  }

  /** Attaches the pass while it has an effect, detaches it by day (no extra full-screen draw). */
  update(): void {
    const on = this.amount > 0.001;
    if (on === this.attached) return;
    this.attached = on;
    if (on) this.camera.attachPostProcess(this.pass);
    else this.camera.detachPostProcess(this.pass);
  }
}
