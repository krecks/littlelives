/**
 * Resident voices in a game (docs/design/voices.md). Watches the render snapshot and decides
 * who says what, then plays the line once the voice worker has made it.
 *
 * Only two kinds of resident speak:
 * - the one whose panel is open (`game.inspected`), and whoever they are talking to;
 * - both sides of a conversation the player started from the social menu.
 *
 * Lines are only said once the voice model is ready; babies don't speak. Voices pause for the
 * session when speech keeps coming late or slows the frames.
 *
 * Presentation only: nothing goes back to the simulation. Work per frame is a cheap check; the
 * snapshot is read about ten times a second.
 */

import type { Content } from '../content/content';
import type { FrameState } from '../core/bridge';
import type { Renderer } from '../render/types';
import { settings } from '../settings/settings.svelte';
import { game, toast } from '../ui/state.svelte';
import { fill, loadLines, Lines, type Line } from './lines';
import { playClip, updateVoiceVolume, type Playing } from './player';
import { ensureVoice, synthesize, unloadVoice, voiceStatus } from './service.svelte';
import { voiceFor, withTone } from './voices';

const TICK_MS = 100;
/** At most this many voices at once, and lines being made at once. */
const MAX_VOICES = 2;
const MAX_IN_FLIGHT = 2;
/** A line not ready by then is dropped: the moment has passed. */
const MAX_WAIT_MS = 4000;
/** Lines this late, so many times in a row, pause voices for the session. */
const LATE_RUN = 3;
/** Frames this slow, in this share of the frames drawn while speech is being made, pause them too. */
const SLOW_FRAME_MS = 50;
const SLOW_SHARE = 0.1;
const FRAME_WINDOW = 120;
/** The engine is unloaded after this long without a line (it reloads from the cache). */
const IDLE_UNLOAD_MS = 5 * 60_000;
/** Quiet time after a resident's own thought before the next one. */
const THOUGHT_GAP_MS = 6000;
/** How long a conversation the player ordered may take to begin (residents may walk over first). */
const PLAYER_TALK_MS = 60000;
/** Not every new action or mood is worth a line. */
const ACTION_CHANCE = 0.6;
const EMOTION_CHANCE = 0.5;

interface SimState {
  social: number;
  outcome: number;
  action: number;
  emotion: number;
  thought: number;
  /** When this resident may next say a thought (ms, performance clock). */
  quietUntil: number;
}

export interface VoiceDirectorStats {
  speaking: number;
  inFlight: number;
  spoken: number;
  dropped: number;
  language: 'off' | 'english' | 'paused';
}

interface Speaking {
  id: number;
  playing: Playing;
}

export class VoiceDirector {
  private lines: Lines | null = null;
  private linesLanguage = '';
  private readonly sims = new Map<number, SimState>();
  private readonly speaking: Speaking[] = [];
  private inFlight = 0;
  /** Lines played, and lines given up on (engine busy, too late, too many voices). */
  private spoken = 0;
  private dropped = 0;
  /** Speech came late or slowed the game: no voices for the rest of the session. */
  private paused = false;
  private lateRun = 0;
  private lastFrame = 0;
  /** Frames drawn while speech was being made, and those over `SLOW_FRAME_MS`; the same while not. */
  private readonly frames = { busy: 0, busySlow: 0, idle: 0, idleSlow: 0 };
  /** Last line asked for; the engine was unloaded for being idle. */
  private lastLine = performance.now();
  private asleep = false;
  private lastTick = 0;
  private counter = 0;
  private disposed = false;
  /** The conversation the player started: these two speak until it ends. */
  private playerTalk: { a: number; b: number; until: number; started: boolean } | null = null;
  private readonly head = { x: 0, y: 0, z: 0 };
  private readonly screen = { x: 0, y: 0 };

  constructor(
    private readonly content: Content,
    private readonly renderer: Renderer,
  ) {
  }

  /** Lines for the voice language, (re)loaded when it changes. */
  private ensureLines(): void {
    const language = settings.voiceLanguage;
    if (this.linesLanguage === language) return;
    this.linesLanguage = language;
    this.lines = null;
    void loadLines(language).then((data) => {
      if (data && !this.disposed && this.linesLanguage === language) this.lines = new Lines(data);
    });
  }

  /** The player asked resident `a` to start a conversation with `b`. */
  playerConversation(a: number, b: number): void {
    this.playerTalk = { a, b, until: performance.now() + PLAYER_TALK_MS, started: false };
  }

  update(frame: FrameState): void {
    const now = frame.now;
    this.watchFrames(now);
    if (now - this.lastTick < TICK_MS) return;
    this.lastTick = now;
    if (!settings.voices || this.paused) {
      this.stopAll();
      return;
    }
    this.ensureLines();
    if (voiceStatus.state === 'off' && !this.asleep) void ensureVoice().catch(() => {});
    if (voiceStatus.state === 'ready' && this.inFlight === 0 && performance.now() - this.lastLine > IDLE_UNLOAD_MS) {
      unloadVoice();
      this.asleep = true;
    }
    updateVoiceVolume();

    const { curr, layout } = frame;
    const k = layout.sim;
    const count = curr[layout.header.simCount];
    const row = (i: number) => layout.headerLen + i * layout.simStride;
    const idAt = (i: number) => curr[row(i) + k.id];

    // Who may speak this tick.
    const voiced = new Set<number>();
    const inspected = game.inspected;
    const talk = this.playerTalk;
    for (let i = 0; i < count; i++) {
      const o = row(i);
      const id = curr[o + k.id];
      if (id === inspected || (talk && (id === talk.a || id === talk.b))) {
        voiced.add(id);
        const partner = curr[o + k.partner];
        if (curr[o + k.social] > 0 && partner >= 0 && partner < count) voiced.add(idAt(partner));
      }
    }
    if (talk) {
      const busy = [talk.a, talk.b].some((id) => {
        for (let i = 0; i < count; i++) if (idAt(i) === id) return curr[row(i) + k.social] > 0;
        return false;
      });
      if (busy) talk.started = true;
      else if (talk.started || now > talk.until) this.playerTalk = null;
    }

    const quiet = game.mode !== 'live' || document.hidden || !this.lines;
    const fast = game.speed >= 3;
    for (let i = 0; i < count; i++) {
      const o = row(i);
      const id = curr[o + k.id];
      const next: SimState = {
        social: curr[o + k.social],
        outcome: curr[o + k.outcome],
        action: curr[o + k.action],
        emotion: curr[o + k.emotion],
        thought: k.thought === undefined ? 0 : curr[o + k.thought],
        quietUntil: 0,
      };
      const prev = this.sims.get(id);
      next.quietUntil = prev?.quietUntil ?? 0;
      this.sims.set(id, next);
      if (!prev || quiet || !voiced.has(id)) continue;
      // At high speed only the conversation the player started is voiced.
      const playerSide = !!talk && (id === talk.a || id === talk.b || this.isPartnerOf(curr, row, k, i, talk));
      if (fast && !playerSide) continue;
      const line = this.event(prev, next, frame, i, id, now);
      if (line) this.say(id, i, line.line, line.partnerId, line.thought, now);
    }

    this.pan(frame);
  }

  /** For the debug overlay. */
  stats(): VoiceDirectorStats {
    const language = !settings.voices ? 'off' : this.paused ? 'paused' : 'english';
    return { speaking: this.speaking.length, inFlight: this.inFlight, spoken: this.spoken, dropped: this.dropped, language };
  }

  /** Counts slow frames while speech is being made, against those while it isn't. */
  private watchFrames(now: number): void {
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    // Gaps from a hidden tab or a paused game say nothing about voices.
    if (dt <= 0 || dt > 1000 || document.hidden || this.paused) return;
    const f = this.frames;
    const slow = dt > SLOW_FRAME_MS ? 1 : 0;
    if (this.inFlight > 0 && voiceStatus.state === 'ready') {
      f.busy++;
      f.busySlow += slow;
    } else {
      f.idle++;
      f.idleSlow += slow;
    }
    if (f.busy < FRAME_WINDOW) return;
    const busyShare = f.busySlow / f.busy;
    const idleShare = f.idle ? f.idleSlow / f.idle : 0;
    // Only when speech makes it worse: a game that is slow anyway isn't the voices' fault.
    if (busyShare > SLOW_SHARE && busyShare > idleShare * 2) this.pause('frames');
    Object.assign(f, { busy: 0, busySlow: 0, idle: 0, idleSlow: 0 });
  }

  private pause(why: 'late' | 'frames'): void {
    if (this.paused) return;
    this.paused = true;
    unloadVoice();
    toast(
      why === 'late'
        ? 'Resident voices are paused for now: speech came too slowly on this computer.'
        : 'Resident voices are paused for now: making speech slowed the game down.',
      6000,
    );
  }

  dispose(): void {
    this.disposed = true;
    this.stopAll();
  }

  private isPartnerOf(
    curr: Float32Array,
    row: (i: number) => number,
    k: FrameState['layout']['sim'],
    i: number,
    talk: { a: number; b: number },
  ): boolean {
    const partner = curr[row(i) + k.partner];
    if (curr[row(i) + k.social] <= 0 || partner < 0) return false;
    const pid = curr[row(partner) + k.id];
    return pid === talk.a || pid === talk.b;
  }

  /** The line for what just changed for resident `id` (row `i`), if any. */
  private event(
    prev: SimState,
    next: SimState,
    frame: FrameState,
    i: number,
    id: number,
    now: number,
  ): { line: Line; partnerId: number; thought: boolean } | null {
    const lines = this.lines!;
    const { curr, layout } = frame;
    const k = layout.sim;
    const o = layout.headerLen + i * layout.simStride;
    const seed = id * 7919 + ++this.counter;
    const partner = curr[o + k.partner];
    const partnerId = partner >= 0 ? curr[layout.headerLen + partner * layout.simStride + k.id] : -1;
    const role = curr[o + k.role];
    // Conversations: the one who starts says the opener, the other answers once the outcome shows.
    if (next.social > 0) {
      const def = this.content.social(next.social - 1);
      if (!def) return null;
      if (role === 1 && next.social !== prev.social) {
        const line = lines.social(def.id, 'start', seed);
        return line && { line, partnerId, thought: false };
      }
      if (role === 2 && prev.outcome === 0 && next.outcome > 0) {
        const line = lines.social(def.id, next.outcome === 1 ? 'good' : 'bad', seed);
        return line && { line, partnerId, thought: false };
      }
      return null;
    }
    if (now < next.quietUntil) return null;
    if (next.thought > 0 && next.thought !== prev.thought) {
      const line = lines.thought(next.thought, seed);
      return line && { line, partnerId: -1, thought: true };
    }
    if (next.emotion > 0 && next.emotion !== prev.emotion && chance(seed, EMOTION_CHANCE)) {
      const emotion = this.content.emotions[next.emotion - 1];
      const line = emotion ? lines.emotion(emotion.id, seed) : null;
      if (line) return { line, partnerId: -1, thought: true };
    }
    if (next.action >= 0 && next.action !== prev.action && chance(seed + 1, ACTION_CHANCE)) {
      const tag = layout.actions[next.action];
      const line = tag ? lines.action(tag, seed) : null;
      if (line) return { line, partnerId: -1, thought: true };
    }
    return null;
  }

  private say(id: number, index: number, line: Line, partnerId: number, thought: boolean, now: number): void {
    const info = game.roster.find((s) => s.id === id);
    if (info?.stage === 'baby') return;
    // Nothing is said while the engine loads (or reloads after being idle): the moment passes.
    if (voiceStatus.state !== 'ready') {
      if (voiceStatus.state === 'off') {
        this.asleep = false;
        void ensureVoice().catch(() => {});
      }
      return;
    }
    if (this.inFlight >= MAX_IN_FLIGHT) {
      this.dropped++;
      return;
    }
    const state = this.sims.get(id);
    if (thought && state) state.quietUntil = now + THOUGHT_GAP_MS;
    const text = fill(line.text, this.firstName(id), partnerId >= 0 ? this.firstName(partnerId) : '');
    const voice = withTone(voiceFor(id, info?.gender, info?.stage), line.tone);
    const requested = performance.now();
    this.inFlight++;
    this.lastLine = requested;
    const clip = synthesize(text, voice).finally(() => this.inFlight--);
    void clip.then(() => this.timed(performance.now() - requested)).catch(() => {});
    void clip
      .then(async (samples) => {
        // An answer waits for the other side to finish (within reason).
        const before = this.speaking.filter((s) => s.id !== id);
        if (before.length && !thought) await Promise.race([Promise.all(before.map((s) => s.playing.ended)), wait(3000)]);
        if (this.disposed || !settings.voices) return;
        if (performance.now() - requested > MAX_WAIT_MS + 3000 || this.speaking.length >= MAX_VOICES) {
          this.dropped++;
          return;
        }
        const playing = playClip(samples, this.panFor(index));
        if (!playing) return;
        this.spoken++;
        const entry = { id, playing };
        this.speaking.push(entry);
        void playing.ended.then(() => {
          const at = this.speaking.indexOf(entry);
          if (at >= 0) this.speaking.splice(at, 1);
          if (thought && state) state.quietUntil = Math.max(state.quietUntil, performance.now() + THOUGHT_GAP_MS);
        });
      })
      .catch(() => {});
  }

  /** How long a line took to make; too many late ones in a row pause voices. */
  private timed(ms: number): void {
    this.lateRun = ms > MAX_WAIT_MS ? this.lateRun + 1 : 0;
    if (this.lateRun >= LATE_RUN) this.pause('late');
  }

  private firstName(id: number): string {
    return (game.roster.find((s) => s.id === id)?.name ?? '').split(' ')[0];
  }

  /** Stereo position from where the resident is on screen. */
  private panFor(index: number): number {
    if (!this.renderer.simHead(index, this.head) || !this.renderer.project(this.head.x, this.head.y, this.head.z, this.screen)) return 0;
    const width = window.innerWidth || 1;
    return Math.max(-1, Math.min(1, (this.screen.x / width) * 2 - 1)) * 0.7;
  }

  private pan(frame: FrameState): void {
    if (!this.speaking.length) return;
    const { curr, layout } = frame;
    const count = curr[layout.header.simCount];
    for (const s of this.speaking) {
      for (let i = 0; i < count; i++) {
        if (curr[layout.headerLen + i * layout.simStride + layout.sim.id] === s.id) {
          s.playing.setPan(this.panFor(i));
          break;
        }
      }
    }
  }

  private stopAll(): void {
    for (const s of this.speaking) s.playing.stop();
    this.speaking.length = 0;
  }
}

function chance(seed: number, p: number): boolean {
  let h = Math.imul(seed ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296 < p;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
