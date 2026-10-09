/**
 * Speech bubbles above Sims in a conversation, and thought bubbles (a planned block skipped or
 * kept, wanting somewhere to do it, a goal reached), as DOM elements over the canvas.
 * Per frame only `transform` is written (compositor-only); icons change only when a
 * conversation starts or its outcome is revealed. No allocations per frame.
 */

import type { AssetRegistry } from '../assets/registry';
import type { Content } from '../content/content';
import type { FrameState } from '../core/bridge';
import type { Renderer } from '../render/types';

const MAX_SIMS = 64;
/** Thought kinds (snapshot `thought`) to bubble tones. */
const THOUGHT_TONES = ['', 'bad', 'wish', 'good', 'love'];

interface Bubble {
  /** Positioned element (transform written per frame). */
  el: HTMLDivElement;
  /** Visual body (animated independently of the position). */
  body: HTMLDivElement;
  icon: HTMLSpanElement;
  /** Current icon key, to avoid redundant DOM writes. */
  key: string;
  visible: boolean;
}

export class BubbleLayer {
  private readonly root: HTMLDivElement;
  private readonly bubbles: Bubble[] = [];
  private readonly head = { x: 0, y: 0, z: 0 };
  private readonly screen = { x: 0, y: 0 };

  constructor(
    container: HTMLElement,
    private readonly renderer: Renderer,
    private readonly content: Content,
    private readonly assets: AssetRegistry,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'bubble-layer';
    container.appendChild(this.root);
  }

  update(frame: FrameState): void {
    const { curr, layout } = frame;
    const k = layout.sim;
    const count = Math.min(curr[layout.header.simCount], MAX_SIMS);
    for (let i = 0; i < count; i++) {
      const o = layout.headerLen + i * layout.simStride;
      const social = curr[o + k.social];
      const thought = social > 0 || k.thought === undefined ? 0 : curr[o + k.thought];
      const key =
        social > 0
          ? this.iconFor(social - 1, curr[o + k.role], curr[o + k.outcome])
          : thought > 0
            ? this.thoughtIcon(thought, curr[o + (k.thoughtSubject ?? 0)])
            : '';
      const bubble = key ? this.bubble(i) : this.bubbles[i];
      if (!bubble) continue;
      if (!key || !this.renderer.simHead(i, this.head) || !this.renderer.project(this.head.x, this.head.y, this.head.z, this.screen)) {
        this.hide(bubble);
        continue;
      }
      if (bubble.key !== key) {
        bubble.key = key;
        bubble.icon.style.setProperty('--icon', `url('${this.assets.icon(key).url}')`);
        bubble.body.dataset.tone = thought > 0 ? THOUGHT_TONES[thought] : key.startsWith('icon.bubble.') ? key.slice(12) : 'topic';
        bubble.body.classList.toggle('thought', thought > 0);
        bubble.body.classList.remove('pop');
        void bubble.body.offsetWidth; // restart the pop animation
        bubble.body.classList.add('pop');
      }
      if (!bubble.visible) {
        bubble.visible = true;
        bubble.el.style.display = '';
      }
      bubble.el.style.transform = `translate3d(${this.screen.x}px, ${this.screen.y}px, 0)`;
    }
    for (let i = count; i < this.bubbles.length; i++) if (this.bubbles[i]) this.hide(this.bubbles[i]);
  }

  dispose(): void {
    this.root.remove();
  }

  /** A thought's icon: the activity (skipped, wanted, kept) or the goal reached. */
  private thoughtIcon(kind: number, subject: number): string {
    if (kind === 4) return this.content.goals[subject]?.icon || 'icon.bubble.good';
    return this.content.activities[subject]?.icon ?? 'icon.bubble.good';
  }

  /** The initiator shows the topic; the other Sim shows their reaction once it's revealed. */
  private iconFor(social: number, role: number, outcome: number): string {
    const def = this.content.social(social);
    if (!def) return '';
    if (role === 1) return def.icon;
    if (outcome === 0) return '';
    if (outcome === 2) return def.category === 'mean' ? 'icon.bubble.angry' : 'icon.bubble.bad';
    if (def.category === 'romantic') return 'icon.bubble.love';
    if (def.category === 'mean') return 'icon.bubble.angry';
    return 'icon.bubble.good';
  }

  private bubble(i: number): Bubble {
    let b = this.bubbles[i];
    if (!b) {
      const el = document.createElement('div');
      el.className = 'speech-bubble';
      el.style.display = 'none';
      const body = document.createElement('div');
      body.className = 'bubble-body';
      const icon = document.createElement('span');
      icon.className = 'bubble-icon';
      body.appendChild(icon);
      el.appendChild(body);
      this.root.appendChild(el);
      b = this.bubbles[i] = { el, body, icon, key: '', visible: false };
    }
    return b;
  }

  private hide(b: Bubble): void {
    if (!b.visible) return;
    b.visible = false;
    b.key = '';
    b.el.style.display = 'none';
  }
}
