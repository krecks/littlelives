/**
 * Asset manifest schema. Code and content refer to assets only by key
 * (e.g. `model.fridge`, `icon.need.hunger`); the manifest maps keys to files
 * or placeholders. Swapping art = editing the manifest or adding a pack.
 */

export type Vec3 = [number, number, number];

export interface PlaceholderPart {
  /** `blob` is a lumpy sphere for foliage and rocks. */
  shape: 'box' | 'cylinder' | 'cone' | 'sphere' | 'capsule' | 'blob';
  size: Vec3;
  /** Centre of the part. Local space: footprint centred on origin, y up, front is +z. */
  at: Vec3;
  color: string;
  /** Parts tinted per instance from a Sim's appearance (outfit, skin, hair). */
  tint?: 'body' | 'skin' | 'hair';
  /**
   * Surface finish: key of a `material` entry (e.g. `material.finish.fabric`). The part colour
   * tints that material's texture. Defaults to a plain matte finish.
   */
  material?: string;
  /** Edge rounding radius in metres for boxes (default: a small bevel; 0 = sharp). */
  radius?: number;
  /** Cylinders/cones: top diameter as a fraction of the bottom (1 = straight). */
  taper?: number;
  /** Blobs: surface noise amplitude as a fraction of the size (default 0.18). */
  noise?: number;
  /** Rotation in degrees around x, y, z (applied before `at`). */
  rotate?: Vec3;
  /** Tessellation override for round shapes (cylinder/cone sides, sphere segments). */
  segments?: number;
}

export interface ModelEntry {
  type: 'model';
  /** glTF/GLB file. When missing or failing to load, `placeholder` is used. */
  url?: string;
  scale?: number;
  /** Degrees. */
  rotationY?: number;
  offset?: Vec3;
  placeholder?: PlaceholderPart[];
}

export interface MaterialEntry {
  type: 'material';
  color: string;
  /** Used for the sides of slab-like meshes. */
  sideColor?: string;
  texture?: string;
  /** Texture repeats per metre. */
  uvScale?: number;
  /** Tangent-space normal map (OpenGL convention), resolved relative to `texture`. */
  normal?: string;
  /** Packed ambient occlusion (R), roughness (G), metalness (B), resolved relative to `texture`. */
  arm?: string;
  /** 0 (mirror) to 1 (matte); multiplies the `arm` roughness when present. Default 0.8. */
  roughness?: number;
  /** 0 (dielectric) to 1 (metal). Default 0. */
  metallic?: number;
  /** Normal map strength (default 1). */
  normalStrength?: number;
  /** `xz`: texture by world position (metres) instead of the mesh UVs, for flat ground meshes. */
  projection?: 'uv' | 'xz';
  /** Opacity below 1 makes the surface see-through (glass). Default 1. */
  alpha?: number;
}

export interface IconEntry {
  type: 'icon';
  url: string;
  /** `mask` (default) recolours a monochrome icon with CSS; `image` shows it as-is. */
  mode?: 'mask' | 'image';
}

export interface ImageEntry {
  type: 'image';
  url: string;
}

export interface SpriteEntry {
  type: 'sprite';
  url: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  fps: number;
}

/** Colour choices offered in character creation (`palette.skin`, `palette.hair`, `palette.outfit`). */
export interface PaletteEntry {
  type: 'palette';
  colors: string[];
}

export type AssetEntry = ModelEntry | MaterialEntry | IconEntry | ImageEntry | SpriteEntry | PaletteEntry;
export type AssetType = AssetEntry['type'];
export type EntryOf<T extends AssetType> = Extract<AssetEntry, { type: T }>;

export interface Manifest {
  version: number;
  /** Further manifests (relative URLs) whose entries override this one's. */
  packs?: string[];
  entries: Record<string, AssetEntry>;
}
