/**
 * A toast with Accept / Decline when someone in the player's household comes up with a goal
 * idea or a wish. Goal ideas are taken on or dismissed (as in the planner). A wish is acted on
 * (the catalog, Build mode, a repair); declining only closes the toast, since the wish stays in
 * the planner until it comes true. A toast goes by itself once its idea or wish is gone.
 */

import type { GoalView, SimView } from '../../core/protocol';
import { services } from '../services';
import { askToast, dropToast } from '../state.svelte';
import { goalText } from '../story';
import { actOnWish, brokenAtHome, describeHomeWish } from './homeWishes';
import { activityLabel } from './planner';

/** Asking toasts kept on screen at once (the oldest goes; it's still in the planner). */
const MAX_OPEN = 4;

interface Idea {
  text: string;
  icon?: string;
  title?: string;
  accept: () => void;
  decline?: () => void;
}

const goalKey = (g: GoalView) => `${g.def}:${g.skill ?? ''}:${g.category ?? ''}:${g.target}`;

export function ideaToasts() {
  /** Residents whose ideas are known; what they had when they turned up isn't new. */
  const known = new Set<number>();
  /** Idea key → toast id, and the keys seen in the last snapshot. */
  const open = new Map<string, number>();
  let last = new Set<string>();
  /** The latest snapshot (a toast is answered later, when indices may have shifted). */
  let sims: SimView[] = [];

  /** Runs `act` with where a goal idea is on the resident's list now, if it still is. */
  function withSuggestion(sim: number, key: string, act: (i: number) => void) {
    const i = sims.find((s) => s.id === sim)?.plan?.suggestions.findIndex((g) => goalKey(g) === key) ?? -1;
    if (i >= 0) act(i);
  }

  /** Everything the residents of the household have in mind now, by key. */
  function ideas(): Map<string, Idea> {
    const out = new Map<string, Idea>();
    const content = services.content;
    const controls = services.controls;
    for (const s of sims) {
      const plan = s.plan;
      if (!plan) continue;
      for (const g of plan.suggestions) {
        const key = goalKey(g);
        out.set(`${s.id}|goal|${key}`, {
          text: `${s.name} has an idea: ${goalText(g.def, g.target, g.skill, g.category)}`,
          icon: g.icon || 'icon.ui.calendar',
          accept: () => withSuggestion(s.id, key, (i) => controls.acceptSuggestion(s.id, i)),
          decline: () => withSuggestion(s.id, key, (i) => controls.dismissSuggestion(s.id, i)),
        });
      }
      for (const [activity, skill] of plan.wishes) {
        const label = activityLabel(activity, skill);
        out.set(`${s.id}|place|${activity}:${skill ?? ''}`, {
          text: `${s.name} would like somewhere to ${label.toLowerCase()}`,
          icon: content.activity(activity)?.icon || undefined,
          title: 'Find in catalog',
          accept: () => controls.openCatalog({ label: `For ${s.name}: ${label}`, activity, skill }),
        });
      }
      for (const w of plan.homeWishes) {
        if (w.fix && !brokenAtHome(w.fix)) continue;
        const info = describeHomeWish(content, w);
        const what = info.action?.kind === 'catalog' ? 'Find in catalog' : info.action?.kind === 'build' ? 'Build' : info.action ? 'Repair' : undefined;
        out.set(`${s.id}|home|${info.key}`, {
          text: `${s.name} would like ${info.text.charAt(0).toLowerCase()}${info.text.slice(1)}`,
          icon: info.icon,
          title: what,
          accept: () => actOnWish(info, s.name),
        });
      }
    }
    return out;
  }

  return {
    /** Each snapshot: toasts for new ideas, and away with those that are gone. */
    update(next: SimView[]) {
      sims = next;
      const now = ideas();
      for (const [key, id] of open) {
        if (!now.has(key)) {
          dropToast(id);
          open.delete(key);
        }
      }
      for (const [key, idea] of now) {
        const sim = Number(key.slice(0, key.indexOf('|')));
        if (last.has(key) || open.has(key) || !known.has(sim)) continue;
        if (open.size >= MAX_OPEN) {
          const [oldKey, oldId] = open.entries().next().value!;
          dropToast(oldId);
          open.delete(oldKey);
        }
        const done = () => open.delete(key);
        const id = askToast(idea.text, idea.icon, [
          { label: 'Accept', primary: true, title: idea.title, run: () => (done(), idea.accept()) },
          { label: 'Decline', run: () => (done(), idea.decline?.()) },
        ]);
        open.set(key, id);
      }
      for (const s of sims) if (s.plan) known.add(s.id);
      last = new Set(now.keys());
    },
    /** Takes every asking toast down (the session ends). */
    clear() {
      for (const id of open.values()) dropToast(id);
      open.clear();
    },
  };
}
