/**
 * Turns a Sim's appearance (creator colours, hairstyle, gender) into its outfit: which garment
 * meshes it wears (`top.*`, `bottom.*`, `shoes.*` parts: MakeHuman's clothes, see
 * tools/characters/clothes.py) and the per-Sim shader parameters (skin tint, top and bottom colours,
 * the coverage cuts that hide skin under the clothes, hair colour). The top follows the creator's
 * outfit colour; shoes keep their own. Garments and colours chosen in the household creator
 * (`appearance.top`, `bottom`, `shoes`, `bottomColor`) are worn as chosen; whatever is missing
 * (Sims from older saves) is picked deterministically from the Sim's id, so a Sim always wears the
 * same clothes. Pyjamas recolour the same garments.
 */

import type { Appearance } from '../../../game/household';
import type { BodyData, GarmentCut } from './data';

const TROUSERS = ['#33415C', '#2B2D33', '#4A5568', '#B9A27E', '#6B5A48', '#3E4A3A', '#E8E2D6', '#5C3B3B'];
const SKIRTS = ['#2B2D33', '#5C3B3B', '#33415C', '#7A6A8E', '#B9A27E', '#3E4A3A'];
const SLEEP_TOP = ['#9DB4D9', '#D9A5B4', '#B9D2B0', '#E6D2A6'];

const TOPS: Record<string, readonly string[]> = {
  female: ['top.tee', 'top.tee', 'top.tank', 'top.blouse', 'top.blouse', 'top.long', 'top.shirt', 'top.jacket'],
  male: ['top.tee', 'top.tee', 'top.vneck', 'top.polo', 'top.long', 'top.long', 'top.shirt', 'top.jacket', 'top.suit'],
};
const BOTTOMS: Record<string, readonly string[]> = {
  female: ['bottom.trousers', 'bottom.trousers', 'bottom.capri', 'bottom.skirt', 'bottom.skirt', 'bottom.shorts'],
  male: ['bottom.trousers', 'bottom.trousers', 'bottom.trousers', 'bottom.shorts', 'bottom.suit'],
};
const SHOE_PARTS = ['shoes.sneakers', 'shoes.sneakers', 'shoes.trainers', 'shoes.boots', 'shoes.dress'] as const;
/** Shoes that go with formal clothes. */
const FORMAL = new Set(['top.suit', 'bottom.suit', 'bottom.skirt']);

/** Garment choices offered per gender, most common first (`pickOutfit` weights by repetition). */
export const GARMENTS = { TOPS, BOTTOMS, SHOES: SHOE_PARTS as readonly string[] };

/** A random outfit for a new Sim (the creator colour stays the top's colour). */
export function pickOutfit(gender: string, rand: () => number = Math.random): Pick<Appearance, 'top' | 'bottom' | 'shoes' | 'bottomColor'> {
  const bottom = pick(BOTTOMS[gender] ?? BOTTOMS.male, rand());
  const top = pick(TOPS[gender] ?? TOPS.male, rand());
  return {
    top,
    bottom,
    shoes: pickShoes(top, bottom, rand()),
    bottomColor: pick(bottom === 'bottom.skirt' ? SKIRTS : TROUSERS, rand()),
  };
}

function pickShoes(top: string, bottom: string, r: number): string {
  return FORMAL.has(top) || FORMAL.has(bottom) ? (r < 0.6 ? 'shoes.dress' : 'shoes.boots') : pick(SHOE_PARTS, r);
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
  hair: [number, number, number];
  /** Iris colour (linear rgb). */
  eyes: [number, number, number];
  /** 1 if the Sim wears hair (its scalp takes the hair colour), else 0. */
  scalp: number;
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

/** Eye colours for looks without one (older saves): the creator's `palette.eyes`, mostly brown. */
export const EYE_COLOURS = ['#4A2E1B', '#6B4226', '#6B4226', '#8A6237', '#5F7A3E', '#4E7BA6', '#7C8A96'];

/** Share of each (linear) swatch channel real skin reflects. */
const SKIN_REFLECT = [0.68, 0.6, 0.56];

const OFF = -10;

/** Day outfit (or pyjamas when `sleep`: the same garments, recoloured). */
export function outfitFor(id: number, gender: string, appearance: Appearance | null | undefined, body: BodyData, sleep = false): OutfitParams {
  const r = (k: number) => hash(id * 31 + k);
  const has = (p: string) => p in body.garments;
  // Creator swatches are bright UI colours; real skin reflects less, and less blue and green than
  // red (blood under the skin), so light swatches read as warm skin rather than chalk.
  const skin = hexToLinear(appearance?.skin, '#D9A882').map((v, k) => v * SKIN_REFLECT[k]) as [number, number, number];
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
  const shoePart = chosen(appearance?.shoes, 'shoes.') ?? pickShoes(topPart, bottomPart, r(8));
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
    hair: hairMult,
    eyes: hexToLinear(appearance?.eyes ?? EYE_COLOURS[Math.floor(r(9) * EYE_COLOURS.length)], '#6B4226'),
    scalp: appearance?.hairStyle === 'none' ? 0 : 1,
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
  row.set([0, 0, 0, c[4]], offset + 16);
  row.set([o.skinRef[0], o.skinRef[1], o.skinRef[2], c[5]], offset + 20);
  row.set([0, 0, 0, c[6]], offset + 24);
  row.set([o.eyes[0], o.eyes[1], o.eyes[2], o.scalp], offset + 28);
}
