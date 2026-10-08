<script lang="ts">
  import type { SocialEvent } from '../core/protocol';
  import Icon from './Icon.svelte';
  import { money } from './format';
  import { services } from './services';
  import { game } from './state.svelte';

  const icons: Record<string, string> = {
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
  };
  const iconFor = (e: SocialEvent) =>
    e.kind === 'skillUp' ? (services.content.skills[e.skill ?? -1]?.icon ?? 'icon.ui.skills') : (icons[e.kind] ?? 'icon.need.social');
  const tone = (kind: string) =>
    ['crush', 'firstKiss', 'startedDating'].includes(kind)
      ? 'love'
      : ['becameEnemies', 'brokeUp', 'fight', 'jealous', 'proposalRejected', 'missedWork', 'rentDebt'].includes(kind)
        ? 'bad'
        : 'good';

  const name = (id: number | undefined) => game.roster.find((s) => s.id === id)?.name ?? 'Someone';
  function text(e: SocialEvent): string {
    const template = services.content.eventTexts[e.kind] ?? '{a} and {b}';
    return template
      .replace('{a}', name(e.a))
      .replace('{b}', name(e.b))
      .replace('{c}', name(e.c))
      .replace('{n}', String(e.n ?? ''))
      .replace('{money}', money(e.n ?? 0))
      .replace('{skill}', services.content.skills[e.skill ?? -1]?.label ?? '');
  }
</script>

<ol class="feed" aria-live="polite">
  {#each game.feed as f (f.event.id)}
    <li class={tone(f.event.kind)}>
      <span class="icon"><Icon name={iconFor(f.event)} size={16} /></span>
      {text(f.event)}
    </li>
  {/each}
</ol>

<style>
  .feed {
    position: absolute;
    top: 80px;
    right: var(--edge);
    width: 300px;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    background: var(--glass-strong);
    border: 1px solid var(--glass-border);
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    font-weight: 550;
    font-size: 13px;
    animation:
      slide var(--slow) var(--ease),
      fade 12s linear forwards;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 9px;
    background: rgba(79, 191, 133, 0.15);
    color: var(--good);
  }
  .love .icon {
    background: rgba(224, 96, 126, 0.14);
    color: #e0607e;
  }
  .bad .icon {
    background: rgba(236, 106, 92, 0.14);
    color: var(--bad);
  }
  @keyframes slide {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
  }
  @keyframes fade {
    85% {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
</style>
