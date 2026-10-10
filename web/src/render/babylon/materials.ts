/**
 * Physically based materials and image-based lighting.
 *
 * - Lot surfaces (walls, floors, roads, terrain) and placeholder "finishes" (fabric, wood,
 *   ceramic, metal, ...) are `PBRMaterial`s built from manifest `material` entries: albedo,
 *   normal and packed AO/roughness/metal maps tiled in metres.
 * - Manifest colours are sRGB; PBR shades in linear space. Vertex and per-instance colours
 *   (placeholder parts, Sim tints) are converted on the GPU by `VertexTweaksPlugin`.
 * - The environment (`.env`, prefiltered offline from a CC0 HDRI) lights everything with sky
 *   ambient and reflections; its intensity follows the time of day.
 *
 * - House surfaces can carry `WallCutPlugin`: walls drop to stubs in the vertex shader when the
 *   cutaway state says so (driven by a per-vertex attribute, see `geometry.ts`), at no CPU cost.
 *
 * All materials are frozen once their textures are loaded. Changing the environment intensity
 * (or an emissive glow, via `touch`) thaws them for a couple of frames so the new value reaches
 * their uniform buffers (the renderer re-records its WebGPU snapshot on lighting changes anyway).
 */

import {
  Color3,
  CubeTexture,
  MaterialPluginBase,
  PBRMaterial,
  ShaderLanguage,
  StandardMaterial,
  Texture,
  Vector4,
  type AbstractEngine,
  type AbstractMesh,
  type Light,
  type Material,
  type MaterialDefines,
  type Mesh,
  type Nullable,
  type Scene,
  type SubMesh,
  type UniformBuffer,
} from './core';
import { optimizedUrl, type AssetRegistry } from '../../assets/registry';
import type { MaterialEntry } from '../../assets/types';

/** Default finish for placeholder parts without a `material`. */
export const DEFAULT_FINISH = 'material.finish.matte';

const FALLBACK_FINISH: MaterialEntry = { type: 'material', color: '#FFFFFF', roughness: 0.75 };

/**
 * Small vertex-shader tweaks shared by GLSL (WebGL2) and WGSL (WebGPU):
 * - `srgbColors`: vertex/instance colours are authored in sRGB; convert them to linear.
 * - `planarUV`: UVs from the (baked, metre-scale) XZ position, for flat meshes built with
 *   0..1 UVs such as roads, so textures keep a realistic size.
 */
interface Tweaks {
  srgbColors?: boolean;
  planarUV?: boolean;
}
let pendingTweaks: Tweaks = {};

class VertexTweaksPlugin extends MaterialPluginBase {
  private readonly tweaks: Tweaks;

  constructor(material: Material, tweaks: Tweaks) {
    // The base constructor already asks for the shader code, before `this.tweaks` exists.
    pendingTweaks = tweaks;
    super(material, 'VertexTweaks', 200, undefined, true, false);
    this.tweaks = tweaks;
    this._enable(true);
  }

  override getClassName(): string {
    return 'VertexTweaksPlugin';
  }

  override isCompatible(): boolean {
    return true;
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== 'vertex') return null;
    const wgsl = shaderLanguage === ShaderLanguage.WGSL;
    const tweaks = this.tweaks ?? pendingTweaks;
    const code: { [pointName: string]: string } = {};
    if (tweaks.planarUV) {
      code.CUSTOM_VERTEX_UPDATE_POSITION = '#ifdef UV1\nuvUpdated = positionUpdated.xz;\n#endif\n';
    }
    if (tweaks.srgbColors) {
      const body = wgsl
        ? 'vertexOutputs.vColor = vec4f(pow(max(vertexOutputs.vColor.rgb, vec3f(0.0)), vec3f(2.2)), vertexOutputs.vColor.a);'
        : 'vColor = vec4(pow(max(vColor.rgb, vec3(0.0)), vec3(2.2)), vColor.a);';
      code.CUSTOM_VERTEX_MAIN_END = `#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)\n${body}\n#endif\n`;
    }
    return code;
  }
}

/** Cutaway state shared by every wall material of a scene (set by the renderer). */
export class WallCutState {
  /** 1 where the camera looks along +x, -x, +z, -z (matches `LOOK` bits in geometry.ts). */
  readonly look = new Vector4(0, 0, 0, 0);
  /** x: all walls down (0/1); y: stub height in metres. */
  readonly params = new Vector4(0, 0.35, 0, 0);
}

/**
 * Lowers wall vertices in the vertex shader. Per vertex `wallCut` = [mask A, kind, mask B, 0]:
 * the vertex is cut when the camera looks along a direction set in both masks (or all walls are
 * down); kind 1 clamps it to the stub height, kind 2 hides it below the ground (window frames,
 * lintels). Uniforms are bound per draw, so frozen materials still follow the state.
 */
class WallCutPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly state: WallCutState,
  ) {
    super(material, 'WallCut', 210, { WALLCUT: false }, true, false);
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  override getClassName(): string {
    return 'WallCutPlugin';
  }

  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    defines.WALLCUT = mesh.isVerticesDataPresent('wallCut');
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent('wallCut')) attributes.push('wallCut');
  }

  override getUniforms(): { externalUniforms: string[] } {
    return { externalUniforms: ['wallCutLook', 'wallCutParams'] };
  }

  override hardBindForSubMesh(_ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    const effect = subMesh.effect;
    if (!effect) return;
    const { look, params } = this.state;
    effect.setFloat4('wallCutLook', look.x, look.y, look.z, look.w);
    effect.setFloat4('wallCutParams', params.x, params.y, params.z, params.w);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== 'vertex') return null;
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
#ifdef WALLCUT
attribute wallCut: vec4f;
uniform wallCutLook: vec4f;
uniform wallCutParams: vec4f;
#endif
`,
        CUSTOM_VERTEX_UPDATE_POSITION: `
#ifdef WALLCUT
{
  let cutA = step(0.5, dot(floor(fract(vertexInputs.wallCut.x / vec4f(2.0, 4.0, 8.0, 16.0)) * 2.0), uniforms.wallCutLook));
  let cutB = step(0.5, dot(floor(fract(vertexInputs.wallCut.z / vec4f(2.0, 4.0, 8.0, 16.0)) * 2.0), uniforms.wallCutLook));
  if (max(uniforms.wallCutParams.x, cutA * cutB) > 0.5) {
    if (vertexInputs.wallCut.y > 1.5) { positionUpdated.y = -2.0; }
    else if (vertexInputs.wallCut.y > 0.5) { positionUpdated.y = min(positionUpdated.y, uniforms.wallCutParams.y); }
  }
}
#endif
`,
      };
    }
    return {
      CUSTOM_VERTEX_DEFINITIONS: `
#ifdef WALLCUT
attribute vec4 wallCut;
uniform vec4 wallCutLook;
uniform vec4 wallCutParams;
#endif
`,
      CUSTOM_VERTEX_UPDATE_POSITION: `
#ifdef WALLCUT
{
  float cutA = step(0.5, dot(floor(fract(wallCut.x / vec4(2.0, 4.0, 8.0, 16.0)) * 2.0), wallCutLook));
  float cutB = step(0.5, dot(floor(fract(wallCut.z / vec4(2.0, 4.0, 8.0, 16.0)) * 2.0), wallCutLook));
  if (max(wallCutParams.x, cutA * cutB) > 0.5) {
    if (wallCut.y > 1.5) { positionUpdated.y = -2.0; }
    else if (wallCut.y > 0.5) { positionUpdated.y = min(positionUpdated.y, wallCutParams.y); }
  }
}
#endif
`,
    };
  }
}

/**
 * One material for every untextured opaque finish (matte, satin, gloss, metal, chrome, skin,
 * hair): metalness and roughness come from the vertex colour's alpha (see `encodeFinish`), so a
 * placeholder model with five finishes is one draw call instead of five.
 */
class PlainFinishPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'PlainFinish', 220, undefined, true, true);
  }

  override getClassName(): string {
    return 'PlainFinishPlugin';
  }

  override isCompatible(): boolean {
    return true;
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== 'fragment') return null;
    if (shaderLanguage === ShaderLanguage.WGSL) {
      const a = 'fragmentInputs.vColor.a';
      return {
        '!reflectivityBlock\\(\\s*uniforms\\.vReflectivityColor': `reflectivityBlock(vec4f(step(0.5, ${a}), clamp((${a} - 0.5 * step(0.5, ${a})) * 2.0, 0.03, 1.0), uniforms.vReflectivityColor.zw)`,
      };
    }
    return {
      '!reflectivityBlock\\(\\s*vReflectivityColor': 'reflectivityBlock(vec4(step(0.5, vColor.a), clamp((vColor.a - 0.5 * step(0.5, vColor.a)) * 2.0, 0.03, 1.0), vReflectivityColor.ba)',
    };
  }
}

/** Vertex-colour alpha for the plain finish: [0, 0.5) dielectric, [0.5, 1] metal; roughness scaled within. */
export function encodeFinish(roughness: number, metallic: number): number {
  const r = Math.min(0.999, Math.max(0, roughness)) * 0.5;
  return metallic >= 0.5 ? 0.5 + r : r;
}

/** Point lights (interior lamps) a lit material must handle besides the sun and the sky. */
const MAX_LIGHTS = 6;

export interface SurfaceOptions {
  /** Multiply albedo by (sRGB) vertex / instance colours. */
  vertexColors?: boolean;
  /** Render both faces (generated lot geometry does not guarantee winding). */
  doubleSided?: boolean;
  /** Derive UVs from the XZ position (metres) instead of the mesh's own UVs. */
  planarUV?: boolean;
  /** Follow the wall cutaway state (meshes need the `wallCut` attribute). */
  cutaway?: boolean;
}

export class MaterialLibrary {
  private static readonly byScene = new WeakMap<Scene, MaterialLibrary>();

  /** The library for `scene`; created on first use (without a registry, finishes fall back to matte). */
  static for(scene: Scene): MaterialLibrary {
    let lib = MaterialLibrary.byScene.get(scene);
    if (!lib) MaterialLibrary.byScene.set(scene, (lib = new MaterialLibrary(scene)));
    return lib;
  }

  private assets: AssetRegistry | null = null;
  private readonly cache = new Map<string, PBRMaterial>();
  private readonly textures = new Map<string, Texture>();
  /** Every PBR material whose uniforms depend on the environment intensity. */
  private readonly lit = new Set<PBRMaterial>();
  private readonly thawed = new Set<PBRMaterial>();
  private refreezeFrames = 0;
  private shadowMaterial: StandardMaterial | null = null;
  /** Wall cutaway state read by every `cutaway` material. */
  readonly wallCut = new WallCutState();

  /** Called after thawed materials were frozen again (a WebGPU snapshot must re-record then). */
  onRefrozen: (() => void) | null = null;

  private constructor(private readonly scene: Scene) {
    scene.onAfterRenderObservable.add(() => {
      if (this.refreezeFrames === 0 || --this.refreezeFrames > 0) return;
      for (const m of this.thawed) m.freeze();
      this.thawed.clear();
      this.onRefrozen?.();
    });
  }

  setAssets(assets: AssetRegistry): this {
    this.assets = assets;
    return this;
  }

  /** A textured surface from a manifest `material` entry (walls, floors, roads, terrain). */
  surface(key: string, options: SurfaceOptions = {}): PBRMaterial {
    const id = `${key}|${options.vertexColors ? 'vc' : ''}|${options.doubleSided ? '2s' : ''}|${options.planarUV ? 'xz' : ''}|${options.cutaway ? 'cut' : ''}`;
    let mat = this.cache.get(id);
    if (!mat) {
      const entry = this.assets?.get(key, 'material') ?? { type: 'material', color: '#DDDDDD' };
      mat = this.create(key, entry, { ...options, planarUV: options.planarUV || entry.projection === 'xz' });
      this.cache.set(id, mat);
    }
    return mat;
  }

  /** A vertex-coloured finish for placeholder parts (`material.finish.*`). */
  finish(key: string = DEFAULT_FINISH): PBRMaterial {
    const id = `finish|${key}`;
    let mat = this.cache.get(id);
    if (!mat) {
      const entry = (this.assets && this.assets.get(key, 'material')) || FALLBACK_FINISH;
      mat = this.create(key, entry, { vertexColors: true });
      this.cache.set(id, mat);
    }
    return mat;
  }

  /**
   * Whether a finish is untextured and opaque (it can share the plain material), with its
   * roughness and metalness.
   */
  finishInfo(key: string): { plain: boolean; roughness: number; metallic: number } {
    const entry = (this.assets && this.assets.has(key, 'material') && this.assets.get(key, 'material')) || FALLBACK_FINISH;
    return {
      plain: !entry.texture && (entry.alpha ?? 1) >= 1,
      roughness: entry.roughness ?? 0.8,
      metallic: entry.metallic ?? 0,
    };
  }

  /** The shared material for plain finishes (vertex colour alpha = encoded roughness/metalness). */
  plainFinish(): PBRMaterial {
    const id = 'finish|plain';
    let mat = this.cache.get(id);
    if (!mat) {
      mat = this.create('material.finish.plain', { type: 'material', color: '#FFFFFF', roughness: 1, metallic: 0 }, { vertexColors: true });
      new PlainFinishPlugin(mat);
      this.cache.set(id, mat);
    }
    return mat;
  }

  /** Adopts a material created elsewhere (e.g. by the glTF loader) into env updates and freezing. */
  adopt(material: Material | null): void {
    if (!(material instanceof PBRMaterial) || this.lit.has(material)) return;
    material.maxSimultaneousLights = MAX_LIGHTS;
    this.lit.add(material);
    this.freezeWhenReady(material);
  }

  /**
   * Unlit black with per-vertex alpha: soft contact shadows / ambient occlusion decals.
   * Follows the wall cutaway like the walls it darkens.
   */
  contactShadow(): StandardMaterial {
    if (this.shadowMaterial) return this.shadowMaterial;
    const mat = (this.shadowMaterial = new StandardMaterial('contactShadow', this.scene));
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.Black();
    mat.zOffset = -2;
    mat.disableDepthWrite = true;
    new WallCutPlugin(mat, this.wallCut);
    return mat;
  }

  /** Re-uploads a frozen material's uniforms after a property change (e.g. emissive glow). */
  touch(material: Material): void {
    if (!(material instanceof PBRMaterial) || !material.isFrozen) return;
    material.unfreeze();
    this.thawed.add(material);
    this.refreezeFrames = 3;
  }

  /**
   * Leaves `meshes` out of `lights` (replacing earlier entries of the same meshes). A frozen
   * material keeps the lights its shader was compiled with, and on WebGPU a mesh drawn with fewer
   * lights than its shader expects fails to draw, so meshes left out now (perhaps already drawn
   * while their models were still loading) get their materials thawed to recompile.
   */
  excludeFromLights(lights: readonly Light[], meshes: ReadonlySet<Mesh>): void {
    for (const light of lights) {
      const before = new Set(light.excludedMeshes);
      light.excludedMeshes = [...light.excludedMeshes.filter((m) => !m.isDisposed() && !meshes.has(m as Mesh)), ...meshes];
      for (const mesh of meshes) if (!before.has(mesh) && mesh.material) this.touch(mesh.material);
    }
  }

  /** Loads a prefiltered `.env` environment; resolves (without throwing) even when it fails. */
  loadEnvironment(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        if (!ok) console.warn(`[render] environment ${url} unavailable; using lights only`);
        resolve(ok);
      };
      try {
        const tex = new CubeTexture(url, this.scene, null, false, null, () => {
          this.scene.environmentTexture = tex;
          finish(true);
        }, () => finish(false), undefined, true, '.env');
        tex.rotationY = Math.PI * 0.35;
        setTimeout(() => finish(false), 15000);
      } catch {
        finish(false);
      }
    });
  }

  /** Scales image-based lighting (sky ambient + reflections), e.g. for the time of day. */
  setEnvironmentIntensity(value: number): void {
    if (Math.abs(this.scene.environmentIntensity - value) < 1e-4) return;
    this.scene.environmentIntensity = value;
    for (const m of this.lit) {
      if (!m.isFrozen) continue;
      m.unfreeze();
      this.thawed.add(m);
    }
    // Keep them thawed for the frame that re-records the snapshot, then freeze again.
    if (this.thawed.size) this.refreezeFrames = 3;
  }

  private create(key: string, entry: MaterialEntry, options: SurfaceOptions): PBRMaterial {
    const mat = new PBRMaterial(key, this.scene);
    mat.albedoColor = Color3.FromHexString(entry.color).toLinearSpace();
    const scale = entry.uvScale ?? 1;
    const base = entry.texture;
    if (base) {
      mat.albedoTexture = this.texture(base, scale, true);
      if (entry.normal) {
        const bump = this.texture(new URL(entry.normal, base).href, scale, false);
        mat.bumpTexture = bump;
        bump.level = entry.normalStrength ?? 1;
        // Same convention as Babylon's glTF loader for OpenGL-style maps in a left-handed scene.
        mat.invertNormalMapX = true;
        mat.invertNormalMapY = false;
      }
      if (entry.arm) {
        mat.metallicTexture = this.texture(new URL(entry.arm, base).href, scale, false);
        mat.useAmbientOcclusionFromMetallicTextureRed = true;
        mat.useRoughnessFromMetallicTextureGreen = true;
        mat.useMetallnessFromMetallicTextureBlue = true;
        mat.useRoughnessFromMetallicTextureAlpha = false;
      }
    }
    // With a packed map the scalars multiply its channels.
    mat.roughness = entry.roughness ?? (entry.arm ? 1 : 0.8);
    mat.metallic = entry.metallic ?? (entry.arm ? 1 : 0);
    if (entry.alpha !== undefined && entry.alpha < 1) {
      mat.alpha = entry.alpha;
      mat.transparencyMode = PBRMaterial.MATERIAL_ALPHABLEND;
      // Keep glass reflections strong while the body is see-through.
      mat.useRadianceOverAlpha = true;
      mat.useSpecularOverAlpha = true;
    }
    mat.backFaceCulling = !options.doubleSided;
    if (options.doubleSided) mat.twoSidedLighting = true;
    mat.maxSimultaneousLights = MAX_LIGHTS;
    if (options.vertexColors || options.planarUV) new VertexTweaksPlugin(mat, { srgbColors: options.vertexColors, planarUV: options.planarUV });
    if (options.cutaway) new WallCutPlugin(mat, this.wallCut);
    this.lit.add(mat);
    this.freezeWhenReady(mat);
    return mat;
  }

  private texture(url: string, scale: number, srgb: boolean): Texture {
    const id = `${url}|${scale}`;
    let tex = this.textures.get(id);
    if (!tex) {
      tex = textureWithFallback(url, this.scene, srgb);
      tex.uScale = tex.vScale = scale;
      tex.anisotropicFilteringLevel = 8;
      this.textures.set(id, tex);
    }
    return tex;
  }

  private freezeWhenReady(mat: PBRMaterial): void {
    const textures = mat.getActiveTextures().filter((t): t is Texture => t instanceof Texture);
    Texture.WhenAllReady(textures, () => {
      if (!this.thawed.has(mat)) mat.freeze();
    });
  }
}

/**
 * A texture from the build's compressed copy (KTX2, which carries its own colour space) when
 * there is one, else from the file; a copy that fails to load falls back to the file.
 */
export function textureWithFallback(url: string, scene: Scene, srgb: boolean, anisotropy?: number): Texture {
  const copy = optimizedUrl(url);
  const tex: Texture = new Texture(copy, scene, {
    invertY: false,
    samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
    gammaSpace: srgb,
    onError: () => {
      if (tex.url === url) return;
      console.warn(`[render] compressed ${copy} failed, loading ${url}`);
      tex.updateURL(url);
    },
  });
  tex.gammaSpace = srgb;
  if (anisotropy !== undefined) tex.anisotropicFilteringLevel = anisotropy;
  return tex;
}
