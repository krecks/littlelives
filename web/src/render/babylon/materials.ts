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
 * All materials are frozen once their textures are loaded. Changing the environment intensity
 * thaws them for a couple of frames so the new value reaches their uniform buffers (the renderer
 * re-records its WebGPU snapshot on lighting changes anyway).
 */

import {
  Color3,
  CubeTexture,
  MaterialPluginBase,
  PBRMaterial,
  ShaderLanguage,
  Texture,
  type Material,
  type Nullable,
  type Scene,
} from '@babylonjs/core';
import type { AssetRegistry } from '../../assets/registry';
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

export interface SurfaceOptions {
  /** Multiply albedo by (sRGB) vertex / instance colours. */
  vertexColors?: boolean;
  /** Render both faces (generated lot geometry does not guarantee winding). */
  doubleSided?: boolean;
  /** Derive UVs from the XZ position (metres) instead of the mesh's own UVs. */
  planarUV?: boolean;
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

  private constructor(private readonly scene: Scene) {
    scene.onAfterRenderObservable.add(() => {
      if (this.refreezeFrames === 0 || --this.refreezeFrames > 0) return;
      for (const m of this.thawed) m.freeze();
      this.thawed.clear();
    });
  }

  setAssets(assets: AssetRegistry): this {
    this.assets = assets;
    return this;
  }

  /** A textured surface from a manifest `material` entry (walls, floors, roads, terrain). */
  surface(key: string, options: SurfaceOptions = {}): PBRMaterial {
    const id = `${key}|${options.vertexColors ? 'vc' : ''}|${options.doubleSided ? '2s' : ''}|${options.planarUV ? 'xz' : ''}`;
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

  /** Adopts a material created elsewhere (e.g. by the glTF loader) into env updates and freezing. */
  adopt(material: Material | null): void {
    if (!(material instanceof PBRMaterial) || this.lit.has(material)) return;
    this.lit.add(material);
    this.freezeWhenReady(material);
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
    if (options.vertexColors || options.planarUV) new VertexTweaksPlugin(mat, { srgbColors: options.vertexColors, planarUV: options.planarUV });
    this.lit.add(mat);
    this.freezeWhenReady(mat);
    return mat;
  }

  private texture(url: string, scale: number, srgb: boolean): Texture {
    const id = `${url}|${scale}`;
    let tex = this.textures.get(id);
    if (!tex) {
      tex = new Texture(url, this.scene, { invertY: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE, gammaSpace: srgb });
      tex.gammaSpace = srgb;
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
