/**
 * Character materials: PBR plus a plugin that reads each Sim's appearance from the shared pose
 * texture (the same texture that holds the skinning matrices; one row per Sim) and a per-vertex
 * `simField` attribute (see tools/characters/garments.py):
 *
 * - body: tints the skin, and discards skin well inside the Sim's clothes (the garment shells are
 *   separate meshes; their coverage uses the same fields, so skin never pokes through);
 * - cloth: colours garment shells with the Sim's top / bottom / shoe colours, soft cloth folds
 *   (normal map in the body's UV layout), a woven fabric normal, hem bands and stitching, sheen;
 * - hair (and brows): tints a greyscale strand texture with the hair colour; strand tips are cut
 *   (alpha-tested) along the hair's open edges;
 * - lid: eyelids in the skin colour with a dark lash line at the margin.
 *
 * Row layout (RGBA32F texels): bones * 4 matrix texels, then `APPEARANCE_TEXELS` texels:
 *   0: skin colour rgb (linear), top: sleeve cut
 *   1: top colour rgb, top: hem height
 *   2: bottom colour rgb, top: crew neckline cut
 *   3: hair colour rgb, top: scoop neckline cut
 *   4: shoe colour rgb, bottom: waist height
 *   5: the body texture's median skin colour rgb (the skin is tinted relative to it), bottom: leg cut
 *   6: trim colour rgb (soles, waistbands), shoes: top height
 *   7: unused
 * Disabled cuts are -10 (or +10 for "below" cuts) so their predicate always / never holds.
 */

import {
  MaterialPluginBase,
  ShaderLanguage,
  type AbstractEngine,
  type BaseTexture,
  type Material,
  type MaterialDefines,
  type Nullable,
  type Scene,
  type SubMesh,
  type UniformBuffer,
} from '@babylonjs/core';

export const APPEARANCE_TEXELS = 8;

export type CharacterSurface = 'body' | 'cloth' | 'hair' | 'lid' | 'plain';

let pendingKind: CharacterSurface = 'plain';
let pendingOffset = 0;

export class CharacterPlugin extends MaterialPluginBase {
  private readonly kind: CharacterSurface;
  /** First appearance texel in a row (bones * 4). */
  private readonly offset: number;

  constructor(
    material: Material,
    kind: CharacterSurface,
    offset: number,
    private readonly data: BaseTexture,
    private readonly fabric: BaseTexture | null,
  ) {
    // The base constructor asks for the shader code before the fields exist.
    pendingKind = kind;
    pendingOffset = offset;
    super(
      material,
      'SimCharacter',
      230,
      {
        SIMCHAR: false,
        SIMBODY: false,
        SIMCLOTH: false,
        SIMHAIR: false,
        SIMLID: false,
      },
      true,
      true,
    );
    this.kind = kind;
    this.offset = offset;
  }

  private get k(): CharacterSurface {
    return this.kind ?? pendingKind;
  }

  override getClassName(): string {
    return 'SimCharacterPlugin';
  }

  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: MaterialDefines): void {
    const kind = this.k;
    defines.SIMCHAR = true;
    defines.SIMBODY = kind === 'body';
    defines.SIMCLOTH = kind === 'cloth';
    defines.SIMHAIR = kind === 'hair';
    defines.SIMLID = kind === 'lid';
  }

  override getAttributes(attributes: string[]): void {
    attributes.push('simField');
  }

  override isReadyForSubMesh(): boolean {
    return this.data.isReady() && (!this.fabric || this.fabric.isReady());
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('simDataTexture');
    if (this.k === 'cloth') samplers.push('simFabricSampler');
  }

  override getActiveTextures(textures: BaseTexture[]): void {
    if (this.fabric) textures.push(this.fabric);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.fabric || texture === this.data;
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    ubo.setTexture('simDataTexture', this.data);
    if (this.fabric) ubo.setTexture('simFabricSampler', this.fabric);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): Nullable<{ [pointName: string]: string }> {
    const off = this.offset ?? pendingOffset;
    return shaderLanguage === ShaderLanguage.WGSL ? wgsl(shaderType, off) : glsl(shaderType, off);
  }
}

const GUARD = '#if defined(SIMCHAR) && defined(INSTANCES) && defined(BAKED_VERTEX_ANIMATION_TEXTURE)';
/** Body skin is discarded this far (m) inside a garment's coverage; the shell hides the rest. */
const MARGIN = '0.02';

function wgsl(shaderType: string, off: number): { [pointName: string]: string } {
  if (shaderType === 'vertex') {
    return {
      CUSTOM_VERTEX_DEFINITIONS: `${GUARD}\nattribute simField: vec4f;\nvarying vSimSlot: f32;\nvarying vSimField: vec4f;\n#endif\n`,
      CUSTOM_VERTEX_MAIN_END: `${GUARD}\nvertexOutputs.vSimSlot = vertexInputs.bakedVertexAnimationSettingsInstanced.x;\nvertexOutputs.vSimField = vertexInputs.simField;\n#endif\n`,
    };
  }
  return {
    CUSTOM_FRAGMENT_DEFINITIONS: `${GUARD}
varying vSimSlot: f32;
varying vSimField: vec4f;
var simDataTexture: texture_2d<f32>;
#ifdef SIMCLOTH
var simFabricSamplerSampler: sampler;
var simFabricSampler: texture_2d<f32>;
#endif
fn simHash(n: f32) -> f32 { return fract(sin(n * 12.9898) * 43758.5453); }
#endif
`,
    CUSTOM_FRAGMENT_MAIN_BEGIN: `${GUARD}
let simRow = i32(fragmentInputs.vSimSlot + 0.5);
let simF = fragmentInputs.vSimField;
let simA = textureLoad(simDataTexture, vec2<i32>(${off}, simRow), 0);
#ifdef SIMBODY
{
  let c1 = textureLoad(simDataTexture, vec2<i32>(${off + 1}, simRow), 0).w;
  let c2 = textureLoad(simDataTexture, vec2<i32>(${off + 2}, simRow), 0).w;
  let c3 = textureLoad(simDataTexture, vec2<i32>(${off + 3}, simRow), 0).w;
  let c4 = textureLoad(simDataTexture, vec2<i32>(${off + 4}, simRow), 0).w;
  let c5 = textureLoad(simDataTexture, vec2<i32>(${off + 5}, simRow), 0).w;
  let c6 = textureLoad(simDataTexture, vec2<i32>(${off + 6}, simRow), 0).w;
  let top = min(min((simA.w - simF.x) * 0.55, simF.y - c1), min(simF.z - c2, simF.w - c3));
  let bottom = min(min(c4 - simF.y, simF.y - c5), (-0.5 - simF.x) * 0.55);
  let shoe = c6 - simF.y;
  if (max(top, max(bottom, shoe)) > ${MARGIN}) { discard; }
}
#endif
#ifdef SIMHAIR
// Strand tips: ragged alpha cut along the hair's open edges.
if (simF.x < 0.016 * simHash(floor(fragmentInputs.vAlbedoUV.x * 310.0) + floor(fragmentInputs.vAlbedoUV.y * 7.0) * 17.0)) { discard; }
let simHair = textureLoad(simDataTexture, vec2<i32>(${off + 3}, simRow), 0);
#endif
#ifdef SIMCLOTH
let simFab = textureSample(simFabricSampler, simFabricSamplerSampler, fragmentInputs.vMainUV1 * 46.0);
let simSkirt = step(2.5, simF.y);
#endif
#endif
`,
    CUSTOM_FRAGMENT_UPDATE_ALPHA: `${GUARD}
#ifdef SIMBODY
{
  let simRef = textureLoad(simDataTexture, vec2<i32>(${off + 5}, simRow), 0);
  // Skin: the Sim's colour, keeping the texture's shading and part of its hue variation
  // (lips, cheeks, stubble) relative to its median skin colour.
  let simRel = clamp(surfaceAlbedo / max(simRef.rgb, vec3f(0.01)), vec3f(0.0), vec3f(2.0));
  let simRelL = dot(simRel, vec3f(0.2126, 0.7152, 0.0722));
  surfaceAlbedo = simA.rgb * mix(vec3f(simRelL), simRel, 0.6);
  // Inside of the mouth (sleeve field -3 on the slit's inner faces).
  surfaceAlbedo = mix(surfaceAlbedo, vec3f(0.06, 0.012, 0.012), smoothstep(-1.3, -2.4, simF.x));
}
#endif
#ifdef SIMCLOTH
{
  let cTop = textureLoad(simDataTexture, vec2<i32>(${off + 1}, simRow), 0).rgb;
  let cBot = textureLoad(simDataTexture, vec2<i32>(${off + 2}, simRow), 0).rgb;
  let cShoe = textureLoad(simDataTexture, vec2<i32>(${off + 4}, simRow), 0).rgb;
  let cTrim = textureLoad(simDataTexture, vec2<i32>(${off + 6}, simRow), 0).rgb;
  var col = select(select(cShoe, cBot, simF.z < 1.5), cTop, simF.z < 0.5);
  // Part flags only mean something within their garment (they interpolate at part borders).
  col = mix(col, cTrim, step(1.5, simF.z) * smoothstep(0.4, 0.6, simF.y));
  col = mix(col, cBot * 0.8, step(0.5, simF.z) * step(simF.z, 1.5) * smoothstep(1.4, 1.6, simF.y) * (1.0 - step(2.5, simF.y)));
  // Hem band and a stitch line; the weave; soft pleats on skirts.
  let hem = simF.x;
  let band = 1.0 - 0.1 * (1.0 - smoothstep(0.006, 0.016, hem));
  let stitch = select(1.0 - 0.22 * (1.0 - smoothstep(0.0004, 0.0013, abs(hem - 0.011))), 1.0, simF.z > 1.5);
  let pleat = 1.0 - simSkirt * 0.08 * (0.5 + 0.5 * sin(fragmentInputs.vMainUV1.x * 125.6));
  surfaceAlbedo = col * band * stitch * pleat * (0.9 + simFab.b * 0.2);
}
#endif
#ifdef SIMHAIR
surfaceAlbedo = surfaceAlbedo * simHair.rgb;
#endif
#ifdef SIMLID
{
  // Eyelid: skin colour (a touch darker, in the socket's shade), lash line at the margin, crease.
  let lowerLid = step(1.5, simF.x);
  let v = simF.x - 2.0 * lowerLid;
  let lash = (1.0 - smoothstep(0.02, 0.16 - 0.08 * lowerLid, v)) * (1.0 - 0.75 * lowerLid);
  let cr = (v - 0.62) / 0.12;
  let crease = 1.0 - 0.12 * exp(-cr * cr);
  surfaceAlbedo = mix(simA.rgb * mix(0.86, 0.66, v) * crease, vec3f(0.018, 0.012, 0.01), lash * 0.94);
}
#endif
#endif
`,
    // Clothes: cloth folds (the bump map) with the fabric weave on top; skirts skip the body folds.
    '!normalW=perturbNormal\\(TBN,(TEXRD\\(bumpSampler[^;]*?\\))\\.xyz,uniforms\\.vBumpInfos\\.y\\);': `
#if defined(SIMCHAR) && defined(SIMCLOTH) && defined(INSTANCES) && defined(BAKED_VERTEX_ANIMATION_TEXTURE)
normalW=perturbNormal(TBN,vec3f(mix($1.xy, vec2f(0.5), simSkirt) + (simFab.rg - vec2f(0.5)) * 0.5, 1.0),uniforms.vBumpInfos.y);
#else
normalW=perturbNormal(TBN,$1.xyz,uniforms.vBumpInfos.y);
#endif
`,
  };
}

function glsl(shaderType: string, off: number): { [pointName: string]: string } {
  if (shaderType === 'vertex') {
    return {
      CUSTOM_VERTEX_DEFINITIONS: `${GUARD}\nattribute vec4 simField;\nvarying float vSimSlot;\nvarying vec4 vSimField;\n#endif\n`,
      CUSTOM_VERTEX_MAIN_END: `${GUARD}\nvSimSlot = bakedVertexAnimationSettingsInstanced.x;\nvSimField = simField;\n#endif\n`,
    };
  }
  return {
    CUSTOM_FRAGMENT_DEFINITIONS: `${GUARD}
varying float vSimSlot;
varying vec4 vSimField;
uniform highp sampler2D simDataTexture;
#ifdef SIMCLOTH
uniform sampler2D simFabricSampler;
#endif
float simHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
#endif
`,
    CUSTOM_FRAGMENT_MAIN_BEGIN: `${GUARD}
int simRow = int(vSimSlot + 0.5);
vec4 simF = vSimField;
vec4 simA = texelFetch(simDataTexture, ivec2(${off}, simRow), 0);
#ifdef SIMBODY
{
  float c1 = texelFetch(simDataTexture, ivec2(${off + 1}, simRow), 0).w;
  float c2 = texelFetch(simDataTexture, ivec2(${off + 2}, simRow), 0).w;
  float c3 = texelFetch(simDataTexture, ivec2(${off + 3}, simRow), 0).w;
  float c4 = texelFetch(simDataTexture, ivec2(${off + 4}, simRow), 0).w;
  float c5 = texelFetch(simDataTexture, ivec2(${off + 5}, simRow), 0).w;
  float c6 = texelFetch(simDataTexture, ivec2(${off + 6}, simRow), 0).w;
  float top = min(min((simA.w - simF.x) * 0.55, simF.y - c1), min(simF.z - c2, simF.w - c3));
  float bottom = min(min(c4 - simF.y, simF.y - c5), (-0.5 - simF.x) * 0.55);
  float shoe = c6 - simF.y;
  if (max(top, max(bottom, shoe)) > ${MARGIN}) { discard; }
}
#endif
#ifdef SIMHAIR
if (simF.x < 0.016 * simHash(floor(vAlbedoUV.x * 310.0) + floor(vAlbedoUV.y * 7.0) * 17.0)) { discard; }
vec4 simHair = texelFetch(simDataTexture, ivec2(${off + 3}, simRow), 0);
#endif
#ifdef SIMCLOTH
vec4 simFab = texture2D(simFabricSampler, vMainUV1 * 46.0);
float simSkirt = step(2.5, simF.y);
#endif
#endif
`,
    CUSTOM_FRAGMENT_UPDATE_ALPHA: `${GUARD}
#ifdef SIMBODY
{
  vec4 simRef = texelFetch(simDataTexture, ivec2(${off + 5}, simRow), 0);
  vec3 simRel = clamp(surfaceAlbedo / max(simRef.rgb, vec3(0.01)), vec3(0.0), vec3(2.0));
  float simRelL = dot(simRel, vec3(0.2126, 0.7152, 0.0722));
  surfaceAlbedo = simA.rgb * mix(vec3(simRelL), simRel, 0.6);
  surfaceAlbedo = mix(surfaceAlbedo, vec3(0.06, 0.012, 0.012), smoothstep(-1.3, -2.4, simF.x));
}
#endif
#ifdef SIMCLOTH
{
  vec3 cTop = texelFetch(simDataTexture, ivec2(${off + 1}, simRow), 0).rgb;
  vec3 cBot = texelFetch(simDataTexture, ivec2(${off + 2}, simRow), 0).rgb;
  vec3 cShoe = texelFetch(simDataTexture, ivec2(${off + 4}, simRow), 0).rgb;
  vec3 cTrim = texelFetch(simDataTexture, ivec2(${off + 6}, simRow), 0).rgb;
  vec3 col = simF.z < 0.5 ? cTop : simF.z < 1.5 ? cBot : cShoe;
  col = mix(col, cTrim, step(1.5, simF.z) * smoothstep(0.4, 0.6, simF.y));
  col = mix(col, cBot * 0.8, step(0.5, simF.z) * step(simF.z, 1.5) * smoothstep(1.4, 1.6, simF.y) * (1.0 - step(2.5, simF.y)));
  float hem = simF.x;
  float band = 1.0 - 0.1 * (1.0 - smoothstep(0.006, 0.016, hem));
  float stitch = simF.z > 1.5 ? 1.0 : 1.0 - 0.22 * (1.0 - smoothstep(0.0004, 0.0013, abs(hem - 0.011)));
  float pleat = 1.0 - simSkirt * 0.08 * (0.5 + 0.5 * sin(vMainUV1.x * 125.6));
  surfaceAlbedo = col * band * stitch * pleat * (0.9 + simFab.b * 0.2);
}
#endif
#ifdef SIMHAIR
surfaceAlbedo = surfaceAlbedo * simHair.rgb;
#endif
#ifdef SIMLID
{
  float lowerLid = step(1.5, simF.x);
  float v = simF.x - 2.0 * lowerLid;
  float lash = (1.0 - smoothstep(0.02, 0.16 - 0.08 * lowerLid, v)) * (1.0 - 0.75 * lowerLid);
  float cr = (v - 0.62) / 0.12;
  float crease = 1.0 - 0.12 * exp(-cr * cr);
  surfaceAlbedo = mix(simA.rgb * mix(0.86, 0.66, v) * crease, vec3(0.018, 0.012, 0.01), lash * 0.94);
}
#endif
#endif
`,
    '!normalW=perturbNormal\\(TBN,(TEXRD\\(bumpSampler[^;]*?\\))\\.xyz,vBumpInfos\\.y\\);': `
#if defined(SIMCHAR) && defined(SIMCLOTH) && defined(INSTANCES) && defined(BAKED_VERTEX_ANIMATION_TEXTURE)
normalW=perturbNormal(TBN,vec3(mix($1.xy, vec2(0.5), simSkirt) + (simFab.rg - vec2(0.5)) * 0.5, 1.0),vBumpInfos.y);
#else
normalW=perturbNormal(TBN,$1.xyz,vBumpInfos.y);
#endif
`,
  };
}
