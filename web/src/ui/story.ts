/** How story events read: their sentence, icon and tone (the feed and the journal). */

import type { SocialEvent } from '../core/protocol';
import { money } from './format';
import { services } from './services';
import { game } from './state.svelte';

const ICONS: Record<string, string> = {
  met: 'icon.social.introduce',
  becameFriends: 'icon.social.chat',
  becameGoodFriends: 'icon.social.hug',
  becameBestFriends: 'icon.social.hug',
  becameEnemies: 'icon.social.insult',
  crush: 'icon.bubble.love',
  firstKiss: 'icon.social.kiss',
  startedDating: 'icon.social.askPartner',
  brokeUp: 'icon.social.breakUp',
  proposalRejected: 'icon.bubble.bad',
  fight: 'icon.social.fight',
  jealous: 'icon.emotion.angry',
  promoted: 'icon.ui.career',
  missedWork: 'icon.ui.career',
  visited: 'icon.ui.home',
  paidRent: 'icon.ui.funds',
  rentDebt: 'icon.ui.funds',
  upgraded: 'icon.ui.upgrade',
  jobFound: 'icon.ui.career',
  quitJob: 'icon.ui.career',
  fired: 'icon.ui.career',
};

const LOVE = new Set(['crush', 'firstKiss', 'startedDating']);
const BAD = new Set(['becameEnemies', 'brokeUp', 'fight', 'jealous', 'proposalRejected', 'missedWork', 'rentDebt', 'fired']);

export function storyIcon(e: SocialEvent): string {
  return e.kind === 'skillUp' ? (services.content.skills[e.skill ?? -1]?.icon ?? 'icon.ui.skills') : (ICONS[e.kind] ?? 'icon.need.social');
}

export function storyTone(e: SocialEvent): 'love' | 'bad' | 'good' {
  return LOVE.has(e.kind) ? 'love' : BAD.has(e.kind) ? 'bad' : 'good';
}

const name = (id: number | undefined) => game.roster.find((s) => s.id === id)?.name ?? 'Someone';

/** The job a job event is about (title at its level). */
function job(e: SocialEvent): string {
  const career = e.career === undefined ? undefined : game.catalog?.careers[e.career];
  const level = career?.levels[Math.min(e.n ?? 0, career.levels.length - 1)];
  return level?.title ?? career?.label ?? 'a new job';
}

export function storyText(e: SocialEvent): string {
  const template = services.content.eventTexts[e.kind] ?? '{a} and {b}';
  return template
    .replace('{a}', name(e.a))
    .replace('{b}', name(e.b))
    .replace('{c}', name(e.c))
    .replace('{job}', job(e))
    .replace('{n}', String(e.n ?? ''))
    .replace('{money}', money(e.n ?? 0))
    .replace('{skill}', services.content.skills[e.skill ?? -1]?.label ?? '');
}

/** Whether an event is about the player's household. */
export function aboutUs(e: SocialEvent): boolean {
  return [e.a, e.b, e.c].some((id) => id !== undefined && game.households[game.roster.find((s) => s.id === id)?.household ?? -1]?.player);
}

/** Game minutes per tick (`sim-core` `MINUTES_PER_TICK`); day 1 starts at 08:00. */
const MINUTES_PER_TICK = 1 / 20;
const START_MINUTE = 8 * 60;

/** When an event happened: day (from 1) and minute of the day. */
export function storyTime(e: SocialEvent): { day: number; minute: number } {
  const total = START_MINUTE + e.tick * MINUTES_PER_TICK;
  return { day: Math.floor(total / 1440) + 1, minute: total % 1440 };
}
