/**
 * The household-creator stage: the studio's row 0 on a transparent canvas inside a host element.
 * The Sim turns (drag, with a little momentum) in front of a fixed camera and studio lights;
 * the camera frames anything from the full body to the face (wheel, double-click, `zoomTo`).
 * Reactions are short performances (`reactions.ts`) layered over the idle.
 */

import { FreeCamera, Vector3 } from '@babylonjs/core';
import type { StageDirection } from '../babylon/characters';
import type { SimLook, SimStage, StageReaction } from '../types';
import { reactionFor, slump, tilt, wave, WAVE_SECONDS, type Performance } from './reactions';
import type { Studio } from './studio';

const ROW = 0;
const FOV = 0.46;
/** Fraction of the canvas height kept clear at the bottom (name and trait chips). */
const BOTTOM_UI = 0.23;
/** Starting turn: a touch of three-quarter view. */
const START_YAW = -0.32;

interface Act {
  perf: Performance;
  start: number;
  /** Seconds the performance lasts; a one-shot clip is released a little earlier (crossfade). */
  seconds: number;
  clipUntil: number;
  dir: StageDirection;
}

export class StageController implements SimStage {
  onZoom: ((zoom: number) => void) | null = null;
  readonly camera: FreeCamera;
  private look: SimLook | null = null;
  private yaw = START_YAW;
  private yawTarget = START_YAW;
  private yawVel = 0;
  private zoom = 0;
  private zoomTarget = 0;
  private headTop = 1.75;
  private act: Act | null = null;
  /** Between performances: the game's own idle (stance and resting face included). */
  private readonly idle: StageDirection = {};
  private readonly eye = { x: 0, y: 1.6, z: 3 };
  private readonly target = new Vector3();
  private lastNow = 0;
  private dragging: { id: number; x: number; t: number } | null = null;
  private readonly resize: ResizeObserver;
  private detached = false;

  constructor(
    private readonly studio: Studio,
    host: HTMLElement,
    private readonly release: () => void,
  ) {
    const canvas = studio.canvas;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab';
    canvas.setAttribute('aria-label', 'Resident preview: drag or arrow keys to turn, scroll or +/- to zoom');
    canvas.tabIndex = 0;
    host.appendChild(canvas);
    this.camera = new FreeCamera('stageCamera', new Vector3(0, 1, 4), studio.scene, false);
    this.camera.fov = FOV;
    this.camera.minZ = 0.1;
    // Portrait Sims stand 40 m and more to the side; keep them out of view.
    this.camera.maxZ = 30;
    this.camera.inputs.clear();
    studio.scene.activeCamera = this.camera;
    studio.pool.setEnabled(true);
    this.resize = new ResizeObserver(() => studio.engine.resize());
    this.resize.observe(host);
    studio.engine.resize();
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDouble);
    canvas.addEventListener('keydown', this.onKey);
  }

  show(look: SimLook): void {
    if (this.detached) return;
    this.look = { gender: look.gender, appearance: JSON.parse(JSON.stringify(look.appearance)), id: look.id };
    this.studio.setRow(ROW, { look: this.look, x: 0, z: 0, yaw: this.yaw });
  }

  react(reaction: StageReaction): void {
    const perf = reactionFor(reaction);
    const now = performance.now() / 1000;
    const clipSeconds = perf.clip ? this.studio.characters.clipDuration(perf.clip) : 0;
    const oneShot = perf.clip && perf.seconds === undefined;
    const seconds = Math.max(perf.wave ? WAVE_SECONDS : 0, oneShot ? clipSeconds : (perf.seconds ?? 1.5));
    const start = now;
    const dir: StageDirection = {
      clip: perf.clip ?? null,
      hands: perf.hands ?? (perf.wave ? 1 : undefined),
      face: perf.face ?? null,
      lookAt: perf.eyeContact === false ? null : this.eye,
      pose: (add, bone, time) => {
        if (perf.wave) wave(add, bone, time - start);
        if (perf.tilt) tilt(add, bone, time - start, seconds, perf.tilt);
        if (perf.slump) slump(add, bone, time - start, seconds, perf.slump);
      },
    };
    this.act = { perf, start, seconds, clipUntil: start + (oneShot ? clipSeconds - 0.25 : seconds), dir };
    // A wave is for the viewer: the Sim turns back to the front for it.
    if (perf.wave && !this.dragging) {
      const turns = Math.round((this.yawTarget - START_YAW) / (Math.PI * 2));
      this.yawTarget = START_YAW + turns * Math.PI * 2;
      this.yawVel = 0;
    }
  }

  zoomTo(zoom: number): void {
    this.zoomTarget = Math.min(1, Math.max(0, zoom));
    this.onZoom?.(this.zoomTarget);
  }

  /** Before posing: the Sim's turn, its directions and the camera. */
  direct(now: number): void {
    const t = now / 1000;
    const dt = this.lastNow ? Math.min(0.1, t - this.lastNow) : 0;
    this.lastNow = t;
    if (!this.dragging && Math.abs(this.yawVel) > 1e-3) {
      this.yawTarget += this.yawVel * dt;
      this.yawVel *= Math.exp(-dt * 3.5);
    }
    this.yaw += (this.yawTarget - this.yaw) * (1 - Math.exp(-dt * 16));
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt * 6));
    const row = this.studio.rows[ROW];
    if (row) row.yaw = this.yaw;

    // Performance, then back to the idle.
    const act = this.act;
    let dir = this.idle;
    if (act) {
      if (t > act.start + act.seconds) this.act = null;
      else {
        act.dir.clip = t < act.clipUntil ? (act.perf.clip ?? null) : null;
        dir = act.dir;
      }
    }
    this.studio.characters.directions[ROW] = row ? dir : null;

    this.frame();
  }

  /** Draws the stage (after posing). */
  render(): void {
    const scene = this.studio.scene;
    scene.activeCamera = this.camera;
    scene.render();
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    const canvas = this.studio.canvas;
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointercancel', this.onUp);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('dblclick', this.onDouble);
    canvas.removeEventListener('keydown', this.onKey);
    this.resize.disconnect();
    canvas.remove();
    this.studio.pool.setEnabled(false);
    this.studio.characters.directions[ROW] = null;
    this.studio.setRow(ROW, null);
    this.camera.dispose();
    this.release();
  }

  /**
   * Framing: the full body above the name card, or the face; in between, the target and the
   * distance blend (distance in log space, so zooming feels even).
   */
  private frame(): void {
    const heads = this.studio.characters.heads;
    if (this.studio.characters.visible[ROW]) this.headTop += (heads[ROW * 3 + 1] - this.headTop) * 0.2;
    const top = this.headTop + 0.06;
    const engine = this.studio.engine;
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const tan = Math.tan(FOV / 2);
    // Full body: feet to head top in the canvas above the bottom UI; wide enough for the arms.
    const bodyLo = -0.04;
    const bodySpan = 1 - BOTTOM_UI - 0.04;
    let bodyH = (top - bodyLo) / bodySpan;
    bodyH = Math.max(bodyH, 1.05 / aspect);
    const bodyY = bodyLo - BOTTOM_UI * bodyH + bodyH / 2;
    // Face: chin to crown, centred a little above the middle.
    const faceH = Math.max(0.56, 0.36 / aspect);
    const faceY = top - 0.2 - faceH * 0.06;
    const z = this.zoom * this.zoom * (3 - 2 * this.zoom);
    const h = Math.exp(Math.log(bodyH) + (Math.log(faceH) - Math.log(bodyH)) * z);
    const y = bodyY + (faceY - bodyY) * z;
    const dist = h / 2 / tan;
    // Looking down a little at the body (the floor reads as a stage), level with the face.
    const lift = dist * (0.11 * (1 - z) + 0.05 * z);
    this.camera.position.set(0, y + lift, dist);
    this.target.set(0, y, 0);
    this.camera.setTarget(this.target);
    this.eye.x = 0;
    this.eye.y = y + lift;
    this.eye.z = dist;
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.dragging = { id: e.pointerId, x: e.clientX, t: e.timeStamp };
    this.yawVel = 0;
    this.studio.canvas.setPointerCapture(e.pointerId);
    this.studio.canvas.style.cursor = 'grabbing';
  };

  private readonly onMove = (e: PointerEvent) => {
    const d = this.dragging;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dts = Math.max(1, e.timeStamp - d.t) / 1000;
    const turn = -dx * 0.011;
    this.yawTarget += turn;
    this.yawVel = this.yawVel * 0.5 + (turn / dts) * 0.5;
    d.x = e.clientX;
    d.t = e.timeStamp;
  };

  private readonly onUp = (e: PointerEvent) => {
    if (!this.dragging || this.dragging.id !== e.pointerId) return;
    // A drag that ended with a pause keeps no momentum.
    if (e.timeStamp - this.dragging.t > 80) this.yawVel = 0;
    this.yawVel = Math.max(-5, Math.min(5, this.yawVel));
    this.dragging = null;
    this.studio.canvas.style.cursor = 'grab';
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomTo(this.zoomTarget - step * 0.0016);
  };

  private readonly onDouble = () => this.zoomTo(this.zoomTarget > 0.5 ? 0 : 1);

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.yawTarget += e.key === 'ArrowLeft' ? 0.35 : -0.35;
    else if (e.key === '+' || e.key === '=') this.zoomTo(this.zoomTarget + 0.25);
    else if (e.key === '-') this.zoomTo(this.zoomTarget - 0.25);
    else return;
    e.preventDefault();
  };
}
