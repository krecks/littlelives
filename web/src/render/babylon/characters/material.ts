/**
 * Character materials: PBR plus a plugin that reads each Sim's appearance from the shared pose
 * texture (the same texture that holds the skinning matrices; one row per Sim) and a per-vertex
 * `simField` attribute (see tools/characters/garments.py):
 *
 * - body: tints the skin, and discards skin well inside the Sim's clothes (the garments are
 *   separate meshes; each one's coverage cut is fitted to the skin it hides, so skin never pokes
 *   through); under hair, the scalp (head skin whose crew field is -1 - scalp weight) takes the
 *   hair colour, so no skin shows between hair cards; torso skin between a top's hem and the
 *   waistband takes the top's colour (a shirt cut to tuck into high jeans over low shorts);
 * - cloth: MakeHuman's clothes (one texture atlas): tops and bottoms tint the atlas' greyscale
 *   detail with the Sim's top / bottom colours; shoes keep their own colours;
 * - hair: tints a greyscale strand texture with the hair colour; strand tips are cut
 *   (alpha-tested) along the hair's open edges;
 * - card: hair made of alpha-tested strand cards (MakeHuman's), tinted with the hair colour;
 * - brow: brow cards in the hair colour; lash: lashes;
 * - mouth: teeth and tongue, darker than they would be lit in the open (the mouth shades them);
 * - eye: the eyeballs, the iris tinted with the Sim's eye colour (fields: uv offset from the
 *   iris centre, iris radius, 1 / the iris' mean luminance).
 *
 * Face morphs (expressions, blinks, speech; see `MorphSet` in data.ts) are added to the vertex
 * position and normal before skinning, on meshes with a `simMorph` attribute: each Sim's row holds
 * up to `MORPH_PAIRS` (channel, weight) pairs after the appearance texels.
 *
 * Row layout (RGBA32F texels): bones * 4 matrix texels, then `APPEARANCE_TEXELS` texels:
 *   0: skin colour rgb (linear), top: sleeve cut
 *   1: top colour rgb, top: hem height
 *   2: bottom colour rgb, top: crew neckline cut
 *   3: hair colour rgb, top: scoop neckline cut
 *   4: (unused rgb), bottom: waist height
 *   5: the body texture's median skin colour rgb (the skin is tinted relative to it), bottom: leg cut
 *   6: (unused rgb), shoes: top height
 *   7: eye colour rgb, 1 if the Sim wears hair (the scalp takes the hair colour)
 * Disabled cuts are -10 (or +10 for "below" cuts) so their predicate always / never holds.
 * Then `MORPH_TEXELS` texels of (channel, weight, channel, weight); weight 0 = unused.
 */

import {
  MaterialPluginBase,
  ShaderLanguage,
  type AbstractEngine,
  type AbstractMesh,
  type BaseTexture,
  type Material,
  type MaterialDefines,
  type Nullable,
  type Scene,
  type SubMesh,
  type UniformBuffer,
} from '../core';

export const APPEARANCE_TEXELS = 8;
/** Face morph weights per Sim: (channel, weight) pairs, two per texel. */
export const MORPH_TEXELS = 12;
export const MORPH_PAIRS = MORPH_TEXELS * 2;

export type CharacterSurface = 'body' | 'cloth' | 'hair' | 'card' | 'brow' | 'lash' | 'mouth' | 'eye';

/** The set's morph texture and its layout (texels per row, header texels per part block). */
export interface MorphBinding {
  texture: BaseTexture;
  width: number;
  header: number;
}

let pendingKind: CharacterSurface = 'eye';
let pendingOffset = 0;
let pendingMorph: MorphBinding | null = null;

export class CharacterPlugin extends MaterialPluginBase {
  private readonly kind: CharacterSurface;
  /** First appearance texel in a row (bones * 4). */
  private readonly offset: number;

  constructor(
    material: Material,
    kind: CharacterSurface,
    offset: number,
    private readonly data: BaseTexture,
    private readonly morph: MorphBinding | null = null,
  ) {
    // The base constructor asks for the shader code before the fields exist.
    pendingKind = kind;
    pendingOffset = offset;
    pendingMorph = morph;
    super(
      material,
      'SimCharacter',
      230,
      {
        SIMCHAR: false,
        SIMBODY: false,
        SIMCLOTH: false,
        SIMHAIR: false,
        SIMBROW: false,
        SIMCARD: false,
        SIMEYE: false,
        SIMMOUTH: false,
        SIMMORPH: false,
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

  private get m(): MorphBinding | null {
    return this.morph === undefined ? pendingMorph : this.morph;
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    const kind = this.k;
    defines.SIMCHAR = true;
    defines.SIMBODY = kind === 'body';
    defines.SIMCLOTH = kind === 'cloth';
    defines.SIMHAIR = kind === 'hair';
    defines.SIMBROW = kind === 'brow';
    defines.SIMCARD = kind === 'card';
    defines.SIMEYE = kind === 'eye';
    defines.SIMMOUTH = kind === 'mouth';
    defines.SIMMORPH = !!this.m && mesh.isVerticesDataPresent('simMorph');
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    attributes.push('simField');
    if (this.m && mesh.isVerticesDataPresent('simMorph')) attributes.push('simMorph');
  }

  override isReadyForSubMesh(): boolean {
    return this.data.isReady() && (!this.morph || this.morph.texture.isReady());
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('simDataTexture');
    if (this.m) samplers.push('simMorphTexture');
  }

  override getActiveTextures(textures: BaseTexture[]): void {
    if (this.morph) textures.push(this.morph.texture);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.data || texture === this.morph?.texture;
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    ubo.setTexture('simDataTexture', this.data);
    if (this.morph) ubo.setTexture('simMorphTexture', this.morph.texture);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): Nullable<{ [pointName: string]: string }> {
    const off = this.offset ?? pendingOffset;
    const morph = this.m;
    return shaderLanguage === ShaderLanguage.WGSL ? wgsl(shaderType, off, morph) : glsl(shaderType, off, morph);
  }
}

const GUARD = '#if defined(SIMCHAR) && defined(INSTANCES) && defined(BAKED_VERTEX_ANIMATION_TEXTURE)';
/** Body skin is discarded this far (m) inside a garment's coverage; the shell hides the rest. */
const MARGIN = '0.02';

function wgsl(shaderType: string, off: number, morph: MorphBinding | null): { [pointName: string]: string } {
  if (shaderType === 'vertex') {
    const W = morph?.width ?? 1;
    const H = morph?.header ?? 0;
    const pairs = off + APPEARANCE_TEXELS;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `${GUARD}
attribute simField: vec4f;
varying vSimSlot: f32;
varying vSimField: vec4f;
#ifdef SIMMORPH
attribute simMorph: vec4f;
var simMorphTexture: texture_2d<f32>;
fn simMorphTexel(i: i32) -> vec4f { return textureLoad(simMorphTexture, vec2<i32>(i % ${W}, i / ${W}), 0); }
#endif
#endif
`,
      CUSTOM_VERTEX_UPDATE_POSITION: `${GUARD}
#ifdef SIMMORPH
let mRow = i32(vertexInputs.bakedVertexAnimationSettingsInstanced.x + 0.5);
// A first channel of -1: no morphs on this face this frame (too small on screen).
if (vertexInputs.simMorph.x >= 0.0 && textureLoad(bakedVertexAnimationTexture, vec2<i32>(${pairs}, mRow), 0).x > -0.5) {
  let mBase = i32(vertexInputs.simMorph.x + 0.5);
  let mSlot = i32(vertexInputs.simMorph.y + 0.5);
  let mCount = i32(vertexInputs.simMorph.z + 0.5);
  for (var k = 0; k < ${MORPH_TEXELS}; k++) {
    let pw = textureLoad(bakedVertexAnimationTexture, vec2<i32>(${pairs} + k, mRow), 0);
    for (var j = 0; j < 2; j++) {
      let w = select(pw.y, pw.w, j == 1);
      if (abs(w) < 0.0001) { continue; }
      let ch = i32(select(pw.x, pw.z, j == 1) + 0.5);
      let lf = simMorphTexel(mBase + ch / 4)[ch % 4];
      if (lf < -0.5) { continue; }
      let t = mBase + ${H} + (i32(lf + 0.5) * mCount + mSlot) * 2;
      positionUpdated += simMorphTexel(t).xyz * w;
      normalUpdated += simMorphTexel(t + 1).xyz * w;
    }
  }
}
#endif
#endif
`,
      CUSTOM_VERTEX_MAIN_END: `${GUARD}\nvertexOutputs.vSimSlot = vertexInputs.bakedVertexAnimationSettingsInstanced.x;\nvertexOutputs.vSimField = vertexInputs.simField;\n#endif\n`,
    };
  }
  return {
    CUSTOM_FRAGMENT_DEFINITIONS: `${GUARD}
varying vSimSlot: f32;
varying vSimField: vec4f;
var simDataTexture: texture_2d<f32>;
fn simHash(n: f32) -> f32 { return fract(sin(n * 12.9898) * 43758.5453); }
#endif
`,
    CUSTOM_FRAGMENT_MAIN_BEGIN: `${GUARD}
let simRow = i32(fragmentInputs.vSimSlot + 0.5);
let simF = fragmentInputs.vSimField;
let simA = textureLoad(simDataTexture, vec2<i32>(${off}, simRow), 0);
#ifdef SIMBODY
let c1 = textureLoad(simDataTexture, vec2<i32>(${off + 1}, simRow), 0).w;
let c4 = textureLoad(simDataTexture, vec2<i32>(${off + 4}, simRow), 0).w;
// Between the hem of a top that reaches the waist (not a crop top) and the waistband.
let simTuck = step(simF.x, -0.5) * step(c1, c4 + 0.06) * step(c4 - 0.04, simF.y) * step(simF.y, c1 + 0.04) * step(-5.0, c4);
{
  let c2 = textureLoad(simDataTexture, vec2<i32>(${off + 2}, simRow), 0).w;
  let c3 = textureLoad(simDataTexture, vec2<i32>(${off + 3}, simRow), 0).w;
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
#endif
`,
    CUSTOM_FRAGMENT_UPDATE_ALPHA: `${GUARD}
#ifdef SIMBODY
{
  let simRef = textureLoad(simDataTexture, vec2<i32>(${off + 5}, simRow), 0);
  // Skin: the Sim's colour, keeping the texture's shading and its hue variation (lips, cheeks,
  // knuckles) relative to its median skin colour.
  surfaceAlbedo = simA.rgb * clamp(surfaceAlbedo / max(simRef.rgb, vec3f(0.01)), vec3f(0.0), vec3f(2.0));
  let scalp = clamp(-simF.z - 1.0, 0.0, 1.0) * textureLoad(simDataTexture, vec2<i32>(${off + 7}, simRow), 0).w;
  let hairColour = textureLoad(simDataTexture, vec2<i32>(${off + 3}, simRow), 0).rgb * 0.5;
  surfaceAlbedo = mix(surfaceAlbedo, hairColour * 0.7, scalp);
  surfaceAlbedo = mix(surfaceAlbedo, textureLoad(simDataTexture, vec2<i32>(${off + 1}, simRow), 0).rgb * 0.7, simTuck);
}
#endif
#ifdef SIMCLOTH
// Tops and bottoms: the Sim's colour over the atlas' greyscale detail (median 0.5); shoes as authored.
if (simF.z < 1.5) {
  let cTop = textureLoad(simDataTexture, vec2<i32>(${off + 1}, simRow), 0).rgb;
  let cBot = textureLoad(simDataTexture, vec2<i32>(${off + 2}, simRow), 0).rgb;
  surfaceAlbedo = select(cBot, cTop, simF.z < 0.5) * surfaceAlbedo * 2.0;
}
#endif
#ifdef SIMHAIR
surfaceAlbedo = surfaceAlbedo * simHair.rgb;
#endif
#ifdef SIMBROW
surfaceAlbedo = textureLoad(simDataTexture, vec2<i32>(${off + 3}, simRow), 0).rgb * 0.45;
#endif
#ifdef SIMCARD
surfaceAlbedo = surfaceAlbedo * textureLoad(simDataTexture, vec2<i32>(${off + 3}, simRow), 0).rgb;
#endif
#ifdef SIMEYE
{
  // Iris: the texture's detail (luminance) in the Sim's eye colour; the pupil stays dark.
  let iris = 1.0 - smoothstep(simF.z * 0.9, simF.z * 1.02, length(simF.xy));
  let eyeColour = textureLoad(simDataTexture, vec2<i32>(${off + 7}, simRow), 0).rgb;
  let detail = dot(surfaceAlbedo, vec3f(0.2126, 0.7152, 0.0722)) * simF.w;
  surfaceAlbedo = mix(surfaceAlbedo, eyeColour * detail, iris * step(0.001, dot(eyeColour, vec3f(1.0))));
}
#endif
#ifdef SIMMOUTH
// Inside the mouth: shaded by the lips and cheeks.
surfaceAlbedo = surfaceAlbedo * 0.8;
#endif
#endif
`,
  };
}

function glsl(shaderType: string, off: number, morph: MorphBinding | null): { [pointName: string]: string } {
  if (shaderType === 'vertex') {
    const W = morph?.width ?? 1;
    const H = morph?.header ?? 0;
    const pairs = off + APPEARANCE_TEXELS;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `${GUARD}
attribute vec4 simField;
varying float vSimSlot;
varying vec4 vSimField;
#ifdef SIMMORPH
attribute vec4 simMorph;
uniform highp sampler2D simMorphTexture;
vec4 simMorphTexel(int i) { return texelFetch(simMorphTexture, ivec2(i % ${W}, i / ${W}), 0); }
#endif
#endif
`,
      CUSTOM_VERTEX_UPDATE_POSITION: `${GUARD}
#ifdef SIMMORPH
int mRow = int(bakedVertexAnimationSettingsInstanced.x + 0.5);
if (simMorph.x >= 0.0 && texelFetch(bakedVertexAnimationTexture, ivec2(${pairs}, mRow), 0).x > -0.5) {
  int mBase = int(simMorph.x + 0.5);
  int mSlot = int(simMorph.y + 0.5);
  int mCount = int(simMorph.z + 0.5);
  for (int k = 0; k < ${MORPH_TEXELS}; k++) {
    vec4 pw = texelFetch(bakedVertexAnimationTexture, ivec2(${pairs} + k, mRow), 0);
    for (int j = 0; j < 2; j++) {
      float w = j == 1 ? pw.w : pw.y;
      if (abs(w) < 0.0001) continue;
      int ch = int((j == 1 ? pw.z : pw.x) + 0.5);
      float lf = simMorphTexel(mBase + ch / 4)[ch % 4];
      if (lf < -0.5) continue;
      int t = mBase + ${H} + (int(lf + 0.5) * mCount + mSlot) * 2;
      positionUpdated += simMorphTexel(t).xyz * w;
      normalUpdated += simMorphTexel(t + 1).xyz * w;
    }
  }
}
#endif
#endif
`,
      CUSTOM_VERTEX_MAIN_END: `${GUARD}\nvSimSlot = bakedVertexAnimationSettingsInstanced.x;\nvSimField = simField;\n#endif\n`,
    };
  }
  return {
    CUSTOM_FRAGMENT_DEFINITIONS: `${GUARD}
varying float vSimSlot;
varying vec4 vSimField;
uniform highp sampler2D simDataTexture;
float simHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
#endif
`,
    CUSTOM_FRAGMENT_MAIN_BEGIN: `${GUARD}
int simRow = int(vSimSlot + 0.5);
vec4 simF = vSimField;
vec4 simA = texelFetch(simDataTexture, ivec2(${off}, simRow), 0);
#ifdef SIMBODY
float c1 = texelFetch(simDataTexture, ivec2(${off + 1}, simRow), 0).w;
float c4 = texelFetch(simDataTexture, ivec2(${off + 4}, simRow), 0).w;
float simTuck = step(simF.x, -0.5) * step(c1, c4 + 0.06) * step(c4 - 0.04, simF.y) * step(simF.y, c1 + 0.04) * step(-5.0, c4);
{
  float c2 = texelFetch(simDataTexture, ivec2(${off + 2}, simRow), 0).w;
  float c3 = texelFetch(simDataTexture, ivec2(${off + 3}, simRow), 0).w;
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
#endif
`,
    CUSTOM_FRAGMENT_UPDATE_ALPHA: `${GUARD}
#ifdef SIMBODY
{
  vec4 simRef = texelFetch(simDataTexture, ivec2(${off + 5}, simRow), 0);
  surfaceAlbedo = simA.rgb * clamp(surfaceAlbedo / max(simRef.rgb, vec3(0.01)), vec3(0.0), vec3(2.0));
  float scalp = clamp(-simF.z - 1.0, 0.0, 1.0) * texelFetch(simDataTexture, ivec2(${off + 7}, simRow), 0).w;
  vec3 hairColour = texelFetch(simDataTexture, ivec2(${off + 3}, simRow), 0).rgb * 0.5;
  surfaceAlbedo = mix(surfaceAlbedo, hairColour * 0.7, scalp);
  surfaceAlbedo = mix(surfaceAlbedo, texelFetch(simDataTexture, ivec2(${off + 1}, simRow), 0).rgb * 0.7, simTuck);
}
#endif
#ifdef SIMCLOTH
if (simF.z < 1.5) {
  vec3 cTop = texelFetch(simDataTexture, ivec2(${off + 1}, simRow), 0).rgb;
  vec3 cBot = texelFetch(simDataTexture, ivec2(${off + 2}, simRow), 0).rgb;
  surfaceAlbedo = (simF.z < 0.5 ? cTop : cBot) * surfaceAlbedo * 2.0;
}
#endif
#ifdef SIMHAIR
surfaceAlbedo = surfaceAlbedo * simHair.rgb;
#endif
#ifdef SIMBROW
surfaceAlbedo = texelFetch(simDataTexture, ivec2(${off + 3}, simRow), 0).rgb * 0.45;
#endif
#ifdef SIMCARD
surfaceAlbedo = surfaceAlbedo * texelFetch(simDataTexture, ivec2(${off + 3}, simRow), 0).rgb;
#endif
#ifdef SIMEYE
{
  float iris = 1.0 - smoothstep(simF.z * 0.9, simF.z * 1.02, length(simF.xy));
  vec3 eyeColour = texelFetch(simDataTexture, ivec2(${off + 7}, simRow), 0).rgb;
  float detail = dot(surfaceAlbedo, vec3(0.2126, 0.7152, 0.0722)) * simF.w;
  surfaceAlbedo = mix(surfaceAlbedo, eyeColour * detail, iris * step(0.001, dot(eyeColour, vec3(1.0))));
}
#endif
#ifdef SIMMOUTH
surfaceAlbedo = surfaceAlbedo * 0.8;
#endif
#endif
`,
  };
}
