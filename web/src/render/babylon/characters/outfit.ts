/**
 * Turns a Sim's appearance (creator colours, hairstyle, gender) into its outfit: which garment
 * meshes it wears (`top.*`, `bottom.*`, `shoes.*` parts built by tools/characters/garments.py) and
 * the per-Sim shader parameters (skin tint, garment colours, the coverage cuts that hide skin under
 * the clothes, hair colour). The top follows the creator's outfit colour. Garments and colours
 * chosen in the household creator (`appearance.top`, `bottom`, `shoes`, `bottomColor`, `shoesColor`) are
 * worn as chosen; whatever is missing (Sims from older saves) is picked deterministically from
 * the Sim's id, so a Sim always wears the same clothes. Pyjamas recolour the same garments.
 */

import type { Appearance } from '../../../game/household';
import type { BodyData, GarmentCut } from './data';

const TROUSERS = ['#33415C', '#2B2D33', '#4A5568', '#B9A27E', '#6B5A48', '#3E4A3A', '#E8E2D6', '#5C3B3B'];
const SKIRTS = ['#2B2D33', '#5C3B3B', '#33415C', '#7A6A8E', '#B9A27E', '#3E4A3A'];
const SHOES = ['#2A2420', '#F2F0EA', '#4A3426', '#1E1E22', '#8A6A4A', '#B03A3A', '#3D5A80'];
const SLEEP_TOP = ['#9DB4D9', '#D9A5B4', '#B9D2B0', '#E6D2A6'];

const TOPS: Record<string, readonly string[]> = {
  female: ['top.tee', 'top.tee', 'top.tank', 'top.blouse', 'top.blouse', 'top.long'],
  male: ['top.tee', 'top.tee', 'top.vneck', 'top.polo', 'top.long', 'top.long'],
};
const BOTTOMS: Record<string, readonly string[]> = {
  female: ['bottom.trousers', 'bottom.trousers', 'bottom.capri', 'bottom.skirt', 'bottom.skirt', 'bottom.shorts'],
  male: ['bottom.trousers', 'bottom.trousers', 'bottom.trousers', 'bottom.shorts'],
};

/** Garment choices offered per gender, most common first (`pickOutfit` weights by repetition). */
export const GARMENTS = { TOPS, BOTTOMS, SHOES: ['shoes.sneakers', 'shoes.boots'] as readonly string[] };

/** A random outfit for a new Sim (the creator colour stays the top's colour). */
export function pickOutfit(gender: string, rand: () => number = Math.random): Pick<Appearance, 'top' | 'bottom' | 'shoes' | 'bottomColor' | 'shoesColor'> {
  const female = gender === 'female';
  const bottom = pick(BOTTOMS[gender] ?? BOTTOMS.male, rand());
  const skirt = bottom === 'bottom.skirt';
  const boots = (bottom === 'bottom.trousers' || skirt) && rand() < (female ? 0.35 : 0.25);
  return {
    top: pick(TOPS[gender] ?? TOPS.male, rand()),
    bottom,
    shoes: boots ? 'shoes.boots' : 'shoes.sneakers',
    bottomColor: pick(skirt ? SKIRTS : TROUSERS, rand()),
    shoesColor: boots ? pick(['#4A3426', '#2A2420', '#6B4A32', '#1E1E22'], rand()) : pick(SHOES, rand()),
  };
}

export interface OutfitParams {
  /** Garment parts worn (mesh part names; empty = none). */
  parts: string[];
  /** Skin colour (linear rgb). */
  skin: [number, number, number];
  /** The body texture's own median skin colour (linear rgb); the shader tints relative to it. */
  skinRef: [number, number, number];
  top: [number, number, number];
  bottom: [number, number, number];
  shoes: [number, number, number];
  trim: [number, number, number];
  hair: [number, number, number];
  /** Coverage cuts: top sleeve / hem / crew / scoop, bottom waist / leg, shoe height. */
  cuts: [number, number, number, number, number, number, number];
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pick<T>(list: readonly T[], r: number): T {
  return list[Math.floor(r * list.length) % list.length];
}

function hexToLinear(hex: string | undefined, fallback: string): [number, number, number] {
  const h = typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
}

function luminance(c: readonly number[]): number {
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

const OFF = -10;

/** Day outfit (or pyjamas when `sleep`: the same garments, recoloured). */
export function outfitFor(id: number, gender: string, appearance: Appearance | null | undefined, body: BodyData, sleep = false): OutfitParams {
  const r = (k: number) => hash(id * 31 + k);
  const female = gender === 'female';
  const has = (p: string) => p in body.garments;
  // Creator swatches are bright UI colours; real skin reflects at most ~70% (keeps highlights).
  const skin = hexToLinear(appearance?.skin, '#D9A882').map((v) => v * 0.72) as [number, number, number];
  const skinRef = [body.skinRef[0], body.skinRef[1], body.skinRef[2]] as [number, number, number];
  // Fabric: the creator colour, a little less saturated-bright than the UI swatch.
  let top = hexToLinear(appearance?.body, '#8FA89A').map((v) => v * 0.9) as [number, number, number];
  const hair = hexToLinear(appearance?.hair, '#5A3B2A');
  // Hair texture is normalised to ~0.5 linear; scale so the result matches the chosen colour.
  const hairMult = hair.map((v) => Math.min(2, v * 2)) as [number, number, number];

  // Creator choices (when the body has them), else picks from the id.
  const chosen = (part: string | undefined, prefix: string) => (part && part.startsWith(prefix) && has(part) ? part : null);
  const isHex = (c: string | undefined) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const topPart = chosen(appearance?.top, 'top.') ?? pick(TOPS[gender] ?? TOPS.male, r(7));
  const bottomPart = chosen(appearance?.bottom, 'bottom.') ?? pick(BOTTOMS[gender] ?? BOTTOMS.male, r(6));
  const skirt = bottomPart === 'bottom.skirt';
  let bottom: [number, number, number];
  if (isHex(appearance?.bottomColor)) {
    bottom = hexToLinear(appearance!.bottomColor, '#33415C');
  } else {
    bottom = hexToLinear(pick(skirt ? SKIRTS : TROUSERS, r(2)), '#33415C');
    // Avoid a bottom that matches the top too closely.
    if (Math.abs(luminance(bottom) - luminance(top)) < 0.03) bottom = hexToLinear(pick(TROUSERS, r(3)), '#2B2D33');
  }
  const shoeChoice = chosen(appearance?.shoes, 'shoes.');
  const boots = shoeChoice ? shoeChoice === 'shoes.boots' : (bottomPart === 'bottom.trousers' || skirt) && r(8) < (female ? 0.35 : 0.25);
  const shoePart = shoeChoice ?? (boots ? 'shoes.boots' : 'shoes.sneakers');
  let shoes = hexToLinear(isHex(appearance?.shoesColor) ? appearance!.shoesColor : pick(SHOES, r(4)), '#2A2420');
  // Soles: off-white on sneakers, a darker shade of the leather on boots.
  const trim = boots ? (shoes.map((v) => v * 0.45) as [number, number, number]) : hexToLinear('#EDEAE2', '#EDEAE2');
  if (boots && !isHex(appearance?.shoesColor)) shoes = hexToLinear(pick(['#4A3426', '#2A2420', '#6B4A32', '#1E1E22'], r(9)), '#4A3426');
  if (sleep) {
    top = hexToLinear(pick(SLEEP_TOP, r(5)), '#9DB4D9');
    bottom = top.map((v) => v * 0.8) as [number, number, number];
  }

  const parts = [topPart, bottomPart, shoePart].filter(has);
  const t: GarmentCut = body.garments[topPart] ?? {};
  const b: GarmentCut = body.garments[bottomPart] ?? {};
  const s: GarmentCut = body.garments[shoePart] ?? {};
  const cuts: OutfitParams['cuts'] = [
    has(topPart) ? (t.sleeve ?? OFF) : OFF,
    t.hem ?? 10,
    t.crew ?? OFF,
    t.scoop ?? OFF,
    has(bottomPart) ? (b.waist ?? OFF) : OFF,
    b.leg ?? 10,
    has(shoePart) ? (s.shoe ?? OFF) : OFF,
  ];
  return {
    parts,
    skin,
    skinRef,
    top,
    bottom,
    shoes,
    trim,
    hair: hairMult,
    cuts,
  };
}

/** Writes the appearance texels (see material.ts) into `row` at `offset`. */
export function writeOutfit(o: OutfitParams, row: Float32Array, offset: number): void {
  const c = o.cuts;
  row.set([o.skin[0], o.skin[1], o.skin[2], c[0]], offset);
  row.set([o.top[0], o.top[1], o.top[2], c[1]], offset + 4);
  row.set([o.bottom[0], o.bottom[1], o.bottom[2], c[2]], offset + 8);
  row.set([o.hair[0], o.hair[1], o.hair[2], c[3]], offset + 12);
  row.set([o.shoes[0], o.shoes[1], o.shoes[2], c[4]], offset + 16);
  row.set([o.skinRef[0], o.skinRef[1], o.skinRef[2], c[5]], offset + 20);
  row.set([o.trim[0], o.trim[1], o.trim[2], c[6]], offset + 24);
  row.set([0, 0, 0, 0], offset + 28);
}
