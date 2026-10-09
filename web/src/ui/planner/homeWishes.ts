/**
 * Home wishes (sim-core `planner::HomeWish`) as the Goals panel shows them: a line of text, an
 * icon and what the player can do about it (the catalog narrowed to what helps, Build mode, a
 * repair).
 */

import type { Content } from '../../content/content';
import type { HomeWish } from '../../core/protocol';

export type WishAction =
  | { kind: 'catalog'; label: string; defs: ReadonlySet<string> }
  | { kind: 'build' }
  | { kind: 'repair'; def: string }
  | null;

export interface WishInfo {
  key: string;
  text: string;
  icon: string;
  action: WishAction;
}

export function describeHomeWish(content: Content, w: HomeWish): WishInfo {
  const key = `${w.room ?? ''}:${w.factor ?? ''}:${w.fix ?? ''}:${w.another ?? ''}`;
  if (w.fix) {
    const name = content.object(w.fix)?.name ?? w.fix;
    return { key, text: `The ${name.toLowerCase()} fixed`, icon: content.object(w.fix)?.icon || 'icon.ui.upgrade', action: { kind: 'repair', def: w.fix } };
  }
  if (w.another) {
    const kind = content.roomKinds.find((k) => k.id === w.another);
    return { key, text: `A second ${(kind?.label ?? w.another).toLowerCase()}`, icon: kind?.icon || 'icon.ui.room', action: { kind: 'build' } };
  }
  const garden = w.room === 'garden';
  const kind = garden ? undefined : content.roomKinds.find((k) => k.id === w.room);
  const room = garden ? 'garden' : kind ? (kind.label?.toLowerCase() ?? kind.id) : 'spare room';
  const icon = garden ? 'icon.category.garden' : kind?.icon || 'icon.ui.room';
  // Garden things for the garden, the rest (houseplants too) for rooms.
  const shop = (test: (def: (typeof content.shop)[number]) => boolean) =>
    new Set(content.shop.filter((d) => test(d) && content.belongsOutside(d) === garden).map((d) => d.id));
  switch (w.factor) {
    case 'light':
      return { key, text: `More light in the ${room}`, icon, action: { kind: 'catalog', label: `Light for the ${room}`, defs: shop((d) => !!d.light) } };
    case 'decor':
      return { key, text: `Something nice for the ${room}`, icon, action: { kind: 'catalog', label: `Decor for the ${room}`, defs: shop((d) => content.decorOf(d) > 0) } };
    case 'size':
      return { key, text: `A bigger ${room}`, icon, action: { kind: 'build' } };
    case 'clean':
      return { key, text: `A tidier ${room}`, icon, action: null };
    default: {
      const tags = kind ? (kind.essentials?.flat() ?? kind.tags) : [];
      if (!tags.length) return { key, text: `A ${room} that's for something`, icon, action: { kind: 'build' } };
      return { key, text: `Everything a ${room} needs`, icon, action: { kind: 'catalog', label: `For the ${room}`, defs: shop((d) => content.offersTags(d, tags)) } };
    }
  }
}
